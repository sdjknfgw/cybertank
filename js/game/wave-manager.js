/* ============================================================
 *  CYBERTANK 波次管理器 + 击杀飘字/全息骷髅动画
 *  命名空间: window.CT_WAVEMAN
 *  依赖:
 *    - window.CT_ENEMY.EnemyAI
 *    - window.CT_BUS (EventBus: on/emit)
 *    - window.CT_RENDERER.worldToScreen
 *    - DOM: #hud-layer 容器
 * ============================================================ */
(function () {
  'use strict';

  // ---------- 依赖兜底 ----------
  if (!window.CT_BUS) {
    window.CT_BUS = {
      _listeners: {},
      on: function (e, fn) { (this._listeners[e] = this._listeners[e] || []).push(fn); },
      emit: function (e, p) { (this._listeners[e] || []).forEach(function (f) { try { f(p); } catch (_) {} }); }
    };
  }
  if (!window.CT_RENDERER) {
    window.CT_RENDERER = {
      worldToScreen: function (x, y) { return { screenX: x, screenY: y }; }
    };
  }
  if (!window.CT_ENEMY) {
    window.CT_ENEMY = {};
  }

  /* ============================================================
   *  波次管理器对象
   * ============================================================ */
  const WaveManager = {
    /** @type {number} 当前波次（从 1 开始） */
    current: 0,
    /** @type {number} 本波剩余未出怪数 */
    total: 0,
    /**
     * 待生成的敌军队列
     * @type {Array<{rank:string, delay:number, spawnPoint:{x:number,y:number}}>}
     */
    spawnQueue: [],
    /** @type {number} 刷怪计时器（秒） */
    spawnTimer: 0,
    /** @type {boolean} 是否为 BOSS 波 */
    isBossWave: false,
    /** @type {Set<Object>} 存活敌军引用 */
    activeEnemies: new Set(),
    /** @type {Object|null} BOSS 波的 Boss 实例（非 BOSS 波为 null） */
    activeBoss: null,
    /** @type {Array<{x:number,y:number}>} 下一波刷出点（准备期 UI 红点显示） */
    nextWaveSpawnPoints: [],
    /**
     * 当前计划的敌情统计（供 getEnemyCountReport 使用）
     * @type {{normalCount:number, fastCount:number, eliteCount:number}}
     */
    plan: { normalCount: 0, fastCount: 0, eliteCount: 0 },

    /* ---------- 公有 API ---------- */

    /**
     * 根据模式 + 波次 + 难度生成下一波的 spawn 计划
     * @param {string} [mode='horde']        游戏模式: 'horde' | 'kingdefend' | 'duel' ...
     * @param {string} [difficulty='normal'] 难度: 'easy'|'normal'|'hard'|'hell'
     * @param {number} [waveOverride]        指定波次（缺省用内部计数）
     * @param {Array}  [obstacles]           地图障碍列表（用于防围死生成点检测）
     * @returns {{
     *   wave:number, isBoss:boolean, totalEnemies:number,
     *   normalCount:number, fastCount:number, eliteCount:number,
     *   spawnQueue:Array, spawnPoints:Array<{x,y}>
     * }}
     */
    planNext: function (mode, difficulty, waveOverride, obstacles) {
      mode = mode || 'horde';
      difficulty = difficulty || 'normal';
      if (typeof waveOverride === 'number' && waveOverride > 0) this.current = waveOverride - 1;

      // 难度系数：影响总数量（基础公式不变）
      const diffMul = ({ easy: 0.8, normal: 1.0, hard: 1.3, hell: 1.6 })[difficulty] || 1.0;

      this.current += 1;
      const wave = this.current;

      // 基础公式（无尽模式）： base = 5 + wave * 2
      let base = 5 + wave * 2;
      base = Math.max(3, Math.round(base * diffMul));

      // 每 5 波为 BOSS 波
      const isBoss = (wave % 5 === 0);
      this.isBossWave = isBoss;

      // 等级配比：前 3 波仅 normal，之后 60/25/15
      let normalCount, fastCount, eliteCount;
      if (wave <= 3) {
        normalCount = base;
        fastCount = 0;
        eliteCount = 0;
      } else {
        normalCount = Math.max(1, Math.round(base * 0.60));
        fastCount = Math.round(base * 0.25);
        eliteCount = Math.max(isBoss ? 0 : 0, Math.round(base * 0.15));
        // 修正总数对齐
        const diff = base - (normalCount + fastCount + eliteCount);
        normalCount += diff;
      }

      // BOSS 波：替换 1 个为 BOSS（总数 -1 加 BOSS 1）
      if (isBoss) {
        if (normalCount > 0) normalCount -= 1;
        else if (fastCount > 0) fastCount -= 1;
        else if (eliteCount > 0) eliteCount -= 1;
      }

      const actualTotal = normalCount + fastCount + eliteCount;
      this.total = actualTotal + (isBoss ? 1 : 0);

      // 保存敌情统计
      this.plan = {
        normalCount: normalCount,
        fastCount: fastCount,
        eliteCount: eliteCount
      };

      // 生成刷出点（地图上下左右 4 边中央偏移）
      // 优先读取渲染器世界尺寸（各模式已把 RENDER.world 设为模板实际尺寸），
      // 避免用旧常量 2400×1600 与真实地图错位，导致刷怪点漂移到地图外/方块包围区。
      const R = window.CT_RENDERER || global.CT_RENDERER;
      const MW = (R && R.world && R.world.w) ? R.world.w
        : ((typeof window.CT_MAP_W !== 'undefined') ? window.CT_MAP_W : 2400);
      const MH = (R && R.world && R.world.h) ? R.world.h
        : ((typeof window.CT_MAP_H !== 'undefined') ? window.CT_MAP_H : 1600);
      const spawnPoints = this._generateSpawnPoints(
        actualTotal + (isBoss ? 1 : 0), MW, MH, obstacles
      );
      this.nextWaveSpawnPoints = spawnPoints.slice();

      // 生成 spawnQueue：随机混排 rank，delay 递增（约 0.4s 间隔）
      const pool = [];
      for (let i = 0; i < normalCount; i++) pool.push('normal');
      for (let i = 0; i < fastCount; i++) pool.push('fast');
      for (let i = 0; i < eliteCount; i++) pool.push('elite');
      this._shuffle(pool);

      // 其余模式：本局第一波延迟 5 秒再开始出 AI 坦克；
      // 无尽模式与经典守护立即出（经典守护的 3 秒等待已由准备期 PREP_FIRST 承担，避免叠加成 8 秒）
      const leadDelay = (mode === 'horde' || mode === 'endless') ? 0 : (this.current === 1 ? 5 : 0);

      const queue = [];
      let delay = 0.2 + leadDelay;
      let spIdx = 0;
      for (let i = 0; i < pool.length; i++) {
        queue.push({
          rank: pool[i],
          delay: delay,
          spawnPoint: spawnPoints[spIdx % spawnPoints.length]
        });
        spIdx++;
        delay += 0.35 + Math.random() * 0.2;
      }

      // BOSS 在队列末尾单独插入（延迟 1.5s 让小兵先上）
      if (isBoss) {
        queue.push({
          rank: 'boss',
          delay: delay + 1.5,
          spawnPoint: spawnPoints[spIdx % spawnPoints.length] || { x: MW / 2, y: 80 }
        });
      }

      // 先不启动，等 startCombat()
      this.spawnQueue = queue.slice();
      this.spawnTimer = 0;

      // 触发 wave:planned 供准备期 UI 红点显示
      window.CT_BUS.emit('wave:planned', {
        wave: wave,
        isBoss: isBoss,
        spawnPoints: this.nextWaveSpawnPoints,
        plan: this.plan
      });

      return {
        wave: wave,
        isBoss: isBoss,
        totalEnemies: this.total,
        normalCount: normalCount,
        fastCount: fastCount,
        eliteCount: eliteCount,
        spawnQueue: queue,
        spawnPoints: this.nextWaveSpawnPoints
      };
    },

    /**
     * 战斗期每帧 tick：spawn 队列推进 + 检测波次清空
     * @param {number} dt 帧时长（秒）
     */
    tick: function (dt) {
      this.spawnTimer += dt;

      // 按 delay 顺序出怪
      while (this.spawnQueue.length > 0 && this.spawnQueue[0].delay <= this.spawnTimer) {
        const def = this.spawnQueue.shift();
        const enemy = this._spawnOne(def);
        if (enemy) {
          if (def.rank === 'boss') {
            this.activeBoss = enemy;
            window.CT_BUS.emit('boss:spawned', { boss: enemy, wave: this.current });
            window.CT_BUS.emit('wave:spawnEnemy', { enemy: enemy, rank: 'boss', wave: this.current });
          } else {
            this.activeEnemies.add(enemy);
            window.CT_BUS.emit('wave:spawnEnemy', { enemy: enemy, rank: def.rank, wave: this.current });
          }
        }
      }

      // 清理死亡敌军引用（延迟清理，防止 Set 遍历时修改）
      this._cleanupDead();

      // 波次清空判定
      const bossDead = !this.activeBoss || this.activeBoss.hp <= 0;
      if (
        this.spawnQueue.length === 0 &&
        this.activeEnemies.size === 0 &&
        bossDead
      ) {
        const finishedWave = this.current;
        const wasBoss = this.isBossWave;
        // 重置标记，避免连续多帧重复触发
        this.spawnQueue = [];
        this.isBossWave = false;
        this.activeBoss = null;
        window.CT_BUS.emit('wave:cleared', {
          wave: finishedWave,
          isBoss: wasBoss
        });
      }

      // BOSS 阶段变化（每 50% HP 触发一次）
      if (this.activeBoss && typeof this.activeBoss._phaseTrack === 'undefined') {
        this.activeBoss._phaseTrack = 1.0; // 记录已触发的最高阈值
      }
      if (this.activeBoss && this.activeBoss.maxHp > 0) {
        const pct = this.activeBoss.hp / this.activeBoss.maxHp;
        const thresholds = [1.0, 0.75, 0.5, 0.25, 0.0];
        for (let t = 0; t < thresholds.length; t++) {
          if (pct <= thresholds[t] && this.activeBoss._phaseTrack > thresholds[t]) {
            this.activeBoss._phaseTrack = thresholds[t];
            window.CT_BUS.emit('boss:phaseChanged', {
              boss: this.activeBoss,
              phase: thresholds.length - 1 - t,
              hpPct: pct,
              wave: this.current
            });
            break;
          }
        }
      }
    },

    /**
     * 获取敌情预告（左栏 UI 用）
     * @returns {{
     *   normal:number, fast:number, elite:number,
     *   isBoss:boolean, bossName:string, bossSkills:string[]
     * }}
     */
    getEnemyCountReport: function () {
      return {
        normal: this.plan.normalCount | 0,
        fast: this.plan.fastCount | 0,
        elite: this.plan.eliteCount | 0,
        isBoss: this.isBossWave,
        bossName: '烈焰巨兽',
        bossSkills: ['喷射火焰弹', '召唤小兵']
      };
    },

    /**
     * 开始战斗：标记并触发 wave:started 事件
     * （planNext 已经生成 spawnQueue，这里仅计时归零 + 广播）
     */
    startCombat: function () {
      this.spawnTimer = 0;
      // 确保 activeEnemies 为空（上一波遗留清理）
      this.activeEnemies.clear();
      this.activeBoss = null;
      window.CT_BUS.emit('wave:started', {
        wave: this.current,
        isBoss: this.isBossWave,
        total: this.total
      });
    },

    /** 重置管理器（新游戏调用） */
    reset: function () {
      this.current = 0;
      this.total = 0;
      this.spawnQueue = [];
      this.spawnTimer = 0;
      this.isBossWave = false;
      this.activeEnemies.clear();
      this.activeBoss = null;
      this.nextWaveSpawnPoints = [];
      this.plan = { normalCount: 0, fastCount: 0, eliteCount: 0 };
    },

    /* ---------- 内部辅助 ---------- */

    /**
     * 在地图 4 边生成 N 个散布刷出点
     * @param {number} n   点数
     * @param {number} MW  地图宽
     * @param {number} MH  地图高
     */
    _generateSpawnPoints: function (n, MW, MH, obstacles) {
      const margin = 90;
      const pts = [];
      const sides = ['top', 'bottom', 'left', 'right'];
      const OB = window.CT_OBSTACLE;
      for (let i = 0; i < n; i++) {
        const side = sides[i % 4];
        // 中央偏移（± 1/4 边长）
        const jitter = (Math.random() - 0.5) * 0.5;
        let x, y;
        if (side === 'top') {
          x = MW / 2 + jitter * MW * 0.5;
          y = margin;
        } else if (side === 'bottom') {
          x = MW / 2 + jitter * MW * 0.5;
          y = MH - margin;
        } else if (side === 'left') {
          x = margin;
          y = MH / 2 + jitter * MH * 0.5;
        } else {
          x = MW - margin;
          y = MH / 2 + jitter * MH * 0.5;
        }
        x = Math.max(margin, Math.min(MW - margin, x));
        y = Math.max(margin, Math.min(MH - margin, y));
        /* 防围死：用洪水填充把点挪到最近的开阔区域 */
        if (OB && typeof OB.findSafeSpawn === 'function' && obstacles && obstacles.length) {
          const safe = OB.findSafeSpawn(obstacles, MW, MH, x, y, 420);
          x = safe.x; y = safe.y;
        }
        pts.push({ x: x, y: y });
      }
      return pts;
    },

    /** 数组原地洗牌 */
    _shuffle: function (arr) {
      for (let i = arr.length - 1; i > 0; i--) {
        const j = (Math.random() * (i + 1)) | 0;
        const tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp;
      }
      return arr;
    },

    /** 创建单个敌军实例 */
    _spawnOne: function (def) {
      if (!def) return null;
      if (def.rank === 'boss') {
        // BOSS：尝试使用 CT_BOSS（如未实现则 fallback 为精英）
        if (window.CT_BOSS && typeof window.CT_BOSS.BossTank === 'function') {
          return new window.CT_BOSS.BossTank({
            x: def.spawnPoint.x,
            y: def.spawnPoint.y,
            wave: this.current
          });
        }
        // fallback：超级精英（临时兼容）
        if (window.CT_ENEMY && window.CT_ENEMY.EnemyAI) {
          const b = new window.CT_ENEMY.EnemyAI({
            x: def.spawnPoint.x,
            y: def.spawnPoint.y,
            rank: 'elite',
            wave: this.current
          });
          if (b.stats) {
            b.stats.maxHp = (b.stats.maxHp || 3) * 10;
            b.maxHp = b.stats.maxHp;
            b.hp = b.maxHp;
          } else {
            b.maxHp = 30;
            b.hp = 30;
          }
          b.name = '烈焰巨兽';
          b._isBossFallback = true;
          return b;
        }
        return null;
      }
      if (window.CT_ENEMY && window.CT_ENEMY.EnemyAI) {
        return new window.CT_ENEMY.EnemyAI({
          x: def.spawnPoint.x,
          y: def.spawnPoint.y,
          rank: def.rank,
          wave: this.current
        });
      }
      return null;
    },

    /** 清理死亡敌军 */
    _cleanupDead: function () {
      if (!this.activeEnemies.size) return;
      const toRemove = [];
      this.activeEnemies.forEach(function (e) {
        if (!e || e.hp <= 0 || !e.alive) toRemove.push(e);
      });
      for (let i = 0; i < toRemove.length; i++) {
        this.activeEnemies.delete(toRemove[i]);
      }
    }
  };

  /* ============================================================
   *  工具函数：伤害飘字 + 全息骷髅动画（DOM 层）
   * ============================================================ */

  /**
   * 生成伤害飘字（DOM 层，CSS 动画上浮淡出）
   * @param {number} worldX  世界 X
   * @param {number} worldY  世界 Y
   * @param {string} text    显示文本（如 '-42'）
   * @param {string} [color='#ffd700']
   * @param {number} [size=18]
   */
  WaveManager.spawnDamageNumber = function (worldX, worldY, text, color, size) {
    color = color || '#ffd700';
    size = size || 18;
    const conv = window.CT_RENDERER.worldToScreen(worldX, worldY);
    // 兼容两种返回格式：{screenX,screenY}（规范命名）和 {x,y}（renderer.js 实际实现）
    const sx = conv
      ? (conv.screenX != null ? conv.screenX : (conv.x != null ? conv.x : worldX))
      : worldX;
    const sy = conv
      ? (conv.screenY != null ? conv.screenY : (conv.y != null ? conv.y : worldY))
      : worldY;
    const screenX = sx | 0;
    const screenY = sy | 0;
    const el = document.createElement('div');
    el.className = 'damage-text text-glow-gold font-mono font-bold absolute pointer-events-none';
    el.style.left = screenX + 'px';
    el.style.top = screenY + 'px';
    el.style.color = color;
    el.style.fontSize = size + 'px';
    el.style.transform = 'translate(-50%, -50%)';
    el.style.textShadow = '0 0 6px ' + color + ', 0 0 2px #fff';
    el.style.willChange = 'transform, opacity';
    el.style.transition = 'none';
    // 关键帧：800ms 内 上浮 40px + scale(1→1.2) + opacity 1→0
    el.style.animation = 'ctDamageFloat 800ms ease-out forwards';
    el.textContent = text;

    const host = document.getElementById('hud-layer') || document.body;
    host.appendChild(el);
    setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 900);
  };

  /**
   * 生成全息骷髅动画（击杀特效，DOM 层）
   * @param {number} worldX  世界 X
   * @param {number} worldY  世界 Y
   */
  WaveManager.spawnKillSkull = function (worldX, worldY) {
    const conv = window.CT_RENDERER.worldToScreen(worldX, worldY);
    const sx = conv
      ? (conv.screenX != null ? conv.screenX : (conv.x != null ? conv.x : worldX))
      : worldX;
    const sy = conv
      ? (conv.screenY != null ? conv.screenY : (conv.y != null ? conv.y : worldY))
      : worldY;
    const screenX = sx | 0;
    const screenY = sy | 0;
    const el = document.createElement('div');
    el.className = 'kill-skull absolute pointer-events-none';
    el.style.left = screenX + 'px';
    el.style.top = screenY + 'px';
    el.style.transform = 'translate(-50%, -50%) scale(0.5)';
    el.style.fontSize = '36px';
    el.style.color = '#00f0ff';
    el.style.textShadow = '0 0 14px #00f0ff, 0 0 28px #00f0ff, 0 0 2px #fff';
    el.style.opacity = '1';
    el.style.willChange = 'transform, opacity';
    el.style.animation = 'ctKillSkullPop 800ms ease-out forwards';
    el.textContent = '\uD83D\uDC80'; // 💀

    const host = document.getElementById('hud-layer') || document.body;
    host.appendChild(el);
    setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 900);
  };

  /* ============================================================
   *  注入 CSS keyframes（若页面尚未定义）
   * ============================================================ */
  (function injectKeyframes() {
    try {
      const id = 'ct-waveman-kf';
      if (document.getElementById(id)) return;
      const style = document.createElement('style');
      style.id = id;
      style.textContent = [
        '@keyframes ctDamageFloat {',
        '  0%   { transform: translate(-50%, -50%) scale(0.7); opacity: 0; }',
        '  15%  { transform: translate(-50%, -70%) scale(1.15); opacity: 1; }',
        '  100% { transform: translate(-50%, -160%) scale(1.0); opacity: 0; }',
        '}',
        '@keyframes ctKillSkullPop {',
        '  0%   { transform: translate(-50%, -50%) scale(0.5); opacity: 0; }',
        '  20%  { transform: translate(-50%, -50%) scale(1.2); opacity: 1; }',
        '  45%  { transform: translate(-50%, -50%) scale(1.0); opacity: 1; }',
        '  100% { transform: translate(-50%, -90%) scale(1.0); opacity: 0; }',
        '}'
      ].join('\n');
      (document.head || document.documentElement).appendChild(style);
    } catch (e) { /* 忽略 */ }
  })();

  /* ============================================================
   *  绑定 CT_BUS 事件：命中飘字 + 击杀骷髅
   * ============================================================ */
  window.CT_BUS.on('tank:hit', function (evt) {
    if (!evt || !evt.target) return;
    const target = evt.target;
    const pos = target.pos || { x: 0, y: 0 };
    const dmg = typeof evt.dmg === 'number' ? evt.dmg : 0;
    WaveManager.spawnDamageNumber(
      pos.x,
      pos.y - 30,
      '-' + Math.round(dmg),
      '#ff2a6d',
      dmg >= 5 ? 22 : 18
    );
  });

  window.CT_BUS.on('tank:dead', function (evt) {
    if (!evt || !evt.dead) return;
    const dead = evt.dead;
    const pos = dead.pos || { x: 0, y: 0 };
    WaveManager.spawnKillSkull(pos.x, pos.y);
    // 若是 BOSS fallback，也清理引用
    if (WaveManager.activeBoss === dead) {
      WaveManager.activeBoss = null;
    }
  });

  /* ============================================================
   *  导出命名空间
   * ============================================================ */
  window.CT_WAVEMAN = WaveManager;
})();

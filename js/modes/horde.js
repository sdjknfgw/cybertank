/* ==========================================================
 * CYBERTANK · Horde Mode — 无尽波次模式（MVP）
 * 命名空间: window.CT_MODE_HORDE
 * 严格闭环：准备期 30s → 战斗（无限波）→ 波清 → 增益 → 下一轮准备期
 * ========================================================== */
(function (global) {
  'use strict';

  const BUS    = global.CT_BUS        || { on(){}, off(){}, emit(){} };
  const ENG    = global.CT_ENGINE     || {};
  const RENDER = global.CT_RENDERER   || { camera:{}, world:{w:2400,h:1600} };
  const PHYS   = global.CT_PHYSICS    || { aabb(){return false;}, resolveCollision(){} };
  const WAVE   = global.CT_WAVEMAN    || { planNext(){return {};}, tick(){}, startCombat(){}, reset(){} };
  const PREP   = global.CT_PREP       || { start(){}, cancel(){} };
  const BUFF   = global.CT_BUFF       || { generateThreeCards:()=>[], applySelection:()=>({ok:false}), tickTimers(){} };
  const SHOP   = global.CT_SHOP       || { setDiscount(){} };
  const STORAGE= global.CT_STORAGE    || { updateRecord(){}, getRecord:()=>({bestWave:0, highScore:0}) };
  const TANK_NS= global.CT_TANK       || {};
  const OB_NS  = global.CT_OBSTACLE   || {};
  const BUL_NS = global.CT_BULLET     || { spawn(){return null;}, Pool:{ acquire:()=>({alive:false}), release(){} } };
  const UI_RES = global.CT_UI_RESULT  || null;
  const PW_NS  = global.CT_POWERUP    || null;

  const TankCtor  = TANK_NS.Tank || function TankStub(o){ o=o||{}; this.pos={x:o.x||0,y:o.y||0}; this.spawnPos={...this.pos}; this.hp=o.maxHp||3; this.maxHp=this.hp; this.alive=true; this._w=56;this._h=56; this.aabb={x:this.pos.x-28,y:this.pos.y-28,w:56,h:56}; this.muls={dmg:1,fireRate:1,speed:1,dr:0,pierce:0,splash:0,coinGain:1}; this.flags={}; this.tempBuffs=[]; this.type=o.type||'player'; this.shield=0; this.revives=0; };
  const WallBrick = OB_NS.WallBrick || function (o){ return {alive:true,blockTank:true,blockBullet:true,_box:{x:o.x,y:o.y,w:o.w||64,h:o.h||64}, get aabb(){return this._box;}, update(){}, render(){} }; };
  const WallSteel = OB_NS.WallSteel || WallBrick;
  /* 新地形：草丛(隐身) / 水(挡车不挡弹) / 冰(打滑) / 泥(减速) / 传送门(P↔Q 成对) */
  const Bush      = OB_NS.Bush   || null;
  const Water     = OB_NS.Water  || null;
  const Ice       = OB_NS.Ice    || null;
  const Mud       = OB_NS.Mud    || null;
  const Portal    = OB_NS.Portal || null;

  const MAP_W = RENDER.world && RENDER.world.w ? RENDER.world.w : 2400;
  const MAP_H = RENDER.world && RENDER.world.h ? RENDER.world.h : 1600;
  const BULLET_GC_SEC = 5;
  const PUP_FIRST = 8;           // 首颗增益道具掉落延迟
  const PUP_INTERVAL = 15;       // 之后每 15s 一颗（技能随机掉落）

  /* 地图模板（基础 32×21，加载期统一放大 2 倍 → 64×42；网格化均匀布局：4 横带 × 4 竖区，每区必有结构，带间走道）
   * 符号：B=砖 S=钢 G=草丛(隐身) W=水(挡车不挡弹) I=冰(打滑) M=泥(减速) P/Q=传送门(成对) */
  const _BASE_MAP = [
    '................................',
    '..SS....BBBB.......BBBB.....SS..',
    '..SS....B..B.......B..B.....SS..',
    '........B..B.......B..B.........',
    '........BBBB.......BBBB.........',
    '................................',
    '.WWW.....MMM.......IIII.....MMM.',
    '.W.......M.M.......I..I......M.M',
    '.WWW.....MMM.......IIII......MMM',
    '..GG........................GG..',
    '................................',
    '..GG....SSSS.........P......GG..',
    '..GG....S..S................GG..',
    '........S..S.......IIII.........',
    '..BB....SSSS.......IIIQ.....BB..',
    '................................',
    '.MMM....BBBB.......GGGG.....BBB.',
    '.M.M....B..B.......G..G......B.B',
    '.M.M....B..B.......G..G......B.B',
    '........BBBB.......GGGG.....BBB.',
    '................................',
  ];
  /* 地图扩大：基础模板 ×2 → 64×42（tile=64 → 4096×2688），布局密度不变、世界等比变大。
   * 装饰：左上角用钢块拼出 "ccr"（5×5 点阵、scale=1 ≈ 1088×320px，不至于过大）。 */
  const MAP_TEMPLATE = (function () {
    let t = _BASE_MAP;
    if (OB_NS && typeof OB_NS.enlargeTemplate === 'function') t = OB_NS.enlargeTemplate(t, 2);
    if (OB_NS && typeof OB_NS.stampText === 'function') {
      t = OB_NS.stampText(t, 'ccr', { row: 2, col: 3, ch: 'S', scale: 1, gap: 1, clear: true });
    }
    return t;
  })();
  function createMapFromTemplate(template, tileSize) {
    tileSize = tileSize || 64;
    const cols = template[0].length;
    const rows = template.length;
    const totalW = cols * tileSize;
    const totalH = rows * tileSize;
    /* 地图从原点铺满世界（世界尺寸=模板尺寸），无居中偏移 */
    const offX = 0;
    const offY = 0;
    const obstacles = [];
    /* 传送门配对：P 出现时记 id，Q 出现时回填 pairId（双向互通） */
    let portalSeq = 0, lastPortal = null;
    for (let r = 0; r < rows; r++) {
      const row = (template[r] || '').padEnd(cols, '.');
      for (let c = 0; c < cols; c++) {
        const ch = row[c] || '.';
        const x = offX + c * tileSize;
        const y = offY + r * tileSize;
        if (ch === 'B') obstacles.push(new WallBrick({ x, y, w: tileSize, h: tileSize }));
        else if (ch === 'S') obstacles.push(new WallSteel({ x, y, w: tileSize, h: tileSize }));
        else if (ch === 'G' && Bush) obstacles.push(new Bush({ x, y, w: tileSize, h: tileSize }));
        else if (ch === 'W' && Water) obstacles.push(new Water({ x, y, w: tileSize, h: tileSize }));
        else if (ch === 'I' && Ice) obstacles.push(new Ice({ x, y, w: tileSize, h: tileSize }));
        else if (ch === 'M' && Mud) obstacles.push(new Mud({ x, y, w: tileSize, h: tileSize }));
        else if ((ch === 'P' || ch === 'Q') && Portal) {
          portalSeq++;
          if (ch === 'P') {
            lastPortal = new Portal({ id: 'portal_' + portalSeq, pairId: null, x, y, w: tileSize, h: tileSize });
            obstacles.push(lastPortal);
          } else {
            const q = new Portal({ id: 'portal_' + portalSeq, pairId: lastPortal ? lastPortal.portalId : null, x, y, w: tileSize, h: tileSize });
            if (lastPortal) { lastPortal.portalPairId = q.portalId; lastPortal = null; }
            obstacles.push(q);
          }
        }
      }
    }
    scatterBlocks(obstacles, tileSize, cols, rows);
    return { obstacles, w: totalW, h: totalH, tile: tileSize, offX, offY };
  }

  /* 在模板基础上随机散布方块，填充各处空白（保留最外圈与底部走廊） */
  function scatterBlocks(obstacles, tileSize, cols, rows) {
    const OB = global.CT_OBSTACLE;
    if (OB && typeof OB.scatterFill === 'function') {
      OB.scatterFill(obstacles, {
        tile: tileSize, cols: cols, rows: rows,
        density: 0.15, skipBorder: true, skipBottomRows: 2,
        ctor: { WallBrick: WallBrick, WallSteel: WallSteel, Bush: Bush, Water: Water, Ice: Ice, Mud: Mud },
        rng: Math.random,
        // 保护底部中央的水晶基地（约 cols 12~17 × rows 15~18），避免方块压住基地
        skipRects: [{ c0: Math.floor(cols / 2) - 3, c1: Math.floor(cols / 2) + 2, r0: rows - 5, r1: rows - 2 }]
      });
    }
  }

  const CT_MODE_HORDE = {
    running: false,
    _bindings: [],
    _gcTimer: 0,
    state: null,
    _tickFn: null,
    _waveDeaths: 0,   // 本波玩家死亡次数（用于 noDeathStreak）

    start(options) {
      try {
        options = options || {};
        /* 无条件先 stop()：_gameOver() 只把 running 置 false，并不会注销 tick/绑定，
         * 若写成 if (this.running) this.stop()，重开时旧 tick 仍留在引擎里、新 tick 再注册一次，
         * 于是 tick 每帧被执行两次 → 位移与射击冷却都按双倍推进
         * （1v1「继续战斗」后双方移速/射速越来越快的根因，且每重开一次再翻倍）。
         * stop() 幂等，未启动时调用同样安全。 */
        this.stop();
        this.running = true;
        this._gcTimer = 0;
        this._waveDeaths = 0;
        if (typeof WAVE.reset === 'function') WAVE.reset();

        const tankClass  = options.tankClass  || 'heavy';
        const skin       = options.skin       || '#ff6bd6';
        const difficulty = options.difficulty || 'normal';

        // 地图（先建图，玩家出生点防围死检测需要障碍数据）
        const mapInfo = createMapFromTemplate(MAP_TEMPLATE, 64);
        /* 世界尺寸 = 模板实际尺寸：地图铺满世界，四周不再留大面积空白 */
        const WORLD_W = mapInfo.w, WORLD_H = mapInfo.h;
        const OB_TOOL = global.CT_OBSTACLE;
        const safePt = (x, y) => {
          if (OB_TOOL && typeof OB_TOOL.findSafeSpawn === 'function') {
            return OB_TOOL.findSafeSpawn(mapInfo.obstacles, WORLD_W, WORLD_H, x, y, 420);
          }
          return { x, y };
        };

        // 玩家：底部走道中央（模板末行为空走道）
        const pSpawn = safePt(WORLD_W / 2, WORLD_H - 96);
        const player = new TankCtor({
          x: pSpawn.x, y: pSpawn.y,
          type: 'player', tankClass, color: skin, name: 'HordePlayer'
        });
        player.difficulty = difficulty;
        player.revives = options.revives != null ? options.revives : 0; // 默认 0 次复活（其余模式仅 1 条命）
        // 从存档读取 bestWave/highScore 放 state 上
        let stored = { bestWave: 0, highScore: 0 };
        try { if (STORAGE && typeof STORAGE.getRecord === 'function') stored = STORAGE.getRecord('horde') || stored; } catch (_) {}

        this.state = {
          mode: 'horde',
          phase: 'INIT',
          wave: 0,
          noDeathStreak: 0,
          bestWave: stored.bestWave || 0,
          highScore: stored.highScore || 0,
          difficulty,
          player,
          tanks: [player],
          obstacles: mapInfo.obstacles,
          bullets: [],
          powerups: [],
          pupTimer: PUP_FIRST,
          pupInterval: PUP_INTERVAL,
          mapInfo: { ...mapInfo, w: WORLD_W, h: WORLD_H, centerX: WORLD_W/2, centerY: WORLD_H/2 },
          score: 0, kills: 0, coins: 0,
          _pendingDiscount: 1.0
        };
        ENG.gameState = this.state;
        /* 同步世界尺寸（其他模式可能改过 RENDER.world），坦克边界钳制依赖它 */
        try { if (RENDER.world) { RENDER.world.w = WORLD_W; RENDER.world.h = WORLD_H; } } catch (_) {}
        try { RENDER.fitWorldToView(); } catch (_) { try { RENDER.camera.target = player; } catch (_) {} }

        this._bindAll();

        // 准备期 20s → nextWave（无尽模式每波间隔 20 秒）
        const self = this;
        try {
          PREP.start({
            seconds: 20,
            mode: 'horde',
            players: [player],
            mapInfo: this.state.mapInfo,
            onCombatStart: () => self._nextWave()
          });
        } catch (e) { console.error('[horde] prep start', e); }

        if (ENG && typeof ENG.registerUpdate === 'function') {
          this._tickFn = function (dtMs) { self.tick(dtMs); };
          ENG.registerUpdate(this._tickFn, 50);
        }
        BUS.emit('mode:started', { mode: 'horde', state: this.state });
        console.log('[MODE HORDE] started');
      } catch (e) { console.error('[MODE HORDE] start:', e); }
    },

    stop() {
      try {
        this.running = false;
        for (let i = 0; i < this._bindings.length; i++) {
          try { BUS.off(this._bindings[i].e, this._bindings[i].fn); } catch (_) {}
        }
        this._bindings = [];
        try { PREP.cancel(true); } catch (_) {}
        if (this._tickFn && ENG && typeof ENG.unregisterUpdate === 'function') {
          try { ENG.unregisterUpdate(this._tickFn); } catch (_) {}
        }
        this._tickFn = null;
        this.state = null;
        try { if (ENG) ENG.gameState = null; } catch (_) {}
      } catch (e) { console.error('[MODE HORDE] stop:', e); }
    },

    tick(dtMs) {
      if (!this.running || !this.state) return;
      const dt = dtMs / 1000;
      const s = this.state;

      if (s.phase === 'COMBAT') { try { WAVE.tick(dt); } catch (_) {} }
      /* 存活时长累计（用于结算与评级完成度） */
      if (s.phase === 'COMBAT') s.time = (s.time || 0) + dt;

      // tanks update + buff tick
      // 分派：玩家用 CT_INPUT 快照输入；敌人走 EnemyAI.update(dt, obstacles, playerTanks)
      const playerTanks = [];
      for (let i = 0; i < s.tanks.length; i++) {
        const pt = s.tanks[i];
        if (pt && pt.alive && pt.type === 'player') playerTanks.push(pt);
      }
      for (let i = 0; i < s.tanks.length; i++) {
        const t = s.tanks[i]; if (!t || !t.alive) continue;
        try { BUFF.tickTimers(t, dt); } catch (_) {}
        try {
          if (typeof t.update !== 'function') continue;
          if (t.type === 'player') {
            const inp = (global.CT_INPUT && typeof global.CT_INPUT.snapshot === 'function')
              ? global.CT_INPUT.snapshot() : {};
            t.update(dt, inp, s.obstacles, s.tanks);
          } else {
            t.update(dt, s.obstacles, playerTanks);
          }
        } catch (_) {}
      }
      for (let i = 0; i < s.obstacles.length; i++) {
        const o = s.obstacles[i]; if (!o) continue;
        try { if (typeof o.update === 'function') o.update(dt); } catch (_) {}
      }
      for (let i = 0; i < s.bullets.length; i++) {
        const b = s.bullets[i]; if (!b || !b.alive) continue;
        try {
          if (typeof b.update === 'function') b.update(dt, s);
          else {
            b.pos.x += (b.vel.x || 0) * dt * 60;
            b.pos.y += (b.vel.y || 0) * dt * 60;
            const bw = (RENDER.world && RENDER.world.w) || MAP_W;
            const bh = (RENDER.world && RENDER.world.h) || MAP_H;
            if (b.pos.x < 0 || b.pos.x > bw || b.pos.y < 0 || b.pos.y > bh) b.alive = false;
          }
        } catch (_) {}
      }
      /* 道具每帧 update（浮动动画 + 磁吸 + 拾取检测） */
      for (let i = 0; i < s.powerups.length; i++) {
        const p = s.powerups[i]; if (!p || !p.alive) continue;
        try { if (typeof p.update === 'function') p.update(dt, s.tanks); } catch (_) {}
      }
      /* 技能随机掉落：战斗期每 pupInterval 秒在地图随机安全点刷一颗增益道具 */
      if (s.phase === 'COMBAT') {
        s.pupTimer = (s.pupTimer == null ? PUP_FIRST : s.pupTimer) - dt;
        if (s.pupTimer <= 0) { this._spawnBuffPowerup(s); s.pupTimer = s.pupInterval || PUP_INTERVAL; }
      }

      this._collisionTick(dt);

      this._gcTimer += dt;
      if (this._gcTimer >= BULLET_GC_SEC) { this._gcTimer = 0; this._gcBullets(); }

      this._cleanupDeadEntities();
    },

    /* ---------- 共享碰撞（各模式通用结构，逻辑独立副本，便于未来各模式差异化）---------- */
    _collisionTick(dt) {
      const s = this.state; if (!s) return;
      const tanks = s.tanks, bullets = s.bullets, obstacles = s.obstacles;

      // 1. Tank vs Obstacle
      for (let i = 0; i < tanks.length; i++) {
        const t = tanks[i]; if (!t || !t.alive) continue;
        const ab = t.aabb; if (!ab) continue;
        for (let j = 0; j < obstacles.length; j++) {
          const o = obstacles[j]; if (!o || !o.alive || !o.blockTank) continue;
          const ob = o.aabb || o._box; if (!ob) continue;
          if (PHYS.aabb(ab, ob)) {
            try { PHYS.resolveCollision(t, o); } catch (_) {
              if (t.pos) { t.pos.x += (Math.random() - 0.5) * 4; t.pos.y += (Math.random() - 0.5) * 4; }
            }
          }
        }
      }
      // 2. Tank vs Tank
      for (let i = 0; i < tanks.length; i++) {
        const a = tanks[i]; if (!a || !a.alive) continue;
        for (let j = i + 1; j < tanks.length; j++) {
          const b = tanks[j]; if (!b || !b.alive) continue;
          try { PHYS.resolveCollision(a, b); } catch (_) {}
        }
      }
      // 3. Bullet vs Obstacle
      for (let i = 0; i < bullets.length; i++) {
        const b = bullets[i]; if (!b || !b.alive) continue;
        const bb = { x: (b.pos.x - (b.radius || 4)), y: (b.pos.y - (b.radius || 4)), w: (b.radius || 4) * 2, h: (b.radius || 4) * 2 };
        for (let j = 0; j < obstacles.length; j++) {
          const o = obstacles[j]; if (!o || !o.alive || !o.blockBullet) continue;
          const ob = o.aabb || o._box; if (!ob) continue;
          if (PHYS.aabb(bb, ob)) {
            if (b.bounces && b.bounces > 0) {
              b.bounces -= 1;
              const overlapX = Math.min(bb.x + bb.w - ob.x, ob.x + ob.w - bb.x);
              const overlapY = Math.min(bb.y + bb.h - ob.y, ob.y + ob.h - bb.y);
              if (overlapX < overlapY) b.vel.x = -(b.vel.x || 0);
              else b.vel.y = -(b.vel.y || 0);
            } else b.alive = false;
            if (o.type === 'brick' || (o.hp != null && o.hp !== Infinity)) {
              o.hp = (o.hp - (b.damage || 1)) | 0;
              if (o.hp <= 0) o.alive = false;
            }
            if (!b.alive) break;
          }
        }
      }
      // 4. Bullet vs Tank
      for (let i = 0; i < bullets.length; i++) {
        const b = bullets[i]; if (!b || !b.alive) continue;
        const bb = { x: (b.pos.x - (b.radius || 4)), y: (b.pos.y - (b.radius || 4)), w: (b.radius || 4) * 2, h: (b.radius || 4) * 2 };
        for (let j = 0; j < tanks.length; j++) {
          const t = tanks[j]; if (!t || !t.alive) continue;
          if (b._ownerRef === t) continue;
          const tb = t.aabb; if (!tb) continue;
          if (PHYS.aabb(bb, tb)) {
            if (b._hitSet && b._hitSet.has(t)) continue;
            let dmg = (b.damage || 1) * (t.muls && t.muls.dr != null ? Math.max(0, 1 - t.muls.dr) : 1);
            if (t.shield > 0) { const absorb = Math.min(t.shield, dmg); t.shield -= absorb; dmg -= absorb; }
            if (t.takeDamage) { try { t.takeDamage(dmg); } catch (_) { t.hp -= dmg; } }
            else t.hp -= dmg;
            BUS.emit('tank:hit', { target: t, dmg, bullet: b, attacker: b.owner });
            if (b._hitSet) b._hitSet.add(t);
            if (b.pierce && b.pierce > 0) b.pierce -= 1;
            else b.alive = false;
            if (t.hp <= 0 && t.alive) {
              t.alive = false;
              BUS.emit('tank:dead', { dead: t, killer: b.owner, rank: t.rank || null });
            }
            if (!b.alive) break;
          }
        }
      }
      // 5. Powerup pickup
      for (let i = 0; i < tanks.length; i++) {
        const t = tanks[i]; if (!t || !t.alive || t.type !== 'player') continue;
        const tb = t.aabb; if (!tb) continue;
        for (let j = 0; j < s.powerups.length; j++) {
          const p = s.powerups[j]; if (!p || !p.alive) continue;
          const pb = p.aabb || p._box; if (!pb) continue;
          if (PHYS.aabb(tb, pb)) {
            /* Powerup 实例的拾取方法是 _pickup（内部 def.apply + 派发事件），
             * 此前误调 p.apply（不存在）→ 拾取静默失败 */
            try { if (typeof p._pickup === 'function') p._pickup(t); else if (p.def && typeof p.def.apply === 'function') p.def.apply(t); } catch (_) {}
            p.alive = false;
            BUS.emit('powerup:pickup', { target: t, powerup: p });
          }
        }
      }
    },

    /* ---------- 波次流程 ---------- */
    _nextWave() {
      const s = this.state; if (!s || !this.running) return;
      s.wave += 1;
      s.phase = 'COMBAT';
      this._waveDeaths = 0;
      try { if (ENG && typeof ENG.setState === 'function') ENG.setState('COMBAT'); } catch (_) {}
      try { WAVE.planNext('horde', s.difficulty, s.wave, s.obstacles); } catch (_) {}
      try { WAVE.startCombat(); } catch (_) {}
      /* 波次来袭全屏横幅 */
      const isBoss = (s.wave % 5 === 0);
      try {
        global.CT_WAVE_BANNER && global.CT_WAVE_BANNER.show(
          isBoss ? '☠ BOSS 来袭' : '⚔ 第 ' + s.wave + ' 波来袭',
          isBoss ? 'BOSS WAVE · 全力迎战' : 'WAVE ' + s.wave + ' · INCOMING',
          2200
        );
      } catch (_) {}
      BUS.emit('horde:waveStarted', { wave: s.wave });
    },

    _onWaveCleared(evt) {
      const s = this.state; if (!s || !this.running) return;
      evt = evt || {};
      const wave = evt.wave || s.wave;
      const wasBoss = !!evt.isBoss;

      // a. 波次奖励 30 × wave 金币
      const gainMul = (s.player.muls && s.player.muls.coinGain) || 1;
      const coinGain = Math.round(30 * wave * gainMul);
      s.player.coins = (s.player.coins || 0) + coinGain;
      s.coins += coinGain;
      s.score += Math.round(100 * wave * (s.player.muls && s.player.muls.scoreGain || 1));
      BUS.emit('shop:coinsGained', { target: s.player, coins: coinGain, reason: 'wave_clear', wave });

      /* 波次完成横幅（含金币奖励提示） */
      try {
        global.CT_WAVE_BANNER && global.CT_WAVE_BANNER.show(
          '✅ 第 ' + wave + ' 波完成',
          '+' + coinGain + ' 金币 · 准备下一波',
          2000
        );
      } catch (_) {}

      // b. noDeathStreak 统计
      if (this._waveDeaths === 0) s.noDeathStreak += 1;
      else s.noDeathStreak = 0;
      ENG.gameState = s; // 同步（CT_PREP._calcDiscountForStreak 会读）

      // c. 每 3 波 → 空投补给（下次准备期自动 9 折）
      if (s.wave % 3 === 0) {
        s._pendingDiscount = 0.9;
        try { if (SHOP && typeof SHOP.setDiscount === 'function') SHOP.setDiscount(0.9); } catch (_) {}
        BUS.emit('horde:supplyDrop', { wave: s.wave, discount: 0.9 });
      } else {
        s._pendingDiscount = 1.0;
      }

      // 更新存档（每波完都存）
      try {
        if (STORAGE && typeof STORAGE.updateRecord === 'function') {
          const best = Math.max(s.bestWave, s.wave);
          const hs = Math.max(s.highScore, s.score);
          STORAGE.updateRecord('horde', { bestWave: best, highScore: hs });
          s.bestWave = best; s.highScore = hs;
        }
      } catch (_) {}

      // BOSS 波成就
      if (wasBoss) {
        BUS.emit('achievement:unlock', { id: 'boss_slayer', wave });
      }

      // d. Buff 3 选 1
      this._showBuffSelection();
    },

    _showBuffSelection() {
      const s = this.state; if (!s) return;
      s.phase = 'BUFF_SELECT';
      try { if (ENG && typeof ENG.setState === 'function') ENG.setState('BUFF_SELECT'); } catch (_) {}
      try {
        const mods = {};
        if (s.player.flags && s.player.flags.nextBuffRarityUp) { mods.rarityUp = true; s.player.flags.nextBuffRarityUp = false; }
        const cards = BUFF.generateThreeCards(s.player, mods) || [];
        BUS.emit('ui:showBuffSelection', { cards, mode: 'horde', wave: s.wave, rerollAvailable: !!(s.player.flags && s.player.flags.nextBuffReroll) });
        if (!global.CT_UI_BUFF) {
          const self = this;
          setTimeout(() => self._onBuffSelected({ defId: cards[0] && cards[0].id }), 100);
        }
      } catch (e) {
        console.warn('[horde] buff fallback', e);
        this._backToPrep();
      }
    },

    _onBuffSelected(evt) {
      const s = this.state; if (!s || !this.running) return;
      evt = evt || {};
      if (evt.defId) { try { BUFF.applySelection(s.player, evt.defId); } catch (_) {} }
      BUS.emit('ui:hideBuffSelection');
      this._backToPrep();
    },

    _backToPrep() {
      const s = this.state; if (!s || !this.running) return;
      const isBossNext = ((s.wave + 1) % 5 === 0);
      /* 无尽模式每波间隔统一 20 秒（BOSS 波前也保持 20 秒） */
      const prepSec = 20;
      const self = this;
      // 应用 pendingDiscount 到准备期商店
      try { if (SHOP && typeof SHOP.setDiscount === 'function') SHOP.setDiscount(s._pendingDiscount || 1.0); } catch (_) {}
      try {
        PREP.start({
          seconds: prepSec,
          mode: 'horde',
          players: [s.player],
          mapInfo: s.mapInfo,
          isBoss: isBossNext,
          onCombatStart: () => self._nextWave()
        });
      } catch (e) { console.error('[horde] prep restart', e); }
    },

    _onTankDead(evt) {
      const s = this.state; if (!s || !this.running) return;
      const dead = evt && evt.dead; if (!dead) return;
      if (dead.type === 'player') {
        // 复活判断
        if (s.player.revives > 0) {
          s.player.revives -= 1;
          // 原地满血复活（简化）
          setTimeout(() => {
            if (!this.running || !this.state) return;
            s.player.alive = true;
            s.player.hp = s.player.maxHp;
            s.player.pos.x = s.player.spawnPos.x;
            s.player.pos.y = s.player.spawnPos.y;
            if (s.player.setInvincible) s.player.setInvincible(3);
            BUS.emit('player:revived', { target: s.player, remains: s.player.revives });
          }, 800);
          this._waveDeaths += 1;
          return;
        }
        // 0 复活 → 失败
        this._gameOver(false);
        return;
      }
      // 非玩家死亡 → 击杀计分
      s.kills += 1;
      s.score += 50 * (dead.rank === 'elite' ? 3 : (dead.rank === 'boss' ? 20 : 1));
      if (dead.rank === 'boss' || dead._isBossFallback) {
        BUS.emit('achievement:unlock', { id: 'boss_slayer', bossName: dead.name || 'BOSS', wave: s.wave });
      }
    },

    _onSpawnEnemy(evt) {
      const s = this.state; if (!s) return;
      evt = evt || {};
      const enemy = evt.enemy; if (!enemy) return;
      if (evt.rank === 'boss') enemy.rank = 'boss';
      enemy._ownerRef = enemy;
      s.tanks.push(enemy);
    },

    _gameOver(victory) {
      const s = this.state; if (!s || !this.running) return;
      this.running = false;
      s.phase = victory ? 'VICTORY' : 'GAMEOVER';
      try { if (ENG && typeof ENG.setState === 'function') ENG.setState('GAMEOVER'); } catch (_) {}
      /* 战况横幅（胜利/战败） */
      try {
        global.CT_WAVE_BANNER && global.CT_WAVE_BANNER.show(
          victory ? '🏆 作战胜利' : '💀 作战失败',
          'WAVE ' + s.wave + ' · SCORE ' + s.score,
          2400
        );
      } catch (_) {}
      // 最后一次存档
      try {
        if (STORAGE && typeof STORAGE.updateRecord === 'function') {
          const best = Math.max(s.bestWave, s.wave);
          const hs = Math.max(s.highScore, s.score);
          STORAGE.updateRecord('horde', { bestWave: best, highScore: hs });
          s.bestWave = best; s.highScore = hs;
        }
      } catch (_) {}
      const payload = {
        victory: !!victory,
        mode: 'horde',
        wave: s.wave,
        noDeathStreak: s.noDeathStreak,
        bestWave: s.bestWave,
        highScore: s.highScore,
        score: s.score, kills: s.kills, coins: s.coins,
        /* result.js 结算面板从 stats.* 读取统计数据 */
        stats: {
          score: s.score, kills: s.kills,
          surviveTime: s.time || 0,
          maxCombo: s.maxCombo || 0,
          /* 完成度：以 30 波为满程参照，生存越久完成度越高 */
          progress: Math.min(1, (s.wave || 1) / 30),
          deaths: (victory ? 0 : (s.player.revives > 0 ? 0 : 1))
        },
        rewardsCoins: 0
      };
      try {
        if (UI_RES && typeof UI_RES.show === 'function') UI_RES.show(payload);
        else console.log('[MODE HORDE] result', payload);
      } catch (e) { console.log('[MODE HORDE] result', payload); }
      BUS.emit('mode:finished', payload);
    },

    _gcBullets() {
      const s = this.state; if (!s || !Array.isArray(s.bullets)) return;
      const kept = [];
      for (let i = 0; i < s.bullets.length; i++) {
        const b = s.bullets[i];
        if (!b || b.alive) { if (b) kept.push(b); continue; }
        try { BUL_NS.Pool.release(b); } catch (_) {}
      }
      s.bullets = kept;
    },

    _cleanupDeadEntities() {
      const s = this.state; if (!s) return;
      s.tanks = s.tanks.filter(t => t && (t.alive || t.type === 'player'));
      s.obstacles = s.obstacles.filter(o => o && o.alive !== false);
      s.powerups = s.powerups.filter(p => p && p.alive !== false);
    },

    /* ========== 技能随机掉落 ==========
     * 无尽模式原本只有波次奖励的「三选一」增益，地图上不会自然掉落道具。
     * 这里补上周期性随机掉落，让对局中随时能抢到增益。 */
    _spawnBuffPowerup(s) {
      if (!s || !this.running || !PW_NS) return;
      const BUFF_IDS = ['P01', 'P02', 'P03', 'P04', 'P05', 'P06', 'P09', 'P15'];
      const id = BUFF_IDS[(Math.random() * BUFF_IDS.length) | 0];
      const OB_TOOL = global.CT_OBSTACLE;
      /* 用本局真实世界尺寸（模块级 MAP_W/MAP_H 是加载期兜底值，地图放大后会失真） */
      const W = (s.mapInfo && s.mapInfo.w) || MAP_W;
      const H = (s.mapInfo && s.mapInfo.h) || MAP_H;
      let sp = null;
      for (let tries = 0; tries < 14; tries++) {
        const x = 120 + Math.random() * (W - 240);
        const y = 120 + Math.random() * (H - 240);
        if (OB_TOOL && typeof OB_TOOL.findSafeSpawn === 'function') {
          sp = OB_TOOL.findSafeSpawn(s.obstacles, W, H, x, y, 80);
        } else { sp = { x, y }; }
        if (sp) break;
      }
      if (!sp) sp = { x: W * 0.5, y: H * 0.5 };
      try {
        const p = PW_NS.spawn(sp.x, sp.y, id);
        if (p) { s.powerups.push(p); BUS.emit('powerup:spawned', { powerup: p, id: id }); }
      } catch (_) {}
    },

    _bindAll() {
      const self = this;
      const binds = [
        /* prep:combatStart 不再绑 BUS：PREP.start 已传 onCombatStart 回调，
         * 双重触发会让 _nextWave 执行两次 → 波次号 2/4/6 跳跃、奇数波出怪计划被覆盖 */
        ['wave:cleared',     (e)=> { try { self._onWaveCleared(e); } catch(e){console.error(e);} }],
        ['ui:buffSelected',  (e)=> { try { self._onBuffSelected(e); } catch(e){console.error(e);} }],
        ['tank:dead',        (e)=> { try { self._onTankDead(e); } catch(e){console.error(e);} }],
        ['wave:spawnEnemy',  (e)=> { try { self._onSpawnEnemy(e); } catch(e){console.error(e);} }]
      ];
      this._bindings = [];
      for (let i = 0; i < binds.length; i++) {
        BUS.on(binds[i][0], binds[i][1]);
        this._bindings.push({ e: binds[i][0], fn: binds[i][1] });
      }
    }
  };

  global.CT_MODE_HORDE = CT_MODE_HORDE;
})(typeof window !== 'undefined' ? window : globalThis);

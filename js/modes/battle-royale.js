/* ==========================================================
 * CYBERTANK · Battle Royale Mode — 大逃杀（精简跑通版）
 * 命名空间: window.CT_MODE_BR
 * ========================================================== */
(function (global) {
  'use strict';

  const BUS    = global.CT_BUS        || { on(){}, off(){}, emit(){} };
  const ENG    = global.CT_ENGINE     || {};
  const RENDER = global.CT_RENDERER   || { camera:{}, world:{w:2560,h:2560} };
  const PHYS   = global.CT_PHYSICS    || { aabb(){return false;}, resolveCollision(){} };
  const PREP   = global.CT_PREP       || { start(){}, cancel(){} };
  const BUFF   = global.CT_BUFF       || { generateThreeCards:()=>[], applySelection:()=>({ok:false}), tickTimers(){} };
  const SHOP   = global.CT_SHOP       || { refreshStock(){}, unlock(){}, lock(){}, setDiscount(){} };
  const TANK_NS= global.CT_TANK       || {};
  const OB_NS  = global.CT_OBSTACLE   || {};
  const BUL_NS = global.CT_BULLET     || { spawn(){return null;}, Pool:{ acquire:()=>({alive:false}), release(){} } };
  const ENEMY_NS=global.CT_ENEMY      || {};
  const UI_SHOP= global.CT_UI_SHOP    || null;
  const UI_RES = global.CT_UI_RESULT  || null;
  const PW_NS  = global.CT_POWERUP    || null;
  const INPUT  = global.CT_INPUT      || { isDown:()=>false, keys:new Set() };

  const TankCtor  = TANK_NS.Tank || function (o){ o=o||{}; this.pos={x:o.x||0,y:o.y||0}; this.spawnPos={...this.pos}; this.hp=o.maxHp||3; this.maxHp=this.hp; this.alive=true; this._w=56;this._h=56; this.aabb={x:this.pos.x-28,y:this.pos.y-28,w:56,h:56}; this.muls={dmg:1,fireRate:1,speed:1,dr:0,pierce:0,splash:0,coinGain:1}; this.flags={}; this.tempBuffs=[]; this.type=o.type||'player'; this.shield=0; this.rank = o.rank || 'normal'; this.name = o.name || ('AI_'+Math.floor(Math.random()*1000)); };
  const EnemyCtor = (ENEMY_NS && ENEMY_NS.EnemyAI) || TankCtor;
  const WallBrick = OB_NS.WallBrick || function (o){ return {alive:true,blockTank:true,blockBullet:true,_box:{x:o.x,y:o.y,w:o.w||64,h:o.h||64}, get aabb(){return this._box;}, update(){}, render(){} }; };
  const WallSteel = OB_NS.WallSteel || function (o){ return {alive:true,blockTank:true,blockBullet:true,_box:{x:o.x,y:o.y,w:o.w||64,h:o.h||64}, get aabb(){return this._box;}, update(){}, render(){} }; };
  /* 新地形：草丛(隐身) / 水(挡车不挡弹) / 冰(打滑) / 泥(减速) */
  const Bush  = OB_NS.Bush  || null;
  const Water = OB_NS.Water || null;
  const Ice   = OB_NS.Ice   || null;
  const Mud   = OB_NS.Mud   || null;

  /* 大逃杀地图已扩大：2560 → 3072（48×48 格），布局与缩圈半径同步按比例放大 */
  const MAP_W = 3072, MAP_H = 3072, TILE = 64;
  const BULLET_GC_SEC = 5;
  const SHRINK_INTERVAL = 30;
  const SHRINK_TRANSITION = 3;
  const PUP_FIRST = 10;          // 首颗增益道具掉落延迟
  const PUP_INTERVAL = 18;       // 之后每 18s 一颗（技能随机掉落）

  /* 在 (c,r) 起放一块 w×h 的地形（跳过已占用格） */
  function paintPatch(obstacles, occupied, c, r, w, h, Ctor, type) {
    const cols = MAP_W / TILE, rows = MAP_H / TILE;
    if (!Ctor) return;
    for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) {
      const cc = c + dx, rr = r + dy;
      if (cc < 2 || cc >= cols - 2 || rr < 2 || rr >= rows - 2) continue;
      const key = cc + ',' + rr;
      if (occupied.has(key)) continue;
      occupied.add(key);
      obstacles.push(new Ctor({ x: cc * TILE, y: rr * TILE, w: TILE, h: TILE }));
    }
  }

  function createBRMap() {
    const obstacles = [];
    const cols = MAP_W / TILE, rows = MAP_H / TILE;
    const occupied = new Set();
    // 四角+顶底要塞：砖房块
    const fortPts = [[2,2],[cols-5,2],[2,rows-5],[cols-5,rows-5],[cols/2-2,2],[cols/2-2,rows-5]];
    for (let p = 0; p < fortPts.length; p++) {
      const [fc, fr] = fortPts[p];
      for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) {
        if (r === 1 && c === 1) continue;
        occupied.add((fc+c) + ',' + (fr+r));
        obstacles.push(new WallBrick({ x: (fc+c)*TILE, y: (fr+r)*TILE, w: TILE, h: TILE }));
      }
    }
    /* 地图装饰：用钢块拼出 "ccr"（5×5 点阵、scale=1 ≈ 1088×320px，不至于过大）。
     * 刻意放在随机散布与分区撒点「之前」并登记 occupied，
     * 这样后续随机地形不会盖住笔画，字形才能认得出来。
     * 位置 (8,8) 避开四角要塞与中心安全区。 */
    try {
      const G = (OB_NS && OB_NS.GLYPHS_5x5) || null;
      const DECOR = 'ccr', GAP = 1, DC = 8, DR = 8;
      if (G) {
        for (let i = 0; i < DECOR.length; i++) {
          const g = G[DECOR[i]]; if (!g) continue;
          for (let gr = 0; gr < 5; gr++) {
            for (let gc = 0; gc < 5; gc++) {
              if (g[gr][gc] !== '#') continue;
              const c = DC + i * (5 + GAP) + gc, r = DR + gr;
              occupied.add(c + ',' + r);
              obstacles.push(new WallSteel({ x: c * TILE, y: r * TILE, w: TILE, h: TILE }));
            }
          }
        }
      }
    } catch (_) {}

    // 随机散布砖墙 40 块（补充覆盖，中心稀疏）
    for (let i = 0; i < 40; i++) {
      const c = 3 + Math.floor(Math.random() * (cols - 6));
      const r = 3 + Math.floor(Math.random() * (rows - 6));
      const cx = c - cols / 2, cy = r - rows / 2;
      if (cx * cx + cy * cy < (cols * 0.1) ** 2) continue;
      const key = c + ',' + r;
      if (occupied.has(key)) continue;
      occupied.add(key);
      obstacles.push(new WallBrick({ x: c * TILE, y: r * TILE, w: TILE, h: TILE }));
    }
    /* 分区均匀撒点：地图分 5×5 大区（每区 8×8 格），每区必放一组地形
     * 保证全图各部位都有障碍，无大面积空白 */
    const ZONES = 5;
    const zw = Math.floor(cols / ZONES), zh = Math.floor(rows / ZONES);
    const patchTypes = [
      { Ctor: WallSteel, w: 2, h: 2 },
      { Ctor: Bush,  w: 3, h: 2 },
      { Ctor: Water, w: 3, h: 2 },
      { Ctor: Ice,   w: 3, h: 3 },
      { Ctor: Mud,   w: 2, h: 2 }
    ];
    for (let zr = 0; zr < ZONES; zr++) {
      for (let zc = 0; zc < ZONES; zc++) {
        /* 中心区（2,2）跳过：保留中心安全区 */
        if (zr === 2 && zc === 2) continue;
        const pl = patchTypes[(zr * ZONES + zc) % patchTypes.length];
        /* 区内随机偏移（留 2 格边距防贴墙） */
        const c = zc * zw + 2 + Math.floor(Math.random() * Math.max(1, zw - 3 - pl.w));
        const r = zr * zh + 2 + Math.floor(Math.random() * Math.max(1, zh - 3 - pl.h));
        paintPatch(obstacles, occupied, c, r, pl.w, pl.h, pl.Ctor);
      }
    }
    return { obstacles, w: MAP_W, h: MAP_H, tile: TILE };
  }

  function randomSafeSpawnPoint(used, minDist, obstacles) {
    minDist = minDist || 200;
    const OB = global.CT_OBSTACLE;
    for (let tries = 0; tries < 40; tries++) {
      let x = 150 + Math.random() * (MAP_W - 300);
      let y = 150 + Math.random() * (MAP_H - 300);
      let ok = true;
      for (let i = 0; i < used.length; i++) {
        const dx = x - used[i].x, dy = y - used[i].y;
        if (dx * dx + dy * dy < minDist * minDist) { ok = false; break; }
      }
      if (!ok) continue;
      /* 防围死：洪水填充检测，落在被方块围住的区域则重试 */
      if (OB && typeof OB.findSafeSpawn === 'function' && obstacles && obstacles.length) {
        const safe = OB.findSafeSpawn(obstacles, MAP_W, MAP_H, x, y, 300);
        x = safe.x; y = safe.y;
      }
      used.push({ x, y }); return { x, y };
    }
    const p = { x: 200 + Math.random() * (MAP_W - 400), y: 200 + Math.random() * (MAP_H - 400) };
    used.push(p); return p;
  }

  const CT_MODE_BR = {
    running: false,
    _bindings: [],
    _gcTimer: 0,
    _tickFn: null,
    state: null,
    _shopLockTimer: 0, // 商店打开时锁定玩家秒数

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
        this._shopLockTimer = 0;

        const tankClass = options.tankClass || 'assault';
        const skin = options.skin || '#ffe066';

        const mapInfo = createBRMap();
        const used = [];
        const sp = randomSafeSpawnPoint(used, 260, mapInfo.obstacles);
        const player = new TankCtor({
          x: sp.x, y: sp.y, type: 'player', tankClass, color: skin, name: 'P1'
        });
        player.coins = 100;

        // 玩家先入场；20 辆 AI 由 tick 以「游戏时间」驱动生成（见 _spawnAI / tick 中的 spawnDelay），
        // 不再用 wall-clock setTimeout：切后台 / 重开时 setTimeout 可能被吞或错位，导致「AI 有时不生成」。
        const tanks = [player];

        // 6 个商店终端：四角 + 中轴 2 个
        const term = [
          { x: 200, y: 200, w: 80, h: 80, cool: 0 },
          { x: MAP_W - 280, y: 200, w: 80, h: 80, cool: 0 },
          { x: 200, y: MAP_H - 280, w: 80, h: 80, cool: 0 },
          { x: MAP_W - 280, y: MAP_H - 280, w: 80, h: 80, cool: 0 },
          { x: MAP_W / 2 - 40, y: 300, w: 80, h: 80, cool: 0 },
          { x: MAP_W / 2 - 40, y: MAP_H - 380, w: 80, h: 80, cool: 0 },
        ];

        // 安全圈：圈心固定地图中心，初始半径覆盖全图 → 开局任何出生点都在圈内，
        // 杜绝「玩家出生点恰好在圈外、每帧被扣 1 HP 却不知原因」的异常掉血。
        const ZONE_R0 = Math.hypot(MAP_W, MAP_H) / 2 + 120;
        const zc = { x: MAP_W / 2, y: MAP_H / 2 };
        this.state = {
          mode: 'br',
          phase: 'COMBAT',
          aliveCount: tanks.length,
          zone: {
            /* 初始半径覆盖整张地图（含四角），随后按 0.8 倍逐级收缩 */
            x: zc.x, y: zc.y, radius: ZONE_R0,
            nextRadius: ZONE_R0, targetRadius: ZONE_R0,
            shrinkTime: SHRINK_INTERVAL, transitionT: 0,
            startRadius: ZONE_R0,
            shrinks: 0          // 已完成的缩圈次数（D-10：用于递增圈外掉血）
          },
          shopTerminals: term,
          kills: 0,
          player, tanks,
          totalPlayers: 21,
          /* 其余模式统一：开局 5 秒宽限期，期间不生成 AI、不触发胜负判定 */
          graceT: 5,
          /* 游戏时间驱动的 AI 出兵：spawnDelay 倒计时归零后由 _spawnAI 一次性生成 20 辆 */
          spawnDelay: 5,
          aiSpawned: false,
          _used: used,
          surviveTime: 0,
          obstacles: mapInfo.obstacles, bullets: [], powerups: [],
          pupTimer: PUP_FIRST,
          pupInterval: PUP_INTERVAL,
          mapInfo: { ...mapInfo, centerX: MAP_W/2, centerY: MAP_H/2 },
          score: 0, coins: player.coins || 0
        };
        ENG.gameState = this.state;
        // BR 地图 2560×2560，同步 world 尺寸后切全图视野
        try { if (RENDER.world) { RENDER.world.w = MAP_W; RENDER.world.h = MAP_H; RENDER.world.tile = TILE; } } catch (_) {}
        try { RENDER.fitWorldToView(); } catch (_) { try { RENDER.camera.target = player; } catch (_) {} }

        this._bindAll();

        if (ENG && typeof ENG.setState === 'function') ENG.setState('COMBAT');
        if (ENG && typeof ENG.registerUpdate === 'function') {
          const self = this;
          this._tickFn = function (dtMs) { self.tick(dtMs); };
          ENG.registerUpdate(this._tickFn, 50);
        }
        BUS.emit('mode:started', { mode: 'battle-royale', state: this.state });
        console.log('[MODE BR] started, alive=' + this.state.aliveCount);
      } catch (e) { console.error('[MODE BR] start:', e); }
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
      } catch (e) { console.error('[MODE BR] stop:', e); }
    },

    tick(dtMs) {
      if (!this.running || !this.state) return;
      const dt = dtMs / 1000;
      const s = this.state;

      // 商店锁定倒计时
      if (this._shopLockTimer > 0) {
        this._shopLockTimer -= dt;
        if (this._shopLockTimer <= 0) {
          this._shopLockTimer = 0;
          if (s.player.flags) s.player.flags.shopLocked = false;
        }
      }

      // 缩圈
      this._tickZone(dt);
      /* 开局 5 秒宽限期倒计时 */
      if ((s.graceT || 0) > 0) s.graceT = Math.max(0, s.graceT - dt);
      /* 游戏时间驱动 AI 出兵：替代原 wall-clock setTimeout，切后台/重开都不会漏生成 */
      if (!s.aiSpawned) {
        s.spawnDelay = (s.spawnDelay == null ? 5 : s.spawnDelay) - dt;
        if (s.spawnDelay <= 0) this._spawnAI(s);
      }
      /* 存活时长累计（用于结算与评级完成度） */
      if (s.phase === 'COMBAT') s.surviveTime = (s.surviveTime || 0) + dt;

      // 圈外扣血（每秒 1 HP，累加器）
      this._damageOutsideZone(dt);

      // tanks update
      // 分派：玩家用 CT_INPUT 快照输入；敌人走 EnemyAI.update(dt, obstacles, playerTanks)
      const playerTanks = [];
      for (let i = 0; i < s.tanks.length; i++) {
        const pt = s.tanks[i];
        if (pt && pt.alive && pt.type === 'player') playerTanks.push(pt);
      }
      for (let i = 0; i < s.tanks.length; i++) {
        const t = s.tanks[i]; if (!t || !t.alive) continue;
        // 商店锁定：玩家不能移动
        if (t.type === 'player' && this._shopLockTimer > 0) { /* skip update */ }
        else {
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
      }
      for (let i = 0; i < s.obstacles.length; i++) {
        const o = s.obstacles[i]; if (!o) continue;
        try { if (typeof o.update === 'function') o.update(dt); } catch (_) {}
      }
      /* ---- 增益道具：更新 + 随机掉落 ----
       * 大逃杀原本完全没有道具掉落（s.powerups 恒为空，连 update 都没有），
       * 这里补上周期性随机掉落，拾取判定见 _collisionTick。 */
      for (let i = 0; i < s.powerups.length; i++) {
        const p = s.powerups[i]; if (!p || p.alive === false) continue;
        try { if (typeof p.update === 'function') p.update(dt, s.obstacles, s.tanks); } catch (_) {}
      }
      if (s.phase === 'COMBAT') {
        s.pupTimer = (s.pupTimer == null ? PUP_FIRST : s.pupTimer) - dt;
        if (s.pupTimer <= 0) { this._spawnBuffPowerup(s); s.pupTimer = s.pupInterval || PUP_INTERVAL; }
      }
      for (let i = 0; i < s.bullets.length; i++) {
        const b = s.bullets[i]; if (!b || !b.alive) continue;
        try {
          if (typeof b.update === 'function') b.update(dt, s);
          else {
            b.pos.x += (b.vel.x || 0) * dt * 60;
            b.pos.y += (b.vel.y || 0) * dt * 60;
            if (b.pos.x < 0 || b.pos.x > MAP_W || b.pos.y < 0 || b.pos.y > MAP_H) b.alive = false;
          }
        } catch (_) {}
      }

      this._collisionTick(dt);
      this._tickTerminalInteract(dt);

      this._gcTimer += dt;
      if (this._gcTimer >= BULLET_GC_SEC) { this._gcTimer = 0; this._gcBullets(); }

      this._cleanupDeadEntities();

      // 结束判定（宽限期内不触发；且必须等 AI 已生成，避免「AI 漏生成 → 只剩玩家 → 误判胜利」）
      /* 兜底：宽限结束却仍无 AI（极端异常），先补生成，再统计存活数，
       * 否则会用「补生成前」的 stale aliveCount=1 误判胜利 */
      if ((s.graceT || 0) <= 0 && !s.aiSpawned) this._spawnAI(s);
      const alive = s.tanks.filter(t => t && t.alive);
      s.aliveCount = alive.length;
      if ((s.graceT || 0) <= 0 && s.aiSpawned && s.aliveCount <= 1) {
        const playerAlive = s.player.alive && s.player.hp > 0;
        this._gameOver(playerAlive);
      }

      // F 键：若在终端附近且 cool<=0
      if (this._nearTerminal && (INPUT.isDown && INPUT.isDown('f')) || (INPUT.keys && INPUT.keys.has('f'))) {
        this._openShop(this._nearTerminal);
      }
    },

    /* 一次性生成全部 AI 坦克（游戏时间驱动，稳定可靠）。
     * 此前用 wall-clock setTimeout(5000) 在切后台/重开时会被吞或错位，导致「AI 有时不生成」；
     * 现改为由 tick 的 spawnDelay 倒计时触发，只要 running 且 state 在，必执行。 */
    _spawnAI(st) {
      if (!st || st.aiSpawned) return;
      const colors = ['#ff4d6d', '#00e5ff', '#7cff6b', '#ffd166', '#ff9f1c', '#c77dff', '#90e0ef'];
      let spawned = 0;
      for (let i = 0; i < 20; i++) {
        let aiSp = null;
        try { aiSp = randomSafeSpawnPoint(st._used || [], 180, st.obstacles); } catch (_) { aiSp = { x: MAP_W / 2, y: MAP_H / 2 }; }
        const rank = i < 3 ? 'elite' : (i < 8 ? 'fast' : 'normal');
        let ai = null;
        try { ai = new EnemyCtor({ x: aiSp.x, y: aiSp.y, rank, wave: 5, type: 'enemy' }); } catch (_) { ai = null; }
        /* 构造器可能返回 falsy（某些 EnemyAI 校验失败）→ 退回基础 Tank，绝不放空 */
        if (!ai) ai = new TankCtor({ x: aiSp.x, y: aiSp.y, type: 'enemy' });
        ai.color = colors[i % colors.length];
        ai.rank = rank;
        if (ai.type !== 'enemy') ai.type = 'enemy';
        st.tanks.push(ai);
        spawned++;
      }
      st.aiSpawned = true;
      BUS.emit('br:aiSpawned', { count: spawned });
    },

    _tickZone(dt) {
      const s = this.state; if (!s) return;
      const z = s.zone;
      z.shrinkTime -= dt;
      if (z.shrinkTime <= 0) {
        // 开始下一轮缩圈过渡
        z.startRadius = z.radius;
        z.targetRadius = z.radius * 0.8;
        if (z.targetRadius < 80) z.targetRadius = 80;
        z.transitionT = SHRINK_TRANSITION;
        z.shrinks = (z.shrinks || 0) + 1;   // 完成一次缩圈（D-10）
        z.shrinkTime = SHRINK_INTERVAL;
        BUS.emit('br:zoneStartShrink', { from: z.startRadius, to: z.targetRadius });
      }
      if (z.transitionT > 0) {
        const total = SHRINK_TRANSITION;
        const remain = z.transitionT;
        const t = 1 - remain / total;
        z.radius = z.startRadius + (z.targetRadius - z.startRadius) * t;
        z.transitionT -= dt;
        if (z.transitionT <= 0) { z.radius = z.targetRadius; z.transitionT = 0; }
      }
    },

    _damageOutsideZone(dt) {
      const s = this.state; if (!s) return;
      /* 宽限期内为安全期，圈外不掉血（否则开局玩家可能因出生点偏角而被圈外扣血，表现为「无故掉血」） */
      if ((s.graceT || 0) > 0) return;
      const z = s.zone;
      // 毒圈越收缩，圈外掉血越快（D-10）：基础 1/s，每完成一次缩圈 +0.5/s，封顶 6/s
      const zoneDmgRate = Math.min(6, 1 + (z.shrinks || 0) * 0.5);
      const tanks = s.tanks;
      for (let i = 0; i < tanks.length; i++) {
        const t = tanks[i]; if (!t || !t.alive) continue;
        const dx = (t.pos.x) - z.x, dy = (t.pos.y) - z.y;
        if (dx * dx + dy * dy > z.radius * z.radius) {
          // per-tank 累加器，按当前缩圈速率扣血，避免多坦克共用一个累加器使掉血速率随人数错乱
          t._zoneAcc = (t._zoneAcc || 0) + dt * zoneDmgRate;
          while (t._zoneAcc >= 1) {
            t._zoneAcc -= 1;
            if (t.takeDamage) try { t.takeDamage(zoneDmgRate); } catch (_) { t.hp -= zoneDmgRate; }
            else t.hp -= zoneDmgRate;
            BUS.emit('br:zoneDamage', { target: t });
            if (t.hp <= 0 && t.alive) {
              t.alive = false;
              BUS.emit('tank:dead', { dead: t, killer: 'zone', rank: t.rank });
            }
          }
        } else {
          t._zoneAcc = 0; // 回到圈内清零，避免残留累加在下次出圈时一次性扣除
        }
      }
    },

    _nearTerminal: null,
    /* 商店系统仅无尽模式（horde）开放：大逃杀商店终端与交互全部禁用 */
    _tickTerminalInteract() {
      this._nearTerminal = null;
    },

    _openShop() {
      // no-op：商店仅无尽模式
    },

    _collisionTick(dt) {
      const s = this.state; if (!s) return;
      const tanks = s.tanks, bullets = s.bullets, obstacles = s.obstacles;
      for (let i = 0; i < tanks.length; i++) {
        const t = tanks[i]; if (!t || !t.alive) continue;
        const ab = t.aabb; if (!ab) continue;
        for (let j = 0; j < obstacles.length; j++) {
          const o = obstacles[j]; if (!o || !o.alive || !o.blockTank) continue;
          const ob = o.aabb || o._box; if (!ob) continue;
          if (PHYS.aabb(ab, ob)) try { PHYS.resolveCollision(t, o); } catch (_) {}
        }
      }
      for (let i = 0; i < tanks.length; i++) {
        const a = tanks[i]; if (!a || !a.alive) continue;
        for (let j = i + 1; j < tanks.length; j++) {
          const b = tanks[j]; if (!b || !b.alive) continue;
          try { PHYS.resolveCollision(a, b); } catch (_) {}
        }
      }
      for (let i = 0; i < bullets.length; i++) {
        const b = bullets[i]; if (!b || !b.alive) continue;
        const bb = { x: (b.pos.x - (b.radius || 4)), y: (b.pos.y - (b.radius || 4)), w: (b.radius || 4) * 2, h: (b.radius || 4) * 2 };
        for (let j = 0; j < obstacles.length; j++) {
          const o = obstacles[j]; if (!o || !o.alive || !o.blockBullet) continue;
          const ob = o.aabb || o._box; if (!ob) continue;
          if (PHYS.aabb(bb, ob)) {
            if (b.bounces && b.bounces > 0) { b.bounces -= 1;
              const overlapX = Math.min(bb.x + bb.w - ob.x, ob.x + ob.w - bb.x);
              const overlapY = Math.min(bb.y + bb.h - ob.y, ob.y + ob.h - bb.y);
              if (overlapX < overlapY) b.vel.x = -(b.vel.x || 0); else b.vel.y = -(b.vel.y || 0);
            } else b.alive = false;
            if (o.type === 'brick' || (o.hp != null && o.hp !== Infinity)) {
              o.hp = (o.hp - (b.damage || 1)) | 0;
              if (o.hp <= 0) o.alive = false;
            }
            if (!b.alive) break;
          }
        }
      }
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
            if (t.takeDamage) try { t.takeDamage(dmg); } catch (_) { t.hp -= dmg; } else t.hp -= dmg;
            BUS.emit('tank:hit', { target: t, dmg, bullet: b, attacker: b.owner });
            if (b._hitSet) b._hitSet.add(t);
            if (b.pierce && b.pierce > 0) b.pierce -= 1; else b.alive = false;
            if (t.hp <= 0 && t.alive) {
              t.alive = false;
              BUS.emit('tank:dead', { dead: t, killer: b.owner, rank: t.rank });
            }
            if (!b.alive) break;
          }
        }
      }
      for (let i = 0; i < tanks.length; i++) {
        const t = tanks[i]; if (!t || !t.alive || t.type !== 'player') continue;
        const tb = t.aabb; if (!tb) continue;
        for (let j = 0; j < s.powerups.length; j++) {
          const p = s.powerups[j]; if (!p || !p.alive) continue;
          const pb = p.aabb || p._box; if (!pb) continue;
          if (PHYS.aabb(tb, pb)) { try { if (typeof p.apply === 'function') p.apply(t); } catch (_) {} p.alive = false; BUS.emit('powerup:pickup', { target: t, powerup: p }); }
        }
      }
    },

    _onTankDead(evt) {
      const s = this.state; if (!s || !this.running) return;
      const dead = evt && evt.dead; if (!dead) return;
      if (dead.type !== 'player') {
        s.kills += 1;
        s.score += (dead.rank === 'elite' ? 150 : (dead.rank === 'fast' ? 80 : 50));
        // 金币
        const cg = dead.rank === 'elite' ? 80 : (dead.rank === 'fast' ? 40 : 20);
        s.player.coins = (s.player.coins || 0) + cg;
        s.coins += cg;
        // 精英击杀 → 额外金币（增益仅无尽模式，大逃杀不再弹三选一）
        if (dead.rank === 'elite') {
          const bonus = 40;
          s.player.coins = (s.player.coins || 0) + bonus;
          s.coins += bonus;
        }
      } else {
        // 玩家阵亡
        setTimeout(() => {
          if (!this.state) return;
          const aliveNow = this.state.tanks.filter(t => t && t.alive).length;
          const rank = this.state.tanks.length - aliveNow + 1;
          this._gameOver(false, rank);
        }, 500);
      }
    },

    _eliteBuffShown: false,
    _showEliteBuff() {
      const s = this.state; if (!s || this._eliteBuffShown) return;
      this._eliteBuffShown = true;
      const self = this;
      setTimeout(() => { self._eliteBuffShown = false; }, 2000); // 冷却 2s 防抖
      try {
        const cards = BUFF.generateThreeCards(s.player, {}) || [];
        const pick = cards.slice(0, 2); // 2 选 1 精简
        BUS.emit('ui:showBuffSelection', { cards: pick, mode: 'battle-royale', eliteKill: true });
        if (!global.CT_UI_BUFF) {
          setTimeout(() => self._onBuffSelected({ defId: pick[0] && pick[0].id }), 100);
        }
      } catch (_) {}
    },

    _onBuffSelected(evt) {
      const s = this.state; if (!s || !this.running) return;
      evt = evt || {};
      if (evt.defId) try { BUFF.applySelection(s.player, evt.defId); } catch (_) {}
      BUS.emit('ui:hideBuffSelection');
    },

    _onSpawnEnemy(evt) {
      const s = this.state; if (!s) return;
      evt = evt || {}; const enemy = evt.enemy; if (!enemy) return;
      enemy._ownerRef = enemy;
      s.tanks.push(enemy);
    },

    _gameOver(victory, rank) {
      const s = this.state; if (!s || !this.running) return;
      this.running = false;
      s.phase = victory ? 'VICTORY' : 'GAMEOVER';
      try { if (ENG && typeof ENG.setState === 'function') ENG.setState('GAMEOVER'); } catch (_) {}
      const finalRank = rank || (s.tanks.length - s.aliveCount + 1);
      const totalP = s.totalPlayers || s.tanks.length || 1;
      const payload = {
        victory: !!victory, mode: 'battle-royale',
        rank: finalRank, kills: s.kills, score: s.score, coins: s.coins,
        stats: {
          score: s.score, kills: s.kills,
          surviveTime: s.surviveTime || 0,
          /* 完成度：按最终排名换算（第 1 名=满，倒数第 1 名≈0） */
          progress: victory ? 1 : Math.max(0, Math.min(1, (totalP - finalRank) / Math.max(1, totalP - 1))),
          deaths: victory ? 0 : 1,
          maxCombo: 0
        }
      };
      try {
        if (UI_RES && typeof UI_RES.show === 'function') UI_RES.show(payload);
        else console.log('[MODE BR] result', payload);
      } catch (_) { console.log('[MODE BR] result', payload); }
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
     * 安全区内随机安全点刷一颗增益道具（圈外刷了也拿不到，故优先取圈内点）。 */
    _spawnBuffPowerup(s) {
      if (!s || !this.running || !PW_NS) return;
      const BUFF_IDS = ['P01', 'P02', 'P03', 'P04', 'P05', 'P06', 'P09', 'P15'];
      const id = BUFF_IDS[(Math.random() * BUFF_IDS.length) | 0];
      const OB_TOOL = global.CT_OBSTACLE;
      /* 毒圈收敛：优先在安全区内取点，取不到再退回全图 */
      const z = s.zone || null;
      const inZone = (x, y) => {
        if (!z) return true;
        const dx = x - (z.x != null ? z.x : MAP_W / 2);
        const dy = y - (z.y != null ? z.y : MAP_H / 2);
        return Math.sqrt(dx * dx + dy * dy) <= ((z.radius != null ? z.radius : MAP_W / 2) - 90);
      };
      let sp = null;
      for (let tries = 0; tries < 24; tries++) {
        let x, y;
        if (z && z.radius != null && z.radius > 260) {
          const a = Math.random() * Math.PI * 2;
          const rr = Math.sqrt(Math.random()) * (z.radius - 160);
          x = (z.x != null ? z.x : MAP_W / 2) + Math.cos(a) * rr;
          y = (z.y != null ? z.y : MAP_H / 2) + Math.sin(a) * rr;
        } else {
          x = 150 + Math.random() * (MAP_W - 300);
          y = 150 + Math.random() * (MAP_H - 300);
        }
        x = Math.max(80, Math.min(MAP_W - 80, x));
        y = Math.max(80, Math.min(MAP_H - 80, y));
        if (!inZone(x, y)) continue;
        if (OB_TOOL && typeof OB_TOOL.findSafeSpawn === 'function') {
          sp = OB_TOOL.findSafeSpawn(s.obstacles, MAP_W, MAP_H, x, y, 80);
        } else { sp = { x, y }; }
        if (sp) break;
      }
      if (!sp) sp = { x: MAP_W / 2, y: MAP_H / 2 };
      try {
        const p = PW_NS.spawn(sp.x, sp.y, id);
        if (p) { s.powerups.push(p); BUS.emit('powerup:spawned', { powerup: p, id: id }); }
      } catch (_) {}
    },

    _bindAll() {
      const self = this;
      const binds = [
        ['tank:dead',             (e)=> { try { self._onTankDead(e); } catch(e){console.error(e);} }],
        ['ui:buffSelected',       (e)=> { try { self._onBuffSelected(e); } catch(e){console.error(e);} }],
        ['wave:spawnEnemy',       (e)=> { try { self._onSpawnEnemy(e); } catch(e){console.error(e);} }]
      ];
      this._bindings = [];
      for (let i = 0; i < binds.length; i++) {
        BUS.on(binds[i][0], binds[i][1]);
        this._bindings.push({ e: binds[i][0], fn: binds[i][1] });
      }
    }
  };

  global.CT_MODE_BR = CT_MODE_BR;
})(typeof window !== 'undefined' ? window : globalThis);

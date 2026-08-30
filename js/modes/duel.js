/* ==========================================================
 * CYBERTANK · Duel Mode — 1v1 竞技（BO5）
 * 命名空间: window.CT_MODE_DUEL
 * 对称小型竞技场；P1 WASD+J/K / P2 ↑↓←→+Enter/RShift；
 * 子弹反弹 2 次；局间 15s 一次性商店；先取 3 局胜。
 * 默认 vs AI，若检测到 P2 按键则切换为本地双人。
 * ========================================================== */
(function (global) {
  'use strict';

  // ---------- 依赖安全兜底 ----------
  const BUS    = global.CT_BUS        || { on(){}, off(){}, emit(){} };
  const ENG    = global.CT_ENGINE     || {};
  const RENDER = global.CT_RENDERER   || { camera:{}, world:{w:1600,h:1600}, getCtx:()=>null };
  const PHYS   = global.CT_PHYSICS    || { aabb(){return false;}, resolveCollision(){} };
  const PREP   = global.CT_PREP       || { start(){}, cancel(){} };
  const BUFF   = global.CT_BUFF       || { generateThreeCards:()=>[], applySelection:()=>({ok:false}), tickTimers(){} };
  const SHOP   = global.CT_SHOP       || { refreshStock(){}, unlock(){}, lock(){}, setDiscount(){} };
  const STORAGE= global.CT_STORAGE    || { updateRecord(){}, getRecord:()=>({wins:0}) };
  const TANK_NS= global.CT_TANK       || {};
  const OB_NS  = global.CT_OBSTACLE   || {};
  const BUL_NS = global.CT_BULLET     || { spawn(){return null;}, Pool:{ acquire:()=>({alive:false}), release(){} } };
  const ENEMY_NS=global.CT_ENEMY      || {};
  const INPUT  = global.CT_INPUT      || { keys:new Set(), isDown:()=>false };
  const UI_RES = global.CT_UI_RESULT  || null;
  const PW_NS  = global.CT_POWERUP    || null;

  const TankCtor   = TANK_NS.Tank || function TankStub(o){ o=o||{}; this.pos={x:o.x||0,y:o.y||0}; this.spawnPos={...this.pos}; this.hp=o.maxHp||5; this.maxHp=this.hp; this.alive=true; this._w=56;this._h=56; this.aabb={x:this.pos.x-28,y:this.pos.y-28,w:56,h:56}; this.muls={dmg:1,fireRate:1,speed:1,dr:0,pierce:0,splash:0,coinGain:1}; this.flags={}; this.tempBuffs=[]; this.type=o.type||'player'; this.shield=0; this.coins=0; this.angle=0; this.turretAngle=0; this.skillCdNow=0; };
  const EnemyCtor  = (ENEMY_NS && ENEMY_NS.EnemyAI) || TankCtor;
  const WallBrick  = OB_NS.WallBrick || function (o){ return {alive:true,blockTank:true,blockBullet:true,type:'brick',hp:3,_box:{x:o.x,y:o.y,w:o.w||64,h:o.h||64}, get aabb(){return this._box;}, update(){}, render(){} }; };
  const WallSteel  = OB_NS.WallSteel || function (o){ return {alive:true,blockTank:true,blockBullet:true,type:'steel',hp:Infinity,_box:{x:o.x,y:o.y,w:o.w||64,h:o.h||64}, get aabb(){return this._box;}, update(){}, render(){} }; };
  /* 新地形：草丛(隐身) / 水(挡车不挡弹) / 冰(打滑) / 泥(减速) / 传送门(P↔Q 成对) */
  const Bush       = OB_NS.Bush   || null;
  const Water      = OB_NS.Water  || null;
  const Ice        = OB_NS.Ice    || null;
  const Mud        = OB_NS.Mud    || null;
  const Portal     = OB_NS.Portal || null;

  // ---------- 常量 ----------
  /* MAP_W / MAP_H 在下方由放大后的模板推导（地图扩大后不再写死 1280） */
  const BO5_TARGET = 3;          // 先取 3 局胜
  const ROUND_TIME = 90;         // 单局限时 90s
  const INTER_ROUND_SHOP = 15;   // 局间商店 15s
  const BULLET_GC_SEC = 5;
  const BOUNCE_TIMES = 2;        // 子弹反弹 2 次
  const PUP_FIRST = 6;           // 首颗增益道具掉落延迟
  const PUP_INTERVAL = 14;       // 之后每 14s 一颗（技能随机掉落）

  /* 对称竞技场模板（基础 20×20，加载期统一放大 2 倍 → 40×40，tile=64 → 2560×2560，从原点铺满世界）
   * 点对称（180° 旋转对称）保证 P1/P2 公平；网格化均匀布局：5 段 × 4 列
   * 符号：B砖 S钢 G草丛 W水 I冰 M泥 P/Q传送门（成对） */
  const _BASE_MAP = [
    '....................',
    'SS..BB..GG....BB..SS',
    'SS..B.B.G....B.B..SS',
    '....B.B.G....B.B....',
    'WW..BBB.GGG..BBB..WW',
    'WW................WW',
    '....II..MM...II.....',
    'GG..II..M.M..II...GG',
    '..P...............Q.',
    '....SS........SS....',
    '....SS........SS....',
    '..Q...............P.',
    'GG..II..M.M..II...GG',
    '....II..MM...II.....',
    'WW................WW',
    'WW..BBB.GGG..BBB..WW',
    '....B.B.G....B.B....',
    '..SS.B.BG...B.B.SS..',
    '..SS..BBGG..BB..SS..',
    '....................',
  ];
  /* 地图扩大：基础模板 ×2 → 40×40（tile=64 → 2560×2560），与大逃杀同尺度，布局密度不变。
   * 装饰：左上角用钢块拼出 "ccr"（5×5 点阵、scale=1 ≈ 1088×320px，不至于过大）；
   * 竞技场是点对称的，装饰放在左上角会破坏严格对称，但它用不可破坏钢块拼成、
   * 且远离双方出生点（0.25/0.75 对角），对公平性没有实质影响。 */
  const MAP_TEMPLATE = (function () {
    let t = _BASE_MAP;
    if (OB_NS && typeof OB_NS.enlargeTemplate === 'function') t = OB_NS.enlargeTemplate(t, 2);
    if (OB_NS && typeof OB_NS.stampText === 'function') {
      t = OB_NS.stampText(t, 'ccr', { row: 2, col: 2, ch: 'S', scale: 1, gap: 1, clear: true });
    }
    return t;
  })();
  /* 世界尺寸由放大后的模板推导，保证「地图铺满世界」且出生点/边界全部等比 */
  const MAP_W = MAP_TEMPLATE[0].length * 64;
  const MAP_H = MAP_TEMPLATE.length * 64;
  function createMapFromTemplate(template, tileSize) {
    tileSize = tileSize || 64;
    const cols = template[0].length;
    const rows = template.length;
    const totalW = cols * tileSize;
    const totalH = rows * tileSize;
    const offX = (MAP_W - totalW) / 2;
    const offY = (MAP_H - totalH) / 2;
    const obstacles = [];
    let portalSeq = 0;
    let lastPortal = null;
    for (let r = 0; r < rows; r++) {
      const row = template[r] || '';
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
          const p = new Portal({ id: 'duel_portal_' + portalSeq, pairId: null, x, y, w: tileSize, h: tileSize });
          if (lastPortal && !lastPortal.portalPairId) {
            /* 与上一个未配对的门双向配对 */
            lastPortal.portalPairId = p.portalId;
            p.portalPairId = lastPortal.portalId;
            lastPortal = null;
          } else {
            lastPortal = p;
          }
          obstacles.push(p);
        }
      }
    }
    return { obstacles, w: totalW, h: totalH, tile: tileSize, offX, offY };
  }

  /* ==========================================================
   * CT_MODE_DUEL 主对象
   * ========================================================== */
  const CT_MODE_DUEL = {
    running: false,
    _bindings: [],
    _gcTimer: 0,
    _tickFn: null,
    _renderFn: null,
    state: null,

    /* ========== 启动 ========== */
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

        const tankClass  = options.tankClass || options.tank || 'assault';
        const skin       = options.skin       || '#00f0ff';
        const difficulty = options.difficulty || 'normal';

        // --- 读存档 ---
        let stored = { wins: 0 };
        try { if (STORAGE && typeof STORAGE.getRecord === 'function') stored = STORAGE.getRecord('duel') || stored; } catch (_) {}

        // --- 地图（先建图，出生点防围死检测需要障碍数据）---
        const mapInfo = createMapFromTemplate(MAP_TEMPLATE, 64);
        const OB_TOOL = global.CT_OBSTACLE;
        const safePt = (x, y) => {
          if (OB_TOOL && typeof OB_TOOL.findSafeSpawn === 'function') {
            return OB_TOOL.findSafeSpawn(mapInfo.obstacles, MAP_W, MAP_H, x, y, 420);
          }
          return { x, y };
        };

        // --- 玩家 P1（左下）---
        const p1Sp = safePt(MAP_W * 0.25, MAP_H * 0.75);
        const p1 = new TankCtor({
          x: p1Sp.x, y: p1Sp.y,
          type: 'player', tankClass, color: skin, name: 'P1'
        });
        p1.maxHp = 5; p1.hp = 5;
        p1.difficulty = difficulty;
        p1.playerSlot = 1;
        p1.score = 0; // 局数胜场

        // --- 对手 P2（右上，默认 AI）---
        const p2Sp = safePt(MAP_W * 0.75, MAP_H * 0.25);
        let p2;
        try {
          p2 = new EnemyCtor({ x: p2Sp.x, y: p2Sp.y, rank: 'elite', wave: 5, type: 'enemy' });
        } catch (_) {
          p2 = new TankCtor({ x: p2Sp.x, y: p2Sp.y, type: 'enemy' });
        }
        p2.maxHp = 5; p2.hp = 5;
        p2.color = '#ff2a6d';
        p2.name = 'P2';
        p2.playerSlot = 2;
        p2.score = 0;
        p2.isAI = true;

        this.state = {
          mode: 'duel',
          phase: 'PREPARING',
          round: 1,
          roundsPerGame: 5,
          targetWins: BO5_TARGET,
          roundTimeLeft: ROUND_TIME,
          difficulty,
          p1, p2,
          player: p1,
          tanks: [p1, p2],
          obstacles: mapInfo.obstacles,
          bullets: [],
          powerups: [],
          pupTimer: PUP_FIRST,
          pupInterval: PUP_INTERVAL,
          mapInfo: { ...mapInfo, w: MAP_W, h: MAP_H, centerX: MAP_W/2, centerY: MAP_H/2 },
          score: 0,
          kills: 0,
          coins: 0,
          wins: stored.wins || 0,
          p2Local: false   // 是否检测到本地 P2 按键
        };
        ENG.gameState = this.state;
        try { if (RENDER.world) { RENDER.world.w = MAP_W; RENDER.world.h = MAP_H; RENDER.world.tile = 64; } } catch (_) {}
        try { RENDER.fitWorldToView(); } catch (_) { try { RENDER.camera.target = p1.aabb || p1._box || p1; } catch (_) {} }

        this._bindAll();

        // 注册渲染（fx 层画中央分割线 + 玩家标记）
        if (ENG && typeof ENG.registerRender === 'function') {
          const self = this;
          this._renderFn = function (ctx) { self._renderArena(ctx); };
          ENG.registerRender(this._renderFn, 'fx');
        }

        // --- 启动准备期（第 1 局，15s 商店）---
        this._startRoundPrep();

        // --- 注册 tick ---
        if (ENG && typeof ENG.registerUpdate === 'function') {
          const self = this;
          this._tickFn = function (dtMs) { self.tick(dtMs); };
          ENG.registerUpdate(this._tickFn, 50);
        }
        BUS.emit('mode:started', { mode: 'duel', state: this.state });
        console.log('[MODE DUEL] started, round=1');
      } catch (e) { console.error('[MODE DUEL] start:', e); }
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
        if (this._renderFn && ENG && typeof ENG.unregisterRender === 'function') {
          try { ENG.unregisterRender(this._renderFn, 'fx'); } catch (_) {}
        }
        this._tickFn = null;
        this._renderFn = null;
        this.state = null;
        try { if (ENG) ENG.gameState = null; } catch (_) {}
      } catch (e) { console.error('[MODE DUEL] stop:', e); }
    },

    /* ========== 每帧 tick ========== */
    tick(dtMs) {
      if (!this.running || !this.state) return;
      const dt = dtMs / 1000;
      const s = this.state;

      // 检测 P2 本地输入（↑↓←→ Enter RShift）
      if (!s.p2Local && INPUT && INPUT.keys) {
        const k = INPUT.keys;
        if (k.has('arrowup') || k.has('arrowdown') || k.has('arrowleft') || k.has('arrowright') || k.has('enter') || k.has('shiftright')) {
          s.p2Local = true;
          s.p2.isAI = false;
          console.log('[MODE DUEL] P2 local input detected → 本地双人模式');
        }
      }

      // 本地双人：手动驱动 P2
      if (s.p2Local && s.p2 && s.p2.alive) {
        this._driveP2Local(s.p2, dt);
      }

      // 局内计时
      if (s.phase === 'COMBAT') {
        s.roundTimeLeft -= dt;
        if (s.roundTimeLeft <= 0) { this._onRoundEnd(null); return; }
      }

      // tanks update
      // 分派：玩家用 CT_INPUT 快照输入；敌人走 EnemyAI.update(dt, obstacles, playerTanks)。
      // 本地双人时 P2 已由 _driveP2Local 手动驱动，跳过 AI 更新。
      const playerTanks = [];
      for (let i = 0; i < s.tanks.length; i++) {
        const pt = s.tanks[i];
        if (pt && pt.alive && pt.type === 'player') playerTanks.push(pt);
      }
      for (let i = 0; i < s.tanks.length; i++) {
        const t = s.tanks[i]; if (!t || !t.alive) continue;
        if (s.p2Local && t === s.p2) continue;
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

      /* ---- 增益道具：更新 / 随机掉落 / 双方拾取 ----
       * 1v1 两辆坦克都是 player，故不按 type 过滤，谁碰到谁拿。
       * 拾取后发出 powerup:pickup，HUD 顶部倒计时胶囊据此显示剩余秒数（全模式统一）。 */
      for (let i = 0; i < s.powerups.length; i++) {
        const p = s.powerups[i]; if (!p || p.alive === false) continue;
        try { if (typeof p.update === 'function') p.update(dt, s.obstacles, s.tanks); } catch (_) {}
      }
      if (s.phase === 'COMBAT') {
        s.pupTimer -= dt;
        if (s.pupTimer <= 0) { this._spawnBuffPowerup(s); s.pupTimer = s.pupInterval; }
      }
      for (let i = 0; i < s.tanks.length; i++) {
        const t = s.tanks[i]; if (!t || !t.alive) continue;
        const tb = t.aabb; if (!tb) continue;
        for (let j = 0; j < s.powerups.length; j++) {
          const p = s.powerups[j]; if (!p || p.alive === false) continue;
          const pb = p.aabb || p._box; if (!pb) continue;
          if (PHYS.aabb(tb, pb)) {
            try { if (typeof p.apply === 'function') p.apply(t); } catch (_) {}
            p.alive = false;
            BUS.emit('powerup:pickup', { target: t, powerup: p });
          }
        }
      }

      // bullets update + 强制反弹 2 次
      for (let i = 0; i < s.bullets.length; i++) {
        const b = s.bullets[i]; if (!b || !b.alive) continue;
        if (b.bounces == null || b.bounces < BOUNCE_TIMES) b.bounces = BOUNCE_TIMES;
        try {
          if (typeof b.update === 'function') b.update(dt, s);
          else {
            b.pos.x += (b.vel.x || 0) * dt * 60;
            b.pos.y += (b.vel.y || 0) * dt * 60;
            // 边界反弹（竞技场四周）
            if (b.pos.x < 0) { b.pos.x = 0; b.vel.x = Math.abs(b.vel.x||0); b.bounces = Math.max(0, (b.bounces||0)-1); }
            else if (b.pos.x > MAP_W) { b.pos.x = MAP_W; b.vel.x = -Math.abs(b.vel.x||0); b.bounces = Math.max(0, (b.bounces||0)-1); }
            if (b.pos.y < 0) { b.pos.y = 0; b.vel.y = Math.abs(b.vel.y||0); b.bounces = Math.max(0, (b.bounces||0)-1); }
            else if (b.pos.y > MAP_H) { b.pos.y = MAP_H; b.vel.y = -Math.abs(b.vel.y||0); b.bounces = Math.max(0, (b.bounces||0)-1); }
            if ((b.bounces||0) < 0) b.alive = false;
          }
        } catch (_) {}
      }

      this._collisionTick(dt);

      this._gcTimer += dt;
      if (this._gcTimer >= BULLET_GC_SEC) { this._gcTimer = 0; this._gcBullets(); }
      this._cleanupDeadEntities();
    },

    /* ========== P2 本地输入驱动 ========== */
    _driveP2Local(p2, dt) {
      try {
        const k = INPUT.keys || new Set();
        const isDown = (key) => k.has(key);
        // 移动：↑↓←→
        let turn = 0, fwd = 0;
        if (isDown('arrowleft')) turn -= 1;
        if (isDown('arrowright')) turn += 1;
        if (isDown('arrowup')) fwd += 1;
        if (isDown('arrowdown')) fwd -= 1;
        if (p2.angle != null) p2.angle += turn * 3 * dt;
        if (fwd !== 0 && p2.pos) {
          const sp = (p2.muls && p2.muls.speed || 1) * 3;
          p2.pos.x += Math.cos(p2.angle) * fwd * sp * dt * 60;
          p2.pos.y += Math.sin(p2.angle) * fwd * sp * dt * 60;
          if (p2.aabb) { p2.aabb.x = p2.pos.x - 28; p2.aabb.y = p2.pos.y - 28; }
        }
        // 射击：Enter
        if (isDown('enter')) {
          if ((p2.skillCdNow || 0) <= 0) {
            this._p2Fire(p2);
            p2.skillCdNow = (p2.muls && p2.muls.fireRate || 1) > 1.5 ? 0.35 : 0.5;
          }
        }
        // 技能：RShift
        if (isDown('rshift') || isDown('shiftright')) {
          // 简化：P2 技能 = 发射反弹弹幕
          if ((p2._p2SkillCd || 0) <= 0) {
            this._p2Skill(p2);
            p2._p2SkillCd = 12;
          }
        }
        if (p2.skillCdNow > 0) p2.skillCdNow -= dt;
        if (p2._p2SkillCd > 0) p2._p2SkillCd -= dt;
      } catch (_) {}
    },

    _p2Fire(p2) {
      const s = this.state; if (!s) return;
      const bul = {
        pos: { x: p2.pos.x, y: p2.pos.y },
        vel: { x: Math.cos(p2.angle||0) * 8, y: Math.sin(p2.angle||0) * 8 },
        radius: 5, damage: 1, bounces: BOUNCE_TIMES,
        owner: 'p2', _ownerRef: p2, _ownerTeam: 2,
        alive: true, _hitSet: new Set(), color: '#ff2a6d'
      };
      s.bullets.push(bul);
      BUS.emit('duel:p2Fire', { shooter: p2 });
    },

    _p2Skill(p2) {
      const s = this.state; if (!s) return;
      // 环形 3 发反弹弹
      for (let i = 0; i < 3; i++) {
        const a = (p2.angle || 0) + (i - 1) * 0.4;
        s.bullets.push({
          pos: { x: p2.pos.x, y: p2.pos.y },
          vel: { x: Math.cos(a) * 7, y: Math.sin(a) * 7 },
          radius: 5, damage: 1, bounces: BOUNCE_TIMES,
          owner: 'p2', _ownerRef: p2, _ownerTeam: 2,
          alive: true, _hitSet: new Set(), color: '#ff2a6d'
        });
      }
    },

    /* ========== 局间流程 ========== */
    _startRoundPrep() {
      const s = this.state; if (!s) return;
      s.phase = 'PREPARING';
      // 重生双方
      const sp1 = { x: MAP_W * 0.25, y: MAP_H * 0.75 };
      const sp2 = { x: MAP_W * 0.75, y: MAP_H * 0.25 };
      s.p1.alive = true; s.p1.hp = s.p1.maxHp; s.p1.pos.x = sp1.x; s.p1.pos.y = sp1.y;
      if (s.p1.spawnPos) { s.p1.spawnPos.x = sp1.x; s.p1.spawnPos.y = sp2.y; }
      s.p2.alive = true; s.p2.hp = s.p2.maxHp; s.p2.pos.x = sp2.x; s.p2.pos.y = sp2.y;
      if (s.p2.spawnPos) { s.p2.spawnPos.x = sp2.x; s.p2.spawnPos.y = sp2.y; }
      // 重建地图（砖墙可毁，每局重置）
      const mapInfo = createMapFromTemplate(MAP_TEMPLATE, 64);
      s.obstacles = mapInfo.obstacles;
      s.bullets = [];
      /* 商店仅无尽模式 —— 1v1 局间不再刷新/解锁商店（prep-phase 也已按 mode 白名单拦截） */
      const self = this;
      try {
        PREP.start({
          seconds: INTER_ROUND_SHOP,
          mode: 'duel',
          players: [s.p1],
          mapInfo: s.mapInfo,
          onCombatStart: () => self._startCombatPhase()
        });
      } catch (e) { console.error('[duel] prep start', e); }
    },

    _startCombatPhase() {
      const s = this.state; if (!s) return;
      s.phase = 'COMBAT';
      s.roundTimeLeft = ROUND_TIME;
      s.powerups = [];            // 每局清空上一局残留道具
      s.pupTimer = PUP_FIRST;     // 重新计时随机掉落
      try { if (ENG && typeof ENG.setState === 'function') ENG.setState('COMBAT'); } catch (_) {}
      try { if (SHOP && typeof SHOP.lock === 'function') SHOP.lock(); } catch (_) {}
      BUS.emit('duel:roundStart', { round: s.round });
    },

    _onRoundEnd(winner) {
      const s = this.state; if (!s || !this.running) return;
      // 判定本局胜者
      let roundWinner = winner;
      if (!roundWinner) {
        // 按 HP 判定
        if ((s.p1.hp > 0) && !(s.p2.hp > 0)) roundWinner = s.p1;
        else if ((s.p2.hp > 0) && !(s.p1.hp > 0)) roundWinner = s.p2;
        else roundWinner = (s.p1.hp >= s.p2.hp) ? s.p1 : s.p2;
      }
      if (roundWinner === s.p1) s.p1.score = (s.p1.score || 0) + 1;
      else s.p2.score = (s.p2.score || 0) + 1;
      BUS.emit('duel:roundEnd', { round: s.round, winner: roundWinner.name, p1Score: s.p1.score, p2Score: s.p2.score });

      // BO5 判定
      if (s.p1.score >= BO5_TARGET || s.p2.score >= BO5_TARGET) {
        this._gameOver(s.p1.score >= BO5_TARGET);
        return;
      }
      // 下一局
      s.round += 1;
      /* 增益/商店仅无尽模式 —— 1v1 局间直接进入下一局备战 */
      this._nextRound();
    },

    _showBuffSelection() {
      const s = this.state; if (!s) return;
      s.phase = 'BUFF_SELECT';
      try { if (ENG && typeof ENG.setState === 'function') ENG.setState('BUFF_SELECT'); } catch (_) {}
      try {
        const mods = {};
        if (s.p1.flags && s.p1.flags.nextBuffRarityUp) { mods.rarityUp = true; s.p1.flags.nextBuffRarityUp = false; }
        const cards = BUFF.generateThreeCards(s.p1, mods) || [];
        BUS.emit('ui:showBuffSelection', { cards, mode: 'duel', round: s.round, rerollAvailable: !!(s.p1.flags && s.p1.flags.nextBuffReroll) });
        if (!global.CT_UI_BUFF) {
          const self = this;
          setTimeout(() => self._onBuffSelected({ defId: cards[0] && cards[0].id }), 100);
        }
      } catch (e) {
        console.warn('[duel] buff fallback', e);
        this._nextRound();
      }
    },

    _onBuffSelected(evt) {
      const s = this.state; if (!s || !this.running) return;
      evt = evt || {};
      if (evt.defId) { try { BUFF.applySelection(s.p1, evt.defId); } catch (_) {} }
      BUS.emit('ui:hideBuffSelection');
      this._nextRound();
    },

    _nextRound() {
      const s = this.state; if (!s) return;
      this._startRoundPrep();
    },

    _onTankDead(evt) {
      const s = this.state; if (!s || !this.running) return;
      const dead = evt && evt.dead; if (!dead) return;
      // 本局结束：对方胜
      const winner = (dead === s.p1) ? s.p2 : s.p1;
      this._onRoundEnd(winner);
    },

    _gameOver(victory) {
      const s = this.state; if (!s || !this.running) return;
      this.running = false;
      s.phase = victory ? 'VICTORY' : 'GAMEOVER';
      try { if (ENG && typeof ENG.setState === 'function') ENG.setState('GAMEOVER'); } catch (_) {}
      try {
        if (STORAGE && typeof STORAGE.updateRecord === 'function') {
          const wins = s.wins + (victory ? 1 : 0);
          STORAGE.updateRecord('duel', { wins });
          s.wins = wins;
        }
      } catch (_) {}
      const payload = {
        victory: !!victory, mode: 'duel', round: s.round,
        p1Score: s.p1.score, p2Score: s.p2.score,
        kills: s.kills, coins: s.coins, score: s.p1.score * 100,
        stats: {
          score: s.p1.score * 100, kills: s.kills,
          /* 完成度：已胜局数 / BO5 目标（3），获胜即满 */
          progress: victory ? 1 : Math.max(0, Math.min(1, (s.p1.score || 0) / BO5_TARGET)),
          deaths: victory ? 0 : 1,
          surviveTime: 0, maxCombo: 0
        }
      };
      try {
        if (UI_RES && typeof UI_RES.show === 'function') UI_RES.show(payload);
        else console.log('[MODE DUEL] result', payload);
      } catch (_) { console.log('[MODE DUEL] result', payload); }
      BUS.emit('mode:finished', payload);
    },

    /* ========== 碰撞 ========== */
    _collisionTick(dt) {
      const s = this.state; if (!s) return;
      const tanks = s.tanks, bullets = s.bullets, obstacles = s.obstacles;
      for (let i = 0; i < tanks.length; i++) {
        const t = tanks[i]; if (!t || !t.alive) continue;
        const ab = t.aabb; if (!ab) continue;
        for (let j = 0; j < obstacles.length; j++) {
          const o = obstacles[j]; if (!o || !o.alive || !o.blockTank) continue;
          const ob = o.aabb || o._box; if (!ob) continue;
          if (PHYS.aabb(ab, ob)) { try { PHYS.resolveCollision(t, o); } catch (_) {} }
        }
      }
      // Tank vs Tank
      for (let i = 0; i < tanks.length; i++) {
        const a = tanks[i]; if (!a || !a.alive) continue;
        for (let j = i + 1; j < tanks.length; j++) {
          const b = tanks[j]; if (!b || !b.alive) continue;
          try { PHYS.resolveCollision(a, b); } catch (_) {}
        }
      }
      // Bullet vs Obstacle（强制反弹 2 次）
      for (let i = 0; i < bullets.length; i++) {
        const b = bullets[i]; if (!b || !b.alive) continue;
        if (b.bounces == null || b.bounces < BOUNCE_TIMES) b.bounces = BOUNCE_TIMES;
        const bb = { x: (b.pos.x - (b.radius || 5)), y: (b.pos.y - (b.radius || 5)), w: (b.radius || 5) * 2, h: (b.radius || 5) * 2 };
        for (let j = 0; j < obstacles.length; j++) {
          const o = obstacles[j]; if (!o || !o.alive || !o.blockBullet) continue;
          const ob = o.aabb || o._box; if (!ob) continue;
          if (PHYS.aabb(bb, ob)) {
            if ((b.bounces || 0) > 0) {
              b.bounces -= 1;
              const overlapX = Math.min(bb.x + bb.w - ob.x, ob.x + ob.w - bb.x);
              const overlapY = Math.min(bb.y + bb.h - ob.y, ob.y + ob.h - bb.y);
              if (overlapX < overlapY) b.vel.x = -(b.vel.x || 0); else b.vel.y = -(b.vel.y || 0);
              // 推出墙
              if (overlapX < overlapY) b.pos.x += (b.vel.x > 0 ? (overlapX+1) : -(overlapX+1));
              else b.pos.y += (b.vel.y > 0 ? (overlapY+1) : -(overlapY+1));
            } else {
              b.alive = false;
            }
            // 砖墙扣血
            if (o.type === 'brick' || (o.hp != null && o.hp !== Infinity)) {
              o.hp = (o.hp - (b.damage || 1)) | 0;
              if (o.hp <= 0) o.alive = false;
            }
            if (!b.alive) break;
          }
        }
      }
      // Bullet vs Tank
      for (let i = 0; i < bullets.length; i++) {
        const b = bullets[i]; if (!b || !b.alive) continue;
        const bb = { x: (b.pos.x - (b.radius || 5)), y: (b.pos.y - (b.radius || 5)), w: (b.radius || 5) * 2, h: (b.radius || 5) * 2 };
        for (let j = 0; j < tanks.length; j++) {
          const t = tanks[j]; if (!t || !t.alive) continue;
          if (b._ownerRef === t) continue;
          if (b._ownerTeam != null && t.playerSlot === b._ownerTeam) continue;
          const tb = t.aabb; if (!tb) continue;
          if (PHYS.aabb(bb, tb)) {
            if (b._hitSet && b._hitSet.has(t)) continue;
            let dmg = (b.damage || 1) * (t.muls && t.muls.dr != null ? Math.max(0, 1 - t.muls.dr) : 1);
            if (t.shield > 0) { const absorb = Math.min(t.shield, dmg); t.shield -= absorb; dmg -= absorb; }
            if (t.takeDamage) { try { t.takeDamage(dmg); } catch (_) { t.hp -= dmg; } } else { t.hp -= dmg; }
            BUS.emit('tank:hit', { target: t, dmg, bullet: b, attacker: b.owner });
            if (b._hitSet) b._hitSet.add(t);
            b.alive = false; // 1v1 子弹不穿透
            if (t.hp <= 0 && t.alive) {
              t.alive = false;
              BUS.emit('tank:dead', { dead: t, killer: b.owner });
            }
            if (!b.alive) break;
          }
        }
      }
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
      s.obstacles = s.obstacles.filter(o => o && o.alive !== false);
      s.powerups = s.powerups.filter(p => p && p.alive !== false);
      // 1v1：坦克不淘汰（局结束由 _onTankDead 处理）
    },

    /* ========== 技能随机掉落 ==========
     * 竞技场内随机安全点刷一颗增益道具，避免 1v1 全程只有裸车对轰。 */
    _spawnBuffPowerup(s) {
      if (!s || !this.running || !PW_NS) return;
      const BUFF_IDS = ['P01', 'P02', 'P03', 'P04', 'P05', 'P06', 'P09', 'P15'];
      const id = BUFF_IDS[(Math.random() * BUFF_IDS.length) | 0];
      const OB_TOOL = global.CT_OBSTACLE;
      let sp = null;
      for (let tries = 0; tries < 14; tries++) {
        const x = 120 + Math.random() * (MAP_W - 240);
        const y = 120 + Math.random() * (MAP_H - 240);
        if (OB_TOOL && typeof OB_TOOL.findSafeSpawn === 'function') {
          sp = OB_TOOL.findSafeSpawn(s.obstacles, MAP_W, MAP_H, x, y, 80);
        } else { sp = { x, y }; }
        if (sp) break;
      }
      if (!sp) sp = { x: MAP_W * 0.5, y: MAP_H * 0.5 };
      try {
        const p = PW_NS.spawn(sp.x, sp.y, id);
        if (p) { s.powerups.push(p); BUS.emit('powerup:spawned', { powerup: p, id: id }); }
      } catch (_) {}
    },

    /* ========== 渲染竞技场（fx 层）========== */
    _renderArena(ctx) {
      const s = this.state; if (!s || !ctx) return;
      const cam = RENDER.camera || { x: 0, y: 0, zoom: 1 };
      const z = cam.zoom || 1;
      // 中央对称分割线（虚线）
      const cx = (s.mapInfo.centerX - cam.x) * z;
      const topY = (0 - cam.y) * z;
      const botY = (MAP_H - cam.y) * z;
      ctx.save();
      ctx.strokeStyle = 'rgba(0,240,255,0.15)';
      ctx.lineWidth = 1;
      ctx.setLineDash([8, 12]);
      ctx.beginPath();
      ctx.moveTo(cx, topY); ctx.lineTo(cx, botY);
      ctx.stroke();
      ctx.setLineDash([]);
      // P1/P2 标记点
      const drawMark = (tank, color, label) => {
        if (!tank || !tank.alive) return;
        const sx = (tank.pos.x - cam.x) * z;
        const sy = (tank.pos.y - cam.y) * z;
        ctx.fillStyle = color;
        ctx.shadowColor = color; ctx.shadowBlur = 8;
        ctx.font = 'bold 11px "Share Tech Mono", monospace';
        ctx.fillText(label, sx - 10, sy - 34);
        ctx.shadowBlur = 0;
      };
      drawMark(s.p1, '#00f0ff', 'P1');
      drawMark(s.p2, '#ff2a6d', 'P2');
      ctx.restore();
    },

    /* ========== 绑定事件 ========== */
    _bindAll() {
      const self = this;
      const binds = [
        /* prep:combatStart 不绑 BUS（PREP.start 的 onCombatStart 回调已驱动，避免双重触发） */
        ['ui:buffSelected',  (e)=> { try { self._onBuffSelected(e); } catch(e){console.error(e);} }],
        ['tank:dead',        (e)=> { try { self._onTankDead(e); } catch(e){console.error(e);} }]
      ];
      this._bindings = [];
      for (let i = 0; i < binds.length; i++) {
        BUS.on(binds[i][0], binds[i][1]);
        this._bindings.push({ e: binds[i][0], fn: binds[i][1] });
      }
    }
  };

  global.CT_MODE_DUEL = CT_MODE_DUEL;
})(typeof window !== 'undefined' ? window : globalThis);

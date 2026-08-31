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
  const PORTAL_PAIRS = 3;        // 传送门对数（随机散布，不再按模板规则成片摆放）
  const PORTAL_MIN_GAP = 6;      // 同一对传送门两端的最小间隔（格）
  const PORTAL_MIN_SPREAD = 3;   // 不同传送门之间的最小间隔（格），避免扎堆成片

  /* 车型 → 专属配色（与菜单 TANKS 定义一致）
   * P2 换车型时颜色随之变化，取色规则与 P1 完全相同 */
  const TANK_COLORS = { assault: '#00e5ff', heavy: '#ffb020', sniper: '#a855f7', engineer: '#7cf76b' };

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
    /* 传送门不再写死在模板里（原 P/Q 固定在第 8/11 行，成行成片、位置可预测）。
     * 改为地图生成后从空地中随机取点成对散布，见 createMapFromTemplate 的 _scatterPortals。 */
    '....................',
    '....SS........SS....',
    '....SS........SS....',
    '....................',
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
    const emptyCells = [];   // 空地格：供传送门随机落点
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
        else emptyCells.push({ c: c, r: r, x: x, y: y });
      }
    }
    /* 传送门改为随机散布（不再按模板固定成行成片） */
    if (Portal) _scatterPortals(obstacles, emptyCells, tileSize);
    return { obstacles, w: totalW, h: totalH, tile: tileSize, offX, offY };
  }

  /* 传送门随机散布：从空地中随机取点、成对放置并双向互联。
   * 约束：
   *  - 同一对两端间隔 >= PORTAL_MIN_GAP 格 → 传送才有位移意义；
   *  - 任意两个传送门间隔 >= PORTAL_MIN_SPREAD 格 → 避免扎堆成片。 */
  function _scatterPortals(obstacles, emptyCells, tileSize) {
    if (!emptyCells || emptyCells.length < 2) return;
    const pool = emptyCells.slice();
    /* Fisher–Yates 洗牌 */
    for (let i = pool.length - 1; i > 0; i--) {
      const j = (Math.random() * (i + 1)) | 0;
      const tmp = pool[i]; pool[i] = pool[j]; pool[j] = tmp;
    }
    const placed = [];
    let seq = 0;
    function notClustered(cell) {
      for (let i = 0; i < placed.length; i++) {
        const p = placed[i];
        if (Math.abs(p.c - cell.c) < PORTAL_MIN_SPREAD && Math.abs(p.r - cell.r) < PORTAL_MIN_SPREAD) return false;
      }
      return true;
    }
    for (let i = 0; i < pool.length && placed.length < PORTAL_PAIRS * 2; i++) {
      const a = pool[i];
      if (!a || !notClustered(a)) continue;
      let partner = null;
      for (let j = pool.length - 1; j > i; j--) {
        const b = pool[j];
        if (!b) continue;
        if (Math.abs(b.c - a.c) < PORTAL_MIN_GAP && Math.abs(b.r - a.r) < PORTAL_MIN_GAP) continue;
        if (!notClustered(b)) continue;
        partner = b;
        pool.splice(j, 1);
        break;
      }
      if (!partner) continue;
      seq++;
      const idA = 'duel_portal_' + seq + 'a';
      const idB = 'duel_portal_' + seq + 'b';
      obstacles.push(new Portal({ id: idA, pairId: idB, x: a.x, y: a.y, w: tileSize, h: tileSize }));
      obstacles.push(new Portal({ id: idB, pairId: idA, x: partner.x, y: partner.y, w: tileSize, h: tileSize }));
      placed.push(a, partner);
    }
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
        /* 本地双人 P2 车型：由菜单「玩家2 选择界面」独立挑选（不再镜像 P1）；
         * 缺省回退 'assault'。'same' 仅作历史兼容保留。 */
        const _p2Raw = options.p2Tank || options.p2TankClass || 'assault';
        const p2TankClass = (_p2Raw && _p2Raw !== 'same') ? _p2Raw : 'assault';
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

        // --- 对手 P2（右上）---
        // 本地双人：P2 建成真正的玩家坦克（与 P1 同车型，点对称竞技场保证公平），
        // 一开局即启用本地双人，不再依赖"游戏中按方向键才偷偷切换"；AI 模式保持原 EnemyAI。
        const p2Sp = safePt(MAP_W * 0.75, MAP_H * 0.25);
        const local2P = (options.opponent === 'local');
        let p2;
        if (local2P) {
          p2 = new TankCtor({ x: p2Sp.x, y: p2Sp.y, type: 'player', tankClass: p2TankClass, color: '#ff2a6d', name: 'P2' });
          p2.isAI = false;
        } else {
          try {
            p2 = new EnemyCtor({ x: p2Sp.x, y: p2Sp.y, rank: 'elite', wave: 5, type: 'enemy' });
          } catch (_) {
            p2 = new TankCtor({ x: p2Sp.x, y: p2Sp.y, type: 'enemy' });
          }
          p2.isAI = true;
        }
        p2.maxHp = 5; p2.hp = 5;
        /* 颜色随车型变化（与 P1 同一套车型→配色规则），不再固定 #ff2a6d */
        p2.color = TANK_COLORS[p2TankClass] || '#ff2a6d';
        p2.name = 'P2';
        p2.playerSlot = 2;
        p2.score = 0;

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
          p2Local: local2P,   // 本地双人：开局即启用，而非靠中途按键检测
          opponent: options.opponent || 'ai',
          roundResolved: false // 每局仅结算一次，避免同帧双亡导致重复结算/复活错乱（本地双人两辆皆 player 时易触发）
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
        // D-04：联机 / 赛季为纯前端不可实现项（需服务端账号与匹配），此处以「本地双人」作为替代方案。
        // 预留 CT_SEASON 适配器接口：若未来接入云端赛季/排行榜，注入 global.CT_SEASON 即可上报，否则静默跳过。
        if (global.CT_SEASON && typeof global.CT_SEASON.reportDuel === 'function') {
          try { global.CT_SEASON.reportDuel({ mode: 'duel', opponent: options.opponent || 'ai' }); } catch (_) {}
        }
        // 本地双人：开局即弹提示横幅（不再依赖中途按键检测）
        if (local2P) {
          try { global.CT_WAVE_BANNER && global.CT_WAVE_BANNER.show('👥 本地双人已启用', 'P2：方向键 + Enter / 右Shift', 2000); } catch (_) {}
        }
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
      // 必须用运行时 global.CT_INPUT：duel.js 在 main.js 之前加载，顶部
      // const INPUT = global.CT_INPUT || {} 捕获的是空 stub（main.js 当时还没定义 CT_INPUT），
      // 箭头键永远不会进入那个 stub 的 keys 集合，导致 P2 方向键"无反应"。
      const _liveIn = (global.CT_INPUT) || INPUT;
      if (!s.p2Local && _liveIn && _liveIn.keys) {
        const k = _liveIn.keys;
        if (k.has('arrowup') || k.has('arrowdown') || k.has('arrowleft') || k.has('arrowright') || k.has('enter') || k.has('shiftright') || k.has('rshift')) {
          s.p2Local = true;
          s.p2.isAI = false;
          console.log('[MODE DUEL] P2 local input detected → 本地双人模式');
          // D-12：检测到本地双人时弹出提示横幅
          try { global.CT_WAVE_BANNER && global.CT_WAVE_BANNER.show('👥 本地双人已启用', 'P2：方向键 + Enter / 右Shift', 1800); } catch (_) {}
        }
      }

      /* P2 不再单独手动驱动：改走与 P1 相同的 Tank.update（见下方坦克更新循环），
       * 这样移动手感/碰撞解析/开火/技能/传送门/增益衰减与 P1 完全一致。 */

      // 局内计时
      if (s.phase === 'COMBAT') {
        s.roundTimeLeft -= dt;
        if (s.roundTimeLeft <= 0) { this._onRoundEnd(null); return; }
      }

      // tanks update
      // 分派：玩家用 CT_INPUT 快照输入；敌人走 EnemyAI.update(dt, obstacles, playerTanks)。
      // 本地双人时 P2 由 _p2Input + Tank.update 驱动（与 P1 同逻辑），跳过 AI 更新。
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
            let inp;
            if (s.p2Local && t === s.p2) {
              /* P2 与 P1 走完全相同的 Tank.update —— 同样的平移控制、加速度/摩擦、
               * 碰撞解析、开火（Tank._fire）、技能（SKILLS[tankClass]）、传送门与增益，
               * 只是键位不同：方向键移动 + Enter 开火 + 右Shift 技能。
               * P2 没有鼠标瞄准 → turretWorldPoint 置空，炮塔朝向跟随车身。 */
              t.update(dt, this._p2Input(), s.obstacles, s.tanks);
              t.turretAngle = t.angle;
              continue;
            }
            if (s.p2Local && t === s.p1) {
              /* 本地双人：P1 独占 WASD，方向键（↑↓←→）专留给 P2。
               * 否则 CT_INPUT.snapshot 会把方向键也算进 P1 的移动键 → P2 按方向键"没反应"。 */
              const snap = global.CT_INPUT.snapshot();
              const k = global.CT_INPUT.keys || new Set();
              snap.up = k.has('w'); snap.down = k.has('s');
              snap.left = k.has('a'); snap.right = k.has('d');
              inp = snap;
            } else {
              inp = (global.CT_INPUT && typeof global.CT_INPUT.snapshot === 'function')
                ? global.CT_INPUT.snapshot() : {};
            }
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

    /* ========== P2 本地输入 ==========
     * 只负责把 P2 的键位翻译成与 CT_INPUT.snapshot() 同构的输入对象，
     * 之后交给 Tank.update 处理 —— 因此 P2 的行动逻辑与 P1 完全一致。 */
    _p2Input() {
      try {
        // 运行时读取（顶部 const INPUT 是加载期空 stub，箭头键进不去）
        const k = (global.CT_INPUT && global.CT_INPUT.keys) || (INPUT && INPUT.keys) || new Set();
        return {
          directMove: true,                 // 与 P1 相同的平移式控制
          up: k.has('arrowup'),
          down: k.has('arrowdown'),
          left: k.has('arrowleft'),
          right: k.has('arrowright'),
          shoot: k.has('enter'),            // 开火：Enter
          skill: k.has('shiftright') || k.has('shift'),  // 技能：右Shift
          turretWorldPoint: null            // P2 无鼠标瞄准 → 炮塔跟随车身
        };
      } catch (_) {
        return { directMove: true, up: false, down: false, left: false, right: false, shoot: false, skill: false, turretWorldPoint: null };
      }
    },

    /* ========== 局间流程 ========== */
    _startRoundPrep() {
      const s = this.state; if (!s) return;
      s.phase = 'PREPARING';
      // 注意：结算锁 roundResolved 不在本函数重置（本函数会被 _onRoundEnd 同帧同步调用），
      // 否则同帧双亡时锁会被立刻解开、二次结算。锁在 _startCombatPhase（新一局战斗真正开始）才清。
      // 重生双方
      const sp1 = { x: MAP_W * 0.25, y: MAP_H * 0.75 };
      const sp2 = { x: MAP_W * 0.75, y: MAP_H * 0.25 };
      s.p1.alive = true; s.p1.hp = s.p1.maxHp; s.p1.pos.x = sp1.x; s.p1.pos.y = sp1.y;
      if (s.p1.spawnPos) { s.p1.spawnPos.x = sp1.x; s.p1.spawnPos.y = sp1.y; }
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
      s.roundResolved = false;   // 新一局战斗开始，解除上一局的结算锁
      s.roundTimeLeft = ROUND_TIME;
      s.powerups = [];            // 每局清空上一局残留道具
      s.pupTimer = PUP_FIRST;     // 重新计时随机掉落
      try { if (ENG && typeof ENG.setState === 'function') ENG.setState('COMBAT'); } catch (_) {}
      try { if (SHOP && typeof SHOP.lock === 'function') SHOP.lock(); } catch (_) {}
      BUS.emit('duel:roundStart', { round: s.round });
    },

    _onRoundEnd(winner) {
      const s = this.state; if (!s || !this.running) return;
      // 同一局只结算一次：本地双人下两辆皆 player，近距离对射可能同帧双亡，
      // 若已结算则直接忽略，避免二次 _nextRound → _startRoundPrep 把对手复活、攻击者反被记死。
      if (s.roundResolved) return;
      s.roundResolved = true;
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
      if (s.roundResolved) return;  // 本局已结算，忽略后续死亡事件
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
      // D-04：赛季结果上报（预留接口，未接入服务端时静默跳过）
      if (global.CT_SEASON && typeof global.CT_SEASON.reportResult === 'function') {
        try { global.CT_SEASON.reportResult({ mode: 'duel', victory: !!victory, wins: s.wins }); } catch (_) {}
      }
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

/* ==========================================================
 * CYBERTANK · King of the Hill Mode — 据点争夺
 * 命名空间: window.CT_MODE_KH
 * 3 小节 × 60s + 节间准备期 20s（商店+增益）；每节据点位置变化；
 * 站据点 3s 后开始累计积分（每秒 +10）；节末排名金币发放。
 * ========================================================== */
(function (global) {
  'use strict';

  // ---------- 依赖安全兜底 ----------
  const BUS    = global.CT_BUS        || { on(){}, off(){}, emit(){} };
  const ENG    = global.CT_ENGINE     || {};
  const RENDER = global.CT_RENDERER   || { camera:{}, world:{w:2400,h:1600}, getCtx:()=>null };
  const PHYS   = global.CT_PHYSICS    || { aabb(){return false;}, resolveCollision(){} };
  const PREP   = global.CT_PREP       || { start(){}, cancel(){} };
  const BUFF   = global.CT_BUFF       || { generateThreeCards:()=>[], applySelection:()=>({ok:false}), tickTimers(){} };
  const SHOP   = global.CT_SHOP       || { refreshStock(){}, unlock(){}, lock(){}, setDiscount(){} };
  const STORAGE= global.CT_STORAGE    || { updateRecord(){}, getRecord:()=>({highScore:0}) };
  const TANK_NS= global.CT_TANK       || {};
  const OB_NS  = global.CT_OBSTACLE   || {};
  const BUL_NS = global.CT_BULLET     || { spawn(){return null;}, Pool:{ acquire:()=>({alive:false}), release(){} } };
  const ENEMY_NS=global.CT_ENEMY      || {};
  const UI_RES = global.CT_UI_RESULT  || null;

  const TankCtor   = TANK_NS.Tank || function TankStub(o){ o=o||{}; this.pos={x:o.x||0,y:o.y||0}; this.spawnPos={...this.pos}; this.hp=o.maxHp||3; this.maxHp=this.hp; this.alive=true; this._w=56;this._h=56; this.aabb={x:this.pos.x-28,y:this.pos.y-28,w:56,h:56}; this.muls={dmg:1,fireRate:1,speed:1,dr:0,pierce:0,splash:0,coinGain:1}; this.flags={}; this.tempBuffs=[]; this.type=o.type||'player'; this.shield=0; this.coins=0; };
  const EnemyCtor  = (ENEMY_NS && ENEMY_NS.EnemyAI) || TankCtor;
  const WallBrick  = OB_NS.WallBrick || function (o){ return {alive:true,blockTank:true,blockBullet:true,type:'brick',hp:2,_box:{x:o.x,y:o.y,w:o.w||64,h:o.h||64}, get aabb(){return this._box;}, update(){}, render(){} }; };
  const WallSteel  = OB_NS.WallSteel || function (o){ return {alive:true,blockTank:true,blockBullet:true,type:'steel',hp:Infinity,_box:{x:o.x,y:o.y,w:o.w||64,h:o.h||64}, get aabb(){return this._box;}, update(){}, render(){} }; };
  /* 新地形：草丛(隐身) / 水(挡车不挡弹) / 冰(打滑) / 泥(减速) / 传送门(P/Q 成对) */
  const Bush       = OB_NS.Bush   || null;
  const Water      = OB_NS.Water  || null;
  const Ice        = OB_NS.Ice    || null;
  const Mud        = OB_NS.Mud    || null;
  const Portal     = OB_NS.Portal || null;

  // ---------- 常量 ----------
  const SECTIONS = 3;
  const SECTION_TIME = 60;
  const PREP_TIME = 3;       // 开局短准备（立刻进入战斗）
  const SHOP_TIME = 20;      // 小节之间的购买间隔（与无尽模式一致的商店时间）
  const START_COINS = 150;   // 开局启动资金（保证首个购买间隔就能消费）
  const SECTION_REWARDS = [220, 140, 80];  // 每节排名金币（配合商店上调）
  const HILL_RADIUS = 180;
  const HILL_CAPTURE = 3;
  const HILL_SCORE_PER_SEC = 10;
  /** 占领胜利条件：玩家累计占领据点该秒数后直接获胜（需求：累计 30 秒） */
  const HILL_WIN_HOLD = 30;
  const BULLET_GC_SEC = 5;
  const AI_COUNT = 4;

  /* 据点候选位置（每节不同）—— 模板坐标即世界坐标（地图从原点铺满世界）
   * 三个据点中心 3×3 区域在模板中保持空旷：中央(13,8) / 左下(6,12) / 右上(20,4)
   * 注意：基础模板已整体放大 2 倍，故格坐标同步 ×2 → (26,16) / (12,24) / (40,8)；
   * 下面的 x/y 为最终像素（格坐标 × 64）。 */
  const HILL_SPOTS = [
    { x: 26 * 64, y: 16 * 64 },   // 中央
    { x: 12 * 64, y: 24 * 64 },   // 左下
    { x: 40 * 64, y: 8 * 64 }     // 右上
  ];

  /* 对称地图模板（基础 26×16，加载期统一放大 2 倍 → 52×32，从原点铺满世界；网格化均匀布局）
   * 符号：B砖 S钢 G草丛 W水 I冰 M泥 P/Q传送门（成对）
   * 三个据点中心（(13,8)/(6,12)/(20,4) 附近 3×3）保持空旷 */
  const _BASE_MAP = [
    '..........................',
    '..SS.BBB..GG...II....SS...',
    '..SS.B.B...G...I.I...SS...',
    '.....B.B...GG..........SS.',
    '.....BBB...II....MM.......',
    '.GG....................GG.',
    '.WWW...MM....GGG....SS..P.',
    '.W.W...MM..........SS.....',
    '.WWW.................SS...',
    '......SS.........BB....GG.',
    '..G....II..........BB.....',
    '..GG...........MM....SS...',
    '.MMM.......Q....MM....SS..',
    '.M.M....GG......BBB.......',
    '.MMM....GG.......BBB......',
    '..........................',
  ];
  /* 地图扩大：基础模板 ×2 → 52×32（tile=64 → 3328×2048），布局密度不变、世界等比变大。
   * 装饰：左上角用钢块拼出 "ccr"（5×5 点阵、scale=1 ≈ 1088×320px，不至于过大）；
   * 放左上角是为了避开三个据点（放大后的 (26,16) / (12,24) / (40,8)）与各出生点。 */
  const MAP_TEMPLATE = (function () {
    let t = _BASE_MAP;
    if (OB_NS && typeof OB_NS.enlargeTemplate === 'function') t = OB_NS.enlargeTemplate(t, 2);
    if (OB_NS && typeof OB_NS.stampText === 'function') {
      t = OB_NS.stampText(t, 'ccr', { row: 2, col: 3, ch: 'S', scale: 1, gap: 1, clear: true });
    }
    return t;
  })();
  /* 世界尺寸 = 模板实际尺寸：地图铺满世界，四周不再留大面积空白 */
  const WORLD_W = MAP_TEMPLATE[0].length * 64;
  const WORLD_H = MAP_TEMPLATE.length * 64;
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
          const p = new Portal({ id: 'kh_portal_' + portalSeq, pairId: null, x, y, w: tileSize, h: tileSize });
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
   * CT_MODE_KH 主对象
   * ========================================================== */
  const CT_MODE_KH = {
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

        const tankClass  = options.tankClass  || 'assault';
        const skin       = options.skin       || '#00f0ff';
        const difficulty = options.difficulty || 'normal';

        // --- 地图（先建图，生成点防围死检测需要障碍数据）---
        const mapInfo = createMapFromTemplate(MAP_TEMPLATE, 64);
        const OB_TOOL = global.CT_OBSTACLE;
        const safePt = (x, y) => {
          if (OB_TOOL && typeof OB_TOOL.findSafeSpawn === 'function') {
            return OB_TOOL.findSafeSpawn(mapInfo.obstacles, WORLD_W, WORLD_H, x, y, 420);
          }
          return { x, y };
        };

        // --- 玩家（左下，模板内坐标）---
        const pSpawn = safePt(WORLD_W * 0.30, WORLD_H * 0.62);
        const player = new TankCtor({
          x: pSpawn.x, y: pSpawn.y,
          type: 'player', tankClass, color: skin, name: 'Player'
        });
        player.difficulty = difficulty;
        player.team = 0;
        player.score = 0;
        player.coins = START_COINS;   // 启动资金：让首个购买间隔就能消费

        // --- 玩家 + 据点；AI 阵营在战斗开始 5 秒后生成（其余模式统一出兵延迟） ---
        const tanks = [player];

        // --- 据点（第 1 节中央）---
        const hill = {
          x: HILL_SPOTS[0].x, y: HILL_SPOTS[0].y,
          radius: HILL_RADIUS,
          holder: null,
          captureProg: 0,
          scoring: false,
          flashT: 0
        };

        // --- 读存档 ---
        let stored = { highScore: 0 };
        try { if (STORAGE && typeof STORAGE.getRecord === 'function') stored = STORAGE.getRecord('kinghill') || stored; } catch (_) {}

        this.state = {
          mode: 'kinghill',
          phase: 'PREPARING',
          section: 1,
          sectionsPerGame: SECTIONS,
          sectionTimeLeft: SECTION_TIME,
          difficulty,
          hill,
          player,
          tanks,
          obstacles: mapInfo.obstacles,
          bullets: [],
          powerups: [],
          /** 增益道具生成计时（据点模式周期掉落 buff 道具，丰富混战） */
          pupTimer: 8,        // 首颗在战斗开始 8 秒后掉落
          pupInterval: 14,    // 之后每 14 秒一颗
          mapInfo: { ...mapInfo, w: WORLD_W, h: WORLD_H, centerX: WORLD_W/2, centerY: WORLD_H/2 },
          score: 0,
          kills: 0,
          coins: START_COINS,
          /** 玩家累计占领据点时长（秒），达 HILL_WIN_HOLD 直接获胜 */
          playerHoldTime: 0,
          highScore: stored.highScore || 0
        };
        ENG.gameState = this.state;
        /* 同步世界尺寸（其他模式可能改过 RENDER.world），坦克边界钳制依赖它 */
        try { if (RENDER.world) { RENDER.world.w = WORLD_W; RENDER.world.h = WORLD_H; } } catch (_) {}
        try { RENDER.fitWorldToView(); } catch (_) { try { RENDER.camera.target = player.aabb || player._box || player; } catch (_) {} }

        this._bindAll();

        // 注册渲染（fx 层画据点圆圈）
        if (ENG && typeof ENG.registerRender === 'function') {
          const self = this;
          this._renderFn = function (ctx) { self._renderHill(ctx); };
          ENG.registerRender(this._renderFn, 'fx');
        }

        // --- 启动准备期（第 1 节，20s）---
        this._startPrepPhase();

        // --- 注册 tick ---
        if (ENG && typeof ENG.registerUpdate === 'function') {
          const self = this;
          this._tickFn = function (dtMs) { self.tick(dtMs); };
          ENG.registerUpdate(this._tickFn, 50);
        }
        BUS.emit('mode:started', { mode: 'kinghill', state: this.state });
        console.log('[MODE KH] started, section=1');
      } catch (e) { console.error('[MODE KH] start:', e); }
    },

    stop() {
      try {
        this.running = false;
        global.CT_RESPAWN_T = 0;
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
        global.CT_AI_WARN_T = 0;
        try { if (ENG) ENG.gameState = null; } catch (_) {}
      } catch (e) { console.error('[MODE KH] stop:', e); }
    },

    /* ========== 每帧 tick ========== */
    tick(dtMs) {
      if (!this.running || !this.state) return;
      const dt = dtMs / 1000;
      const s = this.state;

      if (s.phase === 'COMBAT') {
        s.sectionTimeLeft -= dt;
        this._tickHill(dt);
        // 周期生成增益道具（据点模式专属，丰富混战）
        s.pupTimer -= dt;
        if (s.pupTimer <= 0) { this._spawnBuffPowerup(s); s.pupTimer = s.pupInterval; }
        // AI 出场倒计时（战斗开始 5 秒内提示“AI 即将来袭”，归零时生成 AI）
        if ((s.aiSpawnT || 0) > 0) {
          s.aiSpawnT -= dt;
          global.CT_AI_WARN_T = Math.max(0, s.aiSpawnT);
          if (s.aiSpawnT <= 0) { global.CT_AI_WARN_T = 0; try { this._spawnAI(s); } catch (_) {} }
        }
        /* AI 坦克阵亡 → tick 驱动 5s 重生（修复“有时无法复活”）：
         * 仅 COMBAT 内生效，节末 _startPrepPhase 会清空 AI 由下一节重新生成；
         * 复活回原出生点附近安全位，并给 3s 无敌防止立刻被秒。 */
        for (let i = 0; i < s.tanks.length; i++) {
          const t = s.tanks[i];
          if (t && t.type !== 'player' && !t.alive && (t.respawnT || 0) > 0) {
            t.respawnT -= dt;
            if (t.respawnT <= 0) {
              t.respawnT = 0;
              const sp = t.spawnPos || { x: WORLD_W * 0.5, y: WORLD_H * 0.5 };
              const OB_TOOL = global.CT_OBSTACLE;
              let fp = sp;
              if (OB_TOOL && typeof OB_TOOL.findSafeSpawn === 'function') {
                fp = OB_TOOL.findSafeSpawn(s.obstacles, WORLD_W, WORLD_H, sp.x, sp.y, 80);
              }
              t.alive = true; t.hp = t.maxHp;
              t.pos.x = fp.x; t.pos.y = fp.y;
              if (t.spawnPos) { t.spawnPos.x = sp.x; t.spawnPos.y = sp.y; }
              if (t.setInvincible) t.setInvincible(3);
              BUS.emit('tank:revived', { target: t });
            }
          }
        }
        if (s.sectionTimeLeft <= 0) { this._onSectionEnd(); return; }
      }

      // 分派：玩家用 CT_INPUT 快照输入；敌人走 EnemyAI.update(dt, obstacles, aiTargets)
      const playerTanks = [];
      const enemyTanks = [];
      for (let i = 0; i < s.tanks.length; i++) {
        const pt = s.tanks[i];
        if (!pt || !pt.alive) continue;
        if (pt.type === 'player') playerTanks.push(pt);
        else enemyTanks.push(pt);
      }
      /* 据点争夺为自由混战：AI 既可锁定玩家，也可锁定其余 AI（各自 team 独立，
       * 碰撞层 _collide 已允许互伤）。玩家复活期间 playerTanks 为空，AI 随即互相
       * 追打，世界照常推进、未被击毁的坦克继续行动。_pickTarget 内部会排除自身。 */
      const aiTargets = playerTanks.concat(enemyTanks);
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
            t.update(dt, s.obstacles, aiTargets);
          }
        } catch (_) {}
      }
      for (let i = 0; i < s.obstacles.length; i++) {
        const o = s.obstacles[i]; if (!o) continue;
        try { if (typeof o.update === 'function') o.update(dt); } catch (_) {}
      }
      /* 增益道具：更新动画 + 玩家拾取（apply 临时 buff） */
      for (let i = 0; i < s.powerups.length; i++) {
        const p = s.powerups[i]; if (!p || p.alive === false) continue;
        try { if (typeof p.update === 'function') p.update(dt, s.obstacles, s.tanks); } catch (_) {}
      }
      for (let i = 0; i < s.tanks.length; i++) {
        const t = s.tanks[i]; if (!t || !t.alive || t.type !== 'player') continue;
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
      // 玩家复活倒计时（据点模式无限命）：dead 期间世界照常运行，其他坦克继续行动
      if (s.player && !s.player.alive && (s.playerRespawnT || 0) > 0) {
        s.playerRespawnT -= dt;
        global.CT_RESPAWN_T = Math.max(0, s.playerRespawnT);
        if (s.playerRespawnT <= 0) {
          const sp = s.player.spawnPos || { x: WORLD_W * 0.32, y: WORLD_H * 0.60 };
          s.player.alive = true;
          s.player.hp = s.player.maxHp;
          s.player.pos.x = sp.x; s.player.pos.y = sp.y;
          if (s.player.setInvincible) s.player.setInvincible(3);
          global.CT_RESPAWN_T = 0;
          BUS.emit('player:revived', { target: s.player });
        }
      }
      for (let i = 0; i < s.bullets.length; i++) {
        const b = s.bullets[i]; if (!b || !b.alive) continue;
        try {
          if (typeof b.update === 'function') b.update(dt, s);
          else {
            b.pos.x += (b.vel.x || 0) * dt * 60;
            b.pos.y += (b.vel.y || 0) * dt * 60;
            if (b.pos.x < 0 || b.pos.x > WORLD_W || b.pos.y < 0 || b.pos.y > WORLD_H) b.alive = false;
          }
        } catch (_) {}
      }

      this._collisionTick(dt);

      this._gcTimer += dt;
      if (this._gcTimer >= BULLET_GC_SEC) { this._gcTimer = 0; this._gcBullets(); }
      this._cleanupDeadEntities();
      if (s.hill && s.hill.flashT > 0) s.hill.flashT -= dt;
    },

    /* ========== 据点占领逻辑 ========== */
    _tickHill(dt) {
      const s = this.state; if (!s || !s.hill) return;
      const h = s.hill;
      let occupant = null;
      let contested = false;
      for (let i = 0; i < s.tanks.length; i++) {
        const t = s.tanks[i]; if (!t || !t.alive) continue;
        const dx = t.pos.x - h.x, dy = t.pos.y - h.y;
        if (dx * dx + dy * dy <= h.radius * h.radius) {
          if (occupant && occupant !== t) { contested = true; break; }
          occupant = t;
        }
      }
      if (contested) {
        h.captureProg = Math.max(0, h.captureProg - dt * 0.5);
        h.scoring = false;
        h.holder = null;
      } else if (occupant) {
        if (h.holder === occupant) {
          h.captureProg += dt;
          if (h.captureProg >= HILL_CAPTURE && !h.scoring) {
            h.scoring = true;
            h.flashT = 0.6;
            BUS.emit('kh:hillCaptured', { holder: occupant });
          }
          if (h.scoring) {
            const gain = HILL_SCORE_PER_SEC * dt;
            occupant.score = (occupant.score || 0) + gain;
            if (occupant.type === 'player') s.score += gain;
          }
        } else {
          h.holder = occupant;
          h.captureProg = 0;
          h.scoring = false;
        }
        /* 占领胜利条件：玩家在据点内（已开始计分）累计 HILL_WIN_HOLD 秒 → 直接获胜 */
        if (occupant.type === 'player' && h.holder === occupant) {
          s.playerHoldTime = (s.playerHoldTime || 0) + dt;
          const prevInt = Math.floor((s.playerHoldTime - dt) / 5);
          const curInt = Math.floor(s.playerHoldTime / 5);
          if (curInt > prevInt && s.playerHoldTime < HILL_WIN_HOLD) {
            try {
              global.CT_WAVE_BANNER && global.CT_WAVE_BANNER.show(
                '🚩 占领中 ' + Math.floor(s.playerHoldTime) + 's',
                'HOLD ' + HILL_WIN_HOLD + 's 获胜 · 剩余 ' + Math.ceil(HILL_WIN_HOLD - s.playerHoldTime) + 's',
                1400
              );
            } catch (_) {}
          }
          if (s.playerHoldTime >= HILL_WIN_HOLD) {
            try {
              global.CT_WAVE_BANNER && global.CT_WAVE_BANNER.show('🏆 据点占领成功', 'HILL SECURED', 2200);
            } catch (_) {}
            this._gameOver(true);
            return;
          }
        }
      } else {
        h.captureProg = Math.max(0, h.captureProg - dt * 0.3);
        if (h.captureProg === 0) { h.holder = null; h.scoring = false; }
      }
    },

    /* ========== 小节结束 ========== */
    _onSectionEnd() {
      const s = this.state; if (!s || !this.running) return;
      // 排名金币发放（配合节间商店上调：1st=220 / 2nd=140 / 3rd=80）
      const ranked = s.tanks.slice().sort((a, b) => (b.score || 0) - (a.score || 0));
      const rewards = SECTION_REWARDS;
      for (let i = 0; i < Math.min(3, ranked.length); i++) {
        const t = ranked[i]; if (!t) continue;
        const r = rewards[i] || 0;
        if (t.type === 'player') {
          t.coins = (t.coins || 0) + r;
          s.coins += r;
          BUS.emit('shop:coinsGained', { target: t, coins: r, reason: 'kh_rank_' + (i + 1) });
        }
      }
      BUS.emit('kh:sectionEnd', { section: s.section, ranking: ranked.map(t => ({ name: t.name, score: Math.round(t.score || 0), team: t.team })) });

      if (s.section >= SECTIONS) {
        this._gameOver(ranked[0] && ranked[0].type === 'player');
        return;
      }
      /* 节间进入备战：第 2 节起给足 SHOP_TIME 购买时间（商店已对 king-hill 开放） */
      this._startPrepPhase();
    },

    /* ========== 节间流程 ========== */
    _startPrepPhase() {
      const s = this.state; if (!s) return;
      /* 清理上一节残留 AI，本节的 AI 将在战斗开始 5 秒后重新生成 */
      s.tanks = s.tanks.filter(t => t && t.type === 'player');
      s.phase = 'PREPARING';
      // 据点位置切换到当前节
      const spotIdx = (s.section - 1) % HILL_SPOTS.length;
      if (s.hill) {
        s.hill.x = HILL_SPOTS[spotIdx].x;
        s.hill.y = HILL_SPOTS[spotIdx].y;
        s.hill.holder = null;
        s.hill.captureProg = 0;
        s.hill.scoring = false;
        s.hill.flashT = 0;
      }
      // 重生所有坦克（生成点做防围死/压块检测）
      const spawns = [
        { x: WORLD_W * 0.32, y: WORLD_H * 0.60 },
        { x: WORLD_W * 0.68, y: WORLD_H * 0.40 },
        { x: WORLD_W * 0.68, y: WORLD_H * 0.60 },
        { x: WORLD_W * 0.32, y: WORLD_H * 0.40 },
        { x: WORLD_W * 0.50, y: WORLD_H * 0.48 }
      ];
      const OB_TOOL = global.CT_OBSTACLE;
      for (let i = 0; i < s.tanks.length; i++) {
        const t = s.tanks[i]; if (!t) continue;
        let sp = spawns[i] || spawns[0];
        if (OB_TOOL && typeof OB_TOOL.findSafeSpawn === 'function') {
          sp = OB_TOOL.findSafeSpawn(s.obstacles, WORLD_W, WORLD_H, sp.x, sp.y, 300);
        }
        t.alive = true;
        t.hp = t.maxHp;
        t.pos.x = sp.x; t.pos.y = sp.y;
        if (t.spawnPos) { t.spawnPos.x = sp.x; t.spawnPos.y = sp.y; }
      }
      /* 据点争夺商店：第 1 节沿用短准备立刻开打，第 2 节起给 SHOP_TIME 秒购买间隔。
       * prep-phase 的商店白名单已包含 king-hill（并通过 normMode 兼容 'kinghill' 写法）。 */
      const self = this;
      try {
        PREP.start({
          seconds: (s.section > 1 ? SHOP_TIME : PREP_TIME),
          mode: 'kinghill',
          players: [s.player],
          mapInfo: s.mapInfo,
          onCombatStart: () => self._startCombatPhase()
        });
      } catch (e) { console.error('[kh] prep start', e); }
    },

    _startCombatPhase() {
      const s = this.state; if (!s) return;
      s.phase = 'COMBAT';
      s.sectionTimeLeft = SECTION_TIME;
      try { if (ENG && typeof ENG.setState === 'function') ENG.setState('COMBAT'); } catch (_) {}
      try { if (SHOP && typeof SHOP.lock === 'function') SHOP.lock(); } catch (_) {}
      BUS.emit('kh:sectionStart', { section: s.section });
      /* 战斗开始 3 秒后生成 AI 坦克：用倒计时驱动（HUD 显示“AI 即将来袭”），归零时生成 */
      s.aiSpawnT = 3;
      global.CT_AI_WARN_T = 3;
    },

    /** 生成 4 个 AI 阵营（战斗开始 5 秒后调用） */
    _spawnAI(s) {
      if (!s || !this.running) return;
      const aiColors = ['#ff4d6d', '#7cff6b', '#ffd166', '#c77dff'];
      const aiRanks = ['normal', 'fast', 'elite', 'normal'];
      const aiSpawn = [
        { x: WORLD_W * 0.70, y: WORLD_H * 0.38 },
        { x: WORLD_W * 0.70, y: WORLD_H * 0.62 },
        { x: WORLD_W * 0.30, y: WORLD_H * 0.38 },
        { x: WORLD_W * 0.50, y: WORLD_H * 0.50 }
      ];
      const OB_TOOL = global.CT_OBSTACLE;
      for (let i = 0; i < AI_COUNT; i++) {
        const raw = aiSpawn[i] || { x: 200 + i * 200, y: 200 };
        let sp = raw;
        if (OB_TOOL && typeof OB_TOOL.findSafeSpawn === 'function') {
          sp = OB_TOOL.findSafeSpawn(s.obstacles, WORLD_W, WORLD_H, raw.x, raw.y, 300);
        }
        let ai;
        try {
          ai = new EnemyCtor({ x: sp.x, y: sp.y, rank: aiRanks[i], wave: 3, type: 'enemy' });
        } catch (_) {
          ai = new TankCtor({ x: sp.x, y: sp.y, type: 'enemy' });
        }
        if (ai) {
          ai.color = aiColors[i % aiColors.length];
          ai.rank = aiRanks[i];
          ai.team = i + 1;
          ai.name = 'AI-' + (i + 1);
          ai.score = 0;
          s.tanks.push(ai);
        }
      }
    },

    /** 据点模式：随机生成一颗增益道具（玩家拾取获得临时 buff），丰富自由混战 */
    _spawnBuffPowerup(s) {
      if (!s || !this.running) return;
      const PW = global.CT_POWERUP;
      if (!PW || typeof PW.spawn !== 'function') return;
      /* 偏增益向的道具池：治疗/急速/三连射/护盾/激光/磁吸/升级芯片/侦察无人机 */
      const BUFF_IDS = ['P01', 'P02', 'P03', 'P04', 'P05', 'P06', 'P09', 'P15'];
      const id = BUFF_IDS[(Math.random() * BUFF_IDS.length) | 0];
      const h = s.hill;
      const OB_TOOL = global.CT_OBSTACLE;
      let sp = null;
      for (let tries = 0; tries < 14; tries++) {
        const x = 120 + Math.random() * (WORLD_W - 240);
        const y = 120 + Math.random() * (WORLD_H - 240);
        if (h && Math.hypot(x - h.x, y - h.y) < h.radius + 90) continue; // 不压在据点上
        if (OB_TOOL && typeof OB_TOOL.findSafeSpawn === 'function') {
          sp = OB_TOOL.findSafeSpawn(s.obstacles, WORLD_W, WORLD_H, x, y, 80);
        } else { sp = { x, y }; }
        if (sp) break;
      }
      if (!sp) sp = { x: WORLD_W * 0.5, y: WORLD_H * 0.5 };
      const p = PW.spawn(sp.x, sp.y, id);
      if (p) {
        s.powerups.push(p);
        BUS.emit('powerup:spawned', { powerup: p, id: id });
      }
    },

    _showBuffSelection() {
      const s = this.state; if (!s) return;
      s.phase = 'BUFF_SELECT';
      try { if (ENG && typeof ENG.setState === 'function') ENG.setState('BUFF_SELECT'); } catch (_) {}
      try {
        const mods = {};
        if (s.player.flags && s.player.flags.nextBuffRarityUp) { mods.rarityUp = true; s.player.flags.nextBuffRarityUp = false; }
        const cards = BUFF.generateThreeCards(s.player, mods) || [];
        BUS.emit('ui:showBuffSelection', { cards, mode: 'kinghill', section: s.section, rerollAvailable: !!(s.player.flags && s.player.flags.nextBuffReroll) });
        if (!global.CT_UI_BUFF) {
          const self = this;
          setTimeout(() => self._onBuffSelected({ defId: cards[0] && cards[0].id }), 100);
        }
      } catch (e) {
        console.warn('[kh] buff fallback', e);
        this._nextSection();
      }
    },

    _onBuffSelected(evt) {
      const s = this.state; if (!s || !this.running) return;
      evt = evt || {};
      if (evt.defId) { try { BUFF.applySelection(s.player, evt.defId); } catch (_) {} }
      BUS.emit('ui:hideBuffSelection');
      this._nextSection();
    },

    _nextSection() {
      const s = this.state; if (!s) return;
      s.section += 1;
      this._startPrepPhase();
    },

    _onTankDead(evt) {
      const s = this.state; if (!s || !this.running) return;
      const dead = evt && evt.dead; if (!dead) return;
      if (dead.type === 'player') {
        // 占点模式：玩家无限命 → 阵亡 3s 后重生（tick 驱动，便于显示复活倒计时）
        s.playerRespawnT = 3;
        global.CT_RESPAWN_T = 3;
        return;
      }
      s.kills += 1;
      s.score += 50;
      /* 占点模式 AI 不淘汰、保持竞争：坦克阵亡后由 tick 驱动 5s 重生
       * （替代 setTimeout：避免节末清空 AI、暂停/停止时计时器仍触发，
       * 导致“有时无法复活 / 复活后已不在场”的问题）。 */
      dead.respawnT = 5;
    },

    _gameOver(victory) {
      const s = this.state; if (!s || !this.running) return;
      this.running = false;
      global.CT_RESPAWN_T = 0;
      global.CT_AI_WARN_T = 0;
      s.phase = victory ? 'VICTORY' : 'GAMEOVER';
      try { if (ENG && typeof ENG.setState === 'function') ENG.setState('GAMEOVER'); } catch (_) {}
      try {
        if (STORAGE && typeof STORAGE.updateRecord === 'function') {
          const hs = Math.max(s.highScore, Math.round(s.score));
          STORAGE.updateRecord('kinghill', { highScore: hs });
          s.highScore = hs;
        }
      } catch (_) {}
      const payload = {
        victory: !!victory, mode: 'kinghill', section: s.section,
        score: Math.round(s.score), kills: s.kills, coins: s.coins,
        /* result.js 结算面板从 stats.* 读取统计数据 */
        stats: {
          score: Math.round(s.score), kills: s.kills,
          surviveTime: s.playerHoldTime || 0,
          /* 完成度：占领累计时长 / 占领获胜所需时长；获胜即满 */
          progress: victory ? 1 : Math.max(0, Math.min(1, (s.playerHoldTime || 0) / HILL_WIN_HOLD))
        },
        rewardsCoins: 0
      };
      try {
        if (UI_RES && typeof UI_RES.show === 'function') UI_RES.show(payload);
        else console.log('[MODE KH] result', payload);
      } catch (_) { console.log('[MODE KH] result', payload); }
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
      for (let i = 0; i < tanks.length; i++) {
        const a = tanks[i]; if (!a || !a.alive) continue;
        for (let j = i + 1; j < tanks.length; j++) {
          const b = tanks[j]; if (!b || !b.alive) continue;
          if (a.team != null && b.team != null && a.team === b.team) continue;
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
            if (b.bounces && b.bounces > 0) {
              b.bounces -= 1;
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
          if (b._ownerTeam != null && t.team != null && b._ownerTeam === t.team) continue;
          const tb = t.aabb; if (!tb) continue;
          if (PHYS.aabb(bb, tb)) {
            if (b._hitSet && b._hitSet.has(t)) continue;
            let dmg = (b.damage || 1) * (t.muls && t.muls.dr != null ? Math.max(0, 1 - t.muls.dr) : 1);
            if (t.shield > 0) { const absorb = Math.min(t.shield, dmg); t.shield -= absorb; dmg -= absorb; }
            if (t.takeDamage) { try { t.takeDamage(dmg); } catch (_) { t.hp -= dmg; } } else { t.hp -= dmg; }
            BUS.emit('tank:hit', { target: t, dmg, bullet: b, attacker: b.owner });
            if (b._hitSet) b._hitSet.add(t);
            if (b.pierce && b.pierce > 0) b.pierce -= 1; else b.alive = false;
            if (t.hp <= 0 && t.alive) {
              t.alive = false;
              BUS.emit('tank:dead', { dead: t, killer: b.owner, team: t.team });
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
      // 占点模式不淘汰坦克（重生机制），只清理障碍/道具
      s.obstacles = s.obstacles.filter(o => o && o.alive !== false);
      s.powerups = s.powerups.filter(p => p && p.alive !== false);
    },

    /* ========== 渲染据点（fx 层，爆款占点游戏风格：控制点环 + 占领进度槽）========== */
    _renderHill(ctx) {
      const s = this.state; if (!s || !s.hill || !ctx) return;
      const h = s.hill;
      const cam = RENDER.camera || { x: 0, y: 0, zoom: 1 };
      const z = cam.zoom || 1;
      const sx = (h.x - cam.x) * z;
      const sy = (h.y - cam.y) * z;
      const r = h.radius * z;
      if (r < 2) return;
      ctx.save();

      // 状态色：争夺中(橙红) / 已占领(绿) / 被某方占据(该方色) / 中立(冷蓝)
      const holderColor = (h.holder && h.holder.color) || '#ffd700';
      const contested = this._hillContested(s, h);
      const baseColor = contested ? '#ff7a1a'
        : (h.scoring ? '#00ff9d'
          : (h.holder ? holderColor : '#9fb4d8'));

      // 1) 地面占领区径向渐变填充
      const grad = ctx.createRadialGradient(sx, sy, r * 0.1, sx, sy, r);
      grad.addColorStop(0, this._rgba(baseColor, 0.20));
      grad.addColorStop(1, this._rgba(baseColor, 0.02));
      ctx.fillStyle = grad;
      ctx.beginPath(); ctx.arc(sx, sy, r, 0, Math.PI * 2); ctx.fill();

      // 2) 外圈旋转虚线环（占点标志感）
      const t = Date.now() / 1000;
      ctx.save();
      ctx.translate(sx, sy);
      ctx.rotate(t * 0.4);
      ctx.setLineDash([10 * z, 8 * z]);
      ctx.lineWidth = 2;
      ctx.strokeStyle = this._rgba(baseColor, 0.55);
      ctx.shadowColor = baseColor; ctx.shadowBlur = 12;
      ctx.beginPath(); ctx.arc(0, 0, r - 4, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();

      // 3) 实心内圈
      ctx.setLineDash([]);
      ctx.lineWidth = 3;
      ctx.strokeStyle = baseColor;
      ctx.shadowColor = baseColor;
      ctx.shadowBlur = h.scoring ? 28 : (contested ? 22 : 14);
      ctx.beginPath(); ctx.arc(sx, sy, r - 14 * z, 0, Math.PI * 2); ctx.stroke();

      // 4) 占领进度弧（顺时针填充，类守望先锋占领槽）
      const p = Math.min(1, (h.captureProg || 0) / HILL_CAPTURE);
      if (p > 0) {
        ctx.lineWidth = 6 * z;
        ctx.strokeStyle = h.scoring ? '#00ff9d' : (contested ? '#ff9a3c' : '#00f0ff');
        ctx.shadowColor = ctx.strokeStyle; ctx.shadowBlur = 18;
        ctx.beginPath();
        ctx.arc(sx, sy, r - 14 * z, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * p);
        ctx.stroke();
      }

      // 5) 争夺中：红色脉冲外扩环
      if (contested) {
        const pulse = (Date.now() % 900) / 900;
        ctx.setLineDash([]);
        ctx.globalAlpha = 1 - pulse;
        ctx.lineWidth = 3;
        ctx.strokeStyle = '#ff3b30';
        ctx.shadowColor = '#ff3b30'; ctx.shadowBlur = 16;
        ctx.beginPath(); ctx.arc(sx, sy, r + pulse * 22 * z, 0, Math.PI * 2); ctx.stroke();
        ctx.globalAlpha = 1;
      }

      // 6) 中心六边形占点图标
      ctx.setLineDash([]);
      const mSize = 14 * z;
      ctx.fillStyle = baseColor;
      ctx.shadowColor = baseColor; ctx.shadowBlur = 16;
      ctx.beginPath();
      for (let k = 0; k < 6; k++) {
        const a = -Math.PI / 2 + k * Math.PI / 3;
        const px = sx + Math.cos(a) * mSize, py = sy + Math.sin(a) * mSize;
        if (k === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.closePath(); ctx.fill();

      // 7) 已占领：绿色脉冲光圈
      if (h.scoring) {
        const pulse = (Date.now() % 1400) / 1400;
        ctx.strokeStyle = 'rgba(0,255,157,0.4)';
        ctx.lineWidth = 2; ctx.shadowBlur = 0;
        ctx.beginPath(); ctx.arc(sx, sy, r + pulse * 20 * z, 0, Math.PI * 2); ctx.stroke();
      }
      ctx.restore();
    },

    _hillContested(s, h) {
      let n = 0;
      const tanks = s.tanks;
      for (let i = 0; i < tanks.length; i++) {
        const t = tanks[i]; if (!t || !t.alive) continue;
        const dx = t.pos.x - h.x, dy = t.pos.y - h.y;
        if (dx * dx + dy * dy <= h.radius * h.radius) n++;
        if (n >= 2) return true;
      }
      return false;
    },

    _rgba(hex, a) {
      if (typeof hex !== 'string' || hex[0] !== '#' || hex.length < 7) return hex;
      const v = hex.slice(1);
      const r = parseInt(v.substring(0, 2), 16);
      const g = parseInt(v.substring(2, 4), 16);
      const b = parseInt(v.substring(4, 6), 16);
      return 'rgba(' + r + ',' + g + ',' + b + ',' + a + ')';
    },

    /* ========== 绑定事件 ========== */
    _bindAll() {
      const self = this;
      const binds = [
        /* prep:combatStart 不绑 BUS（PREP.start 的 onCombatStart 回调已驱动，避免双重触发） */
        ['ui:buffSelected',  (e)=> { try { self._onBuffSelected(e); } catch(e){console.error(e);} }],
        ['tank:dead',        (e)=> { try { self._onTankDead(e); } catch(e){console.error(e);} }],
        ['wave:spawnEnemy',  (e)=> { try { self._onSpawnEnemy(e); } catch(e){console.error(e);} }]
      ];
      this._bindings = [];
      for (let i = 0; i < binds.length; i++) {
        BUS.on(binds[i][0], binds[i][1]);
        this._bindings.push({ e: binds[i][0], fn: binds[i][1] });
      }
    },

    _onSpawnEnemy(evt) {
      const s = this.state; if (!s) return;
      evt = evt || {};
      const enemy = evt.enemy; if (!enemy) return;
      enemy._ownerRef = enemy;
      s.tanks.push(enemy);
    }
  };

  global.CT_MODE_KH = CT_MODE_KH;
})(typeof window !== 'undefined' ? window : globalThis);

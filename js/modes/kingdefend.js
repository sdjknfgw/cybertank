/* ==========================================================
 * CYBERTANK · King Defense Mode — 据点守护模式
 * 命名空间: window.CT_MODE_KINGDEFEND
 * 核心玩法：
 *  - 地图中央放置「可被破坏的据点核心」(baseHp)，敌方子弹命中即扣血；
 *  - 仅当据点核心被摧毁时才判定游戏失败（坦克无限复活，玩家阵亡不判负）；
 *  - 无尽波次进攻：每波敌人从地图四边涌入，清完一波后短暂间歇再下一波；
 *  - 敌人同时锁定“玩家”与“据点核心”，据点暴露在火力下需要玩家主动拦截。
 * ========================================================== */
(function (global) {
  'use strict';

  // ---------- 依赖安全兜底 ----------
  const BUS   = global.CT_BUS       || { on(){}, off(){}, emit(){} };
  const ENG   = global.CT_ENGINE    || {};
  const RENDER= global.CT_RENDERER  || { camera:{}, world:{w:2400,h:1600}, getCtx:()=>null };
  const PHYS  = global.CT_PHYSICS   || { aabb(){return false;}, resolveCollision(){} };
  const PREP  = global.CT_PREP      || { start(){}, cancel(){} };
  const BUFF  = global.CT_BUFF      || { generateThreeCards:()=>[], applySelection:()=>({ok:false}), tickTimers(){} };
  const STORAGE=global.CT_STORAGE    || { updateRecord(){}, getRecord:()=>({bestWave:0}) };
  const TANK_NS=global.CT_TANK      || {};
  const OB_NS = global.CT_OBSTACLE   || {};
  const BUL_NS= global.CT_BULLET     || { spawn(){return null;}, Pool:{ acquire:()=>({alive:false}), release(){} } };
  const ENEMY_NS=global.CT_ENEMY     || {};
  const PW_NS = global.CT_POWERUP    || null;
  const UI_RES= global.CT_UI_RESULT  || null;

  const TankCtor   = TANK_NS.Tank || function TankStub(o){ o=o||{}; this.pos={x:o.x||0,y:o.y||0}; this.spawnPos={...this.pos}; this.hp=o.maxHp||3; this.maxHp=this.hp; this.alive=true; this._w=56;this._h=56; this.aabb={x:this.pos.x-28,y:this.pos.y-28,w:56,h:56}; this.muls={dmg:1,fireRate:1,speed:1,dr:0,pierce:0,splash:0,coinGain:1}; this.flags={}; this.tempBuffs=[]; this.type=o.type||'player'; this.shield=0; this.coins=0; };
  const EnemyCtor  = (ENEMY_NS && ENEMY_NS.EnemyAI) || TankCtor;
  const WallBrick  = OB_NS.WallBrick || function (o){ return {alive:true,blockTank:true,blockBullet:true,type:'brick',hp:2,_box:{x:o.x,y:o.y,w:o.w||64,h:o.h||64}, get aabb(){return this._box;}, update(){}, render(){} }; };
  const WallSteel  = OB_NS.WallSteel || WallBrick;
  /* 新地形：草丛(隐身) / 水(挡车不挡弹) / 冰(打滑) / 泥(减速) / 传送门(P/Q 成对) */
  const Bush       = OB_NS.Bush   || null;
  const Water      = OB_NS.Water  || null;
  const Ice        = OB_NS.Ice    || null;
  const Mud        = OB_NS.Mud    || null;
  const Portal     = OB_NS.Portal || null;

  // ---------- 常量 ----------
  const PREP_TIME = 3;            // 开局短准备（立刻进入战斗，波次倒计时随即启动 —— req2）
  const BASE_MAX_HP = 100;        // 据点核心耐久
  const INTERMISSION = 4;          // 清完一波后的间歇（秒）
  const BULLET_GC_SEC = 5;
  const PLAYER_RESPAWN = 5;       // 玩家无限复活：阵亡 5s 后重生（D-09 延长保护）
  const PUP_FIRST = 8;            // 首颗增益道具掉落延迟
  const PUP_INTERVAL = 16;        // 之后每 16s 一颗

  /* ==========================================================
   * 难度档位配置（据点守护）
   * 影响：据点耐久 / 每波敌人数量与成长 / 快速·精英兵出现波次与概率 / 波间歇 / 得分倍率
   * ========================================================== */
  const DIFF_CONFIG = {
    easy:   { label: '简单', baseHp: 150, countBase: 3, countStep: 0.7, countMax: 10, fastWave: 6, fastRate: 0.35, eliteWave: 12, eliteRate: 0.15, intermission: 6, scoreMul: 0.80 },
    normal: { label: '普通', baseHp: 100, countBase: 4, countStep: 1.0, countMax: 16, fastWave: 4, fastRate: 0.55, eliteWave: 8,  eliteRate: 0.28, intermission: 4, scoreMul: 1.00 },
    hard:   { label: '困难', baseHp: 80,  countBase: 5, countStep: 1.2, countMax: 20, fastWave: 3, fastRate: 0.65, eliteWave: 5,  eliteRate: 0.38, intermission: 3, scoreMul: 1.35 },
    night:  { label: '噩梦', baseHp: 60,  countBase: 6, countStep: 1.5, countMax: 26, fastWave: 2, fastRate: 0.75, eliteWave: 3,  eliteRate: 0.50, intermission: 2, scoreMul: 1.80 }
  };
  function getDiffCfg(d) { return DIFF_CONFIG[d] || DIFF_CONFIG.normal; }
  /* 排行存储键：按难度分档，互不覆盖 */
  function rankKey(d) { return 'kingdefend_' + (DIFF_CONFIG[d] ? d : 'normal'); }
  /* 最终得分 → 评级 */
  function ratingOf(score) {
    if (score >= 60000) return 'S';
    if (score >= 35000) return 'A';
    if (score >= 18000) return 'B';
    if (score >= 8000) return 'C';
    return 'D';
  }

  /* 地图模板（基础 26×16，加载期统一放大 2 倍 → 52×32，中央留空放据点核心） */
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
   * 装饰：左上角用钢块拼出 "ccr"（5×5 点阵、scale=1 ≈ 1088×320px，不至于过大）。 */
  const MAP_TEMPLATE = (function () {
    let t = _BASE_MAP;
    if (OB_NS && typeof OB_NS.enlargeTemplate === 'function') t = OB_NS.enlargeTemplate(t, 2);
    if (OB_NS && typeof OB_NS.stampText === 'function') {
      t = OB_NS.stampText(t, 'ccr', { row: 3, col: 3, ch: 'S', scale: 1, gap: 1, clear: true });
    }
    return t;
  })();
  const WORLD_W = MAP_TEMPLATE[0].length * 64;
  const WORLD_H = MAP_TEMPLATE.length * 64;

  function createMapFromTemplate(template, tileSize) {
    tileSize = tileSize || 64;
    const cols = template[0].length;
    const rows = template.length;
    const totalW = cols * tileSize;
    const totalH = rows * tileSize;
    const offX = 0, offY = 0;
    const obstacles = [];
    let portalSeq = 0, lastPortal = null;
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
          const p = new Portal({ id: 'kd_portal_' + portalSeq, pairId: null, x, y, w: tileSize, h: tileSize });
          if (lastPortal && !lastPortal.portalPairId) { lastPortal.portalPairId = p.portalId; p.portalPairId = lastPortal.portalId; lastPortal = null; }
          else { lastPortal = p; }
          obstacles.push(p);
        }
      }
    }
    return { obstacles, w: totalW, h: totalH, tile: tileSize, offX, offY };
  }

  /* ==========================================================
   * CT_MODE_KINGDEFEND 主对象
   * ========================================================== */
  const CT_MODE_KINGDEFEND = {
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
        const dcfg = getDiffCfg(difficulty);

        const mapInfo = createMapFromTemplate(MAP_TEMPLATE, 64);
        const OB_TOOL = global.CT_OBSTACLE;
        const safePt = (x, y) => {
          if (OB_TOOL && typeof OB_TOOL.findSafeSpawn === 'function') {
            return OB_TOOL.findSafeSpawn(mapInfo.obstacles, WORLD_W, WORLD_H, x, y, 420);
          }
          return { x, y };
        };

        // 据点核心位置（地图中央）
        const baseCX = WORLD_W * 0.5;
        const baseCY = WORLD_H * 0.5;
        const baseX = baseCX - 48;
        const baseY = baseCY - 48;

        // 玩家（据点正下方）
        const pSpawn = safePt(WORLD_W * 0.5, WORLD_H * 0.5 + 170);
        const player = new TankCtor({
          x: pSpawn.x, y: pSpawn.y,
          type: 'player', tankClass, color: skin, name: 'Player'
        });
        player.difficulty = difficulty;
        player.team = 0;

        // 据点核心：可破坏障碍（blockTank + blockBullet + _isBase）
        const base = {
          type: 'crystal_base',
          alive: true,
          hp: dcfg.baseHp, maxHp: dcfg.baseHp,
          blockTank: true, blockBullet: true, traction: 1,
          _isBase: true,
          _box: { x: baseX, y: baseY, w: 96, h: 96 },
          get aabb() { return this._box; },
          pos: { x: baseCX, y: baseCY },
          update() {}, render() {}
        };
        mapInfo.obstacles.push(base);

        // 据点“伪目标”：仅用于让敌方 AI 锁定核心（不在 s.tanks 内，不会被子弹命中）
        // _baseObstacle 回指核心方块：AI 做视线检测时要排除它，
        // 否则「目标点在核心内部」会让射线被核心自己挡住 → AI 永不开火。
        const baseTarget = {
          type: 'player', alive: true, inBush: false,
          pos: { x: baseCX, y: baseCY },
          vel: { x: 0, y: 0 },
          hp: 1, team: 99,
          name: '据点核心', _isBaseProxy: true,
          _baseObstacle: base
        };

        this.state = {
          mode: 'kingdefend',
          phase: 'PREPARING',
          wave: 0,
          maxWave: Infinity,
          difficulty,
          base,
          baseHp: dcfg.baseHp, baseMaxHp: dcfg.baseHp,
          baseTarget,
          player,
          tanks: [player],
          obstacles: mapInfo.obstacles,
          bullets: [],
          powerups: [],
          pupTimer: PUP_FIRST,
          pupInterval: PUP_INTERVAL,
          intermission: dcfg.intermission,
          cfg: dcfg,           // 难度配置（波次/据点/得分均按此缩放）
          elapsed: 0,          // 坚守时长（计分与排行用）
          mapInfo: { ...mapInfo, w: WORLD_W, h: WORLD_H, centerX: baseCX, centerY: baseCY },
          score: 0,
          kills: 0,
          coins: 0
        };
        ENG.gameState = this.state;
        try { if (RENDER.world) { RENDER.world.w = WORLD_W; RENDER.world.h = WORLD_H; } } catch (_) {}
        try { RENDER.fitWorldToView(); } catch (_) { try { RENDER.camera.target = player; } catch (_) {} }

        this._bindAll();

        if (ENG && typeof ENG.registerRender === 'function') {
          const self = this;
          this._renderFn = function (ctx) { self._renderBase(ctx); };
          ENG.registerRender(this._renderFn, 'fx');
        }

        this._startPrepPhase();

        if (ENG && typeof ENG.registerUpdate === 'function') {
          const self = this;
          this._tickFn = function (dtMs) { self.tick(dtMs); };
          ENG.registerUpdate(this._tickFn, 50);
        }
        BUS.emit('mode:started', { mode: 'kingdefend', state: this.state });
        console.log('[MODE KINGDEFEND] started');
      } catch (e) { console.error('[MODE KINGDEFEND] start:', e); }
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
        try { if (ENG) ENG.gameState = null; } catch (_) {}
      } catch (e) { console.error('[MODE KINGDEFEND] stop:', e); }
    },

    /* ========== 每帧 tick ========== */
    tick(dtMs) {
      if (!this.running || !this.state) return;
      const dt = dtMs / 1000;
      const s = this.state;

      if (s.phase === 'COMBAT') {
        const cfg = s.cfg || DIFF_CONFIG.normal;
        s.elapsed = (s.elapsed || 0) + dt;   // 坚守时长（计分 / 排行）
        // 波次推进：当前波敌人清空 → 间歇倒计时 → 下一波
        let aliveEnemies = 0;
        for (let i = 0; i < s.tanks.length; i++) {
          const t = s.tanks[i];
          if (t && t.type === 'enemy' && t.alive) aliveEnemies++;
        }
        if (aliveEnemies === 0) {
          s.intermission -= dt;
          if (s.intermission <= 0) {
            s.wave += 1;
            this._spawnWave(s, s.wave);
            s.intermission = cfg.intermission;
          }
        } else {
          s.intermission = cfg.intermission;
        }

        // 周期生成增益道具（丰富混战，也便于演示增益倒计时 —— req5）
        s.pupTimer -= dt;
        if (s.pupTimer <= 0) { this._spawnBuffPowerup(s); s.pupTimer = s.pupInterval; }

        // 失败判定：仅据点被摧毁
        if (s.baseHp <= 0) { this._gameOver(false); return; }
      }

      // 玩家输入快照
      const playerTanks = [];
      const enemyTanks = [];
      for (let i = 0; i < s.tanks.length; i++) {
        const t = s.tanks[i];
        if (!t || !t.alive) continue;
        if (t.type === 'player') playerTanks.push(t);
        else enemyTanks.push(t);
      }
      // 敌方目标：玩家（若在场）+ 据点核心伪目标
      const aiTargets = [];
      for (let i = 0; i < playerTanks.length; i++) aiTargets.push(playerTanks[i]);
      if (s.baseTarget) aiTargets.push(s.baseTarget);

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
      for (let i = 0; i < s.powerups.length; i++) {
        const p = s.powerups[i]; if (!p || p.alive === false) continue;
        try { if (typeof p.update === 'function') p.update(dt, s.obstacles, s.tanks); } catch (_) {}
      }
      // 玩家拾取增益道具
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

      // 玩家无限复活：阵亡期间世界照常，倒计时结束后回到据点旁
      if (s.player && !s.player.alive && (s.playerRespawnT || 0) > 0) {
        s.playerRespawnT -= dt;
        global.CT_RESPAWN_T = Math.max(0, s.playerRespawnT);
        if (s.playerRespawnT <= 0) {
          const sp = s.player.spawnPos || { x: WORLD_W * 0.5, y: WORLD_H * 0.5 + 170 };
          s.player.alive = true;
          s.player.hp = s.player.maxHp;
          s.player.pos.x = sp.x; s.player.pos.y = sp.y;
          // 复活保护增强（D-09）：延长无敌 + 短暂加速 + 预警横幅
          s.player.respawnBoostT = 5;
          try { if (s.player.setInvincible) s.player.setInvincible(5); } catch (_) {}
          global.CT_RESPAWN_T = 0;
          BUS.emit('player:revived', { target: s.player });
          try { global.CT_WAVE_BANNER && global.CT_WAVE_BANNER.show('🛡 复活保护 5s', '无敌 + 加速', 1500); } catch (_) {}
        }
      }
      // 复活保护期内给玩家加速（直接调节 muls.speed，避免依赖未知坦克方法）
      if (s.player && s.player.alive && (s.player.respawnBoostT || 0) > 0) {
        s.player.respawnBoostT -= dt;
        if (s.player.muls && typeof s.player.muls.speed === 'number') {
          if (s.player._boostBaseSpeed == null) s.player._boostBaseSpeed = s.player.muls.speed;
          s.player.muls.speed = s.player._boostBaseSpeed * 1.5;
        }
        if (s.player.respawnBoostT <= 0 && s.player.muls && typeof s.player.muls.speed === 'number') {
          if (s.player._boostBaseSpeed != null) s.player.muls.speed = s.player._boostBaseSpeed;
          s.player._boostBaseSpeed = null;
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
    },

    /* ========== 波次生成 ========== */
    _spawnWave(s, wave) {
      if (!s || !this.running) return;
      const cfg = (s && s.cfg) || DIFF_CONFIG.normal;
      const count = Math.min(Math.round(cfg.countBase + wave * cfg.countStep), cfg.countMax);
      const edges = [
        { x: WORLD_W * 0.5, y: 70 },
        { x: 70, y: WORLD_H * 0.5 },
        { x: WORLD_W - 70, y: WORLD_H * 0.5 },
        { x: WORLD_W * 0.5, y: WORLD_H - 70 }
      ];
      const OB_TOOL = global.CT_OBSTACLE;
      for (let i = 0; i < count; i++) {
        const rank = this._pickRank(wave, i, cfg);
        const e = edges[i % edges.length];
        let sp = { x: e.x + (Math.random() - 0.5) * 220, y: e.y + (Math.random() - 0.5) * 220 };
        if (OB_TOOL && typeof OB_TOOL.findSafeSpawn === 'function') {
          sp = OB_TOOL.findSafeSpawn(s.obstacles, WORLD_W, WORLD_H, sp.x, sp.y, 300);
        }
        let ai;
        try {
          ai = new EnemyCtor({ x: sp.x, y: sp.y, rank: rank, wave: wave, type: 'enemy' });
        } catch (_) {
          ai = new TankCtor({ x: sp.x, y: sp.y, type: 'enemy' });
        }
        if (ai) {
          ai.team = 1;
          ai.name = '敌军-' + (i + 1);
          ai.score = 0;
          this._bindEnemyBullets(ai, s);
          s.tanks.push(ai);
        }
      }
      try {
        global.CT_WAVE_BANNER && global.CT_WAVE_BANNER.show(
          '⚔ 第 ' + wave + ' 波来袭', 'WAVE ' + wave + ' · INCOMING', 1800
        );
      } catch (_) {}
    },

    /* 兵种按难度档位缩放：难度越高，快速兵/精英兵越早出现、概率越高 */
    _pickRank(wave, i, cfg) {
      cfg = cfg || DIFF_CONFIG.normal;
      const r = Math.random();
      if (wave >= cfg.eliteWave && r < cfg.eliteRate) return 'elite';
      if (wave >= cfg.fastWave && r < cfg.fastRate) return 'fast';
      return 'normal';
    },

    /* 绑定敌方开火 → 子弹进入本局 s.bullets（各模式通用写法） */
    _bindEnemyBullets(enemy, s) {
      if (enemy._bulletBound) return;
      enemy._bulletBound = true;
      const orig = enemy.fire || enemy._fireBullet;
      if (typeof orig === 'function') {
        enemy.fire = function () {
          const ret = orig.apply(this, arguments);
          if (ret && ret.bullets) {
            for (let k = 0; k < ret.bullets.length; k++) {
              const b = ret.bullets[k];
              b._ownerRef = this;
              if (b.owner === undefined || b.owner === null) b.owner = 'enemy';
              if (b._ownerTeam === undefined) b._ownerTeam = this.team;
              s.bullets.push(b);
            }
          }
          return ret;
        };
      }
    },

    /* 周期生成增益道具（与据点争夺一致：玩家拾取触发 req5 倒计时） */
    _spawnBuffPowerup(s) {
      if (!s || !this.running || !PW_NS) return;
      const BUFF_IDS = ['P01', 'P02', 'P03', 'P04', 'P05', 'P06', 'P09', 'P15'];
      const id = BUFF_IDS[(Math.random() * BUFF_IDS.length) | 0];
      const OB_TOOL = global.CT_OBSTACLE;
      let sp = null;
      for (let tries = 0; tries < 14; tries++) {
        const x = 120 + Math.random() * (WORLD_W - 240);
        const y = 120 + Math.random() * (WORLD_H - 240);
        if (OB_TOOL && typeof OB_TOOL.findSafeSpawn === 'function') {
          sp = OB_TOOL.findSafeSpawn(s.obstacles, WORLD_W, WORLD_H, x, y, 80);
        } else { sp = { x, y }; }
        if (sp) break;
      }
      if (!sp) sp = { x: WORLD_W * 0.5, y: WORLD_H * 0.5 };
      try {
        const p = PW_NS.spawn(sp.x, sp.y, id);
        if (p) { s.powerups.push(p); BUS.emit('powerup:spawned', { powerup: p, id: id }); }
      } catch (_) {}
    },

    /* ========== 准备期 / 战斗期 ========== */
    _startPrepPhase() {
      const s = this.state; if (!s) return;
      s.phase = 'PREPARING';
      const self = this;
      try {
        PREP.start({
          seconds: PREP_TIME,
          mode: 'kingdefend',
          players: [s.player],
          mapInfo: s.mapInfo,
          onCombatStart: () => self._startCombatPhase()
        });
      } catch (e) { console.error('[kd] prep start', e); }
    },

    _startCombatPhase() {
      const s = this.state; if (!s) return;
      s.phase = 'COMBAT';
      s.wave = 1;
      try { if (ENG && typeof ENG.setState === 'function') ENG.setState('COMBAT'); } catch (_) {}
      try { if (global.CT_SHOP && typeof global.CT_SHOP.lock === 'function') global.CT_SHOP.lock(); } catch (_) {}
      BUS.emit('kh:sectionStart', { section: s.wave });
      // 立即放出第一波（波次倒计时随即启动 —— req2）
      this._spawnWave(s, 1);
      s.intermission = (s.cfg || DIFF_CONFIG.normal).intermission;
    },

    /* ========== 碰撞 ========== */

    /* 判断子弹是否属于玩家（用于「玩家火力不伤自家据点」）。
     * 不同来源的子弹归属字段写法不一致，这里三种都兼容：
     *   - Tank._fire()        → owner = self.type（'player' / 'enemy'）
     *   - _bindEnemyBullets  → owner='enemy' + _ownerTeam=this.team
     *   - _ownerRef          直接指向发射者本人（最可靠，优先判断） */
    _isPlayerBullet(s, b) {
      if (!b || !s) return false;
      if (s.player && b._ownerRef && b._ownerRef === s.player) return true;
      if (b.owner === 'player') return true;
      if (b._ownerTeam === 0) return true;
      return false;
    },

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
          if (PHYS.aabb(ab, ob)) { try { PHYS.resolveCollision(t, o); } catch (_) {} }
        }
      }

      // 2. Tank vs Tank（同队免伤）
      for (let i = 0; i < tanks.length; i++) {
        const a = tanks[i]; if (!a || !a.alive) continue;
        for (let j = i + 1; j < tanks.length; j++) {
          const b = tanks[j]; if (!b || !b.alive) continue;
          if (a.team != null && b.team != null && a.team === b.team) continue;
          try { PHYS.resolveCollision(a, b); } catch (_) {}
        }
      }

      // 3. Bullet vs Obstacle（含据点核心扣血）
      for (let i = 0; i < bullets.length; i++) {
        const b = bullets[i]; if (!b || !b.alive) continue;
        const bb = { x: (b.pos.x - (b.radius || 4)), y: (b.pos.y - (b.radius || 4)), w: (b.radius || 4) * 2, h: (b.radius || 4) * 2 };
        const fromPlayer = this._isPlayerBullet(s, b);
        for (let j = 0; j < obstacles.length; j++) {
          const o = obstacles[j]; if (!o || !o.alive) continue;
          if (!o.blockBullet && o.type !== 'crystal_base') continue;
          const ob = o.aabb || o._box; if (!ob) continue;
          if (PHYS.aabb(bb, ob)) {
            const isBase = !!o._isBase;
            /* 据点核心：只吃敌方火力。玩家子弹打在核心上不扣血（否则会自己把家拆了）。
             * 注意必须同时挡住下面那条「可破坏地形通用扣血」分支——核心也有 hp 字段，
             * 之前玩家子弹会走通用分支把核心的 hp 磨到 0，导致核心方块凭空消失。 */
            if (isBase && !fromPlayer) {
              s.baseHp = Math.max(0, s.baseHp - (b.damage || 1));
              o.hp = s.baseHp;               // 核心自身 hp 与 s.baseHp 保持同步
              BUS.emit('base:hit', { base: o, dmg: b.damage, hp: s.baseHp });
            }
            if (b.bounces && b.bounces > 0) {
              b.bounces -= 1;
              const overlapX = Math.min(bb.x + bb.w - ob.x, ob.x + ob.w - bb.x);
              const overlapY = Math.min(bb.y + bb.h - ob.y, ob.y + ob.h - bb.y);
              if (overlapX < overlapY) b.vel.x = -(b.vel.x || 0); else b.vel.y = -(b.vel.y || 0);
            } else b.alive = false;
            // 砖墙等可破坏地形扣血（核心已单独处理，此处跳过）
            if (!isBase && (o.type === 'brick' || (o.hp != null && o.hp !== Infinity))) {
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
          if (b._ownerTeam != null && t.team != null && b._ownerTeam === t.team) continue;
          const tb = t.aabb; if (!tb) continue;
          if (PHYS.aabb(bb, tb)) {
            if (b._hitSet && b._hitSet.has(t)) continue;
            let dmg = (b.damage || 1) * (t.muls && t.muls.dr != null ? Math.max(0, 1 - t.muls.dr) : 1);
            if (t.shield > 0) { const absorb = Math.min(t.shield, dmg); t.shield -= absorb; dmg -= absorb; }
            if (t.takeDamage) { try { t.takeDamage(dmg); } catch (_) { t.hp -= dmg; } } else { t.hp -= dmg; }
            BUS.emit('tank:hit', { target: t, dmg: dmg, bullet: b, attacker: b.owner });
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
      // 据点守护：玩家无限复活（不移除玩家），敌军死亡则移除
      s.tanks = s.tanks.filter(t => t && (t.alive || t.type === 'player'));
      s.obstacles = s.obstacles.filter(o => o && o.alive !== false);
      s.powerups = s.powerups.filter(p => p && p.alive !== false);
      // 同步据点耐久
      if (s.base && s.base.hp != null) s.baseHp = Math.max(0, s.base.hp);
    },

    /* ========== 据点核心渲染（fx 层：六边形 + 耐久环）========== */
    _renderBase(ctx) {
      const s = this.state; if (!s || !s.base || !ctx) return;
      const b = s.base;
      const cam = RENDER.camera || { x: 0, y: 0, zoom: 1 };
      const z = cam.zoom || 1;
      const cx = (b.pos.x - cam.x) * z;
      const cy = (b.pos.y - cam.y) * z;
      const r = 52 * z;
      if (r < 2) return;
      ctx.save();
      const hpRatio = Math.max(0, Math.min(1, (s.baseHp || 0) / (s.baseMaxHp || BASE_MAX_HP)));
      const col = hpRatio > 0.5 ? '#00f0ff' : (hpRatio > 0.25 ? '#ffc93c' : '#ff3860');

      // 地面光环
      const grad = ctx.createRadialGradient(cx, cy, 8, cx, cy, r * 1.4);
      grad.addColorStop(0, this._rgba(col, 0.22));
      grad.addColorStop(1, this._rgba(col, 0.02));
      ctx.fillStyle = grad;
      ctx.beginPath(); ctx.arc(cx, cy, r * 1.4, 0, Math.PI * 2); ctx.fill();

      // 外环（旋转虚线）
      const t = Date.now() / 1000;
      ctx.save();
      ctx.translate(cx, cy); ctx.rotate(t * 0.5);
      ctx.setLineDash([8 * z, 7 * z]); ctx.lineWidth = 2;
      ctx.strokeStyle = this._rgba(col, 0.6); ctx.shadowColor = col; ctx.shadowBlur = 12;
      ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();

      // 六边形核心
      ctx.setLineDash([]);
      ctx.fillStyle = this._rgba(col, 0.18);
      ctx.strokeStyle = col; ctx.lineWidth = 3; ctx.shadowColor = col; ctx.shadowBlur = 18;
      ctx.beginPath();
      for (let k = 0; k < 6; k++) {
        const a = -Math.PI / 2 + k * Math.PI / 3;
        const px = cx + Math.cos(a) * r * 0.7, py = cy + Math.sin(a) * r * 0.7;
        if (k === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.closePath(); ctx.fill(); ctx.stroke();

      // 耐久环
      ctx.shadowBlur = 0; ctx.lineWidth = 6 * z;
      ctx.strokeStyle = 'rgba(255,255,255,0.12)';
      ctx.beginPath(); ctx.arc(cx, cy, r + 8 * z, 0, Math.PI * 2); ctx.stroke();
      ctx.strokeStyle = col; ctx.shadowColor = col; ctx.shadowBlur = 12;
      ctx.beginPath(); ctx.arc(cx, cy, r + 8 * z, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * hpRatio); ctx.stroke();

      // 中心图标
      ctx.shadowBlur = 10; ctx.fillStyle = col;
      ctx.font = 'bold ' + Math.round(20 * z) + 'px "Share Tech Mono", monospace';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('🏰', cx, cy);

      // 文字标签
      ctx.shadowBlur = 0; ctx.fillStyle = '#eaf6ff';
      ctx.font = Math.round(11 * z) + 'px "Share Tech Mono", monospace';
      ctx.fillText('据点核心 ' + Math.ceil(s.baseHp) + '/' + (s.baseMaxHp || BASE_MAX_HP), cx, cy + r + 22 * z);
      ctx.restore();
    },

    _rgba(hex, a) {
      if (typeof hex !== 'string' || hex[0] !== '#' || hex.length < 7) return hex;
      const v = hex.slice(1);
      const r = parseInt(v.substring(0, 2), 16);
      const g = parseInt(v.substring(2, 4), 16);
      const b = parseInt(v.substring(4, 6), 16);
      return 'rgba(' + r + ',' + g + ',' + b + ',' + a + ')';
    },

    /* ========== 死亡处理：玩家无限复活，敌军计杀 ========== */
    _onTankDead(evt) {
      const s = this.state; if (!s || !this.running) return;
      const dead = evt && evt.dead; if (!dead) return;
      if (dead.type === 'player') {
        // 据点守护：玩家阵亡不判负，3s 后无限复活
        s.playerRespawnT = PLAYER_RESPAWN;
        global.CT_RESPAWN_T = PLAYER_RESPAWN;
        return;
      }
      s.kills += 1;
      s.score += 50 * ((s.cfg && s.cfg.scoreMul) || 1);
    },

    _gameOver(victory) {
      const s = this.state; if (!s || !this.running) return;
      this.running = false;
      global.CT_RESPAWN_T = 0;
      s.phase = victory ? 'VICTORY' : 'GAMEOVER';
      const cfg = s.cfg || DIFF_CONFIG.normal;
      const defendTime = Math.floor(s.elapsed || 0);
      /* 最终得分 = 击杀分 + 波次分 + 坚守时长分，再乘难度倍率 */
      const finalScore = Math.round(
        ((s.score || 0) + (s.wave || 0) * 200 + defendTime * 10) * (cfg.scoreMul || 1)
      );
      const rating = ratingOf(finalScore);
      try { if (ENG && typeof ENG.setState === 'function') ENG.setState('GAMEOVER'); } catch (_) {}
      /* 计分排行：按难度分档独立记录（kingdefend_easy / _normal / _hard / _night） */
      try {
        if (STORAGE && typeof STORAGE.updateRecord === 'function') {
          const key = rankKey(s.difficulty);
          const prev = STORAGE.getRecord(key) || {};
          const isBest = finalScore > (prev.highScore || 0);
          STORAGE.updateRecord(key, {
            highScore: Math.max(prev.highScore || 0, finalScore),
            bestWave: Math.max(prev.bestWave || 0, s.wave || 0),
            bestTime: Math.max(prev.bestTime || 0, defendTime),
            bestRating: isBest ? rating : (prev.bestRating || rating)
          });
          /* 通用 kingdefend 记录同步为「跨难度最佳」，便于总览展示 */
          const g = STORAGE.getRecord('kingdefend') || {};
          const gBest = finalScore > (g.highScore || 0);
          STORAGE.updateRecord('kingdefend', {
            highScore: Math.max(g.highScore || 0, finalScore),
            bestWave: Math.max(g.bestWave || 0, s.wave || 0),
            bestTime: Math.max(g.bestTime || 0, defendTime),
            bestRating: gBest ? rating : (g.bestRating || rating)
          });
        }
      } catch (_) {}
      const payload = {
        victory: !!victory, mode: 'kingdefend', wave: s.wave,
        score: finalScore, kills: s.kills, coins: s.coins,
        difficulty: s.difficulty || 'normal',
        stats: {
          score: finalScore, kills: s.kills,
          surviveWaves: s.wave || 0,
          progress: 0,
          defendTime: defendTime,
          difficulty: s.difficulty || 'normal'
        },
        rewardsCoins: 0
      };
      try {
        if (UI_RES && typeof UI_RES.show === 'function') UI_RES.show(payload);
        else console.log('[MODE KINGDEFEND] result', payload);
      } catch (_) { console.log('[MODE KINGDEFEND] result', payload); }
      BUS.emit('mode:finished', payload);
    },

    /* ========== 事件绑定 ========== */
    _bindAll() {
      const self = this;
      const binds = [
        ['tank:dead', (e) => { try { self._onTankDead(e); } catch (e) { console.error(e); } }]
      ];
      this._bindings = [];
      for (let i = 0; i < binds.length; i++) {
        BUS.on(binds[i][0], binds[i][1]);
        this._bindings.push({ e: binds[i][0], fn: binds[i][1] });
      }
    }
  };

  global.CT_MODE_KINGDEFEND = CT_MODE_KINGDEFEND;
})(typeof window !== 'undefined' ? window : globalThis);

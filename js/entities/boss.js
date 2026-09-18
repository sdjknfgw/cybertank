/* =========================================================
 * CyberTank · BOSS 实体模块
 * 命名空间: window.CT_BOSS
 * Boss 继承自 CT_TANK.Tank，三阶段行为 + 专属技能组
 * （召唤护卫 / 环形弹幕 / 螺旋弹幕 / 重型冲锋 / 散布雷区）
 * ========================================================= */
(function (global) {
  'use strict';

  function emitGlobal(evt, payload) {
    /* 主通道：CT_BUS（CT_ENGINE 上没有 EventBus 属性，此前优先走它导致事件落到 DOM 兜底） */
    var bus = global.CT_BUS;
    if (bus && typeof bus.emit === 'function') {
      try { bus.emit(evt, payload); } catch (_) {}
    }
    /* 辅通道：DOM 事件，方便调试 */
    try {
      var ev = new CustomEvent(evt, { detail: payload || {} });
      if (global.document) global.document.dispatchEvent(ev);
    } catch (_) { /* noop */ }
  }

  /** 5 个 BOSS 名称（按波次轮换） */
  var BOSS_NAMES = [
    '\u70C8\u7130\u5DE8\u517D',   // 烈焰巨兽
    '\u91CF\u5B50\u673A\u7532',   // 量子机甲
    '\u8D5B\u535A\u66B4\u541B',   // 赛博暴君
    '\u865A\u7A7A\u5821\u5792',   // 虚空堡垒
    '\u5929\u542F\u4E4B\u738B'    // 天启之王
  ];

  /* =========================================================
   * BOSS 技能系统（req4：为 Boss 设计技能，增加可玩性）
   * BOSS_SKILLS：技能注册表（中文标签用于 HUD 提示与敌情预告）
   * BOSS_KITS：  每个 Boss 专属技能组（与 BOSS_NAMES 一一对应）
   * ========================================================= */
  var BOSS_SKILLS = {
    summon: { label: '召唤护卫' },
    ring:   { label: '环形弹幕' },
    spiral: { label: '螺旋弹幕' },
    charge: { label: '重型冲锋' },
    mines:  { label: '散布雷区' }
  };
  var BOSS_KITS = [
    ['charge', 'ring', 'mines'],            // 烈焰巨兽：莽夫冲锋型
    ['spiral', 'summon', 'mines'],          // 量子机甲：技巧弹幕型
    ['summon', 'ring', 'charge'],           // 赛博暴君：均衡压迫型
    ['ring', 'spiral', 'mines'],            // 虚空堡垒：固定炮台型
    ['charge', 'summon', 'ring', 'spiral']  // 天启之王：全技能循环
  ];

  /* =========================================================
   * 技能视听反馈辅助（视觉特效 + 音效）
   * 粒子/涟漪/飘字走 CT_PARTICLES；音效走 CT_AUDIO；
   * summon/spiral 的通用 'skill' 音由 main.js 的 skillCast 监听播放，
   * 这里只补 ring/charge/mines 的差异化音色，避免叠音。
   * ========================================================= */
  var SKILL_COLORS = {
    summon: '#00f0ff', ring: '#ff8c42', spiral: '#c86cff',
    charge: '#ff3860', mines: '#ff2a6d'
  };
  function _PFX() {
    try {
      return (global.CT_PARTICLES && typeof global.CT_PARTICLES.emit === 'function') ? global.CT_PARTICLES : null;
    } catch (_) { return null; }
  }
  function _SFX() {
    try {
      return (global.CT_AUDIO && typeof global.CT_AUDIO.play === 'function') ? global.CT_AUDIO : null;
    } catch (_) { return null; }
  }
  /** 施法瞬间反馈：冲击波圆环 + 粒子爆发 + 技能名飘字 + 差异化音效 */
  function castFeedback(boss, skill) {
    var c = SKILL_COLORS[skill] || '#ffd700';
    var P = _PFX();
    if (P) {
      try {
        P.ripple({ x: boss.pos.x, y: boss.pos.y, maxR: 160, color: c, life: 0.55, width: 4 });
        P.emit({
          x: boss.pos.x, y: boss.pos.y, count: 18, colors: [c, '#ffffff'],
          speed: [1.5, 4.5], life: [0.3, 0.7], size: [2, 5], gravity: 0
        });
        var def = BOSS_SKILLS[skill];
        P.text({
          worldX: boss.pos.x, worldY: boss.pos.y - 78,
          text: '⚡ ' + (def ? def.label : skill), color: c, size: 20, life: 1.0
        });
      } catch (_) {}
    }
    var A = _SFX();
    if (A) {
      try {
        /* 差异化音色：环形弹幕=爆响 / 冲锋·布雷=低吼；召唤/螺旋沿用 main.js 的 skill 音 */
        var type = (skill === 'ring') ? 'explode' : ((skill === 'charge' || skill === 'mines') ? 'boss' : null);
        if (type) A.play(type, {});
      } catch (_) {}
    }
  }

  /** 根据 Tank 原型创建子类（保留构造链） */
  function inherit(Parent, Child) {
    var F = function () { };
    F.prototype = Parent.prototype;
    Child.prototype = new F();
    Child.prototype.constructor = Child;
    return Child;
  }

  /* =========================================================
   * Boss 类
   * ========================================================= */
  /**
   * BOSS 坦克：继承 Tank；
   *   phase 1 (HP>50%)：双管左右交替射击
   *   phase 2 (HP<=50%)：每 2s 召唤 2 个敌人
   *   phase 3 (HP<=25%)：每 1.5s 8 发环形子弹 + 射速 ×1.3
   * @class
   * @param {object} opts { wave, x, y, color, name, maxHp, ... }
   */
  function Boss(opts) {
    opts = opts || {};
    var wave = opts.wave == null ? 1 : opts.wave | 0;
    /* BOSS 使用 heavy 基础作为模板，覆写 maxHp/speed/fireRate/damage */
    opts.tankClass = opts.tankClass || 'heavy';
    opts.type = 'boss';
    opts.color = opts.color || '#ffd700';
    opts.maxHp = opts.maxHp != null ? opts.maxHp : (40 + wave * 15);
    opts.speed = opts.speed != null ? opts.speed : 1.2;
    opts.fireRate = opts.fireRate != null ? opts.fireRate : 1.6;
    opts.damage = opts.damage != null ? opts.damage : 2.4 + wave * 0.2;
    opts.skillCd = opts.skillCd != null ? opts.skillCd : 30;
    /* 走 Tank 构造 */
    if (global.CT_TANK && global.CT_TANK.Tank) {
      global.CT_TANK.Tank.call(this, opts);
    } else {
      /* 兜底：直接初始化常见字段 */
      this.maxHp = opts.maxHp; this.hp = this.maxHp;
      this.color = opts.color; this.type = 'boss';
      this.speedBase = opts.speed; this.fireRateBase = opts.fireRate;
      this.damageBase = opts.damage; this.skillCdMax = opts.skillCd;
      this.angle = 0; this.turretAngle = 0; this.gunLevel = 1;
      this.pos = { x: opts.x || 0, y: opts.y || 0 }; this.vel = { x: 0, y: 0 };
      this.spawnPos = { x: this.pos.x, y: this.pos.y };
      this.shield = 0; this.skillCdNow = 0; this.fireRateCd = 0; this.coins = 0;
      this.muls = { dmg: 1, fireRate: 1, speed: 1, dr: 0, pierce: 0, splash: 0, pickup: 1, coinGain: 1, fireRateMaxMul: 2, speedMaxMul: 1.5 };
      this.tempBuffs = []; this.inventory = []; this.alive = true;
      this.tankClass = opts.tankClass; this.name = opts.name || BOSS_NAMES[0];
      this._w = 56; this._h = 56; this.extraMaxHp = 0;
      this.inBush = false; this.nextBuffReroll = false; this.nextBuffRarityUp = false;
      this._trackT = 0;
    }
    this.wave = wave;
    this.phase = 1;
    this._prevHpRatio = 1;
    /** 双管切换 */
    this._barrelAlt = false;
    /** BOSS 名字：按 wave 轮换 */
    var nameIdx = (wave - 1) % BOSS_NAMES.length;
    this.name = opts.name || BOSS_NAMES[nameIdx];
    /** 技能系统状态：专属技能组 / 轮换索引 / 冷却 / 冲锋 / 螺旋发射器 */
    this.skillKit = BOSS_KITS[nameIdx] || ['ring'];
    this._skillIdx = 0;
    this._skillCd = 3.5;
    this._charge = null;
    this._spiral = null;
  }

  /* 继承链 */
  (function setupInherit() {
    var Parent = (global.CT_TANK && global.CT_TANK.Tank) ? global.CT_TANK.Tank : Object;
    inherit(Parent, Boss);
  })();

  /** BOSS 名称表静态字段 */
  Boss.BOSS_NAMES = BOSS_NAMES;

  /**
   * 覆写 update：阶段切换 + 各阶段专属行为
   * 签名：(dt, input?, obstacles, tanks) 与 Tank 对齐
   *   - 若第二个参数为数组，则视为 obstacles，补 input = {}
   */
  Boss.prototype.update = function (dt, input, obstacles, tanks) {
    if (!this.alive) return;
    /* 参数兼容：input 可能缺失，直接传 (dt, obstacles, tanks) */
    var inp, obs, tks;
    if (Array.isArray(input)) {
      inp = {}; obs = input; tks = obstacles;
    } else {
      inp = input || {}; obs = obstacles; tks = tanks;
    }

    /* 阶段检查（仅触发一次 phaseChanged 事件） */
    var ratio = (this.hp || 0) / Math.max(1, (this.maxHp || 0) + (this.extraMaxHp || 0));
    var newPhase = 1;
    if (ratio <= 0.25) newPhase = 3;
    else if (ratio <= 0.50) newPhase = 2;
    else newPhase = 1;
    if (newPhase !== this.phase) {
      var fromPhase = this.phase;
      this.phase = newPhase;
      emitGlobal('boss:phaseChanged', { boss: this, from: fromPhase, to: newPhase });
      /* 转阶段视听反馈：三重冲击波 + 爆发粒子 + 飘字 + 低吼 + 震屏 */
      var P0 = _PFX();
      if (P0) {
        try {
          P0.ripple({ x: this.pos.x, y: this.pos.y, maxR: 260, color: '#ffd700', life: 0.8, width: 6 });
          P0.ripple({ x: this.pos.x, y: this.pos.y, maxR: 180, color: '#ff2a6d', life: 0.7, width: 4, delay: 0.1 });
          P0.ripple({ x: this.pos.x, y: this.pos.y, maxR: 120, color: '#ffffff', life: 0.5, width: 3, delay: 0.2 });
          P0.emit({
            x: this.pos.x, y: this.pos.y, count: 30, colors: ['#ffd700', '#ff2a6d', '#ffffff'],
            speed: [2, 6], life: [0.4, 0.9], size: [2, 6], gravity: 0
          });
          P0.text({
            worldX: this.pos.x, worldY: this.pos.y - 90,
            text: '⚠ PHASE ' + newPhase + ' 狂暴', color: '#ff2a6d', size: 24, life: 1.2
          });
          P0.shake(10, 0.5);
        } catch (_) {}
      }
      var A0 = _SFX();
      if (A0) { try { A0.play('boss', {}); } catch (_) {} }
    }

    /* 阶段行为：双管左右交替 / 召唤 / 环形弹幕 */
    this._runPhaseBehaviors(dt, inp, tks);

    /* 阶段 3 射速加成 1.3x（用临时 buff 保证不叠加过多次） */
    this._ensurePhaseFireRateMul();

    /* 调用父类 update：需要正确绑定参数。
       如果 Tank 基类可用 → 调用；否则做最简 fallback（移动阻尼） */
    if (global.CT_TANK && global.CT_TANK.Tank && typeof global.CT_TANK.Tank.prototype.update === 'function') {
      /* 如果外部 AI 未提供 input.turretWorldPoint → 自动瞄准最近玩家 */
      var aim = this._autoAim(tks);
      if (aim) inp.turretWorldPoint = aim;
      inp.shoot = inp.shoot !== false;
      global.CT_TANK.Tank.prototype.update.call(this, dt, inp, obs, tks);
    } else {
      this.pos.x += this.vel.x * (dt || 0);
      this.pos.y += this.vel.y * (dt || 0);
      this.fireRateCd = (this.fireRateCd || 0) - (dt || 0);
      this.skillCdNow = (this.skillCdNow || 0) - (dt || 0);
      this._trackT += (dt || 0);
    }

    this._prevHpRatio = ratio;
  };

  /** 阶段 3 确保 fireRate tempBuff 存在，×1.3 */
  Boss.prototype._ensurePhaseFireRateMul = function () {
    if (this.phase < 3) return;
    var b = this.tempBuffs;
    for (var i = 0; i < b.length; i++) {
      if (b[i].type === 'bossPhase3FireRate') return;
    }
    b.push({ type: 'bossPhase3FireRate', mul: 1.3, dur: 1e9 });
  };

  /** 自动瞄准最近玩家坦克 */
  Boss.prototype._autoAim = function (tanks) {
    if (!tanks || !tanks.length) return null;
    var best = null, bestD2 = Infinity;
    for (var i = 0; i < tanks.length; i++) {
      var t = tanks[i];
      if (!t || !t.alive || t.type !== 'player') continue;
      var dx = t.pos.x - this.pos.x, dy = t.pos.y - this.pos.y;
      var d2 = dx * dx + dy * dy;
      if (d2 < bestD2) { bestD2 = d2; best = t; }
    }
    if (!best) return null;
    return { x: best.pos.x, y: best.pos.y };
  };

  /**
   * 阶段行为：
   *  P1+: 双管左右交替（在 _fire 基础上，每次 shoot 多射 1 发，交替左/右偏移）
   *  全阶段：技能系统轮换施放（详见 _skillTick）
   */
  Boss.prototype._runPhaseBehaviors = function (dt, input, tanks) {
    var BULLET = global.CT_BULLET;
    var hasBullet = BULLET && typeof BULLET.spawn === 'function';
    var ang = this.turretAngle || 0;
    var muzzleX = this.pos.x + Math.cos(ang) * 42;
    var muzzleY = this.pos.y + Math.sin(ang) * 42;

    /* P1+: 双管替换偏移：只要 shoot，就多打一发 offset 垂直 */
    if (input.shoot && this.fireRateCd <= 0 && hasBullet) {
      var perp = ang + Math.PI / 2;
      var side = this._barrelAlt ? 1 : -1;
      this._barrelAlt = !this._barrelAlt;
      var nx = Math.cos(perp) * 10 * side;
      var ny = Math.sin(perp) * 10 * side;
      var dmg = (this.damageBase || 2) * (this.muls.dmg || 1);
      BULLET.spawn({
        x: muzzleX + nx, y: muzzleY + ny, angle: ang,
        speed: 11, damage: dmg,
        owner: 'boss', color: this.color,
        pierce: 0, bounces: 1, radius: 5, splash: 6
      });
    }

    /* 技能系统：冷却到点 → 按技能组轮换施放 */
    this._skillTick(dt, tanks);
  };

  /* =========================================================
   * 技能调度：阶段越高冷却越短（P1 5.6s / P2 4.4s / P3 3.2s ± 抖动）
   * ========================================================= */
  Boss.prototype._skillTick = function (dt, tanks) {
    /* 冲锋状态机独占更新（期间暂停其他技能） */
    if (this._charge) { this._updateCharge(dt, tanks); return; }
    /* 螺旋弹幕发射器持续出弹 */
    if (this._spiral) this._updateSpiral(dt);
    this._skillCd -= dt;
    if (this._skillCd > 0) return;
    var kit = (this.skillKit && this.skillKit.length) ? this.skillKit : ['ring'];
    var name = kit[this._skillIdx % kit.length];
    this._skillIdx++;
    this._castSkill(name, tanks);
    var base = this.phase >= 3 ? 3.2 : (this.phase === 2 ? 4.4 : 5.6);
    this._skillCd = base + Math.random() * 1.2;
  };

  Boss.prototype._castSkill = function (name, tanks) {
    var def = BOSS_SKILLS[name];
    if (!def) return;
    emitGlobal('boss:skillCast', { boss: this, skill: name, label: def.label });
    castFeedback(this, name);   /* 施法瞬间视听反馈 */
    if (name === 'summon') this._castSummon();
    else if (name === 'ring') this._castRing();
    else if (name === 'spiral') this._castSpiral();
    else if (name === 'charge') this._castCharge(tanks);
    else if (name === 'mines') this._castMines();
  };

  /* ---------- 召唤护卫 ----------
   * 修复：旧实现只 emit {kind,x,y}，horde._onSpawnEnemy 要求 evt.enemy
   * → 召唤从未生效。现在直接构造 EnemyAI 并随事件下发，
   * 同时注册进 WAVEMAN.activeEnemies（计入波次清场判定）。 */
  Boss.prototype._castSummon = function () {
    var EN = global.CT_ENEMY;
    var WM = global.CT_WAVEMAN;
    var gs = global.CT_ENGINE && global.CT_ENGINE.gameState;
    var count = this.phase >= 3 ? 3 : 2;
    /* 场上敌人上限 10：防止无限滚雪球 */
    var enemies = 0;
    if (gs && Array.isArray(gs.tanks)) {
      for (var i = 0; i < gs.tanks.length; i++) {
        var t = gs.tanks[i];
        if (t && t.alive && t.type === 'enemy') enemies++;
      }
    }
    if (enemies >= 10) return;
    if (!(EN && EN.EnemyAI)) return;
    for (var j = 0; j < count; j++) {
      var ang = Math.random() * Math.PI * 2;
      var dist = 110 + Math.random() * 90;
      var ex = this.pos.x + Math.cos(ang) * dist;
      var ey = this.pos.y + Math.sin(ang) * dist;
      if (gs && gs.mapInfo) {
        ex = Math.max(80, Math.min(gs.mapInfo.w - 80, ex));
        ey = Math.max(80, Math.min(gs.mapInfo.h - 80, ey));
      }
      var e = new EN.EnemyAI({ x: ex, y: ey, rank: 'normal', wave: this.wave });
      if (WM && WM.activeEnemies && typeof WM.activeEnemies.add === 'function') {
        try { WM.activeEnemies.add(e); } catch (_) {}
      }
      emitGlobal('wave:spawnEnemy', { enemy: e, kind: 'normal', rank: 'normal', x: ex, y: ey, level: 1 });
      /* 召唤落点特效：青色涟漪 + 上升光尘（负重力模拟升腾） */
      var P = _PFX();
      if (P) {
        try {
          P.ripple({ x: ex, y: ey, maxR: 72, color: '#00f0ff', life: 0.5, width: 3 });
          P.emit({
            x: ex, y: ey, count: 10, colors: ['#00f0ff', '#7cf76b'],
            speed: [0.8, 2.2], life: [0.4, 0.8], size: [2, 4], gravity: -0.18
          });
        } catch (_) {}
      }
    }
  };

  /* ---------- 环形弹幕：10~14 发全方位 */
  Boss.prototype._castRing = function () {
    var BULLET = global.CT_BULLET;
    if (!BULLET || typeof BULLET.spawn !== 'function') return;
    var n = this.phase >= 3 ? 14 : 10;
    var dmg = (this.damageBase || 2) * 0.7 * (this.muls.dmg || 1);
    var off = Math.random() * Math.PI * 2;
    for (var k = 0; k < n; k++) {
      var a = off + (Math.PI * 2 / n) * k;
      BULLET.spawn({
        x: this.pos.x, y: this.pos.y, angle: a, speed: 8, damage: dmg,
        owner: 'boss', color: '#ff8c42', pierce: 0, bounces: 1, radius: 5, splash: 12
      });
    }
    /* 环形弹幕特效：双重冲击波（外橙内白错开）+ 震屏 */
    var P = _PFX();
    if (P) {
      try {
        P.ripple({ x: this.pos.x, y: this.pos.y, maxR: 220, color: '#ff8c42', life: 0.6, width: 5 });
        P.ripple({ x: this.pos.x, y: this.pos.y, maxR: 140, color: '#ffffff', life: 0.42, width: 2, delay: 0.08 });
        P.shake(6, 0.3);
      } catch (_) {}
    }
  };

  /* ---------- 螺旋弹幕：1.8s 双臂旋转喷射 ---------- */
  Boss.prototype._castSpiral = function () {
    this._spiral = { t: 1.8, acc: 0, rate: 0.10, angle: Math.random() * Math.PI * 2, step: 0.45, arms: 2 };
    /* 螺旋起手特效：紫色涟漪 + 环状粒子（渲染层另有持续旋转光环，见 render） */
    var P = _PFX();
    if (P) {
      try {
        P.ripple({ x: this.pos.x, y: this.pos.y, maxR: 120, color: '#c86cff', life: 0.5, width: 3 });
        P.emit({
          x: this.pos.x, y: this.pos.y, count: 14, colors: ['#c86cff', '#ffffff'],
          speed: [2, 3.5], life: [0.3, 0.6], size: [2, 4], gravity: 0
        });
      } catch (_) {}
    }
  };
  Boss.prototype._updateSpiral = function (dt) {
    var s = this._spiral;
    if (!s) return;
    s.t -= dt;
    s.acc += dt;
    var BULLET = global.CT_BULLET;
    while (s.acc >= s.rate) {
      s.acc -= s.rate;
      if (BULLET && typeof BULLET.spawn === 'function') {
        var dmg = (this.damageBase || 2) * 0.55 * (this.muls.dmg || 1);
        for (var a = 0; a < s.arms; a++) {
          var ang = s.angle + (Math.PI * 2 / s.arms) * a;
          BULLET.spawn({
            x: this.pos.x + Math.cos(ang) * 42,
            y: this.pos.y + Math.sin(ang) * 42,
            angle: ang, speed: 7.5, damage: dmg,
            owner: 'boss', color: '#c86cff', pierce: 0, bounces: 0, radius: 5, splash: 8
          });
        }
      }
      s.angle += s.step;
    }
    if (s.t <= 0) this._spiral = null;
  };

  /* ---------- 重型冲锋：0.7s 预警（红色虚线）→ 0.5s 高速冲刺 ----------
   * 冲刺期间撞到玩家：1.2× 伤害 + 击退，每次冲锋至多命中一次。 */
  Boss.prototype._castCharge = function (tanks) {
    var target = this._autoAim(tanks);
    var dir = target
      ? Math.atan2(target.y - this.pos.y, target.x - this.pos.x)
      : (this.turretAngle || 0);
    /* fxAcc：聚气/拖尾粒子节流累计器（约每 50ms 一撮） */
    this._charge = { state: 'telegraph', t: 0.7, dir: dir, hitDone: false, fxAcc: 0 };
  };
  Boss.prototype._updateCharge = function (dt, tanks) {
    var c = this._charge;
    if (!c) return;
    c.t -= dt;
    var P = _PFX();
    if (c.state === 'telegraph') {
      /* 聚气特效：Boss 周身红色能量溢出（节流避免每帧刷屏） */
      if (P) {
        c.fxAcc += dt;
        if (c.fxAcc >= 0.05) {
          c.fxAcc = 0;
          try {
            P.emit({
              x: this.pos.x, y: this.pos.y, count: 2, colors: ['#ff3860', '#ffffff'],
              speed: [0.6, 1.8], life: [0.2, 0.45], size: [1, 3], gravity: 0
            });
          } catch (_) {}
        }
      }
      if (c.t <= 0) {
        c.state = 'dash';
        c.t = 0.5;
        /* 起跳反馈：白色冲击波 + 低沉音 + 震屏 */
        if (P) {
          try {
            P.ripple({ x: this.pos.x, y: this.pos.y, maxR: 130, color: '#ffffff', life: 0.35, width: 4 });
            P.shake(8, 0.35);
          } catch (_) {}
        }
        var A1 = _SFX();
        if (A1) { try { A1.play('shoot', { pitch: 0.45 }); } catch (_) {} }
      }
      return;
    }
    if (c.state !== 'dash') { this._charge = null; return; }
    /* 冲刺位移（墙由模式碰撞解算推出，不会穿死） */
    var speed = 620;
    this.pos.x += Math.cos(c.dir) * speed * dt;
    this.pos.y += Math.sin(c.dir) * speed * dt;
    /* 冲刺拖尾：身后金色尘埃（节流） */
    if (P) {
      c.fxAcc += dt;
      if (c.fxAcc >= 0.03) {
        c.fxAcc = 0;
        try {
          P.emit({
            x: this.pos.x - Math.cos(c.dir) * 40,
            y: this.pos.y - Math.sin(c.dir) * 40,
            count: 3, colors: ['#ffd700', '#ff8c42'],
            speed: [0.3, 1.2], life: [0.25, 0.5], size: [2, 4], gravity: 0
          });
        } catch (_) {}
      }
    }
    var gs = global.CT_ENGINE && global.CT_ENGINE.gameState;
    if (gs && gs.mapInfo) {
      this.pos.x = Math.max(70, Math.min(gs.mapInfo.w - 70, this.pos.x));
      this.pos.y = Math.max(70, Math.min(gs.mapInfo.h - 70, this.pos.y));
    }
    /* 冲撞命中判定 */
    if (!c.hitDone && tanks && tanks.length) {
      var me = this.aabb;
      for (var i = 0; i < tanks.length; i++) {
        var t = tanks[i];
        if (!t || !t.alive || t.type !== 'player') continue;
        var tb = t.aabb;
        if (!me || !tb) continue;
        if (me.x + me.w < tb.x || tb.x + tb.w < me.x ||
            me.y + me.h < tb.y || tb.y + tb.h < me.y) continue;
        c.hitDone = true;
        var dmg = (this.damageBase || 2) * 1.2;
        if (typeof t.takeDamage === 'function') {
          try { t.takeDamage(dmg, this); } catch (_) { t.hp -= dmg; }
        } else t.hp -= dmg;
        /* 击退 */
        t.pos.x += Math.cos(c.dir) * 90;
        t.pos.y += Math.sin(c.dir) * 90;
        /* 命中反馈：火花 + 爆发粒子 + 强震屏 + 爆响 */
        if (P) {
          try {
            P.hitSpark && P.hitSpark(t.pos.x, t.pos.y, '#ff3860');
            P.emit({
              x: t.pos.x, y: t.pos.y, count: 22, colors: ['#ff3860', '#ffd700', '#ffffff'],
              speed: [2, 5.5], life: [0.3, 0.7], size: [2, 5], gravity: 0
            });
            P.shake(12, 0.4);
          } catch (_) {}
        }
        var A2 = _SFX();
        if (A2) { try { A2.play('explode', {}); } catch (_) {} }
        if (t.hp <= 0 && t.alive) {
          t.alive = false;
          emitGlobal('tank:dead', { tank: t, dead: t, source: this });
        }
        break;
      }
    }
    if (c.t <= 0) this._charge = null;
  };

  /* ---------- 散布雷区：Boss 周围 4~6 枚地雷（只伤玩家） ---------- */
  Boss.prototype._castMines = function () {
    var n = this.phase >= 3 ? 6 : 4;
    var P = _PFX();
    for (var i = 0; i < n; i++) {
      var ang = (Math.PI * 2 / n) * i + Math.random() * 0.5;
      var dist = 100 + Math.random() * 120;
      var mx = this.pos.x + Math.cos(ang) * dist;
      var my = this.pos.y + Math.sin(ang) * dist;
      emitGlobal('powerup:spawnMine', {
        x: mx, y: my,
        damage: 2.5, owner: 'boss'
      });
      /* 落雷警示特效：暗红涟漪标记落点（与地雷红色警示呼应） */
      if (P) {
        try {
          P.ripple({ x: mx, y: my, maxR: 46, color: '#ff2a6d', life: 0.6, width: 3 });
        } catch (_) {}
      }
    }
  };

  /* =========================================================
   * 渲染：放大 1.8×、金色描边、大 glow、顶部阶段/名字
   * ========================================================= */
  Boss.prototype.render = function (ctx, camera) {
    if (!this.alive) return;
    var sx = this.pos.x, sy = this.pos.y;
    if (camera) {
      sx = (sx - camera.x) * (camera.scale || 1) + camera.w / 2;
      sy = (sy - camera.y) * (camera.scale || 1) + camera.h / 2;
    }
    var Tank = global.CT_TANK && global.CT_TANK.Tank;
    var w = this._w * 1.8, h = this._h * 1.8;

    ctx.save();
    /* 大尺寸发光底：先画一个 gold aura */
    ctx.save();
    ctx.translate(sx, sy);
    ctx.shadowColor = this.color || '#ffd700';
    ctx.shadowBlur = 40;
    ctx.strokeStyle = this.color || '#ffd700';
    ctx.lineWidth = 4;
    ctx.beginPath();
    roundRect(ctx, -w / 2, -h / 2, w, h, 14);
    ctx.stroke();
    ctx.restore();

    /* 冲锋预警（req4）：telegraph 阶段画红色虚线冲刺路径 + 技能名 + 施法进度条 */
    if (this._charge && this._charge.state === 'telegraph') {
      var cLine = this._charge;
      var blink = Math.floor(performance.now() / 120) % 2 ? 0.9 : 0.35;
      ctx.save();
      ctx.translate(sx, sy);
      ctx.rotate(cLine.dir);
      ctx.globalAlpha = blink;
      ctx.strokeStyle = '#ff3860';
      ctx.lineWidth = 5;
      ctx.setLineDash([16, 10]);
      ctx.shadowColor = '#ff3860';
      ctx.shadowBlur = 16;
      ctx.beginPath();
      ctx.moveTo(w / 2, 0);
      ctx.lineTo(w / 2 + 520, 0);
      ctx.stroke();
      /* 冲锋路径两侧的边界警示线（把危险区框出来，玩家更易读） */
      ctx.lineWidth = 1.5;
      ctx.globalAlpha = blink * 0.6;
      ctx.beginPath();
      ctx.moveTo(w / 2, -34); ctx.lineTo(w / 2 + 520, -34);
      ctx.moveTo(w / 2, 34);  ctx.lineTo(w / 2 + 520, 34);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
      /* 头顶：技能名 + 施法进度条（聚气读条，0.7s） */
      var prog = 1 - Math.max(0, Math.min(1, cLine.t / 0.7));
      ctx.save();
      ctx.font = 'bold 13px "Share Tech Mono", monospace';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#ff3860';
      ctx.shadowColor = '#ff3860'; ctx.shadowBlur = 10;
      ctx.fillText('⚠ 重型冲锋', sx, sy - h / 2 - 44);
      ctx.shadowBlur = 0;
      ctx.fillStyle = 'rgba(255,56,96,0.25)';
      ctx.fillRect(sx - 52, sy - h / 2 - 38, 104, 7);
      ctx.fillStyle = '#ff3860';
      ctx.fillRect(sx - 52, sy - h / 2 - 38, 104 * prog, 7);
      ctx.strokeStyle = 'rgba(255,56,96,0.7)';
      ctx.lineWidth = 1;
      ctx.strokeRect(sx - 52, sy - h / 2 - 38, 104, 7);
      ctx.restore();
    }

    /* 螺旋弹幕激活：周身紫色旋转双弧光环（与弹幕发射节奏呼应） */
    if (this._spiral) {
      var rotT = performance.now() / 1000;
      ctx.save();
      ctx.translate(sx, sy);
      ctx.rotate(rotT * 3.4);
      ctx.strokeStyle = '#c86cff';
      ctx.lineWidth = 3;
      ctx.shadowColor = '#c86cff';
      ctx.shadowBlur = 14;
      ctx.globalAlpha = 0.85;
      for (var sa = 0; sa < 2; sa++) {
        ctx.beginPath();
        ctx.arc(0, 0, w * 0.78, sa * Math.PI, sa * Math.PI + Math.PI * 0.7);
        ctx.stroke();
      }
      ctx.restore();
    }

    /* 冲刺中：身后金色速度线（强化冲刺动感，与拖尾粒子叠加） */
    if (this._charge && this._charge.state === 'dash') {
      ctx.save();
      ctx.translate(sx, sy);
      ctx.rotate(this._charge.dir);
      ctx.strokeStyle = 'rgba(255,215,0,0.55)';
      ctx.lineWidth = 2;
      ctx.shadowColor = '#ffd700';
      ctx.shadowBlur = 6;
      for (var sl = 0; sl < 3; sl++) {
        var slOff = (sl - 1) * 20;
        ctx.beginPath();
        ctx.moveTo(-w / 2 - 10 - Math.random() * 16, slOff);
        ctx.lineTo(-w / 2 - 34 - Math.random() * 28, slOff);
        ctx.stroke();
      }
      ctx.restore();
    }

    /* 父类渲染：优先 Tank.prototype.render；否则 fallback 简绘 */
    if (Tank && typeof Tank.prototype.render === 'function') {
      /* 临时缩小 draw scale：父类会画 56×56，我们通过先 scale 放大容器 1.8x 的方式来实现。
         但为了避免破坏父类内部计算，这里先保存原始尺寸，放大 1.8x 绘制。 */
      var origW = this._w, origH = this._h;
      this._w = w; this._h = h;
      /* 保存原始位置：父类 render 会用 camera 换算 pos；我们不改动 pos，保证逻辑坐标不变 */
      Tank.prototype.render.call(this, ctx, camera);
      this._w = origW; this._h = origH;
    } else {
      /* 兜底绘制 */
      ctx.fillStyle = this._rgbaHex(this.color, 0.35);
      ctx.beginPath(); roundRect(ctx, sx - w / 2, sy - h / 2, w, h, 12); ctx.fill();
    }

    /* 顶部阶段飘字 + BOSS 名 */
    var phaseText = 'PHASE ' + this.phase;
    ctx.save();
    ctx.font = 'bold 14px "Share Tech Mono", monospace';
    ctx.textAlign = 'center';
    ctx.shadowColor = '#ffd700'; ctx.shadowBlur = 14;
    ctx.fillStyle = '#ffd700';
    ctx.fillText(this.name + '  ·  ' + phaseText, sx, sy - h / 2 - 16);
    ctx.restore();

    ctx.restore();
  };

  Boss.prototype._rgbaHex = function (hex, a) {
    var h = (hex || '#ffd700').replace('#', '');
    if (h.length !== 6) return 'rgba(255,215,0,' + a + ')';
    var r = parseInt(h.slice(0, 2), 16);
    var g = parseInt(h.slice(2, 4), 16);
    var b = parseInt(h.slice(4, 6), 16);
    return 'rgba(' + r + ',' + g + ',' + b + ',' + a + ')';
  };

  function roundRect(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  /* =========================================================
   * 导出
   * ========================================================= */
  var CT_BOSS = {
    Boss: Boss,
    BOSS_NAMES: BOSS_NAMES,
    BOSS_SKILLS: BOSS_SKILLS,
    BOSS_KITS: BOSS_KITS
  };
  global.CT_BOSS = CT_BOSS;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = CT_BOSS;
  }
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));

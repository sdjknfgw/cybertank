/* =========================================================
 * CyberTank · BOSS 实体模块
 * 命名空间: window.CT_BOSS
 * Boss 继承自 CT_TANK.Tank，三阶段行为 + 召唤 + 环形弹幕
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
    /** 阶段切换标记：只触发一次 */
    this._phaseTriggered = { 2: false, 3: false };
    /** 召唤计时（阶段 2） */
    this._summonCd = 2;
    /** 环形弹幕计时（阶段 3） */
    this._ringCd = 1.5;
    /** 双管切换 */
    this._barrelAlt = false;
    /** BOSS 名字：按 wave 轮换 */
    this.name = opts.name || BOSS_NAMES[(wave - 1) % BOSS_NAMES.length];
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
   *  P1: 双管左右交替（在 _fire 基础上，每次 shoot 多射 1 发，交替左/右偏移）
   *  P2: 每 2s 召唤 2 个敌人
   *  P3: 每 1.5s 8 发环形子弹
   */
  Boss.prototype._runPhaseBehaviors = function (dt, input, tanks) {
    var BULLET = global.CT_BULLET;
    var hasBullet = BULLET && typeof BULLET.spawn === 'function';
    var ang = this.turretAngle || 0;
    var muzzleX = this.pos.x + Math.cos(ang) * 42;
    var muzzleY = this.pos.y + Math.sin(ang) * 42;

    /* P1: 双管替换偏移：只要 shoot，就多打一发 offset 垂直 */
    if (this.phase >= 1) {
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
    }
    /* P2: 召唤 */
    if (this.phase >= 2) {
      this._summonCd -= dt;
      if (this._summonCd <= 0) {
        this._summonCd = 2;
        var i;
        for (i = 0; i < 2; i++) {
          emitGlobal('wave:spawnEnemy', {
            kind: 'normal',
            x: this.pos.x + (Math.random() - 0.5) * 160,
            y: this.pos.y + (Math.random() - 0.5) * 160,
            level: 1
          });
        }
      }
    }
    /* P3: 环形弹幕 8 发 */
    if (this.phase >= 3) {
      this._ringCd -= dt;
      if (this._ringCd <= 0 && hasBullet) {
        this._ringCd = 1.5;
        var dmgRing = (this.damageBase || 2) * 0.7 * (this.muls.dmg || 1);
        for (var k = 0; k < 8; k++) {
          var a = (Math.PI * 2 / 8) * k;
          BULLET.spawn({
            x: this.pos.x, y: this.pos.y, angle: a,
            speed: 8, damage: dmgRing,
            owner: 'boss', color: '#ff8c42',
            pierce: 0, bounces: 1, radius: 5, splash: 12
          });
        }
      }
    }
    /* 阶段 3：基础 fireRate 额外 +30% 已在 _ensurePhaseFireRateMul 注入 */
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
    BOSS_NAMES: BOSS_NAMES
  };
  global.CT_BOSS = CT_BOSS;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = CT_BOSS;
  }
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));

/* =========================================================
 * CyberTank · 坦克实体模块
 * 命名空间: window.CT_TANK (Tank 基类/属性表/技能表)
 * ========================================================= */
(function (global) {
  'use strict';

  /** AABB 相交 */
  function aabbHit(a, b) {
    return !(a.x + a.w < b.x || b.x + b.w < a.x || a.y + a.h < b.y || b.y + b.h < a.y);
  }
  function emitGlobal(evt, payload) {
    /* 主通道：CT_BUS —— 模式/系统通过 BUS.on 监听（tank:dead 等）。
     * 注意：CT_ENGINE 上没有 EventBus 属性，此前优先走它导致事件全部落到 DOM 兜底，
     * horde/king-hill 等模式收不到 tank:dead → 击杀计数/死亡结算失效。 */
    var bus = global.CT_BUS;
    if (bus && typeof bus.emit === 'function') {
      try { bus.emit(evt, payload); } catch (_) {}
    }
    /* 辅通道：DOM CustomEvent（保留调试便利） */
    try { if (global.document) global.document.dispatchEvent(new CustomEvent(evt, { detail: payload || {} })); }
    catch (_) { /* noop */ }
  }
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function hexToRgb(hex) {
    var h = (hex || '#00f0ff').replace('#', '');
    if (h.length !== 6) return [0, 240, 255];
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }
  function rgba(hex, a) { var c = hexToRgb(hex); return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a + ')'; }
  function lighten(hex, amt) {
    var c = hexToRgb(hex);
    return 'rgb(' + Math.min(255, c[0] + (255 * amt | 0)) + ',' +
                  Math.min(255, c[1] + (255 * amt | 0)) + ',' +
                  Math.min(255, c[2] + (255 * amt | 0)) + ')';
  }
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

  /* 道具公共释放间隔（秒）：两次使用道具之间的最小间隔 */
  var ITEM_USE_CD = 1.2;

  /* 4 种坦克基础属性 */
  var BASE_STATS = {
    assault:  { hp: 3, speed: 3.0, fireRate: 4.0, damage: 1.0, skillCd: 20 },
    heavy:    { hp: 5, speed: 1.6, fireRate: 2.0, damage: 1.8, skillCd: 25 },
    sniper:   { hp: 2, speed: 2.4, fireRate: 1.4, damage: 3.0, skillCd: 18 },
    engineer: { hp: 3, speed: 2.6, fireRate: 2.8, damage: 1.0, skillCd: 22 }
  };

  /** 炮口世界坐标 */
  function muzzle(tank, len) {
    var a = tank.turretAngle || 0;
    return { x: tank.pos.x + Math.cos(a) * len, y: tank.pos.y + Math.sin(a) * len };
  }

  /* 技能表：SKILLS[type](tank) */
  var SKILLS = {
    assault: function (tank) {
      tank.tempBuffs.push({ type: 'dash', mul: 2, dur: 3, max: 3 });
      emitGlobal('tank:skillDash', { tank: tank });
    },
    heavy: function (tank) {
      tank.shield = (tank.shield || 0) + 3;
      tank.tempBuffs.push({ type: 'skillShieldRegen', dur: 5, max: 5 });
      emitGlobal('tank:skillShield', { tank: tank });
    },
    sniper: function (tank) {
      var B = global.CT_BULLET; if (!B || !B.spawn) return;
      var m = muzzle(tank, 34);
      var base = (BASE_STATS[tank.tankClass] || BASE_STATS.assault).damage;
      B.spawn({
        x: m.x, y: m.y, angle: tank.turretAngle || 0,
        speed: 16, damage: base * 4 * (tank.muls.dmg || 1),
        owner: tank.type || 'player', color: '#ffe680',
        pierce: 3, bounces: 0, radius: 9, splash: 28
      });
      emitGlobal('tank:skillSniperShot', { tank: tank });
    },
    engineer: function (tank) {
      for (var i = 0; i < 3; i++) {
        var a = (Math.PI * 2 / 3) * i - Math.PI / 2;
        emitGlobal('powerup:spawnMine', {
          x: tank.pos.x + Math.cos(a) * 60,
          y: tank.pos.y + Math.sin(a) * 60,
          damage: 8, owner: tank.type || 'player'
        });
      }
      emitGlobal('tank:skillEngineer', { tank: tank });
    }
  };

  /* =========================================================
   * Tank 基类
   * ========================================================= */
  /**
   * @class
   * @param {object} o { x, y, type, tankClass, color, maxHp, speed, fireRate, damage, skillCd, name }
   */
  function Tank(o) {
    o = o || {};
    this.tankClass = o.tankClass || 'assault';
    var base = BASE_STATS[this.tankClass] || BASE_STATS.assault;
    this.type = o.type || 'player';
    this.color = o.color || '#00f0ff';
    this.name = o.name || ('Tank_' + this.tankClass);
    /* 基础属性 */
    this.maxHp = o.maxHp != null ? o.maxHp : base.hp;
    this.hp = this.maxHp;
    this.speedBase = o.speed != null ? o.speed : base.speed;
    this.fireRateBase = o.fireRate != null ? o.fireRate : base.fireRate;
    this.damageBase = o.damage != null ? o.damage : base.damage;
    this.skillCdMax = o.skillCd != null ? o.skillCd : base.skillCd;
    this.shield = 0; this.skillCdNow = 0; this.gunLevel = 1; this.coins = 0;
    /* 道具公共冷却 + 拒绝提示节流（防止按住键刷屏 toast） */
    this.itemCdNow = 0;
    this._skillDenyT = 0;
    this._itemDenyT = 0;
    this.angle = 0; this.turretAngle = 0;
    this.pos = { x: o.x || 0, y: o.y || 0 }; this.vel = { x: 0, y: 0 };
    this.spawnPos = { x: this.pos.x, y: this.pos.y };
    this.fireRateCd = 0;
    this.muls = { dmg: 1, fireRate: 1, speed: 1, dr: 0,
      pierce: 0, splash: 0, pickup: 1, coinGain: 1,
      fireRateMaxMul: 1.2, speedMaxMul: 1.8 };
    this.tempBuffs = [];
    this.inventory = [];
    this.inBush = false;
    /** 复活后无敌剩余时间（秒）；>0 时免疫一切伤害 */
    this._invincibleT = 0;
    this.alive = true;
    this._w = 40; this._h = 40;
    this.extraMaxHp = 0;
    this.nextBuffReroll = false;
    this.nextBuffRarityUp = false;
    this._trackT = 0;
    this._lastTraction = 1;
  }
  Tank.BASE_STATS = BASE_STATS;
  Tank.SKILLS = SKILLS;

  Object.defineProperty(Tank.prototype, 'w', { get: function () { return this._w; } });
  Object.defineProperty(Tank.prototype, 'h', { get: function () { return this._h; } });
  Object.defineProperty(Tank.prototype, 'aabb', {
    get: function () { return { x: this.pos.x - this._w / 2, y: this.pos.y - this._h / 2, w: this._w, h: this._h }; }
  });

  /* 地形牵引力：冰 0.2 / 泥 0.6，取最小值 */
  Tank.prototype._traction = function (obstacles) {
    var t = 1;
    if (!obstacles) return t;
    var me = this.aabb;
    for (var i = 0; i < obstacles.length; i++) {
      var ob = obstacles[i];
      if (!ob || !ob.alive) continue;
      if (ob.type !== 'ice' && ob.type !== 'mud') continue;
      if (!aabbHit(me, ob.aabb)) continue;
      if (ob.traction < t) t = ob.traction;
    }
    return t;
  };

  Object.defineProperty(Tank.prototype, 'speedActual', {
    get: function () {
      var m = this.muls.speed || 1, b = this.tempBuffs, extra = 1;
      for (var i = 0; i < b.length; i++) {
        if ((b[i].type === 'dash' || b[i].type === 'speedMul') && (b[i].mul || 1) > extra) extra = b[i].mul || 1;
      }
      var v = this.speedBase * m * extra * (this._lastTraction || 1);
      var cap = this.speedBase * (this.muls.speedMaxMul || 1.8);
      return v < cap ? v : cap;
    }
  });

  Object.defineProperty(Tank.prototype, 'fireRateActual', {
    get: function () {
      var m = this.muls.fireRate || 1, b = this.tempBuffs;
      for (var i = 0; i < b.length; i++) if (b[i].type === 'fireRate') m *= (b[i].mul || 1);
      var v = this.fireRateBase * m;
      var cap = this.fireRateBase * (this.muls.fireRateMaxMul || 1.2);
      return v < cap ? v : cap;
    }
  });

  Tank.prototype._buffHas = function (type, value) {
    var b = this.tempBuffs;
    for (var i = 0; i < b.length; i++) {
      if (b[i].type !== type) continue;
      if (value == null || b[i].value === value) return true;
    }
    return false;
  };

  /* ------- 主 update ------- */
  Tank.prototype.update = function (dt, input, obstacles, tanks) {
    if (!this.alive) return;
    dt = dt || 0; input = input || {};
    this._trackT += dt;
    if (this._invincibleT > 0) this._invincibleT = Math.max(0, this._invincibleT - dt);

    if (input.turretWorldPoint) {
      var tx = input.turretWorldPoint.x - this.pos.x;
      var ty = input.turretWorldPoint.y - this.pos.y;
      if (tx * tx + ty * ty > 1) this.turretAngle = Math.atan2(ty, tx);
    }

    var traction = this._traction(obstacles);
    this._lastTraction = traction;
    if (input.directMove) {
      /* 平移式控制（玩家）：W上 S下 A左 D右，车身朝移动方向 */
      var mx = (input.right ? 1 : 0) - (input.left ? 1 : 0);
      var my = (input.down ? 1 : 0) - (input.up ? 1 : 0);
      var mlen = Math.hypot(mx, my);
      if (mlen > 0) {
        mx /= mlen; my /= mlen;
        this.angle = Math.atan2(my, mx);
      }
      var dTargetVX = mx * this.speedActual * 60;
      var dTargetVY = my * this.speedActual * 60;
      /* 加速/停止响应系数（每秒）：值越大越跟手；冰面牵引低 → 打滑感 */
      var dAccel = (18 + 6 * traction) * traction;
      var dFriction = 14 * (traction < 0.5 ? 0.35 : 1.0);
      this.vel.x += (dTargetVX - this.vel.x) * Math.min(1, dAccel * dt);
      this.vel.y += (dTargetVY - this.vel.y) * Math.min(1, dAccel * dt);
      if (mlen === 0) {
        this.vel.x -= this.vel.x * Math.min(1, dFriction * dt);
        this.vel.y -= this.vel.y * Math.min(1, dFriction * dt);
      }
    } else {
      /* 转向式控制（AI/原有行为）：A/D 转向 + W/S 前后 */
      if (input.left)  this.angle -= dt * 3.0;
      if (input.right) this.angle += dt * 3.0;
      var fwd = (input.up ? 1 : 0) - (input.down ? 1 : 0);
      var targetVX = fwd * Math.cos(this.angle) * this.speedActual * 60;
      var targetVY = fwd * Math.sin(this.angle) * this.speedActual * 60;
      var accel = (420 + 180 * traction) * traction;
      var friction = 2.6 * (traction < 0.5 ? 0.35 : 1.0);
      this.vel.x += (targetVX - this.vel.x) * Math.min(1, accel * dt / 400);
      this.vel.y += (targetVY - this.vel.y) * Math.min(1, accel * dt / 400);
      if (fwd === 0) {
        this.vel.x -= this.vel.x * Math.min(1, friction * dt);
        this.vel.y -= this.vel.y * Math.min(1, friction * dt);
      }
    }

    this.pos.x += this.vel.x * dt; this._resolveAxis('x', obstacles, tanks);
    this.pos.y += this.vel.y * dt; this._resolveAxis('y', obstacles, tanks);

    /* 地图边界：任何坦克（玩家/敌人）都不允许越出世界范围 */
    this._clampToWorldBounds();

    this.fireRateCd -= dt;
    if (input.shoot && this.fireRateCd <= 0) {
      this._fire();
      this.fireRateCd = 1 / Math.max(0.05, this.fireRateActual);
    }

    this.skillCdNow -= dt;
    this.itemCdNow -= dt;
    this._skillDenyT -= dt;
    this._itemDenyT -= dt;
    if (input.skill && this.skillCdNow <= 0) {
      var fn = SKILLS[this.tankClass];
      if (typeof fn === 'function') { try { fn(this); } catch (e) { /* noop */ } }
      this.skillCdNow = this.skillCdMax;
      emitGlobal('tank:skillCast', { tank: this, skill: this.tankClass });
    } else if (input.skill && this.skillCdNow > 0 && this._skillDenyT <= 0) {
      /* 技能冷却中按键 → 节流提醒（0.8s 一次） */
      this._skillDenyT = 0.8;
      emitGlobal('tank:skillDenied', { tank: this, remain: Math.max(0, this.skillCdNow) });
    }

    for (var s = 1; s <= 5; s++) {
      if (input['useItemSlot' + s]) { this._useSlot(s - 1); input['useItemSlot' + s] = false; }
    }

    this._tickBuffs(dt);
    this.inBush = this._overlapBush(obstacles);
    /* 传送门检测：踩上 P 门 → 传送到配对 Q 门（tryTeleport 自带 1s 双向冷却。
     * 此前 Portal 类有完整实现却无任何调用方 —— 地图上放传送门也不生效） */
    if (obstacles && obstacles.length) this._portalTick(obstacles);
  };

  /* ------- 传送门检测（每帧；obstacles 中 portal 数量极少，遍历成本可忽略） ------- */
  Tank.prototype._portalTick = function (obstacles) {
    var portals = null;
    for (var i = 0; i < obstacles.length; i++) {
      var ob = obstacles[i];
      if (!ob || !ob.alive || ob.type !== 'portal') continue;
      if (!portals) portals = [];
      portals.push(ob);
    }
    if (!portals) return;
    for (var j = 0; j < portals.length; j++) {
      if (typeof portals[j].tryTeleport === 'function' && portals[j].tryTeleport(this, portals)) return;
    }
  };

  Tank.prototype._resolveAxis = function (axis, obstacles, tanks) {
    var me = this.aabb;
    /* 最小穿透量推出：沿当前处理轴把坦克推回障碍/坦克外。
     * 必须用箭头函数保留 this（此前普通函数 this=undefined 导致
     * 碰撞解算抛异常、坦克穿墙）。 */
    const pushOut = (oa) => {
      if (axis === 'x') {
        var overlapL = (me.x + me.w) - oa.x;   // 从左侧穿透量
        var overlapR = (oa.x + oa.w) - me.x;   // 从右侧穿透量
        if (overlapL <= overlapR) this.pos.x -= overlapL + 0.01;
        else this.pos.x += overlapR + 0.01;
        this.vel.x = 0;
      } else {
        var overlapT = (me.y + me.h) - oa.y;   // 从上方穿透量
        var overlapB = (oa.y + oa.h) - me.y;   // 从下方穿透量
        if (overlapT <= overlapB) this.pos.y -= overlapT + 0.01;
        else this.pos.y += overlapB + 0.01;
        this.vel.y = 0;
      }
      me = this.aabb;
    };
    var i, ob, oa;
    if (obstacles) {
      for (i = 0; i < obstacles.length; i++) {
        ob = obstacles[i];
        if (!ob || !ob.alive || !ob.blockTank) continue;
        if (!aabbHit(me, ob.aabb)) continue;
        pushOut(ob.aabb);
      }
    }
    if (tanks) {
      for (i = 0; i < tanks.length; i++) {
        var tk = tanks[i];
        if (!tk || tk === this || !tk.alive) continue;
        oa = tk.aabb;
        if (!aabbHit(me, oa)) continue;
        pushOut(oa);
      }
    }
  };

  /* 把坦克位置限制在世界边界内（读取 CT_RENDERER.world 作为地图尺寸） */
  Tank.prototype._clampToWorldBounds = function () {
    var world = null;
    try { world = global.CT_RENDERER && global.CT_RENDERER.world; } catch (e) { world = null; }
    if (!world || !(world.w > 0) || !(world.h > 0)) return;
    var hw = this._w / 2, hh = this._h / 2;
    if (this.pos.x < hw) { this.pos.x = hw; if (this.vel.x < 0) this.vel.x = 0; }
    else if (this.pos.x > world.w - hw) { this.pos.x = world.w - hw; if (this.vel.x > 0) this.vel.x = 0; }
    if (this.pos.y < hh) { this.pos.y = hh; if (this.vel.y < 0) this.vel.y = 0; }
    else if (this.pos.y > world.h - hh) { this.pos.y = world.h - hh; if (this.vel.y > 0) this.vel.y = 0; }
  };

  Tank.prototype._overlapBush = function (obstacles) {
    if (!obstacles) return false;
    var me = this.aabb;
    for (var i = 0; i < obstacles.length; i++) {
      var ob = obstacles[i];
      if (!ob || ob.type !== 'bush' || !ob.alive) continue;
      if (aabbHit(me, ob.aabb)) return true;
    }
    return false;
  };

  Tank.prototype._tickBuffs = function (dt) {
    /* 定时增益只在真正战斗（COMBAT）阶段走表：
     * 无尽模式波间有 20 秒商店窗口，此时模式 tick 仍在推进坦克 update，
     * 若照常递减 tempBuffs，商店里买下的 15s 射速增益会在开打前就烧完
     * —— 玩家的体感即「买了却没生效」。准备期/选卡期一律冻结计时，
     * 开战后继续，与 HUD 倒计时胶囊读的同一份数据保持一致。 */
    var gs = global.CT_ENGINE && global.CT_ENGINE.gameState;
    if (gs && gs.phase && gs.phase !== 'COMBAT') return;
    for (var i = this.tempBuffs.length - 1; i >= 0; i--) {
      this.tempBuffs[i].dur -= dt;
      if (this.tempBuffs[i].dur <= 0) this.tempBuffs.splice(i, 1);
    }
  };

  /* ------- 开火（单发/激光/三重） ------- */
  Tank.prototype._fire = function () {
    var B = global.CT_BULLET; if (!B || !B.spawn) return;
    var ang = this.turretAngle;
    var m = muzzle(this, 30);
    var dmg = this.damageBase * (this.muls.dmg || 1) * Math.pow(1.25, (this.gunLevel || 1) - 1);
    var prc = this.muls.pierce | 0, spl = this.muls.splash || 0;
    var self = this;
    var spawned = [];
    function shot(off) {
      spawned.push(B.spawn({
        x: m.x, y: m.y, angle: ang + (off || 0),
        speed: 12, damage: dmg,
        owner: self.type || 'player', color: self.color,
        pierce: prc, bounces: 0, radius: 4, splash: spl
      }));
    }
    if (this._buffHas('weapon', 'laser')) {
      spawned.push(B.spawn({
        x: m.x, y: m.y, angle: ang, speed: 28,
        damage: dmg * 1.05, owner: this.type || 'player',
        color: '#ff3860', pierce: 4 + prc, bounces: 0,
        radius: 5, splash: spl + 10
      }));
    } else {
      shot(0);
      if (this._buffHas('triple')) { shot(0.32); shot(-0.32); }
    }
    // 关键：spawn 只负责创建子弹对象，必须在这里注册进 gameState.bullets，
    // 否则子弹不会更新/渲染/参与碰撞（此前玩家和 AI 都打不出子弹的根因）
    var gs = global.CT_ENGINE && global.CT_ENGINE.gameState;
    if (gs && Array.isArray(gs.bullets)) {
      for (var i = 0; i < spawned.length; i++) {
        var b = spawned[i];
        if (!b) continue;
        b._ownerRef = self;
        gs.bullets.push(b);
      }
    }
    /* 射击音效：仅玩家（敌人开火静音避免嘈杂） */
    if (this.type === 'player' && spawned.length) {
      try { global.CT_AUDIO && global.CT_AUDIO.play && global.CT_AUDIO.play('shoot'); } catch (_) {}
    }
  };

  /* ------- 受击/治疗 ------- */
  Tank.prototype.takeDamage = function (dmg, source) {
    if (!this.alive) return;
    /* 复活无敌：期间免疫一切伤害（坦克闪烁护盾提示） */
    if (this._invincibleT > 0) return;
    if (this._buffHas('shield')) return;
    var left = dmg || 0;
    if (this.shield > 0) {
      var a = Math.min(this.shield, left);
      this.shield -= a; left -= a;
    }
    left *= 1 - clamp(this.muls.dr || 0, 0, 0.95);
    this.hp -= left;
    emitGlobal('tank:damaged', { tank: this, dmg: left, source: source });
    if (this.hp <= 0) {
      this.hp = 0; this.alive = false;
      /* 载荷同时带 tank 与 dead 两个字段：
       * effects.js/particles.js 读 ev.tank，horde/king-hill/wave-manager 读 ev.dead
       * —— 此前只发 tank 导致击杀计数与玩家死亡结算全部失效 */
      emitGlobal('tank:dead', { tank: this, dead: this, source: source });
    }
  };
  Tank.prototype.heal = function (n) {
    if (!this.alive) return;
    var cap = (this.maxHp || 0) + (this.extraMaxHp || 0);
    if (cap <= 0) return;
    this.hp = clamp((this.hp || 0) + (n || 0), 0, cap);
  };
  /** 设置复活后无敌时长（取较大值，避免被短暂刷新覆盖） */
  Tank.prototype.setInvincible = function (sec) {
    this._invincibleT = Math.max(this._invincibleT || 0, sec || 0);
  };

  /* ------- 道具栏 FIFO ------- */
  Tank.prototype.addInventory = function (def) {
    if (!def) return;
    /* 道具栏只有 5 格：满了按 FIFO 挤掉最早一格。
     * 此前是静默 shift()，买到第 6 件时最早的道具「凭空消失」且毫无提示，
     * 玩家会误判为「买了但没进道具栏」。这里先广播被挤掉的道具再入队，
     * 由 hud.js 监听 tank:inventoryOverflow 弹提示（数据层只负责如实上报，不做 UI）。 */
    if (this.inventory.length >= 5) {
      var evicted = this.inventory.shift();
      try { emitGlobal('tank:inventoryOverflow', { tank: this, evicted: evicted && evicted.def, def: def }); } catch (e) {}
    }
    this.inventory.push({ id: def.id, def: def });
  };
  Tank.prototype._useSlot = function (idx) {
    if (idx < 0 || idx >= this.inventory.length) return;
    /* 道具公共冷却（1.2s）：防止 1~5 连按瞬间清空背包 */
    if (this.itemCdNow > 0) {
      if (this._itemDenyT <= 0) {
        this._itemDenyT = 0.8;
        emitGlobal('tank:itemDenied', { tank: this, remain: Math.max(0, this.itemCdNow) });
      }
      return;
    }
    var slot = this.inventory.splice(idx, 1)[0];
    this.itemCdNow = ITEM_USE_CD;
    /* 使用事件必须无条件发出（HUD 的 toast/反馈依赖它）：
     * 此前事件在 apply 的 try 内，道具 def 缺 apply 或 apply 抛错时
     * 道具被吞掉却毫无反馈。效果归效果、反馈归反馈，分开处理。 */
    if (slot && slot.def && typeof slot.def.apply === 'function') {
      try { slot.def.apply(this); } catch (e) { /* 效果失败不吞事件 */ }
    }
    try { emitGlobal('tank:useInventory', { tank: this, def: slot && slot.def }); } catch (e) {}
  };

  /* =========================================================
   * 渲染：发光描边 + 车身 + 履带 + 炮塔 + 炮管 + HP/盾条
   * ========================================================= */
  Tank.prototype.render = function (ctx, camera) {
    if (!this.alive) return;
    var sx = this.pos.x, sy = this.pos.y;
    if (camera) {
      sx = (sx - camera.x) * (camera.scale || 1) + camera.w / 2;
      sy = (sy - camera.y) * (camera.scale || 1) + camera.h / 2;
    }
    /* 移动端模型缩放（仅视觉，不影响碰撞/命中框 _w/_h）：
     * 由 mobile.js 在触屏设备置 global.CT_TANK_RENDER_SCALE（默认 undefined→1，桌面零影响）。
     * 解决移动端坦克过大、居中后遮挡视野的问题。 */
    var s = (global.CT_TANK_RENDER_SCALE && global.CT_TANK_RENDER_SCALE > 0) ? global.CT_TANK_RENDER_SCALE : 1;
    var w = this._w * s, h = this._h * s;
    /* 草丛隐身：敌方坦克进入草丛近乎不可见；玩家保留淡淡轮廓 + 头顶光标便于定位 */
    var alpha = this.inBush ? (this.type === 'player' ? 0.22 : 0.08) : 1.0;

    /* 复活无敌护盾环（脉动） */
    if (this._invincibleT > 0) {
      var pulse = 0.55 + 0.45 * Math.sin(Date.now() / 70);
      ctx.save();
      ctx.globalAlpha = alpha * (0.6 + 0.4 * pulse);
      ctx.strokeStyle = '#00e5ff';
      ctx.lineWidth = 3;
      ctx.shadowColor = '#00e5ff';
      ctx.shadowBlur = 18;
      ctx.beginPath();
      ctx.arc(sx, sy, w * 0.78, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    /* 玩家专属高亮描边：白色外框 + 青色辉光，草丛半隐时也保持可见 */
    if (this.type === 'player') {
      ctx.save(); ctx.globalAlpha = alpha;
      ctx.translate(sx, sy); ctx.rotate(this.angle);
      ctx.strokeStyle = 'rgba(255,255,255,0.95)';
      ctx.lineWidth = 3;
      ctx.shadowColor = '#00e5ff'; ctx.shadowBlur = 16;
      roundRect(ctx, -w / 2 - 3.5, -h / 2 - 3.5, w + 7, h + 7, 11); ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = 'rgba(0,229,255,0.6)'; ctx.lineWidth = 1.5;
      roundRect(ctx, -w / 2 - 6, -h / 2 - 6, w + 12, h + 12, 13); ctx.stroke();
      ctx.restore();
    }

    /* 车身 */
    ctx.save(); ctx.globalAlpha = alpha;
    ctx.translate(sx, sy); ctx.rotate(this.angle);
    ctx.shadowColor = this.color; ctx.shadowBlur = 15;
    ctx.fillStyle = rgba(this.color, 0.22);
    ctx.strokeStyle = this.color; ctx.lineWidth = 2.5;
    roundRect(ctx, -w / 2, -h / 2, w, h, 8); ctx.fill(); ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#1a1f2c';
    ctx.fillRect(-w / 2, -h / 2, 8, h); ctx.fillRect(w / 2 - 8, -h / 2, 8, h);
    ctx.strokeStyle = 'rgba(232,248,255,0.4)'; ctx.lineWidth = 1;
    var offT = (this._trackT * 60) % 10;
    for (var r = 0; r < 7; r++) {
      var yy = -h / 2 + r * (h / 6) + offT - 5;
      ctx.beginPath(); ctx.moveTo(-w / 2 + 1, yy); ctx.lineTo(-w / 2 + 7, yy); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(w / 2 - 7, yy); ctx.lineTo(w / 2 - 1, yy); ctx.stroke();
    }
    ctx.fillStyle = lighten(this.color, 0.3);
    ctx.beginPath(); ctx.arc(w / 2 - 4, -5, 2, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(w / 2 - 4, 5, 2, 0, Math.PI * 2); ctx.fill();
    ctx.restore();

    /* 炮塔 + 炮管（独立旋转） */
    ctx.save(); ctx.globalAlpha = alpha;
    ctx.translate(sx, sy); ctx.rotate(this.turretAngle);
    ctx.shadowColor = this.color; ctx.shadowBlur = 10;
    ctx.fillStyle = rgba(this.color, 0.35); ctx.strokeStyle = lighten(this.color, 0.1);
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(0, 0, w * 0.3, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.shadowBlur = 6;
    ctx.fillStyle = lighten(this.color, 0.25); ctx.strokeStyle = lighten(this.color, 0.5);
    var bl = w * 0.6, bw = 6;
    ctx.beginPath(); ctx.rect(0, -bw / 2, bl, bw); ctx.fill(); ctx.stroke();
    ctx.shadowBlur = 12; ctx.fillStyle = lighten(this.color, 0.6);
    ctx.beginPath(); ctx.arc(bl, 0, 2.6, 0, Math.PI * 2); ctx.fill();
    ctx.restore();

    /* HP/盾条 */
    var bw2 = 44, bh = 4;
    var bx = sx - bw2 / 2, by = sy - h / 2 - 10;
    ctx.save(); ctx.globalAlpha = alpha;
    ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillRect(bx - 1, by - 1, bw2 + 2, bh + 2);
    var hpR = clamp((this.hp || 0) / Math.max(1, (this.maxHp || 0) + (this.extraMaxHp || 0)), 0, 1);
    ctx.fillStyle = '#ff3860'; ctx.fillRect(bx, by, bw2 * hpR, bh);
    if (this.shield > 0) {
      var sR = clamp(this.shield / Math.max(1, this.maxHp || 0), 0, 1);
      ctx.fillStyle = '#00c8ff'; ctx.fillRect(bx, by + bh + 1, bw2 * sR, bh - 1);
    }
    ctx.restore();
  };

  /* 导出 */
  var CT_TANK = { Tank: Tank, BASE_STATS: BASE_STATS, SKILLS: SKILLS, _aabbHit: aabbHit };
  global.CT_TANK = CT_TANK;
  if (typeof module !== 'undefined' && module.exports) module.exports = CT_TANK;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));

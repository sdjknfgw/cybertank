/* =========================================================
 * CyberTank · 道具系统模块（16 种 P01~P16）
 * 命名空间: window.CT_POWERUP
 * 含：Powerup 类 / PowerupDefs 定义表 / 对象池 / spawn / pickup
 * ========================================================= */
(function (global) {
  'use strict';

  /** 稀有度枚举 */
  var RARITY = {
    COMMON: 'common',
    RARE: 'rare',
    EPIC: 'epic',
    LEGENDARY: 'legendary'
  };
  /** 稀有度对应发光色 */
  var RARITY_COLOR = {
    common:    '#e8f8ff',
    rare:      '#00f0ff',
    epic:      '#bf5bff',
    legendary: '#ffd700'
  };
  /** 稀有度≥史诗在浮动时额外旋转 */
  var RARITY_ROTATE_MIN = 2;

  /* =========================================================
   * 16 种道具定义 P01~P16
   * 字段：{id, name, icon, emoji, rarity, color, duration?, desc, apply(tank)}
   * ========================================================= */
  var PowerupDefs = {
    /* P01 生命包 +1HP（上限+1） */
    P01: {
      id: 'P01', name: '生命包', rarity: RARITY.COMMON,
      icon: 'heart', emoji: '\u2764', color: '#ff4d6d',
      desc: '+1 最大 HP 并回复 1 点',
      apply: function (tank) {
        tank.maxHp = (tank.maxHp || 1) + 1;
        tank.hp = Math.min(tank.maxHp + (tank.extraMaxHp || 0), (tank.hp || 0) + 1);
        tank.hp = Math.min(tank.maxHp + (tank.extraMaxHp || 0), Math.max(tank.hp, 1));
      }
    },
    /* P02 急速 speed×1.5 8s */
    P02: {
      id: 'P02', name: '急速引擎', rarity: RARITY.COMMON,
      icon: 'bolt', emoji: '\u26A1', color: '#fff27a', duration: 8,
      desc: '移速 ×1.5，持续 8s',
      apply: function (tank) {
        pushTempBuff(tank, { type: 'speedMul', mul: 1.5, dur: 8 });
      }
    },
    /* P03 三重射击 10s */
    P03: {
      id: 'P03', name: '三重射击', rarity: RARITY.COMMON,
      icon: 'triple', emoji: '\uD83D\uDCA5', color: '#66e0ff', duration: 10,
      desc: '三连扇形子弹，持续 10s',
      apply: function (tank) {
        pushTempBuff(tank, { type: 'triple', mul: 1, dur: 10 });
        emitGlobal('player:buffApply', { id: 'F05', tank: tank });
      }
    },
    /* P04 无敌护盾 6s + hp+1 */
    P04: {
      id: 'P04', name: '无敌护盾', rarity: RARITY.RARE,
      icon: 'shield', emoji: '\uD83D\uDEE1', color: '#00e0ff', duration: 6,
      desc: '6s 无敌 + 最大 HP +1',
      apply: function (tank) {
        tank.maxHp = (tank.maxHp || 1) + 1;
        tank.hp = Math.min(tank.maxHp, tank.hp + 1);
        pushTempBuff(tank, { type: 'shield', mul: 1, dur: 6 });
      }
    },
    /* P05 激光炮 15s 穿透直线 */
    P05: {
      id: 'P05', name: '激光炮', rarity: RARITY.RARE,
      icon: 'laser', emoji: '\uD83C\uDFAF', color: '#ff6666', duration: 15,
      desc: '切换武器 laser，15s 穿透直线 hitScan',
      apply: function (tank) {
        pushTempBuff(tank, { type: 'weapon', value: 'laser', dur: 15 });
      }
    },
    /* P06 磁吸 pickupRadius+60% 12s */
    P06: {
      id: 'P06', name: '磁吸装置', rarity: RARITY.COMMON,
      icon: 'magnet', emoji: '\uD83E\uDDF2', color: '#ff4db3', duration: 12,
      desc: '拾取范围 +60%，12s',
      apply: function (tank) {
        pushTempBuff(tank, { type: 'pickup', mul: 1.6, dur: 12 });
      }
    },
    /* P07 金币袋 coins +=80 */
    P07: {
      id: 'P07', name: '金币袋', rarity: RARITY.COMMON,
      icon: 'coin', emoji: '\uD83D\uDCB0', color: '#ffd700',
      desc: '获得 80 金币',
      apply: function (tank) {
        tank.coins = (tank.coins || 0) + 80;
        emitGlobal('player:coins', { tank: tank, delta: 80 });
      }
    },
    /* P08 随机传送 */
    P08: {
      id: 'P08', name: '随机传送', rarity: RARITY.COMMON,
      icon: 'teleport', emoji: '\uD83C\uDF00', color: '#c86cff',
      desc: '随机瞬移到安全区位置',
      apply: function (tank) {
        var arena = getArenaSize();
        tank.pos.x = 100 + Math.random() * (arena.w - 200);
        tank.pos.y = 100 + Math.random() * (arena.h - 200);
        tank.vel.x = 0; tank.vel.y = 0;
        emitGlobal('player:randomTeleport', { tank: tank });
      }
    },
    /* P09 升级火炮等级 gunLevel++ */
    P09: {
      id: 'P09', name: '升级芯片', rarity: RARITY.RARE,
      icon: 'upgrade', emoji: '\uD83D\uDCC8', color: '#39ff14',
      desc: '火炮等级 +1，伤害 ×1.25',
      apply: function (tank) {
        tank.gunLevel = (tank.gunLevel || 1) + 1;
        tank.muls.dmg = (tank.muls.dmg || 1) * 1.25;
      }
    },
    /* P10 核弹 全屏爆炸 99 */
    P10: {
      id: 'P10', name: '核弹', rarity: RARITY.EPIC,
      icon: 'nuke', emoji: '\uD83D\uDCA3', color: '#ff3860',
      desc: '全屏爆炸，对所有敌人造成 99 伤害',
      apply: function (tank) {
        emitGlobal('player:nuke', { tank: tank, damage: 99 });
      }
    },
    /* P11 增益重掷骰 */
    P11: {
      id: 'P11', name: '增益重掷骰', rarity: RARITY.RARE,
      icon: 'dice', emoji: '\uD83C\uDFB2', color: '#ffdd57',
      desc: '下次增益选择可免费重抽一次',
      apply: function (tank) {
        /* 写入 flags（模式读 flags.nextBuffReroll）—— 此前写在 tank 根属性上
         * 模式读不到 → 拾取后重掷功能从未生效 */
        if (!tank.flags) tank.flags = {};
        tank.flags.nextBuffReroll = true;
      }
    },
    /* P12 稀有度提升卡 */
    P12: {
      id: 'P12', name: '稀有度提升卡', rarity: RARITY.EPIC,
      icon: 'star', emoji: '\u2B50', color: '#ffb347',
      desc: '下次增益选择全体升一阶稀有度',
      apply: function (tank) {
        if (!tank.flags) tank.flags = {};
        tank.flags.nextBuffRarityUp = true;
      }
    },
    /* P13 建造模块 放置4格砖墙 */
    P13: {
      id: 'P13', name: '建造模块', rarity: RARITY.COMMON,
      icon: 'build', emoji: '\uD83E\uDDF1', color: '#c87a4a',
      desc: '原地放置 2×2 砖墙',
      apply: function (tank) {
        emitGlobal('powerup:placeBricks', {
          centerX: tank.pos.x, centerY: tank.pos.y, size: 2,
          angle: tank.turretAngle || 0
        });
      }
    },
    /* P14 地雷 ×3 */
    P14: {
      id: 'P14', name: '地雷 ×3', rarity: RARITY.COMMON,
      icon: 'mine', emoji: '\uD83D\uDCA3', color: '#ff7f50',
      desc: '围绕自身 3 颗地雷',
      apply: function (tank) {
        var i, ang;
        for (i = 0; i < 3; i++) {
          ang = (Math.PI * 2 / 3) * i - Math.PI / 2;
          emitGlobal('powerup:spawnMine', {
            x: tank.pos.x + Math.cos(ang) * 60,
            y: tank.pos.y + Math.sin(ang) * 60,
            damage: 6, owner: tank.type || 'player'
          });
        }
      }
    },
    /* P15 侦察无人机 20s mapReveal */
    P15: {
      id: 'P15', name: '侦察无人机', rarity: RARITY.RARE,
      icon: 'drone', emoji: '\uD83E\uDD16', color: '#9be7ff', duration: 20,
      desc: '20s 内揭示全图敌人位置',
      apply: function (tank) {
        pushTempBuff(tank, { type: 'mapReveal', mul: 1, dur: 20 });
        emitGlobal('player:mapReveal', { tank: tank, dur: 20 });
      }
    },
    /* P16 撤退信标 teleportToBase */
    P16: {
      id: 'P16', name: '撤退信标', rarity: RARITY.RARE,
      icon: 'beacon', emoji: '\uD83D\uDEAA', color: '#a06cff',
      desc: '立即传送回基地/出生点',
      apply: function (tank) {
        var base = tank.spawnPos || { x: 320, y: 320 };
        tank.pos.x = base.x;
        tank.pos.y = base.y;
        tank.vel.x = 0; tank.vel.y = 0;
        emitGlobal('player:teleportToBase', { tank: tank });
      }
    }
  };

  /* ---------------- 小工具 ---------------- */
  function pushTempBuff(tank, buff) {
    if (!tank) return;
    if (!Array.isArray(tank.tempBuffs)) tank.tempBuffs = [];
    /* max = 总时长快照：dur 会被逐秒递减，进度环需要「剩余/总量」才能画。
     * HUD 倒计时胶囊直接渲染 tempBuffs（唯一数据源），依赖该字段。 */
    tank.tempBuffs.push(Object.assign({ born: performance.now() / 1000, max: buff && buff.dur }, buff));
  }
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
  function getArenaSize() {
    var Engine = global.CT_ENGINE;
    if (Engine && Engine.worldSize) return Engine.worldSize;
    return { w: 1600, h: 1200 };
  }

  /* 兜底对象池（同 bullet.js） */
  function FallbackPool(Cls, cap) {
    this._ctor = Cls;
    this._cap = cap | 0 || 64;
    this._stack = [];
    this._liveCount = 0;
    for (var i = 0; i < this._cap; i++) {
      this._stack.push(new Cls({ __poolInit: true }));
    }
  }
  FallbackPool.prototype.acquire = function () {
    var o = this._stack.length ? this._stack.pop() : new this._ctor({ __poolInit: true });
    this._liveCount++;
    o.__pooled = false;
    return o;
  };
  FallbackPool.prototype.release = function (o) {
    if (!o || o.__pooled) return;
    o.__pooled = true;
    o.alive = false;
    this._liveCount = Math.max(0, this._liveCount - 1);
    if (this._stack.length < this._cap * 2) this._stack.push(o);
  };
  Object.defineProperty(FallbackPool.prototype, 'size', {
    get: function () { return this._liveCount; }
  });
  function makePool(Cls, cap) {
    var Engine = global.CT_ENGINE;
    if (Engine && Engine.ObjectPool && typeof Engine.ObjectPool === 'function') {
      try {
        var p = new Engine.ObjectPool(Cls, cap);
        if (p && typeof p.acquire === 'function') return p;
      } catch (_) { }
    }
    return new FallbackPool(Cls, cap);
  }

  /* =========================================================
   * Powerup 类
   * ========================================================= */
  /**
   * 道具实体：上下浮动 + 旋转（稀有度>=史诗）+ AABB 拾取
   * @class
   */
  function Powerup(opts) {
    opts = opts || {};
    /** 存活标记 */
    this.alive = !opts.__poolInit ? true : false;
    /** 位置 */
    this.pos = { x: opts.x || 0, y: opts.y || 0 };
    /** 尺寸 */
    this.w = 36; this.h = 36;
    /** 引用道具定义 */
    this.def = opts.def || null;
    /** 道具 id（P01~P16） */
    this.powerupId = opts.powerupId || null;
    /** 浮动计时 */
    this._t = Math.random() * Math.PI * 2;
    /** 旋转角（仅史诗以上使用） */
    this._rot = 0;
    /** 初始 y 偏移，用于浮动 */
    this._baseY = this.pos.y;
    /** 碰撞盒（考虑拾取半径扩大） */
    this.pickupRadius = opts.pickupRadius == null ? 32 : opts.pickupRadius;
  }

  /** AABB：按 w/h + 中心 */
  Object.defineProperty(Powerup.prototype, 'aabb', {
    get: function () {
      return {
        x: this.pos.x - this.w / 2,
        y: this.pos.y - this.h / 2,
        w: this.w, h: this.h
      };
    }
  });

  /**
   * 重置（对象池复用）
   * @param {object} opts { x, y, powerupId }
   */
  Powerup.prototype.reset = function (opts) {
    opts = opts || {};
    this.alive = true;
    this.pos.x = opts.x || 0;
    this.pos.y = opts.y || 0;
    this._baseY = this.pos.y;
    this._t = Math.random() * Math.PI * 2;
    this._rot = 0;
    this.pickupRadius = opts.pickupRadius == null ? 32 : opts.pickupRadius;
    this.powerupId = opts.powerupId || null;
    this.def = this.powerupId ? (PowerupDefs[this.powerupId] || null) : (opts.def || null);
    return this;
  };

  /**
   * 更新浮动 + 旋转 + 拾取检测
   * @param {number} dt
   * @param {Array} [obstacles] 占位（与其他实体 update 签名保持一致）
   * @param {Array<Tank>} [tanks] 坦克数组（玩家/敌人都会检测）
   */
  Powerup.prototype.update = function (dt, obstacles, tanks) {
    if (!this.alive) return false;
    dt = dt || 0;
    this._t += dt * 3;
    this.pos.y = this._baseY + Math.sin(this._t) * 4;
    if (this.def && rarityRank(this.def.rarity) >= RARITY_ROTATE_MIN) {
      this._rot += dt * 2.2;
    }
    /* 磁吸：检测玩家坦克是否携带 pickup buff */
    if (tanks && tanks.length) {
      var i, pick, ddx, ddy, dd, rAct;
      for (i = 0; i < tanks.length; i++) {
        var tk = tanks[i];
        if (!tk || !tk.alive) continue;
        if (tk.type !== 'player') continue;
        pick = this.pickupRadius * (tk.muls && tk.muls.pickup ? tk.muls.pickup : 1);
        /* 扩大检查：磁吸 + 距离，然后真正的碰撞用 AABB */
        ddx = (tk.pos.x) - this.pos.x;
        ddy = (tk.pos.y) - this.pos.y;
        dd = Math.sqrt(ddx * ddx + ddy * ddy);
        rAct = pick + 40;
        if (dd < rAct && dd > 10) {
          /* 向坦克移动 */
          this.pos.x += (ddx / dd) * (dt * 220);
          this._baseY += ((tk.pos.y) - this._baseY) * Math.min(1, dt * 3);
        }
        /* 拾取 */
        var taabb = tk.aabb;
        var box = this.aabb;
        if (!(taabb.x + taabb.w < box.x || box.x + box.w < taabb.x ||
              taabb.y + taabb.h < box.y || box.y + box.h < taabb.y)) {
          this._pickup(tk);
          return false;
        }
      }
    }
    return this.alive;
  };

  /** 内部拾取：apply + 事件 */
  Powerup.prototype._pickup = function (tank) {
    if (!this.def) { this.alive = false; return; }
    try {
      if (typeof this.def.apply === 'function') this.def.apply(tank);
      emitGlobal('powerup:picked', { tank: tank, def: this.def, powerupId: this.powerupId });
    } catch (e) {
      if (typeof console !== 'undefined' && console.error) console.error('[Powerup.apply]', e);
    }
    this.alive = false;
  };

  /**
   * 渲染：发光圆环 + emoji / 几何兜底；legendary 加双光环
   */
  Powerup.prototype.render = function (ctx, camera) {
    if (!this.alive || !this.def) return;
    var sx = this.pos.x, sy = this.pos.y;
    if (camera) {
      sx = (sx - camera.x) * (camera.scale || 1) + camera.w / 2;
      sy = (sy - camera.y) * (camera.scale || 1) + camera.h / 2;
    }
    var def = this.def;
    var r = RARITY_COLOR[def.rarity] || '#fff';
    ctx.save();
    ctx.translate(sx, sy);
    /* 光环（legendary 双环） */
    var ringR = this.w * 0.9;
    if (def.rarity === RARITY.LEGENDARY) {
      ctx.save();
      ctx.shadowColor = r; ctx.shadowBlur = 28;
      ctx.strokeStyle = r; ctx.lineWidth = 2;
      ctx.rotate(-this._rot);
      ctx.beginPath(); ctx.arc(0, 0, ringR, 0, Math.PI * 1.6); ctx.stroke();
      ctx.rotate(this._rot * 2.1);
      ctx.strokeStyle = '#ffffff';
      ctx.beginPath(); ctx.arc(0, 0, ringR * 0.75, 0, Math.PI * 1.3); ctx.stroke();
      ctx.restore();
    } else if (rarityRank(def.rarity) >= 2) {
      ctx.save();
      ctx.shadowColor = r; ctx.shadowBlur = 18;
      ctx.strokeStyle = r; ctx.lineWidth = 2;
      ctx.rotate(this._rot);
      ctx.beginPath(); ctx.arc(0, 0, ringR * 0.85, 0, Math.PI * 1.7); ctx.stroke();
      ctx.restore();
    }
    /* 外发光圆 */
    ctx.shadowColor = r;
    ctx.shadowBlur = 16;
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.strokeStyle = r;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, this.w * 0.55, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.shadowBlur = 0;

    /* 图标：优先 emoji（canvas font 简单兜底） */
    ctx.fillStyle = def.color || '#fff';
    ctx.font = 'bold 22px "Segoe UI Emoji", "Apple Color Emoji", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    var emoji = def.emoji;
    var hasBadEsc = false;
    if (typeof emoji === 'string') {
      var bs = String.fromCharCode(92);
      if (emoji.indexOf(bs + 'u') !== -1) hasBadEsc = true;
    }
    if (emoji && typeof emoji === 'string' && !hasBadEsc) {
      try { ctx.fillText(emoji, 0, 1); } catch (e2) { hasBadEsc = true; }
    }
    /* emoji 兜底：简单几何 */
    var needFallback = (!emoji || typeof emoji !== 'string' || emoji.length === 0 || hasBadEsc);
    if (needFallback) {
      ctx.fillStyle = def.color || r;
      ctx.fillRect(-7, -7, 14, 14);
    }
    ctx.restore();
  };

  /** 稀有度排序数值（越大越稀有） */
  function rarityRank(r) {
    switch (r) {
      case RARITY.COMMON: return 1;
      case RARITY.RARE: return 2;
      case RARITY.EPIC: return 3;
      case RARITY.LEGENDARY: return 4;
      default: return 0;
    }
  }

  /* =========================================================
   * 对外 spawn / recycle / 对象池
   * ========================================================= */
  var Pool = makePool(Powerup, 128);

  /**
   * 生成道具实例
   * @param {number} x 世界坐标
   * @param {number} y 世界坐标
   * @param {string} powerupId P01~P16
   */
  function spawn(x, y, powerupId) {
    var p = Pool.acquire();
    return p.reset({ x: x, y: y, powerupId: powerupId });
  }
  /** 按权重随机生成：common/rare/epic/legendary 按 0.55/0.28/0.13/0.04 */
  function spawnRandom(x, y) {
    var id = randomPickIdByRarity();
    return spawn(x, y, id);
  }
  function randomPickIdByRarity() {
    var ids = Object.keys(PowerupDefs);
    var byR = { common: [], rare: [], epic: [], legendary: [] };
    ids.forEach(function (id) {
      var r = (PowerupDefs[id] && PowerupDefs[id].rarity) || 'common';
      if (byR[r]) byR[r].push(id);
    });
    var roll = Math.random();
    var bucket;
    if (roll < 0.55) bucket = byR.common;
    else if (roll < 0.55 + 0.28) bucket = byR.rare;
    else if (roll < 0.55 + 0.28 + 0.13) bucket = byR.epic;
    else bucket = byR.legendary;
    if (!bucket || !bucket.length) bucket = byR.common;
    return bucket[(Math.random() * bucket.length) | 0];
  }
  function recycle(p) { Pool.release(p); }

  var CT_POWERUP = {
    Powerup: Powerup,
    PowerupDefs: PowerupDefs,
    RARITY: RARITY,
    RARITY_COLOR: RARITY_COLOR,
    Pool: Pool,
    spawn: spawn,
    spawnRandom: spawnRandom,
    recycle: recycle,
    _rarityRank: rarityRank
  };
  global.CT_POWERUP = CT_POWERUP;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = CT_POWERUP;
  }
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));

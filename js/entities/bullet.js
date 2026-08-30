/* =========================================================
 * CyberTank · 子弹实体模块
 * 命名空间: window.CT_BULLET
 * 包含: Bullet 类 / ObjectPool 兜底 / spawn 工厂
 * ========================================================= */
(function (global) {
  'use strict';

  /** 水位常量：对象池初始容量 */
  var POOL_WATERMARK = 200;
  /** AABB 碰撞阈值辅助常量 */
  var AABB_EPS = 0.0001;

  /* ---------- 兜底对象池（若 CT_ENGINE 未实现） ---------- */
  function FallbackPool(Cls, capacity) {
    this._ctor = Cls;
    this._cap = capacity | 0 || 64;
    this._stack = [];
    this._liveCount = 0;
    var i;
    for (i = 0; i < this._cap; i++) {
      this._stack.push(new Cls({ x: 0, y: 0, angle: 0, __poolInit: true }));
    }
  }
  FallbackPool.prototype.acquire = function () {
    var obj = this._stack.length > 0
      ? this._stack.pop()
      : new this._ctor({ x: 0, y: 0, angle: 0, __poolInit: true });
    this._liveCount++;
    obj.__pooled = false;
    return obj;
  };
  FallbackPool.prototype.release = function (obj) {
    if (!obj || obj.__pooled) return;
    obj.__pooled = true;
    obj.alive = false;
    this._liveCount = Math.max(0, this._liveCount - 1);
    if (this._stack.length < this._cap * 2) this._stack.push(obj);
  };
  Object.defineProperty(FallbackPool.prototype, 'size', {
    get: function () { return this._liveCount; }
  });

  /** 从引擎中优先取 ObjectPool，不存在则降级 */
  function makePool(Cls, cap) {
    var Engine = global.CT_ENGINE;
    if (Engine && Engine.ObjectPool && typeof Engine.ObjectPool === 'function') {
      try {
        var p = new Engine.ObjectPool(Cls, cap);
        if (p && typeof p.acquire === 'function') return p;
      } catch (_) { /* 静默降级 */ }
    }
    return new FallbackPool(Cls, cap);
  }

  /** AABB 相交检测（tank / obstacle / powerup 通用） */
  function aabbHit(a, b) {
    return !(a.x + a.w < b.x + AABB_EPS ||
             b.x + b.w < a.x + AABB_EPS ||
             a.y + a.h < b.y + AABB_EPS ||
             b.y + b.h < a.y + AABB_EPS);
  }

  /* ======================= Bullet 类 ======================= */
  /**
   * 子弹实体：支持速度向量、反弹、穿透、溅射
   * @class
   * @param {object} opts
   * @param {number} opts.x 初始 x
   * @param {number} opts.y 初始 y
   * @param {number} opts.angle 发射弧度角
   * @param {number} [opts.speed=10] 像素/秒
   * @param {number} [opts.damage=1] 伤害值
   * @param {string} [opts.owner='player'] 归属 player/enemy/boss
   * @param {string} [opts.color='#00f0ff'] 子弹颜色
   * @param {number} [opts.pierce=0] 穿透次数（命中不消耗子弹）
   * @param {number} [opts.bounces=0] 打墙反弹次数
   * @param {number} [opts.radius=4] 子弹半径
   * @param {number} [opts.splash=0] 溅射半径（0 = 无溅射）
   * @param {Function} [opts.onHit=null] 命中时额外回调
   */
  function Bullet(opts) {
    opts = opts || {};
    /** 子弹是否仍存活 */
    this.alive = !opts.__poolInit ? true : false;
    /** 位置坐标 */
    this.pos = { x: opts.x || 0, y: opts.y || 0 };
    /** 速度向量 */
    this.vel = { x: 0, y: 0 };
    /** 命中穿透剩余次数 */
    this.pierce = opts.pierce | 0;
    /** 墙反弹剩余次数 */
    this.bounces = opts.bounces | 0;
    /** 溅射半径（0 = 关闭） */
    this.splash = opts.splash || 0;
    /** 伤害 */
    this.damage = opts.damage == null ? 1 : opts.damage;
    /** 子弹颜色 */
    this.color = opts.color || '#00f0ff';
    /** 半径 */
    this.radius = opts.radius == null ? 4 : opts.radius;
    /** 归属：player / enemy / boss */
    this.owner = opts.owner || 'player';
    /** 命中回调 */
    this.onHit = typeof opts.onHit === 'function' ? opts.onHit : null;
    /** 命中记录（用于 pierce 避免同目标多次触发） */
    this._hitSet = null;
    if (!opts.__poolInit) {
      var spd = opts.speed == null ? 10 : opts.speed;
      this.vel.x = Math.cos(opts.angle || 0) * spd;
      this.vel.y = Math.sin(opts.angle || 0) * spd;
      this._hitSet = new Set();
    }
  }

  /**
   * 重置状态（对象池复用入口）
   * @param {object} opts 构造参数
   * @returns {Bullet}
   */
  Bullet.prototype.reset = function (opts) {
    opts = opts || {};
    this.alive = true;
    this.pos.x = opts.x || 0;
    this.pos.y = opts.y || 0;
    this.pierce = opts.pierce | 0;
    this.bounces = opts.bounces | 0;
    this.splash = opts.splash || 0;
    this.damage = opts.damage == null ? 1 : opts.damage;
    this.color = opts.color || '#00f0ff';
    this.radius = opts.radius == null ? 4 : opts.radius;
    this.owner = opts.owner || 'player';
    this.onHit = typeof opts.onHit === 'function' ? opts.onHit : null;
    var spd = opts.speed == null ? 10 : opts.speed;
    var ang = opts.angle || 0;
    this.vel.x = Math.cos(ang) * spd;
    this.vel.y = Math.sin(ang) * spd;
    if (!this._hitSet) this._hitSet = new Set(); else this._hitSet.clear();
    return this;
  };

  /** AABB 碰撞盒（按半径构造） */
  Object.defineProperty(Bullet.prototype, 'aabb', {
    get: function () {
      var r = this.radius;
      return { x: this.pos.x - r, y: this.pos.y - r, w: r * 2, h: r * 2 };
    }
  });

  /**
   * 更新移动 + 碰撞处理
   * @param {number} dt 帧间隔（秒）
   * @param {Array} obstacles 障碍物列表
   * @param {Array} tanks 坦克列表
   * @returns {boolean} alive
   */
  Bullet.prototype.update = function (dt, obstacles, tanks) {
    if (!this.alive) return false;
    dt = dt || 0;
    this.pos.x += this.vel.x * dt * 60;
    this.pos.y += this.vel.y * dt * 60;

    /* 越界直接销毁（若之后设置了 world bounds，可由 wave manager 管理） */
    if (this.pos.x < -2000 || this.pos.x > 100000 || this.pos.y < -2000 || this.pos.y > 100000) {
      this.alive = false;
      return false;
    }

    /* ------------ 与障碍物碰撞 ------------ */
    if (obstacles && obstacles.length) {
      for (var i = 0; i < obstacles.length; i++) {
        var ob = obstacles[i];
        if (!ob || !ob.alive) continue;
        /* 草丛不阻挡子弹 */
        if (ob.type === 'bush') continue;
        /* 水面不阻挡子弹 */
        if (ob.type === 'water') continue;
        if (!aabbHit(this.aabb, ob.aabb)) continue;

        /* 子弹可以摧毁砖墙：直接扣 hp */
        if (ob.type === 'brick' && ob.hp !== Infinity) {
          ob.hp -= this.damage;
          if (ob.hp <= 0) {
            ob.alive = false;
            /* 20% 概率触发道具掉落 */
            if (Math.random() < 0.2) {
              emitGlobal('powerup:spawnDrop', {
                x: ob.aabb.x + ob.aabb.w / 2,
                y: ob.aabb.y + ob.aabb.h / 2
              });
            }
          }
        } else if (ob.type === 'steel') {
          /* 钢墙默认不可破坏；如果是核弹/激光类子弹通过外部 destroyForced() */
        } else if (ob.type === 'portal') {
          /* 传送门不阻挡子弹 */
          continue;
        } else if (ob.type === 'ice' || ob.type === 'mud') {
          /* 冰面泥地不阻挡 */
          continue;
        }

        /* 反弹逻辑 */
        if (this.bounces > 0 && (ob.type === 'brick' || ob.type === 'steel')) {
          this._reflectFromRect(ob.aabb);
          this.bounces--;
          /* 反弹后把子弹推出 box，避免逐帧夹死 */
          this._pushOutOfRect(ob.aabb);
          return true;
        }

        /* 溅射：命中后触发伤害范围 */
        if (this.splash > 0) {
          applySplash(this, tanks, obstacles);
        }
        if (this.onHit) this.onHit({ target: ob, kind: 'obstacle' });
        this.alive = false;
        return false;
      }
    }

    /* ------------ 与坦克碰撞 ------------ */
    if (tanks && tanks.length) {
      for (var t = 0; t < tanks.length; t++) {
        var tk = tanks[t];
        if (!tk || !tk.alive) continue;
        /* 自己不打自己：同归属不打 */
        if (tk === this.ownerTank) continue;
        if (this.owner !== 'enemy' && this.owner !== 'boss') {
          /* 玩家子弹打友军忽略：简单起见只打 enemy/boss 坦克 */
          if (tk.type !== 'enemy' && tk.type !== 'boss') continue;
        } else {
          /* 敌方子弹只打玩家 */
          if (tk.type !== 'player') continue;
        }
        if (this._hitSet.has(tk)) continue;
        if (!aabbHit(this.aabb, tk.aabb)) continue;

        this._hitSet.add(tk);
        /* 扣血 */
        if (typeof tk.takeDamage === 'function') {
          tk.takeDamage(this.damage, this.owner);
        }
        if (this.splash > 0) applySplash(this, tanks, obstacles);
        if (this.onHit) this.onHit({ target: tk, kind: 'tank' });

        /* 穿透判断 */
        if (this.pierce > 0) {
          this.pierce--;
          continue;
        }
        this.alive = false;
        return false;
      }
    }
    return this.alive;
  };

  /** 根据矩形 AABB 按射入轴反射速度（简易反弹） */
  Bullet.prototype._reflectFromRect = function (box) {
    var cx = box.x + box.w / 2;
    var cy = box.y + box.h / 2;
    var dx = this.pos.x - cx;
    var dy = this.pos.y - cy;
    var px = (box.w / 2) - Math.abs(dx);
    var py = (box.h / 2) - Math.abs(dy);
    if (px < py) {
      this.vel.x = -this.vel.x;
    } else {
      this.vel.y = -this.vel.y;
    }
  };

  /** 将子弹推出 AABB（防止反弹卡死） */
  Bullet.prototype._pushOutOfRect = function (box) {
    while (aabbHit(this.aabb, box)) {
      this.pos.x += this.vel.x * 0.25;
      this.pos.y += this.vel.y * 0.25;
    }
  };

  /** 对周围目标施加溅射伤害 */
  function applySplash(bullet, tanks, obstacles) {
    var r = bullet.splash;
    var r2 = r * r;
    var sx = bullet.pos.x, sy = bullet.pos.y;
    var i, tx, ty, d2, ob;
    if (tanks) {
      for (i = 0; i < tanks.length; i++) {
        var tk = tanks[i];
        if (!tk || !tk.alive) continue;
        if (tk.type === 'player') {
          if (bullet.owner === 'player' || bullet.owner === 'ally') continue;
        } else {
          if (bullet.owner === 'enemy' || bullet.owner === 'boss') continue;
        }
        tx = (tk.aabb.x + tk.aabb.w / 2) - sx;
        ty = (tk.aabb.y + tk.aabb.h / 2) - sy;
        d2 = tx * tx + ty * ty;
        if (d2 <= r2 && typeof tk.takeDamage === 'function') {
          var falloff = 1 - Math.sqrt(d2) / r;
          tk.takeDamage(bullet.damage * 0.6 * falloff, bullet.owner);
        }
      }
    }
    if (obstacles) {
      for (i = 0; i < obstacles.length; i++) {
        ob = obstacles[i];
        if (!ob || ob.type !== 'brick') continue;
        tx = (ob.aabb.x + ob.aabb.w / 2) - sx;
        ty = (ob.aabb.y + ob.aabb.h / 2) - sy;
        d2 = tx * tx + ty * ty;
        if (d2 <= r2) ob.hp -= bullet.damage * 0.4;
      }
    }
  }

  /**
   * 渲染子弹：外发光描边 + 内实心
   * @param {CanvasRenderingContext2D} ctx
   * @param {object} [camera] 相机 { x, y, w, h, scale }
   */
  Bullet.prototype.render = function (ctx, camera) {
    if (!this.alive) return;
    var sx = this.pos.x, sy = this.pos.y;
    if (camera) {
      sx = (sx - camera.x) * (camera.scale || 1) + camera.w / 2;
      sy = (sy - camera.y) * (camera.scale || 1) + camera.h / 2;
    }
    var r = this.radius;
    ctx.save();
    ctx.shadowColor = this.color;
    ctx.shadowBlur = 12;
    ctx.strokeStyle = this.color;
    ctx.lineWidth = 2;
    ctx.fillStyle = this._lighten(this.color, 0.35);
    ctx.beginPath();
    ctx.arc(sx, sy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  };

  /** 颜色调亮（简易：基于 hex + 通道加算） */
  Bullet.prototype._lighten = function (hex, amt) {
    var h = (hex || '#fff').replace('#', '');
    if (h.length !== 6) return hex;
    var r = parseInt(h.slice(0, 2), 16);
    var g = parseInt(h.slice(2, 4), 16);
    var b = parseInt(h.slice(4, 6), 16);
    r = Math.min(255, (r | 0) + Math.round(255 * amt));
    g = Math.min(255, (g | 0) + Math.round(255 * amt));
    b = Math.min(255, (b | 0) + Math.round(255 * amt));
    return 'rgb(' + r + ',' + g + ',' + b + ')';
  };

  /* ======================= 事件总线兜底 ======================= */
  function emitGlobal(evt, payload) {
    /* 主通道：CT_BUS —— 模式/系统通过 BUS.on 监听。
     * CT_ENGINE 上没有 EventBus 属性，此前优先走它导致事件全部落到 DOM 兜底。 */
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

  /* ======================= 导出命名空间 ======================= */
  var Pool = makePool(Bullet, POOL_WATERMARK);

  /**
   * 生成子弹：从对象池获取 + 重置
   * @param {object} opts
   */
  function spawn(opts) {
    var b = Pool.acquire();
    return b.reset(opts);
  }

  /**
   * 归还子弹（调用方可选，update 返回 false 后自动回收也可以）
   */
  function recycle(bullet) {
    Pool.release(bullet);
  }

  var CT_BULLET = {
    Bullet: Bullet,
    Pool: Pool,
    spawn: spawn,
    recycle: recycle,
    _aabbHit: aabbHit,
    POOL_WATERMARK: POOL_WATERMARK
  };

  global.CT_BULLET = CT_BULLET;

  /* 容错：Node 环境留位 */
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = CT_BULLET;
  }
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));

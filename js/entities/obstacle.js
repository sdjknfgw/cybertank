/* =========================================================
 * CyberTank · 地形/障碍实体模块
 * 命名空间: window.CT_OBSTACLE
 * 7 种地形: WallBrick / WallSteel / Bush / Water / Ice / Mud / Portal
 * 辅助: createMap(template) 根据字符模板生成 2D 格子地图
 * ========================================================= */
(function (global) {
  'use strict';

  /** 单格尺寸 */
  var TILE_SIZE = 64;

  /* ---------------- 工具函数 ---------------- */
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
  function worldToScreenX(x, camera) {
    if (!camera) return x;
    return (x - camera.x) * (camera.scale || 1) + camera.w / 2;
  }
  function worldToScreenY(y, camera) {
    if (!camera) return y;
    return (y - camera.y) * (camera.scale || 1) + camera.h / 2;
  }

  /**
   * 构造基础障碍对象（子类会覆盖 type / render）
   */
  function BaseObstacle(opts) {
    opts = opts || {};
    /** 类型标记 brick/steel/bush/water/ice/mud/portal */
    this.type = opts.type || 'brick';
    /** 是否仍存活 */
    this.alive = true;
    /** 生命值（钢墙/水/冰/泥/草丛 无限；砖墙有限） */
    this.hp = opts.hp == null ? Infinity : opts.hp;
    /** 坦克在该地形上的牵引力系数（1 = 正常） */
    this.traction = opts.traction == null ? 1 : opts.traction;
    /** 是否阻挡坦克 */
    this.blockTank = opts.blockTank === false ? false : true;
    /** 是否阻挡子弹 */
    this.blockBullet = opts.blockBullet === false ? false : true;
    /** 进入草丛时是否对视觉透明化（坦克 50%） */
    this.visionDamp = opts.visionDamp == null ? 0 : opts.visionDamp;
    /** 动画计时 */
    this._t = 0;
    /** 矩形盒 */
    this._box = {
      x: opts.x || 0,
      y: opts.y || 0,
      w: opts.w || TILE_SIZE,
      h: opts.h || TILE_SIZE
    };
    /** Portal 专属字段 */
    this.portalId = opts.portalId || null;
    this.portalPairId = opts.portalPairId || null;
    /** Portal 冷却：进入后 1s 内不再触发 */
    this._teleportCd = 0;
  }
  Object.defineProperty(BaseObstacle.prototype, 'aabb', {
    get: function () { return this._box; }
  });
  BaseObstacle.prototype.update = function (dt) {
    dt = dt || 0;
    this._t += dt;
    if (this._teleportCd > 0) this._teleportCd = Math.max(0, this._teleportCd - dt);
  };
  BaseObstacle.prototype.render = function () { /* 子类实现 */ };
  /** 核弹/激光专用：强制摧毁 */
  BaseObstacle.prototype.destroyForced = function () {
    if (this.type === 'steel' || this.type === 'brick') {
      this.hp = 0;
      this.alive = false;
    }
  };

  /* =========================================================
   * 1) 砖墙：可破坏，hp=2；打破 20% 触发道具掉落事件
   * ========================================================= */
  function WallBrick(opts) {
    opts = opts || {};
    opts.type = 'brick';
    opts.hp = opts.hp == null ? 2 : opts.hp;
    opts.blockTank = true;
    opts.blockBullet = true;
    BaseObstacle.call(this, opts);
  }
  WallBrick.prototype = Object.create(BaseObstacle.prototype);
  WallBrick.prototype.constructor = WallBrick;
  WallBrick.prototype.render = function (ctx, camera) {
    if (!this.alive) return;
    var x = worldToScreenX(this._box.x, camera);
    var y = worldToScreenY(this._box.y, camera);
    var w = this._box.w * (camera ? (camera.scale || 1) : 1);
    var h = this._box.h * (camera ? (camera.scale || 1) : 1);
    ctx.save();
    /* 棕色微弱发光 */
    ctx.shadowColor = 'rgba(139,69,19,0.75)';
    ctx.shadowBlur = 6;
    /* 底色 */
    ctx.fillStyle = '#8b4a2b';
    ctx.fillRect(x, y, w, h);
    /* 砖纹：重复矩形 + 偏移 */
    ctx.fillStyle = '#6b3418';
    var brickW = w / 4, brickH = h / 4;
    for (var r = 0; r < 4; r++) {
      var offset = (r % 2) * (brickW / 2);
      for (var c = 0; c < 5; c++) {
        var bx = x + c * brickW - offset;
        var by = y + r * brickH;
        if (bx + brickW < x || bx > x + w) continue;
        ctx.fillRect(Math.max(x, bx) + 1, by + 1, brickW - 2, brickH - 2);
      }
    }
    /* 描边 */
    ctx.strokeStyle = '#c87a4a';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    ctx.restore();
  };

  /* =========================================================
   * 2) 钢墙：不可破坏，hp=Infinity；仅 destroyForced 可清理
   * ========================================================= */
  function WallSteel(opts) {
    opts = opts || {};
    opts.type = 'steel';
    opts.hp = Infinity;
    opts.blockTank = true;
    opts.blockBullet = true;
    BaseObstacle.call(this, opts);
  }
  WallSteel.prototype = Object.create(BaseObstacle.prototype);
  WallSteel.prototype.constructor = WallSteel;
  WallSteel.prototype.render = function (ctx, camera) {
    if (!this.alive) return;
    var x = worldToScreenX(this._box.x, camera);
    var y = worldToScreenY(this._box.y, camera);
    var w = this._box.w * (camera ? (camera.scale || 1) : 1);
    var h = this._box.h * (camera ? (camera.scale || 1) : 1);
    ctx.save();
    /* 金属拉丝渐变 */
    var g = ctx.createLinearGradient(x, y, x + w, y + h);
    g.addColorStop(0, '#8a95a8');
    g.addColorStop(0.5, '#d8e0ef');
    g.addColorStop(1, '#6d7788');
    ctx.fillStyle = g;
    ctx.fillRect(x, y, w, h);
    /* 拉丝线 */
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 1;
    for (var i = 0; i < 8; i++) {
      ctx.beginPath();
      var ly = y + (h / 8) * i + 4;
      ctx.moveTo(x + 2, ly);
      ctx.lineTo(x + w - 2, ly - 3);
      ctx.stroke();
    }
    /* 冷白描边 */
    ctx.shadowColor = '#cde6ff';
    ctx.shadowBlur = 10;
    ctx.strokeStyle = '#eaf3ff';
    ctx.lineWidth = 2;
    ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);
    /* 四颗铆钉 */
    ctx.fillStyle = '#2b3343';
    var riv = 3;
    ctx.beginPath(); ctx.arc(x + 6, y + 6, riv, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(x + w - 6, y + 6, riv, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(x + 6, y + h - 6, riv, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(x + w - 6, y + h - 6, riv, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  };

  /* =========================================================
   * 3) 草丛：不阻挡子弹视线，坦克进入半透明 50%
   * ========================================================= */
  function Bush(opts) {
    opts = opts || {};
    opts.type = 'bush';
    opts.hp = Infinity;
    opts.blockTank = false;
    opts.blockBullet = false;
    opts.visionDamp = 0.5;
    BaseObstacle.call(this, opts);
  }
  Bush.prototype = Object.create(BaseObstacle.prototype);
  Bush.prototype.constructor = Bush;
  Bush.prototype.render = function (ctx, camera) {
    if (!this.alive) return;
    var x = worldToScreenX(this._box.x, camera);
    var y = worldToScreenY(this._box.y, camera);
    var w = this._box.w * (camera ? (camera.scale || 1) : 1);
    var h = this._box.h * (camera ? (camera.scale || 1) : 1);
    ctx.save();
    ctx.globalAlpha = 0.75;
    /* 噪声绿半圆：多个半圆拼凑 */
    for (var i = 0; i < 9; i++) {
      var cx = x + w * (((i * 13) % 10) / 10 + 0.05);
      var cy = y + h * (((i * 29) % 10) / 10 + 0.05);
      var rr = Math.min(w, h) * (0.2 + (i % 3) * 0.05);
      ctx.fillStyle = i % 2 ? '#2ecc40' : '#1f8a2b';
      ctx.beginPath();
      ctx.arc(cx, cy, rr, Math.PI, Math.PI * 2);
      ctx.fill();
    }
    /* 噪点 */
    ctx.fillStyle = 'rgba(57,255,20,0.5)';
    for (var j = 0; j < 40; j++) {
      var nx = x + (Math.sin(j * 7.3) * 0.5 + 0.5) * w;
      var ny = y + (Math.cos(j * 4.1) * 0.5 + 0.5) * h;
      ctx.fillRect(nx, ny, 1.5, 1.5);
    }
    ctx.restore();
  };

  /* =========================================================
   * 4) 水：坦克不可通过（阻挡坦克 collider），子弹可过
   * ========================================================= */
  function Water(opts) {
    opts = opts || {};
    opts.type = 'water';
    opts.hp = Infinity;
    opts.blockTank = true;
    opts.blockBullet = false;
    BaseObstacle.call(this, opts);
    this._offsetX = 0;
  }
  Water.prototype = Object.create(BaseObstacle.prototype);
  Water.prototype.constructor = Water;
  Water.prototype.update = function (dt) {
    BaseObstacle.prototype.update.call(this, dt);
    this._offsetX += (dt || 0) * 18;
  };
  Water.prototype.render = function (ctx, camera) {
    if (!this.alive) return;
    var x = worldToScreenX(this._box.x, camera);
    var y = worldToScreenY(this._box.y, camera);
    var w = this._box.w * (camera ? (camera.scale || 1) : 1);
    var h = this._box.h * (camera ? (camera.scale || 1) : 1);
    ctx.save();
    /* 渐变底 */
    var g = ctx.createLinearGradient(x, y, x, y + h);
    g.addColorStop(0, '#0a3a6b');
    g.addColorStop(1, '#0b6bb0');
    ctx.fillStyle = g;
    ctx.fillRect(x, y, w, h);
    /* 蓝波纹 */
    ctx.strokeStyle = 'rgba(140,220,255,0.85)';
    ctx.lineWidth = 2;
    var off = this._offsetX % (w / 2);
    for (var i = -1; i < 4; i++) {
      ctx.beginPath();
      var baseY = y + h * 0.25 + i * (h / 5);
      ctx.moveTo(x - off, baseY);
      for (var t = 0; t <= w; t += 6) {
        ctx.lineTo(x + t - off, baseY + Math.sin((t + this._offsetX * 2) * 0.15) * 2);
      }
      ctx.stroke();
    }
    /* 发光描边 */
    ctx.shadowColor = '#00bfff';
    ctx.shadowBlur = 8;
    ctx.strokeStyle = 'rgba(0,200,255,0.8)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    ctx.restore();
  };

  /* =========================================================
   * 5) 冰面：坦克滑行 Traction=0.2
   * ========================================================= */
  function Ice(opts) {
    opts = opts || {};
    opts.type = 'ice';
    opts.hp = Infinity;
    opts.blockTank = false;
    opts.blockBullet = false;
    opts.traction = 0.2;
    BaseObstacle.call(this, opts);
  }
  Ice.prototype = Object.create(BaseObstacle.prototype);
  Ice.prototype.constructor = Ice;
  Ice.prototype.render = function (ctx, camera) {
    if (!this.alive) return;
    var x = worldToScreenX(this._box.x, camera);
    var y = worldToScreenY(this._box.y, camera);
    var w = this._box.w * (camera ? (camera.scale || 1) : 1);
    var h = this._box.h * (camera ? (camera.scale || 1) : 1);
    ctx.save();
    /* 淡蓝底 */
    ctx.fillStyle = '#b5e3ff';
    ctx.fillRect(x, y, w, h);
    /* 白色斜高光 */
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.beginPath();
    ctx.moveTo(x + w * 0.1, y + h);
    ctx.lineTo(x + w * 0.35, y + h);
    ctx.lineTo(x + w, y + h * 0.15);
    ctx.lineTo(x + w, y + h * 0.35);
    ctx.closePath();
    ctx.fill();
    /* 裂纹 */
    ctx.strokeStyle = 'rgba(90,160,210,0.6)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x + w * 0.5, y + h * 0.1);
    ctx.lineTo(x + w * 0.62, y + h * 0.45);
    ctx.lineTo(x + w * 0.55, y + h * 0.75);
    ctx.moveTo(x + w * 0.62, y + h * 0.45);
    ctx.lineTo(x + w * 0.8, y + h * 0.55);
    ctx.stroke();
    /* 描边 */
    ctx.shadowColor = 'rgba(200,235,255,0.8)';
    ctx.shadowBlur = 6;
    ctx.strokeStyle = '#dff4ff';
    ctx.lineWidth = 1.2;
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    ctx.restore();
  };

  /* =========================================================
   * 6) 泥地：Traction=0.6（60% 速度）
   * ========================================================= */
  function Mud(opts) {
    opts = opts || {};
    opts.type = 'mud';
    opts.hp = Infinity;
    opts.blockTank = false;
    opts.blockBullet = false;
    opts.traction = 0.6;
    BaseObstacle.call(this, opts);
  }
  Mud.prototype = Object.create(BaseObstacle.prototype);
  Mud.prototype.constructor = Mud;
  Mud.prototype.render = function (ctx, camera) {
    if (!this.alive) return;
    var x = worldToScreenX(this._box.x, camera);
    var y = worldToScreenY(this._box.y, camera);
    var w = this._box.w * (camera ? (camera.scale || 1) : 1);
    var h = this._box.h * (camera ? (camera.scale || 1) : 1);
    ctx.save();
    ctx.fillStyle = '#5a3a22';
    ctx.fillRect(x, y, w, h);
    /* 纹理斑点 */
    for (var i = 0; i < 55; i++) {
      var rx = x + ((i * 17) % 10) / 10 * w;
      var ry = y + ((i * 31) % 10) / 10 * h;
      var rr = 1 + (i % 4);
      ctx.fillStyle = (i % 2) ? '#422612' : '#7a4f30';
      ctx.beginPath();
      ctx.arc(rx, ry, rr, 0, Math.PI * 2);
      ctx.fill();
    }
    /* 轮胎轨迹纹 */
    ctx.strokeStyle = 'rgba(40,20,10,0.45)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x + 6, y + h * 0.3);
    ctx.bezierCurveTo(x + w * 0.3, y + h * 0.2, x + w * 0.7, y + h * 0.45, x + w - 6, y + h * 0.25);
    ctx.moveTo(x + 6, y + h * 0.7);
    ctx.bezierCurveTo(x + w * 0.35, y + h * 0.75, x + w * 0.65, y + h * 0.55, x + w - 6, y + h * 0.72);
    ctx.stroke();
    ctx.restore();
  };

  /* =========================================================
   * 7) Portal：坦克进入后传送到 pair 位置，1s 冷却
   * ========================================================= */
  function Portal(opts) {
    opts = opts || {};
    opts.type = 'portal';
    opts.hp = Infinity;
    opts.blockTank = false;
    opts.blockBullet = false;
    BaseObstacle.call(this, opts);
    /** 传送门 ID 与配对 ID（数字或字符串均可） */
    this.portalId = opts.id != null ? opts.id : null;
    this.portalPairId = opts.pairId != null ? opts.pairId : null;
    this._rotate = 0;
  }
  Portal.prototype = Object.create(BaseObstacle.prototype);
  Portal.prototype.constructor = Portal;
  Portal.prototype.update = function (dt) {
    BaseObstacle.prototype.update.call(this, dt);
    this._rotate += (dt || 0) * 2.4;
  };
  Portal.prototype.render = function (ctx, camera) {
    if (!this.alive) return;
    var x = worldToScreenX(this._box.x, camera);
    var y = worldToScreenY(this._box.y, camera);
    var w = this._box.w * (camera ? (camera.scale || 1) : 1);
    var h = this._box.h * (camera ? (camera.scale || 1) : 1);
    var cx = x + w / 2, cy = y + h / 2;
    ctx.save();
    ctx.shadowColor = '#bf00ff';
    ctx.shadowBlur = 24;
    for (var r = 0; r < 3; r++) {
      var rr = (Math.min(w, h) / 2) * (0.8 - r * 0.22);
      ctx.translate(cx, cy);
      ctx.rotate(this._rotate * (r % 2 === 0 ? 1 : -1));
      ctx.strokeStyle = r === 0 ? '#ff66ff' : (r === 1 ? '#bf00ff' : '#6a00ff');
      ctx.lineWidth = 3 - r;
      ctx.beginPath();
      /* 同心圆环，缺口形成旋转感 */
      ctx.arc(0, 0, rr, 0, Math.PI * 1.6);
      ctx.stroke();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
    }
    /* 中心亮核 */
    ctx.shadowBlur = 18;
    ctx.shadowColor = '#f0c0ff';
    var grad = ctx.createRadialGradient(cx, cy, 2, cx, cy, Math.min(w, h) / 2);
    grad.addColorStop(0, '#ffffff');
    grad.addColorStop(0.3, '#d9a8ff');
    grad.addColorStop(1, 'rgba(102,0,204,0.05)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(cx, cy, Math.min(w, h) / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  };
  /** 尝试传送坦克：tank 在 portal 内部 且 cd=0 → 返回 {teleported, targetPortal} */
  Portal.prototype.tryTeleport = function (tank, allPortals) {
    if (!tank || !allPortals) return false;
    if (this._teleportCd > 0) return false;
    /* 简单 AABB */
    var ta = tank.aabb;
    var tb = this._box;
    var overlap = !(ta.x + ta.w < tb.x || tb.x + tb.w < ta.x || ta.y + ta.h < tb.y || tb.y + tb.h < ta.y);
    if (!overlap) return false;
    /* 找到配对 */
    var pair = null;
    for (var i = 0; i < allPortals.length; i++) {
      var p = allPortals[i];
      if (p && p !== this && p.portalId === this.portalPairId) {
        pair = p; break;
      }
    }
    if (!pair) return false;
    if (pair._teleportCd > 0) return false;
    tank.pos.x = pair._box.x + pair._box.w / 2;
    tank.pos.y = pair._box.y + pair._box.h / 2;
    this._teleportCd = 1.0;
    pair._teleportCd = 1.0;
    return true;
  };

  /* =========================================================
   * 根据字符串模板生成 2D 格子图
   * template: 二维字符串数组，或单字符串按行切分
   *   '1'=brick, '2'=steel, '3'=bush, '4'=water, '5'=ice, '6'=mud
   *   'P'/'Q'=Portal（成对出现），其余字符忽略
   * 返回: { obstacles, grid, cols, rows, tileSize }
   * ========================================================= */
  function createMap(template, tileSize) {
    var size = tileSize || TILE_SIZE;
    var rows;
    if (typeof template === 'string') {
      rows = template.split(/\r?\n/).filter(function (l) { return l.length > 0; });
    } else if (Array.isArray(template)) {
      rows = template.slice();
    } else {
      rows = [];
    }
    var cols = 0;
    rows.forEach(function (r) { if (r.length > cols) cols = r.length; });
    var obstacles = [];
    var grid = [];
    var portalCount = 0;
    var lastPortalId = null;
    for (var r = 0; r < rows.length; r++) {
      var row = rows[r];
      grid[r] = [];
      for (var c = 0; c < cols; c++) {
        var ch = row[c] || ' ';
        var ob = null;
        var x = c * size, y = r * size;
        switch (ch) {
          case '1':
            ob = new WallBrick({ x: x, y: y, w: size, h: size });
            break;
          case '2':
            ob = new WallSteel({ x: x, y: y, w: size, h: size });
            break;
          case '3':
            ob = new Bush({ x: x, y: y, w: size, h: size });
            break;
          case '4':
            ob = new Water({ x: x, y: y, w: size, h: size });
            break;
          case '5':
            ob = new Ice({ x: x, y: y, w: size, h: size });
            break;
          case '6':
            ob = new Mud({ x: x, y: y, w: size, h: size });
            break;
          case 'P':
          case 'Q':
            /* 配对：P1<->Q1 P2<->Q2 ... 按出现顺序自动匹配 */
            portalCount++;
            if (ch === 'P') {
              lastPortalId = 'portal_' + portalCount;
              ob = new Portal({
                id: lastPortalId, pairId: null,
                x: x, y: y, w: size, h: size
              });
            } else {
              ob = new Portal({
                id: 'portal_' + portalCount,
                pairId: lastPortalId || 'portal_pending',
                x: x, y: y, w: size, h: size
              });
              if (lastPortalId) {
                /* 回填上一个 P 的 pairId */
                for (var k = obstacles.length - 1; k >= 0; k--) {
                  var prev = obstacles[k];
                  if (prev && prev.type === 'portal' && prev.portalId === lastPortalId && !prev.portalPairId) {
                    prev.portalPairId = ob.portalId;
                    break;
                  }
                }
                lastPortalId = null;
              }
            }
            break;
          default:
            break;
        }
        if (ob) obstacles.push(ob);
        grid[r][c] = ob;
      }
    }
    return {
      obstacles: obstacles,
      grid: grid,
      cols: cols,
      rows: rows.length,
      tileSize: size
    };
  }

  /* =========================================================
   * 安全生成点检测：洪水填充判断目标点是否被 blockTank 障碍围死
   * ======================================================== */
  /**
   * 从期望点附近找一个"不被围死"的生成点
   * @param {Array} obstacles 障碍列表
   * @param {number} mapW 地图宽（像素）
   * @param {number} mapH 地图高（像素）
   * @param {number} wantX 期望 X
   * @param {number} wantY 期望 Y
   * @param {number} [searchR] 搜索半径（像素，默认 480）
   * @returns {{x:number,y:number}} 安全点（找不到时返回期望点本身兜底）
   */
  function findSafeSpawn(obstacles, mapW, mapH, wantX, wantY, searchR) {
    searchR = searchR || 480;
    var cell = TILE_SIZE;
    var cols = Math.max(1, Math.floor(mapW / cell));
    var rows = Math.max(1, Math.floor(mapH / cell));
    /* 构建阻挡网格 */
    var blocked = new Uint8Array(cols * rows);
    var i, ob, bb, c0, r0, c1, r1, cc, rr;
    for (i = 0; i < (obstacles ? obstacles.length : 0); i++) {
      ob = obstacles[i];
      if (!ob || !ob.alive || !ob.blockTank) continue;
      bb = ob.aabb || ob._box; if (!bb) continue;
      c0 = Math.max(0, Math.floor(bb.x / cell));
      r0 = Math.max(0, Math.floor(bb.y / cell));
      c1 = Math.min(cols - 1, Math.floor((bb.x + bb.w - 1) / cell));
      r1 = Math.min(rows - 1, Math.floor((bb.y + bb.h - 1) / cell));
      for (rr = r0; rr <= r1; rr++) for (cc = c0; cc <= c1; cc++) blocked[rr * cols + cc] = 1;
    }
    /* 判定某格是否为开阔（不被阻挡） */
    function isOpen(cx, cy) {
      if (cx < 0 || cy < 0 || cx >= cols || cy >= rows) return false;
      return !blocked[cy * cols + cx];
    }
    /* 计算「与地图外部相连」的开阔区域：从全部边界开格做多源 BFS。
     * 被方块围死的内部死区不会触达边界，从而被判定为不安全。 */
    var exterior = new Uint8Array(cols * rows);
    var queue = [];
    var qh = 0;
    var DX = [1, -1, 0, 0], DY = [0, 0, 1, -1];
    for (var bx = 0; bx < cols; bx++) {
      if (isOpen(bx, 0)) { exterior[bx] = 1; queue.push(bx); }
      if (isOpen(bx, rows - 1)) { exterior[(rows - 1) * cols + bx] = 1; queue.push((rows - 1) * cols + bx); }
    }
    for (var by = 0; by < rows; by++) {
      if (isOpen(0, by)) { exterior[by * cols] = 1; queue.push(by * cols); }
      if (isOpen(cols - 1, by)) { exterior[by * cols + (cols - 1)] = 1; queue.push(by * cols + (cols - 1)); }
    }
    while (qh < queue.length) {
      var cur = queue[qh++];
      var cxn = cur % cols, cyn = (cur / cols) | 0;
      for (var d = 0; d < 4; d++) {
        var nx = cxn + DX[d], ny = cyn + DY[d];
        if (!isOpen(nx, ny)) continue;
        var kk = ny * cols + nx;
        if (exterior[kk]) continue;
        exterior[kk] = 1; queue.push(kk);
      }
    }
    var exteriorValid = queue.length > 0;

    /* 洪水填充：从 (cx,cy) 扩散，可达空格 >= 12 视为安全 */
    function openArea(cx, cy) {
      if (!isOpen(cx, cy)) return 0;
      var seen = new Uint8Array(cols * rows);
      var qx = [cx], qy = [cy];
      seen[cy * cols + cx] = 1;
      var area = 0, limit = 400;
      while (qx.length && area < limit) {
        var x = qx.shift(), y = qy.shift();
        area++;
        for (var dd = 0; dd < 4; dd++) {
          var nqx = x + DX[dd], nqy = y + DY[dd];
          if (!isOpen(nqx, nqy)) continue;
          var kc = nqy * cols + nqx;
          if (seen[kc]) continue;
          seen[kc] = 1; qx.push(nqx); qy.push(nqy);
        }
      }
      return area;
    }
    function safe(x, y) {
      if (x < cell || y < cell || x > mapW - cell || y > mapH - cell) return false;
      var cx = Math.floor(x / cell), cy = Math.floor(y / cell);
      if (!isOpen(cx, cy)) return false;
      /* 必须连通到地图外部（否则是被方块围死的内部死区 → 排除） */
      if (exteriorValid && !exterior[cy * cols + cx]) return false;
      return openArea(cx, cy) >= 12;
    }
    /* 期望点本身安全则直接用 */
    if (safe(wantX, wantY)) return { x: wantX, y: wantY };
    /* 螺旋环搜索最近安全点 */
    var step = cell * 1.5;
    for (var ring = 1; ring <= Math.ceil(searchR / step); ring++) {
      var tries = 8 * ring;
      for (var t = 0; t < tries; t++) {
        var ang = (t / tries) * Math.PI * 2 + ring * 0.7;
        var px = wantX + Math.cos(ang) * step * ring;
        var py = wantY + Math.sin(ang) * step * ring;
        if (safe(px, py)) return { x: px, y: py };
      }
    }
    /* 兜底：期望点 */
    return { x: wantX, y: wantY };
  }

  /* =========================================================
   * 随机散布方块：在地图各部位填充障碍，避免大面积空白
   * 说明：仅填充「当前为空」的格子；保留最外圈（用于刷怪点与连通性）
   *       与底部若干行（玩家出生/基地走廊）；并以 4x4 粗网格校正，
   *       保证任意区域内至少有一块，彻底消除大块空白。
   * opts: { tile, cols, rows, density, skipBottomRows, ctor, rng }
   *   ctor: { WallBrick, WallSteel, Bush, Water, Ice, Mud }（地形构造器）
   * ======================================================== */
  function scatterFill(obstacles, opts) {
    opts = opts || {};
    var tile = opts.tile || TILE_SIZE;
    var cols = opts.cols || 0;
    var rows = opts.rows || 0;
    if (!cols || !rows || !obstacles) return;
    var density = opts.density != null ? opts.density : 0.15;
    var skipBorder = opts.skipBorder !== false;
    var skipBottomRows = Math.max(0, opts.skipBottomRows || 0);
    var skipRects = opts.skipRects || [];
    var ctor = opts.ctor || {};
    var rng = opts.rng || Math.random;

    /* 占用标记 */
    var occupied = new Uint8Array(cols * rows);
    for (var i = 0; i < obstacles.length; i++) {
      var ob = obstacles[i];
      if (!ob) continue;
      var box = ob._box || ob.aabb;
      if (!box) continue;
      var oc0 = Math.floor(box.x / tile);
      var or0 = Math.floor(box.y / tile);
      var oc1 = Math.floor((box.x + box.w - 1) / tile);
      var or1 = Math.floor((box.y + box.h - 1) / tile);
      for (var pr = or0; pr <= or1; pr++) for (var pc = oc0; pc <= oc1; pc++) occupied[pr * cols + pc] = 1;
    }

    function canPlace(r, c) {
      if (r < 0 || c < 0 || r >= rows || c >= cols) return false;
      if (occupied[r * cols + c]) return false;
      if (skipBorder && (r === 0 || c === 0 || r === rows - 1 || c === cols - 1)) return false;
      if (r >= rows - skipBottomRows) return false;
      // 额外排除指定矩形区域（如水晶基地所在区），避免方块压住基地
      for (var s = 0; s < skipRects.length; s++) {
        var rect = skipRects[s];
        if (c >= rect.c0 && c <= rect.c1 && r >= rect.r0 && r <= rect.r1) return false;
      }
      return true;
    }
    function place(r, c) {
      var x = c * tile, y = r * tile;
      var role = rng();
      var block = null;
      if (role < 0.50) block = ctor.WallBrick && new ctor.WallBrick({ x: x, y: y, w: tile, h: tile });
      else if (role < 0.62) block = ctor.WallSteel && new ctor.WallSteel({ x: x, y: y, w: tile, h: tile });
      else if (role < 0.76) block = ctor.Bush && new ctor.Bush({ x: x, y: y, w: tile, h: tile });
      else if (role < 0.88) block = ctor.Mud && new ctor.Mud({ x: x, y: y, w: tile, h: tile });
      else if (role < 0.96) block = ctor.Ice && new ctor.Ice({ x: x, y: y, w: tile, h: tile });
      else block = ctor.Water && new ctor.Water({ x: x, y: y, w: tile, h: tile });
      if (!block) block = ctor.WallBrick && new ctor.WallBrick({ x: x, y: y, w: tile, h: tile });
      if (!block) return;
      obstacles.push(block);
      occupied[r * cols + c] = 1;
    }

    /* 1) 按密度随机散布 */
    for (var r = 0; r < rows; r++) {
      for (var c = 0; c < cols; c++) {
        if (!canPlace(r, c)) continue;
        if (rng() >= density) continue;
        place(r, c);
      }
    }

    /* 2) 粗网格校正：任何 4x4 子区若完全没有方块，则补放一块，消除大空白 */
    var SUP = 4;
    for (var br = 0; br < rows; br += SUP) {
      for (var bc = 0; bc < cols; bc += SUP) {
        var er = Math.min(br + SUP, rows), ec = Math.min(bc + SUP, cols);
        var has = false;
        for (var qr = br; qr < er && !has; qr++) {
          for (var qc = bc; qc < ec; qc++) {
            if (occupied[qr * cols + qc]) { has = true; break; }
          }
        }
        if (has) continue;
        var pool = [];
        for (var pr2 = br; pr2 < er; pr2++) {
          for (var pc2 = bc; pc2 < ec; pc2++) {
            if (canPlace(pr2, pc2)) pool.push([pr2, pc2]);
          }
        }
        if (pool.length) {
          var pick = pool[(rng() * pool.length) | 0];
          place(pick[0], pick[1]);
        }
      }
    }
  }

  /* =========================================================
   * 地图工具：整体放大模板 + 用方块拼字（地图装饰）
   * obstacle.js 先于 modes/*.js 加载，各模式可在加载期直接调用。
   * ========================================================= */

  /** 5×5 点阵字模（小写字母 + 数字 + 空格），够拼各类地图装饰文字 */
  var GLYPHS_5x5 = {
    a: ['.###.', '#...#', '#####', '#...#', '#...#'],
    b: ['####.', '#...#', '####.', '#...#', '####.'],
    c: ['.###.', '#...#', '#....', '#...#', '.###.'],
    d: ['####.', '#...#', '#...#', '#...#', '####.'],
    e: ['#####', '#....', '####.', '#....', '#####'],
    f: ['#####', '#....', '####.', '#....', '#....'],
    g: ['.###.', '#....', '#..##', '#...#', '.###.'],
    h: ['#...#', '#...#', '#####', '#...#', '#...#'],
    i: ['#####', '..#..', '..#..', '..#..', '#####'],
    j: ['..###', '...#.', '...#.', '#..#.', '.##..'],
    k: ['#...#', '#..#.', '###..', '#..#.', '#...#'],
    l: ['#....', '#....', '#....', '#....', '#####'],
    m: ['#...#', '##.##', '#.#.#', '#...#', '#...#'],
    n: ['#...#', '##..#', '#.#.#', '#..##', '#...#'],
    o: ['.###.', '#...#', '#...#', '#...#', '.###.'],
    p: ['####.', '#...#', '####.', '#....', '#....'],
    q: ['.###.', '#...#', '#...#', '#.#.#', '.##.#'],
    r: ['####.', '#...#', '####.', '#..#.', '#...#'],
    s: ['.####', '#....', '.###.', '....#', '####.'],
    t: ['#####', '..#..', '..#..', '..#..', '..#..'],
    u: ['#...#', '#...#', '#...#', '#...#', '.###.'],
    v: ['#...#', '#...#', '#...#', '.#.#.', '..#..'],
    w: ['#...#', '#...#', '#.#.#', '##.##', '#...#'],
    x: ['#...#', '.#.#.', '..#..', '.#.#.', '#...#'],
    y: ['#...#', '#...#', '.###.', '..#..', '..#..'],
    z: ['#####', '...#.', '..#..', '.#...', '#####'],
    '0': ['.###.', '#...#', '#..##', '#.#.#', '.###.'],
    '1': ['..#..', '.##..', '..#..', '..#..', '.###.'],
    '2': ['.###.', '#...#', '..##.', '.#...', '#####'],
    '3': ['####.', '....#', '.###.', '....#', '####.'],
    '4': ['#...#', '#...#', '#####', '....#', '....#'],
    '5': ['#####', '#....', '####.', '....#', '####.'],
    '6': ['.###.', '#....', '####.', '#...#', '.###.'],
    '7': ['#####', '....#', '...#.', '..#..', '..#..'],
    '8': ['.###.', '#...#', '.###.', '#...#', '.###.'],
    '9': ['.###.', '#...#', '.####', '....#', '.###.'],
    ' ': ['.....', '.....', '.....', '.....', '.....']
  };

  function _rep(ch, n) { var s = ''; for (var i = 0; i < n; i++) s += ch; return s; }

  /**
   * 把字符网格模板整体放大 factor 倍：每个格子展开成 factor×factor 个同字符格子。
   * 用于「地图扩大」——布局密度不变，只是世界等比变大。
   * @param {string[]} tpl
   * @param {number} factor
   * @returns {string[]} 新模板（不修改入参）
   */
  function enlargeTemplate(tpl, factor) {
    factor = Math.max(1, Math.floor(Number(factor) || 1));
    if (!Array.isArray(tpl) || factor === 1) return (tpl || []).slice();
    var rows = tpl.map(function (r) { return String(r == null ? '' : r); });
    /* 部分模板存在参差行（某一行少写 1 个字符），先按最长行补齐，
     * 否则放大后各行宽度不一致，会让 createMapFromTemplate 读到半截地图 */
    var maxLen = 0, i, c, k;
    for (i = 0; i < rows.length; i++) maxLen = Math.max(maxLen, rows[i].length);
    var out = [];
    for (var r = 0; r < rows.length; r++) {
      var row = rows[r];
      while (row.length < maxLen) row += '.';
      var wide = '';
      for (c = 0; c < row.length; c++) wide += _rep(row[c], factor);
      for (k = 0; k < factor; k++) out.push(wide);
    }
    return out;
  }

  /**
   * 在字符网格上用方块拼出文字（地图装饰，如 "ccr"）。
   * @param {string[]} tpl 字符网格
   * @param {string} text 文字（小写字母/数字/空格，其余字符跳过）
   * @param {object} opts { row, col, ch, scale, gap }
   *        row/col 左上角起始格；ch 填充字符（默认 'S' 钢块，不可破坏，适合装饰）；
   *        scale 每个点的边长（默认 1）；gap 字间空格数（默认 1）
   * @returns {string[]} 新模板（不修改入参）
   */
  function stampText(tpl, text, opts) {
    var rows = (tpl || []).map(function (r) { return String(r || ''); });
    opts = opts || {};
    var ch = opts.ch || 'S';
    var scale = Math.max(1, Math.floor(Number(opts.scale) || 1));
    var gap = (opts.gap == null ? 1 : Number(opts.gap));
    var startRow = Math.max(0, Math.floor(opts.row || 0));
    var startCol = Math.max(0, Math.floor(opts.col || 0));
    var s = String(text == null ? '' : text).toLowerCase();
    var cursor = startCol;
    /* clear：先把落笔区域清空再拼字，否则字母会和原有方块糊在一起、根本认不出字形。
     * 清空范围刚好是文字外框，随后立即被字模填充，不会留下大片空白。 */
    if (opts.clear) {
      var boxW = s.length * (5 + gap) * scale;
      var boxH = 5 * scale;
      for (var br = startRow; br < startRow + boxH && br < rows.length; br++) {
        if (br < 0) continue;
        var ln = rows[br];
        var endCol = Math.min(ln.length, startCol + boxW);
        var blank = '';
        for (var bc = 0; bc < ln.length; bc++) {
          blank += (bc >= startCol && bc < endCol) ? '.' : ln[bc];
        }
        rows[br] = blank;
      }
    }
    for (var i = 0; i < s.length; i++) {
      var g = GLYPHS_5x5[s[i]];
      if (!g) { cursor += (5 + gap) * scale; continue; }
      for (var gr = 0; gr < 5; gr++) {
        for (var gc = 0; gc < 5; gc++) {
          if (g[gr][gc] !== '#') continue;
          for (var sr = 0; sr < scale; sr++) {
            for (var sc = 0; sc < scale; sc++) {
              var rr = startRow + gr * scale + sr;
              var cc = cursor + gc * scale + sc;
              if (rr < 0 || rr >= rows.length) continue;
              var line = rows[rr];
              if (cc < 0 || cc >= line.length) continue;
              rows[rr] = line.slice(0, cc) + ch + line.slice(cc + 1);
            }
          }
        }
      }
      cursor += (5 + gap) * scale;
    }
    return rows;
  }

  /* =========================================================
   * 导出命名空间
   * ========================================================= */
  var CT_OBSTACLE = {
    TILE_SIZE: TILE_SIZE,
    enlargeTemplate: enlargeTemplate,
    stampText: stampText,
    GLYPHS_5x5: GLYPHS_5x5,
    WallBrick: WallBrick,
    WallSteel: WallSteel,
    Bush: Bush,
    Water: Water,
    Ice: Ice,
    Mud: Mud,
    Portal: Portal,
    createMap: createMap,
    findSafeSpawn: findSafeSpawn,
    scatterFill: scatterFill,
    _Base: BaseObstacle
  };
  global.CT_OBSTACLE = CT_OBSTACLE;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = CT_OBSTACLE;
  }
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));

/* ============================================================
 *  CYBERTANK 敌军 AI 系统
 *  3 级敌军：普通(白)/快速(青)/精英(品红)
 *  命名空间: window.CT_ENEMY
 *  依赖: window.CT_TANK.Tank (基类), window.CT_BUS (事件总线)
 * ============================================================ */
(function () {
  'use strict';

  // 确保 CT_BUS 事件总线存在（防止加载顺序报错）
  if (!window.CT_BUS) {
    window.CT_BUS = {
      _listeners: {},
      on: function (e, fn) { (this._listeners[e] = this._listeners[e] || []).push(fn); },
      emit: function (e, p) { (this._listeners[e] || []).forEach(function (f) { try { f(p); } catch (_) {} }); }
    };
  }

  /* Fallback Tank 基类：CT_TANK.Tank 未加载时最小可用实现，不继承报错 */
  if (!window.CT_TANK) window.CT_TANK = {};
  if (!window.CT_TANK.Tank) {
    window.CT_TANK.Tank = class Tank {
      constructor(opts) {
        opts = opts || {};
        this.pos = { x: opts.x || 0, y: opts.y || 0 };
        this.rotation = 0; this.turretRotation = 0;
        this.hp = typeof opts.maxHp === 'number' ? opts.maxHp : 1;
        this.maxHp = this.hp; this.alive = this.hp > 0;
        this.type = opts.type || 'enemy'; this.name = opts.name || 'Tank';
        this.tankClass = opts.tankClass || 'assault';
        this.color = opts.color || '#ffffff'; this.rank = opts.rank || 'normal';
        this.stats = {
          maxHp: opts.maxHp != null ? opts.maxHp : 1,
          speed: opts.speed != null ? opts.speed : 2,
          fireRate: opts.fireRate != null ? opts.fireRate : 2,
          damage: opts.damage != null ? opts.damage : 1
        };
        this.w = 40; this.h = 40; this._shootCd = 0;
      }
      update(dt, input, obstacles) {
        input = input || {};
        const spd = (this.stats && this.stats.speed ? this.stats.speed : 2) * 60;
        let vx = 0, vy = 0;
        if (input.left) vx -= 1; if (input.right) vx += 1;
        if (input.up) vy -= 1; if (input.down) vy += 1;
        if (vx || vy) {
          const len = Math.hypot(vx, vy); vx /= len; vy /= len;
          const step = spd * dt;
          this.pos.x += vx * step; this.pos.y += vy * step;
          this.rotation = Math.atan2(vy, vx);
        }
        if (input.turretWorldPoint) {
          this.turretRotation = Math.atan2(
            input.turretWorldPoint.y - this.pos.y,
            input.turretWorldPoint.x - this.pos.x
          );
        }
        if (this._shootCd > 0) this._shootCd -= dt;
        if (input.shoot && this._shootCd <= 0) {
          this._shootCd = 1 / Math.max(0.1, this.stats && this.stats.fireRate ? this.stats.fireRate : 2);
        }
        if (this.hp <= 0) this.alive = false;
      }
      render(ctx, camera) {
        const cam = camera || (window.CT_RENDERER && window.CT_RENDERER.camera) || { x: 0, y: 0, zoom: 1 };
        const zoom = cam.zoom != null ? cam.zoom : (cam.scale != null ? cam.scale : 1);
        const px = (this.pos.x - cam.x) * zoom;
        const py = (this.pos.y - cam.y) * zoom;
        const s = Math.max(8, this.w || 32) * zoom;
        ctx.save(); ctx.translate(px, py);
        ctx.shadowColor = this.color; ctx.shadowBlur = 8;
        ctx.rotate(this.rotation);
        ctx.fillStyle = this.color;
        ctx.fillRect(-s / 2, -s / 2.8, s, s / 1.4);
        ctx.strokeStyle = 'rgba(255,255,255,0.8)'; ctx.lineWidth = 1.2;
        ctx.strokeRect(-s / 2, -s / 2.8, s, s / 1.4);
        ctx.restore();
        ctx.save(); ctx.translate(px, py);
        ctx.rotate(this.turretRotation || this.rotation);
        ctx.shadowColor = this.color; ctx.shadowBlur = 6;
        ctx.fillStyle = this.color;
        ctx.fillRect(0, -2 * zoom, s * 0.75, 4 * zoom);
        ctx.restore();
      }
      useItem(itemType) {
        if (window.CT_BUS) window.CT_BUS.emit('tank:useItem', { tank: this, item: itemType });
        return true;
      }
      takeDamage(dmg, src) {
        this.hp -= dmg;
        if (window.CT_BUS) window.CT_BUS.emit('tank:hit', { target: this, dmg: dmg, shooter: src });
        if (this.hp <= 0) {
          this.alive = false;
          if (window.CT_BUS) window.CT_BUS.emit('tank:dead', { dead: this, killer: src });
        }
      }
    };
  }

  /**
   * 敌军 AI 坦克基类
   * 继承自 CT_TANK.Tank，将玩家 input 替换为 AI 虚拟输入
   */
  class EnemyAI extends window.CT_TANK.Tank {
    /**
     * @param {Object} opts
     * @param {number} opts.x          世界坐标 X
     * @param {number} opts.y          世界坐标 Y
     * @param {string} [opts.rank='normal']  敌军等级: normal | fast | elite
     * @param {number} [opts.wave=1]   所属波次（用于数值微调）
     */
    constructor(opts) {
      const rank = opts.rank || 'normal';

      // 等级属性映射（严格按需求文档）
      const statMap = {
        normal: {
          tankClass: 'assault',
          color: '#ffffff',
          maxHp: 1.2,
          speed: 2.2,
          fireRate: 2.0,
          damage: 0.8,
          name: '普通敌军'
        },
        fast: {
          tankClass: 'assault',
          color: '#00ffa2',
          maxHp: 1.0,
          speed: 3.6,
          fireRate: 2.8,
          damage: 0.7,
          name: '快速敌军'
        },
        elite: {
          tankClass: 'heavy',
          color: '#ff2a6d',
          maxHp: 3.0,
          speed: 2.0,
          fireRate: 3.0,
          damage: 1.2,
          name: '精英敌军'
        }
      };

      const base = statMap[rank] || statMap.normal;

      // 调用 Tank 基类构造函数
      super({
        tankClass: base.tankClass,
        color: base.color,
        maxHp: base.maxHp,
        speed: base.speed,
        fireRate: base.fireRate,
        damage: base.damage,
        name: base.name,
        x: opts.x,
        y: opts.y,
        type: 'enemy',
        rank: rank
      });

      /** @type {'normal'|'fast'|'elite'} 敌军等级 */
      this.rank = rank;

      /** @type {number} 感知半径（像素） */
      this.perception = ({ normal: 400, fast: 500, elite: 800 })[rank] || 400;

      /** @type {Array<{cx:number, cy:number}>} BFS 路径点（网格坐标） */
      this.path = [];

      /** @type {number} 重新寻路冷却（秒） */
      this.repathCd = 0;

      /** @type {number} 精英道具使用冷却（秒） */
      this._itemCd = 3.0;

      /** @type {number} 精英当前路径点索引 */
      this._pathIdx = 0;

      /** @type {number} 快速敌军绕行方向（+1 或 -1），定期切换防卡墙 */
      this._strafeDir = Math.random() < 0.5 ? 1 : -1;
      this._strafeCd = 0;

      /* ---------- 人类化行为参数 ---------- */
      /** @type {Object|null} 上帧目标（检测目标切换） */
      this._lastTargetRef = null;
      /** @type {number} 新目标反应延迟（人类需要反应时间） */
      this._reactionCd = 0;
      /** @type {{x:number,y:number}} 瞄准误差（切换目标/受击时重置，随时间收敛） */
      this._aimErr = { x: 0, y: 0 };
      /** @type {number} 连射窗口剩余时间（人类点射节奏） */
      this._fireWindow = 0.6;
      /** @type {number} 停火间隔剩余时间 */
      this._firePause = 0;
      /** @type {number} 下次移动停顿倒计时（人类瞄准时会停下） */
      this._movePauseCd = 2 + Math.random() * 3;
      /** @type {number} 移动停顿剩余时长 */
      this._movePauseT = 0;
      /** @type {number} 受击闪避剩余时间 */
      this._dodgeT = 0;
      /** @type {{x:number,y:number}} 闪避方向 */
      this._dodgeDir = { x: 0, y: 0 };
      /** @type {number} 上帧 HP（检测受击） */
      this._lastHp = this.hp;

      /* ---------- 反转圈 / 防卡死 ---------- */
      /** @type {{u:boolean,d:boolean,l:boolean,r:boolean,t:number}} 移动决策迟滞（保持一小段时间不重算） */
      this._moveDec = { u: false, d: false, l: false, r: false, t: 0 };
      /** @type {number} 卡死检测采样计时 */
      this._stuckSampleT = 0;
      /** @type {{x:number,y:number}} 上次采样位置 */
      this._stuckLastPos = { x: this.pos.x, y: this.pos.y };
      /** @type {number} 脱困剩余时间（>0 时朝脱困方向直走） */
      this._unstickT = 0;
      /** @type {{u:boolean,d:boolean,l:boolean,r:boolean}} 脱困方向 */
      this._unstickDir = { u: false, d: false, l: false, r: false };
      /** @type {number} 连续侧移累计（快速敌军绕圈打破用） */
      this._strafeAccum = 0;

      /** @type {number} 闪烁/光晕计时（渲染用） */
      this._renderT = 0;
    }

    /* ============================================================
     *  主循环：AI 决策 → 生成虚拟 input → 调用 super.update
     * ============================================================ */
    /**
     * @param {number} dt                          帧时长（秒）
     * @param {Array}  obstacles                   障碍物列表（含网格信息 gridCells / cellSize）
     * @param {Array}  playerTanks                 玩家坦克数组
     * @param  {...any} args                       其余透传给 Tank.update 的参数
     */
    update(dt, obstacles, playerTanks) {
      this._renderT += dt;

      // 生成 AI 虚拟输入
      const virtualInput = {
        up: false, down: false, left: false, right: false,
        shoot: false,
        directMove: true,        // 关键修复：AI 的 上/下/左/右 是世界方向平移意图，
        // 必须声明 directMove，否则 Tank.update 会把这些按键当成"转向+前后"，
        // 导致 AI 坦克原地旋转打转（车身 angle 转、但几乎不前进）。
        turretWorldPoint: null   // {x, y} 炮塔瞄准点（null = 车身同步）
      };

      // 0. 受击检测：闪避 + 瞄准受扰（人类被打会慌）
      if (this.hp < this._lastHp - 0.001 && this.alive) {
        this._dodgeT = 0.25 + Math.random() * 0.3;
        const a = Math.random() * Math.PI * 2;
        this._dodgeDir = { x: Math.cos(a), y: Math.sin(a) };
        this._aimErr.x += (Math.random() - 0.5) * 90;
        this._aimErr.y += (Math.random() - 0.5) * 90;
      }
      this._lastHp = this.hp;

      // 1. 选择目标：最近的存活玩家坦克
      const target = this._pickTarget(playerTanks);

      if (target) {
        const dx = target.pos.x - this.pos.x;
        const dy = target.pos.y - this.pos.y;
        const dist = Math.hypot(dx, dy);

        // 目标切换：反应延迟 + 瞄准误差重置（人类先看到 → 再转头 → 再瞄准）
        if (target !== this._lastTargetRef) {
          this._lastTargetRef = target;
          this._reactionCd = 0.25 + Math.random() * 0.35;
          this._aimErr.x = (Math.random() - 0.5) * 160;
          this._aimErr.y = (Math.random() - 0.5) * 160;
        }
        this._reactionCd -= dt;

        // 瞄准误差指数收敛（模拟人类持续瞄准越来越准）
        const decay = Math.pow(0.25, dt);
        this._aimErr.x *= decay;
        this._aimErr.y *= decay;

        // 炮塔瞄准：目标位置 + 速度预判（人类会打提前量） + 瞄准误差
        const leadT = Math.min(0.5, dist / 900);
        const tv = target.vel || { x: 0, y: 0 };
        virtualInput.turretWorldPoint = {
          x: target.pos.x + tv.x * leadT + this._aimErr.x,
          y: target.pos.y + tv.y * leadT + this._aimErr.y
        };

        // 连射节奏：连射窗口 → 停火间隔 循环（人类不会无限按住开火键）
        if (this._firePause > 0) {
          this._firePause -= dt;
        } else {
          this._fireWindow -= dt;
          if (this._fireWindow <= 0) {
            this._firePause = 0.3 + Math.random() * 0.6;
            this._fireWindow = 0.5 + Math.random() * 0.9;
          }
        }

        // 射击判定：射程内 + 视线无阻挡 + 已反应 + 处于连射窗口
        const inRange = dist <= this.perception;
        /* 据点核心（_isBaseProxy）需特殊处理：它的目标点就位于核心方块内部，
         * 按普通规则做视线检测时，核心自身必然挡住射线 → los 恒为 false
         * → AI 永远不开火（据点守护里敌人只用车身撞、从不射击的根因）。
         * 对核心目标排除「核心自己」，其余墙体照常遮挡。 */
        const los = target._isBaseProxy
          ? this._lineClear(this.pos, target.pos, obstacles, target._baseObstacle)
          : this._lineClear(this.pos, target.pos, obstacles);
        if (inRange && los && this._reactionCd <= 0 && this._firePause <= 0 && this._fireWindow > 0) {
          virtualInput.shoot = true;
        }

        // 2. 移动决策：低血撤退优先，否则按等级差异化
        const retreating = this.hp / (this.maxHp || 1) < 0.34;
        if (retreating) {
          this._aiRetreat(dt, dx, dy, dist, virtualInput);
        } else if (this.rank === 'normal') {
          this._aiNormal(dt, dx, dy, dist, target, virtualInput);
        } else if (this.rank === 'fast') {
          this._aiFast(dt, dx, dy, dist, target, virtualInput, obstacles);
        } else if (this.rank === 'elite') {
          this._aiElite(dt, target, obstacles, virtualInput, playerTanks);
        }

        // 3. 受击闪避覆盖（优先级最高，被打本能躲）
        if (this._dodgeT > 0) {
          this._dodgeT -= dt;
          virtualInput.right = this._dodgeDir.x > 0.3;
          virtualInput.left = this._dodgeDir.x < -0.3;
          virtualInput.down = this._dodgeDir.y > 0.3;
          virtualInput.up = this._dodgeDir.y < -0.3;
        } else {
          // 4. 移动微停顿：人类瞄准时常停下脚步求稳
          this._movePauseCd -= dt;
          if (this._movePauseCd <= 0) {
            this._movePauseCd = 3 + Math.random() * 5;
            this._movePauseT = 0.15 + Math.random() * 0.35;
          }
          if (this._movePauseT > 0) {
            this._movePauseT -= dt;
            virtualInput.up = virtualInput.down = false;
            virtualInput.left = virtualInput.right = false;
          }
        }
      } else {
        // 无目标：原地怠速（不浪费 CPU）
        this._lastTargetRef = null;
      }

      // 透传剩余参数给 Tank.update（第 4 个参数起）
      /* ---------- 反转圈后处理：迟滞 + 卡死检测 ---------- */
      this._applyMoveHysteresis(virtualInput, dt);
      this._stuckTick(virtualInput, dt);
      const restArgs = Array.prototype.slice.call(arguments, 3);
      super.update.apply(this, [dt, virtualInput, obstacles].concat(restArgs));
    }

    /* ---------- 目标选择 ---------- */
    /**
     * @param {Array} playerTanks
     * @returns {Object|null} 最近的存活玩家坦克
     */
    _pickTarget(playerTanks) {
      let best = null;
      let bestDist = Infinity;
      if (!playerTanks || !playerTanks.length) return null;
      for (let i = 0; i < playerTanks.length; i++) {
        const p = playerTanks[i];
        if (!p || !p.alive || p.hp <= 0) continue;
        /* 不自锁：传入的列表可能包含其他 AI，需排除自己 */
        if (p === this) continue;
        /* 草丛隐身：藏入草丛的坦克对 AI 不可见、无法被锁定 */
        if (p.inBush) continue;
        const d = Math.hypot(p.pos.x - this.pos.x, p.pos.y - this.pos.y);
        if (d < bestDist) { bestDist = d; best = p; }
      }
      return best;
    }

    /* ---------- 移动决策迟滞：同一组方向键保持一小段时间，避免逐帧抖动导致原地转向 ---------- */
    _applyMoveHysteresis(input, dt) {
      const dec = this._moveDec;
      if (!dec) return;
      if (dec.t > 0) {
        /* 保持期内沿用上次决策（射击/瞄准不受影响） */
        dec.t -= dt;
        input.up = dec.u; input.down = dec.d;
        input.left = dec.l; input.right = dec.r;
      } else {
        /* 重新采样并锁定 0.18~0.3s */
        dec.u = input.up; dec.d = input.down;
        dec.l = input.left; dec.r = input.right;
        dec.t = 0.18 + Math.random() * 0.12;
      }
    }

    /* ---------- 卡死检测：原地转圈/顶墙时换方向脱困 ---------- */
    _stuckTick(input, dt) {
      /* 脱困期：直走不看 AI */
      if (this._unstickT > 0) {
        this._unstickT -= dt;
        input.up = this._unstickDir.u; input.down = this._unstickDir.d;
        input.left = this._unstickDir.l; input.right = this._unstickDir.r;
        return;
      }
      this._stuckSampleT -= dt;
      if (this._stuckSampleT > 0) return;
      this._stuckSampleT = 0.9;
      const moved = Math.hypot(this.pos.x - this._stuckLastPos.x, this.pos.y - this._stuckLastPos.y);
      const pressing = input.up || input.down || input.left || input.right;
      this._stuckLastPos.x = this.pos.x; this._stuckLastPos.y = this.pos.y;
      if (pressing && moved < 14) {
        /* 0.9s 按着方向键却几乎没动 → 原地打转或顶墙，随机换向直走 0.55s */
        const dirs = [
          { u: true,  d: false, l: false, r: false },
          { u: false, d: true,  l: false, r: false },
          { u: false, d: false, l: true,  r: false },
          { u: false, d: false, l: false, r: true  },
          { u: true,  d: false, l: true,  r: false },
          { u: true,  d: false, l: false, r: true  },
          { u: false, d: true,  l: true,  r: false },
          { u: false, d: true,  l: false, r: true  }
        ];
        this._unstickDir = dirs[(Math.random() * dirs.length) | 0];
        this._unstickT = 0.55;
        /* 清空迟滞锁，让脱困方向立即生效 */
        if (this._moveDec) this._moveDec.t = 0;
      }
    }

    /* ---------- 低血撤退：背向目标 + 侧向摆动（人类残血会边退边打） ---------- */
    _aiRetreat(dt, dx, dy, dist, input) {
      const len = Math.max(dist, 0.001);
      const bx = -dx / len, by = -dy / len;           // 背向目标
      const sway = Math.sin(this._renderT * 3) * 0.45; // 走位摆动，不走直线
      const mvX = bx + (-by * sway);
      const mvY = by + (bx * sway);
      input.right = mvX > 0.25;
      input.left = mvX < -0.25;
      input.down = mvY > 0.25;
      input.up = mvY < -0.25;
    }

    /* ---------- 视线检测：两点间是否有挡子弹的障碍 ---------- */
    _lineClear(a, b, obstacles, exclude) {
      if (!obstacles || !obstacles.length) return true;
      for (let i = 0; i < obstacles.length; i++) {
        const ob = obstacles[i];
        if (!ob || !ob.alive || !ob.blockBullet) continue;
        /* exclude：目标自身（据点核心）。打核心时核心不该算作遮挡物 */
        if (exclude && ob === exclude) continue;
        const bb = ob.aabb;
        if (!bb) continue;
        if (this._segIntersectsAABB(a.x, a.y, b.x, b.y, bb)) return false;
      }
      return true;
    }

    /* 线段 vs AABB 相交测试（Liang-Barsky 裁剪） */
    _segIntersectsAABB(x0, y0, x1, y1, bb) {
      const dx = x1 - x0, dy = y1 - y0;
      let tMin = 0, tMax = 1;
      const pp = [-dx, dx, -dy, dy];
      const qq = [x0 - bb.x, bb.x + bb.w - x0, y0 - bb.y, bb.y + bb.h - y0];
      for (let i = 0; i < 4; i++) {
        if (pp[i] === 0) {
          if (qq[i] < 0) return false;
        } else {
          const t = qq[i] / pp[i];
          if (pp[i] < 0) {
            if (t > tMax) return false;
            if (t > tMin) tMin = t;
          } else {
            if (t < tMin) return false;
            if (t < tMax) tMax = t;
          }
        }
      }
      return true;
    }

    /* ---------- 普通敌军：直线追击 ---------- */
    _aiNormal(dt, dx, dy, dist, target, input) {
      if (dist < 1) return;
      // 归一化方向 → 映射到 4 方向按键
      const nx = dx / dist;
      const ny = dy / dist;
      // 优先使用主方向（绝对值大的那个），次方向辅助
      if (Math.abs(nx) > Math.abs(ny)) {
        input.right = nx > 0.1;
        input.left = nx < -0.1;
        if (Math.abs(ny) > 0.3) {
          input.down = ny > 0.1;
          input.up = ny < -0.1;
        }
      } else {
        input.down = ny > 0.1;
        input.up = ny < -0.1;
        if (Math.abs(nx) > 0.3) {
          input.right = nx > 0.1;
          input.left = nx < -0.1;
        }
      }
    }

    /* ---------- 快速敌军：绕行侧向射击 ---------- */
    _aiFast(dt, dx, dy, dist, target, input, obstacles) {
      // 绕行方向定期切换（防卡死）
      this._strafeCd -= dt;
      if (this._strafeCd <= 0) {
        this._strafeCd = 2.0 + Math.random() * 1.5;
        this._strafeDir = Math.random() < 0.5 ? 1 : -1;
      }

      // 期望距离 250~300：过远→追击，过近→后退，区间内→带前向分量的侧移
      const idealMin = 250, idealMax = 300;
      const len = Math.max(dist, 0.001);
      const fwdX = dx / len;  // 指向目标的前向向量
      const fwdY = dy / len;
      const sideX = -fwdY * this._strafeDir; // 侧向垂直向量
      const sideY = fwdX * this._strafeDir;

      /* 侧移累计超 1.6s 会绕着目标转圈 → 强制改为接近目标 0.8s 打破绕圈 */
      this._strafeAccum += dt;
      const forceApproach = this._strafeAccum > 1.6;
      if (forceApproach && this._strafeAccum > 2.4) this._strafeAccum = 0;

      let mvX = 0, mvY = 0;
      if (dist > idealMax || forceApproach) {
        // 太近则后退，太远则追击，同时加入侧向偏移
        mvX = fwdX * 0.8 + sideX * 0.5;
        mvY = fwdY * 0.8 + sideY * 0.5;
      } else if (dist < idealMin) {
        mvX = -fwdX * 0.6 + sideX * 0.6;
        mvY = -fwdY * 0.6 + sideY * 0.6;
      } else {
        // 区间内：侧移为主 + 前向分量（纯侧移会原地绕圈）
        mvX = sideX * 0.72 + fwdX * 0.4;
        mvY = sideY * 0.72 + fwdY * 0.4;
      }

      // 映射到四向按键
      const threshold = 0.15;
      input.right = mvX > threshold;
      input.left = mvX < -threshold;
      input.down = mvY > threshold;
      input.up = mvY < -threshold;
    }

    /* ---------- 精英敌军：BFS 寻路包抄 + 道具 ---------- */
    _aiElite(dt, target, obstacles, input, playerTanks) {
      // 道具使用：每 3s 有 5% 概率使用随机道具
      this._itemCd -= dt;
      if (this._itemCd <= 0) {
        this._itemCd = 3.0;
        if (Math.random() < 0.05 && typeof this.useItem === 'function') {
          const items = ['haste', 'tripleShot'];
          const pick = items[(Math.random() * items.length) | 0];
          this.useItem(pick);
        }
      }

      // 寻路：每隔 0.5s 重算 BFS
      this.repathCd -= dt;
      const grid = this._extractGrid(obstacles);
      if (this.repathCd <= 0 || !this.path.length) {
        this.repathCd = 0.5;
        const start = this._worldToCell(this.pos.x, this.pos.y, grid);
        const goal = this._worldToCell(target.pos.x, target.pos.y, grid);
        if (grid.gridCells) {
          this.path = EnemyAI._bfs(start, goal, grid.gridCells, grid.cols, grid.rows);
        }
        this._pathIdx = 0;
      }

      // 跟随路径点
      if (this.path.length > 0 && this._pathIdx < this.path.length) {
        const wp = this.path[this._pathIdx];
        const cellSize = grid.cellSize || 40;
        const wx = (wp.cx + 0.5) * cellSize;
        const wy = (wp.cy + 0.5) * cellSize;
        const ddx = wx - this.pos.x;
        const ddy = wy - this.pos.y;
        const dd = Math.hypot(ddx, ddy);

        // 到达当前路点，切到下一个
        if (dd < cellSize * 0.5) {
          this._pathIdx++;
        } else {
          const nx = ddx / dd;
          const ny = ddy / dd;
          // 四向映射
          if (Math.abs(nx) > Math.abs(ny)) {
            input.right = nx > 0.1;
            input.left = nx < -0.1;
            if (Math.abs(ny) > 0.35) {
              input.down = ny > 0.1;
              input.up = ny < -0.1;
            }
          } else {
            input.down = ny > 0.1;
            input.up = ny < -0.1;
            if (Math.abs(nx) > 0.35) {
              input.right = nx > 0.1;
              input.left = nx < -0.1;
            }
          }
        }
      } else {
        // 无路径 fallback：退化到普通直线追击
        const dx = target.pos.x - this.pos.x;
        const dy = target.pos.y - this.pos.y;
        const dist = Math.hypot(dx, dy) || 1;
        this._aiNormal(dt, dx, dy, dist, target, input);
      }
    }

    /* ---------- 网格辅助 ---------- */
    _extractGrid(obstacles) {
      if (!obstacles) return { gridCells: null, cols: 0, rows: 0, cellSize: 40 };
      // 兼容：obstacles 可能是数组（Tank.update 透传）或一个管理器对象（带 gridCells）
      if (Array.isArray(obstacles)) {
        return {
          gridCells: obstacles.length ? (obstacles[0]._gridCells || null) : null,
          cols: obstacles.length ? (obstacles[0]._cols || 0) : 0,
          rows: obstacles.length ? (obstacles[0]._rows || 0) : 0,
          cellSize: obstacles.length ? (obstacles[0]._cellSize || 40) : 40
        };
      }
      return {
        gridCells: obstacles.gridCells || null,
        cols: obstacles.cols || 0,
        rows: obstacles.rows || 0,
        cellSize: obstacles.cellSize || 40
      };
    }

    _worldToCell(wx, wy, grid) {
      const cs = grid.cellSize || 40;
      return {
        cx: Math.max(0, Math.min((grid.cols || 1) - 1, (wx / cs) | 0)),
        cy: Math.max(0, Math.min((grid.rows || 1) - 1, (wy / cs) | 0))
      };
    }

    /* ============================================================
     *  BFS 最短路径搜索（静态工具方法）
     *  gridCells: Uint8Array 或 Array<number>，长度 cols*rows；
     *            0 = 可通行，非 0 = 墙
     *  返回: [{cx, cy}...] 从 start 到 goal 的路径（不含 start，含 goal）
     * ============================================================ */
    static _bfs(startCell, goalCell, gridCells, cols, rows) {
      if (!gridCells || !cols || !rows) return [];
      const sc = startCell.cx, sr = startCell.cy;
      const gc = goalCell.cx, gr = goalCell.cy;
      if (sc === gc && sr === gr) return [];

      const total = cols * rows;
      if (sc < 0 || sc >= cols || sr < 0 || sr >= rows) return [];
      if (gc < 0 || gc >= cols || gr < 0 || gr >= rows) return [];

      // cameFrom: 父节点索引（-1 = 未访问）
      const cameFrom = new Int32Array(total);
      for (let i = 0; i < total; i++) cameFrom[i] = -1;
      const visited = new Uint8Array(total);

      const startIdx = sr * cols + sc;
      const goalIdx = gr * cols + gc;

      // 队列：用数组 + 指针模拟，避免 shift 开销
      const q = new Int32Array(total);
      let qHead = 0, qTail = 0;
      q[qTail++] = startIdx;
      visited[startIdx] = 1;
      cameFrom[startIdx] = startIdx;

      const DIRS = [
        [1, 0], [-1, 0], [0, 1], [0, -1]
      ];

      let found = false;
      while (qHead < qTail) {
        const cur = q[qHead++];
        if (cur === goalIdx) { found = true; break; }
        const cx = cur % cols;
        const cy = (cur / cols) | 0;
        for (let d = 0; d < 4; d++) {
          const nx = cx + DIRS[d][0];
          const ny = cy + DIRS[d][1];
          if (nx < 0 || nx >= cols || ny < 0 || ny >= rows) continue;
          const nIdx = ny * cols + nx;
          if (visited[nIdx]) continue;
          // 允许 goal 为墙（目标玩家可能站在墙里），其他墙不可过
          if (gridCells[nIdx] !== 0 && nIdx !== goalIdx) continue;
          visited[nIdx] = 1;
          cameFrom[nIdx] = cur;
          q[qTail++] = nIdx;
        }
      }

      if (!found) return [];

      // 回溯路径
      const path = [];
      let cur = goalIdx;
      while (cur !== startIdx && cameFrom[cur] !== -1) {
        path.push({ cx: cur % cols, cy: (cur / cols) | 0 });
        cur = cameFrom[cur];
      }
      path.reverse();
      return path;
    }

    /* ============================================================
     *  渲染：基础坦克 + 等级专属光晕 + 精英★ 标记
     * ============================================================ */
    render(ctx, camera) {
      // 1. 底层发光 halo（在坦克本体之前绘制，以便本体覆盖中心）
      this._renderHalo(ctx, camera);

      // 2. 坦克本体（基类绘制）
      super.render(ctx, camera);

      // 3. 精英头顶 ★ 标记
      if (this.rank === 'elite') {
        this._renderEliteStar(ctx, camera);
      }
    }

    _renderHalo(ctx, camera) {
      const cam = camera || (window.CT_RENDERER && window.CT_RENDERER.camera) || { x: 0, y: 0, zoom: 1 };
      const zoom = cam.zoom != null ? cam.zoom : (cam.scale != null ? cam.scale : 1);
      const px = (this.pos.x - cam.x) * zoom;
      const py = (this.pos.y - cam.y) * zoom;
      ctx.save();
      let color, radius, pulseAmp;
      if (this.rank === 'normal') {
        color = 'rgba(255,255,255,0.18)';
        radius = 26; pulseAmp = 0;
      } else if (this.rank === 'fast') {
        color = 'rgba(0,255,162,0.28)';
        radius = 28; pulseAmp = 3;
      } else { // elite: pulsing magenta large halo
        color = 'rgba(255,42,109,0.38)';
        radius = 42; pulseAmp = 8;
      }
      const r = radius + Math.sin(this._renderT * 4) * pulseAmp;
      const grd = ctx.createRadialGradient(px, py, radius * 0.2, px, py, r);
      grd.addColorStop(0, color);
      grd.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = grd;
      ctx.beginPath();
      ctx.arc(px, py, r, 0, Math.PI * 2);
      ctx.fill();

      // 外圈细边（光晕感）
      if (this.rank === 'elite') {
        ctx.strokeStyle = 'rgba(255,42,109,0.7)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(px, py, r + 4 + Math.sin(this._renderT * 6) * 2, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();
    }

    _renderEliteStar(ctx, camera) {
      const cam = camera || (window.CT_RENDERER && window.CT_RENDERER.camera) || { x: 0, y: 0, zoom: 1 };
      const zoom = cam.zoom != null ? cam.zoom : (cam.scale != null ? cam.scale : 1);
      // 头顶位置：坦克上方 32px（世界坐标）
      const offY = -32;
      const px = (this.pos.x - cam.x) * zoom;
      const py = (this.pos.y + offY - cam.y) * zoom;
      const pulse = 1 + Math.sin(this._renderT * 5) * 0.12;
      ctx.save();
      ctx.translate(px, py);
      ctx.scale(pulse, pulse);
      ctx.font = 'bold 18px "JetBrains Mono", "Share Tech Mono", monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      // 外发光
      ctx.shadowColor = '#bf5bff';
      ctx.shadowBlur = 14;
      ctx.fillStyle = '#bf5bff';
      ctx.fillText('★', 0, 0);
      // 内描边
      ctx.shadowBlur = 0;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 0.8;
      ctx.strokeText('★', 0, 0);
      ctx.restore();
    }
  }

  // 导出到命名空间
  window.CT_ENEMY = {
    EnemyAI: EnemyAI
  };
})();

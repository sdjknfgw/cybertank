/* ==========================================================
 * CyberTank — 物理系统 physics.js
 * 负责：
 *   - aabb(a,b)          AABB 相交检测
 *   - aabbVsCircle       AABB vs 圆形
 *   - sweepAABB          扫掠检测（防快子弹穿墙，返回 t∈[0,1]）
 *   - circleVsCircle     圆形相交
 *   - resolveCollision   坦克 vs 坦克 弹性位置解算
 * 所有方法都是纯函数（无状态），方便单元测试和热更新
 * ========================================================== */
(function (global) {
    'use strict';

    /** 微小浮点容差 */
    const EPS = 1e-6;

    const CT_PHYSICS = {

        /* ----------------------------------------------------------
         * 1) AABB 相交（轴对齐矩形）
         * 参数 a / b 必须有 {x,y,w,h}，以左上角为原点
         * ---------------------------------------------------------- */
        /**
         * AABB 相交检测
         * @param {{x:number,y:number,w:number,h:number}} a 矩形 A
         * @param {{x:number,y:number,w:number,h:number}} b 矩形 B
         * @returns {boolean} 是否相交（含相切）
         */
        aabb(a, b) {
            if (!a || !b) return false;
            return (
                a.x < b.x + b.w &&
                a.x + a.w > b.x &&
                a.y < b.y + b.h &&
                a.y + a.h > b.y
            );
        },

        /* ----------------------------------------------------------
         * 2) AABB vs 圆形
         * rect {x,y,w,h}   circle {x,y,r}（圆心 + 半径）
         * ---------------------------------------------------------- */
        /**
         * AABB vs 圆形检测
         * @param {{x:number,y:number,w:number,h:number}} rect
         * @param {{x:number,y:number,r:number}} circle
         * @returns {boolean}
         */
        aabbVsCircle(rect, circle) {
            if (!rect || !circle) return false;
            const cx = circle.x;
            const cy = circle.y;
            const r = circle.r;

            // 最近点：clamp 圆心到矩形内部
            const nx = Math.max(rect.x, Math.min(cx, rect.x + rect.w));
            const ny = Math.max(rect.y, Math.min(cy, rect.y + rect.h));

            const dx = cx - nx;
            const dy = cy - ny;
            return (dx * dx + dy * dy) <= r * r;
        },

        /* ----------------------------------------------------------
         * 3) 圆形 vs 圆形
         * a / b 均 {x,y,r}
         * ---------------------------------------------------------- */
        /**
         * 圆形与圆形相交
         * @param {{x:number,y:number,r:number}} a
         * @param {{x:number,y:number,r:number}} b
         * @returns {boolean}
         */
        circleVsCircle(a, b) {
            if (!a || !b) return false;
            const dx = b.x - a.x;
            const dy = b.y - a.y;
            const rr = a.r + b.r;
            return dx * dx + dy * dy <= rr * rr;
        },

        /* ----------------------------------------------------------
         * 4) 扫掠 AABB（Swept AABB）
         *   盒 box 从 from 移动到 to，判断和 obstacles 数组中的
         *   第一个障碍物的命中，返回 {hit:bool, t, obstacle, normal}
         *   t∈[0,1] 为命中归一化距离（0=起点就碰，1=完全没碰）
         *
         *   实现参考 Real-Time Collision Detection 的 slab 方法，
         *   用 to - from 作为速度方向，做 Minkowski 和的移动盒 vs 静盒。
         * ---------------------------------------------------------- */
        /**
         * @param {{x:number,y:number}} from 起点左上角
         * @param {{x:number,y:number}} to   终点左上角
         * @param {{w:number,h:number}} box  移动盒尺寸
         * @param {Array<{x:number,y:number,w:number,h:number}>} obstacles 障碍数组
         * @returns {{
         *   hit: boolean,
         *   t: number,                // 0~1，命中距离参数
         *   obstacle: object|null,    // 命中的障碍
         *   normal: {x:number,y:number}, // 命中法线（指向出射方向，单位向量）
         *   point:  {x:number,y:number}  // 命中点（box 中心）
         * }}
         */
        sweepAABB(from, to, box, obstacles) {
            const out = {
                hit: false,
                t: 1,
                obstacle: null,
                normal: { x: 0, y: 0 },
                point: { x: 0, y: 0 }
            };
            if (!from || !to || !box || !obstacles || obstacles.length === 0) return out;

            const vx = to.x - from.x;
            const vy = to.y - from.y;
            const bw = box.w;
            const bh = box.h;

            let tFirst = 1;
            let firstObs = null;
            let firstNormalX = 0;
            let firstNormalY = 0;

            for (let i = 0; i < obstacles.length; i++) {
                const o = obstacles[i];
                if (!o) continue;
                const rx1 = from.x, ry1 = from.y;
                const rx2 = rx1 + bw, ry2 = ry1 + bh;
                const ox1 = o.x, oy1 = o.y;
                const ox2 = o.x + o.w, oy2 = o.y + o.h;

                // 1) 如果起点就相交，立即返回 t=0
                if (rx1 < ox2 && rx2 > ox1 && ry1 < oy2 && ry2 > oy1) {
                    // 法线按最小重叠轴
                    const overlapX = Math.min(rx2 - ox1, ox2 - rx1);
                    const overlapY = Math.min(ry2 - oy1, oy2 - ry1);
                    let nx = 0, ny = 0;
                    if (overlapX < overlapY) {
                        nx = ((rx1 + rx2) * 0.5 < (ox1 + ox2) * 0.5) ? -1 : 1;
                    } else {
                        ny = ((ry1 + ry2) * 0.5 < (oy1 + oy2) * 0.5) ? -1 : 1;
                    }
                    out.hit = true;
                    out.t = 0;
                    out.obstacle = o;
                    out.normal.x = nx;
                    out.normal.y = ny;
                    out.point.x = from.x + bw * 0.5;
                    out.point.y = from.y + bh * 0.5;
                    return out;
                }

                // 2) Slab 方法求入/出 t
                //   对每个 slab（X 和 Y）计算 t_entry / t_exit
                let tx_entry, ty_entry;
                let tx_exit,  ty_exit;

                if (vx === 0) {
                    // 静止 X：看当前投影是否有重叠
                    if (rx2 <= ox1 || rx1 >= ox2) continue; // 不可能相交
                    tx_entry = -Infinity;
                    tx_exit  =  Infinity;
                } else {
                    const t1 = (ox1 - rx2) / vx;  // box 右 到 o 左
                    const t2 = (ox2 - rx1) / vx;  // box 左 到 o 右
                    tx_entry = Math.min(t1, t2);
                    tx_exit  = Math.max(t1, t2);
                }

                if (vy === 0) {
                    if (ry2 <= oy1 || ry1 >= oy2) continue;
                    ty_entry = -Infinity;
                    ty_exit  =  Infinity;
                } else {
                    const t1 = (oy1 - ry2) / vy;
                    const t2 = (oy2 - ry1) / vy;
                    ty_entry = Math.min(t1, t2);
                    ty_exit  = Math.max(t1, t2);
                }

                const t_entry = Math.max(tx_entry, ty_entry);
                const t_exit  = Math.min(tx_exit,  ty_exit);

                // 未命中（完全错过）
                if (t_entry > t_exit) continue;
                // 命中范围不在位移区间内
                if (t_entry >= 1 || t_exit <= 0) continue;
                // 有效 t 必须 ≥ 0
                const tHit = Math.max(0, t_entry);
                if (tHit < tFirst) {
                    tFirst = tHit;
                    firstObs = o;
                    // 法线：看哪个 slab 先被打到
                    if (tx_entry > ty_entry) {
                        // X 先命中
                        firstNormalX = (vx < 0) ? 1 : -1;
                        firstNormalY = 0;
                    } else if (ty_entry > tx_entry) {
                        // Y 先命中
                        firstNormalX = 0;
                        firstNormalY = (vy < 0) ? 1 : -1;
                    } else {
                        // 同时命中（边角）：取两者
                        firstNormalX = (vx < 0) ? 1 : -1;
                        firstNormalY = (vy < 0) ? 1 : -1;
                    }
                }
            }

            if (firstObs) {
                out.hit = true;
                out.t = tFirst;
                out.obstacle = firstObs;
                out.normal.x = firstNormalX;
                out.normal.y = firstNormalY;
                out.point.x = from.x + vx * tFirst + bw * 0.5;
                out.point.y = from.y + vy * tFirst + bh * 0.5;
            } else {
                out.point.x = to.x + bw * 0.5;
                out.point.y = to.y + bh * 0.5;
            }
            return out;
        },

        /* ----------------------------------------------------------
         * 5) 碰撞解算（坦克对坦克的弹性位置解算 + 速度投影）
         *   a / b 必须含：{x,y,w,h, vx,vy, mass?}  质量默认 1
         *   解算采用 "最小重叠轴 + 基于质量比例的位置修正 + 速度反射减"
         *   适用于实体 vs 实体（坦克对坦克）。坦克对墙用 sweepAABB。
         * ---------------------------------------------------------- */
        /**
         * 解算两个 AABB 物体（两坦克）的重叠 + 速度反弹
         * @param {{x:number,y:number,w:number,h:number,vx:number,vy:number,mass?:number}} a
         * @param {{x:number,y:number,w:number,h:number,vx:number,vy:number,mass?:number}} b
         * @returns {boolean} 若发生解算返回 true
         */
        resolveCollision(a, b) {
            if (!a || !b) return false;
            // 快速剔除
            if (!this.aabb(a, b)) return false;

            // 1. 计算各方向重叠量（正：重叠）
            // 重叠在 X：a右-b左  与  b右-a左  取 min
            const dxOverlap1 = (a.x + a.w) - b.x;   // a 穿过 b 左侧
            const dxOverlap2 = (b.x + b.w) - a.x;   // b 穿过 a 左侧
            const overlapX = Math.min(dxOverlap1, dxOverlap2);

            const dyOverlap1 = (a.y + a.h) - b.y;
            const dyOverlap2 = (b.y + b.h) - a.y;
            const overlapY = Math.min(dyOverlap1, dyOverlap2);

            let nx = 0, ny = 0;
            let push = 0;
            if (overlapX < overlapY) {
                // X 方向重叠更小
                push = overlapX;
                if (dxOverlap1 < dxOverlap2) nx = -1;   // a 在 b 左边，a 向左推出
                else nx = 1;
            } else {
                push = overlapY;
                if (dyOverlap1 < dyOverlap2) ny = -1;
                else ny = 1;
            }

            // 2. 按质量分推：质量大推的少
            const ma = (typeof a.mass === 'number' && a.mass > 0) ? a.mass : 1;
            const mb = (typeof b.mass === 'number' && b.mass > 0) ? b.mass : 1;
            const totalM = ma + mb;
            const ratioA = mb / totalM;  // a 分得的推量比例
            const ratioB = ma / totalM;

            // 加 1% 松弛，防止贴边后还卡在里面
            const pushA = push * ratioA + EPS;
            const pushB = push * ratioB + EPS;

            a.x += nx * pushA;
            a.y += ny * pushA;
            b.x -= nx * pushB;
            b.y -= ny * pushB;

            // 3. 速度：法向分量按弹性系数交换（0.3 弹性 + 0.7 动量守恒，简化版）
            const rest = 0.25; // 弹性系数（越低越不弹）
            // a 的法向速度分量
            const va_n = a.vx * nx + a.vy * ny;
            const vb_n = b.vx * nx + b.vy * ny;

            // 只有相向运动才反弹（否则已经在分离，别再互相吸）
            if ((va_n - vb_n) > 0) {
                // 冲量 j（简化：相对速度 * (1+rest) / (1/m1 + 1/m2)）
                const invA = 1 / ma;
                const invB = 1 / mb;
                const j = (-(1 + rest) * (va_n - vb_n)) / (invA + invB);
                const impulseX = j * nx;
                const impulseY = j * ny;
                if (isFinite(impulseX) && isFinite(impulseY)) {
                    a.vx += impulseX * invA;
                    a.vy += impulseY * invA;
                    b.vx -= impulseX * invB;
                    b.vy -= impulseY * invB;
                }
            }

            // 4. 切向摩擦：简单衰减切向相对速度的 10%（防止"无限滑"）
            const tx = -ny, ty = nx;  // 切线方向（和法线垂直）
            const va_t = a.vx * tx + a.vy * ty;
            const vb_t = b.vx * tx + b.vy * ty;
            const relT = va_t - vb_t;
            const frictionCoeff = 0.08;
            if (Math.abs(relT) > EPS) {
                const frictionImpulse = -relT * frictionCoeff / (1 / ma + 1 / mb);
                if (isFinite(frictionImpulse)) {
                    const ftx = frictionImpulse * tx;
                    const fty = frictionImpulse * ty;
                    a.vx += ftx * (1 / ma);
                    a.vy += fty * (1 / ma);
                    b.vx -= ftx * (1 / mb);
                    b.vy -= fty * (1 / mb);
                }
            }
            return true;
        },

        /* ----------------------------------------------------------
         * 辅助：clamp
         * ---------------------------------------------------------- */
        /** @private 工具函数（内部用，也暴露给外部） */
        clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); },
        lerp(a, b, t) { return a + (b - a) * t; }
    };

    global.CT_PHYSICS = CT_PHYSICS;

})(typeof window !== 'undefined' ? window : globalThis);

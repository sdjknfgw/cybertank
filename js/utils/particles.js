/* ==========================================================
 * CyberTank — 通用粒子系统 particles.js（Canvas FX 层）
 * 挂载 window.CT_PARTICLES
 * 职责：
 *   - 通用粒子 emit / 圆环 ripple / 伤害文字 text / 震屏 shake
 *   - 预设：explode / hitSpark / pickupGlow
 *   - 粒子数量上限 2000（超过丢弃最旧）
 *   - init 时自动注册到 CT_ENGINE.registerUpdate / registerRender('fx')
 *   - 事件绑定：tank:dead / tank:hit / boss:phaseChanged / shop:purchased / wave:cleared
 * ========================================================== */
(function (global) {
    'use strict';

    var MAX_PARTICLES = 2000;
    var MAX_RIPPLES = 500;
    var MAX_TEXTS = 300;
    var PI2 = Math.PI * 2;

    /* -------------------- 工具 -------------------- */
    function _rand(a, b) { return a + Math.random() * (b - a); }
    function _clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
    function _pick(arr) { return arr[(Math.random() * arr.length) | 0]; }

    function _getCanvas(canvasOrId) {
        if (typeof canvasOrId === 'string') {
            try { return document.querySelector(canvasOrId); } catch (_) { return null; }
        }
        if (canvasOrId && canvasOrId.getContext) return canvasOrId;
        return null;
    }

    /* -------------------- 相机 shake 累加到 CT_RENDERER -------------------- */
    function _addShake(mag, dur) {
        try {
            var R = global.CT_RENDERER;
            if (!R) return;
            if (!R.camera) R.camera = {};
            var c = R.camera;
            // CT_RENDERER 未内置 shake 字段的话，这里主动补上累计 shakeX/shakeY/shakeTime
            if (typeof c.shakeMag !== 'number') c.shakeMag = 0;
            if (typeof c.shakeTime !== 'number') c.shakeTime = 0;
            c.shakeMag = Math.max(c.shakeMag, Number(mag) || 0);
            c.shakeTime = Math.max(c.shakeTime, Number(dur) || 0);
        } catch (_) { /* ignore */ }
    }

    /* -------------------- 主对象 -------------------- */
    var CT_PARTICLES = {
        layer: null,
        ctx: null,
        particles: [],
        ripples: [],
        texts: [],
        _inited: false,
        _dpr: 1,
        _w: 0,
        _h: 0,

        /* ==================== 初始化 ==================== */
        init: function (canvasOrId) {
            if (this._inited) return this;
            var cv = _getCanvas(canvasOrId || '#cv-fx');
            if (!cv) {
                // 找不到 canvas 就创建一个备用（放在 body，z-20，避免影响流程）
                try {
                    cv = document.createElement('canvas');
                    cv.id = 'cv-fx-fallback';
                    cv.style.cssText = 'position:absolute;inset:0;z-index:20;pointer-events:none;';
                    (document.body || document.documentElement).appendChild(cv);
                } catch (e) {
                    console.warn('[CT_PARTICLES] canvas unavailable', e);
                    // 没有 canvas 也仍允许内存结构存在，避免报错
                    this._inited = true;
                    this._hookEngine();
                    this._hookBus();
                    return this;
                }
            }
            this.layer = cv;
            try {
                this.ctx = cv.getContext('2d', { alpha: true, desynchronized: true });
            } catch (_) { this.ctx = null; }

            this.resize();
            var self = this;
            window.addEventListener('resize', function () { self.resize(); }, false);

            this._inited = true;
            this._hookEngine();
            this._hookBus();
            return this;
        },

        resize: function () {
            var cv = this.layer;
            if (!cv) return;
            var w = Math.max(1, window.innerWidth);
            var h = Math.max(1, window.innerHeight);
            this._w = w; this._h = h;
            var dpr = Math.min(3, window.devicePixelRatio || 1);
            this._dpr = dpr;
            cv.style.width = w + 'px';
            cv.style.height = h + 'px';
            cv.width = Math.floor(w * dpr);
            cv.height = Math.floor(h * dpr);
            if (this.ctx) {
                this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
                this.ctx.imageSmoothingEnabled = true;
            }
        },

        _hookEngine: function () {
            var E = global.CT_ENGINE;
            if (!E) return;
            var self = this;
            if (typeof E.registerUpdate === 'function') {
                E.registerUpdate(function (dt) { self.update(dt); }, 50);
            }
            if (typeof E.registerRender === 'function') {
                E.registerRender(function (ctx, alpha) { self.render(ctx, alpha); }, 'fx');
            }
        },

        _hookBus: function () {
            var B = global.CT_BUS;
            if (!B || typeof B.on !== 'function') return;
            var self = this;

            // 坦克死亡：大爆炸
            B.on('tank:dead', function (ev) {
                try {
                    var t = (ev && (ev.tank || ev.dead));
                    if (!t) return;
                    var x = t.x != null ? (t.w ? t.x + t.w / 2 : t.x) : 0;
                    var y = t.y != null ? (t.h ? t.y + t.h / 2 : t.y) : 0;
                    var lvl = (t.isBoss) ? 3 : ((t.rank === 'elite') ? 2 : 1);
                    self.explode(x, y, lvl);
                } catch (_) {}
            });

            // 坦克受击：火花 + 红色受击 + 轻白闪
            B.on('tank:hit', function (ev) {
                try {
                    ev = ev || {};
                    var t = ev.tank;
                    var x = t ? (t.w ? t.x + t.w / 2 : t.x) : (ev.x || 0);
                    var y = t ? (t.h ? t.y + t.h / 2 : t.y) : (ev.y || 0);
                    self.hitSpark(x, y, '#ff2a6d');
                    global.CT_EFFECTS && global.CT_EFFECTS.hitVignette && global.CT_EFFECTS.hitVignette(0.6, 180);
                    global.CT_EFFECTS && global.CT_EFFECTS.flashWhite && global.CT_EFFECTS.flashWhite(0.2, 100);
                } catch (_) {}
            });

            // BOSS 阶段切换：glitch + shake
            B.on('boss:phaseChanged', function (ev) {
                try {
                    global.CT_EFFECTS && global.CT_EFFECTS.glitch && global.CT_EFFECTS.glitch(420, 1);
                    self.shake(10, 0.5);
                } catch (_) {}
            });

            // 商店购买成功：拾取光效 + 金币文字
            B.on('shop:purchased', function (ev) {
                try {
                    ev = ev || {};
                    var p = ev.player;
                    var price = ev.finalPrice || 0;
                    var x = (p && p.x != null) ? (p.w ? p.x + p.w / 2 : p.x) : (global.innerWidth / 2);
                    var y = (p && p.y != null) ? (p.h ? p.y + p.h / 2 : p.y) : (global.innerHeight / 2);
                    var color = (ev.item && ev.item.rarity === 'legendary') ? '#ffd166'
                              : (ev.item && ev.item.rarity === 'epic') ? '#bf5fff'
                              : (ev.item && ev.item.rarity === 'rare') ? '#57d9ff'
                              : '#7dffb5';
                    self.pickupGlow(x, y, color, '+' + (price > 0 ? price : '购'));
                } catch (_) {}
            });

            // 波次清空：轻白闪
            B.on('wave:cleared', function () {
                try {
                    global.CT_EFFECTS && global.CT_EFFECTS.flashWhite && global.CT_EFFECTS.flashWhite(0.15, 90);
                } catch (_) {}
            });
        },

        /* ==================== 通用发射 ==================== */
        /**
         * @param {{x:number,y:number,count?:number,colors?:string[],speed?:number[],life?:number[],size?:number[],gravity?:number,shape?:string,spread?:number,angle?:number,shrink?:boolean}} opts
         */
        emit: function (opts) {
            opts = opts || {};
            var x = Number(opts.x) || 0;
            var y = Number(opts.y) || 0;
            /* 粒子数量按画质档位缩放（renderer.fxScale：low=0 / med=0.6 / high=1）
             * 低画质完全关闭粒子，中画质 60%，高画质 100% → 三档视觉差异明显 */
            var baseCount = (opts.count == null) ? 12 : (opts.count | 0);
            var fxScale = 1;
            try {
                var _R = global.CT_RENDERER;
                if (_R && typeof _R.fxScale === 'number') fxScale = _R.fxScale;
            } catch (_) { /* ignore */ }
            if (fxScale <= 0) return;  // 低画质：跳过全部粒子
            var count = Math.max(1, Math.round(baseCount * fxScale));
            if (count <= 0) return;
            var colors = Array.isArray(opts.colors) ? opts.colors : ['#00f0ff', '#ff2a6d', '#ffd700'];
            var sLo = Array.isArray(opts.speed) ? (Number(opts.speed[0]) || 0) : (Number(opts.speed) || 2);
            var sHi = Array.isArray(opts.speed) ? (Number(opts.speed[1]) || sLo) : sLo;
            var lLo = Array.isArray(opts.life) ? (Number(opts.life[0]) || 0) : (Number(opts.life) || 0.6);
            var lHi = Array.isArray(opts.life) ? (Number(opts.life[1]) || lLo) : lLo;
            var zLo = Array.isArray(opts.size) ? (Number(opts.size[0]) || 1) : (Number(opts.size) || 3);
            var zHi = Array.isArray(opts.size) ? (Number(opts.size[1]) || zLo) : zLo;
            var gravity = (opts.gravity == null) ? 0.1 : Number(opts.gravity);
            var shape = opts.shape || 'circle';
            var spread = (opts.spread == null) ? PI2 : Number(opts.spread);
            var angle = Number(opts.angle) || 0;
            var shrink = opts.shrink !== false;

            var base = angle - spread / 2;
            for (var i = 0; i < count; i++) {
                var a = base + Math.random() * spread;
                var sp = _rand(sLo, sHi);
                var life = _rand(lLo, lHi);
                var sz = _rand(zLo, zHi);
                this.particles.push({
                    x: x, y: y,
                    vx: Math.cos(a) * sp,
                    vy: Math.sin(a) * sp,
                    life: life,
                    maxLife: Math.max(0.0001, life),
                    size: sz,
                    color: _pick(colors),
                    shape: shape,
                    gravity: gravity,
                    shrink: shrink
                });
            }
            // 数量 cap
            while (this.particles.length > MAX_PARTICLES) this.particles.shift();
        },

        ripple: function (opts) {
            opts = opts || {};
            this.ripples.push({
                x: Number(opts.x) || 0,
                y: Number(opts.y) || 0,
                r: 0,
                maxR: Number(opts.maxR) || 64,
                color: opts.color || '#ff2a6d',
                life: Number(opts.life) || 0.7,
                maxLife: Math.max(0.0001, Number(opts.life) || 0.7),
                width: Number(opts.width) || 3,
                delay: Number(opts.delay) || 0
            });
            while (this.ripples.length > MAX_RIPPLES) this.ripples.shift();
        },

        text: function (opts) {
            opts = opts || {};
            var wx = Number(opts.worldX);
            var wy = Number(opts.worldY);
            var sx = opts.screenX, sy = opts.screenY;
            if (sx == null || sy == null) {
                try {
                    var R = global.CT_RENDERER;
                    if (R && typeof R.worldToScreen === 'function') {
                        var p = R.worldToScreen(wx, wy);
                        sx = p.x; sy = p.y;
                    } else {
                        sx = wx; sy = wy;
                    }
                } catch (_) { sx = wx; sy = wy; }
            }
            this.texts.push({
                x: sx, y: sy,
                vy: -0.04,                 // 屏幕空间 px/ms
                text: (opts.text == null) ? '-99' : String(opts.text),
                color: opts.color || '#ffd700',
                size: Number(opts.size) || 18,
                font: opts.font || 'JetBrains Mono, Share Tech Mono, monospace',
                life: Number(opts.life) || 0.8,
                maxLife: Math.max(0.0001, Number(opts.life) || 0.8)
            });
            while (this.texts.length > MAX_TEXTS) this.texts.shift();
        },

        shake: function (magnitude, duration) {
            var mag = Number(magnitude) || 6;
            var dur = (Number(duration) || 0.25) * 1000; // 统一使用 ms
            _addShake(mag, dur);
        },

        /* ==================== 帧更新 ==================== */
        update: function (dt) {
            dt = Number(dt) || 16.666;
            var ts = dt / 16.666;           // 60fps 归一化步长，速度/尺寸都基于此
            // 粒子
            var ps = this.particles;
            for (var i = ps.length - 1; i >= 0; i--) {
                var p = ps[i];
                p.life -= dt / 1000;
                if (p.life <= 0) { ps.splice(i, 1); continue; }
                p.vy += p.gravity * ts;
                p.x += p.vx * ts;
                p.y += p.vy * ts;
            }
            // 涟漪
            var rs = this.ripples;
            for (var j = rs.length - 1; j >= 0; j--) {
                var r = rs[j];
                if (r.delay > 0) { r.delay -= dt / 1000; continue; }
                r.life -= dt / 1000;
                if (r.life <= 0) { rs.splice(j, 1); continue; }
                var t = 1 - r.life / r.maxLife;
                r.r = r.maxR * t;
            }
            // 文字
            var ts2 = this.texts;
            for (var k = ts2.length - 1; k >= 0; k--) {
                var tx = ts2[k];
                tx.life -= dt / 1000;
                if (tx.life <= 0) { ts2.splice(k, 1); continue; }
                tx.y += tx.vy * dt;
            }
        },

        /* ==================== 渲染 ==================== */
        render: function (ctx) {
            var c = ctx || this.ctx;
            if (!c) return;
            // 注意：engine._doRender 已经 clearRect，这里不再重复清屏

            // ---- 粒子 ----
            var ps = this.particles;
            for (var i = 0; i < ps.length; i++) {
                var p = ps[i];
                var t = p.life / p.maxLife;
                var alpha = _clamp(t, 0, 1);
                var sz = p.shrink ? (p.size * alpha) : p.size;
                if (sz < 0.2) continue;
                c.save();
                c.globalAlpha = alpha;
                c.fillStyle = p.color;
                if (p.shape === 'square') {
                    c.fillRect(p.x - sz / 2, p.y - sz / 2, sz, sz);
                } else if (p.shape === 'spark') {
                    // 沿速度方向拉一条短线
                    var len = sz * 3 + 1;
                    var ang = Math.atan2(p.vy, p.vx);
                    c.translate(p.x, p.y);
                    c.rotate(ang);
                    c.fillRect(-len / 2, -sz / 2, len, sz);
                } else { // 默认 circle
                    c.beginPath();
                    c.arc(p.x, p.y, sz, 0, PI2);
                    c.fill();
                }
                c.restore();
            }

            // ---- 涟漪 ----
            var rs = this.ripples;
            for (var j = 0; j < rs.length; j++) {
                var r = rs[j];
                if (r.delay > 0) continue;
                var alpha2 = _clamp(r.life / r.maxLife, 0, 1);
                c.save();
                c.globalAlpha = alpha2;
                c.strokeStyle = r.color;
                c.lineWidth = r.width;
                c.beginPath();
                c.arc(r.x, r.y, Math.max(0, r.r), 0, PI2);
                c.stroke();
                c.restore();
            }

            // ---- 文字（屏幕空间）----
            var tarr = this.texts;
            for (var k = 0; k < tarr.length; k++) {
                var tt = tarr[k];
                var a = _clamp(tt.life / tt.maxLife, 0, 1);
                c.save();
                c.globalAlpha = a;
                c.fillStyle = tt.color;
                c.font = '800 ' + tt.size + 'px ' + tt.font;
                c.textAlign = 'center';
                c.textBaseline = 'middle';
                c.shadowColor = tt.color;
                c.shadowBlur = tt.size * 0.6;
                c.fillText(tt.text, tt.x, tt.y);
                c.restore();
            }
        },

        /* ==================== 预设特效 ==================== */
        explode: function (x, y, level) {
            x = Number(x) || 0; y = Number(y) || 0;
            var lv = _clamp(level | 0 || 1, 1, 3);
            if (lv === 1) {
                this.emit({ x: x, y: y, count: 24,
                    colors: ['#ffd166', '#ff6b6b', '#ffffff'],
                    speed: [2, 7], life: [0.35, 0.9], size: [1.5, 4], gravity: 0.06, shape: 'circle' });
                this.ripple({ x: x, y: y, maxR: 60, color: '#ff6b6b', life: 0.55, width: 2 });
                this.shake(4, 0.18);
            } else if (lv === 2) {
                this.emit({ x: x, y: y, count: 48,
                    colors: ['#ffd166', '#ff3860', '#ffffff', '#ff9f1c'],
                    speed: [2.5, 9], life: [0.4, 1.1], size: [2, 5], gravity: 0.08, shape: 'spark' });
                this.ripple({ x: x, y: y, maxR: 96, color: '#ff3860', life: 0.65, width: 3 });
                this.ripple({ x: x, y: y, maxR: 140, color: '#ffd166', life: 0.8, width: 2, delay: 0.08 });
                this.shake(7, 0.3);
            } else {
                this.emit({ x: x, y: y, count: 96,
                    colors: ['#ffd166', '#ff2a6d', '#ffffff', '#ff9f1c', '#b5179e'],
                    speed: [3, 12], life: [0.5, 1.4], size: [2, 6], gravity: 0.1, shape: 'spark' });
                this.ripple({ x: x, y: y, maxR: 140, color: '#ff2a6d', life: 0.8, width: 4 });
                this.ripple({ x: x, y: y, maxR: 220, color: '#ffd166', life: 1.0, width: 3, delay: 0.1 });
                this.ripple({ x: x, y: y, maxR: 300, color: '#ffffff', life: 1.2, width: 2, delay: 0.2 });
                this.shake(10, 0.5);
            }
            try { global.CT_AUDIO && global.CT_AUDIO.play && global.CT_AUDIO.play('explode'); } catch (_) {}
        },

        /** 命中火花：反方向扇形（angle 默认子弹方向传入；这里没有方向就球形扩散） */
        hitSpark: function (x, y, color) {
            this.emit({
                x: x, y: y,
                count: 8,
                colors: [color || '#ffffff', '#ffffff', '#ffd166'],
                speed: [1.5, 5], life: [0.2, 0.45], size: [1, 2.5],
                gravity: 0, shape: 'spark', spread: PI2
            });
            try { global.CT_AUDIO && global.CT_AUDIO.play && global.CT_AUDIO.play('hit'); } catch (_) {}
        },

        /** 拾取光效（金币/道具） */
        pickupGlow: function (x, y, color, textLabel) {
            color = color || '#ffd700';
            this.emit({
                x: x, y: y, count: 16,
                colors: [color, '#ffffff', '#ffe9a8'],
                speed: [1.5, 4.5], life: [0.4, 0.8], size: [1.5, 3],
                gravity: -0.05, shape: 'circle'
            });
            this.ripple({ x: x, y: y, maxR: 54, color: color, life: 0.6, width: 2 });
            if (textLabel != null) {
                this.text({ worldX: x, worldY: y, text: String(textLabel), color: color, size: 18, life: 0.9 });
            }
            try { global.CT_AUDIO && global.CT_AUDIO.play && global.CT_AUDIO.play('pickup'); } catch (_) {}
        }
    };

    global.CT_PARTICLES = CT_PARTICLES;

})(typeof window !== 'undefined' ? window : globalThis);

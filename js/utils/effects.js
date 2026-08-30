/* ==========================================================
 * CyberTank — 屏幕特效 effects.js（DOM 层叠加）
 * 挂载 window.CT_EFFECTS
 * 职责：
 *   - 初始化 #ct-screen-effects（fixed inset-0 z-40 pointer-events-none）
 *     内含 flashEl / hitEl / glitchEl / vignetteEl / filterEl
 *   - flashWhite / hitVignette / glitch / setVignette / setFilter / slowMo / legendaryBurst
 *   - 事件绑定：buff 传说选中 → legendaryBurst
 * ========================================================== */
(function (global) {
    'use strict';

    var ROOT_ID = 'ct-screen-effects';
    var HOST_ID = 'hud-layer';

    /* -------------------- 工具 -------------------- */
    function $(id) {
        try { return document.getElementById(id); } catch (_) { return null; }
    }

    function _raf(fn) {
        var r = global.requestAnimationFrame || function (cb) { return setTimeout(cb, 16); };
        return r.call(global, fn);
    }
    function _craf(id) {
        try { (global.cancelAnimationFrame || clearTimeout)(id); } catch (_) {}
    }

    /** 应用 CSS transition：设置 style[key]=val，加上 transition=props dur ease-out（dur 毫秒） */
    function _apply(node, style, dur) {
        if (!node) return;
        var d = Number(dur) || 0;
        try {
            if (d > 0) {
                var transKeys = Object.keys(style);
                var transParts = [];
                for (var i = 0; i < transKeys.length; i++) {
                    transParts.push(jsToCss(transKeys[i]) + ' ' + d + 'ms ease-out');
                }
                node.style.transition = transParts.join(',');
            }
            for (var k in style) if (Object.prototype.hasOwnProperty.call(style, k)) {
                node.style[k] = style[k];
            }
            if (d <= 0) return;
            var old = node._effectTransTimer;
            if (old) clearTimeout(old);
            node._effectTransTimer = setTimeout(function () {
                try { node.style.transition = ''; } catch (_) {}
                node._effectTransTimer = 0;
            }, d + 20);
        } catch (_) { /* ignore */ }
    }

    function jsToCss(k) {
        // opacity -> opacity; backgroundColor -> background-color
        return k.replace(/[A-Z]/g, function (m) { return '-' + m.toLowerCase(); });
    }

    /** clamp */
    function _c(v, a, b) { return v < a ? a : (v > b ? b : v); }

    /* -------------------- 主对象 -------------------- */
    var CT_EFFECTS = {
        root: null,
        flashEl: null,
        hitEl: null,
        glitchEl: null,
        vignetteEl: null,
        filterEl: null,

        vignetteIntensity: 0.35,

        _inited: false,
        _slowMoTimer: 0,
        _filterTimer: 0,
        _legendaryCb: null,

        /* ==================== init ==================== */
        init: function () {
            if (this._inited) return this;
            this._inited = true;
            try {
                if (typeof document === 'undefined') return this;
                // 找宿主
                var host = $(HOST_ID) || document.body || document.documentElement;
                // 防止重复创建
                var root = $(ROOT_ID);
                if (!root) {
                    root = document.createElement('div');
                    root.id = ROOT_ID;
                    // fixed inset-0 z-40 pointer-events-none
                    root.style.cssText = [
                        'position:fixed', 'inset:0', 'z-index:40',
                        'pointer-events:none', 'overflow:hidden',
                        'will-change:transform,filter,opacity'
                    ].join(';');
                    host.appendChild(root);
                }
                this.root = root;

                this.flashEl = this._ensureChild(root, '__flash', {
                    position:'absolute', inset:'0',
                    background:'#ffffff', opacity:'0',
                    mixBlendMode:'screen'
                });

                this.hitEl = this._ensureChild(root, '__hit', {
                    position:'absolute', inset:'0',
                    boxShadow:'inset 0 0 0px 0px rgba(255,56,96,0.6)',
                    opacity:'0'
                });

                this.vignetteEl = this._ensureChild(root, '__vig', {
                    position:'absolute', inset:'0',
                    background:this._vigBg(0.35),
                    opacity:'1'
                });

                this.glitchEl = this._ensureChild(root, '__glitch', {
                    position:'absolute', inset:'0',
                    opacity:'0',
                    transform:'translate(0,0)',
                    textShadow:'none',
                    background:'transparent'
                });

                // 给 filter 用的容器（覆盖 root 里所有子元素的 filter）
                this.filterEl = root;   // 直接把 filter 应用到 root 上，简单有效

                this._hookBus();
            } catch (e) {
                console.warn('[CT_EFFECTS] init failed', e);
            }
            return this;
        },

        _ensureChild: function (root, key, style) {
            var id = ROOT_ID + '-' + key;
            var el = $(id);
            if (!el) {
                el = document.createElement('div');
                el.id = id;
                var s = [];
                for (var k in style) if (Object.prototype.hasOwnProperty.call(style, k)) {
                    s.push(jsToCss(k) + ':' + style[k]);
                }
                el.style.cssText = s.join(';');
                root.appendChild(el);
            }
            return el;
        },

        _vigBg: function (i) {
            var a = _c(Number(i) || 0, 0, 1);
            // radial gradient：inner transparent 55% -> outer black with opacity
            return 'radial-gradient(ellipse at center, rgba(0,0,0,0) 55%, rgba(0,0,0,' + (a * 0.75).toFixed(3) + ') 82%, rgba(0,0,0,' + a.toFixed(3) + ') 100%)';
        },

        /* ==================== Bus hook ==================== */
        _hookBus: function () {
            var B = global.CT_BUS;
            if (!B || typeof B.on !== 'function') return;
            var self = this;

            // 传说增益选中（带 DOM 元素）
            B.on('buff:legendary', function (ev) {
                try {
                    ev = ev || {};
                    var dom = ev.dom || ev.element || ev.target;
                    if (dom && dom.getBoundingClientRect) self.legendaryBurst(dom);
                } catch (_) {}
            });
            // 兼容的另一种事件（buff:selected 中 rarity=legendary）
            B.on('buff:selected', function (ev) {
                try {
                    ev = ev || {};
                    if (ev.rarity !== 'legendary') return;
                    var dom = ev.dom || ev.element || ev.target;
                    if (dom && dom.getBoundingClientRect) self.legendaryBurst(dom);
                } catch (_) {}
            });

            // 死亡：灰度 + 暗角增强
            B.on('tank:dead', function (ev) {
                try {
                    if (ev && ev.tank && ev.tank.isPlayer) {
                        self.setFilter('grayscale(0.9) saturate(0.6) contrast(0.95)', 600);
                        self.setVignette(0.85, 700);
                    }
                } catch (_) {}
            });
        },

        /* ==================== 瞬时：白闪 ==================== */
        flashWhite: function (alpha, duration) {
            var a = (alpha == null) ? 0.5 : _c(Number(alpha), 0, 1);
            var d = (duration == null) ? 120 : Math.max(1, Number(duration) | 0);
            if (!this.flashEl) return;
            var el = this.flashEl;
            _apply(el, { opacity: a, background: '#ffffff' }, 0);
            if (el._flashTimer) clearTimeout(el._flashTimer);
            _raf(function () {
                _apply(el, { opacity: '0' }, d);
                el._flashTimer = setTimeout(function () {
                    try { el.style.opacity = '0'; } catch (_) {}
                    el._flashTimer = 0;
                }, d + 20);
            });
        },

        /* ==================== Hit vignette：内发红光边缘 ==================== */
        hitVignette: function (alpha, duration, color) {
            if (!this.hitEl) return;
            var a = _c(Number(alpha) || 0.8, 0, 1);
            var d = Math.max(1, (Number(duration) || 200) | 0);
            var c = color || 'rgba(255,56,96,0.6)';
            var el = this.hitEl;
            // 内阴影 + 透明度
            var shadow = 'inset 0 0 120px 40px ' + c + ', inset 0 0 200px 10px rgba(255,0,60,0.35)';
            _apply(el, { boxShadow: shadow, opacity: a }, 0);
            if (el._hitTimer) clearTimeout(el._hitTimer);
            _raf(function () {
                _apply(el, { opacity: '0' }, d);
                el._hitTimer = setTimeout(function () {
                    try { el.style.opacity = '0'; el.style.boxShadow = 'none'; } catch (_) {}
                    el._hitTimer = 0;
                }, d + 20);
            });
        },

        /* ==================== Glitch 故障效果 ==================== */
        glitch: function (duration, intensity) {
            var d = Math.max(50, (Number(duration) || 350) | 0);
            var it = _c(Number(intensity) || 1, 0.3, 3);
            if (!this.glitchEl) return;
            var el = this.glitchEl;
            var self = this;

            // 画面 transform 偏位（root 级 split）
            if (this.root) {
                _apply(this.root, { transform: 'translate(' + (2 * it).toFixed(1) + 'px,-1px)' }, 0);
                setTimeout(function () { if (self.root) _apply(self.root, { transform: 'translate(0,0)' }, 120); }, d * 0.15);
                setTimeout(function () { if (self.root) _apply(self.root, { transform: 'translate(-' + (1.5 * it).toFixed(1) + 'px,0.5px)' }, 0); }, d * 0.45);
                setTimeout(function () { if (self.root) _apply(self.root, { transform: 'none' }, 180); }, d * 0.7);
            }

            // RGB 分离 text-shadow（整屏的字体会有故障分离）
            el.style.background = 'transparent';
            el.style.boxShadow = 'none';
            el.style.textShadow = (it * 3).toFixed(0) + 'px 0 rgba(255,0,120,0.35), -' + (it * 3).toFixed(0) + 'px 0 rgba(0,229,255,0.35), 0 0 rgba(255,255,255,0)';
            _apply(el, { opacity: '1' }, 0);

            // 随机生成水平条纹（canvas 化会太复杂，用伪条纹背景 linear-gradient 随机段）
            el.style.backgroundImage = this._makeGlitchBars(it);
            el.style.mixBlendMode = 'screen';

            if (el._glitchTimer) clearTimeout(el._glitchTimer);
            el._glitchTimer = setTimeout(function () {
                try {
                    _apply(el, { opacity: '0', backgroundImage: 'none', textShadow: 'none' }, 150);
                } catch (_) {}
                el._glitchTimer = 0;
            }, d);
        },

        _makeGlitchBars: function (it) {
            // 生成 20 条高度 2-6 的横向错位条（渐变占位模拟）
            var bars = 20;
            var h = 100; // %
            var step = h / bars;
            var stops = [];
            for (var i = 0; i < bars; i++) {
                var barH = (2 + Math.random() * 4) / (h / bars) * step * 0.5; // 0~step
                var top = i * step + Math.random() * (step - barH);
                var offset = (Math.random() * 40 - 20) * it;
                var rgba = Math.random() < 0.5
                    ? 'rgba(255,0,120,0.18)'
                    : 'rgba(0,229,255,0.18)';
                stops.push('linear-gradient(90deg, transparent 0%, rgba(0,0,0,0) calc(50% + ' + offset.toFixed(0) + 'px), ' + rgba + ' calc(50% + ' + offset.toFixed(0) + 'px), ' + rgba + ' calc(50% + ' + (offset + 40).toFixed(0) + 'px), transparent calc(50% + ' + (offset + 40).toFixed(0) + 'px + 1%) 0 ' + (top + barH).toFixed(2) + '% / 100% ' + barH.toFixed(2) + '% no-repeat');
            }
            // 简化：改用 5 条带 offset 的重复 linear-gradient（更兼容）
            var out = [];
            for (var j = 0; j < 5; j++) {
                var y = (Math.random() * 100).toFixed(2);
                var bh = (0.3 + Math.random() * 0.8).toFixed(2);
                var off = ((Math.random() * 60 - 30) * it).toFixed(0);
                var col = (j & 1) ? 'rgba(255,56,96,0.22)' : 'rgba(0,229,255,0.22)';
                out.push('linear-gradient(' + col + ',' + col + ') 0% ' + y + '% / 100% ' + bh + '% no-repeat');
                // 给一个水平位移（用 background-position 的 X）
                // 但我们用单个 el 不方便横向 shift，这里简单用一个更大的 opacity 渐变代替
                out.push('linear-gradient(90deg, transparent 0%, ' + col + ' ' + (50 + off * 0.1).toFixed(0) + '%, ' + col + ' ' + (55 + off * 0.1).toFixed(0) + '%, transparent 100%) 0% ' + (Number(y) + 1).toFixed(2) + '% / 100% ' + bh + '% no-repeat');
            }
            void stops;
            return out.join(',');
        },

        /* ==================== 暗角强度 ==================== */
        setVignette: function (i, transition) {
            var intensity = _c(Number(i), 0, 1);
            this.vignetteIntensity = intensity;
            if (!this.vignetteEl) return;
            this.vignetteEl.style.background = this._vigBg(intensity);
            _apply(this.vignetteEl, { opacity: 1 }, Number(transition) || 300);
        },

        /* ==================== 色彩滤镜 ==================== */
        setFilter: function (filter, duration) {
            var f = (filter == null) ? 'none' : String(filter);
            var d = Math.max(0, (Number(duration) || 250) | 0);
            if (!this.filterEl) return;
            _apply(this.filterEl, { filter: f, webkitFilter: f }, d);
            if (this._filterTimer) clearTimeout(this._filterTimer);
            // 不自动回退，保持住（死亡效果、结算等需要持续）
        },

        /* ==================== 慢动作 ==================== */
        slowMo: function (factor, duration) {
            var f = _c(Number(factor) || 0.4, 0.05, 1);
            var d = Math.max(50, (Number(duration) || 1200) | 0);
            // 如果 CT_ENGINE 支持 timeScale，直接改
            var E = global.CT_ENGINE;
            if (E) {
                E.timeScale = f;
            }
            // 视觉上轻微 blur 给"慢放"感
            if (this.filterEl) {
                _apply(this.filterEl, { filter: 'blur(0.7px) saturate(1.1)', webkitFilter: 'blur(0.7px) saturate(1.1)' }, 160);
            }
            var self = this;
            if (this._slowMoTimer) clearTimeout(this._slowMoTimer);
            this._slowMoTimer = setTimeout(function () {
                if (E) E.timeScale = 1;
                if (self.filterEl) _apply(self.filterEl, { filter: 'none', webkitFilter: 'none' }, 250);
                self._slowMoTimer = 0;
            }, d);
        },

        /* ==================== 传说金光炸裂 ==================== */
        legendaryBurst: function (domElement) {
            if (!domElement) return;
            var rect;
            try { rect = domElement.getBoundingClientRect(); } catch (_) { return; }
            if (!rect) return;
            var cx = rect.left + rect.width / 2;
            var cy = rect.top + rect.height / 2;

            // 1) 从该位置发射粒子
            var P = global.CT_PARTICLES;
            if (P && typeof P.emit === 'function') {
                // 需要 screenX 转 worldX：如果 CT_RENDERER 有 screenToWorld 就转
                var wx = cx, wy = cy;
                try {
                    var R = global.CT_RENDERER;
                    if (R && typeof R.screenToWorld === 'function') {
                        var p = R.screenToWorld(cx, cy);
                        wx = p.x; wy = p.y;
                    }
                } catch (_) {}
                P.emit({
                    x: wx, y: wy, count: 60,
                    colors: ['#ffd166', '#ffea00', '#ffffff', '#ff9f1c'],
                    speed: [2, 9], life: [0.5, 1.3], size: [2, 5],
                    gravity: 0, shape: 'spark', spread: Math.PI * 2
                });
                P.ripple({ x: wx, y: wy, maxR: 200, color: '#ffd166', life: 0.9, width: 3 });
                P.ripple({ x: wx, y: wy, maxR: 320, color: '#ffffff',  life: 1.2, width: 2, delay: 0.12 });
            }

            // 2) 屏幕金色白闪
            if (this.flashEl) {
                var el = this.flashEl;
                _apply(el, { opacity: 0.55, background: 'radial-gradient(circle at ' + cx + 'px ' + cy + 'px, #fff5b3 0%, #ffd166 25%, rgba(255,209,102,0.0) 70%)' }, 0);
                _raf(function () { _apply(el, { opacity: '0', background: '#ffffff' }, 360); });
            }

            // 3) 轻微 glitch
            this.glitch(220, 0.7);
            try { global.CT_AUDIO && global.CT_AUDIO.play && global.CT_AUDIO.play('skill'); } catch (_) {}
        }
    };

    global.CT_EFFECTS = CT_EFFECTS;

})(typeof window !== 'undefined' ? window : globalThis);

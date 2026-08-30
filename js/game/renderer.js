/* ==========================================================
 * CyberTank — 渲染器 renderer.js
 * 负责：
 *   - 管理 5 层 Canvas（bg/obstacle/ground/bullet/fx）
 *   - DPR 高清适配 + resize 监听
 *   - 世界/视口坐标换算
 *   - 相机（缓动追踪 + 边界夹取）
 *   - 离屏 Canvas 工厂
 * ========================================================== */
(function (global) {
    'use strict';

    /** 5 层画布的 id → 内部 key 映射 */
    const LAYER_IDS = {
        bg:       'cv-bg',
        obstacle: 'cv-obstacle',
        ground:   'cv-ground',
        bullet:   'cv-bullet',
        fx:       'cv-fx'
    };

    /**
     * @class Renderer
     * @description 全局单例渲染器（挂 window.CT_RENDERER）
     */
    class Renderer {
        constructor() {
            /** @type {Record<string, HTMLCanvasElement|null>} 各层 canvas 元素 */
            this.canvas = {
                bg:       null,
                obstacle: null,
                ground:   null,
                bullet:   null,
                fx:       null
            };
            /** @type {Record<string, CanvasRenderingContext2D|null>} 各层 2D ctx */
            this.ctx = {
                bg:       null,
                obstacle: null,
                ground:   null,
                bullet:   null,
                fx:       null
            };

            /** @type {{w:number,h:number}} CSS 像素视口大小（不含 DPR） */
            this.viewport = { w: 0, h: 0 };

            /** @type {number} devicePixelRatio 缓存 */
            this.dpr = 1;

            /**
             * 世界空间（像素）
             * 默认大地图 3200x3200，tile 尺寸 64px
             */
            this.world = {
                w: 3200,
                h: 3200,
                tile: 64
            };

            /**
             * 相机
             *   x/y : 相机左上角在世界空间中的坐标
             *   zoom: 缩放（默认 1）
             *   target: {x,y,w,h} 缓动追踪目标（通常是玩家坦克 AABB）
             */
            this.camera = {
                x: 0,
                y: 0,
                zoom: 1,
                target: null
            };

            /** @private 是否已初始化 */
            this._inited = false;
            /** @private resize throttle */
            this._resizeTimer = 0;

            /**
             * 画质档位：low / med / high
             * 影响：DPR 上限（分辨率）、辉光特效缩放 fxScale（供渲染层读取）、
             * 粒子密度（particles.js 读取 fxScale）
             */
            this.quality = 'high';
            /** 特效缩放系数：low=0（关辉光/粒子减半以下） med=0.6 high=1 */
            this.fxScale = 1;
        }

        /**
         * 设置画质档位并立即生效（modal.js 设置面板调用）
         * @param {string} lv low|med|high
         */
        setQuality(lv) {
            const q = (lv === 'low' || lv === 'med' || lv === 'high') ? lv : 'high';
            this.quality = q;
            this.fxScale = q === 'low' ? 0 : (q === 'med' ? 0.6 : 1);
            this._dprCap = q === 'low' ? 1 : (q === 'med' ? 1.5 : 3);
            this._resize();  // 立即按新 DPR 上限重建画布分辨率
            global.CT_BUS && global.CT_BUS.emit('renderer:quality', { quality: q, fxScale: this.fxScale });
            return this;
        }

        /**
         * 初始化：抓取 5 个 canvas，设置 DPR，挂 resize
         * @returns {Renderer}
         */
        init() {
            if (this._inited) return this;
            // 1. 抓 DOM
            const keys = Object.keys(LAYER_IDS);
            for (let i = 0; i < keys.length; i++) {
                const k = keys[i];
                const id = LAYER_IDS[k];
                const cv = document.getElementById(id);
                if (!cv) {
                    console.warn('[CT_RENDERER] canvas not found:', id);
                    continue;
                }
                const ctx = cv.getContext('2d', { alpha: true, desynchronized: true });
                if (!ctx) {
                    console.warn('[CT_RENDERER] getContext 2d failed:', id);
                    continue;
                }
                this.canvas[k] = cv;
                this.ctx[k] = ctx;
            }

            // 2. 应用 DPR + 尺寸
            this._resize();

            // 3. 监听 resize（节流 150ms）
            window.addEventListener('resize', () => {
                if (this._resizeTimer) clearTimeout(this._resizeTimer);
                this._resizeTimer = setTimeout(() => this._resize(), 150);
            });

            // 4. 相机初始化在世界中央偏左上
            this._initCamera();

            this._inited = true;
            global.CT_BUS && global.CT_BUS.emit('renderer:ready');
            return this;
        }

        /**
         * 读取某层 ctx（供外部使用）
         * @param {'bg'|'obstacle'|'ground'|'bullet'|'fx'} layer
         * @returns {CanvasRenderingContext2D|null}
         */
        getCtx(layer) {
            return this.ctx[layer] || null;
        }

        /**
         * 全部 5 层清屏（一般主循环会分别清屏，这里保留整屏清）
         */
        clearAll() {
            const keys = Object.keys(this.canvas);
            for (let i = 0; i < keys.length; i++) {
                const ctx = this.ctx[keys[i]];
                if (ctx) ctx.clearRect(0, 0, this.viewport.w, this.viewport.h);
            }
        }

        /**
         * 创建离屏 Canvas（辅助函数，给地图缓存 / 粒子纹理用）
         * @param {number} w 宽（CSS 像素）
         * @param {number} h 高（CSS 像素）
         * @returns {HTMLCanvasElement}
         */
        createOffscreen(w, h) {
            const cv = document.createElement('canvas');
            cv.width = Math.max(1, Math.floor(w * this.dpr));
            cv.height = Math.max(1, Math.floor(h * this.dpr));
            cv.style.width = Math.floor(w) + 'px';
            cv.style.height = Math.floor(h) + 'px';
            const c = cv.getContext('2d');
            c.scale(this.dpr, this.dpr);
            return cv;
        }

        /**
         * 世界坐标 → 屏幕坐标（CSS 像素，相对 viewport 左上角）
         * @param {number} wx 世界 x
         * @param {number} wy 世界 y
         * @returns {{x:number, y:number}}
         */
        worldToScreen(wx, wy) {
            const z = this.camera.zoom;
            const vx = (wx - this.camera.x) * z;
            const vy = (wy - this.camera.y) * z;
            return { x: vx, y: vy };
        }

        /**
         * 屏幕坐标 → 世界坐标
         * @param {number} sx 屏幕 CSS x（相对 viewport）
         * @param {number} sy 屏幕 CSS y
         * @returns {{x:number, y:number}}
         */
        screenToWorld(sx, sy) {
            const z = this.camera.zoom || 1;
            const wx = sx / z + this.camera.x;
            const wy = sy / z + this.camera.y;
            return { x: wx, y: wy };
        }

        /**
         * 更新相机：target 存在则缓动追踪（lerp 0.12），并夹边界
         * 通常被 CT_ENGINE 的 update 监听器调用
         * @param {number} dt ms
         */
        updateCamera(dt) {
            const target = this.camera.target;
            if (target) {
                // 目标中心
                const cx = (target.x != null)
                    ? (target.w != null ? target.x + target.w / 2 : target.x)
                    : null;
                const cy = (target.y != null)
                    ? (target.h != null ? target.y + target.h / 2 : target.y)
                    : null;
                if (cx != null && cy != null) {
                    // 希望相机左上角（使目标中心落在屏幕中心）
                    const desiredX = cx - this.viewport.w / 2 / this.camera.zoom;
                    const desiredY = cy - this.viewport.h / 2 / this.camera.zoom;

                    // lerp 0.12（基于 dt 的时间归一化，30fps ≈ 16.6ms 作为基准）
                    const base = 16.666;
                    const t = Math.min(1, 1 - Math.pow(1 - 0.12, dt / base));
                    this.camera.x += (desiredX - this.camera.x) * t;
                    this.camera.y += (desiredY - this.camera.y) * t;
                }
            }
            // 夹相机到世界边界（保证不超出）
            this._clampCamera();
        }

        /**
         * 视野自适应：缩放到整个世界可见，相机锁定世界中心（不再追踪目标）
         * @returns {Renderer}
         */
        fitWorldToView() {
            const z = Math.min(this.viewport.w / this.world.w, this.viewport.h / this.world.h) * 0.98;
            this.camera.zoom = Math.max(0.05, z);
            this.camera.target = null;
            // 世界小于视口时差值为负 → 居中需要允许负相机坐标
            this.camera.x = (this.world.w - this.viewport.w / this.camera.zoom) / 2;
            this.camera.y = (this.world.h - this.viewport.h / this.camera.zoom) / 2;
            this._clampCamera();
            return this;
        }

        // ==================== 私有方法 ====================

        /**
         * @private 初始化相机位置（根据 world + viewport）
         */
        _initCamera() {
            this._clampCamera();
        }

        /**
         * @private 把相机夹取到 [0, world - viewport/zoom]；
         * 世界小于视口时（max<0）居中显示（允许负坐标），否则地图贴左上角
         */
        _clampCamera() {
            const z = Math.max(0.01, this.camera.zoom);
            const maxX = this.world.w - this.viewport.w / z;
            const maxY = this.world.h - this.viewport.h / z;
            if (maxX < 0) {
                this.camera.x = maxX / 2;   // 视口比世界宽 → 水平居中
            } else {
                if (this.camera.x < 0) this.camera.x = 0;
                if (this.camera.x > maxX) this.camera.x = maxX;
            }
            if (maxY < 0) {
                this.camera.y = maxY / 2;   // 视口比世界高 → 垂直居中
            } else {
                if (this.camera.y < 0) this.camera.y = 0;
                if (this.camera.y > maxY) this.camera.y = maxY;
            }
        }

        /**
         * @private 处理 DPR + viewport 尺寸
         */
        _resize() {
            const w = Math.max(1, window.innerWidth);
            const h = Math.max(1, window.innerHeight);
            this.viewport.w = w;
            this.viewport.h = h;
            /* DPR 上限受画质档位控制（low=1 / med=1.5 / high=3）：
             * 档位越低画布分辨率越低 → 渲染越"糊"，性能开销越小 */
            const cap = this._dprCap || 3;
            this.dpr = Math.min(cap, window.devicePixelRatio || 1);

            const keys = Object.keys(this.canvas);
            for (let i = 0; i < keys.length; i++) {
                const k = keys[i];
                const cv = this.canvas[k];
                if (!cv) continue;
                // 设置 CSS 大小
                cv.style.width = w + 'px';
                cv.style.height = h + 'px';
                // 设置实际像素
                cv.width = Math.floor(w * this.dpr);
                cv.height = Math.floor(h * this.dpr);
                // ctx 重置
                const c = this.ctx[k];
                if (c) {
                    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
                    c.imageSmoothingEnabled = true;
                    c.imageSmoothingQuality = 'high';
                }
            }
            // 调整相机边界
            this._clampCamera();
            global.CT_BUS && global.CT_BUS.emit('renderer:resize', { w, h, dpr: this.dpr });
        }
    }

    /* ==========================================================
     * 单例挂载（兼容重复执行：已存在则复用）
     * ========================================================== */
    if (!global.CT_RENDERER) global.CT_RENDERER = new Renderer();

})(typeof window !== 'undefined' ? window : globalThis);

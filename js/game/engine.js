/* ==========================================================
 * CyberTank — 核心引擎 engine.js
 * 统一命名空间 window.CT_* （CyberTank 前缀）
 * 包含：
 *   CT_BUS    — 事件总线（on/once/off/emit，支持通配符 *）
 *   CT_ENGINE — 固定步长主循环 + 对象池 ObjectPool
 * ========================================================== */
(function (global) {
    'use strict';

    /* ==========================================================
     * 1. EventBus 事件总线（支持通配符 * 监听）
     * ========================================================== */
    /**
     * @class EventBus
     * @description 轻量事件总线，支持多监听器、once、通配符 "*"
     */
    class EventBus {
        constructor() {
            /** @type {Map<string, Array<{fn:Function, once:boolean}>>} 事件映射 */
            this._listeners = new Map();
        }

        /**
         * 注册事件监听
         * @param {string} event 事件名，使用 '*' 监听所有事件
         * @param {Function} fn 回调函数，参数 (...args)
         * @returns {EventBus} 链式调用
         */
        on(event, fn) {
            if (!this._listeners.has(event)) this._listeners.set(event, []);
            this._listeners.get(event).push({ fn, once: false });
            return this;
        }

        /**
         * 注册一次性监听（触发后自动移除）
         * @param {string} event 事件名
         * @param {Function} fn 回调函数
         * @returns {EventBus}
         */
        once(event, fn) {
            if (!this._listeners.has(event)) this._listeners.set(event, []);
            this._listeners.get(event).push({ fn, once: true });
            return this;
        }

        /**
         * 移除监听
         * @param {string} event 事件名
         * @param {Function} [fn] 可选；不传则移除该事件所有监听
         * @returns {EventBus}
         */
        off(event, fn) {
            const arr = this._listeners.get(event);
            if (!arr) return this;
            if (typeof fn !== 'function') {
                this._listeners.delete(event);
                return this;
            }
            for (let i = arr.length - 1; i >= 0; i--) {
                if (arr[i].fn === fn) arr.splice(i, 1);
            }
            if (arr.length === 0) this._listeners.delete(event);
            return this;
        }

        /**
         * 触发事件
         * @param {string} event 事件名
         * @param  {...any} args 任意参数
         */
        emit(event, ...args) {
            // 先精确匹配
            const arr = this._listeners.get(event);
            if (arr) this._dispatch(arr, event, args);
            // 再通配符 "*" 匹配（给监听所有事件用）
            const all = this._listeners.get('*');
            if (all) this._dispatch(all, event, args);
        }

        /**
         * 内部：分发事件并清理 once 监听
         * @private
         */
        _dispatch(arr, event, args) {
            // 复制数组，防止回调过程中 off 导致错乱
            const snapshot = arr.slice();
            for (let i = 0; i < snapshot.length; i++) {
                const item = snapshot[i];
                try {
                    if (event === '*') item.fn(...args);        // * 监听：fn(eventName, ...args)
                    else item.fn(...args);
                } catch (e) {
                    console.error('[CT_BUS] listener error:', event, e);
                }
                if (item.once) this.off(event === '*' ? '*' : event, item.fn);
            }
        }

        /**
         * 清空所有监听（调试/重置用）
         */
        clear() { this._listeners.clear(); }
    }

    /* ==========================================================
     * 2. 对象池 ObjectPool（给子弹/粒子等高频对象复用，减少 GC）
     * ========================================================== */
    /**
     * @class ObjectPool
     * @template T
     * @description 通用对象池：create/acquire/release/watermark
     */
    class ObjectPool {
        /**
         * @param {()=>T} factory 工厂函数：创建一个新的空对象
         * @param {(obj:T)=>void} [resetFn] 重置函数（acquire 前调用，可选）
         * @param {number} [initialSize=0] 初始预分配数量
         */
        constructor(factory, resetFn, initialSize = 0) {
            if (typeof factory !== 'function') throw new Error('[ObjectPool] factory required');
            this._factory = factory;
            this._resetFn = resetFn || null;
            this._pool = [];
            this._created = 0;
            this._watermark = 0;

            // 预分配
            for (let i = 0; i < initialSize; i++) {
                this._pool.push(this._create());
            }
        }

        /** @private 创建新对象 */
        _create() {
            const obj = this._factory();
            this._created++;
            return obj;
        }

        /**
         * 获取一个可用对象（有 resetFn 会先重置）
         * @returns {T}
         */
        acquire() {
            const obj = this._pool.length > 0 ? this._pool.pop() : this._create();
            if (this._resetFn) this._resetFn(obj);
            const inUse = this._created - this._pool.length;
            if (inUse > this._watermark) this._watermark = inUse;
            return obj;
        }

        /**
         * 归还一个对象
         * @param {T} obj
         */
        release(obj) {
            if (obj == null) return;
            this._pool.push(obj);
        }

        /**
         * 一次性批量创建（预热池）
         * @param {number} n 数量
         */
        create(n) {
            for (let i = 0; i < n; i++) this._pool.push(this._create());
        }

        /**
         * 读取使用峰值（调试用）
         * @returns {number}
         */
        watermark() { return this._watermark; }

        /**
         * 当前统计
         * @returns {{created:number, inPool:number, watermark:number}}
         */
        stats() {
            return {
                created: this._created,
                inPool: this._pool.length,
                watermark: this._watermark
            };
        }
    }

    /* ==========================================================
     * 3. 主引擎 CT_ENGINE（固定步长循环 + 状态机 + 注册器）
     * ========================================================== */
    const CT_ENGINE = {
        /** 当前状态：MENU | LOADING | PREPARING | COMBAT | BUFF_SELECT | PAUSED | GAMEOVER */
        state: 'MENU',

        /** 固定步长（毫秒）：1000/60 ≈ 16.666ms */
        fixedDt: 1000 / 60,

        /** 累加器（用于固定步长解耦） */
        accumulator: 0,

        /** 上一帧时间戳 */
        lastTime: 0,

        /** 累计帧数（用于性能统计） */
        frames: 0,

        /** 运行统计 */
        stats: {
            fps: 60,
            avgFps: 60,
            entities: 0,
            bullets: 0,
            particles: 0
        },

        /** @private raf id */
        _rafId: 0,

        /** @private 是否运行中 */
        _running: false,

        /** 是否暂停（true 时冻结固定步长 update，保留渲染） */
        paused: false,

        /** @private 暂停前的状态（恢复时还原） */
        _stateBeforePause: null,

        /** @private 帧累计（算 FPS 用） */
        _fpsFrames: 0,
        _fpsLastCheck: 0,

        /**
         * 切换状态（触发 state:change 事件）
         * @param {'MENU'|'LOADING'|'PREPARING'|'COMBAT'|'BUFF_SELECT'|'PAUSED'|'GAMEOVER'} s
         */
        setState(s) {
            const prev = this.state;
            this.state = s;
            try { global.CT_BUS && global.CT_BUS.emit('state:change', s, prev); }
            catch (e) { console.error('[CT_ENGINE.setState]', e); }
        },

        /**
         * 切换暂停（ESC / P 触发）：
         *   暂停 → state='PAUSED'，冻结 update（渲染继续，画面保留）
         *   恢复 → 还原暂停前状态
         */
        togglePause() {
            if (this.paused) {
                this.paused = false;
                this.setState(this._stateBeforePause || 'COMBAT');
            } else {
                this._stateBeforePause = this.state;
                this.paused = true;
                this.setState('PAUSED');
            }
            global.CT_BUS && global.CT_BUS.emit('engine:pause', this.paused);
            return this.paused;
        },

        /**
         * 更新注册器（按 priority 升序执行，数字越小越先）
         * @private
         * @type {Array<{fn:Function, priority:number}>}
         */
        _updateListeners: [],

        /**
         * 渲染注册器（按 layer 分组：bg / obstacle / ground / bullet / fx）
         * @private
         * @type {Object<string, Array<Function>>}
         */
        _renderListeners: {
            bg: [], obstacle: [], ground: [], bullet: [], fx: []
        },

        /**
         * 注册 update 监听器
         * @param {(dt:number)=>void} fn 每固定步长执行的回调，dt = fixedDt(ms)
         * @param {number} [priority=100] 优先级，数字越小越先执行
         */
        registerUpdate(fn, priority = 100) {
            if (typeof fn !== 'function') return;
            this._updateListeners.push({ fn, priority });
            this._updateListeners.sort((a, b) => a.priority - b.priority);
        },

        /**
         * 注销 update 监听器
         * @param {Function} fn
         */
        unregisterUpdate(fn) {
            const arr = this._updateListeners;
            for (let i = arr.length - 1; i >= 0; i--) if (arr[i].fn === fn) arr.splice(i, 1);
        },

        /**
         * 注册 render 监听器
         * @param {(ctx:CanvasRenderingContext2D, alpha:number)=>void} fn 渲染回调
         * @param {'bg'|'obstacle'|'ground'|'bullet'|'fx'} [layer='fx'] 渲染层
         */
        registerRender(fn, layer = 'fx') {
            if (typeof fn !== 'function') return;
            if (!this._renderListeners[layer]) this._renderListeners[layer] = [];
            this._renderListeners[layer].push(fn);
        },

        /**
         * 注销 render 监听器
         * @param {Function} fn
         * @param {string} [layer] 可选；不传则从所有层里找
         */
        unregisterRender(fn, layer) {
            const layers = layer ? [layer] : Object.keys(this._renderListeners);
            for (let i = 0; i < layers.length; i++) {
                const arr = this._renderListeners[layers[i]];
                if (!arr) continue;
                for (let j = arr.length - 1; j >= 0; j--) if (arr[j] === fn) arr.splice(j, 1);
            }
        },

        /**
         * 启动主循环（幂等：已启动不重复启动）
         */
        start() {
            if (this._running) return;
            this._running = true;
            this.lastTime = performance.now();
            this._fpsLastCheck = this.lastTime;
            this._fpsFrames = 0;
            const loop = (t) => this._loop(t);
            this._rafId = requestAnimationFrame(loop);
            global.CT_BUS && global.CT_BUS.emit('engine:start');
        },

        /**
         * 停止主循环（幂等）
         */
        stop() {
            this._running = false;
            if (this._rafId) cancelAnimationFrame(this._rafId);
            this._rafId = 0;
            global.CT_BUS && global.CT_BUS.emit('engine:stop');
        },

        /**
         * 主循环：固定步长 update + 可变步长 render（带 alpha 插值）
         * @private
         * @param {DOMHighResTimeStamp} t 时间戳
         */
        _loop(t) {
            if (!this._running) return;
            // 计算帧间隔
            let frameTime = t - this.lastTime;
            this.lastTime = t;
            // 防止长时间卡顿（如切后台回来），限制上限一帧最多补 250ms，避免物理穿透
            if (frameTime > 250) frameTime = 250;

            // ------- 统计 FPS（每秒刷新一次） -------
            this._fpsFrames++;
            this.frames++;
            if (t - this._fpsLastCheck >= 1000) {
                this.stats.fps = Math.round(this._fpsFrames * 1000 / (t - this._fpsLastCheck));
                // 指数加权平均 FPS
                this.stats.avgFps = Math.round(this.stats.avgFps * 0.85 + this.stats.fps * 0.15);
                this._fpsFrames = 0;
                this._fpsLastCheck = t;
            }

            // ------- 固定步长 update（解耦渲染；暂停时冻结） -------
            const dt = this.fixedDt;
            let steps = 0;
            if (!this.paused) {
                this.accumulator += frameTime;
                const MAX_STEPS = 5; // 最多 5 步，防止死亡螺旋
                while (this.accumulator >= dt && steps < MAX_STEPS) {
                    try {
                        this._doUpdate(dt);
                        global.CT_BUS && global.CT_BUS.emit('frame:update', dt);
                    } catch (e) {
                        console.error('[CT_ENGINE._doUpdate]', e);
                    }
                    this.accumulator -= dt;
                    steps++;
                }
                // 如果 MAX_STEPS 还不够，说明跟不上了，丢掉剩余（避免持续 spiral）
                if (steps === MAX_STEPS) this.accumulator = 0;
            } else {
                this.accumulator = 0; // 暂停时不积累时间，恢复瞬间不补帧
            }

            // ------- render（alpha = 累加器比例，用于插值；暂停时保持最后画面） -------
            const alpha = this.paused ? 1 : (this.accumulator / dt); // [0, 1)
            try {
                this._doRender(alpha);
                global.CT_BUS && global.CT_BUS.emit('frame:render', alpha);
            } catch (e) {
                console.error('[CT_ENGINE._doRender]', e);
            }

            // 下一帧
            this._rafId = requestAnimationFrame((tt) => this._loop(tt));
        },

        /**
         * @private 执行 update 监听器（按 priority 顺序）
         * @param {number} dt 毫秒
         */
        _doUpdate(dt) {
            const arr = this._updateListeners;
            for (let i = 0; i < arr.length; i++) {
                try { arr[i].fn(dt); }
                catch (e) { console.error('[CT_ENGINE.update callback]', e); }
            }
        },

        /**
         * @private 执行 render 监听器（按 layer 顺序）
         * @param {number} alpha
         */
        _doRender(alpha) {
            const R = global.CT_RENDERER;
            if (!R) return;
            const layers = ['bg', 'obstacle', 'ground', 'bullet', 'fx'];
            for (let i = 0; i < layers.length; i++) {
                const layer = layers[i];
                const ctx = R.getCtx(layer);
                if (!ctx) continue;
                // 每个 layer 渲染前单独清屏（子系统自绘）
                ctx.clearRect(0, 0, R.viewport.w, R.viewport.h);
                const arr = this._renderListeners[layer];
                if (!arr) continue;
                for (let j = 0; j < arr.length; j++) {
                    try { arr[j](ctx, alpha); }
                    catch (e) { console.error('[CT_ENGINE.render callback] layer=' + layer, e); }
                }
            }
        },

        /** 暴露 ObjectPool 类，供后续 Task 用 */
        ObjectPool: ObjectPool
    };

    /* ==========================================================
     * 挂载到全局命名空间
     * ========================================================== */
    global.CT_BUS = global.CT_BUS || new EventBus();
    global.CT_ENGINE = CT_ENGINE;

})(typeof window !== 'undefined' ? window : globalThis);

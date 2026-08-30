/* ==========================================================
 * CyberTank — 启动入口 main.js
 * 暴露 window.GameBootstrap 作为 DOMContentLoaded 触发的启动函数。
 * 职责：
 *   1. 容错加载各 util 模块默认值
 *   2. 初始化 CT_RENDERER / CT_AUDIO
 *   3. 依次调用各子模块 .init()（全部可选链容错，不存在不报错）
 *   4. 启动 CT_ENGINE 主循环
 *   5. 绑定全局输入 CT_INPUT（键盘 / 鼠标 / pointerlock 预留）
 *   6. 首屏切 MENU 态 + 派发 ui:showMainMenu
 *   7. 全局 window.onerror → #toast-root 黄色提示
 * ========================================================== */
(function (global) {
    'use strict';

    /** 标识已执行过 Bootstrap（防止重复调用） */
    let booted = false;

    /* ==========================================================
     * Toast 小工具（独立：不依赖任何 ui 模块，保证错误能显示）
     * ========================================================== */
    function toastMsg(message, level) {
        const root = document.getElementById('toast-root');
        if (!root) return;
        const lv = level || 'info';  // info / warn / error
        const el = document.createElement('div');
        // 玻璃态卡片 + 左侧色条
        const colorMap = {
            info:  { bg: 'rgba(12,18,40,0.85)', bar: '#00e5ff',  text: '#eef5ff' },
            warn:  { bg: 'rgba(40,28,8,0.88)',  bar: '#ffc93c',  text: '#fff1c4' },
            error: { bg: 'rgba(40,10,16,0.90)', bar: '#ff3860',  text: '#ffd4dc' }
        };
        const c = colorMap[lv] || colorMap.info;
        el.setAttribute('role', 'status');
        el.style.cssText = [
            'position:relative',
            'padding:10px 14px 10px 18px',
            'border-radius:10px',
            'background:' + c.bg,
            'color:' + c.text,
            'font-family:Plus Jakarta Sans, PingFang SC, system-ui, sans-serif',
            'font-size:13px',
            'line-height:1.45',
            'box-shadow:0 8px 24px rgba(0,0,0,0.45)',
            'backdrop-filter:blur(8px)',
            '-webkit-backdrop-filter:blur(8px)',
            'border:1px solid rgba(255,255,255,0.08)',
            'word-break:break-word',
            'pointer-events:auto',
            'cursor:pointer',
            'animation:toastIn 0.28s cubic-bezier(0.34,1.56,0.64,1) both'
        ].join(';');
        // 左侧色条
        const bar = document.createElement('i');
        bar.style.cssText = [
            'position:absolute;left:0;top:8px;bottom:8px;width:3px;border-radius:3px',
            'background:' + c.bar,
            'box-shadow:0 0 8px ' + c.bar
        ].join(';');
        el.appendChild(bar);
        // 文本
        const span = document.createElement('span');
        span.textContent = String(message).slice(0, 200);
        el.appendChild(span);

        el.addEventListener('click', () => removeToast(el));
        root.appendChild(el);

        // 3.5s 自动消失
        const autoRemove = setTimeout(() => removeToast(el), 3500);
        el._autoRemove = autoRemove;

        function removeToast(node) {
            if (!node || !node.parentNode) return;
            clearTimeout(node._autoRemove);
            node.style.transition = 'opacity 220ms ease, transform 220ms ease';
            node.style.opacity = '0';
            node.style.transform = 'translateY(-4px) scale(0.97)';
            setTimeout(() => node.parentNode && node.parentNode.removeChild(node), 240);
        }
    }

    /* ==========================================================
     * 关键帧注入（toastIn 动画，保证 style.css 没加载也不崩）
     * ========================================================== */
    (function injectToastAnim() {
        try {
            const id = 'ct-toast-anim';
            if (document.getElementById(id)) return;
            const style = document.createElement('style');
            style.id = id;
            style.textContent =
                '@keyframes toastIn{' +
                '0%{transform:translateX(16px) scale(0.94);opacity:0}' +
                '100%{transform:none;opacity:1}' +
                '}';
            document.head.appendChild(style);
        } catch (e) { /* 静默失败 */ }
    })();

    /* ==========================================================
     * CT_INPUT 全局输入（键盘 / 鼠标 / pointer lock 预留）
     * ========================================================== */
    function setupInput() {
        if (global.CT_INPUT) return;
        const INPUT = {
            /** @type {Set<string>} 按下的 key（统一小写） */
            keys: new Set(),
            /** 鼠标状态 */
            mouse: {
                x: 0,           // CSS 视口 x
                y: 0,           // CSS 视口 y
                worldX: 0,      // 世界坐标（如 CT_RENDERER 可用则同步）
                worldY: 0,
                down: false,    // 左键
                rdown: false,   // 右键
                mdown: false    // 中键
            },
            /** pointer lock 是否已获得 */
            pointerLocked: false,
            /**
             * 判断某键是否按下（支持别名："w" / "W" / "arrowup" / "space"）
             * @param {string|Array<string>} k
             */
            isDown(k) {
                if (Array.isArray(k)) {
                    for (let i = 0; i < k.length; i++) if (this.keys.has(String(k[i]).toLowerCase())) return true;
                    return false;
                }
                return this.keys.has(String(k).toLowerCase());
            },
            /**
             * 生成 Tank.update 所需的输入快照对象。
             * 映射：WASD/方向键移动 · 空格/J/鼠标左键射击 · E/K 技能 · 1~5 使用道具
             * 炮塔默认瞄准鼠标世界坐标。
             * @returns {{up:boolean,down:boolean,left:boolean,right:boolean,shoot:boolean,skill:boolean,turretWorldPoint:{x:number,y:number}|null}}
             */
            snapshot() {
                const k = this.keys;
                const obj = {
                    /* directMove: 玩家采用平移式控制 —— W/S/A/D 分别对应世界方向 上/下/左/右 */
                    directMove: true,
                    up:    k.has('w') || k.has('arrowup'),
                    down:  k.has('s') || k.has('arrowdown'),
                    left:  k.has('a') || k.has('arrowleft'),
                    right: k.has('d') || k.has('arrowright'),
                    shoot: !!this.mouse.down || k.has('space') || k.has('j'),
                    skill: k.has('e') || k.has('k') || !!this.mouse.rdown,
                    turretWorldPoint: null
                };
                if (this.mouse.worldX || this.mouse.worldY) {
                    obj.turretWorldPoint = { x: this.mouse.worldX, y: this.mouse.worldY };
                }
                for (let s = 1; s <= 5; s++) {
                    if (k.has(String(s))) obj['useItemSlot' + s] = true;
                }
                return obj;
            }
        };
        global.CT_INPUT = INPUT;

        // 键盘：keydown / keyup
        const keyHandler = (down) => (ev) => {
            if (!ev || !ev.key) return;
            // 统一成小写 + 几个常见别名规范化
            let k = String(ev.key).toLowerCase();
            if (k === ' ') k = 'space';
            if (k === 'escape') k = 'esc';
            if (k === 'arrowup')   k = 'arrowup';
            if (k === 'arrowdown') k = 'arrowdown';
            if (k === 'arrowleft') k = 'arrowleft';
            if (k === 'arrowright')k = 'arrowright';
            if (down) INPUT.keys.add(k);
            else INPUT.keys.delete(k);
            global.CT_BUS && global.CT_BUS.emit(down ? 'input:keydown' : 'input:keyup', { key: k, raw: ev });
        };
        window.addEventListener('keydown', keyHandler(true), false);
        window.addEventListener('keyup',   keyHandler(false), false);

        // 鼠标：mousemove / mousedown / mouseup / contextmenu 阻止
        window.addEventListener('mousemove', (ev) => {
            INPUT.mouse.x = ev.clientX;
            INPUT.mouse.y = ev.clientY;
            if (global.CT_RENDERER) {
                const w = global.CT_RENDERER.screenToWorld(ev.clientX, ev.clientY);
                INPUT.mouse.worldX = w.x;
                INPUT.mouse.worldY = w.y;
            }
            global.CT_BUS && global.CT_BUS.emit('input:mousemove', { x: ev.clientX, y: ev.clientY, worldX: INPUT.mouse.worldX, worldY: INPUT.mouse.worldY });
        }, false);

        window.addEventListener('mousedown', (ev) => {
            if (ev.button === 0) INPUT.mouse.down  = true;
            if (ev.button === 1) INPUT.mouse.mdown = true;
            if (ev.button === 2) INPUT.mouse.rdown = true;
            global.CT_BUS && global.CT_BUS.emit('input:mousedown', { button: ev.button });
        }, false);

        window.addEventListener('mouseup', (ev) => {
            if (ev.button === 0) INPUT.mouse.down  = false;
            if (ev.button === 1) INPUT.mouse.mdown = false;
            if (ev.button === 2) INPUT.mouse.rdown = false;
            global.CT_BUS && global.CT_BUS.emit('input:mouseup', { button: ev.button });
        }, false);

        // 屏蔽右键菜单（战斗中更自然，UI 层可以自己放开）
        window.addEventListener('contextmenu', (ev) => {
            // 如果目标是 #hud-layer 内部的可交互元素，允许菜单（简单判断 class 包含 pointer-events-auto）
            let n = ev.target;
            while (n && n !== document.body) {
                if (n.classList && n.classList.contains('pointer-events-auto')) return;
                n = n.parentNode;
            }
            ev.preventDefault();
        }, false);

        // Pointer lock 预留：request / release / change 监听
        document.addEventListener('pointerlockchange', () => {
            INPUT.pointerLocked = (document.pointerLockElement != null);
            global.CT_BUS && global.CT_BUS.emit('input:pointerlock', { locked: INPUT.pointerLocked });
        }, false);

        /* ==========================================================
         * 暂停控制：ESC / P 切换（与设置面板键位说明一致）
         * 仅在战斗相关状态生效；暂停时引擎冻结 update、保留渲染
         * ========================================================== */
        let _pauseOverlay = null;
        /**
         * 退出当前对局并返回主菜单（全局共用，暴露为 CT_EXIT_TO_MENU）：
         * 1. 解除暂停 2. 停止所有运行中的模式 3. 取消备战期
         * 4. 清空引擎对局状态 5. 隐藏 HUD/商店/结算等 UI 6. 显示主菜单
         */
        function exitToMainMenu() {
            const ENG = global.CT_ENGINE;
            // 1. 解除暂停（不触发遮罩切换逻辑，直接复位）
            if (ENG) {
                ENG.paused = false;
                ENG._stateBeforePause = null;
            }
            if (_pauseOverlay) _pauseOverlay.style.display = 'none';
            // 2. 停止所有模式（无条件调用：_gameOver 后 running=false 但 tick/绑定仍残留，
            //    各模式 stop() 幂等，重复调用安全）
            ['CT_MODE_BR', 'CT_MODE_KH', 'CT_MODE_HORDE', 'CT_MODE_DUEL', 'CT_MODE_KINGDEFEND'].forEach((k) => {
                const m = global[k];
                if (m && typeof m.stop === 'function') {
                    try { m.stop(); } catch (e) { console.warn('[exitToMenu] stop ' + k, e); }
                }
            });
            // 3. 取消备战期 / 商店
            try { if (global.CT_PREP && typeof global.CT_PREP.cancel === 'function') global.CT_PREP.cancel(true); } catch (e) {}
            try { if (global.CT_SHOP && typeof global.CT_SHOP.lock === 'function') global.CT_SHOP.lock(); } catch (e) {}
            // 4. 清空对局状态
            try {
                if (ENG) {
                    ENG.gameState = null;
                    if (typeof ENG.setState === 'function') ENG.setState('MENU');
                }
            } catch (e) {}
            // 5. 隐藏战斗相关 UI
            const hud = document.getElementById('game-hud-wrap');
            if (hud) hud.classList.add('hidden');
            try { if (global.CT_UI_SHOP && typeof global.CT_UI_SHOP.hide === 'function') global.CT_UI_SHOP.hide(); } catch (e) {}
            try { if (global.CT_UI_RESULT && typeof global.CT_UI_RESULT.close === 'function') global.CT_UI_RESULT.close(); } catch (e) {}
            const shopRoot = document.getElementById('shop-ui-root');
            if (shopRoot) shopRoot.classList.add('hidden');
            const resRoot = document.getElementById('result-ui-root');
            if (resRoot) resRoot.classList.add('hidden');
            const prepRoot = document.getElementById('prep-ui-root');
            if (prepRoot) prepRoot.classList.add('hidden');
            // 6. 显示主菜单
            if (global.CT_UI_MENU && typeof global.CT_UI_MENU.renderMainMenu === 'function') {
                global.CT_UI_MENU.renderMainMenu();
            } else {
                const menu = document.getElementById('main-menu-wrap');
                if (menu) menu.classList.remove('hidden');
            }
            global.CT_BUS && global.CT_BUS.emit('game:exitToMenu', {});
        }
        global.CT_EXIT_TO_MENU = exitToMainMenu;
        function ensurePauseOverlay() {
            if (_pauseOverlay && _pauseOverlay.parentNode) return _pauseOverlay;
            _pauseOverlay = document.createElement('div');
            _pauseOverlay.id = 'ct-pause-overlay';
            _pauseOverlay.style.cssText = [
                'position:fixed', 'inset:0', 'z-index:1500',
                'display:none', 'align-items:center', 'justify-content:center',
                'background:rgba(2,4,12,0.55)', 'backdrop-filter:blur(6px)',
                '-webkit-backdrop-filter:blur(6px)', 'pointer-events:none'
            ].join(';');
            const card = document.createElement('div');
            card.style.cssText = [
                'padding:28px 56px', 'border-radius:16px',
                'background:rgba(10,16,36,0.85)',
                'border:1px solid rgba(0,229,255,0.45)',
                'box-shadow:0 0 32px rgba(0,229,255,0.35)',
                'font-family:Share Tech Mono,monospace', 'text-align:center',
                'pointer-events:auto' /* 遮罩层 none，卡片本身可点击 */
            ].join(';');
            card.innerHTML =
                '<div style="font-size:44px;filter:drop-shadow(0 0 12px rgba(0,229,255,.8))">⏸</div>' +
                '<div style="font-size:26px;letter-spacing:.3em;color:#00e5ff;text-shadow:0 0 10px rgba(0,229,255,.8);margin-top:8px">已 暂 停</div>' +
                '<div style="font-size:13px;color:#a9b7d1;margin-top:14px;font-family:JetBrains Mono,monospace">按 <b style="color:#00e5ff">ESC</b> / <b style="color:#00e5ff">P</b> 继续战斗</div>';
            /* 操作按钮：继续战斗 / 返回主页 */
            const btnRow = document.createElement('div');
            btnRow.style.cssText = 'display:flex;gap:14px;justify-content:center;margin-top:22px';
            const mkBtn = (txt, primary) => {
                const b = document.createElement('button');
                b.textContent = txt;
                b.style.cssText = [
                    'padding:10px 26px', 'min-height:40px', 'border-radius:8px', 'cursor:pointer',
                    'font-family:Share Tech Mono,monospace', 'font-size:14px', 'letter-spacing:.1em',
                    primary
                        ? 'background:linear-gradient(135deg,rgba(0,229,255,.22),rgba(0,229,255,.08));border:1px solid #00e5ff;color:#bff5ff'
                        : 'background:transparent;border:1px solid rgba(169,183,209,.4);color:#a9b7d1'
                ].join(';');
                return b;
            };
            const resumeBtn = mkBtn('▶ 继续战斗', true);
            resumeBtn.addEventListener('click', togglePause);
            const homeBtn = mkBtn('🏠 返回主页', false);
            homeBtn.addEventListener('mouseenter', () => { homeBtn.style.borderColor = '#ff2bd6'; homeBtn.style.color = '#ffb7ef'; });
            homeBtn.addEventListener('mouseleave', () => { homeBtn.style.borderColor = 'rgba(169,183,209,.4)'; homeBtn.style.color = '#a9b7d1'; });
            homeBtn.addEventListener('click', exitToMainMenu);
            btnRow.appendChild(resumeBtn);
            btnRow.appendChild(homeBtn);
            card.appendChild(btnRow);
            _pauseOverlay.appendChild(card);
            document.body.appendChild(_pauseOverlay);
            return _pauseOverlay;
        }
        function togglePause() {
            const ENG = global.CT_ENGINE;
            if (!ENG || typeof ENG.togglePause !== 'function') return;
            const inGame = ['PREPARING', 'COMBAT', 'BUFF_SELECT', 'PAUSED'].indexOf(ENG.state) >= 0;
            if (!inGame) return;
            ENG.togglePause();
            const ov = ensurePauseOverlay();
            ov.style.display = ENG.paused ? 'flex' : 'none';
        }
        window.addEventListener('keydown', (ev) => {
            if (!ev || !ev.key) return;
            const k = String(ev.key).toLowerCase();
            if (k === 'escape' || k === 'esc' || k === 'p') {
                // 输入框内不劫持
                const t = ev.target;
                if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
                togglePause();
            }
        }, false);
    }

    /* ==========================================================
     * 全局错误捕获 → toast-root（黄色提示）
     * ========================================================== */
    function setupErrorCatch() {
        if (global._ctErrorInstalled) return;
        global._ctErrorInstalled = true;
        const prev = global.onerror;
        global.onerror = function (msg, url, line, col, err) {
            if (prev) { try { prev.call(global, msg, url, line, col, err); } catch (_) {} }
            const txt = [
                'JS 异常: ',
                (typeof msg === 'string' ? msg : (msg && msg.message) || '未知错误'),
                (line ? (' @' + (url || '') + ':' + line + (col ? ':' + col : '')) : '')
            ].join('');
            try { toastMsg(txt, 'warn'); } catch (_) {}
            console.error('[CyberTank onerror]', msg, url, line, col, err);
            return true; // 不冒泡到浏览器默认 UI
        };
        window.addEventListener('unhandledrejection', (ev) => {
            const reason = (ev && ev.reason) ? (ev.reason.message || String(ev.reason)) : 'Promise 被拒';
            try { toastMsg('异步异常: ' + String(reason).slice(0, 160), 'warn'); } catch (_) {}
            console.error('[CyberTank unhandledrejection]', ev && ev.reason);
        });
    }

    /* ==========================================================
     * Bootstrap 主流程
     * ========================================================== */
    function GameBootstrap() {
        if (booted) return;
        booted = true;

        // ---- Step 7 前置：先装全局错误捕获，保证后面都能看到 ----
        setupErrorCatch();

        /* ---- 全局按钮点击音效（事件委托：所有 button 类元素统一点击声） ---- */
        (function bindClickSfx() {
            document.addEventListener('pointerdown', (ev) => {
                const t = ev.target;
                if (!t || !t.closest) return;
                const btn = t.closest('button, .ct-chip, .ct-neon-btn, [role="button"]');
                if (!btn) return;
                try { global.CT_AUDIO && global.CT_AUDIO.play && global.CT_AUDIO.play('click'); } catch (_) {}
            }, { passive: true });
        })();

        /* ---- 全局道具掉落接线 ----
         * bullet.js 打破砖墙 emit 'powerup:spawnDrop'（emitGlobal 已修复为
         * CT_BUS 主通道 + DOM 辅通道双发）。此处只监听 CT_BUS —— 若同时监听
         * DOM 会导致同一事件 handleDrop 执行两次 → 道具重复生成。 */
        (function bindPowerupDrop() {
            const handleDrop = (x, y) => {
                try {
                    const PW = global.CT_POWERUP;
                    const gs = global.CT_ENGINE && global.CT_ENGINE.gameState;
                    if (!PW || typeof PW.spawn !== 'function' || !gs || !Array.isArray(gs.powerups)) return;
                    /* CT_POWERUP 导出属性名是 PowerupDefs（此前误读 PW.DEFS → 空
                     * → 碎砖后道具掉落从不生成） */
                    const keys = Object.keys(PW.PowerupDefs || {});
                    if (!keys.length) return;
                    const id = keys[Math.floor(Math.random() * keys.length)];
                    const p = PW.spawn(x, y, id);
                    if (p) gs.powerups.push(p);
                } catch (e) { /* noop */ }
            };
            if (global.CT_BUS && typeof global.CT_BUS.on === 'function') {
                global.CT_BUS.on('powerup:spawnDrop', (d) => handleDrop(d && d.x, d && d.y));
            }
        })();

        /* ---- 道具/技能功能事件接线 ----
         * P10 核弹 / P13 建造模块 / P14 地雷 / 工程车布雷技能：apply 内只 emit 事件，
         * 此前全代码库无任何监听者 → 拾取后毫无效果（道具不能用的深层根因之二）。
         * 统一在此接线到当前对局 gameState。 */
        (function bindPowerupFunctionEvents() {
            const BUS_ = global.CT_BUS;
            if (!BUS_ || typeof BUS_.on !== 'function') return;

            /* P10 核弹：对全场敌方坦克造成大量伤害 */
            BUS_.on('player:nuke', (d) => {
                try {
                    const gs = global.CT_ENGINE && global.CT_ENGINE.gameState;
                    if (!gs || !Array.isArray(gs.tanks)) return;
                    const dmg = (d && d.damage) || 99;
                    const src = d && d.tank;
                    for (let i = 0; i < gs.tanks.length; i++) {
                        const t = gs.tanks[i];
                        if (!t || !t.alive || t.type === 'player') continue;
                        if (typeof t.takeDamage === 'function') t.takeDamage(dmg, src);
                        else {
                            t.hp = (t.hp || 0) - dmg;
                            if (t.hp <= 0 && t.alive) { t.alive = false; BUS_.emit('tank:dead', { tank: t, dead: t, source: src }); }
                        }
                    }
                    /* 核爆视觉/音效：白闪 + 爆炸粒子 + 低频轰鸣 */
                    try { global.CT_EFFECTS && global.CT_EFFECTS.flashWhite && global.CT_EFFECTS.flashWhite(0.85, 600); } catch (_) {}
                    try {
                        if (global.CT_PARTICLES && typeof global.CT_PARTICLES.explode === 'function') {
                            const p = (src && src.pos) || { x: 0, y: 0 };
                            global.CT_PARTICLES.explode(p.x, p.y, 3);
                        }
                    } catch (_) {}
                    try { global.CT_AUDIO && global.CT_AUDIO.play && global.CT_AUDIO.play('explode'); } catch (_) {}
                } catch (e) { /* noop */ }
            });

            /* P13 建造模块：面向炮塔方向放置 2×2 砖墙（偏移放置避免把自己封死） */
            BUS_.on('powerup:placeBricks', (d) => {
                try {
                    const gs = global.CT_ENGINE && global.CT_ENGINE.gameState;
                    const OB = global.CT_OBSTACLE;
                    if (!gs || !Array.isArray(gs.obstacles)) return;
                    if (!OB || typeof OB.WallBrick !== 'function') return;
                    const cx = (d && d.centerX) || 0, cy = (d && d.centerY) || 0;
                    const ang = (d && typeof d.angle === 'number') ? d.angle : 0;
                    const size = (d && d.size) || 2;
                    const tile = 32;
                    const dist = (size * tile) / 2 + 40;
                    const ox = cx + Math.cos(ang) * dist;
                    const oy = cy + Math.sin(ang) * dist;
                    const half = (size * tile) / 2;
                    for (let r = 0; r < size; r++) {
                        for (let c = 0; c < size; c++) {
                            gs.obstacles.push(new OB.WallBrick({
                                x: ox - half + c * tile, y: oy - half + r * tile,
                                w: tile, h: tile, hp: 2
                            }));
                        }
                    }
                    try { global.CT_AUDIO && global.CT_AUDIO.play && global.CT_AUDIO.play('buy_ok'); } catch (_) {}
                } catch (e) { /* noop */ }
            });

            /* P14 地雷 / 工程车技能布雷：伪障碍物（不挡坦克/子弹，update 检测敌人引爆）
             * 挂进 gs.obstacles 可复用各模式的 update/render 管线。 */
            function makeMine(x, y, damage, ownerType) {
                const m = {
                    type: 'mine', alive: true, hp: Infinity,
                    blockTank: false, blockBullet: false, traction: 1,
                    _box: { x: x - 12, y: y - 12, w: 24, h: 24 },
                    _mine: { damage: damage || 6, owner: ownerType || 'player', born: performance.now() / 1000, armDelay: 0.8, ttl: 30 },
                    get aabb() { return this._box; },
                    update: function () {
                        if (!this.alive) return;
                        const info = this._mine;
                        const now = performance.now() / 1000;
                        if (now - info.born > info.ttl) { this.alive = false; return; }
                        if (now - info.born < info.armDelay) return;
                        const gs = global.CT_ENGINE && global.CT_ENGINE.gameState;
                        if (!gs || !Array.isArray(gs.tanks)) return;
                        for (let i = 0; i < gs.tanks.length; i++) {
                            const t = gs.tanks[i];
                            if (!t || !t.alive || t.type === info.owner) continue;
                            const dx = (t.pos ? t.pos.x : 0) - x;
                            const dy = (t.pos ? t.pos.y : 0) - y;
                            if (dx * dx + dy * dy <= 48 * 48) {
                                if (typeof t.takeDamage === 'function') t.takeDamage(info.damage, info.owner);
                                else {
                                    t.hp = (t.hp || 0) - info.damage;
                                    if (t.hp <= 0 && t.alive) { t.alive = false; BUS_.emit('tank:dead', { tank: t, dead: t, source: info.owner }); }
                                }
                                this.alive = false;
                                try { global.CT_PARTICLES && global.CT_PARTICLES.explode && global.CT_PARTICLES.explode(x, y, 1); } catch (_) {}
                                try { global.CT_AUDIO && global.CT_AUDIO.play && global.CT_AUDIO.play('explode'); } catch (_) {}
                                return;
                            }
                        }
                    },
                    render: function (ctx, camera) {
                        if (!this.alive) return;
                        const cam = camera || (global.CT_RENDERER && global.CT_RENDERER.camera) || null;
                        const sc = cam ? (cam.scale || 1) : 1;
                        const sx = cam ? (x - cam.x) * sc + cam.w / 2 : x;
                        const sy = cam ? (y - cam.y) * sc + cam.h / 2 : y;
                        const now = performance.now() / 1000;
                        const armed = (now - this._mine.born) >= this._mine.armDelay;
                        const blink = armed ? (Math.floor(now / 0.35) % 2 ? 1 : 0.4) : 0.35;
                        ctx.save();
                        ctx.globalAlpha = blink;
                        ctx.fillStyle = '#ff7f50';
                        ctx.shadowColor = '#ff3860';
                        ctx.shadowBlur = armed ? 10 : 4;
                        ctx.beginPath();
                        ctx.arc(sx, sy, 6 * sc, 0, Math.PI * 2);
                        ctx.fill();
                        ctx.restore();
                    }
                };
                return m;
            }
            BUS_.on('powerup:spawnMine', (d) => {
                try {
                    const gs = global.CT_ENGINE && global.CT_ENGINE.gameState;
                    if (!gs || !Array.isArray(gs.obstacles)) return;
                    gs.obstacles.push(makeMine((d && d.x) || 0, (d && d.y) || 0, (d && d.damage) || 6, (d && d.owner) || 'player'));
                } catch (e) { /* noop */ }
            });
        })();

        // ---- Step 1：加载 storage / utils 默认值（容错） ----
        try {
            if (typeof global.CT_STORAGE !== 'undefined' && global.CT_STORAGE && typeof global.CT_STORAGE.init === 'function') {
                global.CT_STORAGE.init();
            }
        } catch (e) { console.warn('[bootstrap] CT_STORAGE init skipped', e); }
        try {
            if (typeof global.CT_PARTICLES !== 'undefined' && global.CT_PARTICLES && typeof global.CT_PARTICLES.init === 'function') {
                global.CT_PARTICLES.init();
            }
        } catch (e) { console.warn('[bootstrap] CT_PARTICLES init skipped', e); }
        try {
            if (typeof global.CT_EFFECTS !== 'undefined' && global.CT_EFFECTS && typeof global.CT_EFFECTS.init === 'function') {
                global.CT_EFFECTS.init();
            }
        } catch (e) { console.warn('[bootstrap] CT_EFFECTS init skipped', e); }

        // ---- Step 2：初始化渲染器 ----
        try {
            if (global.CT_RENDERER && typeof global.CT_RENDERER.init === 'function') {
                global.CT_RENDERER.init();
            } else {
                toastMsg('警告：CT_RENDERER 未加载', 'warn');
            }
        } catch (e) {
            console.error('[bootstrap] CT_RENDERER.init failed', e);
            toastMsg('渲染器初始化失败: ' + (e.message || e), 'error');
        }

        // ---- Step 3：初始化音频（只挂 click/keydown resume，不主动播放） ----
        try {
            if (global.CT_AUDIO && typeof global.CT_AUDIO.init === 'function') {
                global.CT_AUDIO.init();
            }
            /* 恢复设置面板保存过的音量/静音（键与 modal.js 的 kv 存储一致） */
            const A = global.CT_AUDIO;
            if (A && typeof A.setVolume === 'function') {
                ['master', 'sfx', 'bgm'].forEach((ch) => {
                    try {
                        const raw = localStorage.getItem('ct_vol_' + ch);
                        if (raw != null) {
                            const v = JSON.parse(raw);
                            if (typeof v === 'number' && v >= 0 && v <= 100) A.setVolume(ch, v / 100);
                        }
                    } catch (_) {}
                });
            }
            if (A && typeof A.mute === 'function') {
                try {
                    const m = localStorage.getItem('ct_mute_all');
                    if (m != null) A.mute(JSON.parse(m));
                } catch (_) {}
            }
        } catch (e) {
            console.error('[bootstrap] CT_AUDIO.init failed', e);
        }

        // ---- Step 4：依次调用各子模块 init（全部可选链容错） ----
        const modules = [
            ['CT_UI_MENU',     '菜单'],
            ['CT_UI_HUD',      '战斗HUD'],
            ['CT_UI_MODAL',    '模态'],
            ['CT_UI_RESULT',   '结算UI'],
            ['CT_UI_BUFF',     'Buff UI'],
            ['CT_UI_SHOP',     '商店 UI'],
            ['CT_UI_PREP',     '备战 UI'],
            ['CT_WAVE_MANAGER','波次管理'],
            ['CT_BUFF_SYSTEM', 'Buff 系统'],
            ['CT_SHOP_SYSTEM', '商店系统'],
            ['CT_PREP_SYSTEM', '备战系统'],
            ['CT_ENTITY_TANK', '玩家坦克'],
            ['CT_ENTITY_ENEMY','敌方坦克'],
            ['CT_ENTITY_BOSS', 'Boss'],
            ['CT_ENTITY_BULLET','子弹'],
            ['CT_ENTITY_OBSTACLE','障碍'],
            ['CT_ENTITY_POWERUP','道具'],
            ['CT_MODE_HORDE',  '模式-无尽'],
            ['CT_MODE_BR',     '模式-大逃杀'],
            ['CT_MODE_KH',     '模式-占山为王'],
            ['CT_MODE_DUEL',   '模式-1v1'],
            ['CT_MODE_KINGDEFEND', '模式-据点守护'],
        ];
        for (let i = 0; i < modules.length; i++) {
            const [name] = modules[i];
            try {
                const m = global[name];
                if (m && typeof m.init === 'function') m.init();
            } catch (e) {
                console.warn('[bootstrap] ' + name + '.init failed', e);
            }
        }

        // ---- Step 5：启动主循环 ----
        try {
            if (global.CT_ENGINE && typeof global.CT_ENGINE.start === 'function') {
                // 把相机更新挂到 update（高优先级 10，在实体逻辑前面跑）
                global.CT_ENGINE.registerUpdate(function (dt) {
                    if (global.CT_RENDERER && typeof global.CT_RENDERER.updateCamera === 'function') {
                        global.CT_RENDERER.updateCamera(dt);
                    }
                }, 10);
                                // bg 层：赛博风格地图网格背景 + 径向渐变地板（全局注册，模式 start/stop 时自动生效）
                (function(){
                    function renderBg(ctx){
                        var R=global.CT_RENDERER; if(!R) return;
                        var rc=R.camera||{}; var zm=rc.zoom||1; var vpW=R.viewport?R.viewport.w:0, vpH=R.viewport?R.viewport.h:0;
                        var worldW=R.world?R.world.w:3200, worldH=R.world?R.world.h:3200;
                        var tile=R.world?R.world.tile:64;
                        var camX=rc.x||0, camY=rc.y||0;
                        // 1) 深色底色渐变
                        ctx.save();
                        var g=ctx.createRadialGradient(vpW/2,vpH/2,80,vpW/2,vpH/2,Math.max(vpW,vpH));
                        g.addColorStop(0,'#0e1530'); g.addColorStop(0.6,'#070b1c'); g.addColorStop(1,'#02030a');
                        ctx.fillStyle=g; ctx.fillRect(0,0,vpW,vpH);
                        // 2) 世界边界发光框
                        var bx=(0-camX)*zm, by=(0-camY)*zm, bw=worldW*zm, bh=worldH*zm;
                        ctx.save(); ctx.strokeStyle='rgba(0,229,255,0.35)'; ctx.lineWidth=2; ctx.shadowColor='rgba(0,229,255,0.8)'; ctx.shadowBlur=18;
                        ctx.strokeRect(bx,by,bw,bh); ctx.restore();
                        // 3) 主网格线（基于 tile）
                        var startCol=Math.max(0,Math.floor(camX/tile)); var endCol=Math.min(worldW/tile, Math.ceil((camX+vpW/zm)/tile));
                        var startRow=Math.max(0,Math.floor(camY/tile)); var endRow=Math.min(worldH/tile, Math.ceil((camY+vpH/zm)/tile));
                        ctx.save(); ctx.strokeStyle='rgba(255,43,214,0.08)'; ctx.lineWidth=1;
                        for(var c=startCol;c<=endCol;c++){ var sx=(c*tile-camX)*zm; ctx.beginPath(); ctx.moveTo(sx,0); ctx.lineTo(sx,vpH); ctx.stroke(); }
                        for(var r=startRow;r<=endRow;r++){ var sy=(r*tile-camY)*zm; ctx.beginPath(); ctx.moveTo(0,sy); ctx.lineTo(vpW,sy); ctx.stroke(); }
                        ctx.restore();
                        // 4) 每隔 5 格的粗网格（赛博风格）
                        ctx.save(); ctx.strokeStyle='rgba(0,229,255,0.14)'; ctx.lineWidth=1;
                        var step=5;
                        for(var c2=Math.ceil(startCol/step)*step;c2<=endCol;c2+=step){ var sx2=(c2*tile-camX)*zm; ctx.beginPath(); ctx.moveTo(sx2,0); ctx.lineTo(sx2,vpH); ctx.stroke(); }
                        for(var r2=Math.ceil(startRow/step)*step;r2<=endRow;r2+=step){ var sy2=(r2*tile-camY)*zm; ctx.beginPath(); ctx.moveTo(0,sy2); ctx.lineTo(vpW,sy2); ctx.stroke(); }
                        ctx.restore();
                        // 5) 扫描线（CRT 效果）
                        ctx.save(); ctx.globalAlpha=0.05; ctx.strokeStyle='#ffffff'; ctx.lineWidth=1;
                        for(var sl=0;sl<vpH;sl+=4){ ctx.beginPath(); ctx.moveTo(0,sl); ctx.lineTo(vpW,sl); ctx.stroke(); }
                        ctx.restore();
                        ctx.restore();
                    }
                    if(global.CT_ENGINE && typeof global.CT_ENGINE.registerRender==="function"){
                        global.CT_ENGINE.registerRender(renderBg,"bg");
                    }
                })();
                // 实体渲染调度：遍历 gameState 实体调用各自 render(ctx, cam)
                // cam 适配：renderer.camera 用 zoom，实体 render 期望 scale + w/h
                (function(){
                    /* ----------------------------------------------------------
                     * 障碍层离屏缓存（性能优化）
                     * 地图绝大部分是静态地形（砖/钢/泥/草），却每帧重复绘制，
                     * 且砖墙/钢墙都带 shadowBlur + 渐变，开销很高。
                     * 这里把静态地形烘焙到一张离屏 Canvas，每帧只做一次 drawImage；
                     * 仅当"砖墙被打掉 / 切换模式"导致存活静态地形数变化时重新烘焙。
                     * 水面波纹与传送门旋转带动画，仍按原方式每帧绘制（叠加在缓存之上）。
                     * ---------------------------------------------------------- */
                    /** @type {{cv:HTMLCanvasElement,minX:number,minY:number,w:number,h:number,gs:Object,aliveStatic:number,zoom:number}|null} */
                    var _obsCache = null;

                    /** 离屏烘焙的边长上限（CSS px），超出则回退到逐个绘制，避免超大画布 */
                    var _MAX_BAKE = 8192;

                    /**
                     * 把静态地形按世界坐标烘焙到离屏 Canvas
                     * @param {Object} gs 游戏状态
                     * @param {number} aliveStatic 存活静态地形数量（作为脏标记）
                     * @param {number} zoom 当前相机缩放，按此缩放烘焙以保证细节与直接绘制一致
                     * @returns {Object|null} 缓存对象，失败返回 null（调用方回退到逐个绘制）
                     */
                    function _bakeObstacleCache(gs, aliveStatic, zoom){
                        var R = global.CT_RENDERER;
                        if (!R || typeof R.createOffscreen !== 'function') return null;
                        var obs = gs.obstacles || [];
                        var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
                        for (var i = 0; i < obs.length; i++) {
                            var o = obs[i];
                            if (!o || o.alive === false) continue;
                            if (o.type === 'water' || o.type === 'portal' || o.type === 'mine') continue; // 动态地形/地雷不烘焙
                            var b = o.aabb || o._box;
                            if (!b) continue;
                            if (b.x < minX) minX = b.x;
                            if (b.y < minY) minY = b.y;
                            if (b.x + b.w > maxX) maxX = b.x + b.w;
                            if (b.y + b.h > maxY) maxY = b.y + b.h;
                        }
                        if (minX === Infinity) return null; // 没有静态地形
                        // 按当前缩放烘焙：砖纹/铆钉等用了固定像素偏移，若按 1 倍烘焙再整体放大，
                        // 这些细节会被一并拉伸，与直接绘制产生 1~2px 差异
                        var w = Math.ceil((maxX - minX) * zoom);
                        var h = Math.ceil((maxY - minY) * zoom);
                        // 超大地图 + 高缩放会撑爆画布，直接放弃缓存走原路径
                        if (!(w > 0 && h > 0) || w > _MAX_BAKE || h > _MAX_BAKE) return null;
                        var cv = R.createOffscreen(w, h);
                        if (!cv) return null;
                        var c = cv.getContext('2d');
                        // 以包围盒左上角为原点的"中性相机"，使障碍按世界坐标落到离屏内
                        var wc = { x: minX, y: minY, scale: zoom, w: 0, h: 0 };
                        for (var k = 0; k < obs.length; k++) {
                            var o2 = obs[k];
                            if (!o2 || o2.alive === false) continue;
                            if (o2.type === 'water' || o2.type === 'portal' || o2.type === 'mine') continue;
                            try { o2.render(c, wc); } catch (e) { /* 单个失败不影响整体 */ }
                        }
                        return { cv: cv, minX: minX, minY: minY, w: w, h: h, gs: gs, aliveStatic: aliveStatic, zoom: zoom };
                    }

                    function makeEntityRenderer(layer){
                        return function(ctx){
                            var E=global.CT_ENGINE, R=global.CT_RENDERER;
                            if(!E||!R) return;
                            var gs=E.gameState; if(!gs) return;
                            var rc=R.camera||{};
                            var vpW=R.viewport?R.viewport.w:0, vpH=R.viewport?R.viewport.h:0, zm=rc.zoom||1;
                            var cam={x:(rc.x||0)+vpW/2/zm,y:(rc.y||0)+vpH/2/zm,scale:zm,w:vpW,h:vpH,zoom:zm,target:rc.target};
                            if(layer==="obstacle"){
                                var obs=gs.obstacles;
                                if(obs && obs.length){
                                    // 统计存活的静态地形数量，作为"地图是否变化"的脏标记
                                    var aliveStatic=0;
                                    for(var k=0;k<obs.length;k++){
                                        var q=obs[k];
                                        if(q && q.alive!==false && q.type!=='water' && q.type!=='portal' && q.type!=='mine') aliveStatic++;
                                    }
                                    // 切换模式(gs 变了)、砖墙被打掉(数量变了)、缩放变了 → 重新烘焙
                                    if(!_obsCache || _obsCache.gs!==gs || _obsCache.aliveStatic!==aliveStatic || _obsCache.zoom!==zm){
                                        _obsCache = _bakeObstacleCache(gs, aliveStatic, zm);
                                    }
                                    if(_obsCache && _obsCache.cv){
                                        try{
                                            // 实体 render 的换算为 (world - cam.x)*scale + cam.w/2，
                                            // 因此贴图落点要补回 cam.w/2、cam.h/2，否则地图整体偏移半个视口。
                                            // 离屏已按当前缩放烘焙，故此处 1:1 贴图，不再二次缩放。
                                            ctx.drawImage(
                                                _obsCache.cv,
                                                (_obsCache.minX - cam.x) * zm + cam.w / 2,
                                                (_obsCache.minY - cam.y) * zm + cam.h / 2,
                                                _obsCache.w,
                                                _obsCache.h
                                            );
                                        }catch(e){
                                            // 极少数环境 drawImage 失败 → 丢弃缓存，回退到逐个绘制
                                            _obsCache = null;
                                        }
                                    }
                                    if(!_obsCache || !_obsCache.cv){
                                        // 回退：与原逻辑一致的逐个绘制
                                        for(var i=0;i<obs.length;i++){var o=obs[i]; if(o&&o.alive!==false&&typeof o.render==="function"){try{o.render(ctx,cam)}catch(e){}}}
                                    }else{
                                        // 动态地形（水面波纹 / 传送门旋转 / 地雷闪烁）每帧绘制，叠加在缓存之上
                                        for(var d=0;d<obs.length;d++){
                                            var od=obs[d];
                                            if(od&&od.alive!==false&&(od.type==='water'||od.type==='portal'||od.type==='mine')&&typeof od.render==="function"){
                                                try{od.render(ctx,cam)}catch(e){}
                                            }
                                        }
                                    }
                                }
                            }else if(layer==="ground"){
                                var t=gs.tanks; if(t) for(var i=0;i<t.length;i++){var tk=t[i]; if(tk&&tk.alive&&typeof tk.render==="function"){try{tk.render(ctx,cam)}catch(e){}}}
                                var p=gs.powerups; if(p) for(var i=0;i<p.length;i++){var pw=p[i]; if(pw&&pw.alive!==false&&typeof pw.render==="function"){try{pw.render(ctx,cam)}catch(e){}}}
                            }else if(layer==="bullet"){
                                var b=gs.bullets; if(b) for(var i=0;i<b.length;i++){var bl=b[i]; if(bl&&bl.alive&&typeof bl.render==="function"){try{bl.render(ctx,cam)}catch(e){}}}
                            }
                        };
                    }
                    if(global.CT_ENGINE && typeof global.CT_ENGINE.registerRender==="function"){
                        global.CT_ENGINE.registerRender(makeEntityRenderer("obstacle"),"obstacle");
                        global.CT_ENGINE.registerRender(makeEntityRenderer("ground"),"ground");
                        global.CT_ENGINE.registerRender(makeEntityRenderer("bullet"),"bullet");
                    }
                })();
                global.CT_ENGINE.start();
            } else {
                toastMsg('警告：CT_ENGINE 未加载', 'warn');
            }
        } catch (e) {
            console.error('[bootstrap] CT_ENGINE.start failed', e);
            toastMsg('主循环启动失败: ' + (e.message || e), 'error');
        }

        // ---- Step 6：绑定全局输入 ----
        try { setupInput(); } catch (e) {
            console.error('[bootstrap] setupInput failed', e);
        }

        // ---- Step 7：首屏状态 MENU + ui:showMainMenu ----
        try {
            if (global.CT_ENGINE && typeof global.CT_ENGINE.setState === 'function') {
                global.CT_ENGINE.setState('MENU');
            }
        } catch (e) { console.error(e); }
        try {
            if (global.CT_BUS && typeof global.CT_BUS.emit === 'function') {
                global.CT_BUS.emit('ui:showMainMenu');
            }
        } catch (e) { console.error(e); }

        // 启动成功小提示（info，非打扰）
        console.info('%c[CyberTank] Bootstrap OK. 命名空间: CT_ENGINE / CT_RENDERER / CT_AUDIO / CT_PHYSICS / CT_BUS / CT_INPUT',
            'color:#00e5ff;font-weight:bold');
    }

    /* ==========================================================
     * 暴露到全局
     * ========================================================== */
    global.GameBootstrap = GameBootstrap;
    // 给 toast 留一个轻量访问口（后续 UI 模块可复用）
    global.CT_TOAST = global.CT_TOAST || toastMsg;

    /* ==========================================================
     * 波次/战况全屏横幅（波次来袭 · 波次完成 · 倒计时）
     * 用法：CT_WAVE_BANNER.show('⚔ 第 3 波来袭', 'WAVE 3 · INCOMING', 2200)
     * ========================================================== */
    global.CT_WAVE_BANNER = (function () {
        let el = null, hideTimer = 0;
        function ensure() {
            if (el && el.parentNode) return el;
            el = document.createElement('div');
            el.id = 'ct-wave-banner';
            el.style.cssText = [
                'position:fixed', 'left:50%', 'top:26%', 'transform:translate(-50%,-50%)',
                'z-index:1800', 'pointer-events:none', 'text-align:center',
                'opacity:0', 'transition:opacity .25s ease, transform .25s ease',
                'font-family:Share Tech Mono,monospace'
            ].join(';');
            document.body.appendChild(el);
            return el;
        }
        function show(main, sub, ms) {
            const node = ensure();
            if (hideTimer) { clearTimeout(hideTimer); hideTimer = 0; }
            node.innerHTML =
                '<div style="font-size:46px;letter-spacing:.18em;color:#ffd54f;' +
                'text-shadow:0 0 18px rgba(255,213,79,.9),0 0 42px rgba(255,140,0,.5)">' + (main || '') + '</div>' +
                (sub ? '<div style="margin-top:10px;font-size:15px;letter-spacing:.3em;color:#00e5ff;' +
                    'text-shadow:0 0 10px rgba(0,229,255,.8);font-family:JetBrains Mono,monospace">' + sub + '</div>' : '');
            node.style.opacity = '1';
            node.style.transform = 'translate(-50%,-50%) scale(1)';
            hideTimer = setTimeout(() => {
                node.style.opacity = '0';
                node.style.transform = 'translate(-50%,-50%) scale(0.92)';
            }, ms || 2000);
        }
        return { show };
    })();

})(typeof window !== 'undefined' ? window : globalThis);

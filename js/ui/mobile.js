/* ==========================================================
 * CyberTank — mobile.js (移动端街机控制层 / 仅触屏设备激活)
 * window.CT_UI_MOBILE
 *
 * 设计原则：
 *   1) 桌面端【完全零副作用】—— 非触屏/非窄屏时本文件立即 return，
 *      不创建任何 DOM、不加 class、不注入任何样式、不改 index.html 其余逻辑。
 *   2) 仅当检测到触屏或窄屏设备时，才注入移动端所需的样式与控件。
 *   3) 所有移动端布局/样式全部落在 css/mobile-arcade.css（限定 html.touch
 *      作用域），本文件只负责结构与交互逻辑，不内联任何视觉样式。
 *   4) 修复移动端已知 bug：
 *      - 炮塔不转：旧版 drag-aim 只写 screen x/y，而瞄准依赖
 *        input.turretWorldPoint（来自 mouse.worldX/Y）。现改为 screenToWorld
 *        转世界坐标，炮塔可正常跟随手指。
 *      - 按键卡死：touchcancel / 切后台(visibilitychange) / 失焦(blur) /
 *        pagehide 时统一释放所有按键与开火状态。
 *      - 控件遮挡点击：当主菜单/商店/BUFF/备战/结算/模态弹层任一可见时，
 *        隐藏移动控件，避免误触与遮挡可交互 UI。
 *      - 动画卡顿：移动端把渲染 DPR 上限降到 2（桌面保持原档位）。
 * ========================================================== */
(function (global) {
    'use strict';

    const doc = global.document;

    /* ---------- 设备判定（仅触屏/窄屏激活） ---------- */
    function isTouchDevice() {
        if (typeof global === 'undefined' || !global.navigator) return false;
        const nav = global.navigator;
        const hasTouch =
            ('ontouchstart' in global) ||
            (nav.maxTouchPoints && nav.maxTouchPoints > 1) ||
            (nav.msMaxTouchPoints && nav.msMaxTouchPoints > 0);
        const narrow = global.matchMedia
            ? global.matchMedia('(max-width: 820px)').matches
            : (global.innerWidth || 0) <= 820;
        return !!(hasTouch || narrow);
    }

    /* ---------- 桌面端：什么都不做，返回安全桩，绝不影响桌面 ---------- */
    if (!isTouchDevice()) {
        global.CT_UI_MOBILE = {
            enabled: false,
            isTouch: false,
            init() {}, enable() {}, disable() {}, autoDetect() {}, relayout() {}
        };
        return;
    }

    /* ==========================================================
     * 以下是【仅触屏设备】才执行的代码
     * ========================================================== */
    const INP = null; // 懒加载：事件触发时再取 global.CT_INPUT（确保已初始化）

    function getINP() { return global.CT_INPUT || null; }
    function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

    function fireKeyEv(key, down) {
        const IN = getINP();
        if (!IN) return;
        const k = String(key).toLowerCase();
        if (down) IN.keys.add(k); else IN.keys.delete(k);
        const BUS = global.CT_BUS;
        if (BUS && typeof BUS.emit === 'function') {
            try { BUS.emit(down ? 'input:keydown' : 'input:keyup', { key: k, synthetic: true }); } catch (_) {}
        }
    }
    function setMouseDown(down) {
        const IN = getINP();
        if (!IN) return;
        IN.mouse.down = !!down;
        const BUS = global.CT_BUS;
        if (BUS && typeof BUS.emit === 'function') {
            try { BUS.emit(down ? 'input:mousedown' : 'input:mouseup', { button: 0, synthetic: true }); } catch (_) {}
        }
    }
    /* 炮塔瞄准：屏幕坐标 -> 世界坐标，写入 mouse.worldX/worldY + x/y。
     * 这是移动端“炮塔不转”的根本修复点。 */
    function setAimAt(sx, sy) {
        const IN = getINP();
        if (!IN) return;
        IN.mouse.x = sx; IN.mouse.y = sy;
        const R = global.CT_RENDERER;
        if (R && typeof R.screenToWorld === 'function') {
            try {
                let w = R.screenToWorld(sx, sy);
                // 辅助瞄准（磁吸 D-06）：靠近敌人时朝其方向轻微插值，降低移动端瞄准难度
                if (MOD.aimAssist) w = aimAssistSnap(w.x, w.y);
                IN.mouse.worldX = w.x; IN.mouse.worldY = w.y;
            } catch (_) {}
        }
    }

    /* 辅助瞄准：在约 150 世界单位内寻找最近敌方坦克，向其方向插值 35%（保留手动微调空间）。
     * 1v1 等双方皆 player 的模式自动跳过（不会把 P1 吸向 P2）。 */
    function aimAssistSnap(wx, wy) {
        try {
            const ENG = global.CT_ENGINE;
            const gs = ENG && ENG.gameState;
            if (!gs || !gs.tanks) return { x: wx, y: wy };
            const myself = gs.player || (gs.tanks[0] || null);
            let best = null, bestD = 150;
            for (let i = 0; i < gs.tanks.length; i++) {
                const t = gs.tanks[i];
                if (!t || !t.alive || t === myself || t.type === 'player') continue;
                const dx = t.pos.x - wx, dy = t.pos.y - wy;
                const d = Math.hypot(dx, dy);
                if (d < bestD) { bestD = d; best = t; }
            }
            if (!best) return { x: wx, y: wy };
            return { x: wx + (best.pos.x - wx) * 0.35, y: wy + (best.pos.y - wy) * 0.35 };
        } catch (_) { return { x: wx, y: wy }; }
    }

    function mk(tag, cls, html) {
        const el = doc.createElement(tag);
        if (cls) el.className = cls;
        if (html != null) el.innerHTML = html;
        return el;
    }

    /* ---------- 移动端样式注入（仅触屏）：编译后的 Tailwind + 街机皮肤 ---------- */
    function injectMobileAssets() {
        // 1) 编译后的 Tailwind（桌面端由 CDN 提供；移动端 CDN 可能被墙，故本地注入）
        if (!doc.getElementById('ct-tailwind-mobile')) {
            const link = doc.createElement('link');
            link.id = 'ct-tailwind-mobile';
            link.rel = 'stylesheet';
            link.href = 'css/tailwind.min.css';
            (doc.head || doc.documentElement).appendChild(link);
        }
        // 2) 标记 html.touch，使 css/mobile-arcade.css 作用域生效（桌面无此 class）
        doc.documentElement.classList.add('touch');
        // 3) 移动端坦克模型缩小到 0.7（仅视觉渲染缩放，不触碰碰撞框 _w/_h）：
        //    相机始终居中玩家，缩小后中央坦克不再遮挡大片视野。桌面端不会走到这里。
        global.CT_TANK_RENDER_SCALE = 0.4;
        global.CT_POWERUP_RENDER_SCALE = 0.4;
    }

    /* ---------- 状态 ---------- */
    const MOD = {
        enabled: false,
        inited: false,
        root: null,
        joystick: { baseEl: null, knobEl: null, id: null, cx: 0, cy: 0, radius: 56, dir: { x: 0, y: 0 } },
        aim: { id: null, lastX: 0, lastY: 0 },
        fire: { id: null },
        skill: { id: null },
        slots: { ids: {} },          // { '1': touchId, ... }
        slotsArmed: null,            // 道具槽两段确认：当前已点亮待确认的槽位 key
        aimAssist: true,             // 辅助瞄准（磁吸），D-06
        fireBtn: null, skillBtn: null, slotsEls: []
    };

    const WASDMap = [
        { k: 'w', axis: 'y', sign: -1, thr: 0.20 },
        { k: 's', axis: 'y', sign:  1, thr: 0.20 },
        { k: 'a', axis: 'x', sign: -1, thr: 0.20 },
        { k: 'd', axis: 'x', sign:  1, thr: 0.20 },
    ];
    const prevKeys = { w: false, a: false, s: false, d: false };

    function applyDirToKeys(dx, dy) {
        WASDMap.forEach((m) => {
            const v = (m.axis === 'x' ? dx : dy) * m.sign;
            const pressed = v >= m.thr;
            if (prevKeys[m.k] !== pressed) {
                prevKeys[m.k] = pressed;
                fireKeyEv(m.k, pressed);
            }
        });
    }

    /* ---------- 摇杆 ---------- */
    function updateJoyCenter() {
        const J = MOD.joystick;
        if (!J.baseEl) return;
        const r = J.baseEl.getBoundingClientRect();
        J.cx = r.left + r.width / 2;
        J.cy = r.top + r.height / 2;
        J.radius = Math.max(40, Math.min(70, r.width * 0.40));
    }
    function onJoyStart(touch) {
        const J = MOD.joystick;
        updateJoyCenter();
        J.id = touch.identifier;
        onJoyMove(touch);
    }
    function onJoyMove(touch) {
        const J = MOD.joystick;
        const dx = touch.clientX - J.cx;
        const dy = touch.clientY - J.cy;
        const dist = Math.hypot(dx, dy) || 1;
        const k = Math.min(1, dist / J.radius);
        const nx = (dx / dist) * k;
        const ny = (dy / dist) * k;
        if (!isFinite(nx) || !isFinite(ny)) return;
        J.dir.x = nx; J.dir.y = ny;
        if (J.knobEl) {
            J.knobEl.style.transform = 'translate(' + (nx * J.radius).toFixed(1) + 'px,' + (ny * J.radius).toFixed(1) + 'px)';
        }
        applyDirToKeys(nx, ny);
    }
    function onJoyEnd() {
        const J = MOD.joystick;
        J.id = null; J.dir.x = 0; J.dir.y = 0;
        if (J.knobEl) J.knobEl.style.transform = 'translate(0,0)';
        applyDirToKeys(0, 0);
    }

    /* ---------- 释放全部输入（防卡死） ---------- */
    function releaseAll() {
        const J = MOD.joystick;
        if (J.id !== null) onJoyEnd();
        if (MOD.aim.id !== null) { MOD.aim.id = null; }
        if (MOD.fire.id !== null) { setMouseDown(false); MOD.fire.id = null; }
        if (MOD.skill.id !== null) { fireKeyEv('e', false); MOD.skill.id = null; }
        Object.keys(MOD.slots.ids).forEach((key) => { fireKeyEv(key, false); });
        MOD.slots.ids = {};
        ['w', 'a', 's', 'd'].forEach((kk) => { if (prevKeys[kk]) { fireKeyEv(kk, false); prevKeys[kk] = false; } });
        setMouseDown(false);
    }

    /* ---------- 控件可见性：菜单/商店/BUFF/备战/结算/模态 任一可见时隐藏 ---------- */
    const BLOCKING_IDS = [
        'main-menu-wrap', 'shop-ui-root', 'buff-ui-root',
        'prep-ui-root', 'result-ui-root', 'modal-root'
    ];
    function isBlockingUiVisible() {
        for (let i = 0; i < BLOCKING_IDS.length; i++) {
            const el = doc.getElementById(BLOCKING_IDS[i]);
            if (!el) continue;
            if (!el.classList.contains('hidden') && el.offsetParent !== null) return true;
        }
        return false;
    }
    function updateControlVisibility() {
        if (!MOD.root) return;
        const hide = isBlockingUiVisible();
        if (hide) {
            MOD.root.classList.add('hidden');
            MOD.root.style.display = 'none';
            if (MOD.enabled) releaseAll();
            MOD.enabled = false;
        } else {
            MOD.root.classList.remove('hidden');
            MOD.root.style.display = '';
            MOD.enabled = true;
        }
    }

    /* ---------- 命中测试 ---------- */
    function isDescendant(el, root) {
        while (el) { if (el === root) return true; el = el.parentNode; }
        return false;
    }

    /* ---------- 文档级触摸事件（统一处理多指） ---------- */
    function onTouchStart(ev) {
        if (!MOD.enabled) return;
        const root = MOD.root;
        const target = ev.target;
        // 命中移动控件：交给控件逻辑处理，文档层不再干涉
        if (isDescendant(target, root)) {
            ev.preventDefault();
            for (let i = 0; i < ev.changedTouches.length; i++) {
                const t = ev.changedTouches[i];
                const tg = t.target;
                const J = MOD.joystick;
                if (J.baseEl && (tg === J.baseEl || J.baseEl.contains(tg))) { onJoyStart(t); continue; }
                if (MOD.fireBtn && (tg === MOD.fireBtn || MOD.fireBtn.contains(tg))) {
                    MOD.fire.id = t.identifier; setMouseDown(true); continue;
                }
                if (MOD.skillBtn && (tg === MOD.skillBtn || MOD.skillBtn.contains(tg))) {
                    MOD.skill.id = t.identifier; fireKeyEv('e', true); continue;
                }
                let hitSlot = -1;
                for (let s = 0; s < MOD.slotsEls.length; s++) {
                    if (MOD.slotsEls[s] && (tg === MOD.slotsEls[s] || MOD.slotsEls[s].contains(tg))) { hitSlot = s; break; }
                }
                if (hitSlot >= 0) {
                    const key = String(hitSlot + 1);
                    const el = MOD.slotsEls[hitSlot];
                    // 防误触（D-07）：首次点击仅点亮待确认，再次点击才真正使用道具
                    if (MOD.slotsArmed === key) {
                        MOD.slotsArmed = null;
                        if (el) el.classList.remove('armed');
                        MOD.slots.ids[key] = t.identifier; fireKeyEv(key, true); continue;
                    } else {
                        if (MOD._armTimer) { try { clearTimeout(MOD._armTimer); } catch (_) {} }
                        MOD.slotsArmed = key;
                        if (el) el.classList.add('armed');
                        // 1 秒后自动解除待确认，避免卡在「已点亮」状态
                        MOD._armTimer = setTimeout(function () {
                            if (MOD.slotsArmed === key) {
                                MOD.slotsArmed = null;
                                if (el) el.classList.remove('armed');
                            }
                        }, 1000);
                        continue;
                    }
                }
            }
            return;
        }
        // 命中可交互 UI 面板（菜单/商店等）：放行，交给原生点击
        for (let i = 0; i < BLOCKING_IDS.length; i++) {
            const el = doc.getElementById(BLOCKING_IDS[i]);
            if (el && !el.classList.contains('hidden') && isDescendant(target, el)) return;
        }
        // 其余空白战斗区域：拖拽瞄准
        ev.preventDefault();
        for (let i = 0; i < ev.changedTouches.length; i++) {
            const t = ev.changedTouches[i];
            if (MOD.aim.id === null) {
                MOD.aim.id = t.identifier;
                MOD.aim.lastX = t.clientX; MOD.aim.lastY = t.clientY;
                setAimAt(t.clientX, t.clientY);
            }
        }
    }
    function onTouchMove(ev) {
        if (!MOD.enabled) return;
        for (let i = 0; i < ev.changedTouches.length; i++) {
            const t = ev.changedTouches[i];
            if (MOD.joystick.id === t.identifier) { ev.preventDefault(); onJoyMove(t); continue; }
            if (MOD.aim.id === t.identifier) {
                ev.preventDefault();
                const dx = t.clientX - MOD.aim.lastX;
                const dy = t.clientY - MOD.aim.lastY;
                MOD.aim.lastX = t.clientX; MOD.aim.lastY = t.clientY;
                // 直接设世界坐标（相对偏移也可，这里用绝对位置更稳）
                setAimAt(t.clientX, t.clientY);
                void dx; void dy;
                continue;
            }
        }
    }
    function onTouchEnd(ev) {
        if (!MOD.enabled) return;
        for (let i = 0; i < ev.changedTouches.length; i++) {
            const t = ev.changedTouches[i];
            if (MOD.joystick.id === t.identifier) { onJoyEnd(); continue; }
            if (MOD.aim.id === t.identifier) { MOD.aim.id = null; continue; }
            if (MOD.fire.id === t.identifier) { setMouseDown(false); MOD.fire.id = null; continue; }
            if (MOD.skill.id === t.identifier) { fireKeyEv('e', false); MOD.skill.id = null; continue; }
            let clearedSlot = null;
            Object.keys(MOD.slots.ids).forEach((key) => { if (MOD.slots.ids[key] === t.identifier) clearedSlot = key; });
            if (clearedSlot) {
                if (MOD.slotsArmed === clearedSlot) {
                    MOD.slotsArmed = null;
                    const ie = MOD.slotsEls[parseInt(clearedSlot, 10) - 1];
                    if (ie) ie.classList.remove('armed');
                }
                fireKeyEv(clearedSlot, false); delete MOD.slots.ids[clearedSlot]; continue;
            }
        }
    }

    /* ---------- init ---------- */
    MOD.init = function () {
        if (MOD.inited) return MOD;
        MOD.inited = true;
        injectMobileAssets();

        // 渲染 DPR 上限降到 2，缓解移动端动画卡顿（桌面不受影响）
        try {
            const R = global.CT_RENDERER;
            if (R && typeof R._resize === 'function') {
                R._dprCap = Math.min(R._dprCap || 3, 2);
                R._resize();
            }
        } catch (_) {}

        // 低端机自动降画质（性能模式 D-13）：核数少或内存小的设备默认 med
        try {
            const R = global.CT_RENDERER;
            const cores = (global.navigator && global.navigator.hardwareConcurrency) || 8;
            const mem = (global.navigator && global.navigator.deviceMemory) || 4;
            if (R && typeof R.setQuality === 'function' && (cores <= 4 || mem <= 3)) {
                R.setQuality('med');
                if (global.CT_STORAGE && typeof global.CT_STORAGE.saveSettings === 'function') {
                    global.CT_STORAGE.saveSettings({ quality: 'med' });
                }
            }
        } catch (_) {}

        let root = doc.getElementById('mobile-controls');
        if (!root) {
            root = mk('div'); root.id = 'mobile-controls';
            (doc.body || doc.documentElement).appendChild(root);
        }
        root.classList.add('hidden');
        root.innerHTML = '';
        MOD.root = root;

        const base = mk('div', 'arc-base', '<span class="arc-cross"></span>');
        base.setAttribute('aria-label', '移动摇杆');
        const knob = mk('div', 'arc-knob');
        base.appendChild(knob);
        MOD.joystick.baseEl = base; MOD.joystick.knobEl = knob;
        root.appendChild(base);

        const fire = mk('div', 'arc-fire', 'FIRE');
        fire.setAttribute('aria-label', '开火');
        MOD.fireBtn = fire; root.appendChild(fire);

        const skill = mk('div', 'arc-skill', 'SKILL');
        skill.setAttribute('aria-label', '技能');
        MOD.skillBtn = skill; root.appendChild(skill);

        const slotsWrap = mk('div', 'arc-slots');
        MOD.slotsEls = [];
        for (let i = 1; i <= 5; i++) {
            const s = mk('div', 'arc-slot', String(i));
            s.setAttribute('aria-label', '道具 ' + i);
            slotsWrap.appendChild(s);
            MOD.slotsEls.push(s);
        }
        root.appendChild(slotsWrap);

        // 文档级监听（passive:false 以便 preventDefault 阻止滚动/缩放）
        doc.addEventListener('touchstart', onTouchStart, { passive: false });
        doc.addEventListener('touchmove',  onTouchMove,  { passive: false });
        doc.addEventListener('touchend',    onTouchEnd,   { passive: false });
        doc.addEventListener('touchcancel', onTouchEnd,   { passive: false });

        // 异常态释放：切后台/失焦/页面隐藏 → 防按键卡死
        doc.addEventListener('visibilitychange', () => { if (doc.hidden) releaseAll(); }, false);
        global.addEventListener('blur', releaseAll, false);
        global.addEventListener('pagehide', releaseAll, false);

        // 监听菜单/商店等面板显隐，动态隐藏控件
        BLOCKING_IDS.forEach((id) => {
            const el = doc.getElementById(id);
            if (el && typeof MutationObserver !== 'undefined') {
                new MutationObserver(updateControlVisibility).observe(el, { attributes: true, attributeFilter: ['class', 'style'] });
            }
        });
        // 兜底轮询（应对以 style.display 切换的面板）
        if (global.setInterval) global.setInterval(updateControlVisibility, 400);

        updateControlVisibility();
        return MOD;
    };

    MOD.enable = function () { MOD.init(); return MOD; };
    MOD.disable = function () { releaseAll(); if (MOD.root) MOD.root.classList.add('hidden'); MOD.enabled = false; return MOD; };
    MOD.relayout = function () { updateJoyCenter(); };

    global.CT_UI_MOBILE = MOD;

    /* ---------- 启动：仅触屏设备进入 ---------- */
    function autoStart() {
        try { MOD.init(); } catch (e) { /* 不影响游戏 */ }
    }
    if (doc.readyState && doc.readyState !== 'loading') autoStart();
    else if (global.addEventListener) global.addEventListener('DOMContentLoaded', autoStart, { once: true });

})(typeof window !== 'undefined' ? window : globalThis);

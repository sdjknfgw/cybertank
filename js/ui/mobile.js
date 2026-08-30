/* ==========================================================
 * CyberTank — mobile.js (Task 11)
 * 虚拟摇杆 + 触屏瞄准 + 开火 / 技能 / 道具栏
 * window.CT_UI_MOBILE
 * ========================================================== */
(function (global) {
    'use strict';

    const INP = global.CT_INPUT || null;
    if (!INP) {
        console.warn('[CT_UI_MOBILE] CT_INPUT 未就绪，触屏控制已降级（不会抛错）。');
    }

    const MOD = {
        enabled: false,
        inited: false,
        joystick: {
            baseEl: null,
            knobEl: null,
            touchId: null,
            cx: 0, cy: 0,
            radius: 52,
            dir: { x: 0, y: 0 },
            active: false,
        },
        fireBtn: null,
        skillBtn: null,
        slots: [],
        toggleBtn: null,
        aiming: {
            active: false,
            lastX: 0,
            lastY: 0,
            touchId: null,
        },
    };

    /* ---------- 工具 ---------- */
    function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
    function mk(tag, cls, html) {
        const el = document.createElement(tag);
        if (cls) el.className = cls;
        if (html != null) el.innerHTML = html;
        return el;
    }
    function fireKeyEv(key, down) {
        if (!INP) return;
        const k = String(key).toLowerCase();
        if (down) INP.keys.add(k);
        else INP.keys.delete(k);
        const BUS = global.CT_BUS;
        if (BUS && typeof BUS.emit === 'function') {
            try { BUS.emit(down ? 'input:keydown' : 'input:keyup', { key: k, synthetic: true }); } catch (_) {}
        }
    }
    function setMouseDown(down) {
        if (!INP) return;
        INP.mouse.down = !!down;
        const BUS = global.CT_BUS;
        if (BUS && typeof BUS.emit === 'function') {
            try { BUS.emit(down ? 'input:mousedown' : 'input:mouseup', { button: 0, synthetic: true }); } catch (_) {}
        }
    }
    function setTurretDelta(dx, dy) {
        const BUS = global.CT_BUS;
        if (BUS && typeof BUS.emit === 'function') {
            try { BUS.emit('aim:delta', { dx: dx, dy: dy, source: 'touch' }); } catch (_) {}
        }
        // 兼容：写入 CT_INPUT.mouse (x,y) 让炮塔直接跟随
        if (INP) {
            INP.mouse.x = clamp((INP.mouse.x || (global.innerWidth / 2)) + dx, 0, global.innerWidth);
            INP.mouse.y = clamp((INP.mouse.y || (global.innerHeight / 2)) + dy, 0, global.innerHeight);
        }
    }

    /* ---------- 样式注入 ---------- */
    function injectStyles() {
        if (document.getElementById('ct-mobile-style')) return;
        const style = document.createElement('style');
        style.id = 'ct-mobile-style';
        style.textContent =
            '#mobile-controls{position:fixed;inset:0;z-index:600;pointer-events:none;touch-action:none;user-select:none;-webkit-user-select:none}' +
            '#mobile-controls *{box-sizing:border-box;user-select:none;-webkit-user-select:none;-webkit-tap-highlight-color:transparent}' +
            '.mob-base{position:absolute;pointer-events:auto;width:140px;height:140px;border-radius:50%;background:radial-gradient(circle,rgba(0,229,255,.12),rgba(0,229,255,.04) 60%,rgba(0,0,0,.3));backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);border:1.5px solid rgba(0,229,255,.55);box-shadow:0 0 22px rgba(0,229,255,.35),inset 0 0 24px rgba(0,229,255,.18)}' +
            '.mob-base::before{content:"";position:absolute;inset:10px;border-radius:50%;border:1px dashed rgba(0,229,255,.45);animation:mob-scan 6s linear infinite}' +
            '@keyframes mob-scan{from{transform:rotate(0)}to{transform:rotate(360deg)}}' +
            '.mob-knob{position:absolute;left:50%;top:50%;width:62px;height:62px;margin:-31px 0 0 -31px;border-radius:50%;background:radial-gradient(circle,rgba(255,43,214,.9),rgba(255,43,214,.5));border:1.5px solid rgba(255,255,255,.85);box-shadow:0 0 22px rgba(255,43,214,.8),0 0 48px rgba(255,43,214,.35);transition:transform .05s ease-out}' +
            '.mob-fire{position:absolute;pointer-events:auto;width:96px;height:96px;border-radius:50%;background:conic-gradient(from 0deg,rgba(0,229,255,.5),rgba(0,229,255,.2),rgba(0,229,255,.5));border:1.5px solid rgba(0,229,255,.8);box-shadow:0 0 18px rgba(0,229,255,.6),0 0 44px rgba(0,229,255,.25);display:flex;align-items:center;justify-content:center;color:#fff;font-family:Share Tech Mono,monospace;font-weight:700;font-size:18px;text-shadow:0 0 8px rgba(0,0,0,.8)}' +
            '.mob-fire:active{transform:scale(.94);box-shadow:0 0 34px rgba(0,229,255,.85)}' +
            '.mob-skill{position:absolute;pointer-events:auto;width:68px;height:68px;border-radius:14px;background:linear-gradient(135deg,rgba(255,43,214,.45),rgba(255,43,214,.2));border:1.5px solid rgba(255,43,214,.85);box-shadow:0 0 14px rgba(255,43,214,.55);color:#fff;display:flex;align-items:center;justify-content:center;font-family:Share Tech Mono,monospace;font-weight:700;font-size:20px}' +
            '.mob-skill:active{transform:scale(.92)}' +
            '.mob-slots{position:absolute;pointer-events:none;display:flex;flex-direction:row;gap:10px}' +
            '.mob-slot{pointer-events:auto;width:52px;height:52px;border-radius:50%;background:rgba(0,0,0,.35);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);border:1.5px solid rgba(0,229,255,.55);box-shadow:0 0 10px rgba(0,229,255,.25);color:#fff;display:flex;align-items:center;justify-content:center;font-family:Share Tech Mono,monospace;font-weight:700;font-size:18px;text-shadow:0 0 6px rgba(0,0,0,.8)}' +
            '.mob-slot:active{transform:scale(.94);border-color:rgba(0,229,255,.95);box-shadow:0 0 16px rgba(0,229,255,.6)}' +
            '.mob-toggle{position:fixed;right:10px;bottom:10px;z-index:650;width:40px;height:40px;border-radius:50%;pointer-events:auto;background:rgba(0,0,0,.5);border:1.5px solid rgba(0,229,255,.6);color:#0ff;display:flex;align-items:center;justify-content:center;font-size:18px;box-shadow:0 0 10px rgba(0,229,255,.4)}';
        document.head.appendChild(style);
    }

    /* ---------- WASD 映射（摇杆方向 -> keys Set） ---------- */
    const WASDMap = [
        { k: 'w', axis: 'y', sign: -1, thr: 0.18 },
        { k: 's', axis: 'y', sign:  1, thr: 0.18 },
        { k: 'a', axis: 'x', sign: -1, thr: 0.18 },
        { k: 'd', axis: 'x', sign:  1, thr: 0.18 },
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

    /* ---------- 摇杆触摸处理 ---------- */
    function onJoyStart(touch) {
        const J = MOD.joystick;
        J.active = true;
        J.touchId = touch.identifier;
        updateJoyCenter();
        onJoyMove(touch);
    }
    function updateJoyCenter() {
        const J = MOD.joystick;
        if (!J.baseEl) return;
        const r = J.baseEl.getBoundingClientRect();
        J.cx = r.left + r.width / 2;
        J.cy = r.top + r.height / 2;
        J.radius = Math.max(36, Math.min(64, r.width * 0.38));
    }
    function onJoyMove(touch) {
        const J = MOD.joystick;
        const dx = touch.clientX - J.cx;
        const dy = touch.clientY - J.cy;
        const dist = Math.hypot(dx, dy) || 1;
        const maxR = J.radius;
        const k = Math.min(1, dist / maxR);
        const nx = (dx / dist) * k;
        const ny = (dy / dist) * k;
        if (!isFinite(nx) || !isFinite(ny)) return;
        J.dir.x = nx; J.dir.y = ny;
        if (J.knobEl) {
            const px = nx * maxR;
            const py = ny * maxR;
            J.knobEl.style.transform = 'translate(' + px.toFixed(1) + 'px,' + py.toFixed(1) + 'px)';
        }
        applyDirToKeys(nx, ny);
    }
    function onJoyEnd() {
        const J = MOD.joystick;
        J.active = false; J.touchId = null;
        J.dir.x = 0; J.dir.y = 0;
        if (J.knobEl) J.knobEl.style.transform = 'translate(0,0)';
        applyDirToKeys(0, 0);
    }

    /* ---------- 布局（响应式定位） ---------- */
    function relayout() {
        const root = document.getElementById('mobile-controls');
        if (!root) return;
        const W = global.innerWidth, H = global.innerHeight;
        const marginX = Math.max(16, Math.round(W * 0.06));
        const marginY = Math.max(16, Math.round(H * 0.08));

        // 摇杆：左下
        const base = MOD.joystick.baseEl;
        if (base) {
            base.style.left = marginX + 'px';
            base.style.bottom = marginY + 'px';
            base.style.right = 'auto';
            base.style.top = 'auto';
        }
        // 开火：右下主位
        if (MOD.fireBtn) {
            MOD.fireBtn.style.right = marginX + 'px';
            MOD.fireBtn.style.bottom = marginY + 'px';
            MOD.fireBtn.style.left = 'auto';
            MOD.fireBtn.style.top = 'auto';
        }
        // 技能：开火左上
        if (MOD.skillBtn) {
            MOD.skillBtn.style.right = (marginX + 64 + 18) + 'px';
            MOD.skillBtn.style.bottom = (marginY + 88) + 'px';
            MOD.skillBtn.style.left = 'auto';
            MOD.skillBtn.style.top = 'auto';
        }
        // 道具 slots：右上方（横向 5 个）
        const slotsWrap = root.querySelector('.mob-slots');
        if (slotsWrap) {
            slotsWrap.style.right = marginX + 'px';
            slotsWrap.style.top = Math.max(12, Math.round(H * 0.04)) + 'px';
            slotsWrap.style.left = 'auto';
            slotsWrap.style.bottom = 'auto';
            slotsWrap.style.flexDirection = 'row';
        }

        updateJoyCenter();
    }

    /* ---------- 空白瞄准区域判定 ---------- */
    function isInsideControlRegion(clientX, clientY) {
        const els = [MOD.joystick.baseEl, MOD.fireBtn, MOD.skillBtn].concat(MOD.slots);
        for (let i = 0; i < els.length; i++) {
            const el = els[i];
            if (!el) continue;
            const r = el.getBoundingClientRect();
            const pad = 10;
            if (clientX >= r.left - pad && clientX <= r.right + pad &&
                clientY >= r.top - pad && clientY <= r.bottom + pad) return true;
        }
        return false;
    }

    /* ---------- 事件：touchstart / touchmove / touchend（挂 root，不阻止多指） ---------- */
    function onTouchStart(ev) {
        if (!MOD.enabled) return;
        const J = MOD.joystick;
        for (let i = 0; i < ev.changedTouches.length; i++) {
            const t = ev.changedTouches[i];
            const tgt = t.target;
            // 摇杆
            if (J.baseEl && (tgt === J.baseEl || tgt === J.knobEl || J.baseEl.contains(tgt))) {
                if (!J.active) onJoyStart(t);
                continue;
            }
            // 开火
            if (MOD.fireBtn && (tgt === MOD.fireBtn || MOD.fireBtn.contains(tgt))) {
                setMouseDown(true);
                MOD.fireBtn.dataset.pressTouch = t.identifier;
                continue;
            }
            // 技能
            if (MOD.skillBtn && (tgt === MOD.skillBtn || MOD.skillBtn.contains(tgt))) {
                fireKeyEv('e', true);
                setTimeout(() => fireKeyEv('e', false), 40);
                continue;
            }
            // 道具
            let slotHit = false;
            for (let s = 0; s < MOD.slots.length; s++) {
                if (MOD.slots[s] && (tgt === MOD.slots[s] || MOD.slots[s].contains(tgt))) {
                    const key = String(s + 1);
                    fireKeyEv(key, true);
                    setTimeout(() => fireKeyEv(key, false), 40);
                    slotHit = true;
                    break;
                }
            }
            if (slotHit) continue;

            // 空白区域滑动瞄准
            if (!isInsideControlRegion(t.clientX, t.clientY) && !MOD.aiming.active) {
                MOD.aiming.active = true;
                MOD.aiming.touchId = t.identifier;
                MOD.aiming.lastX = t.clientX;
                MOD.aiming.lastY = t.clientY;
            }
        }
    }
    function onTouchMove(ev) {
        if (!MOD.enabled) return;
        const J = MOD.joystick;
        for (let i = 0; i < ev.changedTouches.length; i++) {
            const t = ev.changedTouches[i];
            if (J.active && J.touchId === t.identifier) {
                onJoyMove(t);
                continue;
            }
            if (MOD.aiming.active && MOD.aiming.touchId === t.identifier) {
                const dx = t.clientX - MOD.aiming.lastX;
                const dy = t.clientY - MOD.aiming.lastY;
                MOD.aiming.lastX = t.clientX;
                MOD.aiming.lastY = t.clientY;
                if (dx !== 0 || dy !== 0) setTurretDelta(dx, dy);
                continue;
            }
        }
    }
    function onTouchEnd(ev) {
        if (!MOD.enabled) return;
        const J = MOD.joystick;
        for (let i = 0; i < ev.changedTouches.length; i++) {
            const t = ev.changedTouches[i];
            if (J.active && J.touchId === t.identifier) onJoyEnd();
            if (MOD.aiming.active && MOD.aiming.touchId === t.identifier) {
                MOD.aiming.active = false; MOD.aiming.touchId = null;
            }
            if (MOD.fireBtn && String(MOD.fireBtn.dataset.pressTouch) === String(t.identifier)) {
                setMouseDown(false);
                MOD.fireBtn.dataset.pressTouch = '';
            }
        }
    }

    /* ---------- init / enable / disable ---------- */
    MOD.init = function () {
        if (MOD.inited) return MOD;
        MOD.inited = true;
        if (typeof document === 'undefined') return MOD;
        injectStyles();
        let root = document.getElementById('mobile-controls');
        if (!root) {
            root = mk('div');
            root.id = 'mobile-controls';
            root.className = 'hidden';
            (document.body || document.documentElement).appendChild(root);
        }
        // 清空占位
        while (root.firstChild) root.removeChild(root.firstChild);

        // 摇杆 base + knob
        const base = mk('div', 'mob-base');
        base.setAttribute('aria-label', '虚拟摇杆');
        const knob = mk('div', 'mob-knob');
        base.appendChild(knob);
        MOD.joystick.baseEl = base;
        MOD.joystick.knobEl = knob;
        root.appendChild(base);

        // 开火
        const fire = mk('div', 'mob-fire', 'FIRE');
        fire.setAttribute('aria-label', '开火');
        MOD.fireBtn = fire;
        root.appendChild(fire);

        // 技能
        const skill = mk('div', 'mob-skill', 'E');
        skill.setAttribute('aria-label', '技能');
        MOD.skillBtn = skill;
        root.appendChild(skill);

        // 道具 slots（5 个）
        const slotsWrap = mk('div', 'mob-slots');
        MOD.slots = [];
        for (let i = 1; i <= 5; i++) {
            const s = mk('div', 'mob-slot', String(i));
            s.setAttribute('aria-label', '道具 ' + i);
            slotsWrap.appendChild(s);
            MOD.slots.push(s);
        }
        root.appendChild(slotsWrap);

        // 绑定触摸事件（root 上，非捕获以兼容多指）
        root.addEventListener('touchstart', onTouchStart, { passive: true });
        root.addEventListener('touchmove',  onTouchMove,  { passive: true });
        root.addEventListener('touchend',       onTouchEnd, { passive: true });
        root.addEventListener('touchcancel',    onTouchEnd, { passive: true });

        // 切换按钮（右下小开关，允许手动开关）
        const tog = mk('div', 'mob-toggle', '📱');
        tog.title = '切换触屏控制';
        tog.addEventListener('click', () => MOD.enabled ? MOD.disable() : MOD.enable(), false);
        (document.body || document.documentElement).appendChild(tog);
        MOD.toggleBtn = tog;

        // resize 重新布局
        global.addEventListener('resize', relayout, { passive: true });
        global.addEventListener('orientationchange', relayout, { passive: true });

        relayout();
        return MOD;
    };

    MOD.enable = function () {
        MOD.init();
        const root = document.getElementById('mobile-controls');
        if (root) root.classList.remove('hidden');
        MOD.enabled = true;
        relayout();
        return MOD;
    };
    MOD.disable = function () {
        const root = document.getElementById('mobile-controls');
        if (root) root.classList.add('hidden');
        MOD.enabled = false;
        // 清理状态
        if (MOD.joystick.active) onJoyEnd();
        if (MOD.aiming.active) { MOD.aiming.active = false; MOD.aiming.touchId = null; }
        setMouseDown(false);
        applyDirToKeys(0, 0);
        return MOD;
    };

    MOD.autoDetect = function () {
        const isTouch = ('ontouchstart' in global) ||
            (global.navigator && global.navigator.maxTouchPoints && global.navigator.maxTouchPoints > 1);
        const narrow = global.matchMedia ? global.matchMedia('(max-width:768px)').matches : (global.innerWidth || 0) <= 768;
        if (isTouch || narrow) MOD.enable();
        return MOD;
    };

    MOD.relayout = relayout;

    global.CT_UI_MOBILE = MOD;

    /* ---------- DOM 就绪后自动初始化 + 检测 ---------- */
    function autoStart() {
        try { MOD.init(); MOD.autoDetect(); }
        catch (e) { console.warn('[CT_UI_MOBILE] autoStart failed:', e); }
    }
    if (global.document && document.readyState && document.readyState !== 'loading') {
        autoStart();
    } else if (global.addEventListener) {
        global.addEventListener('DOMContentLoaded', autoStart, { once: true });
    }

})(typeof window !== 'undefined' ? window : globalThis);

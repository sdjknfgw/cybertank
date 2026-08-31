/* ==========================================================
 * CyberTank — 主菜单 / 模式选择 / 坦克工坊
 * window.CT_UI_MENU
 * ========================================================== */
(function (global) {
    'use strict';
    const BUS = global.CT_BUS || { emit() {}, on(fn) { this._cb = fn; }, off() {} };
    /* 轻量 kv 存储：localStorage 直读直写。
     * CT_STORAGE 的 get() 无参且返回整个存档对象、没有 set(k,v) 方法，
     * 此前 `global.CT_STORAGE || {kv 兜底}` 必走 CT_STORAGE，
     * 导致金币显示/静音开关/最佳纪录/皮肤购买全部失效（set 直接抛 TypeError）。 */
    const STORE = {
        get(k, d) { try { const v = localStorage.getItem('ct_' + k); return v == null ? d : JSON.parse(v); } catch (_) { return d; } },
        set(k, v) { try { localStorage.setItem('ct_' + k, JSON.stringify(v)); } catch (_) {} }
    };
    const MODAL = global.CT_UI_MODAL;
    // 注意：不要在此处捕获 global.CT_UI_HUD —— hud.js 在本文件之后加载，加载期取到的是 undefined。
    // 需要时请在使用点实时读取 global.CT_UI_HUD。
    const MENU = {};
    let _styleInj = false;
    // p2Tank：本地双人时 P2 的车型（在坦克工坊里与 P1 用同一套卡片选择，仅 1v1 显示）
    let _state = { mode: null, difficulty: 'normal', tank: 'assault', duelOpponent: 'ai', p2Tank: 'assault' };

    const MODES = [
        { id: 'royale',   emoji: '🔥', name: '大逃杀',     desc: '毒圈不断收缩\n淘汰所有对手\n唯一生存者', best: 'ct_best_royale' },
        { id: 'kinghill', emoji: '⚔️', name: '据点争夺',   desc: '占领中央据点\n累计占领 30s 获胜\n击败据点敌军', best: 'ct_best_kh' },
        { id: 'horde',    emoji: '🧟', name: '无尽波次',   desc: '无尽敌军来袭\n生存越久分越高\n越后越凶险', best: 'ct_best_horde' },
        { id: 'duel',     emoji: '⚡', name: '1v1 竞技',    desc: '双坦克对决\n5 局 3 胜制\n操作决定胜负', best: 'ct_best_duel' },
        { id: 'kingdefend', emoji: '🛡', name: '据点守护', desc: '守护核心据点\n击退无尽攻势\n据点破则败北', best: 'ct_best_kd' },
        { id: 'online',    emoji: '🌐', name: '联机对战', desc: '1v1 实时联机\n创建/加入房间\n或快速匹配', best: 'ct_best_online' }
    ];
    const DIFFS = [
        { id: 'easy',   name: '简单' },
        { id: 'normal', name: '普通' },
        { id: 'hard',   name: '困难' },
        { id: 'night',  name: '噩梦' }
    ];
    /* ---------- 据点守护：按难度分档的计分排行 ---------- */
    const KD_DIFFS = ['easy', 'normal', 'hard', 'night'];
    function kdRecord(diff) {
        try {
            const S = global.CT_STORAGE;
            if (S && typeof S.getRecord === 'function') return S.getRecord('kingdefend_' + diff) || {};
        } catch (_) {}
        return {};
    }
    function fmtDur(sec) {
        sec = Math.max(0, Math.floor(Number(sec) || 0));
        const m = Math.floor(sec / 60), s = sec % 60;
        return (m > 0 ? m + 'm' : '') + s + 's';
    }
    /* 每辆坦克绑定专属颜色（局外不再提供金币/皮肤系统，颜色随坦克固定） */
    const TANKS = [
        { id: 'assault',  name: '突击者', role: '突击', color: '#00e5ff', stats: [70, 85, 75, 70, 65] },
        { id: 'heavy',    name: '重装甲', role: '重甲', color: '#ffb020', stats: [95, 50, 45, 90, 80] },
        { id: 'sniper',   name: '狙击手', role: '狙击', color: '#a855f7', stats: [55, 70, 90, 95, 75] },
        { id: 'engineer', name: '技师',   role: '辅助', color: '#7cf76b', stats: [65, 60, 65, 55, 95] }
    ];
    const STAT_NAMES = ['生命', '移速', '射速', '火力', '技能CD'];
    function tankById(id) { return TANKS.find(t => t.id === id) || TANKS[0]; }
    function tankColor() { return tankById(_state.tank).color; }

    /* 坦克简介文案（P1/P2 选择界面共用） */
    const TANK_INFO = {
        assault:  '突击者：高机动平衡型，适合快速突进和游击战术，技能【过载冲刺】短时间内提升移速和射速。',
        heavy:    '重装甲：厚甲高火力，移动缓慢但抗性极高，技能【能量护盾】短时免疫伤害。',
        sniper:   '狙击手：超远射程高单发伤害，操作难度高，技能【穿透弹】无视护甲贯穿 3 个目标。',
        engineer: '技师：辅助型坦克，技能CD极短，技能【修复无人机】持续回复自身和附近友军。'
    };

    /* 坦克卡片构造器（P1/P2 选择界面共用，保证风格一致：专属配色点 + 属性条 + 角色标签） */
    function ctBuildTankCard(tk, isActive, onPick) {
        const card = h('div', 'ct-tank-card' + (isActive ? ' active' : ''));
        card.style.justifyContent = 'center';
        const head = h('div', 'flex items-center justify-between');
        const nameWrap = h('div', 'flex items-center gap-2');
        const dot = h('div', 'ct-tank-dot');
        dot.style.background = tk.color;
        dot.style.color = tk.color;
        dot.title = '专属配色 ' + tk.color;
        nameWrap.appendChild(dot);
        nameWrap.appendChild(h('div', 'tc-name', tk.name));
        head.appendChild(nameWrap);
        const roleChip = h('div', 'tc-role', tk.role);
        roleChip.style.color = tk.color;
        roleChip.style.borderColor = tk.color + '66';
        roleChip.style.background = tk.color + '1f';
        head.appendChild(roleChip);
        card.appendChild(head);
        const stats = h('div', 'tc-stats');
        STAT_NAMES.forEach((nm, i) => {
            const row = h('div', 'ct-stat');
            row.appendChild(h('div', 'lbl', nm));
            const track = h('div', 'track');
            const fill = h('div', 'fill');
            fill.style.width = Math.max(4, Math.min(100, tk.stats[i] || 0)) + '%';
            fill.style.background = 'linear-gradient(90deg,' + tk.color + '99,' + tk.color + ')';
            fill.style.boxShadow = '0 0 6px ' + tk.color + '99';
            track.appendChild(fill);
            row.appendChild(track);
            row.appendChild(h('div', 'val', String(tk.stats[i])));
            stats.appendChild(row);
        });
        card.appendChild(stats);
        const applyActive = (on) => {
            if (on) {
                card.style.borderColor = tk.color;
                card.style.boxShadow = '0 0 18px ' + tk.color + '80';
                card.style.background = 'linear-gradient(160deg,' + tk.color + '26,rgba(10,16,36,.72))';
            } else { card.style.borderColor = ''; card.style.boxShadow = ''; card.style.background = ''; }
        };
        if (isActive) applyActive(true);
        card.addEventListener('click', () => {
            card.parentElement.querySelectorAll('.ct-tank-card').forEach(x => {
                x.classList.remove('active'); x.style.borderColor = ''; x.style.boxShadow = ''; x.style.background = '';
            });
            card.classList.add('active');
            applyActive(true);
            onPick(tk.id);
        });
        return card;
    }

    /* 雷达五边形绘制（按坦克 id 取色，P1/P2 选择界面共用） */
    function ctDrawRadar(canvas, tankId) {
        const tank = tankById(tankId);
        const stats = tank.stats;
        const w = canvas.width, hgt = canvas.height;
        const ctx2 = canvas.getContext('2d');
        ctx2.clearRect(0, 0, w, hgt);
        const cx = w / 2, cy = hgt / 2, R = 120, n = 5;
        const tc = tank.color;
        ctx2.strokeStyle = tc + '4d'; ctx2.lineWidth = 1;
        for (let l = 1; l <= 4; l++) {
            const r = R * l / 4;
            ctx2.beginPath();
            for (let i = 0; i <= n; i++) {
                const a = -Math.PI / 2 + i * 2 * Math.PI / n;
                const x = cx + r * Math.cos(a), y = cy + r * Math.sin(a);
                if (i === 0) ctx2.moveTo(x, y); else ctx2.lineTo(x, y);
            }
            ctx2.closePath(); ctx2.stroke();
        }
        ctx2.strokeStyle = tc + '33';
        for (let i = 0; i < n; i++) {
            const a = -Math.PI / 2 + i * 2 * Math.PI / n;
            ctx2.beginPath(); ctx2.moveTo(cx, cy);
            ctx2.lineTo(cx + R * Math.cos(a), cy + R * Math.sin(a));
            ctx2.stroke();
        }
        ctx2.beginPath();
        for (let i = 0; i <= n; i++) {
            const a = -Math.PI / 2 + i * 2 * Math.PI / n;
            const val = stats[i % n] / 100;
            const r = R * (0.4 + val * 0.6);
            const x = cx + r * Math.cos(a), y = cy + r * Math.sin(a);
            if (i === 0) ctx2.moveTo(x, y); else ctx2.lineTo(x, y);
        }
        ctx2.closePath();
        ctx2.fillStyle = tc + '59'; ctx2.fill();
        ctx2.strokeStyle = tc; ctx2.lineWidth = 2;
        ctx2.shadowBlur = 12; ctx2.shadowColor = tc; ctx2.stroke();
        ctx2.shadowBlur = 0;
        for (let i = 0; i < n; i++) {
            const a = -Math.PI / 2 + i * 2 * Math.PI / n;
            const val = stats[i] / 100;
            const r = R * (0.4 + val * 0.6);
            const x = cx + r * Math.cos(a), y = cy + r * Math.sin(a);
            ctx2.fillStyle = tc;
            ctx2.beginPath(); ctx2.arc(x, y, 4, 0, Math.PI * 2); ctx2.fill();
            const la = a, lr = R + 22;
            ctx2.fillStyle = '#a9b7d1';
            ctx2.font = '13px "Share Tech Mono", monospace';
            ctx2.textAlign = 'center'; ctx2.textBaseline = 'middle';
            ctx2.fillText(STAT_NAMES[i], cx + lr * Math.cos(la), cy + lr * Math.sin(la));
            ctx2.fillStyle = tc;
            ctx2.font = '12px "JetBrains Mono", monospace';
            ctx2.fillText(stats[i], cx + (lr + 14) * Math.cos(la), cy + (lr + 14) * Math.sin(la));
        }
    }

    /* ---------- 样式注入 ---------- */
    function injectStyle() {
        if (_styleInj) return; _styleInj = true;
        const s = document.createElement('style');
        s.textContent =
            '.ct-menu-bg{position:fixed;inset:0;z-index:0;overflow:hidden;background:radial-gradient(ellipse at 50% 30%,#0a1840 0%,#05070f 70%)}' +
            '.ct-grid-svg{position:absolute;inset:0;width:100%;height:100%;opacity:.45}' +
            '.ct-logo-glitch{font-family:"Share Tech Mono",monospace;font-size:clamp(42px,7vw,88px);font-weight:700;letter-spacing:.08em;color:var(--neon-cyan);text-shadow:0 0 14px rgba(0,229,255,.9),0 0 36px rgba(0,229,255,.5),0 0 80px rgba(0,229,255,.2);line-height:1.1;animation:logoGlitch 3s infinite}' +
            '@keyframes logoGlitch{0%,92%,100%{transform:none;filter:none}93%{transform:translate(-2px,1px);filter:hue-rotate(10deg)}95%{transform:translate(2px,-1px);filter:hue-rotate(-10deg)}97%{transform:translate(-1px,-2px)}98%{transform:translate(1px,2px)}}' +
            '.ct-logo-sub{font-family:"Share Tech Mono",monospace;font-size:clamp(14px,1.5vw,20px);letter-spacing:.4em;color:var(--neon-magenta);text-shadow:0 0 8px rgba(255,43,214,.8);margin-top:10px}' +
            '.ct-menu-btn{width:330px;max-width:90vw;height:50px;font-family:"Share Tech Mono",monospace;font-size:16px;border-radius:12px;display:flex;align-items:center;justify-content:flex-start;padding:0 28px;gap:16px;cursor:pointer;transition:all .18s ease;background:linear-gradient(135deg,rgba(0,229,255,.10),rgba(255,43,214,.08));border:1px solid var(--panel-border);color:var(--text-hi);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);position:relative;overflow:hidden}' +
            '.ct-menu-btn:hover{transform:translateX(6px);border-color:var(--neon-cyan);box-shadow:0 0 14px rgba(0,229,255,.55),0 0 36px rgba(0,229,255,.28)}' +
            '.ct-menu-btn:active{transform:scale(.98)}' +
            '.ct-menu-btn .icon{font-size:22px;filter:drop-shadow(0 0 6px var(--neon-cyan))}' +
            '.ct-mode-card{width:186px;height:248px;position:relative;background:var(--panel-bg);border:1px solid var(--panel-border);border-radius:14px;backdrop-filter:blur(12px);padding:14px;display:flex;flex-direction:column;align-items:center;text-align:center;cursor:pointer;transition:all .22s ease;overflow:hidden}' +
            '.ct-mode-card:hover{transform:scale(1.06);border-color:var(--neon-cyan);box-shadow:0 0 14px rgba(0,229,255,.55),0 0 36px rgba(0,229,255,.28)}' +
            '.ct-mode-card.selected{border-color:var(--neon-cyan);box-shadow:0 0 18px rgba(0,229,255,.7);background:linear-gradient(180deg,rgba(0,229,255,.14),var(--panel-bg))}' +
            '.ct-mode-card .emoji{font-size:38px;margin:8px 0 6px;filter:drop-shadow(0 0 12px rgba(0,229,255,.4))}' +
            '.ct-mode-card .mname{font-family:"Share Tech Mono",monospace;font-size:17px;color:var(--text-hi);font-weight:700}' +
            '.ct-mode-card .mdesc{font-size:11px;color:var(--text-mid);white-space:pre-line;margin-top:8px;line-height:1.5}' +
            '.ct-mode-card .mbest{margin-top:auto;font-family:"JetBrains Mono",monospace;font-size:12px;color:var(--neon-cyan);text-shadow:0 0 6px rgba(0,229,255,.7)}' +
            '.ct-tank-card{position:relative;display:flex;flex-direction:column;gap:8px;padding:12px 14px;border-radius:12px;cursor:pointer;background:rgba(10,16,36,.6);border:1px solid var(--panel-border);transition:all .18s ease;overflow:hidden}' +
            '.ct-tank-card:hover{transform:translateY(-3px);border-color:rgba(0,229,255,.55);box-shadow:0 8px 22px rgba(0,229,255,.22)}' +
            '.ct-tank-card.active{border-color:var(--neon-cyan);background:linear-gradient(160deg,rgba(0,229,255,.16),rgba(10,16,36,.72));box-shadow:0 0 18px rgba(0,229,255,.55)}' +
            '.ct-tank-card .tc-name{font-family:"Share Tech Mono",monospace;font-size:18px;font-weight:700;color:var(--text-hi)}' +
            '.ct-tank-card .tc-role{font-size:11px;padding:2px 10px;border-radius:999px;background:rgba(255,43,214,.16);color:var(--neon-magenta);border:1px solid rgba(255,43,214,.4);white-space:nowrap}' +
            '.ct-tank-card .tc-stats{display:flex;flex-direction:column;gap:6px;margin-top:2px}' +
            '.ct-stat{display:grid;grid-template-columns:52px 1fr 28px;align-items:center;gap:8px;font-size:11px}' +
            '.ct-stat .lbl{color:var(--text-mid);font-family:"JetBrains Mono",monospace}' +
            '.ct-stat .track{height:7px;border-radius:4px;background:rgba(255,255,255,.08);overflow:hidden}' +
            '.ct-stat .fill{height:100%;border-radius:4px;background:linear-gradient(90deg,#00e5ff,#36d1ff);box-shadow:0 0 6px rgba(0,229,255,.6)}' +
            '.ct-stat .val{color:var(--text-hi);text-align:right;font-family:"JetBrains Mono",monospace}' +
            '.ct-ws-title{font-family:"Share Tech Mono",monospace;font-size:13px;letter-spacing:.25em;color:var(--neon-cyan)}' +
            '.ct-ws-desc{margin-top:14px;padding:12px 14px;border-radius:10px;background:rgba(0,229,255,.06);border:1px solid rgba(0,229,255,.18);color:var(--text-mid);font-size:13px;line-height:1.6}' +
            '.ct-buff-bar-el{display:flex;gap:6px;justify-content:center;padding:4px 10px}' +
            '.ct-buff-el{min-width:44px;height:44px;border-radius:10px;border:1px solid var(--neon-cyan);background:rgba(0,229,255,.08);position:relative;display:flex;align-items:center;justify-content:center;font-size:20px}' +
            '.ct-buff-el .stk{position:absolute;top:-6px;right:-6px;background:var(--neon-magenta);color:#fff;font-family:"JetBrains Mono",monospace;font-size:11px;font-weight:700;padding:1px 5px;border-radius:999px;box-shadow:0 0 6px rgba(255,43,214,.6)}' +
            '.ct-particle{position:absolute;border-radius:50%;background:rgba(0,229,255,.7);box-shadow:0 0 8px rgba(0,229,255,.8);animation:floatP linear infinite;pointer-events:none}' +
            '@keyframes floatP{0%{transform:translateY(0) translateX(0);opacity:0}10%{opacity:.8}90%{opacity:.8}100%{transform:translateY(-100vh) translateX(40px);opacity:0}}' +
            '.ct-glitch-bg{position:absolute;inset:0;background:repeating-linear-gradient(0deg,transparent 0,transparent 3px,rgba(0,229,255,.06) 3px,rgba(0,229,255,.06) 4px);animation:bgShift 14s linear infinite;pointer-events:none}' +
            '@keyframes bgShift{0%{background-position:0 0}100%{background-position:0 40px}}' +
            /* 自适应缩放：内容整体等比缩放至刚好放进视口，任何窗口尺寸都能看到全貌 */
            '.ct-fit{transform-origin:center center;will-change:transform}' +
            '.ct-fitbox{width:100%;height:100%;display:flex;align-items:center;justify-content:center;overflow:hidden}' +
            /* 全局隐藏滚动条（含 WebKit / Firefox / Edge 旧内核） */
            '*{scrollbar-width:none;-ms-overflow-style:none}' +
            '*::-webkit-scrollbar{width:0;height:0;display:none}' +
            '.ct-tank-dot{width:11px;height:11px;border-radius:50%;flex:0 0 auto;box-shadow:0 0 8px currentColor}' +
            '.ct-color-chip{display:inline-flex;align-items:center;gap:6px;font-family:"JetBrains Mono",monospace;font-size:11px;color:var(--text-mid)}';
        document.head.appendChild(s);
    }

    function h(tag, cls, txt) {
        const el = document.createElement(tag);
        if (cls) el.className = cls;
        if (txt != null && typeof txt === 'string') {
            if (txt.includes('<')) el.innerHTML = txt; else el.textContent = txt;
        }
        return el;
    }
    function corners(el) {
        const mk = (c) => { const s = h('span', c); return s; };
        el.appendChild(mk('absolute top-0 left-0 w-4 h-4 border-t-2 border-l-2 border-neon-cyan rounded-tl-[14px] pointer-events-none'));
        el.appendChild(mk('absolute top-0 right-0 w-4 h-4 border-t-2 border-r-2 border-neon-magenta rounded-tr-[14px] pointer-events-none'));
        el.appendChild(mk('absolute bottom-0 left-0 w-4 h-4 border-b-2 border-l-2 border-neon-magenta rounded-bl-[14px] pointer-events-none'));
        el.appendChild(mk('absolute bottom-0 right-0 w-4 h-4 border-b-2 border-r-2 border-neon-cyan rounded-br-[14px] pointer-events-none'));
    }

    /* ---------- 自适应缩放：消除滚动条，保证任何窗口都能看到全貌 ----------
     * 用法：外层 box 铺满视口且 overflow:hidden，内层 inner 按自然尺寸布局，
     * 这里按 min(可用宽/内容宽, 可用高/内容高) 等比缩放 inner，使其完整可见。 */
    const _fitters = [];
    let _resizeBound = false;
    function bindResize() {
        if (_resizeBound) return;
        _resizeBound = true;
        window.addEventListener('resize', function () {
            for (let i = _fitters.length - 1; i >= 0; i--) {
                let alive = false;
                try { alive = _fitters[i]() !== false; } catch (_) { alive = false; }
                if (!alive) _fitters.splice(i, 1);
            }
        });
    }
    function autofit(inner, box, maxScale) {
        if (!inner || !box) return function () {};
        const MAX = (typeof maxScale === 'number' && maxScale > 0) ? maxScale : 1.15;
        const fit = function () {
            if (!inner.isConnected || !box.isConnected) return false;
            const aw = box.clientWidth, ah = box.clientHeight;
            const cw = inner.offsetWidth, ch = inner.offsetHeight;
            if (!aw || !ah || !cw || !ch) return true;
            let k = Math.min(aw / cw, ah / ch);
            if (!isFinite(k) || k <= 0) k = 1;
            k = Math.min(MAX, k);
            inner.style.transform = 'scale(' + k.toFixed(4) + ')';
            return true;
        };
        bindResize();
        _fitters.push(fit);
        fit();
        requestAnimationFrame(fit);
        setTimeout(fit, 150);
        return fit;
    }
    /* 构建一个「铺满视口 + 居中 + 自适应缩放」的容器，返回内层内容节点 */
    function fitBox(parent, innerCls) {
        const box = h('div', 'ct-fitbox');
        const inner = h('div', 'ct-fit ' + (innerCls || ''));
        box.appendChild(inner);
        parent.appendChild(box);
        return { box: box, inner: inner };
    }

    /* ---------- init ---------- */
    MENU.init = function () {
        injectStyle();
        if (BUS && typeof BUS.on === 'function') {
            BUS.on('ui:showMainMenu', () => MENU.renderMainMenu());
        }
        // 兼容简单 BUS
        if (BUS && typeof BUS._cb === 'function') { /* already bound */ }
    };

    /* ---------- 主菜单 ---------- */
    MENU.renderMainMenu = function () {
        injectStyle();
        const wrap = document.getElementById('main-menu-wrap');
        if (!wrap) return;
        wrap.className = 'pointer-events-auto absolute inset-0 z-40 w-screen h-screen anim-fadeIn';
        wrap.innerHTML = '';

        // 背景：SVG 网格 + 粒子 + 全息抖动
        const bg = h('div', 'ct-menu-bg');
        const gridSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        gridSvg.setAttribute('class', 'ct-grid-svg');
        gridSvg.innerHTML = '<defs><pattern id="g" width="50" height="50" patternUnits="userSpaceOnUse"><path d="M 50 0 L 0 0 0 50" fill="none" stroke="rgba(0,229,255,0.18)" stroke-width="1"/></pattern></defs><rect width="100%" height="100%" fill="url(#g)"/>';
        bg.appendChild(gridSvg);
        // 漂浮粒子 12 个
        for (let i = 0; i < 12; i++) {
            const p = h('div', 'ct-particle');
            const sz = 2 + Math.random() * 4;
            p.style.width = sz + 'px'; p.style.height = sz + 'px';
            p.style.left = Math.random() * 100 + '%';
            p.style.bottom = '-10px';
            p.style.animationDuration = (8 + Math.random() * 14) + 's';
            p.style.animationDelay = (-Math.random() * 20) + 's';
            if (Math.random() > .5) p.style.background = 'rgba(255,43,214,.7)';
            bg.appendChild(p);
        }
        bg.appendChild(h('div', 'ct-glitch-bg'));
        wrap.appendChild(bg);

        // Logo 居中（自适应缩放，杜绝滚动条）
        const fb = fitBox(wrap, 'relative z-10 flex flex-col items-center justify-center px-6');
        const center = fb.inner;
        const logo = h('div', 'text-center mb-8');
        logo.appendChild(h('div', 'ct-logo-glitch', 'CYBER::TANK'));
        logo.appendChild(h('div', 'ct-logo-sub', '—  NEON BATTLEGROUND  v1.0  —'));
        center.appendChild(logo);

        // 4 按钮（坦克工坊入口已移除；坦克/皮肤选择保留在「开始游戏」流程内）
        const btns = [
            { icon: '▶', text: '开始游戏',   act: () => MENU.renderModeSelect() },
            { icon: '⚙', text: '游戏设置',   act: () => MODAL && MODAL.showSettings() },
            { icon: '🏆', text: '排行榜',     act: () => showLeaderboard() },
            { icon: '📖', text: '操作说明',   act: () => MODAL && MODAL.showControlsHelp() },
            { icon: '🧱', text: '方块图鉴',   act: () => MODAL && MODAL.showBlockGuide && MODAL.showBlockGuide() },
            { icon: '🎯', text: '新手训练',   act: () => openTutorial() },
            { icon: '💾', text: '存档管理',   act: () => openSaveManager() }
        ];
        const btnCol = h('div', 'flex flex-col gap-4 items-center');
        btns.forEach((b) => {
            const btn = h('button', 'ct-menu-btn');
            btn.innerHTML = '<span class="icon">' + b.icon + '</span><span>' + b.text + '</span>';
            btn.addEventListener('click', b.act);
            btnCol.appendChild(btn);
        });
        center.appendChild(btnCol);
        autofit(fb.inner, fb.box, 1.05);

        // 左下角：指挥官信息
        const leftInfo = h('div', 'absolute bottom-6 left-6 z-20 flex items-center gap-4 font-tech');
        const commander = h('div', 'flex flex-col');
        commander.appendChild(h('div', 'text-text-lo text-xs tracking-widest', 'COMMANDER'));
        commander.appendChild(h('div', 'text-text-hi font-bold text-lg', STORE.get('player_name', '玩家001')));
        leftInfo.appendChild(commander);
        leftInfo.appendChild(h('div', 'text-text-lo text-xs ml-2 font-mono', 'v1.0'));
        wrap.appendChild(leftInfo);

        // 右下角：音效 + 全屏
        const rightInfo = h('div', 'absolute bottom-6 right-6 z-20 flex items-center gap-3');
        const soundBtn = h('button', 'w-11 h-11 rounded-lg border border-neon-cyan/40 flex items-center justify-center text-neon-cyan hover:bg-neon-cyan/10 transition-all text-xl');
        const muted = !!STORE.get('mute_all', false);
        soundBtn.innerHTML = muted ? '🔇' : '🔊';
        soundBtn.title = '音效开关';
        soundBtn.addEventListener('click', () => {
            const nm = !STORE.get('mute_all', false);
            STORE.set('mute_all', nm);
            soundBtn.innerHTML = nm ? '🔇' : '🔊';
            /* CT_AUDIO 的方法名是 mute(b)，此前误调 setMute（不存在）导致静音开关无效 */
            global.CT_AUDIO && typeof global.CT_AUDIO.mute === 'function' && global.CT_AUDIO.mute(nm);
        });
        rightInfo.appendChild(soundBtn);
        const fsBtn = h('button', 'w-11 h-11 rounded-lg border border-neon-cyan/40 flex items-center justify-center text-neon-cyan hover:bg-neon-cyan/10 transition-all text-xl');
        fsBtn.innerHTML = '⛶';
        fsBtn.title = '全屏切换';
        fsBtn.addEventListener('click', () => {
            if (!document.fullscreenElement) document.documentElement.requestFullscreen && document.documentElement.requestFullscreen().catch(() => {});
            else document.exitFullscreen && document.exitFullscreen().catch(() => {});
        });
        rightInfo.appendChild(fsBtn);

        // 画质 / 性能模式循环按钮（D-13）：低(🐢)/中(⚡)/高(🔥) 依次切换并持久化
        const qBtn = h('button', 'w-11 h-11 rounded-lg border border-neon-cyan/40 flex items-center justify-center text-neon-cyan hover:bg-neon-cyan/10 transition-all text-xl');
        const qOrder = ['low', 'med', 'high'];
        const qIcon = { low: '🐢', med: '⚡', high: '🔥' };
        const qName = { low: '低', med: '中', high: '高' };
        const syncQBtn = () => {
            const q = currentQuality();
            qBtn.innerHTML = qIcon[q] || '🔥';
            qBtn.title = '画质：' + (qName[q] || q) + '（点击切换）';
        };
        syncQBtn();
        qBtn.addEventListener('click', () => {
            const cur = currentQuality();
            const next = qOrder[(qOrder.indexOf(cur) + 1) % qOrder.length];
            try {
                if (global.CT_STORAGE && typeof global.CT_STORAGE.saveSettings === 'function') global.CT_STORAGE.saveSettings({ quality: next });
                else if (global.CT_RENDERER && typeof global.CT_RENDERER.setQuality === 'function') global.CT_RENDERER.setQuality(next);
            } catch (_) {}
            syncQBtn();
            _toastSafe('画质已切换：' + (qName[next] || next));
        });
        rightInfo.appendChild(qBtn);

        wrap.appendChild(rightInfo);

        BUS && BUS.emit && BUS.emit('ui:mainMenuShown');
    };

    /* ---------- 排行榜 ---------- */
    function showLeaderboard() {
        const body = h('div');
        const tbl = h('div', 'border border-neon-cyan/30 rounded-lg overflow-hidden');
        const th = h('div', 'flex px-4 py-3 bg-neon-cyan/15 font-tech text-glow-cyan border-b border-neon-cyan/30');
        th.appendChild(h('span', 'w-20', '排名'));
        th.appendChild(h('span', 'flex-1', '模式'));
        th.appendChild(h('span', 'flex-1 text-right font-mono text-glow-gold', '最佳纪录'));
        tbl.appendChild(th);
        MODES.forEach((m, i) => {
            const best = STORE.get(m.best, 0);
            const tr = h('div', 'flex px-4 py-3 ' + (i % 2 ? 'bg-neon-cyan/5' : '') + ' items-center');
            const rank = ['🥇', '🥈', '🥉', '4', '5'][i];
            tr.appendChild(h('span', 'w-20 font-mono text-lg', rank));
            tr.appendChild(h('span', 'flex-1 flex items-center gap-2', '<span class="text-2xl">' + m.emoji + '</span>' + m.name));
            tr.appendChild(h('span', 'flex-1 text-right font-mono text-glow-gold text-lg', best > 0 ? best.toLocaleString() : '— — —'));
            tbl.appendChild(tr);
        });
        body.appendChild(tbl);

        /* 据点守护 · 分难度计分排行（各难度独立记录，互不覆盖） */
        const kdWrap = h('div', 'mt-5');
        kdWrap.appendChild(h('div', 'font-tech text-glow-cyan text-sm tracking-widest mb-2', '🛡 据点守护 · 难度排行'));
        const kdTbl = h('div', 'border border-neon-cyan/25 rounded-lg overflow-hidden');
        const kdTh = h('div', 'flex px-4 py-2 bg-neon-cyan/10 font-tech text-[11px] text-text-lo border-b border-neon-cyan/25');
        kdTh.appendChild(h('span', 'w-16', '难度'));
        kdTh.appendChild(h('span', 'flex-1 text-right', '最高分'));
        kdTh.appendChild(h('span', 'flex-1 text-right', '最佳波次'));
        kdTh.appendChild(h('span', 'flex-1 text-right', '最长坚守'));
        kdTh.appendChild(h('span', 'w-14 text-right', '评级'));
        kdTbl.appendChild(kdTh);
        KD_DIFFS.forEach((id, i) => {
            const d = DIFFS.filter((x) => x.id === id)[0] || { name: id };
            const r = kdRecord(id);
            const tr = h('div', 'flex px-4 py-2 ' + (i % 2 ? 'bg-neon-cyan/5' : '') + ' items-center text-sm');
            tr.appendChild(h('span', 'w-16', d.name));
            tr.appendChild(h('span', 'flex-1 text-right font-mono text-glow-gold', (r.highScore || 0) > 0 ? (r.highScore || 0).toLocaleString() : '—'));
            tr.appendChild(h('span', 'flex-1 text-right font-mono', (r.bestWave || 0) > 0 ? String(r.bestWave || 0) : '—'));
            tr.appendChild(h('span', 'flex-1 text-right font-mono', (r.bestTime || 0) > 0 ? fmtDur(r.bestTime) : '—'));
            tr.appendChild(h('span', 'w-14 text-right font-mono text-glow-cyan', r.bestRating || '—'));
            kdTbl.appendChild(tr);
        });
        kdWrap.appendChild(kdTbl);
        body.appendChild(kdWrap);

        MODAL.show({
            title: '🏆 全球排行榜',
            body: body,
            className: 'cyan',
            size: 'md',
            buttons: [{ label: '关闭', level: 'primary', onClick: (_, c) => c() }]
        });
    }

    /* ---------- 画质读取 / 轻量 toast ---------- */
    function currentQuality() {
        try {
            const S = global.CT_STORAGE;
            if (S && typeof S.getSettings === 'function') {
                const q = S.getSettings().quality;
                if (q === 'low' || q === 'med' || q === 'high') return q;
            }
        } catch (_) {}
        return 'high';
    }
    function _toastSafe(m) {
        try { if (global.CT_TOAST) global.CT_TOAST(m, 'info'); } catch (_) {}
    }

    /* ---------- 新手训练 / 操作教学（D-02） ---------- */
    function openTutorial() {
        const body = h('div', 'text-sm text-text-mid leading-relaxed');
        body.innerHTML =
            '<div class="mb-3 text-text-hi font-tech tracking-widest">🎯 操作教学</div>' +
            '<div class="grid grid-cols-2 gap-x-6 gap-y-2">' +
            '<div>移动（P1）：<b class="text-neon-cyan">W A S D</b></div>' +
            '<div>开火（P1）：<b class="text-neon-cyan">空格 / J / 鼠标左键</b></div>' +
            '<div>技能（P1）：<b class="text-neon-cyan">E / K</b></div>' +
            '<div>使用道具：<b class="text-neon-cyan">1 ~ 5</b></div>' +
            '<div>交互 / 商店：<b class="text-neon-cyan">F</b></div>' +
            '<div>地图：<b class="text-neon-cyan">M</b></div>' +
            '<div>暂停：<b class="text-neon-cyan">Esc</b></div>' +
            '<div>瞄准：<b class="text-neon-cyan">移动鼠标</b></div>' +
            '</div>' +
            '<div class="mt-4 p-3 rounded-lg bg-neon-gold/5 border border-neon-gold/25 text-xs leading-relaxed">' +
            '👥 <b>本地双人（仅 1v1）</b>：P2 用右侧键盘独立操控——' +
            '移动 <b class="text-neon-gold">↑ ↓ ← →</b>、开火 <b class="text-neon-gold">Enter</b>、技能 <b class="text-neon-gold">右 Shift</b>。' +
            'P1 与 P2 可在工坊分别挑选车型（P2 默认跟随 P1）。</div>' +
            '<div class="mt-2 p-3 rounded-lg bg-neon-cyan/5 border border-neon-cyan/20 text-xs leading-relaxed">' +
            '💡 提示：大逃杀注意毒圈收缩、尽早进圈；据点争夺站上据点 3 秒起开始累计积分；' +
            '移动端会自动启用摇杆与触控开火，并在瞄准时提供辅助磁吸。</div>';
        MODAL.show({
            title: '🎯 新手训练',
            body: body,
            className: 'cyan',
            size: 'md',
            buttons: [{ label: '我知道了', level: 'primary', onClick: (_, c) => c() }]
        });
    }

    /* ---------- 存档管理：导出 / 导入 / 云端（D-05） ---------- */
    function openSaveManager() {
        const body = h('div', 'flex flex-col gap-3 text-sm');
        const ta = h('textarea', 'w-full h-32 rounded-lg bg-black/40 border border-neon-cyan/30 p-2 text-xs font-mono text-neon-cyan');
        ta.placeholder = '点击「导出存档」生成文本，或粘贴他人存档后点击「导入存档」';
        const status = h('div', 'text-xs text-text-lo', '本地存档保存在浏览器 localStorage。');

        const exportBtn = h('button', 'ct-neon-btn btn-primary !h-10', '⬇ 导出存档');
        exportBtn.addEventListener('click', () => {
            try {
                const ST = global.CT_STORAGE;
                const txt = (ST && typeof ST.exportSave === 'function') ? ST.exportSave() : '';
                ta.value = txt;
                if (txt) { ta.select(); }
                status.textContent = txt ? '已生成存档文本，已自动选中，可复制保存。' : '导出失败：未找到存档接口。';
                if (txt) _toastSafe('存档已导出');
            } catch (e) { status.textContent = '导出失败：' + (e && e.message ? e.message : e); }
        });
        const importBtn = h('button', 'ct-neon-btn btn-ghost !h-10', '⬆ 导入存档');
        importBtn.addEventListener('click', () => {
            try {
                const ST = global.CT_STORAGE;
                const txt = ta.value.trim();
                if (!txt) { status.textContent = '请先粘贴存档文本。'; return; }
                const ok = (ST && typeof ST.importSave === 'function') ? ST.importSave(txt) : false;
                status.textContent = ok ? '导入成功，进度已恢复！' : '导入失败：文本格式不正确。';
                if (ok) _toastSafe('存档已导入');
            } catch (e) { status.textContent = '导入失败：' + (e && e.message ? e.message : e); }
        });
        const cloudBtn = h('button', 'ct-neon-btn btn-ghost !h-10', '☁ 云端同步（需登录）');
        cloudBtn.addEventListener('click', () => {
            try {
                const ST = global.CT_STORAGE;
                if (ST && typeof ST.syncToCloud === 'function') ST.syncToCloud();
                else status.textContent = '云端同步需要登录账号，当前为本地存档（云端功能预留）。';
            } catch (_) {}
        });

        body.appendChild(status);
        const row = h('div', 'flex gap-2 flex-wrap');
        row.appendChild(exportBtn); row.appendChild(importBtn); row.appendChild(cloudBtn);
        body.appendChild(row);
        body.appendChild(ta);

        MODAL.show({
            title: '💾 存档管理',
            body: body,
            className: 'cyan',
            size: 'md',
            buttons: [{ label: '关闭', level: 'primary', onClick: (_, c) => c() }]
        });
    }

    /* ---------- 模式选择 ---------- */
    MENU.renderModeSelect = function () {
        injectStyle();
        const wrap = document.getElementById('main-menu-wrap');
        if (!wrap) return;
        wrap.className = 'pointer-events-auto absolute inset-0 z-40 w-screen h-screen anim-fadeIn';
        wrap.innerHTML = '';

        const bg = h('div', 'ct-menu-bg');
        const gridSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        gridSvg.setAttribute('class', 'ct-grid-svg');
        gridSvg.innerHTML = '<defs><pattern id="g2" width="50" height="50" patternUnits="userSpaceOnUse"><path d="M 50 0 L 0 0 0 50" fill="none" stroke="rgba(255,43,214,0.15)" stroke-width="1"/></pattern></defs><rect width="100%" height="100%" fill="url(#g2)"/>';
        bg.appendChild(gridSvg);
        wrap.appendChild(bg);

        /* 自适应容器：内容整体缩放到视口内，不再出现滚动条 */
        const fb = fitBox(wrap, 'relative z-10 flex flex-col items-center py-5 px-6');
        const container = fb.inner;
        const title = h('div', 'text-center mb-5');
        title.appendChild(h('h2', 'font-tech text-[2rem] text-glow-magenta tracking-widest', '选择模式'));
        title.appendChild(h('div', 'text-text-lo text-xs font-mono mt-1', 'SELECT GAME MODE'));
        container.appendChild(title);

        // 模式卡 5 张
        if (!_state.mode && MODES.length) _state.mode = MODES[0].id;
        const cardRow = h('div', 'flex flex-wrap gap-4 justify-center mb-6 max-w-[1080px]');
        MODES.forEach((m) => {
            const card = h('div', 'ct-mode-card' + (_state.mode === m.id ? ' selected' : ''));
            corners(card);
            card.appendChild(h('div', 'emoji', m.emoji));
            card.appendChild(h('div', 'mname', m.name));
            card.appendChild(h('div', 'mdesc', m.desc));
            const best = STORE.get(m.best, 0);
            card.appendChild(h('div', 'mbest', best > 0 ? '最佳: ' + best.toLocaleString() : '尚未通关'));
            card.addEventListener('click', () => {
                _state.mode = m.id;
                cardRow.querySelectorAll('.ct-mode-card').forEach(c => c.classList.remove('selected'));
                card.classList.add('selected');
                updateDuelOpponentUI();
            });
            cardRow.appendChild(card);
        });
        container.appendChild(cardRow);

        // 对手选择 + 本地双人提示（仅 1v1 模式显示，提供显式入口）
        const duelCtrl = h('div', 'flex flex-col items-center gap-2 mt-1');
        const duelHint = h('div', 'text-xs text-text-lo font-mono');
        duelHint.innerHTML = '1v1 竞技：选择对手类型；本地双人时 <b class="text-neon-cyan">P2 用 方向键 + Enter / 右Shift</b>';
        const oppRow = h('div', 'flex items-center gap-3');
        const oppLbl = h('span', 'text-xs text-text-mid font-tech tracking-widest', '对手');
        const chipAi = h('div', 'ct-chip' + (_state.duelOpponent === 'ai' ? ' active' : ''), '🤖 AI 电脑');
        const chipLocal = h('div', 'ct-chip' + (_state.duelOpponent === 'local' ? ' active' : ''), '👥 本地双人');
        oppRow.appendChild(oppLbl); oppRow.appendChild(chipAi); oppRow.appendChild(chipLocal);

        /* P2 车型不在本页选择 —— 与 P1 保持一致，统一在「坦克工坊」页用同一套卡片挑选（仅 1v1 显示） */
        function syncOppChips() {
            if (_state.duelOpponent === 'local') { chipLocal.classList.add('active'); chipAi.classList.remove('active'); }
            else { chipAi.classList.add('active'); chipLocal.classList.remove('active'); }
            updateDuelOpponentUI();
        }
        chipAi.addEventListener('click', () => { _state.duelOpponent = 'ai'; syncOppChips(); });
        chipLocal.addEventListener('click', () => { _state.duelOpponent = 'local'; syncOppChips(); });

        duelCtrl.appendChild(duelHint); duelCtrl.appendChild(oppRow);
        container.appendChild(duelCtrl);
        const duelCtrlWrap = duelCtrl;
        function updateDuelOpponentUI() {
            duelCtrlWrap.style.display = (_state.mode === 'duel') ? 'flex' : 'none';
            duelHint.innerHTML = (_state.duelOpponent === 'local')
                ? '本地双人：<b class="text-neon-cyan">P2 用 方向键 + Enter / 右Shift</b>；下一步可在工坊里为 P1 / P2 分别挑选车型'
                : '1v1 竞技：选择对手类型；选 <b class="text-neon-cyan">本地双人</b> 后可同屏对战';
        }
        updateDuelOpponentUI();

        // 难度
        const diffWrap = h('div', 'mb-6 flex flex-col items-center gap-2');
        diffWrap.appendChild(h('div', 'text-text-mid font-tech tracking-widest text-sm', 'DIFFICULTY'));
        const diffChips = h('div', 'flex gap-3');
        DIFFS.forEach((d) => {
            const chip = h('div', 'ct-chip' + (_state.difficulty === d.id ? ' active' : ''), d.name);
            chip.addEventListener('click', () => {
                _state.difficulty = d.id;
                diffChips.querySelectorAll('.ct-chip').forEach(c => c.classList.remove('active'));
                chip.classList.add('active');
            });
            diffChips.appendChild(chip);
        });
        diffWrap.appendChild(diffChips);
        container.appendChild(diffWrap);

        // 底部按钮
        const footers = h('div', 'flex gap-4');
        const back = h('button', 'ct-neon-btn btn-ghost !px-6', '← 返回主菜单');
        back.addEventListener('click', () => MENU.renderMainMenu());
        footers.appendChild(back);
        const confirm = h('button', 'ct-neon-btn btn-primary !px-8 !text-lg !h-14', '选择坦克 →');
        confirm.addEventListener('click', () => {
            if (!_state.mode) {
                MODAL && MODAL.showToast('请先选择一个模式', 'warn');
                return;
            }
            MENU.renderTankWorkshop(_state.mode);
        });
        footers.appendChild(confirm);
        container.appendChild(footers);
        autofit(fb.inner, fb.box, 1.1);
    };

    /* ---------- 坦克工坊 ---------- */
    MENU.renderTankWorkshop = function (selectedMode) {
        injectStyle();
        if (selectedMode) _state.mode = selectedMode;
        // 本地双人（仅 1v1）：拆成两个独立选择界面，依次让 P1 / P2 各自挑选坦克
        if (_state.mode === 'duel' && _state.duelOpponent === 'local') {
            MENU._renderDuelTankPick('p1');
            return;
        }
        const wrap = document.getElementById('main-menu-wrap');
        if (!wrap) return;
        wrap.className = 'pointer-events-auto absolute inset-0 z-40 w-screen h-screen anim-fadeIn';
        wrap.innerHTML = '';
        const bg = h('div', 'ct-menu-bg');
        const gridSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        gridSvg.setAttribute('class', 'ct-grid-svg');
        gridSvg.innerHTML = '<defs><pattern id="g3" width="50" height="50" patternUnits="userSpaceOnUse"><path d="M 50 0 L 0 0 0 50" fill="none" stroke="rgba(255,201,60,0.12)" stroke-width="1"/></pattern></defs><rect width="100%" height="100%" fill="url(#g3)"/>';
        bg.appendChild(gridSvg);
        wrap.appendChild(bg);

        /* 自适应容器：工坊按 1400×900 设计稿布局，再整体等比缩放进视口（无滚动条、全貌可见） */
        const fb = fitBox(wrap, 'relative z-10');
        const grid = h('div', 'grid grid-cols-12 grid-rows-12 gap-3 p-4');
        grid.style.width = '1400px';
        grid.style.height = '860px';
        fb.inner.appendChild(grid);
        autofit(fb.inner, fb.box, 1.15);

        // 左上：坦克预览 Canvas
        const preview = h('div', 'neon-panel col-span-5 row-span-7 relative flex items-center justify-center');
        corners(preview);
        preview.appendChild(h('div', 'absolute top-3 left-4 font-tech text-glow-cyan text-sm tracking-widest', '3D PREVIEW'));
        const cv = document.createElement('canvas');
        cv.width = 420; cv.height = 340;
        cv.style.maxWidth = '100%';
        preview.appendChild(cv);
        grid.appendChild(preview);
        let angle = 0;
        const ctx = cv.getContext('2d');
        let tankRaf = null;
        function drawTankFrame() {
            const w = cv.width, h = cv.height;
            ctx.clearRect(0, 0, w, h);
            // halo
            ctx.save();
            const _tc = tankColor();
            const grad = ctx.createRadialGradient(w / 2, h / 2, 20, w / 2, h / 2, 180);
            grad.addColorStop(0, _tc + '59');
            grad.addColorStop(1, _tc + '00');
            ctx.fillStyle = grad;
            ctx.fillRect(0, 0, w, h);
            ctx.restore();
            // tank body (伪 3D)
            const cx = w / 2, cy = h / 2, s = 1.4;
            ctx.save();
            ctx.translate(cx, cy);
            ctx.rotate(angle);
            ctx.scale(s, s);
            const bodyColor = tankColor();
            // 阴影
            ctx.fillStyle = 'rgba(0,0,0,0.5)';
            ctx.beginPath(); ctx.ellipse(4, 8, 38, 14, 0, 0, Math.PI * 2); ctx.fill();
            // 履带
            ctx.fillStyle = '#222'; ctx.strokeStyle = bodyColor; ctx.lineWidth = 2;
            ctx.shadowBlur = 14; ctx.shadowColor = bodyColor;
            ctx.fillRect(-36, -22, 72, 10); ctx.strokeRect(-36, -22, 72, 10);
            ctx.fillRect(-36, 12, 72, 10);  ctx.strokeRect(-36, 12, 72, 10);
            // 车身
            ctx.fillStyle = bodyColor + 'cc';
            ctx.fillRect(-28, -16, 56, 32);
            ctx.strokeRect(-28, -16, 56, 32);
            ctx.shadowBlur = 0;
            // 炮塔
            ctx.fillStyle = bodyColor;
            ctx.beginPath(); ctx.arc(0, 0, 14, 0, Math.PI * 2); ctx.fill();
            ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.stroke();
            // 炮管
            ctx.fillStyle = '#111';
            ctx.fillRect(8, -3, 28, 6);
            ctx.strokeStyle = bodyColor; ctx.lineWidth = 1.5;
            ctx.strokeRect(8, -3, 28, 6);
            ctx.restore();
            angle += 0.08 * Math.PI / 180 * 60; // 8°/s @ 60fps
            tankRaf = requestAnimationFrame(drawTankFrame);
        }
        drawTankFrame();

        // 右上：坦克选择卡片（带属性条，清晰直观）
        const tankPanel = h('div', 'neon-panel col-span-7 row-span-7 relative p-5 flex flex-col');
        corners(tankPanel);
        tankPanel.appendChild(h('div', 'absolute top-3 left-4 ct-ws-title', '选择你的坦克 · TANK SELECT'));
        const cardGrid = h('div', 'grid grid-cols-2 grid-rows-2 gap-4 mt-8 flex-1');

        TANKS.forEach((tk) => cardGrid.appendChild(ctBuildTankCard(tk, _state.tank === tk.id, (id) => {
            _state.tank = id; drawRadar(); updateTankDesc();
        })));
        tankPanel.appendChild(cardGrid);
        grid.appendChild(tankPanel);

        // 中间：雷达五边形
        const radarCard = h('div', 'neon-panel col-span-5 row-span-3 relative flex flex-col items-center justify-center py-2');
        corners(radarCard);
        radarCard.appendChild(h('div', 'absolute top-2 left-3 font-tech text-glow-cyan text-[11px] tracking-widest', 'ATTRIBUTE RADAR'));
        const rcv = document.createElement('canvas');
        rcv.width = 300; rcv.height = 300;   // 内部 2 倍分辨率绘制，缩放后更清晰
        rcv.style.width = '176px';
        rcv.style.height = '176px';
        radarCard.appendChild(rcv);
        grid.appendChild(radarCard);
        function drawRadar() {
            ctDrawRadar(rcv, _state.tank);
        }
        drawRadar();

        // 中间右：坦克简介（局外金币/皮肤系统已移除，颜色随坦克固定）
        const descCard = h('div', 'neon-panel col-span-7 row-span-3 relative p-5');
        corners(descCard);
        descCard.appendChild(h('div', 'absolute top-3 left-4 ct-ws-title', '坦克简介 · TANK BRIEFING'));
        const descInner = h('div', 'mt-8 flex flex-col gap-2');
        const descBox = h('div', 'ct-ws-desc !mt-0');
        descBox.textContent = TANK_INFO[_state.tank] || TANK_INFO.assault;
        function updateTankDesc() {
            descBox.textContent = TANK_INFO[_state.tank] || '';
            const tk = tankById(_state.tank);
            colorChip.style.color = tk.color;
            colorChip.style.borderColor = tk.color + '66';
            colorChip.style.background = tk.color + '1f';
            colorDot.style.background = tk.color;
            colorName.textContent = tk.color.toUpperCase();
        }
        descInner.appendChild(descBox);
        const colorChip = h('div', 'ct-color-chip self-start px-3 py-1 rounded-full border');
        const colorDot = h('div', 'ct-tank-dot');
        const colorName = h('span', '', '');
        const chipLabel = h('span', '', '专属配色');
        colorChip.appendChild(chipLabel);
        colorChip.appendChild(colorDot);
        colorChip.appendChild(colorName);
        descInner.appendChild(colorChip);
        descCard.appendChild(descInner);
        grid.appendChild(descCard);

        updateTankDesc();

        // 底部：返回 + 出战
        const bottomCard = h('div', 'col-span-12 row-span-2 flex items-center justify-between px-6');
        const back = h('button', 'ct-neon-btn btn-ghost !px-8 !h-14 !text-lg', '← 返回');
        back.addEventListener('click', () => { cancelAnimationFrame(tankRaf); MENU.renderModeSelect(); });
        bottomCard.appendChild(back);
        const deploy = h('button', 'ct-neon-btn btn-primary !px-12 !h-16 !text-2xl font-tech tracking-wider shadow-[0_0_24px_rgba(0,229,255,.6)]', '⚔ 出 战');
        deploy.addEventListener('click', () => {
            cancelAnimationFrame(tankRaf);
            if (!_state.mode) { _state.mode = 'horde'; }
            // 联机模式：进入联机大厅（创建/加入/匹配），不走本地 HUD.startGame
            if (_state.mode === 'online') {
                MENU._renderOnlineLobby();
                return;
            }
            // 注意：hud.js 在 menu.js 之后加载，第 10 行加载期捕获的 HUD 常量恒为 undefined，
            // 导致出战永远走降级分支、模式从不启动（5 个模式地图全部无法渲染的根因）。
            // 必须在点击时实时从 global 取。
            var hudNs = global.CT_UI_HUD;
            if (hudNs && typeof hudNs.startGame === 'function') {
                try {
                    hudNs.startGame(_state.mode, _state.tank, tankColor(), _state.difficulty, _state.duelOpponent, _state.p2Tank);
                } catch (e) {
                    console.error('[MENU] deploy HUD.startGame failed:', e);
                    document.getElementById('main-menu-wrap').classList.add('hidden');
                    const hudEl = document.getElementById('game-hud-wrap');
                    if (hudEl) { hudEl.classList.remove('hidden'); hudEl.innerHTML = '<div style="color:#fff;padding:20px;font-family:monospace">[FAILED] mode: ' + _state.mode + '</div>'; }
                }
            } else {
                // 降级：自己隐藏菜单显示HUD占位
                document.getElementById('main-menu-wrap').classList.add('hidden');
                const hud = document.getElementById('game-hud-wrap');
                if (hud) hud.classList.remove('hidden');
                BUS && BUS.emit && BUS.emit('ui:gameStarting', { mode: _state.mode, tank: _state.tank, skin: tankColor(), difficulty: _state.difficulty });
            }
        });
        bottomCard.appendChild(deploy);
        grid.appendChild(bottomCard);
    };

    /* ---------- 联机对战：大厅（创建房间 / 输入房间号加入 / 快速匹配） ---------- */
    MENU._renderOnlineLobby = function () {
        injectStyle();
        const wrap = document.getElementById('main-menu-wrap');
        if (!wrap) return;
        wrap.className = 'pointer-events-auto absolute inset-0 z-40 w-screen h-screen anim-fadeIn';
        wrap.innerHTML = '';
        const bg = h('div', 'ct-menu-bg');
        const gridSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        gridSvg.setAttribute('class', 'ct-grid-svg');
        gridSvg.innerHTML = '<defs><pattern id="gOnline" width="50" height="50" patternUnits="userSpaceOnUse"><path d="M 50 0 L 0 0 0 50" fill="none" stroke="rgba(0,229,255,0.15)" stroke-width="1"/></pattern></defs><rect width="100%" height="100%" fill="url(#gOnline)"/>';
        bg.appendChild(gridSvg);
        wrap.appendChild(bg);

        const fb = fitBox(wrap, 'relative z-10 flex flex-col items-center py-8 px-6');
        const container = fb.inner;

        container.appendChild(h('h2', 'font-tech text-[2rem] text-glow-cyan tracking-widest mb-1', '联机对战 1v1'));
        container.appendChild(h('div', 'text-text-lo text-xs font-mono mb-2', 'ONLINE · 需先启动 online/server.js（默认 http://localhost:3000）'));
        container.appendChild(h('div', 'text-text-mid text-sm mb-6', '已选坦克：' + tankById(_state.tank).name + '（可在上一步的「坦克工坊」更换）'));

        const panel = h('div', 'neon-panel flex flex-col gap-4 items-stretch', '');
        corners(panel);
        panel.style.cssText += 'padding:28px 36px;min-width:360px';

        const btnCreate = h('button', 'ct-neon-btn btn-primary !text-lg !h-14', '🏠 创建房间');
        const rowJoin = h('div', 'flex gap-2');
        const input = h('input', 'ct-input flex-1', '');
        input.placeholder = '输入 6 位房间号';
        input.maxLength = 6;
        input.style.cssText = 'background:rgba(0,0,0,.3);border:1px solid rgba(0,229,255,.4);border-radius:8px;color:#e7ecf3;padding:0 12px;letter-spacing:3px;text-transform:uppercase';
        const btnJoin = h('button', 'ct-neon-btn btn-ghost !h-14', '加入');
        rowJoin.appendChild(input); rowJoin.appendChild(btnJoin);
        const btnMatch = h('button', 'ct-neon-btn btn-ghost !text-lg !h-14', '⚡ 快速匹配（自动排队）');

        btnCreate.addEventListener('click', () => { CT_MODE_ONLINE && CT_MODE_ONLINE.start({ mode: 'create', tank: _state.tank, skin: tankColor() }); });
        btnJoin.addEventListener('click', () => {
            const id = (input.value || '').trim().toUpperCase();
            if (!id) { MODAL && MODAL.showToast('请输入房间号', 'warn'); return; }
            CT_MODE_ONLINE && CT_MODE_ONLINE.start({ mode: 'join', roomId: id, tank: _state.tank, skin: tankColor() });
        });
        btnMatch.addEventListener('click', () => { CT_MODE_ONLINE && CT_MODE_ONLINE.start({ mode: 'match', tank: _state.tank, skin: tankColor() }); });

        panel.appendChild(h('div', 'text-text-mid font-tech tracking-widest text-sm text-center', '方式一'));
        panel.appendChild(btnCreate);
        panel.appendChild(h('div', 'text-text-mid font-tech tracking-widest text-sm text-center', '方式二 · 凭房间号'));
        panel.appendChild(rowJoin);
        panel.appendChild(h('div', 'text-text-mid font-tech tracking-widest text-sm text-center', '方式三 · 无房间号'));
        panel.appendChild(btnMatch);
        container.appendChild(panel);

        const footers = h('div', 'flex gap-4 mt-6');
        const back = h('button', 'ct-neon-btn btn-ghost !px-6', '← 返回模式选择');
        back.addEventListener('click', () => MENU.renderModeSelect());
        footers.appendChild(back);
        container.appendChild(footers);

        autofit(fb.inner, fb.box, 1.05);
    };

    /* ---------- 本地双人：P1 / P2 独立坦克选择（两个独立界面，依次选择） ---------- */
    MENU._renderDuelTankPick = function (who) {
        injectStyle();
        const isP1 = (who === 'p1');
        const key = isP1 ? 'tank' : 'p2Tank';
        const accent = isP1 ? '#00e5ff' : '#ff2a6d';
        const playerLabel = isP1 ? '玩家 1 · PLAYER 1' : '玩家 2 · PLAYER 2';
        const shortLabel = isP1 ? 'P1' : 'P2';
        if (!_state[key]) _state[key] = 'assault';

        const wrap = document.getElementById('main-menu-wrap');
        if (!wrap) return;
        wrap.className = 'pointer-events-auto absolute inset-0 z-40 w-screen h-screen anim-fadeIn';
        wrap.innerHTML = '';
        const bg = h('div', 'ct-menu-bg');
        const gridSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        gridSvg.setAttribute('class', 'ct-grid-svg');
        gridSvg.innerHTML = '<defs><pattern id="g3" width="50" height="50" patternUnits="userSpaceOnUse"><path d="M 50 0 L 0 0 0 50" fill="none" stroke="rgba(255,201,60,0.12)" stroke-width="1"/></pattern></defs><rect width="100%" height="100%" fill="url(#g3)"/>';
        bg.appendChild(gridSvg);
        wrap.appendChild(bg);

        const fb = fitBox(wrap, 'relative z-10');
        const grid = h('div', 'grid grid-cols-12 grid-rows-12 gap-3 p-4');
        grid.style.width = '1400px';
        grid.style.height = '860px';
        fb.inner.appendChild(grid);
        autofit(fb.inner, fb.box, 1.15);

        // 顶部提示条：明确这是「哪个玩家」的独立选择界面
        const header = h('div', 'neon-panel col-span-12 row-span-1 flex items-center justify-between px-6');
        corners(header);
        const title = h('div', 'font-tech text-2xl tracking-widest');
        title.textContent = '▶ ' + playerLabel + ' 请选择你的坦克';
        title.style.color = accent;
        title.style.textShadow = '0 0 14px ' + accent + '99';
        header.appendChild(title);
        const sub = h('div', 'text-xs text-text-lo font-mono');
        sub.textContent = isP1
            ? '本地双人 · 第一步：玩家1 先选，确认后交给玩家2'
            : '本地双人 · 第二步：玩家2 选择，确认后开始对战';
        header.appendChild(sub);
        grid.appendChild(header);

        // 左下：坦克选择卡片（只展示该玩家的可选项）
        const cardPanel = h('div', 'neon-panel col-span-7 row-span-9 relative p-5 flex flex-col');
        corners(cardPanel);
        const cardTitle = h('div', 'absolute top-3 left-4 ct-ws-title');
        cardTitle.textContent = shortLabel + ' 坦克 · TANK SELECT';
        cardTitle.style.color = accent;
        cardPanel.appendChild(cardTitle);
        const cardGrid = h('div', 'grid grid-cols-2 grid-rows-2 gap-4 mt-8 flex-1');
        cardPanel.appendChild(cardGrid);
        grid.appendChild(cardPanel);

        // 右下：雷达 + 简介（随当前玩家选择实时更新）
        const infoPanel = h('div', 'col-span-5 row-span-9 flex flex-col gap-3');
        const radarCard = h('div', 'neon-panel flex-1 relative flex flex-col items-center justify-center py-2');
        corners(radarCard);
        radarCard.appendChild(h('div', 'absolute top-2 left-3 font-tech text-glow-cyan text-[11px] tracking-widest', 'ATTRIBUTE RADAR'));
        const rcv = document.createElement('canvas');
        rcv.width = 300; rcv.height = 300; rcv.style.width = '210px'; rcv.style.height = '210px';
        radarCard.appendChild(rcv);
        infoPanel.appendChild(radarCard);

        const descCard = h('div', 'neon-panel flex-1 relative p-5 flex flex-col');
        corners(descCard);
        descCard.appendChild(h('div', 'absolute top-3 left-4 ct-ws-title', '坦克简介 · TANK BRIEFING'));
        const descInner = h('div', 'mt-8 flex flex-col gap-2');
        const descBox = h('div', 'ct-ws-desc !mt-0');
        const colorChip = h('div', 'ct-color-chip self-start px-3 py-1 rounded-full border');
        const colorDot = h('div', 'ct-tank-dot');
        const colorName = h('span', '', '');
        colorChip.appendChild(h('span', '', '专属配色'));
        colorChip.appendChild(colorDot);
        colorChip.appendChild(colorName);
        descInner.appendChild(descBox);
        descInner.appendChild(colorChip);
        descCard.appendChild(descInner);
        infoPanel.appendChild(descCard);
        grid.appendChild(infoPanel);

        // 底部：返回 + 确认
        const bottomCard = h('div', 'col-span-12 row-span-2 flex items-center justify-between px-6');
        const back = h('button', 'ct-neon-btn btn-ghost !px-8 !h-14 !text-lg', '← 返回');
        back.addEventListener('click', () => MENU.renderModeSelect());
        bottomCard.appendChild(back);
        const confirmBtn = h('button', 'ct-neon-btn btn-primary !px-12 !h-16 !text-2xl font-tech tracking-wider',
            isP1 ? '✓ 玩家1 确认，交给玩家2 →' : '⚔ 开始 1v1 对战');
        confirmBtn.style.boxShadow = '0 0 24px ' + accent + '99';
        confirmBtn.addEventListener('click', () => {
            if (isP1) {
                MENU._renderDuelTankPick('p2');
            } else {
                var hudNs = global.CT_UI_HUD;   // 实时取，避免加载期捕获 undefined
                if (hudNs && typeof hudNs.startGame === 'function') {
                    try {
                        hudNs.startGame(_state.mode, _state.tank, tankColor(), _state.difficulty, _state.duelOpponent, _state.p2Tank);
                    } catch (e) {
                        console.error('[MENU] deploy HUD.startGame failed:', e);
                        document.getElementById('main-menu-wrap').classList.add('hidden');
                        var hudEl = document.getElementById('game-hud-wrap');
                        if (hudEl) { hudEl.classList.remove('hidden'); hudEl.innerHTML = '<div style="color:#fff;padding:20px;font-family:monospace">[FAILED] mode: ' + _state.mode + '</div>'; }
                    }
                } else {
                    document.getElementById('main-menu-wrap').classList.add('hidden');
                    var hud2 = document.getElementById('game-hud-wrap');
                    if (hud2) hud2.classList.remove('hidden');
                    BUS && BUS.emit && BUS.emit('ui:gameStarting', { mode: _state.mode, tank: _state.tank, skin: tankColor(), difficulty: _state.difficulty });
                }
            }
        });
        bottomCard.appendChild(confirmBtn);
        grid.appendChild(bottomCard);

        // 填充卡片；选择联动（卡片选中态由 ctBuildTankCard 内部维护，这里只更新雷达/简介）
        function selectTank(id) {
            _state[key] = id;
            ctDrawRadar(rcv, id);
            const tk = tankById(id);
            descBox.textContent = TANK_INFO[id] || '';
            colorChip.style.color = tk.color;
            colorChip.style.borderColor = tk.color + '66';
            colorChip.style.background = tk.color + '1f';
            colorDot.style.background = tk.color;
            colorName.textContent = tk.color.toUpperCase();
        }
        TANKS.forEach((tk) => cardGrid.appendChild(ctBuildTankCard(tk, _state[key] === tk.id, (id) => selectTank(id))));
        selectTank(_state[key]);
    };

    global.CT_UI_MENU = MENU;
})(typeof window !== 'undefined' ? window : globalThis);

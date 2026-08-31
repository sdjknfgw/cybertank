/* ==========================================================
 * CyberTank — 通用模态/设置/操作说明/Toast
 * window.CT_UI_MODAL
 * ========================================================== */
(function (global) {
    'use strict';
    const BUS = global.CT_BUS || { emit() {}, on() {} };
    /* 轻量 kv 存储：localStorage 直读直写。
     * 注意：不能用 `global.CT_STORAGE || {kv 兜底}` —— CT_STORAGE 的 get() 无参
     * 且返回整个存档对象、没有 set(k,v) 方法；storage.js 先于本文件加载，
     * 兜底永远不生效，导致 get('vol_master',80) 拿到整个存档、
     * set('vol_master',v) 抛 TypeError（音量滑块异常的根因）。 */
    const STORE = {
        get(k, d) { try { const v = localStorage.getItem('ct_' + k); return v == null ? d : JSON.parse(v); } catch (_) { return d; } },
        set(k, v) { try { localStorage.setItem('ct_' + k, JSON.stringify(v)); } catch (_) {} }
    };
    const MODAL = {};
    let modalSeed = 1;
    let _styleInjected = false;

    /* ---------------- 四角装饰子元素 ---------------- */
    function appendCorners(el, colorClass) {
        const mk = (cls) => { const s = document.createElement('span'); s.className = cls; return s; };
        el.appendChild(mk('absolute top-0 left-0 w-[18px] h-[18px] border-t-2 border-l-2 border-neon-cyan rounded-tl-[14px] pointer-events-none' + (colorClass === 'magenta' ? ' !border-neon-magenta' : '')));
        el.appendChild(mk('absolute top-0 right-0 w-[18px] h-[18px] border-t-2 border-r-2 border-neon-magenta rounded-tr-[14px] pointer-events-none'));
        el.appendChild(mk('absolute bottom-0 left-0 w-[18px] h-[18px] border-b-2 border-l-2 border-neon-magenta rounded-bl-[14px] pointer-events-none'));
        el.appendChild(mk('absolute bottom-0 right-0 w-[18px] h-[18px] border-b-2 border-r-2 border-neon-cyan rounded-br-[14px] pointer-events-none' + (colorClass === 'magenta' ? ' !border-neon-magenta' : '')));
    }

    /* ---------------- init ---------------- */
    MODAL.init = function () {
        if (_styleInjected) return;
        _styleInjected = true;
        const style = document.createElement('style');
        style.textContent =
            '.ct-modal-backdrop{position:fixed;inset:0;z-index:800;background:rgba(0,0,0,0.6);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);animation:fadeIn .25s ease-out both}' +
            '.ct-modal-panel{position:relative;z-index:801;background:var(--panel-bg);border:1px solid var(--panel-border);border-radius:14px;backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);box-shadow:0 12px 48px rgba(0,0,0,.55);animation:scaleIn .32s cubic-bezier(.34,1.56,.64,1) both;overflow:hidden}' +
            '.ct-modal-panel.closing{animation:scaleOut .22s ease-in both}' +
            '@keyframes scaleOut{0%{transform:scale(1);opacity:1}100%{transform:scale(.85);opacity:0}}' +
            '.ct-scan-bar{position:absolute;inset:0;pointer-events:none;overflow:hidden;border-radius:14px}' +
            '.ct-scan-bar::after{content:"";position:absolute;left:0;right:0;height:60px;background:linear-gradient(180deg,transparent,rgba(0,229,255,.12),transparent);animation:scanLine 4s linear infinite}' +
            '.ct-neon-btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;padding:10px 22px;min-height:44px;border-radius:8px;background:linear-gradient(135deg,rgba(0,229,255,.10),rgba(255,43,214,.08));border:1px solid var(--panel-border);color:var(--text-hi);font-weight:600;letter-spacing:.02em;cursor:pointer;backdrop-filter:blur(8px);transition:transform .15s ease,box-shadow .2s ease,border-color .2s ease}' +
            '.ct-neon-btn:hover{transform:translateY(-1px);border-color:var(--neon-cyan);box-shadow:0 0 10px rgba(0,229,255,.6),0 0 24px rgba(0,229,255,.28)}' +
            '.ct-neon-btn:active{transform:scale(.96)}' +
            '.ct-neon-btn:disabled{opacity:.45;cursor:not-allowed;transform:none!important;box-shadow:none!important}' +
            '.ct-neon-btn.btn-primary{background:linear-gradient(135deg,rgba(0,229,255,.22),rgba(0,229,255,.08));border-color:var(--neon-cyan);box-shadow:0 0 10px rgba(0,229,255,.35)}' +
            '.ct-neon-btn.btn-primary:hover{box-shadow:0 0 16px rgba(0,229,255,.75),0 0 40px rgba(0,229,255,.38)}' +
            '.ct-neon-btn.btn-ghost{background:transparent;border-color:rgba(169,183,209,.25);color:var(--text-mid)}' +
            '.ct-neon-btn.btn-ghost:hover{color:var(--text-hi);border-color:var(--neon-magenta);box-shadow:0 0 10px rgba(255,43,214,.45)}' +
            '.ct-neon-btn.btn-danger{background:linear-gradient(135deg,rgba(255,56,96,.2),rgba(255,56,96,.06));border-color:rgba(255,56,96,.55);color:#ffd4dc}' +
            '.ct-neon-btn.btn-danger:hover{border-color:#ff3860;box-shadow:0 0 10px rgba(255,56,96,.6)}' +
            '.ct-toast-el{position:relative;padding:10px 14px 10px 18px;border-radius:10px;font-family:Plus Jakarta Sans,PingFang SC,system-ui,sans-serif;font-size:13px;line-height:1.45;box-shadow:0 8px 24px rgba(0,0,0,.45);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);border:1px solid rgba(255,255,255,.08);word-break:break-word;pointer-events:auto;cursor:pointer;animation:toastIn .28s cubic-bezier(.34,1.56,.64,1) both}' +
            '@keyframes toastIn{0%{transform:translateX(16px) scale(.94);opacity:0}100%{transform:none;opacity:1}}' +
            '.ct-setting-row{display:flex;align-items:center;justify-content:space-between;padding:10px 0;border-bottom:1px dashed rgba(0,229,255,.12)}' +
            '.ct-setting-row:last-child{border-bottom:none}' +
            '.ct-slider{-webkit-appearance:none;appearance:none;width:200px;height:6px;border-radius:999px;background:linear-gradient(90deg,var(--neon-cyan) 0%,var(--neon-cyan) var(--v,50%),rgba(169,183,209,.2) var(--v,50%));outline:none;cursor:pointer}' +
            '.ct-slider::-webkit-slider-thumb{-webkit-appearance:none;width:16px;height:16px;border-radius:50%;background:var(--neon-cyan);box-shadow:0 0 8px var(--neon-cyan)}' +
            '.ct-slider::-moz-range-thumb{width:16px;height:16px;border-radius:50%;background:var(--neon-cyan);border:none;box-shadow:0 0 8px var(--neon-cyan)}' +
            '.ct-chip{padding:6px 14px;border-radius:999px;border:1px solid rgba(0,229,255,.3);font-family:Share Tech Mono,monospace;font-size:13px;cursor:pointer;background:rgba(12,18,40,.5);color:var(--text-mid);transition:all .18s ease}' +
            '.ct-chip.active{background:rgba(0,229,255,.18);color:var(--neon-cyan);border-color:var(--neon-cyan);box-shadow:0 0 10px rgba(0,229,255,.5)}' +
            '.ct-toggle{position:relative;width:42px;height:22px;border-radius:999px;background:rgba(169,183,209,.2);cursor:pointer;transition:background .2s ease}' +
            '.ct-toggle.on{background:linear-gradient(90deg,rgba(0,229,255,.4),rgba(0,229,255,.7));box-shadow:0 0 10px rgba(0,229,255,.5)}' +
            '.ct-toggle::after{content:"";position:absolute;top:2px;left:2px;width:18px;height:18px;border-radius:50%;background:#fff;transition:left .2s ease}' +
            '.ct-toggle.on::after{left:22px;background:var(--neon-cyan);box-shadow:0 0 6px var(--neon-cyan)}';
        document.head.appendChild(style);
    };

    /* ---------------- show 通用模态 ---------------- */
    MODAL.show = function (opts) {
        MODAL.init();
        opts = opts || {};
        const { title = '', body = '', buttons = [], closable = true, className = 'cyan', onClose, size = 'md' } = opts;
        const root = document.getElementById('modal-root');
        if (!root) return null;
        root.classList.remove('hidden');

        const id = 'ct-modal-' + (modalSeed++);
        const sizeMap = { sm: 'max-w-sm', md: 'max-w-2xl', lg: 'max-w-4xl' };

        const backdrop = document.createElement('div');
        backdrop.className = 'ct-modal-backdrop';
        backdrop.id = id + '-back';
        if (closable) backdrop.addEventListener('click', () => MODAL.close(id));

        const wrap = document.createElement('div');
        wrap.className = 'fixed inset-0 z-[801] flex items-center justify-center p-6';
        wrap.id = id;
        wrap.addEventListener('click', (e) => { if (e.target === wrap && closable) MODAL.close(id); });

        const panel = document.createElement('div');
        panel.className = 'ct-modal-panel w-full ' + sizeMap[size] + ' ' + (className === 'magenta' ? 'panel-magenta' : '');
        panel.id = id + '-panel';

        // 四角装饰 + 扫描线
        appendCorners(panel, className);
        const scan = document.createElement('div'); scan.className = 'ct-scan-bar'; panel.appendChild(scan);

        // 头
        const header = document.createElement('div');
        header.className = 'flex items-center justify-between px-6 pt-6 pb-4 border-b border-neon-cyan/20';
        const titleEl = document.createElement('h3');
        titleEl.className = 'font-tech text-[1.5rem] text-glow-cyan m-0 tracking-wider';
        titleEl.textContent = title;
        header.appendChild(titleEl);
        if (closable) {
            const closeBtn = document.createElement('button');
            closeBtn.className = 'w-9 h-9 rounded-lg border border-neon-magenta/60 flex items-center justify-center text-neon-magenta hover:bg-neon-magenta/15 hover:shadow-[0_0_10px_rgba(255,43,214,.6)] transition-all';
            closeBtn.innerHTML = '<span style="font-size:18px;line-height:1">✕</span>';
            closeBtn.addEventListener('click', () => MODAL.close(id));
            header.appendChild(closeBtn);
        }
        panel.appendChild(header);

        // body
        const bodyEl = document.createElement('div');
        bodyEl.className = 'px-6 py-5';
        if (typeof body === 'string') bodyEl.innerHTML = body;
        else if (body instanceof Node) bodyEl.appendChild(body);
        panel.appendChild(bodyEl);

        // buttons
        if (buttons.length) {
            const footer = document.createElement('div');
            footer.className = 'flex justify-end gap-3 px-6 py-4 border-t border-neon-cyan/20 bg-black/20';
            buttons.forEach((b) => {
                const btn = document.createElement('button');
                const lv = b.level || 'ghost';
                btn.className = 'ct-neon-btn ' + (lv === 'primary' ? 'btn-primary' : lv === 'danger' ? 'btn-danger' : 'btn-ghost') + ' ' + (b.className || '');
                btn.textContent = b.label || '按钮';
                btn.addEventListener('click', (ev) => {
                    if (typeof b.onClick === 'function') b.onClick(ev, () => MODAL.close(id));
                });
                footer.appendChild(btn);
            });
            panel.appendChild(footer);
        }

        wrap.appendChild(panel);
        root.appendChild(backdrop);
        root.appendChild(wrap);
        return id;
    };

    /* ---------------- close ---------------- */
    MODAL.close = function (id) {
        const wrap = document.getElementById(id);
        const back = document.getElementById(id + '-back');
        const panel = document.getElementById(id + '-panel');
        if (panel) panel.classList.add('closing');
        setTimeout(() => {
            if (wrap && wrap.parentNode) wrap.parentNode.removeChild(wrap);
            if (back && back.parentNode) back.parentNode.removeChild(back);
            const root = document.getElementById('modal-root');
            if (root && !root.children.length) root.classList.add('hidden');
            const last = MODAL._onClose && MODAL._onClose[id];
            if (typeof last === 'function') { try { last(); } catch (_) {} delete MODAL._onClose[id]; }
        }, 220);
    };

    /* ---------------- 设置面板 ---------------- */
    MODAL.showSettings = function () {
        MODAL.init();
        const cfg = {
            master: STORE.get('vol_master', 80),
            sfx:    STORE.get('vol_sfx', 75),
            bgm:    STORE.get('vol_bgm', 60),
            mute:   STORE.get('mute_all', false),
            shake:  STORE.get('screen_shake', true),
            quality:STORE.get('quality', 'med'),
            fullscreen: false,
            keys: [
                { act: '移动·上',     k: 'W / ↑' },
                { act: '移动·下',     k: 'S / ↓' },
                { act: '移动·左',     k: 'A / ←' },
                { act: '移动·右',     k: 'D / →' },
                { act: '主武器射击',  k: '空格 / 鼠标左键' },
                { act: '释放技能',    k: 'E / 鼠标右键' },
                { act: '道具 1~5',    k: '数字 1 2 3 4 5' },
                { act: '暂停',        k: 'ESC / P' },
            ]
        };
        const body = document.createElement('div');

        /* 打开设置时把已保存音量同步到音频系统（保证跨局/刷新后仍生效） */
        try {
            const A = global.CT_AUDIO;
            if (A && typeof A.setVolume === 'function') {
                A.setVolume('master', cfg.master / 100);
                A.setVolume('sfx', cfg.sfx / 100);
                A.setVolume('bgm', cfg.bgm / 100);
            }
        } catch (_) {}

        const mk = (tag, cls, txt) => { const el = document.createElement(tag); if (cls) el.className = cls; if (txt != null) el.textContent = txt; return el; };

        // 音量
        const volSec = mk('div');
        volSec.appendChild(mk('h4', 'font-tech text-glow-magenta mb-3 text-lg', '🎚 音量设置'));

        ['master', 'sfx', 'bgm'].forEach((k) => {
            const row = mk('div', 'ct-setting-row');
            const label = mk('span', 'text-text-mid', { master:'主音量', sfx:'音效', bgm:'背景音乐' }[k]);
            const right = mk('div', 'flex items-center gap-3');
            const slider = document.createElement('input');
            slider.type = 'range'; slider.min = 0; slider.max = 100; slider.value = cfg[k];
            slider.className = 'ct-slider';
            slider.style.setProperty('--v', cfg[k] + '%');
            const valTxt = mk('span', 'font-mono text-neon-cyan w-10 text-right', cfg[k]);
            slider.addEventListener('input', () => {
                const v = +slider.value;
                slider.style.setProperty('--v', v + '%');
                valTxt.textContent = v;
                STORE.set('vol_' + k, v);
                global.CT_AUDIO && typeof global.CT_AUDIO.setVolume === 'function' && global.CT_AUDIO.setVolume(k, v / 100);
            });
            right.appendChild(slider); right.appendChild(valTxt);
            row.appendChild(label); row.appendChild(right);
            volSec.appendChild(row);
        });

        // 静音
        const muteRow = mk('div', 'ct-setting-row');
        muteRow.appendChild(mk('span', 'text-text-mid', '🔇 全局静音'));
        const muteToggle = mk('div', 'ct-toggle' + (cfg.mute ? ' on' : ''));
        muteToggle.addEventListener('click', () => {
            cfg.mute = !cfg.mute;
            muteToggle.classList.toggle('on', cfg.mute);
            STORE.set('mute_all', cfg.mute);
            /* CT_AUDIO 的方法名是 mute(b)，此前误调 setMute（不存在）导致静音开关无效 */
            global.CT_AUDIO && typeof global.CT_AUDIO.mute === 'function' && global.CT_AUDIO.mute(cfg.mute);
        });
        muteRow.appendChild(muteToggle);
        volSec.appendChild(muteRow);
        body.appendChild(volSec);

        // 画面设置
        const gfxSec = mk('div', 'mt-6');
        gfxSec.appendChild(mk('h4', 'font-tech text-glow-magenta mb-3 text-lg', '🖥 画面设置'));

        const shakeRow = mk('div', 'ct-setting-row');
        shakeRow.appendChild(mk('span', 'text-text-mid', '💥 屏幕震动效果'));
        const shakeToggle = mk('div', 'ct-toggle' + (cfg.shake ? ' on' : ''));
        shakeToggle.addEventListener('click', () => {
            cfg.shake = !cfg.shake;
            shakeToggle.classList.toggle('on', cfg.shake);
            STORE.set('screen_shake', cfg.shake);
        });
        shakeRow.appendChild(shakeToggle);
        gfxSec.appendChild(shakeRow);

        const qRow = mk('div', 'ct-setting-row flex-col items-start gap-3 !py-4');
        qRow.appendChild(mk('span', 'text-text-mid', '🎨 画质档位'));
        const qWrap = mk('div', 'flex gap-2');
        ['high', 'med', 'low'].forEach((lv) => {
            const chip = mk('div', 'ct-chip' + (cfg.quality === lv ? ' active' : ''), { high:'High 高', med:'Med 中', low:'Low 低' }[lv]);
            chip.addEventListener('click', () => {
                cfg.quality = lv;
                qWrap.querySelectorAll('.ct-chip').forEach(c => c.classList.remove('active'));
                chip.classList.add('active');
                STORE.set('quality', lv);
                global.CT_RENDERER && typeof global.CT_RENDERER.setQuality === 'function' && global.CT_RENDERER.setQuality(lv);
            });
            qWrap.appendChild(chip);
        });
        qRow.appendChild(qWrap);
        gfxSec.appendChild(qRow);

        const fsRow = mk('div', 'ct-setting-row');
        fsRow.appendChild(mk('span', 'text-text-mid', '⛶ 全屏显示'));
        const fsBtn = mk('button', 'ct-neon-btn btn-primary', '切换全屏');
        fsBtn.addEventListener('click', () => {
            if (!document.fullscreenElement) document.documentElement.requestFullscreen && document.documentElement.requestFullscreen().catch(() => {});
            else document.exitFullscreen && document.exitFullscreen().catch(() => {});
        });
        fsRow.appendChild(fsBtn);
        gfxSec.appendChild(fsRow);
        body.appendChild(gfxSec);

        // 键位
        const keySec = mk('div', 'mt-6');
        keySec.appendChild(mk('h4', 'font-tech text-glow-magenta mb-3 text-lg', '⌨ 键位绑定（只读）'));
        const tbl = document.createElement('div');
        tbl.className = 'border border-neon-cyan/25 rounded-lg overflow-hidden';
        cfg.keys.forEach((row, i) => {
            const tr = mk('div', 'flex px-4 py-2.5 ' + (i % 2 === 0 ? 'bg-neon-cyan/5' : ''));
            tr.appendChild(mk('span', 'flex-1 text-text-mid', row.act));
            tr.appendChild(mk('span', 'font-mono text-neon-cyan', row.k));
            tbl.appendChild(tr);
        });
        keySec.appendChild(tbl);
        body.appendChild(keySec);

        return MODAL.show({
            title: '⚙ 游戏设置',
            body: body,
            className: 'magenta',
            size: 'lg',
            buttons: [{ label: '关闭', level: 'primary', onClick: (_, close) => close() }]
        });
    };

    /* ---------------- 操作说明面板 ---------------- */
    MODAL.showControlsHelp = function () {
        MODAL.init();
        const body = document.createElement('div');
        const mk = (tag, cls, html) => { const el = document.createElement(tag); if (cls) el.className = cls; if (html != null) { if (tag === 'img' || tag === 'input') el.src = html; else el.innerHTML = html; } return el; };

        const grid = mk('div', 'grid grid-cols-1 md:grid-cols-2 gap-5');

        // 键盘列
        const kb = mk('div', 'neon-panel p-5 relative');
        appendCorners(kb, 'cyan');
        kb.appendChild(mk('h4', 'font-tech text-glow-cyan mb-4 text-lg flex items-center gap-2', '⌨ 键盘操作'));
        const kbRows = [
            ['W A S D',     'P1 四向移动坦克（方向键 ↑←↓→ 归本地双人 P2 使用）'],
            ['空格 / J',     'P1 发射主炮（鼠标左键同效）'],
            ['E / K',        'P1 释放坦克专属技能（有冷却）'],
            ['1 ~ 5',        '使用对应格道具（徽章/回血/护盾）'],
            ['F',            '交互 / 进入商店'],
            ['M',            '切换大地图'],
            ['ESC / P',      '暂停游戏，呼出菜单'],
            ['Tab',          '快速查看记分板'],
        ];
        const kbTbl = mk('div', 'border border-neon-cyan/25 rounded-lg overflow-hidden text-sm');
        kbRows.forEach((r, i) => {
            const tr = mk('div', 'flex px-3 py-2.5 ' + (i % 2 ? 'bg-neon-cyan/5' : ''));
            tr.appendChild(mk('span', 'w-40 font-mono text-neon-cyan', r[0]));
            tr.appendChild(mk('span', 'flex-1 text-text-mid', r[1]));
            kbTbl.appendChild(tr);
        });
        kb.appendChild(kbTbl);
        grid.appendChild(kb);

        // 鼠标列
        const ms = mk('div', 'neon-panel p-5 relative');
        appendCorners(ms, 'magenta');
        ms.appendChild(mk('h4', 'font-tech text-glow-magenta mb-4 text-lg flex items-center gap-2', '🖱 鼠标操作'));
        const msRows = [
            ['鼠标移动',   '炮塔瞄准方向（锁定指针时准星式）'],
            ['左键 LMB',   '开火（等同空格）'],
            ['右键 RMB',   '释放技能（等同 E）'],
            ['滚轮',       '快速切换道具 / 放大缩小雷达'],
        ];
        const msTbl = mk('div', 'border border-neon-magenta/25 rounded-lg overflow-hidden text-sm');
        msRows.forEach((r, i) => {
            const tr = mk('div', 'flex px-3 py-2.5 ' + (i % 2 ? 'bg-neon-magenta/5' : ''));
            tr.appendChild(mk('span', 'w-40 font-mono text-neon-magenta', r[0]));
            tr.appendChild(mk('span', 'flex-1 text-text-mid', r[1]));
            msTbl.appendChild(tr);
        });
        ms.appendChild(msTbl);
        grid.appendChild(ms);

        // 移动端（跨整行）
        const mb = mk('div', 'neon-panel p-5 relative md:col-span-2');
        appendCorners(mb, 'cyan');
        mb.appendChild(mk('h4', 'font-tech text-glow-gold mb-4 text-lg flex items-center gap-2', '📱 移动端操作'));
        mb.appendChild(mk('div', 'text-text-mid text-sm leading-relaxed',
            '屏幕 <b style="color:var(--neon-cyan)">左下角虚拟摇杆</b> 控制坦克移动，' +
            '<b style="color:var(--neon-magenta)">右下角开火+技能按钮</b> 控制战斗；' +
            '拖动屏幕可瞄准炮塔方向；道具栏点击即可使用。<br>' +
            '<span style="color:var(--text-lo)">（宽屏 ≥768px 默认隐藏虚拟摇杆，窄屏自动显示）</span>'));
        grid.appendChild(mb);

        // 本地双人（1v1）P2 操作（独立整行，避免与 P1 键位混淆）
        const p2 = mk('div', 'neon-panel p-5 relative md:col-span-2');
        appendCorners(p2, 'gold');
        p2.appendChild(mk('h4', 'font-tech text-glow-gold mb-3 text-lg flex items-center gap-2', '👥 本地双人（仅 1v1 模式）'));
        p2.appendChild(mk('div', 'text-text-lo text-xs mb-3', '开启「本地双人」后，P2 用右侧键盘独立操控，与 P1 同步对战。'));
        const p2Rows = [
            ['↑ ↓ ← →', 'P2 四向移动'],
            ['Enter',   'P2 发射主炮'],
            ['右 Shift', 'P2 释放技能'],
        ];
        const p2Tbl = mk('div', 'border border-neon-gold/25 rounded-lg overflow-hidden text-sm grid grid-cols-1 sm:grid-cols-3');
        p2Rows.forEach((r, i) => {
            const tr = mk('div', 'flex px-3 py-2.5 gap-3 ' + (i % 2 ? 'bg-neon-gold/5' : ''));
            tr.appendChild(mk('span', 'w-28 font-mono text-neon-gold', r[0]));
            tr.appendChild(mk('span', 'flex-1 text-text-mid', r[1]));
            p2Tbl.appendChild(tr);
        });
        p2.appendChild(p2Tbl);
        grid.appendChild(p2);

        body.appendChild(grid);
        return MODAL.show({
            title: '📖 操作说明',
            body: body,
            className: 'cyan',
            size: 'lg',
            buttons: [{ label: '我知道了', level: 'primary', onClick: (_, close) => close() }]
        });
    };

    /* ---------------- 方块 / 地形说明面板 ---------------- */
    MODAL.showBlockGuide = function () {
        MODAL.init();
        const body = document.createElement('div');
        const mk = (tag, cls, html) => { const el = document.createElement(tag); if (cls) el.className = cls; if (html != null) { if (tag === 'img' || tag === 'input') el.src = html; else el.innerHTML = html; } return el; };

        // 顶部一句话概述
        body.appendChild(mk('div', 'text-text-mid text-sm leading-relaxed mb-4',
            '战场上散布着多种<b style="color:var(--neon-cyan)">地形方块</b>，它们会改变你的走位、视线与战术。了解它们的特性，才能把地图变成你的掩护。'));

        const grid = mk('div', 'grid grid-cols-1 sm:grid-cols-2 gap-4');

        // 每种地形：色块 + 名称 + 效果
        const items = [
            { name: '砖墙', tag: 'Brick', color: '#8b4a2b', line: 'rgba(200,122,74,.9)', desc: '可破坏掩体，血量较低，被子弹击碎；打碎后有概率掉落道具。适合做临时掩护。' },
            { name: '钢墙', tag: 'Steel', color: '#cdd8ea', line: '#eaf3ff', desc: '不可破坏，坦克与子弹均被挡住；仅核弹 / 激光等强制清除可移除。是地图上的永久屏障。' },
            { name: '草丛', tag: 'Bush', color: '#1f8a2b', line: 'rgba(57,255,20,.6)', desc: '不阻挡坦克与子弹，但进入后坦克会半透明<b style="color:var(--neon-magenta)">隐身</b>，适合潜伏与伏击。' },
            { name: '水域', tag: 'Water', color: '#0b6bb0', line: 'rgba(0,200,255,.8)', desc: '阻挡坦克通行（天然壕沟），但<b style="color:var(--neon-cyan)">子弹可穿过</b>。可逼敌人绕路。' },
            { name: '冰面', tag: 'Ice', color: '#b5e3ff', line: '#dff4ff', desc: '牵引力极低，坦克<b style="color:var(--neon-gold)">打滑难停</b>、转向漂移，急停会滑出一段。' },
            { name: '泥地', tag: 'Mud', color: '#5a3a22', line: '#7a4f30', desc: '牵引力下降，坦克<b style="color:#ffb86c">移动减速</b>，用来拖慢追击或拖延对手。' },
            { name: '传送门', tag: 'Portal', color: '#bf00ff', line: '#ff66ff', desc: 'P↔Q 成对出现，坦克踩入后<b style="color:var(--neon-magenta)">瞬移到配对门</b>，1 秒冷却可重复使用，用于快速转移。' },
        ];

        items.forEach((it) => {
            const card = mk('div', 'neon-panel p-4 relative flex gap-3');
            // 左侧色块
            const swatch = mk('div');
            swatch.style.cssText = 'flex:0 0 36px;width:36px;height:36px;border-radius:8px;box-shadow:0 0 10px ' + it.line + ', inset 0 0 8px rgba(255,255,255,.2);background:' + it.color + ';border:1px solid ' + it.line + ';';
            card.appendChild(swatch);
            // 右侧文字
            const txt = mk('div', 'flex-1');
            txt.appendChild(mk('div', 'flex items-center justify-between mb-1',
                '<span class="font-tech text-glow-cyan text-base">' + it.name + '</span>' +
                '<span class="font-mono text-text-lo text-xs">' + it.tag + '</span>'));
            txt.appendChild(mk('div', 'text-text-mid text-sm leading-snug', it.desc));
            card.appendChild(txt);
            grid.appendChild(card);
        });

        body.appendChild(grid);

        body.appendChild(mk('div', 'mt-4 text-text-lo text-xs leading-relaxed',
            '💡 提示：方块的实心类型（砖 / 钢）会阻挡子弹与坦克，空心类型（草丛 / 水 / 冰 / 泥 / 传送门）只影响通行或视线。合理利用掩护与地形，是获胜关键。'));

        return MODAL.show({
            title: '🧱 方块 / 地形说明',
            body: body,
            className: 'cyan',
            size: 'lg',
            buttons: [{ label: '我知道了', level: 'primary', onClick: (_, close) => close() }]
        });
    };

    /* ---------------- Toast ---------------- */
    MODAL.showToast = function (msg, level) {
        MODAL.init();
        const root = document.getElementById('toast-root');
        if (!root) return;
        const lv = level || 'info';
        const colorMap = {
            info:  { bg: 'rgba(12,18,40,0.88)', bar: '#00e5ff', text: '#eef5ff' },
            warn:  { bg: 'rgba(40,28,8,0.90)',  bar: '#ffc93c', text: '#fff1c4' },
            error: { bg: 'rgba(40,10,16,0.92)', bar: '#ff3860', text: '#ffd4dc' }
        };
        const c = colorMap[lv] || colorMap.info;
        const el = document.createElement('div');
        el.className = 'ct-toast-el';
        el.style.background = c.bg;
        el.style.color = c.text;
        const bar = document.createElement('i');
        bar.style.cssText = 'position:absolute;left:0;top:8px;bottom:8px;width:3px;border-radius:3px;background:' + c.bar + ';box-shadow:0 0 8px ' + c.bar;
        el.appendChild(bar);
        const txt = document.createElement('span');
        txt.textContent = String(msg).slice(0, 220);
        el.appendChild(txt);

        const remove = () => {
            clearTimeout(el._t);
            el.style.transition = 'opacity .22s ease, transform .22s ease';
            el.style.opacity = '0';
            el.style.transform = 'translateY(-4px) scale(.97)';
            setTimeout(() => el.parentNode && el.parentNode.removeChild(el), 230);
        };
        el.addEventListener('click', remove);
        root.appendChild(el);
        el._t = setTimeout(remove, 3000);
    };

    global.CT_UI_MODAL = MODAL;
})(typeof window !== 'undefined' ? window : globalThis);

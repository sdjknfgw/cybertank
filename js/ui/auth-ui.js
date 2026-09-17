/* ==========================================================
 * CyberTank — 账号系统 UI（登录 / 注册 / 云端存档）
 * window.CT_UI_AUTH
 * 依赖：modal.js（CT_UI_MODAL，先于本文件加载）、backend.js（CT_BACKEND）
 * ========================================================== */
(function (global) {
    'use strict';
    const MODAL = global.CT_UI_MODAL;   // modal.js 在本文件之前加载，可安全捕获
    const BUS = global.CT_BUS || { on() {}, emit() {} };

    const AUTH = {};

    function h(tag, cls, txt) {
        const el = document.createElement(tag);
        if (cls) el.className = cls;
        if (txt != null && txt !== '') {
            if (typeof txt === 'string' && txt.includes('<')) el.innerHTML = txt;
            else el.textContent = txt;
        }
        return el;
    }
    function toast(msg, lv) {
        try { if (global.CT_TOAST) global.CT_TOAST(msg, lv || 'info'); } catch (_) {}
    }
    function fmtDate(iso) {
        try {
            const d = new Date(iso);
            if (isNaN(d.getTime())) return '—';
            const p = (n) => (n < 10 ? '0' + n : '' + n);
            return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
        } catch (_) { return '—'; }
    }

    /* ---------- init：模块注册（auth:change → 刷新主菜单账号态） ---------- */
    AUTH.init = function () {
        try {
            if (typeof BUS.on === 'function') {
                BUS.on('auth:change', () => {
                    /* 主菜单在屏时刷新指挥官用户名；不在屏则忽略（下次渲染自然取最新态） */
                    try {
                        if (global.CT_UI_MENU && typeof global.CT_UI_MENU.refreshAuthBtn === 'function') {
                            global.CT_UI_MENU.refreshAuthBtn();
                        }
                    } catch (_) {}
                });
            }
        } catch (_) {}
    };

    /* ---------- 账号弹窗 ---------- */
    AUTH.showAccount = function () {
        if (!MODAL || typeof MODAL.show !== 'function') return;
        const BE = global.CT_BACKEND;
        const body = h('div', 'text-sm');
        const modalId = MODAL.show({
            title: '👤 指挥官账号',
            body: body,
            className: 'cyan',
            size: 'md',
            buttons: [{ label: '关闭', level: 'primary', onClick: (_, c) => c() }]
        });
        const close = () => { try { MODAL.close(modalId); } catch (_) {} };
        const render = () => {
            body.innerHTML = '';
            const logged = !!(BE && typeof BE.isLoggedIn === 'function' && BE.isLoggedIn());
            (logged ? renderLogged : renderLogin)();
        };

        /* ---------- 未登录：一键进入（登录 / 自动注册二合一） ---------- */
        function renderLogin() {
            body.appendChild(h('div', 'font-tech text-glow-cyan text-sm tracking-widest mb-1', '🔗 指挥官登录'));
            body.appendChild(h('div', 'text-xs text-text-lo mb-4', '输入用户名和密码，点一下直接进入：新用户自动注册，老用户直接登录。'));

            const userIn = h('input', 'w-full bg-black/40 border border-neon-cyan/30 rounded-lg px-3 py-2 text-sm');
            userIn.placeholder = '用户名（1~16 位字母/数字/下划线/中文）';
            userIn.autocomplete = 'username';
            userIn.maxLength = 16;
            const passIn = h('input', 'w-full bg-black/40 border border-neon-cyan/30 rounded-lg px-3 py-2 text-sm');
            passIn.type = 'password';
            passIn.placeholder = '密码';
            passIn.autocomplete = 'current-password';
            const errEl = h('div', 'text-xs text-red-400 min-h-[1rem]');

            const goBtn = h('button', 'ct-neon-btn btn-primary !h-12 w-full text-base', '🚀 直接进入');
            const busy = (on) => {
                goBtn.disabled = on;
                goBtn.textContent = on ? '⏳ 连接中…' : '🚀 直接进入';
            };

            function submit() {
                if (!BE) { errEl.textContent = '后端接口未加载（离线模式）。'; return; }
                const u = (userIn.value || '').trim();
                const p = passIn.value || '';
                if (!u) { errEl.textContent = '请输入用户名。'; return; }
                if (!p) { errEl.textContent = '请输入密码。'; return; }
                busy(true);
                errEl.textContent = '';
                const call = (typeof BE.enter === 'function') ? BE.enter(u, p) : BE.login(u, p);
                call.then((r) => {
                    busy(false);
                    if (r && r.ok) {
                        toast(r.created ? '注册成功，欢迎指挥官 ' + ((r.user && r.user.username) || u)
                                        : '欢迎回来，' + ((r.user && r.user.username) || u));
                        /* 登录成功：云端有比本机更新的存档时自动恢复（换设备续玩）。
                         * 恢复成功需刷新页面让进度生效；无更新存档则静默跳过。 */
                        if (typeof BE.downloadProfile === 'function') {
                            BE.downloadProfile().then((restored) => {
                                if (restored) {
                                    toast('检测到云端更新的存档，正在同步…');
                                    setTimeout(() => { try { location.reload(); } catch (_) {} }, 1000);
                                }
                            }).catch(() => {});
                        }
                        close();
                    } else {
                        errEl.textContent = (r && r.error) || '操作失败，请稍后再试。';
                    }
                }).catch(() => { busy(false); errEl.textContent = '网络异常，请稍后再试。'; });
            }

            goBtn.addEventListener('click', submit);
            /* 表单回车直接进入 */
            [userIn, passIn].forEach((el) => {
                el.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } });
            });

            body.appendChild(userIn);
            body.appendChild(passIn);
            body.appendChild(errEl);
            body.appendChild(goBtn);
        }

        /* ---------- 已登录：账号信息 + 云档 + 退出 ---------- */
        function renderLogged() {
            const u = (BE.getUser && BE.getUser()) || {};
            const card = h('div', 'flex items-center gap-4 p-4 rounded-xl bg-neon-cyan/5 border border-neon-cyan/25 mb-4');
            const avatar = h('div', 'w-14 h-14 rounded-full flex items-center justify-center text-2xl border border-neon-gold/50 bg-neon-gold/10 text-neon-gold');
            avatar.textContent = '👤';
            const info = h('div', 'flex flex-col');
            info.appendChild(h('div', 'font-tech text-lg text-glow-cyan', u.username || '未知用户'));
            info.appendChild(h('div', 'text-xs text-text-lo font-mono mt-1', '注册时间：' + fmtDate(u.created_at)));
            card.appendChild(avatar);
            card.appendChild(info);
            body.appendChild(card);
            body.appendChild(h('div', 'text-xs text-text-lo leading-relaxed mb-4',
                '云端存档会打包本地全部进度（最佳纪录 / 设置 / 成就等），换设备登录后可一键恢复。'));

            const row = h('div', 'flex flex-wrap gap-3');
            const upBtn = h('button', 'ct-neon-btn btn-primary !h-11 flex-1', '☁ 上传存档');
            const downBtn = h('button', 'ct-neon-btn btn-ghost !h-11 flex-1', '⬇ 恢复存档');
            const outBtn = h('button', 'ct-neon-btn btn-ghost !h-11 flex-1', '退出登录');
            row.appendChild(upBtn);
            row.appendChild(downBtn);
            row.appendChild(outBtn);
            body.appendChild(row);

            upBtn.addEventListener('click', () => {
                upBtn.disabled = true;
                upBtn.textContent = '☁ 上传中…';
                BE.uploadProfile().then((ok) => {
                    upBtn.disabled = false;
                    upBtn.textContent = '☁ 上传存档';
                    toast(ok ? '云端存档上传成功' : '上传失败：无法连接服务器', ok ? 'info' : 'warn');
                }).catch(() => { upBtn.disabled = false; upBtn.textContent = '☁ 上传存档'; toast('上传失败：网络异常', 'warn'); });
            });

            downBtn.addEventListener('click', () => {
                downBtn.disabled = true;
                downBtn.textContent = '⬇ 恢复中…';
                BE.downloadProfile().then((ok) => {
                    downBtn.disabled = false;
                    downBtn.textContent = '⬇ 恢复存档';
                    if (ok) {
                        toast('云端存档已恢复，即将刷新页面生效');
                        setTimeout(() => { try { location.reload(); } catch (_) {} }, 1200);
                    } else {
                        toast('云端没有更新的存档（本地已是最新）', 'warn');
                    }
                }).catch(() => { downBtn.disabled = false; downBtn.textContent = '⬇ 恢复存档'; toast('恢复失败：网络异常', 'warn'); });
            });

            outBtn.addEventListener('click', () => {
                BE.logout().then(() => {
                    toast('已退出登录');
                    render();   // 弹窗内直接切回登录表单
                }).catch(() => { toast('已退出登录', 'warn'); render(); });
            });
        }

        render();
    };

    global.CT_UI_AUTH = AUTH;
    try { AUTH.init(); } catch (_) {}
})(typeof window !== 'undefined' ? window : globalThis);

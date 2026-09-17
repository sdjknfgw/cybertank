/* ==========================================================
 * CyberTank — 后端接口层（账号 / 排行榜 / 云端存档）
 * window.CT_BACKEND
 * 纯前端桥接层：同源部署（server.py 8080 同时托管静态文件），
 * 所有请求统一 AbortController 5s 超时 + try/catch，
 * 任何网络错误都降级为 null/false，绝不抛出到调用方（离线可玩）。
 * ========================================================== */
(function (global) {
    'use strict';

    const TOKEN_KEY = 'ct_token';              // 登录凭证（localStorage）
    const CLOUD_TS_KEY = 'ct_cloud_saved_at'; // 本地最近一次恢复云端存档的时间戳
    /* API 基址：config.js 里配置 window.CT_API_BASE 即可指向云端后端
     * （阿里云 FC / Cloudflare Workers / 自有服务器，契约一致）；
     * 留空 = 同源本地模式（python server.py）。 */
    const _remoteBase = String(global.CT_API_BASE || '').replace(/\/+$/, '');
    const API_BASE = _remoteBase || 'api';     // 远程绝对地址 或 同源相对路径 api/*
    const IS_REMOTE = !!_remoteBase;
    const TIMEOUT_MS = 5000;                  // 统一请求超时
    /* fetch 完全失败（data=null）时的统一提示：按部署模式给出可操作指引 */
    const UNREACHABLE_MSG = IS_REMOTE
        ? '云端服务器连接失败：可能是网络波动或后端地址失效，请稍后再试，或检查 config.js 中的 CT_API_BASE'
        : '无法连接服务器：双击游戏目录下的「启动游戏.bat」启动后端；若想让网友直接在线玩，请在 config.js 配置云端后端地址';

    /* 状态：user 当前登录用户；ready 登录态恢复 Promise */
    const state = { user: null, ready: Promise.resolve(null) };

    /* ---------- 小工具 ---------- */
    function ls() { try { return localStorage; } catch (_) { return null; } }
    function getToken() {
        const s = ls();
        try { return (s && s.getItem(TOKEN_KEY)) || ''; } catch (_) { return ''; }
    }
    function setToken(t) {
        const s = ls();
        if (!s) return;
        try { if (t) s.setItem(TOKEN_KEY, t); else s.removeItem(TOKEN_KEY); } catch (_) {}
    }
    function busEmit(evt, payload) {
        try {
            const b = global.CT_BUS;
            if (b && typeof b.emit === 'function') b.emit(evt, payload);
        } catch (_) {}
    }
    function authChanged() { busEmit('auth:change', { user: state.user }); }

    /**
     * 统一 JSON 请求：5s 超时，网络/解析失败一律返回 null（不抛异常）
     * @param {string} path 形如 '/me'（自动拼接 API 前缀）
     * @param {{method?:string, body?:Object}} opts
     * @returns {Promise<Object|null>} 解析后的响应体
     */
    async function request(path, opts) {
        opts = opts || {};
        const ctl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
        const timer = setTimeout(() => { try { ctl && ctl.abort(); } catch (_) {} }, TIMEOUT_MS);
        try {
            const headers = { 'Content-Type': 'application/json' };
            const tk = getToken();
            if (tk) headers['Authorization'] = 'Bearer ' + tk;
            const res = await fetch(API_BASE + path, {
                method: opts.method || 'GET',
                headers: headers,
                body: opts.body ? JSON.stringify(opts.body) : undefined,
                signal: ctl ? ctl.signal : undefined
            });
            try { return await res.json(); } catch (_) { return null; }
        } catch (_) {
            return null;   // 超时 / 断网 / 服务器不可达：统一降级 null
        } finally {
            clearTimeout(timer);
        }
    }

    /* ---------- CT_BACKEND ---------- */
    const BE = {};

    /* 初始化：若本地有 token 则调 /api/me 恢复登录态（失效则清除），resolve ready */
    BE.init = function () {
        state.ready = (async () => {
            if (!getToken()) return null;
            const data = await request('/me');
            if (data && data.ok && data.user) {
                state.user = data.user;
                return state.user;
            }
            setToken('');        // token 失效：清除凭证，保持离线态
            state.user = null;
            return null;
        })();
        return state.ready;
    };

    /* 一键进入：登录 + 自动注册二合一（账号不存在时服务端直接建号） */
    BE.enter = async function (username, password) {
        const data = await request('/enter', { method: 'POST', body: { username: username, password: password } });
        if (data && data.ok && data.token) {
            setToken(data.token);
            state.user = data.user || null;
            authChanged();
            return { ok: true, user: state.user, created: !!data.created };
        }
        return { ok: false, error: (data && data.error) || UNREACHABLE_MSG };
    };

    /* 注册：成功存 token + user 并广播 auth:change */
    BE.register = async function (username, password) {
        const data = await request('/register', { method: 'POST', body: { username: username, password: password } });
        if (data && data.ok && data.token) {
            setToken(data.token);
            state.user = data.user || null;
            authChanged();
            return { ok: true, user: state.user };
        }
        return { ok: false, error: (data && data.error) || UNREACHABLE_MSG };
    };

    /* 登录：成功存 token + user 并广播 auth:change */
    BE.login = async function (username, password) {
        const data = await request('/login', { method: 'POST', body: { username: username, password: password } });
        if (data && data.ok && data.token) {
            setToken(data.token);
            state.user = data.user || null;
            authChanged();
            return { ok: true, user: state.user };
        }
        return { ok: false, error: (data && data.error) || UNREACHABLE_MSG };
    };

    /* 退出：无论接口是否成功，本地一律清空登录态并广播 */
    BE.logout = async function () {
        if (getToken()) await request('/logout', { method: 'POST' });
        setToken('');
        state.user = null;
        authChanged();
        return true;
    };

    BE.isLoggedIn = function () { return !!(state.user && getToken()); };
    BE.getUser = function () { return state.user; };

    /* 全球排行榜：失败返回 null（离线降级，调用方回退本地最佳） */
    BE.leaderboard = async function (mode, limit) {
        const q = '?mode=' + encodeURIComponent(String(mode || 'horde')) +
                  '&limit=' + encodeURIComponent(String(limit || 50));
        const data = await request('/leaderboard' + q);
        if (data && data.ok && Array.isArray(data.rows)) return data;
        return null;
    };

    /* 成绩上报：仅登录才发；失败静默（返回 false，不 toast） */
    BE.reportScore = async function (rec) {
        if (!BE.isLoggedIn() || !rec || !rec.mode) return false;
        const data = await request('/scores', { method: 'POST', body: rec });
        return !!(data && data.ok);
    };

    /* 云档上传：把本地所有 ct_ 前缀 localStorage 键打包为一个 profile 快照。
     * 注意：ct_token（凭证）与 ct_cloud_saved_at（本地恢复时间戳）不打包——
     * 前者是敏感信息不得上传，后者属于本机同步元数据，写入会污染比较基准。 */
    BE.uploadProfile = async function () {
        if (!BE.isLoggedIn()) return false;
        const s = ls();
        if (!s) return false;
        const kv = {};
        const savedAt = Date.now();
        try {
            for (let i = 0; i < s.length; i++) {
                const k = s.key(i);
                if (k && k.indexOf('ct_') === 0 && k !== TOKEN_KEY && k !== CLOUD_TS_KEY) {
                    kv[k] = s.getItem(k);   // 保留原始字符串，恢复时无损写回
                }
            }
        } catch (_) { return false; }
        const data = await request('/profile', {
            method: 'POST',
            body: { data: { kv: kv, savedAt: savedAt } }
        });
        const ok = !!(data && data.ok);
        /* 上传成功：同步本机恢复基准时间戳，避免下次登录把刚上传的云档
         * 判定为"比本地新"而触发无意义的恢复 + 刷新（同一设备场景）。 */
        if (ok) {
            try { s.setItem(CLOUD_TS_KEY, JSON.stringify(savedAt)); } catch (_) {}
        }
        return ok;
    };

    /* 云档恢复：GET /api/me 取 profile，云端 savedAt 严格新于本地
     * ct_cloud_saved_at 才把 kv 写回各键（防旧云档覆盖新本地进度）。
     * @returns {Promise<boolean>} 是否真正执行了恢复 */
    BE.downloadProfile = async function () {
        if (!BE.isLoggedIn()) return false;
        const s = ls();
        if (!s) return false;
        const data = await request('/me');
        const prof = (data && data.ok) ? data.profile : null;
        if (!prof || typeof prof !== 'object') return false;   // 无云档或拉取失败
        const cloud = Number(prof.savedAt) || 0;
        let local = 0;
        try { local = Number(JSON.parse(s.getItem(CLOUD_TS_KEY) || '0')) || 0; } catch (_) {}
        if (cloud <= local) return false;   // 云端不比本地新：不覆盖
        try {
            const kv = prof.kv || {};
            Object.keys(kv).forEach((k) => {
                /* 只写回 ct_ 前缀键；ct_token 例外——绝不允许被云档覆盖凭证 */
                if (k && k.indexOf('ct_') === 0 && k !== TOKEN_KEY && k !== CLOUD_TS_KEY) {
                    try { s.setItem(k, String(kv[k])); } catch (_) {}
                }
            });
            s.setItem(CLOUD_TS_KEY, JSON.stringify(cloud));   // 记录本次恢复时间戳
        } catch (_) { return false; }
        return true;
    };

    global.CT_BACKEND = BE;

    /* 模块加载即自检恢复登录态（无需等待 main.js bootstrap） */
    try { BE.init(); } catch (_) {}
})(typeof window !== 'undefined' ? window : globalThis);

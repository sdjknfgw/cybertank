/**
 * CyberTank — Cloudflare Workers 后端（与 server.py API 契约完全一致）
 * ============================================================
 * 存储：Cloudflare D1（SQLite），账号/云存档/成绩全部持久化
 * 部署步骤见本目录 README 或仓库说明；绑定 D1 变量名必须为 DB
 *
 * 接口（全部返回 JSON，CORS 全开）：
 *   POST /api/enter       {username,password}        → {ok,token,created,user}
 *   POST /api/register    {username,password}        → {ok,token,user}
 *   POST /api/login       {username,password}        → {ok,token,user}
 *   POST /api/logout      (Bearer)                   → {ok}
 *   GET  /api/me          (Bearer)                   → {ok,user,profile}
 *   POST /api/profile     (Bearer) {data:{...}}      → {ok}
 *   POST /api/scores      (Bearer) {mode,score,...}  → {ok,best}
 *   GET  /api/leaderboard?mode=horde&limit=50      → {ok,rows,count}
 */

const MODE_WHITELIST = ['horde', 'battle-royale', 'king-hill', 'duel', 'kingdefend', 'online'];
const USERNAME_RE = /^[A-Za-z0-9_\u4e00-\u9fa5]{1,16}$/;
const TOKEN_DAYS = 30;
const MAX_TOKENS_PER_USER = 10;
const MAX_SCORES_PER_USER = 500;

const CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

function json(obj, code = 200) {
    return new Response(JSON.stringify(obj), {
        status: code,
        headers: Object.assign({ 'Content-Type': 'application/json; charset=utf-8' }, CORS),
    });
}

async function readJson(req) {
    try { return await req.json(); } catch (_) { return null; }
}

/* PBKDF2-HMAC-SHA256(100k) 与 server.py 完全一致的哈希格式 */
async function hashPassword(password, saltHex) {
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits(
        { name: 'PBKDF2', hash: 'SHA-256', salt: hexToBytes(saltHex), iterations: 100000 },
        key, 256);
    return bytesToHex(new Uint8Array(bits));
}

function hexToBytes(hex) {
    const out = new Uint8Array(hex.length / 2);
    for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
    return out;
}
function bytesToHex(bytes) {
    return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
}
function randomHex(n) {
    const b = new Uint8Array(n);
    crypto.getRandomValues(b);
    return bytesToHex(b);
}

function validateCredentials(username, password) {
    if (!USERNAME_RE.test(username || '')) return '用户名需 1~16 位：字母 / 数字 / 下划线 / 中文';
    if (!password || password.length > 64) return '密码长度需 1~64 位';
    return null;
}

async function issueToken(env, userId, tokensJson) {
    const token = randomHex(32);
    const now = Math.floor(Date.now() / 1000);
    let toks = {};
    try { toks = JSON.parse(tokensJson || '{}') || {}; } catch (_) {}
    for (const t of Object.keys(toks)) if (toks[t] <= now) delete toks[t];
    toks[token] = now + TOKEN_DAYS * 86400;
    const keys = Object.keys(toks);
    while (keys.length > MAX_TOKENS_PER_USER) {
        const oldest = keys.reduce((a, b) => (toks[a] <= toks[b] ? a : b));
        delete toks[oldest];
        keys.splice(keys.indexOf(oldest), 1);
    }
    await env.DB.prepare('UPDATE users SET tokens=? WHERE id=?').bind(JSON.stringify(toks), userId).run();
    return token;
}

/* Bearer token → 用户行（id, username, created_at, ...） */
async function authUser(env, req) {
    const auth = req.headers.get('Authorization') || '';
    if (!auth.startsWith('Bearer ')) return null;
    const token = auth.slice(7).trim();
    if (!token) return null;
    const now = Math.floor(Date.now() / 1000);
    const rows = await env.DB.prepare('SELECT id, username, pass_hash, salt, created_at, tokens, profile FROM users').all();
    for (const u of (rows.results || [])) {
        let toks = {};
        try { toks = JSON.parse(u.tokens || '{}') || {}; } catch (_) {}
        if (toks[token] && toks[token] > now) return u;
    }
    return null;
}

function publicUser(u) {
    return { username: u.username, created_at: u.created_at || 0 };
}

export default {
    async fetch(req, env) {
        const url = new URL(req.url);
        const path = url.pathname;
        if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
        if (!path.startsWith('/api/')) return json({ ok: false, error: 'Not Found' }, 404);

        try {
            /* ---------- 一键进入：登录 / 自动注册 ---------- */
            if (path === '/api/enter' && req.method === 'POST') {
                const body = (await readJson(req)) || {};
                const username = String(body.username || '').trim();
                const password = String(body.password || '');
                const err = validateCredentials(username, password);
                if (err) return json({ ok: false, error: err }, 400);
                const row = await env.DB.prepare('SELECT id, username, pass_hash, salt, created_at FROM users WHERE username = ?1 COLLATE NOCASE')
                    .bind(username).first();
                if (!row) {
                    const salt = randomHex(16);
                    const pass_hash = await hashPassword(password, salt);
                    const created_at = Math.floor(Date.now() / 1000);
                    const ins = await env.DB.prepare(
                        'INSERT INTO users (username, pass_hash, salt, created_at, tokens, profile) VALUES (?1, ?2, ?3, ?4, ?, ?)')
                        .bind(username, pass_hash, salt, created_at, '{}', null).run();
                    const id = ins.meta && ins.meta.last_row_id;
                    const token = await issueToken(env, id, '{}');
                    return json({ ok: true, token, created: true, user: { username, created_at } });
                }
                if ((await hashPassword(password, row.salt)) !== row.pass_hash) {
                    return json({ ok: false, error: '该用户名已被注册且密码不符' }, 401);
                }
                const token = await issueToken(env, row.id, row.tokens || '{}');
                return json({ ok: true, token, created: false, user: publicUser(row) });
            }

            /* ---------- 注册 ---------- */
            if (path === '/api/register' && req.method === 'POST') {
                const body = (await readJson(req)) || {};
                const username = String(body.username || '').trim();
                const password = String(body.password || '');
                const err = validateCredentials(username, password);
                if (err) return json({ ok: false, error: err }, 400);
                const exists = await env.DB.prepare('SELECT id FROM users WHERE username = ?1 COLLATE NOCASE').bind(username).first();
                if (exists) return json({ ok: false, error: '用户名已被占用' }, 409);
                const salt = randomHex(16);
                const pass_hash = await hashPassword(password, salt);
                const created_at = Math.floor(Date.now() / 1000);
                const ins = await env.DB.prepare(
                    'INSERT INTO users (username, pass_hash, salt, created_at, tokens, profile) VALUES (?1, ?2, ?3, ?4, ?, ?)')
                    .bind(username, pass_hash, salt, created_at, '{}', null).run();
                const token = await issueToken(env, ins.meta.last_row_id, '{}');
                return json({ ok: true, token, user: { username, created_at } });
            }

            /* ---------- 登录 ---------- */
            if (path === '/api/login' && req.method === 'POST') {
                const body = (await readJson(req)) || {};
                const username = String(body.username || '').trim();
                const password = String(body.password || '');
                const row = await env.DB.prepare('SELECT id, username, pass_hash, salt, created_at, tokens FROM users WHERE username = ?1 COLLATE NOCASE')
                    .bind(username).first();
                if (!row || (await hashPassword(password, row.salt)) !== row.pass_hash) {
                    return json({ ok: false, error: '用户名或密码错误' }, 401);
                }
                const token = await issueToken(env, row.id, row.tokens || '{}');
                return json({ ok: true, token, user: publicUser(row) });
            }

            /* ---------- 退出 ---------- */
            if (path === '/api/logout' && req.method === 'POST') {
                const u = await authUser(env, req);
                if (u) {
                    const auth = req.headers.get('Authorization') || '';
                    const token = auth.slice(7).trim();
                    let toks = {};
                    try { toks = JSON.parse(u.tokens || '{}') || {}; } catch (_) {}
                    delete toks[token];
                    await env.DB.prepare('UPDATE users SET tokens=? WHERE id=?').bind(JSON.stringify(toks), u.id).run();
                }
                return json({ ok: true });
            }

            /* ---------- 当前用户 + 云端存档 ---------- */
            if (path === '/api/me' && req.method === 'GET') {
                const u = await authUser(env, req);
                if (!u) return json({ ok: false, error: '未登录或登录已过期' }, 401);
                let profile = null;
                try { profile = u.profile ? JSON.parse(u.profile) : null; } catch (_) {}
                return json({ ok: true, user: publicUser(u), profile });
            }

            /* ---------- 上传云档 ---------- */
            if (path === '/api/profile' && req.method === 'POST') {
                const u = await authUser(env, req);
                if (!u) return json({ ok: false, error: '未登录' }, 401);
                const body = (await readJson(req)) || {};
                const data = body.data;
                if (!data || typeof data !== 'object' || Array.isArray(data)) {
                    return json({ ok: false, error: 'data 必须是对象' }, 400);
                }
                const raw = JSON.stringify(data);
                if (raw.length > 64 * 1024) return json({ ok: false, error: '存档数据过大(>64KB)' }, 400);
                await env.DB.prepare('UPDATE users SET profile=? WHERE id=?').bind(raw, u.id).run();
                return json({ ok: true });
            }

            /* ---------- 上报成绩 ---------- */
            if (path === '/api/scores' && req.method === 'POST') {
                const u = await authUser(env, req);
                if (!u) return json({ ok: false, error: '未登录' }, 401);
                const body = (await readJson(req)) || {};
                const mode = String(body.mode || '');
                if (MODE_WHITELIST.indexOf(mode) < 0) return json({ ok: false, error: '未知模式' }, 400);
                const num = (v, d = 0) => { const f = parseFloat(v); return isFinite(f) ? f : d; };
                const score = Math.min(1e9, Math.max(0, num(body.score)));
                const wave = Math.min(9999, Math.max(0, Math.floor(num(body.wave))));
                const duration = Math.min(86400, Math.max(0, num(body.duration)));
                const victory = body.victory ? 1 : 0;
                const difficulty = String(body.difficulty || '').slice(0, 16) || null;
                const tank = String(body.tank || '').slice(0, 16) || null;
                const created_at = Math.floor(Date.now() / 1000);
                await env.DB.prepare(
                    'INSERT INTO scores (user_id, username, mode, score, wave, duration, victory, difficulty, tank, created_at) ' +
                    'VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)')
                    .bind(u.id, u.username, mode, score, wave, duration, victory, difficulty, tank, created_at).run();
                /* 限制每人成绩条数，防止无限膨胀 */
                const cnt = await env.DB.prepare('SELECT COUNT(*) AS n FROM scores WHERE user_id = ?1').bind(u.id).first();
                if (cnt && cnt.n > MAX_SCORES_PER_USER) {
                    await env.DB.prepare(
                        'DELETE FROM scores WHERE user_id = ?1 AND id IN ' +
                        '(SELECT id FROM scores WHERE user_id = ?1 ORDER BY created_at ASC LIMIT ?2)')
                        .bind(u.id, cnt.n - MAX_SCORES_PER_USER).run();
                }
                const bestRow = await env.DB.prepare('SELECT MAX(score) AS best FROM scores WHERE user_id = ?1 AND mode = ?2')
                    .bind(u.id, mode).first();
                return json({ ok: true, best: Math.floor(bestRow ? bestRow.best || 0 : 0) });
            }

            /* ---------- 全球排行榜 ---------- */
            if (path === '/api/leaderboard' && req.method === 'GET') {
                const mode = url.searchParams.get('mode') || 'horde';
                const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get('limit') || '50', 10) || 50));
                if (MODE_WHITELIST.indexOf(mode) < 0) return json({ ok: false, error: '未知模式' }, 400);
                const rows = await env.DB.prepare(
                    'SELECT username, score, wave, duration, victory, difficulty, tank, created_at ' +
                    'FROM scores WHERE mode = ?1 ORDER BY score DESC, created_at ASC LIMIT ?2')
                    .bind(mode, limit).all();
                const out = (rows.results || []).map((r, i) => ({
                    username: r.username,
                    score: Math.floor(r.score || 0),
                    wave: r.wave || 0,
                    duration: r.duration || 0,
                    victory: !!r.victory,
                    difficulty: r.difficulty,
                    tank: r.tank,
                    created_at: r.created_at || 0,
                    rank: i + 1,
                }));
                return json({ ok: true, rows: out, count: out.length });
            }

            return json({ ok: false, error: 'Not Found' }, 404);
        } catch (e) {
            return json({ ok: false, error: '服务器内部错误: ' + (e && e.message ? e.message : e) }, 500);
        }
    },
};

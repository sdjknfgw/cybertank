# -*- coding: utf-8 -*-
"""
CyberTank 后端服务（零第三方依赖，仅 Python 标准库）
====================================================
功能：
  1. 静态文件托管（游戏本体 index.html / js / css ...）
  2. 账号系统：一键进入（登录，新用户自动注册；PBKDF2-HMAC-SHA256 加盐哈希 + Bearer Token）
  3. 云存档：profile 整包上传 / 下载（登录用户）
  4. 排行榜：按模式上报成绩、按模式查询全球排行

启动：
  python server.py            # 默认 0.0.0.0:8080
  python server.py 9000       # 自定义端口
  或直接双击 启动游戏.bat（自动拉起本服务并打开游戏）

数据存储（纯 JSON 文件，便于查看 / 备份 / 迁移）：
  data/users/<用户名小写>.json  ← 用户信息文件夹：每个用户一个文件
    { username, pass_hash, salt, created_at,
      tokens: {token: 过期时间戳},          ← 登录凭证
      profile: {...} | null,               ← 云端存档（前端 ct_* localStorage 快照）
      scores: [ {mode,score,...}, ... ] }  ← 该用户全部成绩记录
  旧版 SQLite（data/cybertank.db）在首次启动时自动迁移到 data/users/，之后不再使用。

API 契约（前端 CT_BACKEND 对应实现）：
  POST /api/enter     {"username","password"}         → {"ok","token","user","created"}
                                                       一键进入：账号不存在自动注册，存在则校验密码登录
  POST /api/register  {"username","password"}         → {"ok","token","user"}
  POST /api/login     {"username","password"}         → {"ok","token","user"}
  POST /api/logout    (Header: Authorization: Bearer) → {"ok"}
  GET  /api/me        (Bearer)                        → {"ok","user","profile"}
  POST /api/profile   (Bearer) {"data":{...}}         → {"ok"}
  POST /api/scores    (Bearer) {"mode","score",...}   → {"ok","best"}
  GET  /api/leaderboard?mode=horde&limit=50           → {"ok","rows":[...]}
"""
import json
import os
import re
import secrets
import sqlite3
import sys
import time
import hashlib
import threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

ROOT = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(ROOT, 'data')
USERS_DIR = os.path.join(DATA_DIR, 'users')           # ← 用户信息文件夹：每用户一个 JSON 文件
OLD_DB_PATH = os.path.join(DATA_DIR, 'cybertank.db')  # 旧版 SQLite（仅首次迁移读取）
TOKEN_DAYS = 30
MAX_SCORES_PER_USER = 500
MAX_TOKENS_PER_USER = 10
USERNAME_RE = re.compile(r'^[A-Za-z0-9_\u4e00-\u9fa5]{1,16}$')  # 1~16 位：字母/数字/下划线/中文

MODE_WHITELIST = {'horde', 'battle-royale', 'king-hill', 'duel', 'kingdefend', 'online'}

# ---- 联机段位（PvP）：积分规则与前端 js/systems/pvp.js 保持一致 ----
PVP_DEFAULT_RATING = 1000
PVP_FLOOR = 900
# ---- 在线房间登记：内存态 {code: {name, rating, ts}}，心跳续期，过期即失效 ----
ROOM_TTL = 20          # 秒：超过未心跳的房间自动从列表消失
_ROOMS = {}

MIME = {
    '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
    '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.map': 'application/json',
    '.md': 'text/markdown; charset=utf-8',
}

_LOCK = threading.Lock()  # ThreadingHTTPServer 多线程并发：用户文件读写统一加锁


# ==================== 用户文件存储（data/users/ 文件夹） ====================
def _user_path(username):
    # 用户名只含 字母/数字/下划线/中文（无路径符号），小写化实现大小写不敏感的唯一性
    return os.path.join(USERS_DIR, username.strip().lower() + '.json')


def _read_json(path):
    try:
        with open(path, 'r', encoding='utf-8') as f:
            return json.load(f)
    except Exception:
        return None


def _load_user(username):
    return _read_json(_user_path(username))


def _save_user(rec):
    path = _user_path(rec['username'])
    tmp = path + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(rec, f, ensure_ascii=False)
    os.replace(tmp, path)   # 原子替换，避免写一半被读到


def _iter_users():
    try:
        names = os.listdir(USERS_DIR)
    except OSError:
        return
    for fn in names:
        if fn.endswith('.json'):
            rec = _read_json(os.path.join(USERS_DIR, fn))
            if isinstance(rec, dict) and rec.get('username'):
                yield rec


def _validate_credentials(username, password):
    if not USERNAME_RE.match(username):
        return '用户名需 1~16 位：字母 / 数字 / 下划线 / 中文'
    if not password or len(password) > 64:
        return '密码长度需 1~64 位'
    return None


def _create_user(username, password):
    salt = secrets.token_hex(16)
    return {
        'username': username,
        'pass_hash': hash_password(password, salt),
        'salt': salt,
        'created_at': int(time.time()),
        'tokens': {},
        'profile': None,
        'scores': [],
        'pvpRating': PVP_DEFAULT_RATING,
        'pvpWins': 0,
        'pvpLosses': 0,
    }


def _issue_token(rec):
    token = secrets.token_hex(32)
    now = int(time.time())
    toks = rec.setdefault('tokens', {})
    toks[token] = now + TOKEN_DAYS * 86400
    for t, exp in list(toks.items()):       # 清理过期令牌
        if exp <= now:
            del toks[t]
    while len(toks) > MAX_TOKENS_PER_USER:  # 限制令牌数量，防止文件无限膨胀
        del toks[min(toks, key=lambda t: toks[t])]
    return token


def user_by_token(token):
    """按 Bearer token 找用户（扫文件夹即可，用户量小；返回记录引用，调用方需持锁修改）"""
    if not token:
        return None
    now = int(time.time())
    for rec in _iter_users():
        exp = (rec.get('tokens') or {}).get(token)
        if exp and exp > now:
            return rec
    return None


def hash_password(password, salt):
    return hashlib.pbkdf2_hmac('sha256', password.encode('utf-8'), bytes.fromhex(salt), 100000).hex()


def migrate_old_db():
    """旧版 SQLite → data/users/*.json 一次性迁移（users 文件夹已有数据则跳过）"""
    os.makedirs(USERS_DIR, exist_ok=True)
    if any(fn.endswith('.json') for fn in os.listdir(USERS_DIR)):
        return
    if not os.path.isfile(OLD_DB_PATH):
        return
    try:
        conn = sqlite3.connect(OLD_DB_PATH)
        conn.row_factory = sqlite3.Row
        rows = conn.execute('SELECT * FROM users').fetchall()
        count = 0
        for u in rows:
            rec = {
                'username': u['username'], 'pass_hash': u['pass_hash'], 'salt': u['salt'],
                'created_at': u['created_at'], 'tokens': {}, 'profile': None, 'scores': [],
            }
            prow = conn.execute('SELECT data FROM profiles WHERE user_id=?', (u['id'],)).fetchone()
            if prow:
                try:
                    v = json.loads(prow['data'])
                    if isinstance(v, dict):
                        rec['profile'] = v
                except Exception:
                    pass
            for s in conn.execute('SELECT * FROM scores WHERE user_id=? ORDER BY created_at', (u['id'],)):
                rec['scores'].append({
                    'mode': s['mode'], 'score': s['score'], 'wave': s['wave'],
                    'duration': s['duration'], 'victory': s['victory'],
                    'difficulty': s['difficulty'], 'tank': s['tank'], 'created_at': s['created_at'],
                })
            _save_user(rec)
            count += 1
        conn.close()
        print('migrated %d user(s) from cybertank.db -> %s' % (count, USERS_DIR))
    except Exception as e:
        print('WARN: migrate_old_db failed: %s' % e)


def json_body(handler):
    length = int(handler.headers.get('Content-Length') or 0)
    if length <= 0 or length > 1 * 1024 * 1024:
        return None
    raw = handler.rfile.read(length)
    try:
        return json.loads(raw.decode('utf-8'))
    except Exception:
        return None


class Handler(SimpleHTTPRequestHandler):
    # 静态根目录 = 项目根
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def log_message(self, fmt, *args):
        sys.stderr.write('[%s] %s\n' % (time.strftime('%H:%M:%S'), fmt % args))

    # ---------- 工具 ----------
    def _cors(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Headers', 'Authorization, Content-Type')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')

    def _json(self, obj, code=200):
        body = json.dumps(obj, ensure_ascii=False).encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self._cors()
        self.end_headers()
        self.wfile.write(body)

    def _bearer(self):
        auth = self.headers.get('Authorization') or ''
        return auth[7:].strip() if auth.startswith('Bearer ') else None

    def _public_user(self, rec):
        return {
            'username': rec['username'],
            'created_at': rec.get('created_at', 0),
            'pvpRating': int(rec.get('pvpRating', PVP_DEFAULT_RATING) or PVP_DEFAULT_RATING),
            'pvpWins': int(rec.get('pvpWins', 0) or 0),
            'pvpLosses': int(rec.get('pvpLosses', 0) or 0),
        }

    # ---------- 路由 ----------
    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path
        if path == '/api/me':
            with _LOCK:
                rec = user_by_token(self._bearer())
            if not rec:
                return self._json({'ok': False, 'error': '未登录或登录已过期'}, 401)
            return self._json({'ok': True, 'user': self._public_user(rec),
                               'profile': rec.get('profile')})
        if path == '/api/leaderboard':
            qs = parse_qs(parsed.query)
            mode = (qs.get('mode') or ['horde'])[0]
            limit = min(100, max(1, int((qs.get('limit') or ['50'])[0])))
            if mode not in MODE_WHITELIST:
                return self._json({'ok': False, 'error': '未知模式'}, 400)
            rows = []
            with _LOCK:
                for rec in _iter_users():
                    for s in rec.get('scores') or []:
                        if s.get('mode') == mode:
                            rows.append({
                                'username': rec['username'],
                                'score': s.get('score', 0), 'wave': s.get('wave', 0),
                                'duration': s.get('duration', 0), 'victory': bool(s.get('victory')),
                                'difficulty': s.get('difficulty'), 'tank': s.get('tank'),
                                'created_at': s.get('created_at', 0),
                            })
            rows.sort(key=lambda r: (-float(r['score'] or 0), r['created_at']))
            out = []
            for i, r in enumerate(rows[:limit]):
                r['rank'] = i + 1
                r['score'] = int(r['score'] or 0)
                out.append(r)
            return self._json({'ok': True, 'rows': out, 'count': len(out)})
        if path == '/api/pvp/ladder':
            # 联机段位天梯：按积分排（只列打过至少 1 场的玩家）
            qs = parse_qs(parsed.query)
            limit = min(100, max(1, int((qs.get('limit') or ['50'])[0])))
            with _LOCK:
                rows = []
                for rec in _iter_users():
                    w = int(rec.get('pvpWins', 0) or 0)
                    l = int(rec.get('pvpLosses', 0) or 0)
                    if w + l <= 0:
                        continue
                    rows.append({
                        'username': rec['username'],
                        'rating': int(rec.get('pvpRating', PVP_DEFAULT_RATING) or PVP_DEFAULT_RATING),
                        'wins': w, 'losses': l,
                    })
            rows.sort(key=lambda r: (-r['rating'], r['username'].lower()))
            for i, r in enumerate(rows[:limit]):
                r['rank'] = i + 1
            return self._json({'ok': True, 'rows': rows[:limit], 'count': len(rows[:limit])})
        if path == '/api/rooms':
            # 在线房间列表：只返回心跳未过期（ROOM_TTL 秒）的房间
            now = time.time()
            with _LOCK:
                rows = [
                    {'code': c, 'name': v['name'], 'rating': v['rating'], 'ts': v['ts']}
                    for c, v in _ROOMS.items() if now - v['ts'] <= ROOM_TTL
                ]
            rows.sort(key=lambda r: -r['ts'])
            return self._json({'ok': True, 'rows': rows[:50], 'count': len(rows[:50])})
        # 其余 → 静态文件
        return super().do_GET()

    def do_POST(self):
        path = urlparse(self.path).path
        if path == '/api/enter':
            # 一键进入：账号不存在 → 自动注册；存在 → 校验密码登录
            body = json_body(self) or {}
            username = str(body.get('username') or '').strip()
            password = str(body.get('password') or '')
            err = _validate_credentials(username, password)
            if err:
                return self._json({'ok': False, 'error': err}, 400)
            with _LOCK:
                rec = _load_user(username)
                if rec is None:
                    rec = _create_user(username, password)
                    created = True
                else:
                    created = False
                    if hash_password(password, rec.get('salt', '')) != rec.get('pass_hash'):
                        return self._json({'ok': False, 'error': '该用户名已被注册且密码不符'}, 401)
                token = _issue_token(rec)
                _save_user(rec)
            return self._json({'ok': True, 'token': token, 'created': created,
                               'user': self._public_user(rec)})
        if path == '/api/register':
            body = json_body(self) or {}
            username = str(body.get('username') or '').strip()
            password = str(body.get('password') or '')
            err = _validate_credentials(username, password)
            if err:
                return self._json({'ok': False, 'error': err}, 400)
            with _LOCK:
                if _load_user(username) is not None:
                    return self._json({'ok': False, 'error': '用户名已被占用'}, 409)
                rec = _create_user(username, password)
                token = _issue_token(rec)
                _save_user(rec)
            return self._json({'ok': True, 'token': token, 'user': self._public_user(rec)})
        if path == '/api/login':
            body = json_body(self) or {}
            username = str(body.get('username') or '').strip()
            password = str(body.get('password') or '')
            with _LOCK:
                rec = _load_user(username)
                if not rec or hash_password(password, rec.get('salt', '')) != rec.get('pass_hash'):
                    return self._json({'ok': False, 'error': '用户名或密码错误'}, 401)
                token = _issue_token(rec)
                _save_user(rec)
            return self._json({'ok': True, 'token': token, 'user': self._public_user(rec)})
        if path == '/api/logout':
            token = self._bearer()
            if token:
                with _LOCK:
                    rec = user_by_token(token)
                    if rec and token in (rec.get('tokens') or {}):
                        rec['tokens'].pop(token, None)
                        _save_user(rec)
            return self._json({'ok': True})
        if path == '/api/profile':
            body = json_body(self)
            data = (body or {}).get('data')
            if not isinstance(data, dict):
                return self._json({'ok': False, 'error': 'data 必须是对象'}, 400)
            if len(json.dumps(data, ensure_ascii=False)) > 64 * 1024:
                return self._json({'ok': False, 'error': '存档数据过大(>64KB)'}, 400)
            with _LOCK:
                rec = user_by_token(self._bearer())
                if not rec:
                    return self._json({'ok': False, 'error': '未登录'}, 401)
                rec['profile'] = data
                _save_user(rec)
            return self._json({'ok': True})
        if path == '/api/scores':
            body = json_body(self) or {}
            mode = str(body.get('mode') or '')
            if mode not in MODE_WHITELIST:
                return self._json({'ok': False, 'error': '未知模式'}, 400)

            def num(k, d=0.0):
                try:
                    return float(body.get(k) or d)
                except (TypeError, ValueError):
                    return d
            score = max(0.0, min(1e9, num('score')))
            wave = int(max(0, min(9999, num('wave'))))
            duration = max(0.0, min(86400, num('duration')))
            difficulty = str(body.get('difficulty') or '')[:16] or None
            tank = str(body.get('tank') or '')[:16] or None
            with _LOCK:
                rec = user_by_token(self._bearer())
                if not rec:
                    return self._json({'ok': False, 'error': '未登录'}, 401)
                scores = rec.setdefault('scores', [])
                scores.append({
                    'mode': mode, 'score': score, 'wave': wave, 'duration': duration,
                    'victory': 1 if body.get('victory') else 0,
                    'difficulty': difficulty, 'tank': tank, 'created_at': int(time.time()),
                })
                if len(scores) > MAX_SCORES_PER_USER:
                    del scores[:len(scores) - MAX_SCORES_PER_USER]
                best = max([float(s.get('score') or 0) for s in scores if s.get('mode') == mode] + [score])
                _save_user(rec)
            return self._json({'ok': True, 'best': int(best)})
        if path == '/api/pvp/result':
            # 联机对局结算：胜 +25-2×负局 / 负 -(16-2×胜局)，下限 900（与前端 pvp.js 一致）
            body = json_body(self) or {}
            win = bool(body.get('win'))
            try:
                rw = max(0, min(3, int(body.get('roundsWon') or 0)))
                rl = max(0, min(3, int(body.get('roundsLost') or 0)))
            except (TypeError, ValueError):
                rw = rl = 0
            delta = (25 - 2 * rl) if win else -(16 - 2 * rw)
            with _LOCK:
                rec = user_by_token(self._bearer())
                if not rec:
                    return self._json({'ok': False, 'error': '未登录'}, 401)
                rating = int(rec.get('pvpRating', PVP_DEFAULT_RATING) or PVP_DEFAULT_RATING)
                rating = max(PVP_FLOOR, rating + delta)
                rec['pvpRating'] = rating
                if win:
                    rec['pvpWins'] = int(rec.get('pvpWins', 0) or 0) + 1
                else:
                    rec['pvpLosses'] = int(rec.get('pvpLosses', 0) or 0) + 1
                _save_user(rec)
                pub = self._public_user(rec)
            return self._json({'ok': True, 'delta': delta, 'user': pub})
        if path == '/api/rooms':
            # 房间登记/心跳（房主）：upsert {code, rating}
            body = json_body(self) or {}
            code = str(body.get('code') or '').strip().upper()
            if not re.match(r'^[A-Z0-9]{4,8}$', code):
                return self._json({'ok': False, 'error': '房间号格式不合法'}, 400)
            try:
                rating = max(900, min(3999, int(body.get('rating') or PVP_DEFAULT_RATING)))
            except (TypeError, ValueError):
                rating = PVP_DEFAULT_RATING
            with _LOCK:
                rec = user_by_token(self._bearer())
                if not rec:
                    return self._json({'ok': False, 'error': '未登录'}, 401)
                _ROOMS[code] = {'name': rec['username'], 'rating': rating, 'ts': time.time()}
                # 顺手清理过期房间，防止长期运行累积
                now = time.time()
                for c in [c for c, v in _ROOMS.items() if now - v['ts'] > ROOM_TTL * 10]:
                    _ROOMS.pop(c, None)
            return self._json({'ok': True})
        if path == '/api/rooms/remove':
            # 房主撤下房间
            body = json_body(self) or {}
            code = str(body.get('code') or '').strip().upper()
            with _LOCK:
                rec = user_by_token(self._bearer())
                if not rec:
                    return self._json({'ok': False, 'error': '未登录'}, 401)
                v = _ROOMS.get(code)
                if v and v['name'] == rec['username']:
                    _ROOMS.pop(code, None)
            return self._json({'ok': True})
        return self._json({'ok': False, 'error': 'Not Found'}, 404)

    def end_headers(self):
        # 静态资源不缓存（开发期），API 由 _json 单独处理
        if not urlparse(self.path).path.startswith('/api/'):
            self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def guess_type(self, path):
        ext = os.path.splitext(path)[1].lower()
        return MIME.get(ext, 'application/octet-stream')


def main():
    # 端口优先级：命令行参数 > 云平台环境变量（FC_SERVER_PORT/PORT）> 8080
    port = int(sys.argv[1]) if len(sys.argv) > 1 \
        else int(os.environ.get('FC_SERVER_PORT') or os.environ.get('PORT') or 8080)
    os.makedirs(USERS_DIR, exist_ok=True)
    migrate_old_db()
    server = ThreadingHTTPServer(('0.0.0.0', port), Handler)
    print('CyberTank server running at http://localhost:%d  (users: %s)' % (port, USERS_DIR))
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print('\nbye')


if __name__ == '__main__':
    main()

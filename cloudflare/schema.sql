-- CyberTank D1 数据库建表脚本（在 Cloudflare Dashboard → D1 → Console 中执行一次）
CREATE TABLE IF NOT EXISTS users (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    username    TEXT NOT NULL COLLATE NOCASE UNIQUE,  -- 用户名（大小写不敏感唯一）
    pass_hash   TEXT NOT NULL,                        -- PBKDF2-HMAC-SHA256(100k) 十六进制
    salt        TEXT NOT NULL,                        -- 32 hex 字符盐
    created_at  INTEGER NOT NULL,                     -- 注册时间（秒级时间戳）
    tokens      TEXT NOT NULL DEFAULT '{}',           -- 登录令牌 JSON {token: 过期秒级时间戳}
    profile     TEXT                                  -- 云端存档 JSON（前端 ct_* 快照）
);

CREATE TABLE IF NOT EXISTS scores (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL,
    username    TEXT NOT NULL,                        -- 冗余存储，排行榜免联表
    mode        TEXT NOT NULL,                        -- horde/battle-royale/king-hill/duel/kingdefend/online
    score       REAL NOT NULL,
    wave        INTEGER NOT NULL DEFAULT 0,
    duration    REAL NOT NULL DEFAULT 0,
    victory     INTEGER NOT NULL DEFAULT 0,
    difficulty  TEXT,
    tank        TEXT,
    created_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_scores_mode_score ON scores(mode, score DESC, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_scores_user ON scores(user_id);

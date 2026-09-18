-- CyberTank D1 数据库建表脚本（在 Cloudflare Dashboard → D1 → Console 中执行一次）
CREATE TABLE IF NOT EXISTS users (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    username    TEXT NOT NULL COLLATE NOCASE UNIQUE,  -- 用户名（大小写不敏感唯一）
    pass_hash   TEXT NOT NULL,                        -- PBKDF2-HMAC-SHA256(100k) 十六进制
    salt        TEXT NOT NULL,                        -- 32 hex 字符盐
    created_at  INTEGER NOT NULL,                     -- 注册时间（秒级时间戳）
    tokens      TEXT NOT NULL DEFAULT '{}',           -- 登录令牌 JSON {token: 过期秒级时间戳}
    profile     TEXT,                                 -- 云端存档 JSON（前端 ct_* 快照）
    pvp_rating  INTEGER NOT NULL DEFAULT 1000,        -- 联机段位积分（初始 1000，下限 900）
    pvp_wins    INTEGER NOT NULL DEFAULT 0,           -- 联机胜场
    pvp_losses  INTEGER NOT NULL DEFAULT 0            -- 联机负场
);

-- 在线房间登记（房主心跳 20s 续期，过期由 GET /api/rooms 清理）
CREATE TABLE IF NOT EXISTS rooms (
    code        TEXT PRIMARY KEY,                     -- 6 位房间号
    username    TEXT NOT NULL,                        -- 房主名
    rating      INTEGER NOT NULL DEFAULT 1000,        -- 房主段位积分
    ts          INTEGER NOT NULL                      -- 最近心跳毫秒时间戳
);

-- ★ 已有旧库的迁移（在 D1 Console / wrangler d1 execute 逐条执行一次）：
--   ALTER TABLE users ADD COLUMN pvp_rating INTEGER NOT NULL DEFAULT 1000;
--   ALTER TABLE users ADD COLUMN pvp_wins   INTEGER NOT NULL DEFAULT 0;
--   ALTER TABLE users ADD COLUMN pvp_losses INTEGER NOT NULL DEFAULT 0;

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

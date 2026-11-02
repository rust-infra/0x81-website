-- 0001_init（SQLite 版）—— 与 postgres/0001_init.up.sql **同一个版本号、同一件事**。
--
-- 为什么要两份 SQL 而不是一份：两边的类型系统不一样，硬合成一份就得退到
-- 最小公倍数（全用 TEXT、不写 CHECK、不写索引），代价是 Postgres 侧丢掉
-- 类型校验——而类型校验正是当初从 SQLite 换到 PG 的收益之一（见
-- postgres/0001_init.up.sql 的注释）。
--
-- 与 Postgres 版的**有意差异**（只列行为相关的，纯类型差异不列）：
--
--   · `day` 回到 `'YYYY-MM-DD'` 文本。SQLite 没有 DATE 类型，只有
--     「亲和性」，写成 DATE 一样存文本，还会让人误以为有类型校验。
--     所以这里**明确写 TEXT**，并在应用层用 sqliteDay() 统一格式化——
--     格式只有一个真相源，不靠调用方自觉。
--   · `updated_at` 用 CURRENT_TIMESTAMP（UTC、`YYYY-MM-DD HH:MM:SS`）。
--     与 PG 的 now() 语义一致（都是 UTC 时间戳），格式不同但没有比较逻辑。
--   · `schema_migrations` 同样由 cmd/migrate 建，不在这里。
--
-- 语义不变：`day` 是 **UTC+8 自然日**（§4.3），由应用层算好传进来。

-- 每日额度计数（原 coach_usage）。
CREATE TABLE IF NOT EXISTS rehearse_usage (
    user_id    TEXT    NOT NULL,
    day        TEXT    NOT NULL,
    turns_used INTEGER NOT NULL DEFAULT 0 CHECK (turns_used >= 0),
    updated_at TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, day)
);

-- 与 PG 版同理：所有读路径都是 (user_id, 今天)，这个索引是为将来的按天
-- 统计留的，单列索引成本可忽略。
CREATE INDEX IF NOT EXISTS idx_rehearse_usage_day ON rehearse_usage (day);

-- 管理端可改的设置（原 admin_settings 的 coach 键 + LLM 配置）。
CREATE TABLE IF NOT EXISTS rehearse_settings (
    key        TEXT PRIMARY KEY,
    value      TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

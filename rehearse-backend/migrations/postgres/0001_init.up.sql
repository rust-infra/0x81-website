-- 0001_init —— Rehearse 自己的两张表（§7.3.2）。
--
-- ⚠️ 这个库与墨言**不共享任何表**。所以：
--   · 没有 `users`，也没有任何指向它的外键——Rehearse 从 JWT 的 `sub` 拿 user id，
--     不读也不写用户表（§7.4.2、§7.4.4）
--   · 没有 `admin_settings`——配置读自己的 `rehearse_settings`
--   · 迁移由 Rehearse 自己管，与墨言的 SQLite 迁移**没有顺序依赖**（§7.3.3）

-- 每日额度计数（原 `coach_usage`，见 moyan-backend/migrations/011_coach_usage.sql）。
--
-- 从 SQLite 换成 Postgres 时顺带把类型改对了：
--   · `day` 用 DATE 而不是 TEXT —— 原版是 'YYYY-MM-DD' 字符串，靠约定保证格式；
--     PG 的 DATE 能让「写进一个非法日期」直接失败，也支持日期运算
--   · `updated_at` 用 TIMESTAMPTZ —— 时区语义明确，不再依赖调用方写对格式
-- 语义不变：`day` 是 **UTC+8 自然日**（§4.3 的配额按 UTC+8 切），
-- 由应用层用固定偏移算出来，不依赖数据库时区。
CREATE TABLE IF NOT EXISTS rehearse_usage (
    user_id    TEXT        NOT NULL,
    day        DATE        NOT NULL,
    turns_used INTEGER     NOT NULL DEFAULT 0 CHECK (turns_used >= 0),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, day)
);

-- 注意：`idx_coach_usage_day` 在原库里建了但**没有任何查询用它**——所有读路径都是
-- `(user_id, 今天)`（§15 #8）。这里仍然建一个，因为按天统计（运营看用量）是
-- 迟早要做的事，而单列索引的成本可以忽略。如果确定不做统计，删掉它也不影响正确性。
CREATE INDEX IF NOT EXISTS idx_rehearse_usage_day ON rehearse_usage (day);

-- 管理端可改的设置（原 `admin_settings` 的 `coach` 键 + LLM 配置）。
-- 键值形状照搬 moyan-backend/migrations/004_admin_settings.sql，便于两边对照。
--
-- 存两份的说明见 §7.3.2：LLM 配置在墨言与本服务各有一份（各管各的库），
-- 但**管理端只有一个表单，保存时双写**。
CREATE TABLE IF NOT EXISTS rehearse_settings (
    key        TEXT        PRIMARY KEY,
    value      TEXT        NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 0002_user_settings —— 用户级设置文档（主题 / 界面语言 / 语音偏好），一行一个用户。
--
-- 与 SQLite 版（sqlite/0002_user_settings.up.sql）的有意差异只有类型：
--
--   · `settings` 用 JSONB——服务端写库前已校验过形状（internal/httpapi/user_settings.go），
--     JSONB 让「手滑写进非法 JSON」直接失败，也支持将来按字段做运维查询。
--   · `updated_at` 用 TIMESTAMPTZ。同步语义用的 `updated_at` 在文档内部
--     （RFC3339，handler 生成），客户端拿到的时间格式与方言无关。
--
-- `user_sub` 直接用 JWT 的 `sub`，不引用任何用户表（本库没有 users，§7.4.2）。
CREATE TABLE IF NOT EXISTS rehearse_user_settings (
    user_sub   TEXT        PRIMARY KEY,
    settings   JSONB       NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

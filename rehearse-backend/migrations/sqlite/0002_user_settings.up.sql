-- 0002_user_settings（SQLite 版）—— 与 postgres/0002_user_settings.up.sql 同一个版本号、同一件事。
--
-- 用户级设置文档（主题 / 界面语言 / 语音偏好），一行一个用户。
-- `user_sub` 直接用 JWT 的 `sub`——与 rehearse_usage 一样，不引用任何用户表
-- （本库没有 users，§7.4.2）。
--
-- 设计要点：
--
--   · `settings` 存的是**客户端写的 JSON 文档**，服务端只校验枚举与数值范围
--     （`internal/httpapi/user_settings.go`），不展开成列。设置项随 App 迭代
--     增减，展开成列意味着每加一个开关都要一次迁移。
--   · 密钥类字段（Google / ElevenLabs / 阿里云 / Gemini 的 key、服务账号 JSON）
--     **不在这个文档里**——它们只存在 App 本机，是 §7.5.1 的凭据边界。
--   · `updated_at` 列给运维看；同步语义用的 `updated_at` 在**文档内部**
--     （RFC3339，由 handler 生成），这样客户端拿到的时间格式与方言无关。
CREATE TABLE IF NOT EXISTS rehearse_user_settings (
    user_sub   TEXT PRIMARY KEY,
    settings   TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

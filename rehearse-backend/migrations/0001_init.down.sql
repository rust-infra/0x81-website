-- 回滚 0001_init。
--
-- ⚠️ 这会**丢掉全部配额计数与设置**。两张表都是可重建的（配额最坏是当天重置、
-- 设置可由 env 兜底，§7.3.2），所以回滚是安全的——但要知道自己在丢什么。
DROP TABLE IF EXISTS rehearse_settings;
DROP TABLE IF EXISTS rehearse_usage;

-- 回滚 0001_init（SQLite 版）。
--
-- ⚠️ 这会**丢掉全部配额计数与设置**。两张表都是可重建的（配额最坏是当天重置、
-- 设置可由 env 兜底，§7.3.2），所以回滚是安全的——但要知道自己在丢什么。
--
-- 顺序与 PG 版一致：先删 settings 再删 usage（没有外键，顺序不影响正确性，
-- 只是让两边的文件能逐行对照）。
DROP TABLE IF EXISTS rehearse_settings;
DROP TABLE IF EXISTS rehearse_usage;

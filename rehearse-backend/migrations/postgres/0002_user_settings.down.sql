-- 回滚 0002_user_settings。
--
-- 丢掉的是全部用户的设置文档。设置本来就是可重建的（换一台设备重新调一遍），
-- 回滚是安全的。
DROP TABLE IF EXISTS rehearse_user_settings;

-- 回滚 0003_podcast_translations（SQLite 版）。
--
-- 丢掉的是全部播客译文。译文可以重新预生成（`/api/rehearse/podcast/translations`
-- 会在缓存缺失时重新生成），回滚是安全的。
DROP TABLE IF EXISTS rehearse_podcast_translations;

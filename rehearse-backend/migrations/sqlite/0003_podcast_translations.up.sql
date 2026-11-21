-- 0003_podcast_translations（SQLite 版）—— 与 postgres/0003_podcast_translations.up.sql 同一个版本号、同一件事。
--
-- 播客的中文字幕**离线预生成**，一行一句台词。
--
-- 为什么落库而不是播放时实时翻：
--
--   · 逐句实时调用时模型看不到上下文，同一句在不同语境下译文会飘，
--     专有名词与称呼也对不齐。整集一次性翻译（一次请求看完整段对话）
--     才可能译得准。
--   · 台词是固定的本地课程数据，一集译一次就够；播放时再调 LLM
--     既浪费额度，又会让字幕随网络逐句迟到。
--
-- `source_hash` 是整集台词的指纹（App 计算后随请求带来）。台词改了，
-- 指纹变，旧行作废重译——不用人工清理，也不会把上一版的译文配到新台词上。
CREATE TABLE IF NOT EXISTS rehearse_podcast_translations (
    episode_id   TEXT    NOT NULL,
    turn_index   INTEGER NOT NULL,
    source_hash  TEXT    NOT NULL,
    speaker      TEXT    NOT NULL DEFAULT '',
    source_text  TEXT    NOT NULL,
    translation  TEXT    NOT NULL,
    updated_at   TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (episode_id, turn_index)
);

CREATE INDEX IF NOT EXISTS idx_podcast_translations_hash
    ON rehearse_podcast_translations (episode_id, source_hash);

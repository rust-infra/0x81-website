-- 0003_podcast_translations —— 播客中文字幕的离线预生成结果，一行一句台词。
--
-- 与 SQLite 版（sqlite/0003_podcast_translations.up.sql）的有意差异只有类型：
-- `updated_at` 用 TIMESTAMPTZ。
--
-- 为什么落库而不是播放时实时翻、为什么用 `source_hash` 做失效，
-- 见 SQLite 版同一个文件的注释。
CREATE TABLE IF NOT EXISTS rehearse_podcast_translations (
    episode_id   TEXT        NOT NULL,
    turn_index   INTEGER     NOT NULL,
    source_hash  TEXT        NOT NULL,
    speaker      TEXT        NOT NULL DEFAULT '',
    source_text  TEXT        NOT NULL,
    translation  TEXT        NOT NULL,
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (episode_id, turn_index)
);

CREATE INDEX IF NOT EXISTS idx_podcast_translations_hash
    ON rehearse_podcast_translations (episode_id, source_hash);

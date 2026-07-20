CREATE TABLE IF NOT EXISTS user_settings (
    user_id TEXT PRIMARY KEY NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    theme TEXT,
    language TEXT,
    speech_provider TEXT,
    speech_voice TEXT,
    speech_zh_voice TEXT,
    speech_model TEXT,
    speech_speed REAL,
    auto_play INTEGER,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_user_settings_updated_at ON user_settings(updated_at);

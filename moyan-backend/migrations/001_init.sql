-- Users table
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY NOT NULL,
    email TEXT NOT NULL,
    name TEXT NOT NULL,
    avatar TEXT,
    provider TEXT NOT NULL DEFAULT 'google',
    provider_id TEXT NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_sync_at DATETIME
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_provider ON users(provider, provider_id);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

-- User decks table
CREATE TABLE IF NOT EXISTS user_decks (
    id TEXT PRIMARY KEY NOT NULL,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    category TEXT,
    card_count INTEGER NOT NULL DEFAULT 0,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_decks_user ON user_decks(user_id);

-- User cards table
CREATE TABLE IF NOT EXISTS user_cards (
    id TEXT PRIMARY KEY NOT NULL,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    deck_id TEXT NOT NULL REFERENCES user_decks(id) ON DELETE CASCADE,
    front TEXT NOT NULL,
    back TEXT NOT NULL,
    example TEXT,
    pronunciation TEXT,
    tags TEXT,
    srs_level INTEGER NOT NULL DEFAULT 0,
    srs_status TEXT NOT NULL DEFAULT 'new',
    srs_next_review DATETIME,
    srs_interval REAL NOT NULL DEFAULT 0,
    srs_ease REAL NOT NULL DEFAULT 2.5,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_cards_user ON user_cards(user_id);
CREATE INDEX IF NOT EXISTS idx_cards_deck ON user_cards(deck_id);
CREATE INDEX IF NOT EXISTS idx_cards_review ON user_cards(user_id, srs_next_review);

-- Review logs table
CREATE TABLE IF NOT EXISTS review_logs (
    id TEXT PRIMARY KEY NOT NULL,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    card_id TEXT NOT NULL REFERENCES user_cards(id) ON DELETE CASCADE,
    rating TEXT NOT NULL,
    reviewed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    time_ms INTEGER
);

CREATE INDEX IF NOT EXISTS idx_reviews_user ON review_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_reviews_card ON review_logs(card_id);
CREATE INDEX IF NOT EXISTS idx_reviews_date ON review_logs(user_id, reviewed_at);

-- Sync history table
CREATE TABLE IF NOT EXISTS sync_history (
    id TEXT PRIMARY KEY NOT NULL,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    device_id TEXT,
    cards_synced INTEGER NOT NULL DEFAULT 0,
    decks_synced INTEGER NOT NULL DEFAULT 0,
    logs_synced INTEGER NOT NULL DEFAULT 0,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_sync_user ON sync_history(user_id);

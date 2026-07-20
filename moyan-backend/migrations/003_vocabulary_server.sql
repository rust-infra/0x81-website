ALTER TABLE users ADD COLUMN status TEXT NOT NULL DEFAULT 'active';
ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user';
ALTER TABLE users ADD COLUMN last_login_at DATETIME;
ALTER TABLE users ADD COLUMN system_decks_initialized_at DATETIME;

CREATE TABLE IF NOT EXISTS decks (
    id TEXT PRIMARY KEY NOT NULL,
    owner_user_id TEXT NOT NULL,
    source_key TEXT,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    color TEXT,
    version INTEGER NOT NULL DEFAULT 1,
    sort_order INTEGER NOT NULL DEFAULT 0,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at DATETIME NOT NULL,
    updated_at DATETIME NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_decks_system_source
    ON decks(owner_user_id, source_key)
    WHERE source_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_decks_owner ON decks(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_decks_active_sort ON decks(is_active, sort_order);

CREATE TABLE IF NOT EXISTS cards (
    id TEXT PRIMARY KEY NOT NULL,
    deck_id TEXT NOT NULL REFERENCES decks(id) ON DELETE CASCADE,
    front TEXT NOT NULL,
    back TEXT NOT NULL,
    pronunciation TEXT,
    tags TEXT NOT NULL DEFAULT '[]',
    examples TEXT NOT NULL DEFAULT '[]',
    created_at DATETIME NOT NULL,
    updated_at DATETIME NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_cards_deck ON cards(deck_id);

CREATE TABLE IF NOT EXISTS card_progress (
    id TEXT PRIMARY KEY NOT NULL,
    owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
    srs_status TEXT NOT NULL DEFAULT 'new',
    interval_days REAL NOT NULL DEFAULT 0,
    repetitions INTEGER NOT NULL DEFAULT 0,
    ease_factor REAL NOT NULL DEFAULT 2.5,
    due_date DATETIME NOT NULL,
    last_reviewed_at DATETIME,
    created_at DATETIME NOT NULL,
    updated_at DATETIME NOT NULL,
    UNIQUE(owner_user_id, card_id)
);

CREATE INDEX IF NOT EXISTS idx_progress_owner_due
    ON card_progress(owner_user_id, due_date);

CREATE TABLE IF NOT EXISTS review_logs_v2 (
    id TEXT PRIMARY KEY NOT NULL,
    owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
    deck_id TEXT NOT NULL REFERENCES decks(id) ON DELETE CASCADE,
    rating TEXT NOT NULL,
    time_ms INTEGER,
    reviewed_at DATETIME NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_review_logs_v2_owner_date
    ON review_logs_v2(owner_user_id, reviewed_at);
CREATE INDEX IF NOT EXISTS idx_review_logs_v2_deck
    ON review_logs_v2(owner_user_id, deck_id);

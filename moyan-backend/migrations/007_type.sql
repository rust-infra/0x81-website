CREATE TABLE IF NOT EXISTS type_entries (
  id TEXT PRIMARY KEY NOT NULL,
  owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  card_id TEXT NOT NULL,
  deck_id TEXT NOT NULL,
  mode TEXT NOT NULL,
  correct_chars INTEGER NOT NULL,
  wrong_chars INTEGER NOT NULL,
  accuracy REAL NOT NULL,
  wpm REAL NOT NULL,
  duration_ms INTEGER NOT NULL,
  egregious INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_type_entries_user_created ON type_entries(owner_user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_type_entries_card ON type_entries(owner_user_id, card_id);

CREATE TABLE IF NOT EXISTS type_sessions (
  id TEXT PRIMARY KEY NOT NULL,
  owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  deck_id TEXT,
  deck_name TEXT,
  mode TEXT NOT NULL,
  total_cards INTEGER NOT NULL,
  completed INTEGER NOT NULL,
  skipped INTEGER NOT NULL,
  egregious_count INTEGER NOT NULL DEFAULT 0,
  avg_accuracy REAL NOT NULL,
  avg_wpm REAL NOT NULL,
  duration_ms INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_type_sessions_user_created ON type_sessions(owner_user_id, created_at);

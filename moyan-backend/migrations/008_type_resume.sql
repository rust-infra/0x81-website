CREATE TABLE IF NOT EXISTS type_resume (
  owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  deck_id TEXT NOT NULL,
  deck_name TEXT,
  mode TEXT NOT NULL,
  card_id TEXT NOT NULL,
  target TEXT NOT NULL,
  char_index INTEGER NOT NULL,
  correct_chars INTEGER NOT NULL,
  wrong_chars INTEGER NOT NULL,
  typed_states TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (owner_user_id, deck_id)
);

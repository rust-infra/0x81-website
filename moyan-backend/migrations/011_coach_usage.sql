CREATE TABLE IF NOT EXISTS coach_usage (
  user_id TEXT NOT NULL,
  day TEXT NOT NULL,
  turns_used INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, day)
);

CREATE INDEX IF NOT EXISTS idx_coach_usage_day ON coach_usage(day);

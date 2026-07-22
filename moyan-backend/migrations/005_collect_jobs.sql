CREATE TABLE IF NOT EXISTS collect_jobs (
  id TEXT PRIMARY KEY NOT NULL,
  url TEXT NOT NULL,
  proxy TEXT,
  status TEXT NOT NULL,
  step TEXT NOT NULL,
  error TEXT,
  video_id TEXT,
  title TEXT,
  language TEXT,
  source_url TEXT,
  caption_text TEXT,
  draft_cards_json TEXT,
  truncated INTEGER NOT NULL DEFAULT 0,
  cancel_requested INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_collect_jobs_created_at ON collect_jobs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_collect_jobs_status ON collect_jobs(status);

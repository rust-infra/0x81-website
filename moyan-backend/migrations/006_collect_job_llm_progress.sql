-- LLM extract progress for collect jobs
ALTER TABLE collect_jobs ADD COLUMN llm_started_at TEXT;
ALTER TABLE collect_jobs ADD COLUMN llm_chunk_done INTEGER NOT NULL DEFAULT 0;
ALTER TABLE collect_jobs ADD COLUMN llm_chunk_total INTEGER NOT NULL DEFAULT 0;

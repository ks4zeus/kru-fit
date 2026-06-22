-- AI token-usage log, powering the admin dashboard's per-user cost tracking.
-- Apply to the live D1 database:
--   wrangler d1 execute kru-fit-db --remote --file=migrations/003_ai_usage.sql
CREATE TABLE IF NOT EXISTS ai_usage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  model TEXT,
  input_tokens INTEGER DEFAULT 0,
  output_tokens INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_ai_usage_user ON ai_usage(user_id);

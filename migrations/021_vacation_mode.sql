-- Vacation mode: days the user was away, excluded from the insights that judge
-- their eating (averages, gaps, maintenance, logging consistency).
--
-- goals.vacation_mode is the live on/off switch; vacation_days is the permanent
-- record of which dates were excluded. Ending vacation mode clears the switch but
-- never deletes the days — a holiday already taken stays excluded forever.
--
-- Apply to the live D1 database:
--   wrangler d1 execute kru-fit-db --remote --file=migrations/021_vacation_mode.sql
ALTER TABLE goals ADD COLUMN vacation_mode INTEGER DEFAULT 0;

CREATE TABLE vacation_days (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  date TEXT NOT NULL,                -- YYYY-MM-DD, the user's LOCAL day
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(user_id, date)
);

CREATE INDEX idx_vacation_days_user ON vacation_days(user_id, date);

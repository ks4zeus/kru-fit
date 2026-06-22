-- Exercise/workout tracking: one row per logged workout.
-- Apply to the live D1 database:
--   wrangler d1 execute kru-fit-db --remote --file=migrations/005_workouts.sql
CREATE TABLE IF NOT EXISTS workouts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  date TEXT NOT NULL,
  name TEXT NOT NULL,
  minutes REAL DEFAULT 0,
  calories REAL DEFAULT 0,
  ts INTEGER,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_workouts_user_date ON workouts(user_id, date);

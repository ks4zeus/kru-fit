-- Goal history: what the user's daily targets WERE on a given date.
--
-- The goals table holds one row per user and is overwritten on every save, so
-- History and the stats cards were judging a day logged in June against goals
-- set in September. Each save now also appends a period here, and a day is
-- evaluated against the newest period whose effective_from is <= that day.
--
-- Apply to the live D1 database:
--   wrangler d1 execute kru-fit-db --remote --file=migrations/020_goals_history.sql
CREATE TABLE goals_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  cal INTEGER,
  protein INTEGER,
  carbs INTEGER,
  fat INTEGER,
  fiber INTEGER,
  water_oz INTEGER,
  effective_from TEXT NOT NULL,      -- YYYY-MM-DD, the first day this period applies
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX idx_goals_history_user ON goals_history(user_id, effective_from);

-- Baseline period for every user who already has goals, so there is always at
-- least one record to evaluate an old day against.
INSERT INTO goals_history (user_id, cal, protein, carbs, fat, fiber, water_oz, effective_from)
SELECT user_id, cal, protein, carbs, fat, fiber, water_oz, '2024-01-01' FROM goals;

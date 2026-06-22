-- Meal templates: a named bundle of food items logged together in one tap.
-- Apply to the live D1 database:
--   wrangler d1 execute kru-fit-db --remote --file=migrations/002_meal_templates.sql
CREATE TABLE IF NOT EXISTS meal_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  emoji TEXT,
  items TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_meal_templates_user ON meal_templates(user_id);

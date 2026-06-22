CREATE TABLE users (
  id TEXT PRIMARY KEY,
  name TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE food_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  date TEXT NOT NULL,
  name TEXT NOT NULL,
  emoji TEXT,
  cal REAL DEFAULT 0,
  protein REAL DEFAULT 0,
  carbs REAL DEFAULT 0,
  fat REAL DEFAULT 0,
  fiber REAL DEFAULT 0,
  source TEXT,
  ts INTEGER,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE weight_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  date TEXT NOT NULL,
  val REAL NOT NULL,
  unit TEXT DEFAULT 'lbs',
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(user_id, date)
);

CREATE TABLE water_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  date TEXT NOT NULL,
  oz REAL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(user_id, date)
);

CREATE TABLE custom_foods (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  emoji TEXT,
  cal REAL DEFAULT 0,
  protein REAL DEFAULT 0,
  carbs REAL DEFAULT 0,
  fat REAL DEFAULT 0,
  fiber REAL DEFAULT 0,
  serving TEXT,
  ingredients TEXT,           -- freeform ingredient text (AI-estimated portion of a recipe)
  recipe_items TEXT,          -- JSON array of scanned/structured ingredients (per-100g base + amount/unit)
  servings REAL DEFAULT 1,    -- yield (number of servings the recipe makes)
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE meal_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  emoji TEXT,
  items TEXT,                 -- JSON array of {name,emoji,cal,protein,carbs,fiber,fat}
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE workouts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  date TEXT NOT NULL,
  name TEXT NOT NULL,         -- activity name
  minutes REAL DEFAULT 0,
  calories REAL DEFAULT 0,
  ts INTEGER,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE ai_usage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  endpoint TEXT NOT NULL,        -- 'analyze-photo' | 'analyze-text' | 'coach'
  model TEXT,
  input_tokens INTEGER DEFAULT 0,
  output_tokens INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE goals (
  user_id TEXT PRIMARY KEY,
  cal INTEGER DEFAULT 1800,
  protein INTEGER DEFAULT 180,
  carbs INTEGER DEFAULT 150,
  fat INTEGER DEFAULT 60,
  fiber INTEGER DEFAULT 30,
  water_oz INTEGER DEFAULT 64,
  diet TEXT DEFAULT 'none',
  restrictions TEXT DEFAULT '',
  goal_weight REAL,           -- target weight in lbs (canonical); null = unset
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Recipes are merged into custom_foods (an item with ingredients + servings).

-- Indexes for the hot lookups (per-user, per-day and per-user ranges).
CREATE INDEX IF NOT EXISTS idx_food_user_date ON food_log(user_id, date);
CREATE INDEX IF NOT EXISTS idx_weight_user_date ON weight_log(user_id, date);
CREATE INDEX IF NOT EXISTS idx_custom_foods_user ON custom_foods(user_id);
CREATE INDEX IF NOT EXISTS idx_meal_templates_user ON meal_templates(user_id);
CREATE INDEX IF NOT EXISTS idx_ai_usage_user ON ai_usage(user_id);
CREATE INDEX IF NOT EXISTS idx_workouts_user_date ON workouts(user_id, date);

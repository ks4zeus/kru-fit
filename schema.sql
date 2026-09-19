CREATE TABLE users (
  id TEXT PRIMARY KEY,
  name TEXT,
  role TEXT DEFAULT 'solo',          -- 'solo' | 'client' | 'trainer' (authorization lives in D1)
  trainer_eligible INTEGER DEFAULT 0, -- admin-granted: may create a coaching profile
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
  sugar REAL DEFAULT 0,      -- tracked separately from net carbs (carbs - fiber)
  source TEXT,
  serving TEXT,              -- editable serving: quantity + standard unit (e.g. "1 cup")
  serving_grams REAL,        -- gram weight of the serving (conversion anchor; null if unknown)
  cup_grams REAL,            -- USDA food-specific density: grams per 1 cup (null if unknown)
  tbsp_grams REAL,           -- grams per 1 tablespoon
  tsp_grams REAL,            -- grams per 1 teaspoon
  each_grams REAL,           -- grams per 1 piece/item (count units)
  ts INTEGER,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE weight_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  date TEXT NOT NULL,
  val REAL NOT NULL,
  unit TEXT DEFAULT 'lbs',
  body_fat_pct REAL,
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
  sugar REAL DEFAULT 0,
  serving TEXT,
  serving_grams REAL,         -- gram weight of one serving (conversion anchor)
  ingredients TEXT,           -- freeform ingredient text (AI-estimated portion of a recipe)
  recipe_items TEXT,          -- JSON array of scanned/structured ingredients (per-100g base + amount/unit)
  servings REAL DEFAULT 1,    -- yield (number of servings the recipe makes)
  source TEXT DEFAULT 'user', -- 'user' (manual), 'usda' (verified), 'ai' (estimate)
  fdc_id TEXT,                -- USDA FoodData Central id when verified
  verified_at TEXT,          -- when last matched/updated from USDA
  created_at TEXT DEFAULT (datetime('now'))
);

-- USDA FoodData Central lookup cache (per-100g verified nutrition keyed by FDC id).
CREATE TABLE foods_cache (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fdc_id TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  brand TEXT,
  category TEXT,
  cal REAL DEFAULT 0,
  protein REAL DEFAULT 0,
  carbs REAL DEFAULT 0,
  fat REAL DEFAULT 0,
  fiber REAL DEFAULT 0,
  sugar_added REAL DEFAULT 0,
  serving_qty REAL DEFAULT 100,
  serving_unit TEXT DEFAULT 'g',
  serving_grams REAL DEFAULT 100,
  cup_grams REAL,             -- USDA food-specific density: grams per 1 cup (null if unknown)
  tbsp_grams REAL,            -- grams per 1 tablespoon
  tsp_grams REAL,             -- grams per 1 teaspoon
  each_grams REAL,            -- grams per 1 piece/item (count units)
  source TEXT DEFAULT 'usda',
  cached_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX idx_foods_cache_name ON foods_cache(name);
CREATE INDEX idx_foods_cache_fdc ON foods_cache(fdc_id);

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
  distance REAL,              -- km (canonical), null if logged by time
  ts INTEGER,
  created_at TEXT DEFAULT (datetime('now'))
);

-- ---- Detailed workout tracking (migration 020) ----
-- Per-exercise sets attached to a workouts (session) row, plus saveable templates.
CREATE TABLE workout_exercises (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  workout_id INTEGER NOT NULL,        -- FK -> workouts.id (the session)
  exercise_name TEXT NOT NULL,
  exercise_type TEXT DEFAULT 'strength',  -- 'strength' | 'bodyweight' | 'cardio'
  order_index INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE workout_sets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  exercise_id INTEGER NOT NULL,       -- FK -> workout_exercises.id
  set_number INTEGER NOT NULL,
  reps INTEGER,
  weight REAL,
  weight_unit TEXT DEFAULT 'lbs',
  distance REAL,
  distance_unit TEXT DEFAULT 'mi',
  duration_seconds INTEGER,
  completed INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE workout_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  exercises TEXT NOT NULL,            -- JSON array of exercise defaults
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX idx_workout_exercises_workout ON workout_exercises(workout_id);
CREATE INDEX idx_workout_sets_exercise ON workout_sets(exercise_id);
CREATE INDEX idx_workout_templates_user ON workout_templates(user_id);

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
  sugar INTEGER DEFAULT 50,
  water_oz INTEGER DEFAULT 64,
  objective TEXT DEFAULT 'maintain',  -- 'lose' | 'maintain' | 'gain' (fitness goal)
  diet TEXT DEFAULT 'none',
  restrictions TEXT DEFAULT '',
  goal_weight REAL,           -- target weight in lbs (canonical); null = unset
  vacation_mode INTEGER DEFAULT 0,  -- 1 while the user is away (migration 021)
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Vacation days (migration 021): dates excluded from the insights that judge the
-- user's eating. goals.vacation_mode is the live switch; these rows are the
-- permanent record. Ending vacation mode clears the switch but keeps the days —
-- weight entries and the food log itself are NOT affected, only the averages.
CREATE TABLE vacation_days (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  date TEXT NOT NULL,                -- YYYY-MM-DD, the user's LOCAL day
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(user_id, date)
);

CREATE INDEX idx_vacation_days_user ON vacation_days(user_id, date);

-- Goal history (migration 020): what the daily targets WERE on a given date.
-- goals holds only the CURRENT targets, so every past day would otherwise be
-- judged against today's numbers. Each goal save appends a period here; a day is
-- evaluated against the newest period whose effective_from is <= that day.
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

-- Recipes are merged into custom_foods (an item with ingredients + servings).

-- ---- Trainer dashboard (migration 011) ----
-- Roles live in users.role; authorization is enforced by the Worker. Cloudflare
-- Access (One-time PIN) only confirms email ownership.

-- Trainer organisations. A trainer owns exactly one org (owner_id).
CREATE TABLE organizations (
  id TEXT PRIMARY KEY,              -- crypto.randomUUID()
  name TEXT NOT NULL,
  owner_id TEXT NOT NULL,          -- trainer's user_id (email)
  created_at TEXT DEFAULT (datetime('now'))
);

-- Links clients to an org. (Trainers are linked via organizations.owner_id.)
CREATE TABLE memberships (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  org_id TEXT NOT NULL,
  role TEXT NOT NULL,              -- 'client' (trainers use organizations.owner_id)
  status TEXT DEFAULT 'active',    -- 'invited' | 'active' | 'inactive'
  invited_at TEXT,
  accepted_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(user_id, org_id)
);

-- Pending invites. id is the bearer token; accept is bound to invite.email.
CREATE TABLE invites (
  id TEXT PRIMARY KEY,             -- crypto.randomUUID() token
  org_id TEXT NOT NULL,
  trainer_id TEXT NOT NULL,
  email TEXT NOT NULL,             -- invited client email (lowercased)
  status TEXT DEFAULT 'pending',   -- 'pending' | 'accepted' | 'expired'
  created_at TEXT DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL         -- datetime('now','+7 days')
);

-- Coach notes: a persistent feed (multiple notes per day). `date` is the reference
-- date the note was written; the client can dismiss a note (dismissed_at set).
CREATE TABLE coach_notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  trainer_id TEXT NOT NULL,
  date TEXT NOT NULL,              -- YYYY-MM-DD reference date (not a unique key)
  note TEXT NOT NULL,
  dismissed_at TEXT,              -- set when the client dismisses it
  dismissed_by TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Grocery list. org_id is nullable: grocery is universal (solo users have no org).
CREATE TABLE grocery_list (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id TEXT,                     -- nullable for solo users
  client_id TEXT NOT NULL,
  added_by TEXT NOT NULL,
  added_by_role TEXT NOT NULL,     -- 'trainer' | 'client'
  item TEXT NOT NULL,
  note TEXT,
  checked INTEGER DEFAULT 0,
  checked_at TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Indexes for the hot lookups (per-user, per-day and per-user ranges).
CREATE INDEX IF NOT EXISTS idx_food_user_date ON food_log(user_id, date);
CREATE INDEX IF NOT EXISTS idx_weight_user_date ON weight_log(user_id, date);
CREATE INDEX IF NOT EXISTS idx_custom_foods_user ON custom_foods(user_id);
CREATE INDEX IF NOT EXISTS idx_meal_templates_user ON meal_templates(user_id);
CREATE INDEX IF NOT EXISTS idx_ai_usage_user ON ai_usage(user_id);
CREATE INDEX IF NOT EXISTS idx_workouts_user_date ON workouts(user_id, date);
CREATE INDEX IF NOT EXISTS idx_memberships_user ON memberships(user_id);
CREATE INDEX IF NOT EXISTS idx_memberships_org ON memberships(org_id);
CREATE INDEX IF NOT EXISTS idx_organizations_owner ON organizations(owner_id);
CREATE INDEX IF NOT EXISTS idx_coach_notes_client ON coach_notes(client_id, date);
CREATE INDEX IF NOT EXISTS idx_grocery_client ON grocery_list(client_id);
CREATE INDEX IF NOT EXISTS idx_invites_email ON invites(email);

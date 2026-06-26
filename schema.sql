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
  sugar REAL DEFAULT 0,
  serving TEXT,
  serving_grams REAL,         -- gram weight of one serving (conversion anchor)
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
  distance REAL,              -- km (canonical), null if logged by time
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
  sugar INTEGER DEFAULT 50,
  water_oz INTEGER DEFAULT 64,
  objective TEXT DEFAULT 'maintain',  -- 'lose' | 'maintain' | 'gain' (fitness goal)
  diet TEXT DEFAULT 'none',
  restrictions TEXT DEFAULT '',
  goal_weight REAL,           -- target weight in lbs (canonical); null = unset
  updated_at TEXT DEFAULT (datetime('now'))
);

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

-- Coach notes on a client's specific day. UNIQUE lets the trainer upsert per day.
CREATE TABLE coach_notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  trainer_id TEXT NOT NULL,
  date TEXT NOT NULL,              -- YYYY-MM-DD
  note TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(client_id, date, org_id)
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

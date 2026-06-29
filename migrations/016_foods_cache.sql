-- USDA FoodData Central lookup cache. Verified, per-100g nutrition keyed by FDC id.
-- Apply: wrangler d1 execute kru-fit-db --remote --file=migrations/016_foods_cache.sql
DROP TABLE IF EXISTS foods_cache;
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
  source TEXT DEFAULT 'usda',
  cached_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX idx_foods_cache_name ON foods_cache(name);
CREATE INDEX idx_foods_cache_fdc ON foods_cache(fdc_id);

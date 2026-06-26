-- Sugar tracking: a separate tracked field (distinct from net carbs = carbs - fiber).
-- Apply to the live D1 database:
--   wrangler d1 execute kru-fit-db --remote --file=migrations/014_sugar.sql
ALTER TABLE food_log ADD COLUMN sugar REAL DEFAULT 0;
ALTER TABLE custom_foods ADD COLUMN sugar REAL DEFAULT 0;
ALTER TABLE goals ADD COLUMN sugar INTEGER DEFAULT 50;  -- WHO recommended daily limit

-- Serving standardization: store the gram weight of each serving as a per-food
-- conversion anchor. With grams known, any unit converts to any other by pure
-- math (grams is the common denominator) — no AI needed for rescaling.
-- Apply to the live D1 database:
--   wrangler d1 execute kru-fit-db --remote --file=migrations/013_serving_grams.sql
ALTER TABLE food_log ADD COLUMN serving_grams REAL;
ALTER TABLE custom_foods ADD COLUMN serving_grams REAL;

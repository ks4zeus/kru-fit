-- Food-specific household-measure weights (grams per 1 unit), sourced from the USDA
-- foodMeasures array. Lets volume/count units convert to grams by real per-food
-- density instead of the water-density assumption (1 cup = 240 g).
--   cup_grams  — grams in 1 cup of this food (e.g. oats ≈ 81, not 240)
--   tbsp_grams — grams in 1 tablespoon
--   tsp_grams  — grams in 1 teaspoon
--   each_grams — grams in 1 piece/item (for count units)
-- Cached on foods_cache (from USDA) and copied onto each food_log entry so the
-- density is preserved for accurate re-scaling when the entry is edited later.
-- Apply to the live D1 database:
--   wrangler d1 execute kru-fit-db --remote --file=migrations/019_food_measures.sql
ALTER TABLE foods_cache ADD COLUMN cup_grams REAL;
ALTER TABLE foods_cache ADD COLUMN tbsp_grams REAL;
ALTER TABLE foods_cache ADD COLUMN tsp_grams REAL;
ALTER TABLE foods_cache ADD COLUMN each_grams REAL;

ALTER TABLE food_log ADD COLUMN cup_grams REAL;
ALTER TABLE food_log ADD COLUMN tbsp_grams REAL;
ALTER TABLE food_log ADD COLUMN tsp_grams REAL;
ALTER TABLE food_log ADD COLUMN each_grams REAL;

-- Editable serving/portion size on food log entries.
-- Apply to the live D1 database:
--   wrangler d1 execute kru-fit-db --remote --file=migrations/007_food_serving.sql
ALTER TABLE food_log ADD COLUMN serving TEXT;

-- Backfill serving for rows logged before the serving column existed.
-- The portion was already embedded in the source tag (e.g. "Custom · 1 cup"),
-- so derive it from the text after the " · " separator; default the rest.
-- Apply to the live D1 database:
--   wrangler d1 execute kru-fit-db --remote --file=migrations/008_backfill_serving.sql

UPDATE food_log
SET serving = TRIM(SUBSTR(source, INSTR(source, ' · ') + 3))
WHERE (serving IS NULL OR serving = '')
  AND source LIKE '% · %';

UPDATE food_log
SET serving = '1 serving'
WHERE serving IS NULL OR serving = '';

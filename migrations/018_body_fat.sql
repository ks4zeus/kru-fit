-- Optional body-fat percentage recorded alongside a weigh-in. Nullable: most
-- entries won't have it. Lean mass is derived (weight * (1 - body_fat_pct/100)),
-- not stored. Apply to the live D1 database:
--   wrangler d1 execute kru-fit-db --remote --file=migrations/018_body_fat.sql
ALTER TABLE weight_log ADD COLUMN body_fat_pct REAL;

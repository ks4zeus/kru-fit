-- Target weight for the weight-trend projection. Stored in lbs (canonical).
-- Apply to the live D1 database:
--   wrangler d1 execute kru-fit-db --remote --file=migrations/004_goal_weight.sql
ALTER TABLE goals ADD COLUMN goal_weight REAL;

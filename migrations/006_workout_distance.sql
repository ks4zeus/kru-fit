-- Distance-based calorie tracking for workouts (km, canonical).
-- Apply to the live D1 database:
--   wrangler d1 execute kru-fit-db --remote --file=migrations/006_workout_distance.sql
ALTER TABLE workouts ADD COLUMN distance REAL;

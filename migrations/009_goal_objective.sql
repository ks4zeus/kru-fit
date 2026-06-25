-- Fitness objective for the goals/coach: 'lose' | 'maintain' | 'gain'.
-- Apply to the live D1 database:
--   wrangler d1 execute kru-fit-db --remote --file=migrations/009_goal_objective.sql
ALTER TABLE goals ADD COLUMN objective TEXT DEFAULT 'maintain';

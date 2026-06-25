-- Gate who can create a coaching profile. Trainer signup is no longer open to
-- everyone: a user must be trainer-eligible (granted by an admin from the Admin
-- tab) or be an admin. Enforced in POST /api/trainer/setup.
-- Apply to the live D1 database:
--   wrangler d1 execute kru-fit-db --remote --file=migrations/012_trainer_eligible.sql
ALTER TABLE users ADD COLUMN trainer_eligible INTEGER DEFAULT 0;

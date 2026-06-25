-- Roles now live in D1. Cloudflare Access is set to One-time PIN, so anyone can
-- authenticate (Access only confirms email ownership) and the Worker is the sole
-- authorization layer. Every user has a role; new users are created as 'solo' and
-- the trainer invite/setup flows promote them to 'client' | 'trainer'.
-- Apply to the live D1 database:
--   wrangler d1 execute kru-fit-db --remote --file=migrations/010_user_role.sql
ALTER TABLE users ADD COLUMN role TEXT DEFAULT 'solo';

-- Defensive backfill (ADD COLUMN already applies the default to existing rows).
UPDATE users SET role = 'solo' WHERE role IS NULL OR role = '';

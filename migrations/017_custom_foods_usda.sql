-- Track where a custom food's data came from (user / usda / ai) and link to USDA.
-- Apply: wrangler d1 execute kru-fit-db --remote --file=migrations/017_custom_foods_usda.sql
ALTER TABLE custom_foods ADD COLUMN source TEXT DEFAULT 'user';
ALTER TABLE custom_foods ADD COLUMN fdc_id TEXT;
ALTER TABLE custom_foods ADD COLUMN verified_at TEXT;

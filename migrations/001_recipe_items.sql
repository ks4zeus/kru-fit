-- Adds structured/scanned recipe ingredients to custom_foods.
-- Run against the live D1 database (schema.sql's CREATE TABLE only applies to a fresh DB):
--   wrangler d1 execute kru-fit-db --remote --file=migrations/001_recipe_items.sql
ALTER TABLE custom_foods ADD COLUMN recipe_items TEXT;

-- Coach notes become a persistent feed: multiple notes per day, dismissable by the
-- client. SQLite can't drop a UNIQUE constraint in place, so rebuild the table
-- without UNIQUE(client_id,date,org_id) and add dismissed_at / dismissed_by.
-- Apply to the live D1 database:
--   wrangler d1 execute kru-fit-db --remote --file=migrations/015_coach_notes_feed.sql
CREATE TABLE coach_notes_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  trainer_id TEXT NOT NULL,
  date TEXT NOT NULL,                 -- reference date the note was written (not a key)
  note TEXT NOT NULL,
  dismissed_at TEXT,                  -- set when the client dismisses it
  dismissed_by TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
INSERT INTO coach_notes_new (id, org_id, client_id, trainer_id, date, note, created_at, updated_at)
  SELECT id, org_id, client_id, trainer_id, date, note, created_at, updated_at FROM coach_notes;
DROP TABLE coach_notes;
ALTER TABLE coach_notes_new RENAME TO coach_notes;
CREATE INDEX IF NOT EXISTS idx_coach_notes_client ON coach_notes(client_id, date);

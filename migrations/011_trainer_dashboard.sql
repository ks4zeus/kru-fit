-- Trainer dashboard: organizations, memberships, invites, coach notes, grocery.
-- Roles live in D1 (see 010_user_role.sql). Authorization is enforced by the
-- Worker; Cloudflare Access (One-time PIN) only confirms email ownership.
-- Apply to the live D1 database:
--   wrangler d1 execute kru-fit-db --remote --file=migrations/011_trainer_dashboard.sql

-- Trainer organisations. A trainer owns exactly one org (owner_id).
CREATE TABLE IF NOT EXISTS organizations (
  id TEXT PRIMARY KEY,              -- crypto.randomUUID()
  name TEXT NOT NULL,
  owner_id TEXT NOT NULL,          -- trainer's user_id (email)
  created_at TEXT DEFAULT (datetime('now'))
);

-- Links clients to an org. (Trainers are linked via organizations.owner_id.)
CREATE TABLE IF NOT EXISTS memberships (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  org_id TEXT NOT NULL,
  role TEXT NOT NULL,              -- 'client' (trainers use organizations.owner_id)
  status TEXT DEFAULT 'active',    -- 'invited' | 'active' | 'inactive'
  invited_at TEXT,
  accepted_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(user_id, org_id)
);

-- Pending invites. id is the bearer token; accept is still bound to invite.email.
CREATE TABLE IF NOT EXISTS invites (
  id TEXT PRIMARY KEY,             -- crypto.randomUUID() token
  org_id TEXT NOT NULL,
  trainer_id TEXT NOT NULL,
  email TEXT NOT NULL,             -- invited client email (lowercased)
  status TEXT DEFAULT 'pending',   -- 'pending' | 'accepted' | 'expired'
  created_at TEXT DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL         -- datetime('now','+7 days')
);

-- Coach notes on a client's specific day. UNIQUE lets the trainer upsert per day.
CREATE TABLE IF NOT EXISTS coach_notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  trainer_id TEXT NOT NULL,
  date TEXT NOT NULL,              -- YYYY-MM-DD
  note TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(client_id, date, org_id)
);

-- Grocery list. org_id is nullable: grocery is universal (solo users have no org).
CREATE TABLE IF NOT EXISTS grocery_list (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id TEXT,                     -- nullable for solo users
  client_id TEXT NOT NULL,
  added_by TEXT NOT NULL,
  added_by_role TEXT NOT NULL,     -- 'trainer' | 'client'
  item TEXT NOT NULL,
  note TEXT,
  checked INTEGER DEFAULT 0,
  checked_at TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_memberships_user ON memberships(user_id);
CREATE INDEX IF NOT EXISTS idx_memberships_org ON memberships(org_id);
CREATE INDEX IF NOT EXISTS idx_organizations_owner ON organizations(owner_id);
CREATE INDEX IF NOT EXISTS idx_coach_notes_client ON coach_notes(client_id, date);
CREATE INDEX IF NOT EXISTS idx_grocery_client ON grocery_list(client_id);
CREATE INDEX IF NOT EXISTS idx_invites_email ON invites(email);

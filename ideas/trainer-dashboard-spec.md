# Kru Fit — Trainer Dashboard + Multi-User Architecture Spec
## For Claude Code implementation

---

## Core Design Principle

Solo users and trainer clients are the SAME user type. A solo user
uses the app independently with no trainer connection. A client is
a solo user who accepted a trainer's invite. The trainer connection
is purely additive — it grants a trainer read access to that user's
existing data. Nothing changes about how clients log food.

---

## User Types

| Type    | Description                                      |
|---------|--------------------------------------------------|
| solo    | Uses app independently, no trainer               |
| client  | Solo user connected to a trainer via invite      |
| trainer | Has an org, manages a roster of clients          |
| admin   | Full access (you — KSHAH or kru@travelkru.com)   |

A user's type is determined by:
- No membership row = solo user
- membership.role = 'client' = connected to a trainer
- membership.role = 'trainer' = is a trainer
- users.is_admin = 1 = admin

---

## D1 Schema — New Tables

Add to existing schema.sql (existing tables unchanged):

```sql
-- Trainer organisations
CREATE TABLE organizations (
  id TEXT PRIMARY KEY,              -- nanoid or uuid
  name TEXT NOT NULL,               -- "John Smith Fitness"
  owner_id TEXT NOT NULL,           -- trainer's user_id (email)
  created_at TEXT DEFAULT (datetime('now'))
);

-- Links users to organisations with a role
CREATE TABLE memberships (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,            -- client or trainer email
  org_id TEXT NOT NULL,
  role TEXT NOT NULL,               -- 'trainer' | 'client'
  status TEXT DEFAULT 'active',     -- 'invited' | 'active' | 'inactive'
  invited_at TEXT,
  accepted_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(user_id, org_id)
);

-- Pending invites (before user has an account)
CREATE TABLE invites (
  id TEXT PRIMARY KEY,              -- secure random token
  org_id TEXT NOT NULL,
  trainer_id TEXT NOT NULL,
  email TEXT NOT NULL,              -- invited client email
  status TEXT DEFAULT 'pending',    -- 'pending' | 'accepted' | 'expired'
  created_at TEXT DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL          -- 7 days from creation
);

-- Coach notes on a client's specific day
CREATE TABLE coach_notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  trainer_id TEXT NOT NULL,
  date TEXT NOT NULL,               -- YYYY-MM-DD
  note TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Grocery list (from grocery spec)
CREATE TABLE grocery_list (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  added_by TEXT NOT NULL,
  added_by_role TEXT NOT NULL,      -- 'trainer' | 'client'
  item TEXT NOT NULL,
  note TEXT,
  checked INTEGER DEFAULT 0,
  checked_at TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Add admin flag to users table
ALTER TABLE users ADD COLUMN is_admin INTEGER DEFAULT 0;
ALTER TABLE users ADD COLUMN role TEXT DEFAULT 'solo';

-- Update admin user
UPDATE users SET is_admin = 1, role = 'admin'
WHERE id = 'kru@travelkru.com';

CREATE INDEX idx_memberships_user ON memberships(user_id);
CREATE INDEX idx_memberships_org ON memberships(org_id);
CREATE INDEX idx_coach_notes_client ON coach_notes(client_id, date);
CREATE INDEX idx_grocery_client ON grocery_list(client_id);
CREATE INDEX idx_invites_email ON invites(email);
CREATE INDEX idx_invites_token ON invites(id);
```

---

## Updated GET /api/me Response

Extend to return role context:

```json
{
  "id": "user@email.com",
  "name": "Sarah",
  "role": "solo",
  "is_admin": false,
  "trainer": null,
  "org": null
}
```

For a client:
```json
{
  "id": "client@email.com",
  "name": "James",
  "role": "client",
  "is_admin": false,
  "trainer": {
    "name": "John Smith",
    "org_id": "org_abc123",
    "org_name": "John Smith Fitness"
  },
  "org": null
}
```

For a trainer:
```json
{
  "id": "trainer@email.com",
  "name": "John",
  "role": "trainer",
  "is_admin": false,
  "trainer": null,
  "org": {
    "id": "org_abc123",
    "name": "John Smith Fitness",
    "client_count": 8
  }
}
```

The frontend uses this to decide which UI to show on load:
- solo/client → show normal app
- trainer → show normal app + Trainer tab
- admin → show normal app + Admin tab

---

## API Routes — Trainer

### Onboarding
```
POST /api/trainer/setup
     body: { org_name: string }
     → creates organization, sets user role to 'trainer'
     → returns { org_id, org_name }
     → 409 if user already has an org

GET  /api/trainer/org
     → returns org details + client count
```

### Client management
```
POST /api/trainer/invite
     body: { email: string }
     → creates invite token (nanoid, expires 7 days)
     → creates invites row with status='pending'
     → in production: send email via Cloudflare Email Workers
     → returns { invite_id, invite_url: "https://krufit.uk/join?token=xxx" }

GET  /api/trainer/invites
     → list all pending invites for this trainer's org

DELETE /api/trainer/invites/:id
     → cancel a pending invite

GET  /api/trainer/clients
     → list all active clients in this org
     → returns array of:
       {
         user_id, name, status,
         today: { cal, protein, carbs, fat, entry_count, last_logged_at },
         weight: { current, unit, last_logged },
         streak: number,
         compliance_7d: number  -- % of last 7 days with any log entries
       }

GET  /api/trainer/clients/:client_id
     → full client detail:
       {
         user: { id, name },
         goals: { cal, protein, carbs, fat, water_oz },
         today: { entries[], totals },
         log_7d: [ { date, cal, protein, carbs, fat }... ],
         weight_30d: [ { date, val, unit }... ],
         coach_notes: [ { id, date, note, created_at }... ],
         grocery: { trainer_items[], client_items[], checked_items[] }
       }

DELETE /api/trainer/clients/:client_id
     → removes membership (sets status='inactive')
     → does NOT delete client's data
```

### Coach notes
```
POST /api/trainer/notes
     body: { client_id, date, note }
     → creates or updates coach note for that client+date
     → upsert on (client_id, date, org_id)

DELETE /api/trainer/notes/:id
     → delete note (trainer only, own org)
```

### Grocery (trainer side)
```
POST /api/trainer/grocery
     body: { client_id, item, note? }
     → adds item to client's grocery list as added_by_role='trainer'

DELETE /api/trainer/grocery/:id
     → removes a grocery item (trainer must own it)

GET  /api/trainer/grocery/quick-items
     → returns trainer's saved quick items
     → falls back to DEFAULT_QUICK_ITEMS if none

POST /api/trainer/grocery/bulk
     body: { client_id, items: [{item, note?}] }
     → bulk add up to 20 items
```

---

## API Routes — Client (additions)

```
GET  /api/invite/:token
     → validate invite token
     → returns { valid: bool, org_name, trainer_name, expires_at }

POST /api/invite/:token/accept
     → accept invite, creates membership row
     → sets status='active', accepted_at=now()
     → updates invites.status='accepted'
     → returns updated /api/me payload

GET  /api/coach-notes?date=YYYY-MM-DD
     → client reads their own coach notes for a date
     → returns array of notes (read-only for client)

GET  /api/grocery
     → client's full grocery list split into sections
     → { trainer_items[], client_items[], checked_items[] }

POST /api/grocery
     body: { item, note? }
     → client adds own item

PUT  /api/grocery/:id/check
     body: { checked: 0|1 }

DELETE /api/grocery/:id
DELETE /api/grocery/checked   → clear all checked items
```

---

## Invite Flow

```
1. Trainer enters client email in dashboard
   → POST /api/trainer/invite
   → System creates invite row + returns invite URL

2. Trainer shares URL with client
   (copy link button, or future: email integration)
   invite URL: https://krufit.uk/join?token=XXXX

3. Client opens URL
   → Cloudflare Access OTP flow (client enters their email)
   → After auth, app detects ?token= in URL
   → Shows join screen: "John Smith Fitness invited you to Kru Fit"
   → Client taps "Accept invitation"
   → POST /api/invite/:token/accept
   → Membership created

4. Client now appears in trainer's roster
   Trainer sees their logs immediately
   Client's app unchanged — they just use it normally
```

---

## Frontend Changes (index.html)

### On app load — check role and show appropriate UI

In the DOMContentLoaded handler, after GET /api/me:

```js
const me = await fetch('/api/me').then(r => r.json());

// Check for invite token in URL
const params = new URLSearchParams(window.location.search);
const inviteToken = params.get('token');
if (inviteToken) {
  showInviteAcceptScreen(inviteToken);
  return;
}

// Show trainer tab if trainer
if (me.role === 'trainer') {
  document.getElementById('tabTrainer').style.display = 'flex';
}

// Show admin tab if admin
if (me.is_admin) {
  document.getElementById('tabAdmin').style.display = 'flex';
}

// Show trainer connection banner if client has a trainer
if (me.trainer) {
  showTrainerBanner(me.trainer);
}
```

### New tab buttons (hidden by default)
```html
<!-- In tab bar, after Insights tab, hidden by default -->
<button class="tab-btn" id="tabGrocery"
  onclick="switchTab('grocery')">🛒 Grocery</button>
<button class="tab-btn" id="tabTrainer"
  style="display:none;border-color:#F4D06F;color:#F4D06F"
  onclick="switchTab('trainer')">👥 Clients</button>
<button class="tab-btn" id="tabAdmin"
  style="display:none;border-color:#a78bfa;color:#a78bfa"
  onclick="switchTab('admin')">🔧 Admin</button>
```

### Trainer connection banner (for clients)
Small banner shown in Today tab header when user has a trainer:

```html
<div id="trainerBanner" style="display:none"
  class="trainer-banner">
  <span>👤 Connected to <strong id="trainerBannerName"></strong></span>
  <span id="trainerBannerNote" class="banner-note"></span>
</div>
```

CSS:
```css
.trainer-banner {
  margin: 0 20px 12px;
  background: rgba(244,208,111,0.06);
  border: 1px solid rgba(244,208,111,0.2);
  border-radius: 10px;
  padding: 10px 14px;
  font-size: 13px;
  color: var(--muted);
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.trainer-banner strong { color: #F4D06F; }
.banner-note { font-size: 11px; font-family: var(--mono); }
```

### Coach notes display in Today tab
Below each day's log, if coach notes exist for that date, show:

```html
<div class="coach-note-card" id="coachNoteCard">
  <div class="cnc-header">
    <span>💬 Note from <strong id="cncTrainerName"></strong></span>
    <span class="cnc-date" id="cncDate"></span>
  </div>
  <p id="cncText"></p>
</div>
```

CSS:
```css
.coach-note-card {
  margin: 0 20px 12px;
  background: rgba(244,208,111,0.06);
  border: 1px solid rgba(244,208,111,0.2);
  border-radius: 12px;
  padding: 12px 14px;
  display: none;
}
.coach-note-card.show { display: block; }
.cnc-header {
  display: flex;
  justify-content: space-between;
  font-size: 12px;
  color: var(--muted);
  margin-bottom: 6px;
}
.cnc-header strong { color: #F4D06F; }
.coach-note-card p { font-size: 14px; line-height: 1.5; }
.cnc-date { font-family: var(--mono); font-size: 11px; }
```

### Invite accept screen (shown when ?token= in URL)
Replaces entire app on load if invite token present:

```html
<div id="inviteScreen" style="display:none" class="invite-screen">
  <div class="invite-card">
    <div class="invite-logo">⚡ Kru Fit</div>
    <div id="inviteLoading">Checking invite…</div>
    <div id="inviteValid" style="display:none">
      <h2>You've been invited</h2>
      <p><strong id="inviteOrgName"></strong> wants to connect
         with you on Kru Fit.</p>
      <p class="invite-sub">Your trainer can see your food logs
         and weight history.</p>
      <button class="btn-primary" onclick="acceptInvite()">
        Accept invitation
      </button>
      <p class="invite-note">
        Already logging? Your data stays private.
        Your trainer only sees what you log going forward.
      </p>
    </div>
    <div id="inviteExpired" style="display:none">
      <p>This invite has expired or already been used.
         Ask your trainer to send a new one.</p>
    </div>
  </div>
</div>
```

CSS:
```css
.invite-screen {
  position: fixed;
  inset: 0;
  background: var(--bg);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  padding: 20px;
}
.invite-card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 20px;
  padding: 32px 24px;
  max-width: 380px;
  width: 100%;
  text-align: center;
}
.invite-logo {
  font-size: 22px;
  font-weight: 700;
  margin-bottom: 20px;
  color: #F4D06F;
}
.invite-card h2 {
  font-size: 22px;
  font-weight: 700;
  margin-bottom: 12px;
}
.invite-card p { font-size: 14px; color: var(--muted); margin-bottom: 12px; }
.invite-sub { font-size: 13px; }
.invite-note { font-size: 11px; margin-top: 12px; opacity: 0.7; }
```

---

## Trainer Dashboard Tab (trainer-dashboard section in index.html)

```html
<div class="tab-content" id="tabContentTrainer">
  <div class="trainer-wrap">

    <!-- Org header -->
    <div class="trainer-header">
      <div>
        <div class="trainer-org-name" id="trainerOrgName"></div>
        <div class="trainer-org-sub" id="trainerOrgSub"></div>
      </div>
      <button class="btn-primary" onclick="openInviteModal()"
        style="width:auto;padding:10px 18px;font-size:13px">
        + Invite client
      </button>
    </div>

    <!-- Overview metrics -->
    <div class="trainer-metrics" id="trainerMetrics"></div>

    <!-- Client roster -->
    <div class="section-head" style="padding:0 0 10px">
      <h2>Clients</h2>
      <select id="rosterFilter" onchange="filterRoster()"
        style="background:var(--surface2);border:1px solid var(--border);
               color:var(--text);border-radius:8px;padding:5px 10px;
               font-size:12px">
        <option value="all">All clients</option>
        <option value="attention">Needs attention</option>
        <option value="active">Logged today</option>
        <option value="inactive">Not logged today</option>
      </select>
    </div>
    <div id="clientRoster"></div>

    <!-- Empty state -->
    <div id="trainerEmpty" class="hist-empty" style="display:none">
      <div class="he-icon">👥</div>
      <p>No clients yet.<br>Invite your first client to get started.</p>
    </div>

  </div>
</div>
```

### Trainer CSS additions
```css
.trainer-wrap { padding: 16px 20px; }

.trainer-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 16px;
}
.trainer-org-name {
  font-size: 18px;
  font-weight: 700;
  color: #F4D06F;
}
.trainer-org-sub {
  font-size: 12px;
  color: var(--muted);
  font-family: var(--mono);
  margin-top: 2px;
}

.trainer-metrics {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
  margin-bottom: 16px;
}
.tm-card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 12px;
  text-align: center;
}
.tm-val {
  font-size: 22px;
  font-weight: 700;
  font-family: var(--mono);
  line-height: 1;
}
.tm-label {
  font-size: 10px;
  color: var(--muted);
  text-transform: uppercase;
  letter-spacing: 0.4px;
  margin-top: 4px;
}

/* Client roster card */
.client-card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 14px;
  padding: 14px;
  margin-bottom: 10px;
  cursor: pointer;
  transition: border-color 0.2s;
}
.client-card:active { border-color: #F4D06F; }
.client-card-top {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 10px;
}
.client-avatar {
  width: 38px; height: 38px;
  border-radius: 50%;
  background: rgba(244,208,111,0.1);
  color: #F4D06F;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 15px;
  font-weight: 700;
  flex-shrink: 0;
}
.client-card-name { font-size: 15px; font-weight: 600; }
.client-card-sub {
  font-size: 11px;
  color: var(--muted);
  font-family: var(--mono);
  margin-top: 1px;
}
.client-status-pill {
  margin-left: auto;
  font-size: 10px;
  font-weight: 700;
  padding: 4px 10px;
  border-radius: 99px;
}
.pill-ok   { background: rgba(74,222,128,0.12); color: var(--protein); }
.pill-warn { background: rgba(245,166,35,0.12);  color: var(--cal); }
.pill-bad  { background: rgba(239,68,68,0.12);   color: #ef4444; }

/* Client macro mini-bars in card */
.client-macros {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 6px;
}
.cm-item { text-align: center; }
.cm-val {
  font-size: 13px;
  font-weight: 700;
  font-family: var(--mono);
}
.cm-label {
  font-size: 9px;
  color: var(--muted);
  text-transform: uppercase;
  letter-spacing: 0.3px;
}
.cm-bar {
  height: 3px;
  background: var(--surface2);
  border-radius: 99px;
  overflow: hidden;
  margin-top: 3px;
}
.cm-fill { height: 100%; border-radius: 99px; }
```

### Client detail modal (slides up over trainer tab)
```html
<div class="modal-bg" id="clientDetailModal">
  <div class="modal" style="max-height:92vh;border-radius:20px 20px 0 0">
    <div class="modal-handle"></div>

    <!-- Header -->
    <div class="cd-header">
      <div>
        <div class="cd-name" id="cdName"></div>
        <div class="cd-sub" id="cdSub"></div>
      </div>
      <button class="btn-cancel" onclick="closeClientDetail()"
        style="width:auto;padding:8px 16px">Close</button>
    </div>

    <!-- Date navigation -->
    <div class="cd-date-nav">
      <button onclick="cdChangeDate(-1)">‹</button>
      <span id="cdDateLabel"></span>
      <button onclick="cdChangeDate(1)" id="cdNextBtn">›</button>
    </div>

    <!-- Macro summary for selected day -->
    <div class="cd-macro-summary" id="cdMacroSummary"></div>

    <!-- Food log for selected day -->
    <div class="section-head" style="padding:10px 0 8px">
      <h2>Food log</h2>
    </div>
    <div id="cdFoodLog"></div>

    <!-- Coach note for selected day -->
    <div class="section-head" style="padding:10px 0 8px">
      <h2>Coach note</h2>
    </div>
    <div class="cd-note-wrap">
      <textarea id="cdNoteInput" placeholder="Leave a note for this day…"
        rows="3"></textarea>
      <button class="btn-primary" onclick="saveCoachNote()"
        style="margin-top:8px">Save note</button>
    </div>

    <!-- Weight trend (last 30 days) -->
    <div class="section-head" style="padding:10px 0 8px">
      <h2>Weight</h2>
    </div>
    <div class="chart-card" style="margin:0 0 12px">
      <canvas id="cdWeightChart" height="140"></canvas>
    </div>

    <!-- Grocery list -->
    <div class="section-head" style="padding:10px 0 8px">
      <h2>🛒 Grocery list</h2>
    </div>
    <div id="cdGroceryPanel"></div>

  </div>
</div>
```

CSS:
```css
.cd-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 14px;
}
.cd-name { font-size: 18px; font-weight: 700; }
.cd-sub  { font-size: 12px; color: var(--muted); font-family: var(--mono); }

.cd-date-nav {
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: var(--surface2);
  border-radius: 10px;
  padding: 8px 14px;
  margin-bottom: 14px;
  font-size: 14px;
  font-weight: 600;
}
.cd-date-nav button {
  background: none;
  border: none;
  color: var(--text);
  font-size: 20px;
  cursor: pointer;
  padding: 0 8px;
}

.cd-macro-summary {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;
  margin-bottom: 14px;
}

.cd-note-wrap textarea {
  width: 100%;
  background: var(--surface2);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 12px;
  color: var(--text);
  font-family: var(--font);
  font-size: 14px;
  resize: vertical;
  outline: none;
}
.cd-note-wrap textarea:focus { border-color: #F4D06F; }
```

---

## Trainer JS Functions

```js
// ---- Trainer Dashboard ----
let trainerClients = [];
let selectedClientId = null;
let cdCurrentDate = todayKey();

async function renderTrainerTab() {
  try {
    const [org, clients] = await Promise.all([
      fetch('/api/trainer/org').then(r => r.json()),
      fetch('/api/trainer/clients').then(r => r.json())
    ]);

    trainerClients = clients;

    // Org header
    document.getElementById('trainerOrgName').textContent = org.name;
    document.getElementById('trainerOrgSub').textContent =
      `${clients.length} client${clients.length !== 1 ? 's' : ''}`;

    // Metrics
    const logged = clients.filter(c => c.today.entry_count > 0).length;
    const attention = clients.filter(c => getClientStatus(c) === 'bad').length;
    const avgCompliance = clients.length
      ? Math.round(clients.reduce((s, c) => s + (c.compliance_7d || 0), 0) / clients.length)
      : 0;

    document.getElementById('trainerMetrics').innerHTML = `
      <div class="tm-card">
        <div class="tm-val" style="color:var(--protein)">${logged}</div>
        <div class="tm-label">Logged today</div>
      </div>
      <div class="tm-card">
        <div class="tm-val" style="color:var(--cal)">${avgCompliance}%</div>
        <div class="tm-label">7d compliance</div>
      </div>
      <div class="tm-card">
        <div class="tm-val" style="color:#ef4444">${attention}</div>
        <div class="tm-label">Need attention</div>
      </div>`;

    renderClientRoster(clients);
  } catch(err) {
    console.error('Trainer tab error', err);
  }
}

function getClientStatus(client) {
  if (!client.today || client.today.entry_count === 0) return 'bad';
  const goals = client.goals || { protein: 150 };
  const proteinPct = client.today.protein / goals.protein;
  if (proteinPct < 0.7) return 'warn';
  return 'ok';
}

function renderClientRoster(clients) {
  const filter = document.getElementById('rosterFilter').value;
  let filtered = clients;
  if (filter === 'attention') filtered = clients.filter(c => getClientStatus(c) === 'bad');
  if (filter === 'active')    filtered = clients.filter(c => c.today.entry_count > 0);
  if (filter === 'inactive')  filtered = clients.filter(c => c.today.entry_count === 0);

  document.getElementById('trainerEmpty').style.display =
    filtered.length === 0 ? 'block' : 'none';

  const statusMap = {
    ok:   ['pill-ok',   'On track'],
    warn: ['pill-warn', 'Low protein'],
    bad:  ['pill-bad',  'Check in'],
  };

  document.getElementById('clientRoster').innerHTML = filtered.map(client => {
    const status = getClientStatus(client);
    const [pillClass, pillLabel] = statusMap[status];
    const goals = client.goals || { cal: 1800, protein: 150, carbs: 150, fat: 60 };
    const today = client.today || { cal: 0, protein: 0, carbs: 0, fat: 0, entry_count: 0 };
    const lastLogged = client.today?.last_logged_at
      ? new Date(client.today.last_logged_at).toLocaleTimeString('en-US',
          { hour: 'numeric', minute: '2-digit' })
      : client.weight?.last_logged || 'No entries';

    return `
    <div class="client-card" onclick="openClientDetail('${client.user_id}')">
      <div class="client-card-top">
        <div class="client-avatar">
          ${(client.name || client.user_id)[0].toUpperCase()}
        </div>
        <div>
          <div class="client-card-name">${client.name || client.user_id}</div>
          <div class="client-card-sub">
            ${today.entry_count} entries · ${lastLogged}
          </div>
        </div>
        <div class="client-status-pill ${pillClass}">${pillLabel}</div>
      </div>
      <div class="client-macros">
        <div class="cm-item">
          <div class="cm-val" style="color:var(--cal)">
            ${Math.round(today.cal)}
          </div>
          <div class="cm-label">kcal</div>
          <div class="cm-bar">
            <div class="cm-fill" style="
              width:${Math.min(100, today.cal / goals.cal * 100).toFixed(0)}%;
              background:var(--cal)">
            </div>
          </div>
        </div>
        <div class="cm-item">
          <div class="cm-val" style="color:var(--protein)">
            ${Math.round(today.protein)}g
          </div>
          <div class="cm-label">protein</div>
          <div class="cm-bar">
            <div class="cm-fill" style="
              width:${Math.min(100, today.protein / goals.protein * 100).toFixed(0)}%;
              background:var(--protein)">
            </div>
          </div>
        </div>
        <div class="cm-item">
          <div class="cm-val" style="color:var(--carbs)">
            ${Math.round(today.carbs)}g
          </div>
          <div class="cm-label">carbs</div>
          <div class="cm-bar">
            <div class="cm-fill" style="
              width:${Math.min(100, today.carbs / goals.carbs * 100).toFixed(0)}%;
              background:var(--carbs)">
            </div>
          </div>
        </div>
      </div>
    </div>`;
  }).join('');
}

function filterRoster() {
  renderClientRoster(trainerClients);
}

// ---- Client detail modal ----
async function openClientDetail(clientId) {
  selectedClientId = clientId;
  cdCurrentDate = todayKey();
  document.getElementById('clientDetailModal').classList.add('open');
  await loadClientDetail();
}

function closeClientDetail() {
  document.getElementById('clientDetailModal').classList.remove('open');
  selectedClientId = null;
}

async function loadClientDetail() {
  try {
    const data = await fetch(
      `/api/trainer/clients/${selectedClientId}?date=${cdCurrentDate}`
    ).then(r => r.json());

    // Header
    document.getElementById('cdName').textContent =
      data.user.name || data.user.id;
    document.getElementById('cdSub').textContent = data.user.id;

    // Date nav
    const isToday = cdCurrentDate === todayKey();
    document.getElementById('cdDateLabel').textContent =
      isToday ? 'Today' : new Date(cdCurrentDate + 'T12:00:00')
        .toLocaleDateString('en-US', { weekday:'short', month:'short', day:'numeric' });
    document.getElementById('cdNextBtn').disabled = isToday;

    // Macro summary
    const t = data.today.totals;
    const g = data.goals;
    document.getElementById('cdMacroSummary').innerHTML = `
      <div class="hist-stat">
        <div class="hs-val" style="color:var(--cal)">${Math.round(t.cal)}</div>
        <div class="hs-label">Calories</div>
        <div class="hs-sub">/ ${g.cal}</div>
      </div>
      <div class="hist-stat">
        <div class="hs-val" style="color:var(--protein)">${Math.round(t.protein)}g</div>
        <div class="hs-label">Protein</div>
        <div class="hs-sub">/ ${g.protein}g</div>
      </div>
      <div class="hist-stat">
        <div class="hs-val" style="color:var(--carbs)">${Math.round(t.carbs)}g</div>
        <div class="hs-label">Carbs</div>
        <div class="hs-sub">/ ${g.carbs}g</div>
      </div>
      <div class="hist-stat">
        <div class="hs-val" style="color:var(--fat)">${Math.round(t.fat)}g</div>
        <div class="hs-label">Fat</div>
        <div class="hs-sub">/ ${g.fat}g</div>
      </div>`;

    // Food log
    document.getElementById('cdFoodLog').innerHTML =
      data.today.entries.length === 0
        ? '<p style="color:var(--muted);font-size:13px;padding:8px 0">No entries for this day.</p>'
        : data.today.entries.map(e => `
            <div class="log-entry" style="margin-bottom:8px">
              <div class="entry-thumb">${e.emoji || '🍽️'}</div>
              <div class="entry-info">
                <div class="entry-name">${e.name}</div>
                <div class="entry-time">${e.ts
                  ? new Date(e.ts).toLocaleTimeString('en-US',
                      {hour:'numeric',minute:'2-digit'})
                  : ''}</div>
                <div class="entry-macros">
                  <span class="entry-macro" style="color:var(--protein)">
                    P: ${Math.round(e.protein)}g
                  </span>
                  <span class="entry-macro" style="color:var(--carbs)">
                    C: ${Math.round(e.carbs)}g
                  </span>
                  <span class="entry-macro" style="color:var(--fat)">
                    F: ${Math.round(e.fat)}g
                  </span>
                </div>
              </div>
              <div class="entry-cal">${Math.round(e.cal)}
                <span class="cal-unit">kcal</span>
              </div>
            </div>`).join('');

    // Coach note
    const existingNote = data.coach_notes.find(n => n.date === cdCurrentDate);
    document.getElementById('cdNoteInput').value = existingNote?.note || '';

    // Weight chart
    if (data.weight_30d.length > 0) {
      const wLabels = data.weight_30d.map(w =>
        new Date(w.date + 'T12:00:00').toLocaleDateString('en-US',
          { month:'short', day:'numeric' }));
      const wVals = data.weight_30d.map(w =>
        parseFloat(toDisplayWeight(w.val, w.unit).toFixed(1)));
      drawWeightChart('cdWeightChart', wLabels, wVals, weightUnit);
    }

    // Grocery panel
    renderCdGrocery(data.grocery);

  } catch(err) {
    console.error('Client detail error', err);
  }
}

function cdChangeDate(delta) {
  const d = new Date(cdCurrentDate + 'T12:00:00');
  d.setDate(d.getDate() + delta);
  const newKey = d.toISOString().split('T')[0];
  if (newKey > todayKey()) return;
  cdCurrentDate = newKey;
  loadClientDetail();
}

async function saveCoachNote() {
  const note = document.getElementById('cdNoteInput').value.trim();
  if (!note) return;
  await fetch('/api/trainer/notes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: selectedClientId,
      date: cdCurrentDate,
      note
    })
  });
  document.getElementById('cdNoteInput').style.borderColor = 'var(--protein)';
  setTimeout(() =>
    document.getElementById('cdNoteInput').style.borderColor = '', 1500);
}

// ---- Grocery panel in client detail ----
function renderCdGrocery(grocery) {
  const { trainer_items = [], client_items = [] } = grocery;
  const all = [...trainer_items, ...client_items];

  const quickItems = [
    { item: 'Greek yogurt',   note: 'high protein snack' },
    { item: 'Chicken breast', note: 'lean protein'       },
    { item: 'Cottage cheese', note: 'good before bed'    },
    { item: 'Eggs',           note: ''                   },
    { item: 'Edamame',        note: 'plant protein'      },
    { item: 'Tuna',           note: 'quick protein'      },
    { item: 'Sweet potato',   note: 'complex carbs'      },
    { item: 'Oats',           note: 'slow release'       },
  ];

  document.getElementById('cdGroceryPanel').innerHTML = `
    <div style="margin-bottom:10px">
      <div style="font-size:11px;color:var(--muted);
                  text-transform:uppercase;letter-spacing:0.5px;
                  margin-bottom:8px;font-weight:700">
        Quick add
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:6px">
        ${quickItems.map(qi => `
          <button onclick="trainerQuickAdd('${selectedClientId}',
            '${qi.item}', '${qi.note}')"
            style="background:var(--surface2);border:1px solid var(--border);
                   border-radius:8px;color:var(--text);font-size:12px;
                   padding:6px 10px;cursor:pointer">
            ${qi.item}
          </button>`).join('')}
      </div>
    </div>
    <div class="grocery-add-row" style="margin-bottom:12px">
      <input type="text" id="cdGroceryInput-${selectedClientId}"
        placeholder="Custom item…">
      <input type="text" id="cdGroceryNote-${selectedClientId}"
        placeholder="Note…" style="flex:1">
      <button onclick="trainerCustomAdd('${selectedClientId}')">+</button>
    </div>
    ${all.length === 0
      ? '<p style="color:var(--muted);font-size:13px">No items yet.</p>'
      : all.map(item => `
          <div class="grocery-item ${item.checked ? 'checked' : ''}
               ${item.added_by_role === 'trainer' ? 'trainer-item' : ''}">
            <div class="gi-content">
              <span class="gi-name">${item.item}</span>
              ${item.note
                ? `<span class="gi-note">"${item.note}"</span>`
                : ''}
            </div>
            <span style="font-size:10px;color:var(--muted)">
              ${item.checked ? '✓ done' : 'pending'}
            </span>
            <button class="gi-del"
              onclick="trainerDeleteGrocery(${item.id})">✕</button>
          </div>`).join('')}`;
}

async function trainerQuickAdd(clientId, item, note) {
  await fetch('/api/trainer/grocery', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: clientId, item, note: note || null })
  });
  loadClientDetail();
}

async function trainerCustomAdd(clientId) {
  const item = document.getElementById(`cdGroceryInput-${clientId}`)?.value.trim();
  const note = document.getElementById(`cdGroceryNote-${clientId}`)?.value.trim();
  if (!item) return;
  await trainerQuickAdd(clientId, item, note || null);
}

async function trainerDeleteGrocery(id) {
  await fetch(`/api/trainer/grocery/${id}`, { method: 'DELETE' });
  loadClientDetail();
}

// ---- Invite modal ----
function openInviteModal() {
  document.getElementById('inviteModal').classList.add('open');
  document.getElementById('inviteEmailInput').value = '';
  document.getElementById('inviteResult').style.display = 'none';
  document.getElementById('inviteError').classList.remove('show');
}

async function sendInvite() {
  const email = document.getElementById('inviteEmailInput').value.trim();
  if (!email || !email.includes('@')) return;

  try {
    const res = await fetch('/api/trainer/invite', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    document.getElementById('inviteLink').value = data.invite_url;
    document.getElementById('inviteResult').style.display = 'block';
  } catch(err) {
    document.getElementById('inviteError').textContent =
      err.message || 'Failed to create invite.';
    document.getElementById('inviteError').classList.add('show');
  }
}

function copyInviteLink() {
  const link = document.getElementById('inviteLink').value;
  navigator.clipboard.writeText(link);
  document.getElementById('copyBtn').textContent = '✓ Copied';
  setTimeout(() =>
    document.getElementById('copyBtn').textContent = 'Copy', 2000);
}
```

### Invite modal HTML
```html
<div class="modal-bg" id="inviteModal">
  <div class="modal">
    <div class="modal-handle"></div>
    <div class="modal-title">+ Invite Client</div>
    <div class="error-msg" id="inviteError"></div>
    <div class="form-field" style="margin-bottom:14px">
      <label>Client's email address</label>
      <input type="email" id="inviteEmailInput"
        placeholder="client@email.com">
    </div>
    <button class="btn-primary" onclick="sendInvite()">
      Generate invite link
    </button>
    <div id="inviteResult" style="display:none;margin-top:14px">
      <div style="font-size:12px;color:var(--muted);margin-bottom:8px">
        Share this link with your client:
      </div>
      <div style="display:flex;gap:8px">
        <input id="inviteLink" readonly
          style="flex:1;background:var(--surface2);
                 border:1px solid var(--border);border-radius:9px;
                 padding:10px 12px;color:var(--text);
                 font-family:var(--mono);font-size:12px;outline:none">
        <button id="copyBtn" class="btn-primary"
          onclick="copyInviteLink()"
          style="width:auto;padding:10px 16px;flex-shrink:0">
          Copy
        </button>
      </div>
      <p style="font-size:11px;color:var(--muted);margin-top:8px">
        Link expires in 7 days.
        Client will be asked to verify their email via Cloudflare Access.
      </p>
    </div>
    <button class="btn-cancel" onclick="closeModal('inviteModal')">
      Cancel
    </button>
  </div>
</div>
```

---

## Trainer Setup Flow

First time a user wants to become a trainer:

```html
<div class="modal-bg" id="trainerSetupModal">
  <div class="modal">
    <div class="modal-handle"></div>
    <div class="modal-title">Set up your coaching profile</div>
    <div class="form-field" style="margin-bottom:14px">
      <label>Your business / coaching name</label>
      <input type="text" id="trainerOrgInput"
        placeholder="e.g. John Smith Fitness">
    </div>
    <p style="font-size:13px;color:var(--muted);margin-bottom:14px">
      This is what your clients will see when they receive your invite.
    </p>
    <button class="btn-primary" onclick="setupTrainer()">
      Create coaching profile
    </button>
    <button class="btn-cancel"
      onclick="closeModal('trainerSetupModal')">
      Cancel
    </button>
  </div>
</div>
```

Show this modal when user taps a "Become a trainer" button in Settings:

```html
<!-- In settings modal, add: -->
<div class="setting-row" style="margin-top:16px;padding-top:16px;
     border-top:1px solid var(--border)">
  <label>Trainer mode</label>
  <button class="btn-primary" onclick="openModal('trainerSetupModal')"
    style="width:auto;padding:8px 16px;font-size:12px"
    id="becomeTrainerBtn">
    Set up coaching profile
  </button>
</div>
```

JS:
```js
async function setupTrainer() {
  const name = document.getElementById('trainerOrgInput').value.trim();
  if (!name) return;
  const res = await fetch('/api/trainer/setup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ org_name: name })
  });
  if (res.ok) {
    closeModal('trainerSetupModal');
    document.getElementById('tabTrainer').style.display = 'flex';
    switchTab('trainer');
    renderTrainerTab();
  }
}
```

---

## Admin Tab (you only)

Simple read-only overview for platform management:

```
GET /api/admin/stats
    → { total_users, solo_users, trainers, clients,
        food_entries_today, food_entries_7d,
        new_users_7d, active_users_7d }
    → requires is_admin = 1

GET /api/admin/users
    → paginated user list with role, entry count, last active
    → requires is_admin = 1
```

Admin tab UI — simple stats grid + user table. Can also
manually set user roles and disable accounts.

---

## switchTab — Final Map

```js
const btnMap = {
  today:    'tabToday',
  history:  'tabHistory',
  weight:   'tabWeight',
  analysis: 'tabAnalysis',
  grocery:  'tabGrocery',
  trainer:  'tabTrainer',
  admin:    'tabAdmin',
};
const contentMap = {
  today:    'tabContentToday',
  history:  'tabContentHistory',
  weight:   'tabContentWeight',
  analysis: 'tabContentAnalysis',
  grocery:  'tabContentGrocery',
  trainer:  'tabContentTrainer',
  admin:    'tabContentAdmin',
};

// On tab switch:
if (tab === 'history')  renderHistory();
if (tab === 'weight')   renderWeightTab();
if (tab === 'analysis') renderAnalysis();
if (tab === 'grocery')  renderGrocery();
if (tab === 'trainer')  renderTrainerTab();
if (tab === 'admin')    renderAdminTab();
```

---

## Build Priority Order for Claude Code

1. Schema changes (ALTER TABLE + CREATE TABLE)
2. /api/me update (return role/org/trainer context)
3. /api/trainer/setup + /api/trainer/org
4. /api/trainer/clients (roster endpoint)
5. /api/trainer/clients/:id (detail endpoint)
6. /api/trainer/invite + /api/invite/:token/accept
7. /api/trainer/notes
8. /api/trainer/grocery routes
9. /api/grocery (client-side routes)
10. Frontend — role detection on load
11. Frontend — Trainer tab + roster UI
12. Frontend — Client detail modal
13. Frontend — Invite modal + accept screen
14. Frontend — Grocery tab
15. Frontend — Coach note display in Today tab
16. Frontend — Trainer setup in Settings
17. Admin routes + tab (last, least urgent)

---

## Notes for Claude Code

- All trainer routes must verify the requesting user has
  role='trainer' and that the client_id belongs to their org
  before returning any data. Never return another org's data.

- Solo users (no membership row) use the app exactly as today.
  Zero changes to their experience.

- The ?token= invite URL must work even on first visit
  (before the user has logged in). Cloudflare Access will
  intercept first, then redirect back to the URL with the
  token intact after OTP verification.

- Use nanoid or crypto.randomUUID() for invite tokens —
  not sequential IDs.

- Grocery items added by trainers should NOT be deletable
  by the client (only checkable). Only the trainer can remove
  their own suggestions.

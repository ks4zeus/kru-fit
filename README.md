# Kru Fit

A Cloudflare full-stack nutrition tracker for family use:

- **Frontend** — single-file app on Cloudflare Pages (`frontend/index.html`)
- **API** — Cloudflare Worker (`worker/src/index.ts`)
- **Database** — D1 (SQLite), schema in `schema.sql`
- **Auth** — Cloudflare Access email OTP, verified by the Worker

## Project structure

```
kru-fit/
├── frontend/
│   └── index.html        # the whole app (UI + API client, localStorage fallback)
├── worker/
│   ├── src/index.ts      # API: food/weight/water/custom-foods/goals + analyze
│   ├── wrangler.toml
│   ├── package.json
│   └── tsconfig.json
├── schema.sql
├── wrangler.toml         # Pages config (frontend)
└── README.md
```

## Setup

1. **Create the D1 database** and copy the `database_id` into `worker/wrangler.toml`:

   ```bash
   wrangler d1 create kru-fit-db
   ```

2. **Run the schema migration:**

   ```bash
   wrangler d1 execute kru-fit-db --file=schema.sql
   ```

3. **Set the Worker secret** for AI photo analysis:

   ```bash
   cd worker
   wrangler secret put ANTHROPIC_API_KEY
   ```

4. **Deploy the Worker:**

   ```bash
   cd worker
   npm install
   wrangler deploy
   ```

5. **Deploy the frontend to Pages:**

   ```bash
   wrangler pages deploy frontend --project-name kru-fit
   ```

## Cloudflare Access (authentication)

1. In Zero Trust → **Access → Applications**, add an application covering the API
   route (and/or the Pages site).
2. Choose **Email OTP** and add family member emails to the policy.
3. Copy the application's **Application Audience (AUD) tag**.

Then harden the Worker so it **verifies** the Access JWT instead of trusting a
header (which would be spoofable if the route were ever reachable without Access):

- Set these in `worker/wrangler.toml` under `[vars]`:
  - `ACCESS_TEAM_DOMAIN` — e.g. `yourteam.cloudflareaccess.com`
  - `ACCESS_AUD` — the AUD tag from step 3
- When both are set, the Worker cryptographically verifies the
  `Cf-Access-Jwt-Assertion` token against your team's JWKS and rejects anything
  that doesn't validate. When they're **unset** (local dev), it falls back to
  trusting the `Cf-Access-Authenticated-User-Email` header.

⚠️ In production you must set both vars **and** ensure Access actually fronts the
Worker route — otherwise the API is open.

## Local development

```bash
cd worker
npm install
npm run dev          # wrangler dev --persist-to ./wrangler-state
```

In dev (no `ACCESS_*` vars), send the email header manually, e.g.:

```bash
curl localhost:8787/api/me -H "Cf-Access-Authenticated-User-Email: you@example.com"
```

## API routes

All routes require authentication and scope data to the signed-in user.

- `GET  /api/me`
- `GET  /api/food?date=YYYY-MM-DD`
- `GET  /api/food/range?days=N`      — entries across a window (powers History/Insights)
- `POST /api/food`
- `DELETE /api/food/:id`
- `DELETE /api/food?date=YYYY-MM-DD`
- `POST /api/analyze`                — AI food-photo analysis, proxied to Anthropic
- `GET  /api/weight?days=365`
- `POST /api/weight`
- `DELETE /api/weight/:date`
- `GET  /api/water?date=YYYY-MM-DD`
- `POST /api/water`
- `GET  /api/custom-foods`
- `POST /api/custom-foods`
- `DELETE /api/custom-foods/:id`
- `GET  /api/goals`
- `POST /api/goals`

## Notes

- `POST /api/analyze` keeps the Anthropic API key server-side; the browser never
  sees it. If `ANTHROPIC_API_KEY` is unset the endpoint returns `503`.
- History, the streak, and Insights hydrate the local cache from
  `/api/food/range`, so they reflect data logged on any device.
- The frontend falls back to `localStorage` whenever the API is unreachable.

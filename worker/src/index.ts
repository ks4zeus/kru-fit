const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Cf-Access-Authenticated-User-Email, Cf-Access-Jwt-Assertion",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders,
    },
  });
}

async function parseJson(request: Request): Promise<any> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

// ---- Cloudflare Access authentication ----
//
// In production, set ACCESS_TEAM_DOMAIN (e.g. "myteam.cloudflareaccess.com") and
// ACCESS_AUD (the Application Audience tag from the Access app) so every request's
// `Cf-Access-Jwt-Assertion` token is cryptographically verified against the team's
// JWKS. When those vars are unset (local dev), we fall back to trusting the
// `Cf-Access-Authenticated-User-Email` header. This makes a misconfiguration fail
// CLOSED in production rather than silently trusting a spoofable header.

type Jwk = { kid: string; [k: string]: unknown };
const jwksCache: { keys: Jwk[] | null; exp: number } = { keys: null, exp: 0 };

function base64UrlToBytes(input: string): Uint8Array {
  let s = input.replace(/-/g, "+").replace(/_/g, "/");
  const pad = s.length % 4;
  if (pad) s += "=".repeat(4 - pad);
  const bin = atob(s);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function base64UrlToString(input: string): string {
  return new TextDecoder().decode(base64UrlToBytes(input));
}

async function fetchJwks(teamDomain: string): Promise<Jwk[]> {
  const now = Date.now();
  if (jwksCache.keys && now < jwksCache.exp) return jwksCache.keys;
  const resp = await fetch(`https://${teamDomain}/cdn-cgi/access/certs`);
  if (!resp.ok) throw new Error("Failed to fetch Access JWKS");
  const data = (await resp.json()) as { keys?: Jwk[] };
  jwksCache.keys = data.keys || [];
  jwksCache.exp = now + 60 * 60 * 1000; // cache for 1 hour
  return jwksCache.keys;
}

async function verifyAccessJwt(
  token: string,
  teamDomain: string,
  aud: string
): Promise<{ email?: string } | null> {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [headerB64, payloadB64, sigB64] = parts;

  let header: { kid?: string; alg?: string };
  let payload: { email?: string; aud?: string | string[]; iss?: string; exp?: number; nbf?: number };
  try {
    header = JSON.parse(base64UrlToString(headerB64));
    payload = JSON.parse(base64UrlToString(payloadB64));
  } catch {
    return null;
  }

  const keys = await fetchJwks(teamDomain);
  const jwk = keys.find((k) => k.kid === header.kid);
  if (!jwk) return null;

  const key = await crypto.subtle.importKey(
    "jwk",
    jwk as unknown as JsonWebKey,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"]
  );
  const signed = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
  const valid = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    key,
    base64UrlToBytes(sigB64) as BufferSource,
    signed as BufferSource
  );
  if (!valid) return null;

  const now = Math.floor(Date.now() / 1000);
  if (payload.exp && payload.exp < now) return null;
  if (payload.nbf && payload.nbf > now) return null;
  if (payload.iss && payload.iss !== `https://${teamDomain}`) return null;
  const auds = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!auds.includes(aud)) return null;

  return payload;
}

async function authenticate(request: Request, env: Env): Promise<string | null> {
  if (env.ACCESS_TEAM_DOMAIN && env.ACCESS_AUD) {
    const token = request.headers.get("Cf-Access-Jwt-Assertion");
    if (!token) return null;
    try {
      const payload = await verifyAccessJwt(token, env.ACCESS_TEAM_DOMAIN, env.ACCESS_AUD);
      return payload?.email ?? null;
    } catch {
      return null;
    }
  }
  // Local-dev fallback: trust the header Access would normally inject.
  return request.headers.get("Cf-Access-Authenticated-User-Email");
}

function getPathSegments(url: URL) {
  return url.pathname.replace(/^\/+|\/+$/g, "").split("/");
}

// Admin allowlist — comma-separated ADMIN_EMAILS env var, defaulting to the owner.
function adminEmails(env: Env): string[] {
  const raw = env.ADMIN_EMAILS && env.ADMIN_EMAILS.trim() ? env.ADMIN_EMAILS : "kru@travelkru.com";
  return raw.split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
}
function isAdmin(email: string, env: Env): boolean {
  return adminEmails(env).includes((email || "").toLowerCase());
}

// Build the /api/me payload: identity + role, plus (for a client) their trainer/org
// or (for a trainer) their org with a live client count. Extends the original
// { email, name, admin } shape additively — `role`, `trainer`, `org` are new.
async function mePayload(db: D1Database, env: Env, userEmail: string) {
  const row = await db
    .prepare("SELECT name, role, trainer_eligible FROM users WHERE id = ?")
    .bind(userEmail)
    .first<{ name: string | null; role: string | null; trainer_eligible: number | null }>();
  const name = row?.name ? String(row.name).trim() : null;
  const role = row?.role || "solo";
  const admin = isAdmin(userEmail, env);
  // Admins are implicitly eligible; otherwise it's an admin-granted per-user flag.
  const trainerEligible = admin || !!row?.trainer_eligible;

  let trainer: { name: string; org_id: string; org_name: string } | null = null;
  let org: { id: string; name: string; client_count: number } | null = null;

  if (role === "client") {
    const m = await db
      .prepare(
        `SELECT o.id AS org_id, o.name AS org_name, o.owner_id AS trainer_id
         FROM memberships m JOIN organizations o ON o.id = m.org_id
         WHERE m.user_id = ? AND m.role = 'client' AND m.status = 'active'
         LIMIT 1`
      )
      .bind(userEmail)
      .first<{ org_id: string; org_name: string; trainer_id: string }>();
    if (m) {
      const t = await db
        .prepare("SELECT name FROM users WHERE id = ?")
        .bind(m.trainer_id)
        .first<{ name: string | null }>();
      trainer = {
        name: (t?.name && t.name.trim()) || m.org_name,
        org_id: m.org_id,
        org_name: m.org_name,
      };
    }
  } else if (role === "trainer") {
    const o = await db
      .prepare("SELECT id, name FROM organizations WHERE owner_id = ?")
      .bind(userEmail)
      .first<{ id: string; name: string }>();
    if (o) {
      const c = await db
        .prepare(
          "SELECT COUNT(*) AS n FROM memberships WHERE org_id = ? AND role = 'client' AND status = 'active'"
        )
        .bind(o.id)
        .first<{ n: number }>();
      org = { id: o.id, name: o.name, client_count: c?.n || 0 };
    }
  }

  return { email: userEmail, name: name || null, role, admin, trainer_eligible: trainerEligible, trainer, org };
}

// The org id this trainer owns, or null. (Trainer ⇒ owns an org; see /trainer/setup.)
async function ownedOrgId(db: D1Database, userEmail: string): Promise<string | null> {
  const o = await db
    .prepare("SELECT id FROM organizations WHERE owner_id = ?")
    .bind(userEmail)
    .first<{ id: string }>();
  return o?.id ?? null;
}

// True if clientId is an active client of orgId — the per-request IDOR guard for
// every trainer route that takes a client_id.
async function clientInOrg(db: D1Database, orgId: string, clientId: string): Promise<boolean> {
  const m = await db
    .prepare(
      "SELECT 1 FROM memberships WHERE org_id = ? AND user_id = ? AND role = 'client' AND status = 'active'"
    )
    .bind(orgId, clientId)
    .first();
  return !!m;
}

// Anthropic per-model pricing, USD per 1M tokens (input, output).
const AI_PRICING: Record<string, { in: number; out: number }> = {
  "claude-sonnet-4-6": { in: 3.0, out: 15.0 },
  "claude-haiku-4-5-20251001": { in: 1.0, out: 5.0 },
};
// Image input needs vision (Sonnet); text-only is fine on Haiku (faster + cheaper).
const AI_MODEL_VISION = "claude-sonnet-4-6";
const AI_MODEL_TEXT = "claude-haiku-4-5-20251001";

// Record one AI call's token usage for the admin dashboard. Best-effort —
// a logging failure must never break the user-facing response.
async function recordAiUsage(
  db: D1Database,
  userEmail: string,
  endpoint: string,
  model: string,
  usage: { input_tokens?: number; output_tokens?: number } | undefined
) {
  if (!usage) return;
  try {
    await db
      .prepare(
        `INSERT INTO ai_usage (user_id, endpoint, model, input_tokens, output_tokens)
         VALUES (?, ?, ?, ?, ?)`
      )
      .bind(userEmail, endpoint, model, usage.input_tokens ?? 0, usage.output_tokens ?? 0)
      .run();
  } catch (e) {
    console.error("ai_usage insert failed", e);
  }
}

const NUTRITION_SYSTEM_PROMPT = `You are a nutrition analysis assistant. Given a food as either a photo or a written description of the dish and its ingredients, identify it and estimate its nutritional content. Always respond ONLY with valid JSON, no markdown, no extra text. Use this exact structure:
{
  "name": "Food name",
  "emoji": "single relevant emoji",
  "calories": number,
  "protein_g": number,
  "carbs_g": number,
  "fiber_g": number,
  "fat_g": number,
  "serving_qty": number,
  "serving_unit": "one of: g, oz, lb, ml, cup, tbsp, tsp, fl oz, each",
  "serving_grams": number,
  "serving_note": "brief note about the serving size assumed",
  "confidence": "high|medium|low"
}
Express the serving as serving_qty + serving_unit using ONLY one of these units: g, oz, lb, ml, cup, tbsp, tsp, fl oz, each. Pick the unit a person would most naturally use for this food (use "each" for countable items like an egg or a banana). ALWAYS also provide serving_grams = your best estimate of the total weight of that serving in grams (the macros above are for exactly this serving) — this lets the app convert between units. The macros, serving_qty/serving_unit, and serving_grams must all describe the SAME single serving.
Be realistic with estimates. If multiple items are present, estimate the total. If you cannot identify the food, set name to "Unknown food" with zeroes and confidence "low".`;

const COACH_SYSTEM_PROMPT = `You are a practical, encouraging nutrition and fitness coach. You receive a JSON summary of someone's recent eating: their daily averages, their goals, and their most-eaten foods. The summary may include the person's "name" — if it's present, address them by it warmly (e.g., open the headline with it); if it's absent, don't invent one. The summary may also include an optional "exercise" block (workouts, active days, calories burned, top activities) — when it is present, factor their activity into your assessment (acknowledge consistency, consider overall energy balance, and reference it where relevant in wins/issues); when it is absent, do not mention exercise at all.

The summary includes the person's "objective" — one of "lose" (lose weight), "maintain", or "gain" (gain muscle). Contextualize ALL advice to it:
- "lose": a calorie deficit is the GOAL, not a problem. Do NOT flag low calories or being under the calorie goal as an issue UNLESS average daily calories fall below 1200 OR protein averages below 70% of its goal. Frame an appropriate deficit as positive progress; if calories drop below 1200 or protein compliance is under 70%, raise that as the priority issue.
- "maintain": aim for balance near the goals; flag large sustained surpluses or deficits.
- "gain": a modest calorie surplus and high protein are desired. Do NOT flag being over the calorie goal as a problem; instead flag insufficient protein, or calories/protein too low to support muscle gain.

Identify the most important takeaways and respond ONLY with valid JSON (no markdown), in this exact shape:
{
  "headline": "one upbeat sentence summarizing how they're doing",
  "wins": ["short positive observations grounded in the numbers"],
  "issues": ["short, specific problems, e.g. protein averaging well under goal"],
  "suggestions": [{"food": "a specific common food", "reason": "why it helps, tied to a gap"}]
}
Rules: base every claim on the numbers provided. Be concise and specific — 2 to 4 items per list. Be supportive, never judgmental or alarmist. Prefer realistic, accessible foods that close the biggest gaps. STRICTLY respect the person's dietary_preference and restrictions if present: never suggest meat/poultry to a vegetarian, never suggest any animal products (meat, fish, dairy, eggs) to a vegan, never suggest meat (but fish is ok) to a pescatarian, and never suggest anything that conflicts with their stated restrictions/allergies. This is general guidance, not medical advice.`;

export default {
  async fetch(request: Request, env: Env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    const url = new URL(request.url);
    const segments = getPathSegments(url);
    const db = env.DB;

    // ---- Public route: invite preview (no Worker auth) ----
    // A client can see who invited them before identity matters. Cloudflare Access
    // still fronts the site; this route just doesn't depend on the caller.
    if (
      segments[0] === "api" && segments[1] === "invite" &&
      segments.length === 3 && request.method === "GET"
    ) {
      const token = segments[2];
      const invite = await db
        .prepare(
          `SELECT o.name AS org_name, o.owner_id AS trainer_id, i.expires_at
           FROM invites i JOIN organizations o ON o.id = i.org_id
           WHERE i.id = ? AND i.status = 'pending' AND i.expires_at > datetime('now')`
        )
        .bind(token)
        .first<{ org_name: string; trainer_id: string; expires_at: string }>();
      if (!invite) return jsonResponse({ valid: false });
      const t = await db
        .prepare("SELECT name FROM users WHERE id = ?")
        .bind(invite.trainer_id)
        .first<{ name: string | null }>();
      return jsonResponse({
        valid: true,
        org_name: invite.org_name,
        trainer_name: (t?.name && t.name.trim()) || invite.org_name,
        expires_at: invite.expires_at,
      });
    }

    const userEmail = await authenticate(request, env);
    if (!userEmail) {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }

    if (segments.length === 2 && segments[0] === "api" && segments[1] === "me") {
      if (request.method === "GET") {
        // First login: auto-create as a solo user. Cloudflare Access (One-time PIN)
        // has already verified email ownership; D1 is the authorization layer.
        const exists = await db.prepare("SELECT 1 FROM users WHERE id = ?").bind(userEmail).first();
        if (!exists) {
          await db
            .prepare("INSERT INTO users (id, role) VALUES (?, 'solo') ON CONFLICT(id) DO NOTHING")
            .bind(userEmail)
            .run();
        }
        return jsonResponse(await mePayload(db, env, userEmail));
      }
      if (request.method === "POST") {
        const body = await parseJson(request);
        const name = (body?.name ?? "").toString().trim().slice(0, 60);
        // Upsert the name; a brand-new user gets role='solo' from the column default,
        // and an existing user keeps their role (we only touch the name).
        await db
          .prepare(
            `INSERT INTO users (id, name) VALUES (?, ?)
             ON CONFLICT(id) DO UPDATE SET name = excluded.name`
          )
          .bind(userEmail, name || null)
          .run();
        return jsonResponse(await mePayload(db, env, userEmail));
      }
    }

    if (segments[0] !== "api") {
      return jsonResponse({ error: "Not found" }, 404);
    }

    // ---- AI food analysis: photo OR text description (key stays server-side) ----
    if (segments[1] === "analyze" && request.method === "POST") {
      if (!env.ANTHROPIC_API_KEY) {
        return jsonResponse({ error: "AI analysis is not configured" }, 503);
      }
      const body = await parseJson(request);
      const description = typeof body?.description === "string" ? body.description.trim() : "";
      if (!body?.image && !description) {
        return jsonResponse({ error: "Missing image or description" }, 400);
      }

      // Build the user message from whichever input was provided.
      let content: unknown[];
      if (body?.image) {
        const mediaType = body.media_type || "image/jpeg";
        content = [
          { type: "image", source: { type: "base64", media_type: mediaType, data: body.image } },
          { type: "text", text: "Analyze this food and provide nutrition estimates as JSON." },
        ];
      } else {
        content = [
          { type: "text", text: `Estimate the nutrition for this food and provide it as JSON:\n\n${description}` },
        ];
      }

      // Photo needs vision (Sonnet); a written description is text-only → Haiku.
      const model = body?.image ? AI_MODEL_VISION : AI_MODEL_TEXT;
      const aiResp = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": env.ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model,
          max_tokens: 1000,
          system: NUTRITION_SYSTEM_PROMPT,
          messages: [{ role: "user", content }],
        }),
      });

      if (!aiResp.ok) {
        // Log the provider detail server-side (visible via `wrangler pages deployment tail`).
        console.error("Anthropic error", aiResp.status, await aiResp.text());
        return jsonResponse({ error: "AI request failed" }, 502);
      }
      const data = (await aiResp.json()) as {
        content?: Array<{ text?: string }>;
        usage?: { input_tokens?: number; output_tokens?: number };
      };
      await recordAiUsage(db, userEmail, body?.image ? "analyze-photo" : "analyze-text", model, data.usage);
      const text = (data.content || []).map((b) => b.text || "").join("").trim();
      const clean = text.replace(/```json|```/g, "").trim();
      try {
        return jsonResponse(JSON.parse(clean));
      } catch {
        console.error("AI parse failure, raw text:", text);
        return jsonResponse({ error: "Could not parse AI response" }, 502);
      }
    }

    // ---- AI diet analysis ("coach") ----
    if (segments[1] === "coach" && request.method === "POST") {
      if (!env.ANTHROPIC_API_KEY) {
        return jsonResponse({ error: "AI analysis is not configured" }, 503);
      }
      const body = await parseJson(request);
      if (!body?.summary) {
        return jsonResponse({ error: "Missing summary" }, 400);
      }
      const aiResp = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": env.ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: AI_MODEL_TEXT,
          max_tokens: 1024,
          system: COACH_SYSTEM_PROMPT,
          messages: [
            {
              role: "user",
              content: [
                { type: "text", text: `Here is the person's recent eating summary as JSON. Analyze it.\n\n${JSON.stringify(body.summary)}` },
              ],
            },
          ],
        }),
      });
      if (!aiResp.ok) {
        console.error("Anthropic error", aiResp.status, await aiResp.text());
        return jsonResponse({ error: "AI request failed" }, 502);
      }
      const data = (await aiResp.json()) as {
        content?: Array<{ text?: string }>;
        usage?: { input_tokens?: number; output_tokens?: number };
      };
      await recordAiUsage(db, userEmail, "coach", AI_MODEL_TEXT, data.usage);
      const text = (data.content || []).map((b) => b.text || "").join("").trim();
      const clean = text.replace(/```json|```/g, "").trim();
      try {
        return jsonResponse(JSON.parse(clean));
      } catch {
        console.error("Coach parse failure, raw text:", text);
        return jsonResponse({ error: "Could not parse AI response" }, 502);
      }
    }

    if (segments[1] === "food") {
      // Range query for History / Insights (multi-device): all entries in the window.
      if (request.method === "GET" && segments[2] === "range") {
        const days = Number(url.searchParams.get("days")) || 30;
        const { results } = await db
          .prepare(
            "SELECT * FROM food_log WHERE user_id = ? AND date >= date('now', ?) ORDER BY date ASC, ts ASC"
          )
          .bind(userEmail, `-${days} days`)
          .all();
        return jsonResponse(results || []);
      }

      if (request.method === "GET") {
        const date = url.searchParams.get("date");
        if (!date) {
          return jsonResponse({ error: "Missing date" }, 400);
        }
        const { results } = await db
          .prepare("SELECT * FROM food_log WHERE user_id = ? AND date = ? ORDER BY ts ASC")
          .bind(userEmail, date)
          .all();
        return jsonResponse(results || []);
      }

      if (request.method === "POST") {
        const body = await parseJson(request);
        if (!body?.date || !body?.name) {
          return jsonResponse({ error: "Missing required fields" }, 400);
        }

        const inserted = await db
          .prepare(
            `INSERT INTO food_log (user_id, date, name, emoji, cal, protein, carbs, fat, fiber, source, serving, serving_grams, ts)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .bind(
            userEmail,
            body.date,
            body.name,
            body.emoji || null,
            body.cal ?? 0,
            body.protein ?? 0,
            body.carbs ?? 0,
            body.fat ?? 0,
            body.fiber ?? 0,
            body.source || null,
            body.serving || null,
            body.serving_grams ?? null,
            body.ts ?? null
          )
          .run();

        return jsonResponse({ id: inserted.meta?.last_row_id, ...body });
      }

      if (request.method === "PUT") {
        const id = Number(segments[2]);
        if (!Number.isFinite(id) || id <= 0) {
          return jsonResponse({ error: "Invalid id" }, 400);
        }
        const body = await parseJson(request);
        if (!body?.name) {
          return jsonResponse({ error: "Missing required fields" }, 400);
        }
        await db
          .prepare(
            `UPDATE food_log SET name = ?, emoji = ?, cal = ?, protein = ?, carbs = ?, fat = ?, fiber = ?, serving = ?, serving_grams = ?
             WHERE id = ? AND user_id = ?`
          )
          .bind(
            body.name,
            body.emoji || null,
            body.cal ?? 0,
            body.protein ?? 0,
            body.carbs ?? 0,
            body.fat ?? 0,
            body.fiber ?? 0,
            body.serving ?? null,
            body.serving_grams ?? null,
            id,
            userEmail
          )
          .run();
        return jsonResponse({ id, ...body });
      }

      if (request.method === "DELETE") {
        const idSegment = segments[2];
        if (idSegment) {
          const id = Number(idSegment);
          if (!Number.isFinite(id) || id <= 0) {
            return jsonResponse({ error: "Invalid id" }, 400);
          }
          await db
            .prepare("DELETE FROM food_log WHERE id = ? AND user_id = ?")
            .bind(id, userEmail)
            .run();
          return jsonResponse({ success: true });
        }

        const date = url.searchParams.get("date");
        if (!date) {
          return jsonResponse({ error: "Missing date" }, 400);
        }

        await db.prepare("DELETE FROM food_log WHERE user_id = ? AND date = ?").bind(userEmail, date).run();
        return jsonResponse({ success: true });
      }
    }

    if (segments[1] === "workouts") {
      if (request.method === "GET" && segments[2] === "range") {
        const days = Number(url.searchParams.get("days")) || 365;
        const { results } = await db
          .prepare("SELECT * FROM workouts WHERE user_id = ? AND date >= date('now', ?) ORDER BY date ASC, ts ASC")
          .bind(userEmail, `-${days} days`)
          .all();
        return jsonResponse(results || []);
      }

      if (request.method === "GET") {
        const date = url.searchParams.get("date");
        if (!date) {
          return jsonResponse({ error: "Missing date" }, 400);
        }
        const { results } = await db
          .prepare("SELECT * FROM workouts WHERE user_id = ? AND date = ? ORDER BY ts ASC")
          .bind(userEmail, date)
          .all();
        return jsonResponse(results || []);
      }

      if (request.method === "POST") {
        const body = await parseJson(request);
        if (!body?.date || !body?.name) {
          return jsonResponse({ error: "Missing required fields" }, 400);
        }
        const inserted = await db
          .prepare(
            `INSERT INTO workouts (user_id, date, name, minutes, calories, distance, ts)
             VALUES (?, ?, ?, ?, ?, ?, ?)`
          )
          .bind(userEmail, body.date, body.name, body.minutes ?? 0, body.calories ?? 0, body.distance ?? null, body.ts ?? null)
          .run();
        return jsonResponse({ id: inserted.meta?.last_row_id, ...body });
      }

      if (request.method === "DELETE") {
        const idSegment = segments[2];
        if (!idSegment) {
          return jsonResponse({ error: "Missing id" }, 400);
        }
        const id = Number(idSegment);
        if (!Number.isFinite(id) || id <= 0) {
          return jsonResponse({ error: "Invalid id" }, 400);
        }
        await db
          .prepare("DELETE FROM workouts WHERE id = ? AND user_id = ?")
          .bind(id, userEmail)
          .run();
        return jsonResponse({ success: true });
      }
    }

    if (segments[1] === "weight") {
      if (request.method === "GET") {
        const daysParam = url.searchParams.get("days") || "365";
        const days = Number(daysParam) || 365;
        const { results } = await db
          .prepare(
            `SELECT * FROM weight_log WHERE user_id = ? AND date >= date('now', ?) ORDER BY date ASC`
          )
          .bind(userEmail, `-${days} days`)
          .all();
        return jsonResponse(results || []);
      }

      if (request.method === "POST") {
        const body = await parseJson(request);
        if (!body?.date || body.val == null) {
          return jsonResponse({ error: "Missing required fields" }, 400);
        }

        await db
          .prepare(
            `INSERT INTO weight_log (user_id, date, val, unit)
             VALUES (?, ?, ?, ?)
             ON CONFLICT(user_id, date) DO UPDATE SET val = excluded.val, unit = excluded.unit`
          )
          .bind(userEmail, body.date, body.val, body.unit || "lbs")
          .run();

        return jsonResponse({ user_id: userEmail, date: body.date, val: body.val, unit: body.unit || "lbs" });
      }

      if (request.method === "DELETE") {
        const dateSegment = segments[2];
        if (!dateSegment) {
          return jsonResponse({ error: "Missing date" }, 400);
        }
        await db.prepare("DELETE FROM weight_log WHERE user_id = ? AND date = ?").bind(userEmail, dateSegment).run();
        return jsonResponse({ success: true });
      }
    }

    if (segments[1] === "water") {
      if (request.method === "GET") {
        const date = url.searchParams.get("date");
        if (!date) {
          return jsonResponse({ error: "Missing date" }, 400);
        }
        const { results } = await db
          .prepare("SELECT * FROM water_log WHERE user_id = ? AND date = ?")
          .bind(userEmail, date)
          .all();
        const entry = (results && results[0]) || { user_id: userEmail, date, oz: 0 };
        return jsonResponse(entry);
      }

      if (request.method === "POST") {
        const body = await parseJson(request);
        if (!body?.date || body.oz == null) {
          return jsonResponse({ error: "Missing required fields" }, 400);
        }

        await db
          .prepare(
            `INSERT INTO water_log (user_id, date, oz)
             VALUES (?, ?, ?)
             ON CONFLICT(user_id, date) DO UPDATE SET oz = excluded.oz`
          )
          .bind(userEmail, body.date, body.oz)
          .run();

        return jsonResponse({ user_id: userEmail, date: body.date, oz: body.oz });
      }
    }

    if (segments[1] === "custom-foods") {
      if (request.method === "GET") {
        const { results } = await db
          .prepare("SELECT * FROM custom_foods WHERE user_id = ? ORDER BY created_at DESC")
          .bind(userEmail)
          .all();
        return jsonResponse(results || []);
      }

      if (request.method === "POST") {
        const body = await parseJson(request);
        if (!body?.name) {
          return jsonResponse({ error: "Missing name" }, 400);
        }

        const inserted = await db
          .prepare(
            `INSERT INTO custom_foods (user_id, name, emoji, cal, protein, carbs, fat, fiber, serving, serving_grams, ingredients, recipe_items, servings)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .bind(
            userEmail,
            body.name,
            body.emoji || null,
            body.cal ?? 0,
            body.protein ?? 0,
            body.carbs ?? 0,
            body.fat ?? 0,
            body.fiber ?? 0,
            body.serving || null,
            body.serving_grams ?? null,
            body.ingredients || null,
            body.recipe_items || null,
            body.servings ?? 1
          )
          .run();

        return jsonResponse({ id: inserted.meta?.last_row_id, ...body });
      }

      if (request.method === "PUT") {
        const id = Number(segments[2]);
        if (!Number.isFinite(id) || id <= 0) {
          return jsonResponse({ error: "Invalid id" }, 400);
        }
        const body = await parseJson(request);
        if (!body?.name) {
          return jsonResponse({ error: "Missing name" }, 400);
        }
        await db
          .prepare(
            `UPDATE custom_foods SET name = ?, emoji = ?, cal = ?, protein = ?, carbs = ?, fat = ?, fiber = ?, serving = ?, serving_grams = ?, ingredients = ?, recipe_items = ?, servings = ?
             WHERE id = ? AND user_id = ?`
          )
          .bind(
            body.name,
            body.emoji || null,
            body.cal ?? 0,
            body.protein ?? 0,
            body.carbs ?? 0,
            body.fat ?? 0,
            body.fiber ?? 0,
            body.serving || null,
            body.serving_grams ?? null,
            body.ingredients || null,
            body.recipe_items || null,
            body.servings ?? 1,
            id,
            userEmail
          )
          .run();
        return jsonResponse({ id, ...body });
      }

      if (request.method === "DELETE") {
        const idSegment = segments[2];
        if (!idSegment) {
          return jsonResponse({ error: "Missing id" }, 400);
        }
        const id = Number(idSegment);
        if (!Number.isFinite(id) || id <= 0) {
          return jsonResponse({ error: "Invalid id" }, 400);
        }
        await db
          .prepare("DELETE FROM custom_foods WHERE id = ? AND user_id = ?")
          .bind(id, userEmail)
          .run();
        return jsonResponse({ success: true });
      }
    }

    if (segments[1] === "meal-templates") {
      if (request.method === "GET") {
        const { results } = await db
          .prepare("SELECT * FROM meal_templates WHERE user_id = ? ORDER BY created_at DESC")
          .bind(userEmail)
          .all();
        return jsonResponse(results || []);
      }

      if (request.method === "POST") {
        const body = await parseJson(request);
        if (!body?.name) {
          return jsonResponse({ error: "Missing name" }, 400);
        }
        const inserted = await db
          .prepare(
            `INSERT INTO meal_templates (user_id, name, emoji, items)
             VALUES (?, ?, ?, ?)`
          )
          .bind(userEmail, body.name, body.emoji || null, body.items || "[]")
          .run();
        return jsonResponse({ id: inserted.meta?.last_row_id, ...body });
      }

      if (request.method === "PUT") {
        const id = Number(segments[2]);
        if (!Number.isFinite(id) || id <= 0) {
          return jsonResponse({ error: "Invalid id" }, 400);
        }
        const body = await parseJson(request);
        if (!body?.name) {
          return jsonResponse({ error: "Missing name" }, 400);
        }
        await db
          .prepare(
            `UPDATE meal_templates SET name = ?, emoji = ?, items = ?
             WHERE id = ? AND user_id = ?`
          )
          .bind(body.name, body.emoji || null, body.items || "[]", id, userEmail)
          .run();
        return jsonResponse({ id, ...body });
      }

      if (request.method === "DELETE") {
        const idSegment = segments[2];
        if (!idSegment) {
          return jsonResponse({ error: "Missing id" }, 400);
        }
        const id = Number(idSegment);
        if (!Number.isFinite(id) || id <= 0) {
          return jsonResponse({ error: "Invalid id" }, 400);
        }
        await db
          .prepare("DELETE FROM meal_templates WHERE id = ? AND user_id = ?")
          .bind(id, userEmail)
          .run();
        return jsonResponse({ success: true });
      }
    }

    // ---- Admin usage dashboard (admin-only) ----
    if (segments[1] === "admin" && segments[2] === "stats" && request.method === "GET") {
      if (!isAdmin(userEmail, env)) {
        return jsonResponse({ error: "Forbidden" }, 403);
      }

      // Per-user tool usage, categorized by the food_log.source prefix.
      const toolRows = ((await db.prepare(
        `SELECT user_id,
           CASE
             WHEN source LIKE 'AI photo%' THEN 'photo'
             WHEN source LIKE 'Barcode%' THEN 'barcode'
             WHEN source LIKE 'Recipe%' THEN 'recipe'
             WHEN source LIKE 'Meal%' THEN 'meal'
             WHEN source LIKE 'Quick add%' THEN 'quickadd'
             WHEN source LIKE 'Custom%' THEN 'custom'
             ELSE 'other'
           END AS tool,
           COUNT(*) AS n
         FROM food_log GROUP BY user_id, tool`
      ).all()).results || []) as any[];

      const actRows = ((await db.prepare(
        `SELECT user_id, COUNT(*) AS entries, COUNT(DISTINCT date) AS active_days, MAX(ts) AS last_ts
         FROM food_log GROUP BY user_id`
      ).all()).results || []) as any[];

      const aiRows = ((await db.prepare(
        `SELECT user_id, endpoint, model, COUNT(*) AS calls,
           SUM(input_tokens) AS in_tok, SUM(output_tokens) AS out_tok
         FROM ai_usage GROUP BY user_id, endpoint, model`
      ).all()).results || []) as any[];

      // Exercise logging (workouts) and "Analyze my diet" (coach) usage per user.
      const exRows = ((await db.prepare(
        `SELECT user_id, COUNT(*) AS n FROM workouts GROUP BY user_id`
      ).all()).results || []) as any[];
      const coachRows = ((await db.prepare(
        `SELECT user_id, COUNT(*) AS n FROM ai_usage WHERE endpoint = 'coach' GROUP BY user_id`
      ).all()).results || []) as any[];

      const userRows = ((await db.prepare(`SELECT id, name, role, trainer_eligible FROM users`).all()).results || []) as any[];

      const users: Record<string, any> = {};
      const ensure = (id: string) => {
        if (!users[id]) {
          users[id] = {
            email: id, name: (id.split("@")[0] || id), role: "solo", trainerEligible: false,
            entries: 0, activeDays: 0, lastTs: 0,
            tools: {}, ai: { calls: 0, inputTokens: 0, outputTokens: 0, cost: 0, byEndpoint: {} },
          };
        }
        return users[id];
      };
      userRows.forEach((r) => { const u = ensure(r.id); if (r.name) u.name = r.name; u.role = r.role || "solo"; u.trainerEligible = !!r.trainer_eligible; });
      actRows.forEach((r) => { const u = ensure(r.user_id); u.entries = r.entries; u.activeDays = r.active_days; u.lastTs = r.last_ts || 0; });
      toolRows.forEach((r) => { ensure(r.user_id).tools[r.tool] = r.n; });
      exRows.forEach((r) => { ensure(r.user_id).tools.exercise = r.n; });
      coachRows.forEach((r) => { ensure(r.user_id).tools.coach = r.n; });

      // Cost is per-row by the model that actually ran the call.
      const cost = (model: string, inT: number, outT: number) => {
        const p = AI_PRICING[model] || AI_PRICING["claude-sonnet-4-6"];
        return (inT / 1e6) * p.in + (outT / 1e6) * p.out;
      };
      aiRows.forEach((r) => {
        const u = ensure(r.user_id);
        const inT = r.in_tok || 0, outT = r.out_tok || 0, c = cost(r.model, inT, outT);
        u.ai.calls += r.calls; u.ai.inputTokens += inT; u.ai.outputTokens += outT; u.ai.cost += c;
        u.ai.byEndpoint[r.endpoint] = { calls: r.calls, inputTokens: inT, outputTokens: outT, cost: c };
      });

      const userList = Object.values(users).sort((a: any, b: any) => b.entries - a.entries);
      const totals = userList.reduce((t: any, u: any) => {
        t.entries += u.entries; t.aiCalls += u.ai.calls; t.aiCost += u.ai.cost;
        Object.keys(u.tools).forEach((k) => { t.toolTotals[k] = (t.toolTotals[k] || 0) + u.tools[k]; });
        return t;
      }, { users: userList.length, entries: 0, aiCalls: 0, aiCost: 0, toolTotals: {} });

      return jsonResponse({
        users: userList,
        totals,
        pricing: Object.entries(AI_PRICING).map(([model, p]) => ({ model, inputPerM: p.in, outputPerM: p.out })),
      });
    }

    // ---- Admin: grant/revoke trainer eligibility for a user ----
    if (segments[1] === "admin" && segments[2] === "trainer-eligible" && request.method === "POST") {
      if (!isAdmin(userEmail, env)) return jsonResponse({ error: "Forbidden" }, 403);
      const body = await parseJson(request);
      const targetId = (body?.user_id ?? "").toString().trim();
      const eligible = body?.eligible ? 1 : 0;
      if (!targetId) return jsonResponse({ error: "user_id required" }, 400);
      await db
        .prepare(
          "INSERT INTO users (id, trainer_eligible) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET trainer_eligible = excluded.trainer_eligible"
        )
        .bind(targetId, eligible)
        .run();
      return jsonResponse({ ok: true, user_id: targetId, eligible: !!eligible });
    }

    if (segments[1] === "goals") {
      if (request.method === "GET") {
        const { results } = await db
          .prepare("SELECT * FROM goals WHERE user_id = ?")
          .bind(userEmail)
          .all();
        if (results?.length) {
          return jsonResponse({ ...results[0], configured: true });
        }
        return jsonResponse({
          user_id: userEmail,
          cal: 1800,
          protein: 180,
          carbs: 150,
          fat: 60,
          fiber: 30,
          water_oz: 64,
          objective: "maintain",
          diet: "none",
          restrictions: "",
          goal_weight: null,
          configured: false,
        });
      }

      if (request.method === "POST") {
        const body = await parseJson(request);
        if (body == null) {
          return jsonResponse({ error: "Invalid JSON" }, 400);
        }

        await db
          .prepare(
            `INSERT INTO goals (user_id, cal, protein, carbs, fat, fiber, water_oz, objective, diet, restrictions, goal_weight, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
             ON CONFLICT(user_id) DO UPDATE SET
               cal = excluded.cal,
               protein = excluded.protein,
               carbs = excluded.carbs,
               fat = excluded.fat,
               fiber = excluded.fiber,
               water_oz = excluded.water_oz,
               objective = excluded.objective,
               diet = excluded.diet,
               restrictions = excluded.restrictions,
               goal_weight = excluded.goal_weight,
               updated_at = datetime('now')`
          )
          .bind(
            userEmail,
            body.cal ?? 1800,
            body.protein ?? 180,
            body.carbs ?? 150,
            body.fat ?? 60,
            body.fiber ?? 30,
            body.water_oz ?? 64,
            body.objective || "maintain",
            body.diet || "none",
            body.restrictions || "",
            body.goal_weight ?? null
          )
          .run();
        return jsonResponse({ user_id: userEmail, cal: body.cal ?? 1800, protein: body.protein ?? 180, carbs: body.carbs ?? 150, fat: body.fat ?? 60, fiber: body.fiber ?? 30, water_oz: body.water_oz ?? 64, objective: body.objective || "maintain", diet: body.diet || "none", restrictions: body.restrictions || "", goal_weight: body.goal_weight ?? null });
      }
    }

    // ---- Client: read own coach notes for a day (read-only) ----
    if (segments[1] === "coach-notes" && segments.length === 2 && request.method === "GET") {
      const date = (url.searchParams.get("date") || new Date().toISOString().slice(0, 10)).slice(0, 10);
      const rows = ((await db
        .prepare(
          `SELECT cn.note, cn.date, cn.created_at, o.name AS org_name, u.name AS trainer_name
           FROM coach_notes cn
           JOIN organizations o ON o.id = cn.org_id
           LEFT JOIN users u ON u.id = cn.trainer_id
           WHERE cn.client_id = ? AND cn.date = ?
           ORDER BY cn.updated_at DESC`
        )
        .bind(userEmail, date)
        .all()).results || []) as any[];
      const notes = rows.map((r) => ({
        note: r.note,
        date: r.date,
        trainer_name: (r.trainer_name && String(r.trainer_name).trim()) || r.org_name,
        org_name: r.org_name,
        created_at: r.created_at,
      }));
      return jsonResponse(notes);
    }

    // ---- Client/solo: own grocery list ----
    if (segments[1] === "grocery") {
      // Full list, split into trainer suggestions, the user's own items, and done.
      if (request.method === "GET" && segments.length === 2) {
        const rows = ((await db
          .prepare("SELECT id, item, note, added_by_role, checked, checked_at FROM grocery_list WHERE client_id = ? ORDER BY created_at ASC")
          .bind(userEmail)
          .all()).results || []) as any[];
        return jsonResponse({
          trainer_items: rows.filter((g) => !g.checked && g.added_by_role === "trainer"),
          client_items: rows.filter((g) => !g.checked && g.added_by_role === "client"),
          checked_items: rows.filter((g) => g.checked),
        });
      }

      // Add an item of your own.
      if (request.method === "POST" && segments.length === 2) {
        const body = await parseJson(request);
        const item = (body?.item ?? "").toString().trim().slice(0, 120);
        const note = body?.note ? body.note.toString().trim().slice(0, 200) : null;
        if (!item) return jsonResponse({ error: "item required" }, 400);
        // Attach the user's org if they have a trainer (informational; null for solo).
        const m = await db
          .prepare("SELECT org_id FROM memberships WHERE user_id = ? AND role = 'client' AND status = 'active' LIMIT 1")
          .bind(userEmail)
          .first<{ org_id: string }>();
        await db
          .prepare("INSERT INTO grocery_list (org_id, client_id, added_by, added_by_role, item, note) VALUES (?, ?, ?, 'client', ?, ?)")
          .bind(m?.org_id ?? null, userEmail, userEmail, item, note)
          .run();
        return jsonResponse({ ok: true });
      }

      // Clear your own checked items (trainer suggestions are never deleted here).
      if (request.method === "DELETE" && segments.length === 3 && segments[2] === "checked") {
        await db
          .prepare("DELETE FROM grocery_list WHERE client_id = ? AND checked = 1 AND added_by_role = 'client'")
          .bind(userEmail)
          .run();
        return jsonResponse({ ok: true });
      }

      // Check / uncheck an item on your list. Checking off a coach suggestion
      // REMOVES it (suggestions change week to week); your own items toggle done.
      if (request.method === "PUT" && segments.length === 4 && segments[3] === "check") {
        const id = Number(segments[2]);
        if (!Number.isFinite(id)) return jsonResponse({ error: "Invalid id" }, 400);
        const body = await parseJson(request);
        const checked = body?.checked ? 1 : 0;
        const row = await db
          .prepare("SELECT added_by_role FROM grocery_list WHERE id = ? AND client_id = ?")
          .bind(id, userEmail)
          .first<{ added_by_role: string }>();
        if (!row) return jsonResponse({ ok: true });
        if (checked && row.added_by_role === "trainer") {
          await db.prepare("DELETE FROM grocery_list WHERE id = ? AND client_id = ?").bind(id, userEmail).run();
          return jsonResponse({ ok: true, removed: true });
        }
        await db
          .prepare("UPDATE grocery_list SET checked = ?, checked_at = CASE WHEN ? = 1 THEN datetime('now') ELSE NULL END WHERE id = ? AND client_id = ?")
          .bind(checked, checked, id, userEmail)
          .run();
        return jsonResponse({ ok: true });
      }

      // Delete one of your OWN items (a client can't delete a trainer's suggestion).
      if (request.method === "DELETE" && segments.length === 3) {
        const id = Number(segments[2]);
        if (!Number.isFinite(id)) return jsonResponse({ error: "Invalid id" }, 400);
        await db
          .prepare("DELETE FROM grocery_list WHERE id = ? AND client_id = ? AND added_by_role = 'client'")
          .bind(id, userEmail)
          .run();
        return jsonResponse({ ok: true });
      }
    }

    // ---- Trainer onboarding ----
    if (segments[1] === "trainer" && segments[2] === "setup" && request.method === "POST") {
      // Only admins or admin-granted trainer-eligible users may create an org.
      if (!isAdmin(userEmail, env)) {
        const elig = await db
          .prepare("SELECT trainer_eligible FROM users WHERE id = ?")
          .bind(userEmail)
          .first<{ trainer_eligible: number | null }>();
        if (!elig?.trainer_eligible) {
          return jsonResponse({ error: "Not authorized to create a coaching profile" }, 403);
        }
      }

      const body = await parseJson(request);
      const orgName = (body?.org_name ?? "").toString().trim().slice(0, 80);
      if (!orgName) return jsonResponse({ error: "Organization name required" }, 400);

      const existing = await db
        .prepare("SELECT id FROM organizations WHERE owner_id = ?")
        .bind(userEmail)
        .first();
      if (existing) return jsonResponse({ error: "You already have an organization" }, 409);

      const orgId = crypto.randomUUID();
      await db
        .prepare("INSERT INTO organizations (id, name, owner_id) VALUES (?, ?, ?)")
        .bind(orgId, orgName, userEmail)
        .run();
      await db
        .prepare("INSERT INTO users (id, role) VALUES (?, 'trainer') ON CONFLICT(id) DO UPDATE SET role = 'trainer'")
        .bind(userEmail)
        .run();

      return jsonResponse({ org_id: orgId, org_name: orgName });
    }

    // ---- Trainer: create a client invite ----
    if (segments[1] === "trainer" && segments[2] === "invite" && request.method === "POST") {
      const org = await db
        .prepare("SELECT id FROM organizations WHERE owner_id = ?")
        .bind(userEmail)
        .first<{ id: string }>();
      if (!org) return jsonResponse({ error: "Not a trainer" }, 403);

      const body = await parseJson(request);
      const email = (body?.email ?? "").toString().trim().toLowerCase();
      if (!email || !email.includes("@")) {
        return jsonResponse({ error: "Valid email required" }, 400);
      }

      const token = crypto.randomUUID();
      await db
        .prepare(
          `INSERT INTO invites (id, org_id, trainer_id, email, status, expires_at)
           VALUES (?, ?, ?, ?, 'pending', datetime('now', '+7 days'))`
        )
        .bind(token, org.id, userEmail, email)
        .run();

      return jsonResponse({
        invite_id: token,
        invite_url: `https://krufit.uk/join?token=${token}`,
      });
    }

    // ---- Client: accept an invite ----
    if (
      segments[1] === "invite" && segments.length === 4 &&
      segments[3] === "accept" && request.method === "POST"
    ) {
      const token = segments[2];
      const invite = await db
        .prepare(
          `SELECT org_id, email FROM invites
           WHERE id = ? AND status = 'pending' AND expires_at > datetime('now')`
        )
        .bind(token)
        .first<{ org_id: string; email: string }>();
      if (!invite) return jsonResponse({ error: "Invite invalid or expired" }, 404);

      // Hard binding: only the invited email may accept. A forwarded link cannot
      // link the wrong account to this trainer.
      if (userEmail.toLowerCase() !== invite.email.toLowerCase()) {
        return jsonResponse({ error: "This invite was sent to a different email." }, 403);
      }

      await db
        .prepare(
          `INSERT INTO memberships (user_id, org_id, role, status, invited_at, accepted_at)
           VALUES (?, ?, 'client', 'active', datetime('now'), datetime('now'))
           ON CONFLICT(user_id, org_id) DO UPDATE SET
             role = 'client', status = 'active', accepted_at = datetime('now')`
        )
        .bind(userEmail, invite.org_id)
        .run();
      await db
        .prepare("INSERT INTO users (id, role) VALUES (?, 'client') ON CONFLICT(id) DO UPDATE SET role = 'client'")
        .bind(userEmail)
        .run();
      await db
        .prepare("UPDATE invites SET status = 'accepted' WHERE id = ?")
        .bind(token)
        .run();

      return jsonResponse(await mePayload(db, env, userEmail));
    }

    // ---- Trainer: client roster (single GROUP BY join, today's totals per client) ----
    if (
      segments[1] === "trainer" && segments[2] === "clients" &&
      segments.length === 3 && request.method === "GET"
    ) {
      const org = await db
        .prepare("SELECT id FROM organizations WHERE owner_id = ?")
        .bind(userEmail)
        .first<{ id: string }>();
      if (!org) return jsonResponse({ error: "Not a trainer" }, 403);

      // "Today" = the trainer's local date (passed by the client) so the roster and
      // the client-detail modal agree; falls back to server UTC if not supplied.
      const today = (url.searchParams.get("date") || new Date().toISOString().slice(0, 10)).slice(0, 10);
      const rows = ((await db
        .prepare(
          `SELECT
             m.user_id AS user_id,
             m.status  AS status,
             u.name    AS name,
             COALESCE(SUM(f.cal), 0)     AS cal,
             COALESCE(SUM(f.protein), 0) AS protein,
             COALESCE(SUM(f.carbs), 0)   AS carbs,
             COALESCE(SUM(f.fat), 0)     AS fat,
             COUNT(f.id)                 AS entry_count,
             MAX(f.ts)                   AS last_logged_at,
             g.cal     AS goal_cal,
             g.protein AS goal_protein,
             g.carbs   AS goal_carbs,
             g.fat     AS goal_fat,
             (SELECT val  FROM weight_log w WHERE w.user_id = m.user_id ORDER BY w.date DESC, w.id DESC LIMIT 1)          AS w_val,
             (SELECT unit FROM weight_log w WHERE w.user_id = m.user_id ORDER BY w.date DESC, w.id DESC LIMIT 1)          AS w_unit,
             (SELECT val  FROM weight_log w WHERE w.user_id = m.user_id ORDER BY w.date DESC, w.id DESC LIMIT 1 OFFSET 1) AS w_prev
           FROM memberships m
           LEFT JOIN users u    ON u.id = m.user_id
           LEFT JOIN goals g    ON g.user_id = m.user_id
           LEFT JOIN food_log f ON f.user_id = m.user_id AND f.date = ?
           WHERE m.org_id = ? AND m.role = 'client' AND m.status = 'active'
           GROUP BY m.user_id, m.status, u.name, g.cal, g.protein, g.carbs, g.fat
           ORDER BY entry_count DESC, u.name ASC`
        )
        .bind(today, org.id)
        .all()).results || []) as any[];

      const clients = rows.map((r) => ({
        user_id: r.user_id,
        name: r.name || String(r.user_id).split("@")[0],
        status: r.status,
        today: {
          cal: r.cal || 0,
          protein: r.protein || 0,
          carbs: r.carbs || 0,
          fat: r.fat || 0,
          entry_count: r.entry_count || 0,
          last_logged_at: r.last_logged_at || null,
        },
        goals: {
          cal: r.goal_cal ?? 1800,
          protein: r.goal_protein ?? 180,
          carbs: r.goal_carbs ?? 150,
          fat: r.goal_fat ?? 60,
        },
        // Latest weigh-in + trend vs the previous entry (trend null if only one).
        weight: r.w_val == null ? null : {
          val: r.w_val,
          unit: r.w_unit || "lbs",
          trend: r.w_prev == null ? null : Math.round((r.w_val - r.w_prev) * 10) / 10,
        },
      }));

      return jsonResponse(clients);
    }

    // ---- Trainer: full client detail for one day (?date=YYYY-MM-DD) ----
    if (
      segments[1] === "trainer" && segments[2] === "clients" &&
      segments.length === 4 && request.method === "GET"
    ) {
      const orgId = await ownedOrgId(db, userEmail);
      if (!orgId) return jsonResponse({ error: "Not a trainer" }, 403);
      const clientId = decodeURIComponent(segments[3]);
      if (!(await clientInOrg(db, orgId, clientId))) {
        return jsonResponse({ error: "Client not in your roster" }, 403);
      }

      const date = (url.searchParams.get("date") || new Date().toISOString().slice(0, 10)).slice(0, 10);

      const user = await db
        .prepare("SELECT id, name FROM users WHERE id = ?")
        .bind(clientId)
        .first<{ id: string; name: string | null }>();

      const goalsRow = await db
        .prepare("SELECT cal, protein, carbs, fat, fiber, water_oz FROM goals WHERE user_id = ?")
        .bind(clientId)
        .first<any>();
      const goals = goalsRow || { cal: 1800, protein: 180, carbs: 150, fat: 60, fiber: 30, water_oz: 64 };

      const entries = ((await db
        .prepare(
          "SELECT id, name, emoji, cal, protein, carbs, fat, fiber, serving, source, ts FROM food_log WHERE user_id = ? AND date = ? ORDER BY ts ASC, id ASC"
        )
        .bind(clientId, date)
        .all()).results || []) as any[];
      const totals = entries.reduce(
        (t, e) => ({
          cal: t.cal + (e.cal || 0),
          protein: t.protein + (e.protein || 0),
          carbs: t.carbs + (e.carbs || 0),
          fat: t.fat + (e.fat || 0),
        }),
        { cal: 0, protein: 0, carbs: 0, fat: 0 }
      );

      const log7d = ((await db
        .prepare(
          `SELECT date, SUM(cal) AS cal, SUM(protein) AS protein, SUM(carbs) AS carbs, SUM(fat) AS fat
           FROM food_log WHERE user_id = ? AND date >= date(?, '-6 days') AND date <= ?
           GROUP BY date ORDER BY date ASC`
        )
        .bind(clientId, date, date)
        .all()).results || []) as any[];

      const weight30d = (((await db
        .prepare("SELECT date, val, unit FROM weight_log WHERE user_id = ? ORDER BY date DESC LIMIT 30")
        .bind(clientId)
        .all()).results || []) as any[]).reverse();

      const coachNotes = ((await db
        .prepare("SELECT id, date, note, created_at FROM coach_notes WHERE org_id = ? AND client_id = ? ORDER BY date DESC")
        .bind(orgId, clientId)
        .all()).results || []) as any[];

      const groceryRows = ((await db
        .prepare("SELECT id, item, note, added_by_role, checked, checked_at FROM grocery_list WHERE client_id = ? ORDER BY created_at ASC")
        .bind(clientId)
        .all()).results || []) as any[];
      const grocery = {
        trainer_items: groceryRows.filter((g) => !g.checked && g.added_by_role === "trainer"),
        client_items: groceryRows.filter((g) => !g.checked && g.added_by_role === "client"),
        checked_items: groceryRows.filter((g) => g.checked),
      };

      return jsonResponse({
        user: { id: user?.id || clientId, name: user?.name || null },
        goals,
        today: { entries, totals },
        log_7d: log7d,
        weight_30d: weight30d,
        coach_notes: coachNotes,
        grocery,
      });
    }

    // ---- Trainer: upsert a coach note (empty note clears it) ----
    if (segments[1] === "trainer" && segments[2] === "notes" && segments.length === 3 && request.method === "POST") {
      const orgId = await ownedOrgId(db, userEmail);
      if (!orgId) return jsonResponse({ error: "Not a trainer" }, 403);
      const body = await parseJson(request);
      const clientId = (body?.client_id ?? "").toString().trim();
      const date = (body?.date ?? "").toString().trim().slice(0, 10);
      const note = (body?.note ?? "").toString().trim().slice(0, 2000);
      if (!clientId || !date) return jsonResponse({ error: "client_id and date required" }, 400);
      if (!(await clientInOrg(db, orgId, clientId))) return jsonResponse({ error: "Client not in your roster" }, 403);

      if (!note) {
        await db
          .prepare("DELETE FROM coach_notes WHERE org_id = ? AND client_id = ? AND date = ?")
          .bind(orgId, clientId, date)
          .run();
        return jsonResponse({ ok: true, cleared: true });
      }
      await db
        .prepare(
          `INSERT INTO coach_notes (org_id, client_id, trainer_id, date, note)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(client_id, date, org_id) DO UPDATE SET
             note = excluded.note, trainer_id = excluded.trainer_id, updated_at = datetime('now')`
        )
        .bind(orgId, clientId, userEmail, date, note)
        .run();
      return jsonResponse({ ok: true });
    }

    // ---- Trainer: add a grocery suggestion for a client ----
    if (segments[1] === "trainer" && segments[2] === "grocery" && segments.length === 3 && request.method === "POST") {
      const orgId = await ownedOrgId(db, userEmail);
      if (!orgId) return jsonResponse({ error: "Not a trainer" }, 403);
      const body = await parseJson(request);
      const clientId = (body?.client_id ?? "").toString().trim();
      const item = (body?.item ?? "").toString().trim().slice(0, 120);
      const note = body?.note ? body.note.toString().trim().slice(0, 200) : null;
      if (!clientId || !item) return jsonResponse({ error: "client_id and item required" }, 400);
      if (!(await clientInOrg(db, orgId, clientId))) return jsonResponse({ error: "Client not in your roster" }, 403);
      await db
        .prepare(
          `INSERT INTO grocery_list (org_id, client_id, added_by, added_by_role, item, note)
           VALUES (?, ?, ?, 'trainer', ?, ?)`
        )
        .bind(orgId, clientId, userEmail, item, note)
        .run();
      return jsonResponse({ ok: true });
    }

    // ---- Trainer: remove a grocery item (only their own suggestions) ----
    if (segments[1] === "trainer" && segments[2] === "grocery" && segments.length === 4 && request.method === "DELETE") {
      const orgId = await ownedOrgId(db, userEmail);
      if (!orgId) return jsonResponse({ error: "Not a trainer" }, 403);
      const id = Number(segments[3]);
      if (!Number.isFinite(id)) return jsonResponse({ error: "Invalid id" }, 400);
      await db
        .prepare("DELETE FROM grocery_list WHERE id = ? AND org_id = ? AND added_by_role = 'trainer'")
        .bind(id, orgId)
        .run();
      return jsonResponse({ ok: true });
    }

    // ---- Trainer: list pending invites ----
    if (segments[1] === "trainer" && segments[2] === "invites" && segments.length === 3 && request.method === "GET") {
      const orgId = await ownedOrgId(db, userEmail);
      if (!orgId) return jsonResponse({ error: "Not a trainer" }, 403);
      const rows = ((await db
        .prepare(
          `SELECT id, email, status, created_at, expires_at FROM invites
           WHERE org_id = ? AND status = 'pending' AND expires_at > datetime('now')
           ORDER BY created_at DESC`
        )
        .bind(orgId)
        .all()).results || []) as any[];
      return jsonResponse(rows);
    }

    // ---- Trainer: cancel a pending invite ----
    if (segments[1] === "trainer" && segments[2] === "invites" && segments.length === 4 && request.method === "DELETE") {
      const orgId = await ownedOrgId(db, userEmail);
      if (!orgId) return jsonResponse({ error: "Not a trainer" }, 403);
      await db
        .prepare("DELETE FROM invites WHERE id = ? AND org_id = ?")
        .bind(segments[3], orgId)
        .run();
      return jsonResponse({ ok: true });
    }

    return jsonResponse({ error: "Not found" }, 404);
  },
};

type Env = {
  DB: D1Database;
  ANTHROPIC_API_KEY?: string;
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
  ADMIN_EMAILS?: string;
};

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

const NUTRITION_SYSTEM_PROMPT = `You are a nutrition analysis assistant. Given a food as either a photo or a written description of the dish and its ingredients, identify it and estimate its nutritional content. Always respond ONLY with valid JSON, no markdown, no extra text. Use this exact structure:
{
  "name": "Food name",
  "emoji": "single relevant emoji",
  "calories": number,
  "protein_g": number,
  "carbs_g": number,
  "fiber_g": number,
  "fat_g": number,
  "serving_note": "brief note about the serving size assumed",
  "confidence": "high|medium|low"
}
Be realistic with estimates. If multiple items are present, estimate the total. If you cannot identify the food, set name to "Unknown food" with zeroes and confidence "low".`;

const COACH_SYSTEM_PROMPT = `You are a practical, encouraging nutrition coach. You receive a JSON summary of someone's recent eating: their daily averages, their goals, and their most-eaten foods. Identify the most important takeaways and respond ONLY with valid JSON (no markdown), in this exact shape:
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

    const userEmail = await authenticate(request, env);
    if (!userEmail) {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }

    const url = new URL(request.url);
    const segments = getPathSegments(url);
    const db = env.DB;

    if (segments.length === 2 && segments[0] === "api" && segments[1] === "me" && request.method === "GET") {
      const name = userEmail.split("@")[0] || userEmail;
      await db.prepare(
        `INSERT INTO users (id, name) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET name = excluded.name`
      ).bind(userEmail, name).run();

      return jsonResponse({ email: userEmail, name });
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

      const aiResp = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": env.ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-6",
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
      const data = (await aiResp.json()) as { content?: Array<{ text?: string }> };
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
          model: "claude-sonnet-4-6",
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
      const data = (await aiResp.json()) as { content?: Array<{ text?: string }> };
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
            `INSERT INTO food_log (user_id, date, name, emoji, cal, protein, carbs, fat, fiber, source, ts)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
            `UPDATE food_log SET name = ?, emoji = ?, cal = ?, protein = ?, carbs = ?, fat = ?, fiber = ?
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
            `INSERT INTO custom_foods (user_id, name, emoji, cal, protein, carbs, fat, fiber, serving, ingredients, recipe_items, servings)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
            `UPDATE custom_foods SET name = ?, emoji = ?, cal = ?, protein = ?, carbs = ?, fat = ?, fiber = ?, serving = ?, ingredients = ?, recipe_items = ?, servings = ?
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

    if (segments[1] === "goals") {
      if (request.method === "GET") {
        const { results } = await db
          .prepare("SELECT * FROM goals WHERE user_id = ?")
          .bind(userEmail)
          .all();
        if (results?.length) {
          return jsonResponse(results[0]);
        }
        return jsonResponse({
          user_id: userEmail,
          cal: 1800,
          protein: 180,
          carbs: 150,
          fat: 60,
          fiber: 30,
          water_oz: 64,
          diet: "none",
          restrictions: "",
        });
      }

      if (request.method === "POST") {
        const body = await parseJson(request);
        if (body == null) {
          return jsonResponse({ error: "Invalid JSON" }, 400);
        }

        await db
          .prepare(
            `INSERT INTO goals (user_id, cal, protein, carbs, fat, fiber, water_oz, diet, restrictions, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
             ON CONFLICT(user_id) DO UPDATE SET
               cal = excluded.cal,
               protein = excluded.protein,
               carbs = excluded.carbs,
               fat = excluded.fat,
               fiber = excluded.fiber,
               water_oz = excluded.water_oz,
               diet = excluded.diet,
               restrictions = excluded.restrictions,
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
            body.diet || "none",
            body.restrictions || ""
          )
          .run();
        return jsonResponse({ user_id: userEmail, cal: body.cal ?? 1800, protein: body.protein ?? 180, carbs: body.carbs ?? 150, fat: body.fat ?? 60, fiber: body.fiber ?? 30, water_oz: body.water_oz ?? 64, diet: body.diet || "none", restrictions: body.restrictions || "" });
      }
    }

    return jsonResponse({ error: "Not found" }, 404);
  },
};

type Env = {
  DB: D1Database;
  ANTHROPIC_API_KEY?: string;
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
};

/* ============================================================
   KICKS ON DECK — first-party data API (Cloudflare Worker + D1)
   ------------------------------------------------------------
   Captures the owned audience signals the storefront collects:
     POST /subscribe  { email, interest, size, source }   -> signups
     POST /vote       { choice }                            -> votes
     POST /quiz       { answers[], coll, reflective, recommended } -> quiz
     GET  /stats                                            -> { votes: { id: count } }  (public, aggregate only)
     GET  /export.csv?token=…                               -> email list CSV (token-gated)

   Binding required: env.DB (a Cloudflare D1 database — see schema.sql + README).
   CORS is locked to the store origins.
   ============================================================ */

const ALLOWED_ORIGINS = new Set([
  "https://kicksondeck.store",
  "https://www.kicksondeck.store",
]);

function corsHeaders(origin) {
  const h = {
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    Vary: "Origin",
  };
  if (ALLOWED_ORIGINS.has(origin)) h["Access-Control-Allow-Origin"] = origin;
  return h;
}
const json = (obj, status, headers) =>
  new Response(JSON.stringify(obj), { status, headers: { ...headers, "Content-Type": "application/json" } });

const clean = (v, max = 200) => (v == null ? "" : String(v).slice(0, max));
const validEmail = (e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e);

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const headers = corsHeaders(origin);
    const url = new URL(request.url);
    const route = url.pathname.replace(/\/+$/, "") || "/";

    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
    if (!env.DB) return json({ error: "Database not bound" }, 500, headers);

    // ---- public aggregate stats (for the live vote widget) ----
    if (request.method === "GET" && route === "/stats") {
      try {
        const { results } = await env.DB.prepare("SELECT choice, COUNT(*) AS n FROM votes GROUP BY choice").all();
        const votes = {};
        for (const r of results || []) votes[r.choice] = r.n;
        return json({ votes }, 200, headers);
      } catch (e) { return json({ error: "stats failed" }, 500, headers); }
    }

    // ---- token-gated CSV export of the owned email list ----
    if (request.method === "GET" && route === "/export.csv") {
      if (!env.EXPORT_TOKEN || url.searchParams.get("token") !== env.EXPORT_TOKEN) {
        return json({ error: "Forbidden" }, 403, headers);
      }
      const { results } = await env.DB.prepare(
        "SELECT email, interest, size, source, created_at FROM signups ORDER BY created_at DESC"
      ).all();
      const esc = (s) => `"${String(s == null ? "" : s).replace(/"/g, '""')}"`;
      const rows = ["email,interest,size,source,created_at"].concat(
        (results || []).map((r) => [r.email, r.interest, r.size, r.source, r.created_at].map(esc).join(","))
      );
      return new Response(rows.join("\n"), {
        status: 200,
        headers: { ...headers, "Content-Type": "text/csv", "Content-Disposition": "attachment; filename=kod-signups.csv" },
      });
    }

    // ---- writes ----
    if (request.method !== "POST") return json({ error: "Not found" }, 404, headers);
    if (!ALLOWED_ORIGINS.has(origin)) return json({ error: "Forbidden origin" }, 403, headers);

    let body;
    try { body = await request.json(); } catch { return json({ error: "Bad JSON" }, 400, headers); }

    try {
      if (route === "/subscribe") {
        const email = clean(body.email, 254).toLowerCase().trim();
        if (!validEmail(email)) return json({ error: "Invalid email" }, 400, headers);
        await env.DB.prepare(
          "INSERT INTO signups (email, interest, size, source) VALUES (?, ?, ?, ?) " +
          "ON CONFLICT(email) DO UPDATE SET interest=excluded.interest, size=excluded.size, source=excluded.source"
        ).bind(email, clean(body.interest, 40), clean(body.size, 20), clean(body.source, 120)).run();
        return json({ ok: true }, 200, headers);
      }

      if (route === "/vote") {
        const choice = clean(body.choice, 60);
        if (!choice) return json({ error: "Missing choice" }, 400, headers);
        await env.DB.prepare("INSERT INTO votes (choice) VALUES (?)").bind(choice).run();
        const { results } = await env.DB.prepare("SELECT choice, COUNT(*) AS n FROM votes GROUP BY choice").all();
        const votes = {};
        for (const r of results || []) votes[r.choice] = r.n;
        return json({ ok: true, votes }, 200, headers);
      }

      if (route === "/quiz") {
        const answers = Array.isArray(body.answers) ? body.answers.map((a) => clean(a, 80)).join(" | ") : clean(body.answers, 240);
        await env.DB.prepare(
          "INSERT INTO quiz (answers, coll, reflective, recommended) VALUES (?, ?, ?, ?)"
        ).bind(answers, clean(body.coll, 40), body.reflective ? 1 : 0, clean(body.recommended, 120)).run();
        return json({ ok: true }, 200, headers);
      }
    } catch (e) {
      return json({ error: "Write failed" }, 500, headers);
    }

    return json({ error: "Not found" }, 404, headers);
  },
};

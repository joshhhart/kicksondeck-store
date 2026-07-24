/* ============================================================
   KICKS ON DECK — Stripe Checkout endpoint (Cloudflare Worker)
   ------------------------------------------------------------
   POST /checkout
     body: { items: [{ variantId, id, qty, name, size, image }] }
     -> 200 { url }   Stripe-hosted Checkout Session URL

   The browser never sees the Stripe secret key — it lives only in
   this Worker (env.STRIPE_SECRET_KEY). Unit prices are ALWAYS read
   from the published catalog (data/products.json on the live site),
   never trusted from the request, so a tampered cart can't change
   what a customer is charged.
   ============================================================ */

const CATALOG_URL = "https://kicksondeck.store/data/products.json";

// Origins allowed to call this endpoint (CORS).
const ALLOWED_ORIGINS = new Set([
  "https://kicksondeck.store",
  "https://www.kicksondeck.store",
]);

const SUCCESS_URL = "https://kicksondeck.store/?checkout=success&session_id={CHECKOUT_SESSION_ID}";
const CANCEL_URL = "https://kicksondeck.store/?checkout=cancel";

// Tiny in-isolate cache for the catalog (5 min) to avoid refetching per request.
let catalogCache = null;
let catalogAt = 0;

async function loadVariantMap() {
  const now = Date.now();
  if (catalogCache && now - catalogAt < 5 * 60 * 1000) return catalogCache;
  const res = await fetch(CATALOG_URL, { cf: { cacheTtl: 300 } });
  if (!res.ok) throw new Error("catalog fetch failed: " + res.status);
  const data = await res.json();
  const map = new Map();
  for (const p of data.products || []) {
    for (const v of p.variants || []) {
      map.set(v.id, { amount: v.amount, currency: v.currency || "USD", productName: p.name });
    }
    // Fallback: index by product id -> first variant (single-variant products).
    if (p.variants && p.variants[0]) {
      map.set(p.id, { amount: p.variants[0].amount, currency: p.variants[0].currency || "USD", productName: p.name });
    }
  }
  catalogCache = map;
  catalogAt = now;
  return map;
}

function corsHeaders(origin) {
  const h = {
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    Vary: "Origin",
  };
  if (ALLOWED_ORIGINS.has(origin)) h["Access-Control-Allow-Origin"] = origin;
  return h;
}

function json(obj, status, headers) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...headers, "Content-Type": "application/json" },
  });
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const headers = corsHeaders(origin);

    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });

    const url = new URL(request.url);
    if (request.method !== "POST" || !url.pathname.endsWith("/checkout")) {
      return json({ error: "Not found" }, 404, headers);
    }
    if (!ALLOWED_ORIGINS.has(origin)) return json({ error: "Forbidden origin" }, 403, headers);
    if (!env.STRIPE_SECRET_KEY) return json({ error: "Stripe key not configured" }, 500, headers);

    let body;
    try { body = await request.json(); } catch { return json({ error: "Bad JSON" }, 400, headers); }
    const items = Array.isArray(body.items) ? body.items : [];
    if (!items.length) return json({ error: "Cart is empty" }, 400, headers);

    let variants;
    try { variants = await loadVariantMap(); } catch { return json({ error: "Catalog unavailable" }, 502, headers); }

    const form = new URLSearchParams();
    form.set("mode", "payment");
    form.set("success_url", SUCCESS_URL);
    form.set("cancel_url", CANCEL_URL);
    // No payment_method_types restriction: Stripe's dynamic payment methods
    // surface Apple Pay / Google Pay / Link / BNPL per the Dashboard config.
    form.set("allow_promotion_codes", "true");
    form.set("phone_number_collection[enabled]", "true");
    form.set("billing_address_collection", "auto");
    form.append("shipping_address_collection[allowed_countries][]", "US");
    form.append("shipping_address_collection[allowed_countries][]", "CA");
    // Show shipping explicitly as $0 so the total is never a surprise.
    form.set("shipping_options[0][shipping_rate_data][display_name]", "Free shipping (US & Canada)");
    form.set("shipping_options[0][shipping_rate_data][type]", "fixed_amount");
    form.set("shipping_options[0][shipping_rate_data][fixed_amount][amount]", "0");
    form.set("shipping_options[0][shipping_rate_data][fixed_amount][currency]", "usd");

    let i = 0;
    for (const it of items) {
      const key = it.variantId || it.id;
      const ref = variants.get(key) || (it.id ? variants.get(it.id) : null);
      if (!ref) return json({ error: "Unknown item: " + (key || "?") }, 400, headers);

      const qty = Math.max(1, Math.min(20, parseInt(it.qty, 10) || 1));
      const unit = Math.round(Number(ref.amount) * 100); // dollars -> cents
      if (!Number.isFinite(unit) || unit <= 0) return json({ error: "Bad price for item" }, 400, headers);

      // Display fields (name/size/image) are cosmetic only — price is server-side.
      const name = String(it.name || ref.productName || "Item").slice(0, 120);
      const size = it.size ? String(it.size).slice(0, 120) : "";

      form.set(`line_items[${i}][price_data][currency]`, String(ref.currency || "USD").toLowerCase());
      form.set(`line_items[${i}][price_data][unit_amount]`, String(unit));
      form.set(`line_items[${i}][price_data][product_data][name]`, name);
      if (size) form.set(`line_items[${i}][price_data][product_data][description]`, size);
      if (it.image && /^https:\/\//.test(it.image)) {
        form.append(`line_items[${i}][price_data][product_data][images][]`, String(it.image).slice(0, 400));
      }
      form.set(`line_items[${i}][quantity]`, String(qty));
      i++;
    }

    const sres = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + env.STRIPE_SECRET_KEY,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: form,
    });
    const sdata = await sres.json().catch(() => ({}));
    if (!sres.ok) {
      return json({ error: (sdata.error && sdata.error.message) || "Stripe error" }, 502, headers);
    }
    return json({ url: sdata.url, id: sdata.id }, 200, headers);
  },
};

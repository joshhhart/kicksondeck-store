/* ============================================================
   KICKS ON DECK — Stripe Checkout endpoint (Cloudflare Worker)
   ------------------------------------------------------------
   POST /checkout
     body: { items: [{ variantId, id, qty, name, size, image }],
             ref, attribution: { first, last, visits, page } }
     -> 200 { url }   Stripe-hosted Checkout Session URL

   POST /webhook   (Stripe -> here, signed with STRIPE_WEBHOOK_SECRET)
     checkout.session.completed / checkout.session.async_payment_succeeded
     -> builds a clean order record and hands it to fulfillment:
        * GoHighLevel: upsert the buyer as a contact, tag it, attach the
          full order + attribution as a note (env.GHL_PIT + env.GHL_LOCATION_ID)
        * any JSON endpoint (env.ORDER_WEBHOOK_URL) — a GHL "Inbound Webhook"
          workflow trigger, Zapier/Make/Composio, a Slack hook, a supplier API…

   The browser never sees the Stripe secret key — it lives only in
   this Worker (env.STRIPE_SECRET_KEY). Unit prices are ALWAYS read
   from the published catalog (data/products.json on the live site),
   never trusted from the request, so a tampered cart can't change
   what a customer is charged.

   Attribution: the storefront remembers the first click that ever
   brought the browser to the site and the click that started the
   current visit (utm_*, gclid, srsltid, fbclid, ttclid, referrer,
   landing page). Both are stamped on the Checkout Session AND the
   PaymentIntent as metadata, so every paid order in the Stripe
   dashboard answers "how did they find us" on its own.
   ============================================================ */

const CATALOG_URL = "https://kicksondeck.store/data/products.json";
const SITE = "kicksondeck.store";

// Origins allowed to call /checkout (CORS).
const ALLOWED_ORIGINS = new Set([
  "https://kicksondeck.store",
  "https://www.kicksondeck.store",
]);

const SUCCESS_URL = "https://kicksondeck.store/?checkout=success&session_id={CHECKOUT_SESSION_ID}";
const CANCEL_URL = "https://kicksondeck.store/?checkout=cancel";

const STRIPE_API = "https://api.stripe.com/v1";
const GHL_API = "https://services.leadconnectorhq.com";
const GHL_VERSION = "2021-07-28";

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
      map.set(v.id, { amount: v.amount, currency: v.currency || "USD", productName: p.name, productId: p.id, slug: p.slug || "", size: v.size || "" });
    }
    // Fallback: index by product id -> first variant (single-variant products).
    if (p.variants && p.variants[0]) {
      map.set(p.id, { amount: p.variants[0].amount, currency: p.variants[0].currency || "USD", productName: p.name, productId: p.id, slug: p.slug || "", size: p.variants[0].size || "" });
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

/* ---------- attribution -> Stripe metadata ----------
   Stripe metadata limits: 50 keys, key <= 40 chars, value <= 500 chars.
   Only whitelisted fields from the browser make it through, each clipped. */
const TOUCH_FIELDS = ["source", "medium", "campaign", "term", "content", "ref", "gclid", "srsltid", "fbclid", "ttclid", "referrer", "landing", "at"];
const clip = (v, max) => (v == null ? "" : String(v).replace(/[\r\n\t]+/g, " ").trim().slice(0, max));

function attributionMetadata(attr, ref, items) {
  const md = {};
  md.site = SITE;
  md.order_ref = clip(ref, 40) || ("kod-" + Date.now().toString(36));
  md.item_count = String(items.reduce((n, it) => n + it.qty, 0));
  // "Onyx YZ Foam RNNR | US 9 | x1 | 674d…"; the variant id is what the
  // supplier / GHL product actually needs, the name is for humans.
  md.items = clip(items.map((it) => `${it.name} | ${it.size || "one size"} | x${it.qty} | ${it.variantId}`).join(" ; "), 500);
  md.item_variant_ids = clip(items.map((it) => it.variantId).join(","), 500);
  if (attr && typeof attr === "object") {
    for (const which of ["first", "last"]) {
      const t = attr[which];
      if (!t || typeof t !== "object") continue;
      for (const k of TOUCH_FIELDS) {
        const v = clip(t[k], k === "referrer" || k === "landing" ? 300 : 200);
        if (v) md[`${which}_${k}`] = v;
      }
    }
    if (Number.isFinite(Number(attr.visits))) md.visits = String(Math.min(9999, Math.max(0, parseInt(attr.visits, 10) || 0)));
    const page = clip(attr.page, 200);
    if (page) md.checkout_page = page;
  }
  // Hard cap on key count (Stripe rejects > 50).
  return Object.fromEntries(Object.entries(md).slice(0, 50));
}

/* ---------- Stripe webhook signature (WebCrypto, no SDK) ---------- */
async function verifyStripeSignature(rawBody, header, secret, toleranceSec = 300) {
  if (!header || !secret) return false;
  const parts = header.split(",").map((p) => p.trim().split("="));
  const t = parts.find((p) => p[0] === "t")?.[1];
  const sigs = parts.filter((p) => p[0] === "v1").map((p) => p[1]);
  if (!t || !sigs.length) return false;
  if (Math.abs(Date.now() / 1000 - Number(t)) > toleranceSec) return false;
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", key, enc.encode(`${t}.${rawBody}`));
  const expected = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return sigs.some((s) => s.length === expected.length && timingSafeEqual(s, expected));
}
function timingSafeEqual(a, b) {
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

async function stripeGet(path, key) {
  const res = await fetch(STRIPE_API + path, { headers: { Authorization: "Bearer " + key } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error("stripe " + path + " -> " + res.status + " " + (data.error && data.error.message || ""));
  return data;
}

/* ---------- order record (what fulfillment actually needs) ---------- */
async function buildOrder(session, env) {
  const li = await stripeGet(`/checkout/sessions/${session.id}/line_items?limit=100&expand[]=data.price.product`, env.STRIPE_SECRET_KEY);
  const items = (li.data || []).map((l) => ({
    name: l.description || (l.price && l.price.product && l.price.product.name) || "Item",
    size: (l.price && l.price.product && (l.price.product.metadata?.size || l.price.product.description)) || "",
    qty: l.quantity || 1,
    unit: (l.price && l.price.unit_amount || 0) / 100,
    total: (l.amount_total || 0) / 100,
    variant_id: l.price?.product?.metadata?.variant_id || "",
    product_id: l.price?.product?.metadata?.product_id || "",
    slug: l.price?.product?.metadata?.slug || "",
  }));
  const cd = session.customer_details || {};
  const ship = session.shipping_details || session.collected_information?.shipping_details || {};
  const md = session.metadata || {};
  const touch = (p) => ({
    source: md[`${p}_source`] || "", medium: md[`${p}_medium`] || "", campaign: md[`${p}_campaign`] || "",
    term: md[`${p}_term`] || "", content: md[`${p}_content`] || "", ref: md[`${p}_ref`] || "",
    gclid: md[`${p}_gclid`] || "", srsltid: md[`${p}_srsltid`] || "", fbclid: md[`${p}_fbclid`] || "", ttclid: md[`${p}_ttclid`] || "",
    referrer: md[`${p}_referrer`] || "", landing: md[`${p}_landing`] || "", at: md[`${p}_at`] || "",
  });
  return {
    ref: session.client_reference_id || md.order_ref || session.id,
    session_id: session.id,
    payment_intent: typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id || "",
    customer_id: typeof session.customer === "string" ? session.customer : session.customer?.id || "",
    paid_at: new Date((session.created || Date.now() / 1000) * 1000).toISOString(),
    payment_status: session.payment_status,
    currency: (session.currency || "usd").toUpperCase(),
    subtotal: (session.amount_subtotal || 0) / 100,
    discount: (session.total_details?.amount_discount || 0) / 100,
    shipping_cost: (session.total_details?.amount_shipping || 0) / 100,
    total: (session.amount_total || 0) / 100,
    promo_code: session.discounts?.[0]?.promotion_code || "",
    customer: { email: cd.email || "", name: cd.name || "", phone: cd.phone || "" },
    shipping: {
      name: ship.name || cd.name || "",
      line1: ship.address?.line1 || "", line2: ship.address?.line2 || "", city: ship.address?.city || "",
      state: ship.address?.state || "", postal_code: ship.address?.postal_code || "", country: ship.address?.country || "",
    },
    items,
    attribution: { first: touch("first"), last: touch("last"), visits: md.visits || "", checkout_page: md.checkout_page || "" },
    stripe_url: `https://dashboard.stripe.com/payments/${typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id || ""}`,
  };
}

function orderNote(o) {
  const a = o.attribution;
  const t = (x) => [x.source && `${x.source} / ${x.medium || ""}`, x.campaign && `campaign ${x.campaign}`, x.landing && `landed ${x.landing}`, x.referrer && `from ${x.referrer}`, (x.gclid || x.srsltid || x.fbclid || x.ttclid) && `click id ${x.gclid || x.srsltid || x.fbclid || x.ttclid}`, x.at && `at ${x.at}`].filter(Boolean).join(" · ");
  return [
    `KICKS ON DECK ORDER ${o.ref}  (${o.currency} ${o.total.toFixed(2)}, paid ${o.paid_at})`,
    ``,
    `ITEMS`,
    ...o.items.map((it) => `  ${it.qty} x ${it.name} — ${it.size || "one size"} — $${it.unit.toFixed(2)} each  [variant ${it.variant_id || "?"}]`),
    ``,
    `SHIP TO`,
    `  ${o.shipping.name}`,
    `  ${o.shipping.line1}${o.shipping.line2 ? ", " + o.shipping.line2 : ""}`,
    `  ${o.shipping.city}, ${o.shipping.state} ${o.shipping.postal_code} ${o.shipping.country}`,
    `  ${o.customer.email}  ${o.customer.phone}`,
    ``,
    `MONEY  subtotal $${o.subtotal.toFixed(2)} · discount $${o.discount.toFixed(2)}${o.promo_code ? " (" + o.promo_code + ")" : ""} · shipping $${o.shipping_cost.toFixed(2)} · total $${o.total.toFixed(2)}`,
    `STRIPE  ${o.stripe_url}  (session ${o.session_id})`,
    ``,
    `ATTRIBUTION`,
    `  first touch: ${t(a.first) || "unknown"}`,
    `  last touch:  ${t(a.last) || "unknown"}`,
    `  visits before buying: ${a.visits || "?"} · checked out from ${a.checkout_page || "?"}`,
  ].join("\n");
}

/* ---------- fulfillment hand-offs ---------- */
async function pushToGHL(order, env) {
  const headers = { Authorization: "Bearer " + env.GHL_PIT, Version: GHL_VERSION, "Content-Type": "application/json", Accept: "application/json" };
  const [firstName, ...rest] = (order.shipping.name || order.customer.name || "").split(" ");
  const tags = ["kod-customer", "kod-order-paid", ...(env.GHL_ORDER_TAG ? [env.GHL_ORDER_TAG] : [])];
  const body = {
    locationId: env.GHL_LOCATION_ID,
    email: order.customer.email || undefined,
    phone: order.customer.phone || undefined,
    firstName: firstName || undefined,
    lastName: rest.join(" ") || undefined,
    name: order.shipping.name || order.customer.name || undefined,
    address1: order.shipping.line1 || undefined,
    city: order.shipping.city || undefined,
    state: order.shipping.state || undefined,
    postalCode: order.shipping.postal_code || undefined,
    country: order.shipping.country || undefined,
    source: `${SITE} · ${order.attribution.first.source || "direct"}${order.attribution.first.medium ? " / " + order.attribution.first.medium : ""}`,
    tags,
  };
  const up = await fetch(`${GHL_API}/contacts/upsert`, { method: "POST", headers, body: JSON.stringify(body) });
  const upData = await up.json().catch(() => ({}));
  if (!up.ok) throw new Error("GHL upsert " + up.status + " " + JSON.stringify(upData).slice(0, 200));
  const contactId = upData.contact?.id;
  if (!contactId) throw new Error("GHL upsert returned no contact id");
  const note = await fetch(`${GHL_API}/contacts/${contactId}/notes`, {
    method: "POST", headers,
    body: JSON.stringify({ body: orderNote(order), ...(env.GHL_USER_ID ? { userId: env.GHL_USER_ID } : {}) }),
  });
  if (!note.ok) throw new Error("GHL note " + note.status + " " + (await note.text()).slice(0, 200));
  return contactId;
}

async function pushToWebhook(order, env) {
  const res = await fetch(env.ORDER_WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-KOD-Event": "order.paid" },
    body: JSON.stringify({ event: "order.paid", order, note: orderNote(order) }),
  });
  if (!res.ok) throw new Error("order webhook " + res.status);
}

async function handleWebhook(request, env) {
  if (!env.STRIPE_WEBHOOK_SECRET) return json({ error: "Webhook secret not configured" }, 500, {});
  const raw = await request.text();
  const ok = await verifyStripeSignature(raw, request.headers.get("Stripe-Signature"), env.STRIPE_WEBHOOK_SECRET);
  if (!ok) return json({ error: "Bad signature" }, 400, {});
  let event;
  try { event = JSON.parse(raw); } catch { return json({ error: "Bad JSON" }, 400, {}); }

  const type = event.type;
  if (type !== "checkout.session.completed" && type !== "checkout.session.async_payment_succeeded") {
    return json({ received: true, ignored: type }, 200, {});
  }
  const session = event.data && event.data.object;
  // BNPL / bank debits complete the session first and pay later; the
  // async_payment_succeeded event is the one that means money arrived.
  if (!session || session.payment_status !== "paid") return json({ received: true, ignored: "unpaid" }, 200, {});

  const order = await buildOrder(session, env);
  const results = {};
  const failures = [];
  if (env.GHL_PIT && env.GHL_LOCATION_ID) {
    try { results.ghl_contact = await pushToGHL(order, env); } catch (e) { failures.push(String(e.message || e)); }
  }
  if (env.ORDER_WEBHOOK_URL) {
    try { await pushToWebhook(order, env); results.webhook = true; } catch (e) { failures.push(String(e.message || e)); }
  }
  console.log(JSON.stringify({ kod: "order.paid", ref: order.ref, total: order.total, items: order.items.length, results, failures }));
  // A failed hand-off returns 500 so Stripe retries (for up to 3 days) —
  // a duplicated note is cheap, a silently lost order is not.
  if (failures.length) return json({ received: true, order: order.ref, failures }, 500, {});
  return json({ received: true, order: order.ref, results }, 200, {});
}

/* ---------- checkout session ---------- */
async function handleCheckout(request, env, headers) {
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
  // Always create a Stripe Customer so buyers become a retargetable list.
  form.set("customer_creation", "always");
  form.append("shipping_address_collection[allowed_countries][]", "US");
  form.append("shipping_address_collection[allowed_countries][]", "CA");
  // Show shipping explicitly as $0 so the total is never a surprise.
  form.set("shipping_options[0][shipping_rate_data][display_name]", "Free shipping (US & Canada)");
  form.set("shipping_options[0][shipping_rate_data][type]", "fixed_amount");
  form.set("shipping_options[0][shipping_rate_data][fixed_amount][amount]", "0");
  form.set("shipping_options[0][shipping_rate_data][fixed_amount][currency]", "usd");

  const resolved = [];
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
    const size = it.size ? String(it.size).slice(0, 120) : (ref.size || "");
    const variantId = String(key).slice(0, 80);
    resolved.push({ name, size, qty, variantId });

    form.set(`line_items[${i}][price_data][currency]`, String(ref.currency || "USD").toLowerCase());
    form.set(`line_items[${i}][price_data][unit_amount]`, String(unit));
    form.set(`line_items[${i}][price_data][product_data][name]`, name);
    if (size) form.set(`line_items[${i}][price_data][product_data][description]`, size);
    if (it.image && /^https:\/\//.test(it.image)) {
      form.append(`line_items[${i}][price_data][product_data][images][]`, String(it.image).slice(0, 400));
    }
    // Catalog ids ride on the line item so fulfillment never has to guess
    // which variant "Onyx / US 9" was.
    form.set(`line_items[${i}][price_data][product_data][metadata][variant_id]`, variantId);
    if (ref.productId) form.set(`line_items[${i}][price_data][product_data][metadata][product_id]`, String(ref.productId).slice(0, 80));
    if (ref.slug || it.slug) form.set(`line_items[${i}][price_data][product_data][metadata][slug]`, String(ref.slug || it.slug).slice(0, 120));
    if (size) form.set(`line_items[${i}][price_data][product_data][metadata][size]`, size);
    form.set(`line_items[${i}][quantity]`, String(qty));
    i++;
  }

  // Attribution + order ref -> metadata on BOTH the session and the payment,
  // so it shows on the payment page in the Stripe dashboard and in exports.
  const md = attributionMetadata(body.attribution, body.ref, resolved);
  form.set("client_reference_id", md.order_ref);
  for (const [k, v] of Object.entries(md)) {
    form.set(`metadata[${k}]`, v);
    form.set(`payment_intent_data[metadata][${k}]`, v);
  }
  form.set("payment_intent_data[description]", `Kicks on Deck ${md.order_ref}: ${md.items}`.slice(0, 1000));

  const sres = await fetch(STRIPE_API + "/checkout/sessions", {
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
  return json({ url: sdata.url, id: sdata.id, ref: md.order_ref }, 200, headers);
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const headers = corsHeaders(origin);
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "");

    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });

    // Stripe -> us. No browser Origin here, so it sits outside the CORS gate;
    // the signature check is the auth.
    if (request.method === "POST" && path.endsWith("/webhook")) {
      try { return await handleWebhook(request, env); }
      catch (e) { console.error("webhook error", e); return json({ error: "Webhook failed: " + String(e.message || e).slice(0, 200) }, 500, {}); }
    }

    if (request.method !== "POST" || !path.endsWith("/checkout")) {
      return json({ error: "Not found" }, 404, headers);
    }
    if (!ALLOWED_ORIGINS.has(origin)) return json({ error: "Forbidden origin" }, 403, headers);
    return handleCheckout(request, env, headers);
  },
};

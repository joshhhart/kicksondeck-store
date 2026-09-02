# Kicks on Deck — storefront

Premium static storefront for **kicksondeck.store**, hosted on GitHub Pages.
Product catalog is synced from **GoHighLevel** (sub-account `YP10UczRbxhYQCBQK6uE`)
and baked into static JSON + HTML at build time — **the GHL token never ships to the browser.**

Design language: a hybrid of Adidas / Nike / Tesla / Apple / SpaceX — near-black canvas,
electric "volt" accent, wide athletic display type (Archivo Expanded), technical mono
labels (JetBrains Mono), staggered motion.

## Structure

```
index.html                 home
shop/                       all 94 styles (filter + sort)
collection/<slug>/          per-collection grids (350-v2, foam-rnnr, slides, accessories)
product/<slug>/             one static page per product (SEO + JSON-LD)
assets/styles.css           design system
assets/app.js               cart (localStorage), drawer, search, size select, checkout
faq/ shipping/ returns/     trust + policy pages, authored in data/pages/*.md
size-guide/ about/ contact/
privacy/ terms/
data/pages/*.md             markdown source for the pages above ({{TOKENS}} -> site.config.json)
data/products.json          full synced catalog (source of truth for the build)
data/catalog.json           slim index for instant search
scripts/sync-ghl.mjs        GHL -> data/products.json
scripts/build.mjs           data -> static site
scripts/serve.mjs           local preview server
CNAME                       kicksondeck.store
```

## Rebuild after inventory changes

```bash
# 1. pull fresh products + prices from GHL (token via env, never committed)
GHL_PIT=pit-xxxxx GHL_LOCATION_ID=YP10UczRbxhYQCBQK6uE node scripts/sync-ghl.mjs
# 2. regenerate the static site
node scripts/build.mjs
# 3. preview locally
node scripts/serve.mjs   # http://localhost:5050
# 4. ship it
git add -A && git commit -m "Update inventory" && git push
```

## Checkout

Cart + checkout are wired in `assets/app.js` and configured in `site.config.json`.
Today the cart hands off via an email order capture (no sale lost). **To enable real
card checkout:**

1. In GHL → Settings → **Payments**, connect **Stripe**.
2. Publish your GHL **online store** (note its URL, e.g. `https://shop.kicksondeck.store`).
3. Put that URL in `site.config.json` → `checkout.ghlStoreUrl`, keep `mode: "ghl"`, rebuild.

Orders, customers, fulfillment, and shipping then all flow back into GHL.

**What actually runs today:** `mode: "stripe"` through the Cloudflare Worker in
`checkout-worker/`. Every paid order carries its own attribution (first + last
touch, landing page, click ids) as Stripe metadata, and the Worker's `/webhook`
route pushes each paid order into GHL as a tagged contact + order note (and/or
any JSON endpoint) for fulfillment — see `checkout-worker/README.md`.

## Shipping & returns claims — edit in ONE place

Every shipping/returns promise on the site (the policy pages, the PDP delivery
estimate, the marquee, the cart drawer, and the `shippingDetails` +
`hasMerchantReturnPolicy` in Product JSON-LD that Google reads) resolves from
`site.config.json` → `policy`:

```json
"policy": {
  "dispatchHours": 48,       // order -> label out the door
  "transitMinDays": 7,       // business days in transit AFTER dispatch
  "transitMaxDays": 14,
  "returnDays": 7,           // returns window from delivery
  "shipCountries": "United States & Canada"
}
```

Change a number, run `node scripts/build.mjs`, and every surface agrees. Do not
hard-code a delivery time or returns window anywhere else — that is how the site
ended up promising "free shipping over $150" in a blog post while the header
said free on every order.

**These are published promises and Google ingests them as merchant data — keep
them true to what actually happens.**

## Custom domain (Namecheap)

GitHub Pages serves the apex `kicksondeck.store`. In Namecheap → Advanced DNS, set:

| Type  | Host | Value           |
|-------|------|-----------------|
| A     | @    | 185.199.108.153 |
| A     | @    | 185.199.109.153 |
| A     | @    | 185.199.110.153 |
| A     | @    | 185.199.111.153 |
| CNAME | www  | <your-username>.github.io. |

Remove any old Shopify A/CNAME records first. Allow up to a few hours to propagate,
then enable "Enforce HTTPS" in the repo's Pages settings.

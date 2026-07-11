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

<!-- codex env test: github wiring verified -->

# Kicks on Deck — Stripe Checkout Worker

A tiny Cloudflare Worker that turns the on-site cart into a real **Stripe
Checkout Session**. The static site (`kicksondeck.store`) POSTs the cart here;
the Worker validates every price against the published catalog, creates the
Stripe session, and returns the hosted checkout URL the customer is redirected to.

**The Stripe secret key never touches the browser** — it lives only in this
Worker as an encrypted secret. Prices are always read server-side from
`https://kicksondeck.store/data/products.json`, so a tampered cart cannot change
what a customer is charged.

## One-time deploy

You need a free [Cloudflare account](https://dash.cloudflare.com/sign-up) and
Node installed.

```bash
cd checkout-worker

# 1. Log in to Cloudflare
npx wrangler login

# 2. Store your Stripe secret key (from Stripe Dashboard → Developers → API keys)
#    Use a TEST key (sk_test_…) first to verify, then the LIVE key (sk_live_…).
npx wrangler secret put STRIPE_SECRET_KEY
#    (paste the key when prompted)

# 3. Deploy
npx wrangler deploy
```

Wrangler prints the Worker URL, e.g.:

```
https://kod-checkout.your-subdomain.workers.dev
```

## Wire it into the site

1. Open `site.config.json` in the repo root.
2. Set `checkout.endpoint` to the Worker URL from the deploy step:
   ```json
   "checkout": {
     "mode": "stripe",
     "endpoint": "https://kod-checkout.your-subdomain.workers.dev",
     ...
   }
   ```
3. Rebuild and ship:
   ```bash
   node scripts/build.mjs
   git add -A && git commit -m "Enable Stripe checkout endpoint" && git push
   ```

Until `endpoint` is set, the Checkout button falls back to an email order
capture, so no sale is lost.

## How the flow works

1. Customer fills their bag on `kicksondeck.store` (cart lives in `localStorage`).
2. **Checkout** POSTs `{ items: [{ variantId, qty, … }] }` to `…/checkout`.
3. The Worker looks up each variant's real price from the catalog, builds the
   Stripe line items, and creates a Checkout Session.
4. The browser is redirected to Stripe's hosted checkout page (cards, etc.).
5. On success the customer returns to `kicksondeck.store/?checkout=success`,
   where the bag is automatically cleared.

Payouts, receipts, and the customer/payment records all live in your Stripe
dashboard. (Because this charges through Stripe directly, these orders do **not**
flow into GoHighLevel — see the note in the repo's main README.)

## Switching from test to live

Re-run `npx wrangler secret put STRIPE_SECRET_KEY` with your `sk_live_…` key and
`npx wrangler deploy` again. No site rebuild needed — the endpoint URL is the same.

## Custom subdomain (optional)

If you'd rather the endpoint live at `https://api.kicksondeck.store`, add a route
in the Cloudflare dashboard (Workers → your worker → Triggers → Custom Domains)
and point `checkout.endpoint` at it. Requires the domain's DNS to be on
Cloudflare.

## Local test

```bash
npx wrangler dev      # serves http://localhost:8787
```

```bash
curl -X POST http://localhost:8787/checkout \
  -H 'Origin: https://kicksondeck.store' \
  -H 'Content-Type: application/json' \
  -d '{"items":[{"variantId":"674d1b47c3efe04b414860c8","qty":1}]}'
```

A valid response looks like `{"url":"https://checkout.stripe.com/c/pay/…"}`.

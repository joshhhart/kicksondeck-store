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

## What each order carries (attribution)

The storefront remembers **where the shopper came from** and the Worker stamps
it on every Checkout Session *and* the resulting payment as Stripe metadata:

| metadata key | meaning |
|---|---|
| `order_ref` | short human ref (`kod-…`), also the session's `client_reference_id` |
| `items` / `item_variant_ids` | `name \| size \| qty \| variantId` per line, plus the raw catalog variant ids |
| `first_source` / `first_medium` / `first_campaign` | the **first click that ever brought this browser to the site** (utm_*, or inferred: `google / merchant-center` from `srsltid`, `google / cpc` from `gclid`, `facebook / social` from `fbclid`, `chatgpt.com / ai-assistant` from the referrer, `(direct)` when nothing) |
| `first_landing` / `first_referrer` / `first_at` | landing URL (with its query string), referrer, timestamp of that first visit |
| `first_gclid` / `first_srsltid` / `first_fbclid` / `first_ttclid` / `first_ref` | raw click ids when present |
| `last_*` | the same set for the visit in which they actually bought |
| `visits` | how many separate entries to the site before buying |
| `checkout_page` | the page the Checkout button was pressed on |

Where to read it: Stripe Dashboard → Payments → open the payment → **Metadata**
(also on the Checkout Session, and in every payments CSV export). Each line
item additionally carries `variant_id`, `product_id`, `slug` and `size` in its
product metadata, so fulfillment never has to guess which variant "Onyx / US 9"
was.

Stripe Customers are now created for every buyer (`customer_creation=always`),
so Stripe → Customers is a retargetable list of paying customers.

## Paid-order webhook (automated fulfillment hand-off)

`POST /webhook` receives Stripe's `checkout.session.completed` (and
`checkout.session.async_payment_succeeded` for BNPL / bank debits), verifies
the signature, builds one clean order record (items + sizes + variant ids,
ship-to address, buyer email/phone, totals, promo code, Stripe links, full
attribution) and hands it to fulfillment. Two hand-offs, both optional:

1. **GoHighLevel** — the buyer is upserted as a contact in the sub-account
   (`GHL_PIT` + `GHL_LOCATION_ID`), tagged `kod-customer` + `kod-order-paid`
   (+ `GHL_ORDER_TAG` if set), with the whole order pasted in as a **note**.
   Build a GHL workflow on the tag (or on "Contact Note Added") to text/email
   yourself, email the supplier the order, start the post-purchase drip, etc.
2. **Any JSON endpoint** — `ORDER_WEBHOOK_URL` gets
   `{ event: "order.paid", order: {...}, note: "…" }`. Point it at a GHL
   *Inbound Webhook* workflow trigger, Zapier/Make/Composio, a Slack incoming
   webhook, or a supplier API.

If a hand-off fails the Worker answers `500` so Stripe retries for up to
3 days — a duplicated note beats a silently lost order.

### Turn it on

```bash
cd checkout-worker
npx wrangler deploy                                # ship the new code first

# Stripe Dashboard → Developers → Webhooks → Add endpoint
#   URL:    https://kod-checkout.<your-subdomain>.workers.dev/webhook
#   Events: checkout.session.completed, checkout.session.async_payment_succeeded
# copy the signing secret (whsec_…):
npx wrangler secret put STRIPE_WEBHOOK_SECRET

# GoHighLevel hand-off (Settings → Private Integrations → token with
# contacts.write + contacts.readonly scopes):
npx wrangler secret put GHL_PIT
npx wrangler secret put GHL_LOCATION_ID            # YP10UczRbxhYQCBQK6uE
npx wrangler secret put GHL_USER_ID                # optional, owner user id on the note
npx wrangler secret put GHL_ORDER_TAG              # optional, e.g. "new-order-sms"

# and/or a generic JSON hook:
npx wrangler secret put ORDER_WEBHOOK_URL
```

Test without spending money: Stripe Dashboard → Developers → Webhooks → your
endpoint → **Send test event** → `checkout.session.completed` (test events
have no real line items, so expect an empty items list but a created contact),
or run a real checkout with a `sk_test_…` key and Stripe's `4242 4242 4242 4242`
test card.

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

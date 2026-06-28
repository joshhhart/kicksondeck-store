# Kicks on Deck — First-Party Data Worker

Captures the audience signals the site collects — **email signups + survey**,
**"vote the next drop"**, and **find-your-pair quiz** results — into a free
**Cloudflare D1** database you own. The storefront posts to it; the vote widget
reads live tallies back from it.

Nothing here is required for the site to *run* — until `analytics.dataEndpoint`
in `site.config.json` points at this Worker, the capture forms degrade gracefully
(GA4 events still fire, but submissions aren't stored). Wire it up when ready.

```
POST /subscribe   { email, interest, size, source }            -> signups table
POST /vote        { choice }                                    -> votes table  (+ returns live tallies)
POST /quiz        { answers[], coll, reflective, recommended }  -> quiz table
GET  /stats                                                     -> { votes: { id: count } }  (public, aggregate only)
GET  /export.csv?token=YOUR_TOKEN                               -> your email list as CSV
```

## One-time setup — dashboard route (no local repo needed)

1. **Create the database** — Cloudflare dashboard → **Storage & Databases → D1** →
   **Create database**, name it `kod_data`. Copy its **Database ID**.
2. **Create the tables** — open the new database → **Console** tab → paste the
   contents of [`schema.sql`](./schema.sql) → **Execute**.
3. **Create the Worker** — easiest is the CLI route below (a D1 binding is fiddly
   to attach to a brand-new worker purely in the UI). If you prefer all-dashboard,
   create the Worker, then under **Settings → Bindings → Add → D1 database**, bind
   variable name **`DB`** to `kod_data`.

## One-time setup — one-shot script (easiest)

On any computer with Node (download the repo ZIP from GitHub if it's not local):

```bash
cd data-worker
npx wrangler login     # one browser click
node setup.mjs         # does everything below automatically
```

`setup.mjs` creates the D1 database, writes its id into `wrangler.toml`, runs the
schema, generates + sets the `EXPORT_TOKEN`, deploys, and prints your worker URL +
token. Paste the URL back to Claude to finish wiring it into the site.

## One-time setup — manual CLI route

If you'd rather run each step yourself:

```bash
cd data-worker

npx wrangler login

# Create the database (or reuse the one made in the dashboard)
npx wrangler d1 create kod_data
#   -> copy the printed database_id into wrangler.toml ([[d1_databases]].database_id)

# Create the tables
npx wrangler d1 execute kod_data --remote --file=schema.sql

# Set a secret token used to download your email list
npx wrangler secret put EXPORT_TOKEN          # type any long random string

# Deploy
npx wrangler deploy
#   -> prints https://kod-data.<your-subdomain>.workers.dev
```

## Wire it into the site

1. In `site.config.json`, set:
   ```json
   "analytics": { "dataEndpoint": "https://kod-data.<your-subdomain>.workers.dev", ... }
   ```
2. Rebuild + ship: `node scripts/build.mjs` then commit & push.

## Reading your data

- **Votes (live):** the on-site widget shows real-time percentages from `/stats`.
- **Email list:** open `https://kod-data.<sub>.workers.dev/export.csv?token=YOUR_TOKEN`
  to download every signup as a spreadsheet (emails + their stated interest & size).
- **Everything:** Cloudflare dashboard → D1 → `kod_data` → **Console**, e.g.
  `SELECT interest, COUNT(*) FROM signups GROUP BY interest;` or
  `SELECT coll, COUNT(*) FROM quiz GROUP BY coll;` — this is your "what people want" data.

## Privacy

`signups` holds customer emails (PII). Keep `EXPORT_TOKEN` secret, never commit
exported CSVs to the repo, and only email people who opted in.

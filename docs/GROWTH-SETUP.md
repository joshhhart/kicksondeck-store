# Growth Engine — Setup Guide

This site now has a tracking + content + experiment stack. Everything is
**blank-safe**: it only activates once you paste the relevant IDs into
`site.config.json` and rebuild (`node scripts/build.mjs`). Until then the site
runs exactly as before. Same "fill-in-then-rebuild" pattern as the Stripe
`checkout.endpoint`.

What shipped:

| Feature | Where | Activate by |
|---|---|---|
| GA4 analytics | every page | `analytics.ga4Id` |
| Search Console | `<head>` meta | `analytics.gscVerification` |
| Vote / email / quiz capture | home, blog, `/quiz/` | `analytics.dataEndpoint` (data-worker) |
| Blog | `/blog/` + `data/posts/*.md` | live now |
| A/B color test | site-wide | live now (reads results in GA4) |

---

## 1. Google Analytics 4 (free)

1. analytics.google.com → create a **GA4 property** for kicksondeck.store.
2. Admin → **Data streams** → Web → add `https://kicksondeck.store` → copy the
   **Measurement ID** (`G-XXXXXXXXXX`).
3. Paste into `site.config.json` → `analytics.ga4Id`, rebuild, push.

You'll then see, in GA4: `page_view`, `view_item`, `add_to_cart`,
`begin_checkout`, plus the custom events `vote_drop`, `quiz_complete`,
`email_signup`, and `experiment_view` (the A/B variant). Mark `begin_checkout`
as a key event to track conversions.

## 2. Google Search Console (free)

1. search.google.com/search-console → add property → **URL prefix**
   `https://kicksondeck.store`.
2. Choose the **HTML tag** method → copy just the token from the
   `content="..."` attribute.
3. Paste into `analytics.gscVerification`, rebuild, push, then click **Verify**.
4. Submit `https://kicksondeck.store/sitemap.xml` under **Sitemaps** (the blog
   and quiz are already included).

## 3. First-party data capture (the audience data)

The vote widget, email+survey form, and quiz all post to a small Cloudflare
Worker backed by a free D1 database. Full step-by-step is in
[`data-worker/README.md`](../data-worker/README.md). Short version:

1. Create a D1 database `kod_data` + run `data-worker/schema.sql`.
2. Deploy the worker (`cd data-worker && npx wrangler deploy`).
3. Paste its URL into `analytics.dataEndpoint`, rebuild, push.

Then: votes show live on the site, the email list downloads at
`/export.csv?token=…`, and quiz/interest data is queryable in the D1 console.
Until this is set, the forms still work and GA4 events still fire — submissions
just aren't stored.

## 4. Blog

- Posts live in `data/posts/*.md` (markdown + front-matter). Add a file, rebuild,
  done — it's auto-added to `/blog/`, the sitemap, and gets `BlogPosting` schema.
- Front-matter fields: `title, date, tag, read, cover, excerpt, description,
  products` (list of product slugs to show as "Shop the pairs" cards).
- 6 starter posts are included (colorway guide, rep-vs-real, sizing, styling,
  best-of, "are reps worth it") — each links to products and funnels to the
  vote/quiz/email capture.

## 5. A/B color test

- Variant **A** = the current volt/lime accent. Variant **B** = a cooler electric
  blue (defined in `assets/styles.css` under `[data-variant="b"]`).
- Visitors are randomly assigned 50/50 on first visit and the choice persists.
- The variant rides on a GA4 `experiment_view` event — in GA4, segment
  `add_to_cart` / `begin_checkout` by the `variant` parameter to see which accent
  converts better. To change the B palette, edit the three `--volt*` variables in
  that block.

## 6. (Optional) Claude Code SEO/marketing skills

The toolkit you linked (github.com/AgriciDaniel) is a set of **Claude Code
skills** you install on **your own desktop** (this remote session can't install
to your machine). Recommended, relevant ones:

```bash
npx skills add AgriciDaniel/claude-seo        # technical SEO, schema, clustering
npx skills add AgriciDaniel/on-page-seo        # per-page on-page audits
npx skills add AgriciDaniel/claude-blog        # content drafting + optimization
npx skills add AgriciDaniel/claude-email       # email/list campaigns
```

They're third-party — skim each repo's README before running. They augment your
own Claude Code going forward (e.g. drafting more blog posts, auditing pages);
the site build above does not depend on them.

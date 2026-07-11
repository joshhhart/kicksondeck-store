# Agent Operating Contract — Kicks on Deck

Rules for ALL AI agents (Codex, Claude routines, or others) working in this repo or
posting on the brand's behalf. These are hard constraints, not suggestions.

## Social posting (GoHighLevel) — approval is MANDATORY
- Every social post MUST be created with `status: "in_review"` and
  `postApprovalDetails.approver: "hIVd3mY0VOHoRY5i9Mx9"` (the owner), and
  `userId: "hIVd3mY0VOHoRY5i9Mx9"`. **Never** create a post with a published/
  scheduled status and never publish directly. No exceptions, including tests.
- Location: `YP10UczRbxhYQCBQK6uE`. Fetch current IG/FB/GMB `accountIds` at runtime
  (`GET /social-media-posting/{locationId}/accounts`) — they change on reconnect.
- GMB posts need `gmbPostDetails: { gmbEventType: "STANDARD" }`. Media: JPEG/PNG.
- If a post is rejected, read `approverNote`, revise, resubmit as `in_review`.

## Privacy & content guardrails
- NEVER include the owner's personal name or street address anywhere — content,
  captions, alt text, schema, commit messages. Location at region level only
  ("South Florida / Treasure Coast").
- NEVER claim or imply products are authentic, licensed, or official. Forbidden
  phrases include "Original Box", "StockX tag", "authentic", "official". The store
  is transparently replica-labeled; keep it that way.
- Marketing content is culture / styling / sizing / education / community-forward.
  Organic only — no paid ads.
- Creatives: depict the silhouette (350 V2 knit runner / Foam Runner clog / Slide);
  NO third-party brand logos, wordmarks, or trademarks in generated imagery.
- Video generation requires the owner's explicit prior approval (credit cost).

## Brand
- Palette: near-black `#0a0a0b` canvas, volt green `#d8ff3e` accent, mono labels.
- Voice: confident, honest, sneakerhead-fluent, slightly dry.
- CTAs point to: the blog, `/quiz/`, `/#vote`, or product pages.

## Code & deliverables
- Build: `node scripts/build.mjs` (must pass before any push/PR). Verify affected
  pages: real `<title>`, no horizontal overflow at 375px, images/links resolve.
- Code work: branch `codex/<slug>` (or `claude/<slug>`), then **open a PR**. If PR
  creation fails, push the branch anyway — an agent sweep opens PRs for orphaned
  `codex/*` branches. Never commit secrets.
- Image/creative deliverables: attach to the Linear issue or upload to the GHL
  media library. Do NOT open PRs for image-only deliverables.
- Blog post images: own catalog photos (hotlink from `data/products.json`) or
  free-license Unsplash/Pexels CDN links only. Verify every image visually and
  confirm the URL serves an image before committing. Descriptive alt text.

## Escalation
Contact the owner only via: the GHL approval queue, a Linear issue labeled
`owner-decision` (money / legal / brand direction / irreversible), or the weekly
report. Everything else: act and log.

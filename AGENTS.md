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
- API gotchas (confirmed against the live GHL API): `postApprovalDetails.approver` must be a
  **plain string**, not an array. `scheduleDate` is **required** on the request even when
  `status: "in_review"`.

### Who does what — Codex creates, Claude posts
- **Codex: creative production ONLY — never touches GHL.** Deliver finished social images by
  **attaching them to the Linear issue** (Linear attachment upload, or a stable public image
  URL that serves the raw file), plus a comment with the final caption, target platforms
  (IG / FB / GMB), and alt text. Do NOT call any GHL API/plugin and do NOT open PRs for
  creative deliverables. Attaching the image + comment closes out Codex's part of the task.
- **Claude routines: posting.** The Claude session picks up Codex's Linear deliverable
  (image links + caption) and creates the post via the **GoHighLevel MCP**
  (`search_operations` → `describe_operation` → `execute_operation`; post with `create-post`,
  fetch current account IDs with `get-account`) — verified working from Claude sessions.
  Always `in_review` per the rules above; comment the resulting post ID/status back on the
  Linear issue so the thread shows the full chain.
- Fallback only if the GHL MCP is unavailable: route the raw REST call through Composio's
  remote sandbox (`COMPOSIO_REMOTE_BASH_TOOL`) — direct egress to
  `services.leadconnectorhq.com` is blocked (`403`/`CONNECT tunnel failed`) from agent
  sandboxes, and for the raw path credentials live in `~/.config/kod/ghl.env` (written by the
  environment's maintenance script; they are NOT live env vars). If neither path works, stop
  and flag on the Linear issue — never guess credentials or skip approval.

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
- Image/creative deliverables: attach to the Linear issue (see "Who does what" above —
  the Claude poster handles any GHL media-library upload). Do NOT open PRs for
  image-only deliverables.
- Blog post images: own catalog photos (hotlink from `data/products.json`) or
  free-license Unsplash/Pexels CDN links only. Verify every image visually and
  confirm the URL serves an image before committing. Descriptive alt text.

## Escalation
Contact the owner only via: the GHL approval queue, a Linear issue labeled
`owner-decision` (money / legal / brand direction / irreversible), or the weekly
report. Everything else: act and log.

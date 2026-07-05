# Codex Memory — Kicksondeck Store

This file records repo-specific operational lessons from the successful 2026-07-05 blog imagery run. Do not store secret values here.

## GitHub auth / PR creation

What worked:

1. `GH_TOKEN` was not exported in the interactive task shell, but the environment maintenance setup had already written a usable GitHub credential into `~/.git-credentials`.
2. The checkout had no `origin` remote initially. Adding/resetting `origin` to the normal HTTPS repo URL worked once the stored credential was available:
   ```bash
   git remote add origin https://github.com/joshhhart/kicksondeck-store.git 2>/dev/null || \
     git remote set-url origin https://github.com/joshhhart/kicksondeck-store.git
   git ls-remote --heads origin main
   ```
3. A malformed global `insteadOf` rewrite can break Git with `fatal: protocol '<https' is not supported`. If that happens, remove only the bad credential-bearing URL rewrite from global Git config, without printing the token.
4. `gh` was not installed in the container. Creating PRs through the GitHub REST API worked by reading the token from `~/.git-credentials` in-process and never printing it.
5. After pushing, verify the branch actually landed before reporting success:
   ```bash
   git ls-remote origin <branch-name>
   ```
6. Verify the PR URL resolves through the GitHub API before reporting it back.

## Blog image workflow

What worked:

1. Current checkout had 13 posts under `data/posts/*.md`, not 14.
2. `scripts/build.mjs` already supports:
   - per-post hero resolution through `postImg(p)` / frontmatter image support;
   - standalone Markdown image lines rendering as figures;
   - inline Markdown images rendering as `img.post-img`.
3. Keep hero-only work and inline body-image work in separate branches/PRs when requested to reduce binary push/PR size.
4. Rebuild after image/content changes:
   ```bash
   node scripts/build.mjs
   ```
5. Verify WebP dimensions and size with Pillow before committing. Target used for this run: `1200x750`, under `250KB`.
6. Verify generated HTML references expected image paths in:
   - `blog/index.html` cards;
   - individual post hero markup;
   - `og:image`;
   - BlogPosting schema;
   - inline post figures.

## Mobile verification

What worked:

1. Do not test generated pages directly with `file://` URLs, because root-relative `/assets/styles.css` will not load and can create false overflow failures.
2. Serve the repo locally first:
   ```bash
   python3 -m http.server 4173
   ```
3. Run the 375px Playwright overflow check against `http://127.0.0.1:4173/...` URLs.
4. If Chromium fails with missing Linux libraries such as `libatk-1.0.so.0`, install browser dependencies:
   ```bash
   npx playwright install-deps chromium
   ```
5. Remove temporary Playwright/npm files before committing if the repo does not already manage them:
   ```bash
   rm -rf node_modules package.json package-lock.json check_mobile_tmp.js
   ```

## Safety notes

- Never print the stored token or commit credentials.
- Avoid adding generated `node_modules`, temporary scripts, screenshots, or local server logs to commits.
- If using the GitHub API from scripts, keep the token in memory only and print only safe outputs like PR URLs and commit SHAs.

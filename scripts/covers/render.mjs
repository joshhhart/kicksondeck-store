/* ============================================================
   KICKS ON DECK — photographic blog covers
   ------------------------------------------------------------
   For every post in data/posts/*.md, renders assets/blog/<slug>.webp
   (1200x750, 16:10) from the post's own `products` — the real catalog
   photos, cut out of their white studio background and re-lit on the
   brand's near-black canvas with a volt accent, floor glow and
   reflection. Same visual language as assets/social/*.jpg.

     node scripts/covers/render.mjs            # only posts with no cover yet
     node scripts/covers/render.mjs --force    # re-render everything
     node scripts/covers/render.mjs --only yeezy-slides-sizing

   Needs network access to cdn.shopify.com (the catalog photos) and to
   fonts.googleapis.com. Runs in GitHub Actions (.github/workflows/
   blog-covers.yml) on every post change, so authors never render by hand.

   Frontmatter knobs (all optional):
     cover: /assets/blog/custom.webp     -> skip rendering, use this file
     image: https://…                    -> same (legacy key)
     coverTitle: Short Punchy Title      -> headline on the cover (default: title)
     coverProducts: [slug, slug]         -> which photos (default: first 3 of `products`)
   ============================================================ */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const ROOT = process.env.KOD_ROOT || path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const POSTS_DIR = path.join(ROOT, "data", "posts");
const OUT_DIR = path.join(ROOT, "assets", "blog");
const PRODUCTS = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "products.json"), "utf8")).products || [];
const args = process.argv.slice(2);
const FORCE = args.includes("--force");
const ONLY = args.includes("--only") ? args[args.indexOf("--only") + 1] : "";
const W = 1200, H = 750;
const VOLT = "#d8ff3e", BG = "#0a0a0b";
const FONT_HREF = "https://fonts.googleapis.com/css2?family=Archivo+Expanded:wght@700;800;900&family=JetBrains+Mono:wght@500;700&display=swap";

/* ---------- posts ---------- */
function parseFront(raw) {
  raw = String(raw).replace(/\r\n/g, "\n");
  const m = raw.match(/^---\n([\s\S]*?)\n---\n?/);
  const meta = {};
  if (!m) return meta;
  for (const line of m[1].split("\n")) {
    const i = line.indexOf(":");
    if (i < 0) continue;
    const k = line.slice(0, i).trim();
    let v = line.slice(i + 1).trim();
    if (/^\[.*\]$/.test(v)) v = v.slice(1, -1).split(",").map((s) => s.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
    else v = v.replace(/^["']|["']$/g, "");
    meta[k] = v;
  }
  return meta;
}
const posts = fs.readdirSync(POSTS_DIR).filter((f) => f.endsWith(".md")).map((f) => ({
  slug: f.replace(/\.md$/, ""),
  meta: parseFront(fs.readFileSync(path.join(POSTS_DIR, f), "utf8")),
}));

/* ---------- photo cut-out ----------
   Catalog shots sit on a pure white sweep. The bytes are fetched here (Node),
   handed to Chromium as a data URI (same-origin, so the canvas stays readable)
   and cut out in-page: flood-fill the white that touches the frame edge (so
   white knit / laces inside the shoe survive), feather the alpha, crop to the
   shoe. Chromium decodes JPEG / WebP / PNG / AVIF alike, so no image libs. */
const imgCache = new Map();
async function loadPhotoUri(url) {
  if (imgCache.has(url)) return imgCache.get(url);
  let buf, mime = "image/jpeg";
  if (/^https?:/.test(url)) {
    const res = await fetch(url, { headers: { "User-Agent": "kod-covers/1.0" } });
    if (!res.ok) throw new Error(`photo ${res.status}: ${url}`);
    buf = Buffer.from(await res.arrayBuffer());
    mime = res.headers.get("content-type") || mime;
  } else {
    buf = fs.readFileSync(path.isAbsolute(url) ? url : path.join(ROOT, url));
  }
  // Trust magic bytes over the CDN's extension (the "webp" catalog files are JPEGs).
  if (buf[0] === 0xff && buf[1] === 0xd8) mime = "image/jpeg";
  else if (buf[0] === 0x89 && buf[1] === 0x50) mime = "image/png";
  else if (buf.slice(0, 4).toString() === "RIFF" && buf.slice(8, 12).toString() === "WEBP") mime = "image/webp";
  const uri = `data:${mime.split(";")[0]};base64,${buf.toString("base64")}`;
  imgCache.set(url, uri);
  return uri;
}

// Runs inside Chromium. Returns { uri: png data uri, w, h } of the cut-out shoe.
async function cutoutInBrowser(srcUri) {
  const img = new Image(); img.src = srcUri; await img.decode();
  const w = img.naturalWidth, h = img.naturalHeight;
  const c = document.createElement("canvas"); c.width = w; c.height = h;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);
  const id = ctx.getImageData(0, 0, w, h), d = id.data;
  const TOL = 11; // studio sweeps are 255 pure; keep cream/bone soles (~235-245) intact
  // Backdrop = near-white, or already transparent (a PNG/WebP with alpha).
  const isBg = (i) => d[i * 4 + 3] < 20 || (d[i * 4] >= 255 - TOL && d[i * 4 + 1] >= 255 - TOL && d[i * 4 + 2] >= 255 - TOL);
  const alpha = new Uint8Array(w * h).fill(255), seen = new Uint8Array(w * h);
  const stack = [];
  for (let x = 0; x < w; x++) stack.push(x, (h - 1) * w + x);
  for (let y = 0; y < h; y++) stack.push(y * w, y * w + w - 1);
  while (stack.length) {
    const i = stack.pop();
    if (seen[i] || !isBg(i)) continue;
    seen[i] = 1; alpha[i] = 0;
    const x = i % w, y = (i - x) / w;
    if (x > 0) stack.push(i - 1);
    if (x < w - 1) stack.push(i + 1);
    if (y > 0) stack.push(i - w);
    if (y < h - 1) stack.push(i + w);
  }
  const blur = (src) => {
    const out = new Uint8Array(src.length);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let s = 0, n = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const yy = y + dy, xx = x + dx;
        if (yy < 0 || yy >= h || xx < 0 || xx >= w) continue;
        s += src[yy * w + xx]; n++;
      }
      out[y * w + x] = Math.round(s / n);
    }
    return out;
  };
  const a = blur(blur(alpha));
  let minX = w, minY = h, maxX = 0, maxY = 0;
  for (let i = 0; i < w * h; i++) {
    let al = Math.min(a[i], d[i * 4 + 3]); // never re-opaque a source's own transparency
    const r = d[i * 4], g = d[i * 4 + 1], b = d[i * 4 + 2];
    if (al < 255 && r > 246 && g > 246 && b > 246) al = Math.round(al * 0.35); // kill the white fringe
    d[i * 4 + 3] = al;
    if (al > 8) { const x = i % w, y = (i - x) / w; if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
  }
  if (maxX <= minX || maxY <= minY) { minX = 0; minY = 0; maxX = w - 1; maxY = h - 1; }
  ctx.putImageData(id, 0, 0);
  const pad = 6;
  minX = Math.max(0, minX - pad); minY = Math.max(0, minY - pad); maxX = Math.min(w - 1, maxX + pad); maxY = Math.min(h - 1, maxY + pad);
  const cw = maxX - minX + 1, ch = maxY - minY + 1;
  const o = document.createElement("canvas"); o.width = cw; o.height = ch;
  o.getContext("2d").drawImage(c, minX, minY, cw, ch, 0, 0, cw, ch);
  return { uri: o.toDataURL("image/png"), w: cw, h: ch };
}

/* ---------- fonts ----------
   Google Fonts served as a <link> raced Chromium's screenshot (the first CI
   render shipped in the fallback face). Fetch the CSS here with a Chrome UA so
   it returns woff2, inline every font file as a data URI, and embed the whole
   @font-face block in the page. Falls back to the <link> if the network is off. */
let fontCss = null;
async function loadFontCss() {
  if (fontCss !== null) return fontCss;
  try {
    const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36";
    const res = await fetch(FONT_HREF, { headers: { "User-Agent": UA } });
    if (!res.ok) throw new Error("fonts css " + res.status);
    let css = await res.text();
    const urls = [...new Set([...css.matchAll(/url\((https:[^)]+)\)/g)].map((m) => m[1]))];
    for (const u of urls) {
      const r = await fetch(u, { headers: { "User-Agent": UA } });
      if (!r.ok) throw new Error("font file " + r.status);
      const b = Buffer.from(await r.arrayBuffer());
      css = css.split(u).join(`data:font/woff2;base64,${b.toString("base64")}`);
    }
    fontCss = `<style>${css}</style>`;
  } catch (e) {
    console.warn(`  (web fonts unavailable: ${e.message}; using <link> + fallback)`);
    fontCss = `<link rel="stylesheet" href="${FONT_HREF}">`;
  }
  return fontCss;
}

/* ---------- layout ---------- */
const esc = (s = "") => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const silhouetteOf = (p) => /foam|rnnr/i.test(p.collection + " " + p.slug) ? "Foam Runner" : /slide/i.test(p.collection + " " + p.slug) ? "Slide" : /350/.test(p.slug) ? "350 V2" : "Care";

function coverProductsFor(post) {
  const want = post.meta.coverProducts || post.meta.products || [];
  const list = (Array.isArray(want) ? want : [want]).map((s) => PRODUCTS.find((p) => p.slug === s)).filter(Boolean)
    // shoes first — a brush is never the hero
    .sort((a, b) => (/brush|clean|kit|accessor/i.test(a.slug + a.collection) ? 1 : 0) - (/brush|clean|kit|accessor/i.test(b.slug + b.collection) ? 1 : 0));
  return list.slice(0, 3);
}

function html(post, shots, fonts) {
  const title = post.meta.coverTitle || post.meta.title || post.slug;
  const tag = String(post.meta.tag || "Journal").toUpperCase();
  const year = String(post.meta.date || "").slice(0, 4) || new Date().getFullYear();
  const sil = shots.length ? [...new Set(shots.map((s) => silhouetteOf(s.product)))].join(" · ") : "Journal";
  const n = shots.length;
  // Shoe placement per count: [left%, top%, width px, rotate deg, z, opacity]
  const layouts = {
    1: [[590, 110, 590, -7, 3, 1]],
    2: [[560, 175, 540, -8, 3, 1], [800, 48, 380, 6, 2, 0.92]],
    3: [[560, 210, 520, -8, 3, 1], [790, 88, 370, 5, 2, 0.94], [660, 4, 290, -14, 1, 0.8]],
  }[n] || [];
  const shoes = shots.map((s, i) => {
    const [x, y, w, r, z, o] = layouts[i];
    const hgt = Math.round(w * s.h / s.w);
    return `<div class="shoe" style="left:${x}px;top:${y}px;width:${w}px;height:${hgt}px;z-index:${z};opacity:${o};transform:rotate(${r}deg)">
      <img src="${s.uri}" alt="">
      <img class="refl" src="${s.uri}" alt="">
    </div>`;
  }).join("");
  return `<!doctype html><html><head><meta charset="utf-8">
${fonts}
<style>
  html,body{margin:0;background:${BG}}
  .c{position:relative;width:${W}px;height:${H}px;overflow:hidden;background:${BG};font-family:"Archivo Expanded","Archivo",system-ui,sans-serif;color:#f4f4f1}
  .wash{position:absolute;inset:0;background:radial-gradient(60% 55% at 78% 22%, rgba(216,255,62,.13), transparent 70%)}
  .floor{position:absolute;left:0;right:0;bottom:0;height:46%;background:linear-gradient(to top, rgba(255,255,255,.045), transparent)}
  .glow{position:absolute;left:640px;top:520px;width:520px;height:120px;border-radius:50%;background:radial-gradient(closest-side, rgba(216,255,62,.32), rgba(216,255,62,0));filter:blur(18px)}
  .grid{position:absolute;inset:0;background-image:linear-gradient(rgba(255,255,255,.035) 1px, transparent 1px),linear-gradient(90deg, rgba(255,255,255,.035) 1px, transparent 1px);background-size:60px 60px;mask-image:linear-gradient(to left, rgba(0,0,0,.9), transparent 60%);-webkit-mask-image:linear-gradient(to left, rgba(0,0,0,.9), transparent 60%)}
  .shoe{position:absolute;filter:drop-shadow(0 34px 34px rgba(0,0,0,.75)) drop-shadow(0 6px 10px rgba(0,0,0,.5))}
  .shoe img{position:absolute;left:0;top:0;width:100%;height:100%;object-fit:contain;display:block}
  .shoe .refl{top:100%;transform:scaleY(-1) translateY(6px);opacity:.14;-webkit-mask-image:linear-gradient(to bottom, transparent 55%, rgba(0,0,0,.85));mask-image:linear-gradient(to bottom, transparent 55%, rgba(0,0,0,.85));filter:blur(1.5px)}
  .text{position:absolute;left:64px;top:64px;bottom:64px;width:530px;display:flex;flex-direction:column;z-index:5}
  .chip{align-self:flex-start;background:${VOLT};color:#0a0a0b;font:700 14px/1 "JetBrains Mono",ui-monospace,monospace;letter-spacing:.14em;padding:9px 12px 8px;border-radius:4px}
  h1{margin:26px 0 0;font-weight:800;text-transform:uppercase;line-height:.98;letter-spacing:-.01em;font-size:62px;max-width:530px;text-wrap:balance;text-shadow:0 2px 30px rgba(0,0,0,.6)}
  .meta{margin-top:auto;display:flex;align-items:center;gap:16px;font:500 14px/1 "JetBrains Mono",ui-monospace,monospace;letter-spacing:.12em;color:#9a9aa0;text-transform:uppercase}
  .meta b{color:#f4f4f1;font-weight:700}
  .rule{width:38px;height:3px;background:${VOLT}}
  .mark{position:absolute;right:64px;top:64px;width:18px;height:18px;background:${VOLT};box-shadow:0 0 30px rgba(216,255,62,.6)}
  .brand{position:absolute;right:64px;bottom:64px;text-align:right;font:700 13px/1.5 "JetBrains Mono",ui-monospace,monospace;letter-spacing:.16em;color:#f4f4f1;z-index:5}
  .brand small{display:block;color:#9a9aa0;font-weight:500}
  .grain{position:absolute;inset:0;opacity:.06;background-image:url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='200' height='200'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='2' stitchTiles='stitch'/><feColorMatrix type='saturate' values='0'/></filter><rect width='200' height='200' filter='url(%23n)'/></svg>");mix-blend-mode:overlay;z-index:6;pointer-events:none}
</style></head><body><div class="c">
  <div class="wash"></div><div class="grid"></div><div class="floor"></div><div class="glow"></div>
  ${shoes}
  <div class="mark"></div>
  <div class="text">
    <span class="chip">${esc(tag)}</span>
    <h1 id="t">${esc(title)}</h1>
    <div class="meta"><span class="rule"></span><span><b>${esc(sil)}</b> · ${esc(String(year))}</span></div>
  </div>
  <div class="brand">KICKS ON DECK<small>KICKSONDECK.STORE</small></div>
  <div class="grain"></div>
</div>
<script>
  // Shrink the headline until it fits 4 lines inside its column. Re-run once
  // the web font is in, because Archivo Expanded is much wider than any fallback.
  window.__fit = () => {
    const h = document.getElementById("t");
    let fs = 62; h.style.fontSize = fs + "px";
    const lines = () => Math.round(h.getBoundingClientRect().height / (fs * 0.98));
    while ((lines() > 4 || h.scrollWidth > 530) && fs > 32) { fs -= 2; h.style.fontSize = fs + "px"; }
    return fs;
  };
  window.__fit();
</script></body></html>`;
}

/* ---------- render ---------- */
async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  let todo = posts.filter((p) => !p.meta.cover && !p.meta.image);
  if (ONLY) todo = todo.filter((p) => p.slug === ONLY);
  if (!FORCE) todo = todo.filter((p) => !fs.existsSync(path.join(OUT_DIR, p.slug + ".webp")));
  if (!todo.length) { console.log("covers: nothing to render"); return; }

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  let ok = 0, failed = 0;
  for (const post of todo) {
    try {
      const prods = coverProductsFor(post);
      const shots = [];
      for (const product of prods) {
        const url = product.image || (product.images && product.images[0]);
        if (!url) continue;
        try {
          const src = await loadPhotoUri(url);
          await page.setContent("<!doctype html><title>cutout</title>");
          shots.push({ ...(await page.evaluate(cutoutInBrowser, src)), product });
        } catch (e) { console.warn(`  photo skipped for ${product.slug}: ${e.message}`); }
      }
      await page.setContent(html(post, shots, await loadFontCss()), { waitUntil: "networkidle" });
      // Pull the web fonts explicitly; `load` fires before @font-face files arrive.
      const fontsOk = await page.evaluate(async () => {
        try {
          await Promise.all([
            document.fonts.load('800 62px "Archivo Expanded"'),
            document.fonts.load('700 14px "JetBrains Mono"'),
          ]);
          await document.fonts.ready;
        } catch {}
        window.__fit();
        return document.fonts.check('800 62px "Archivo Expanded"');
      });
      if (!fontsOk) console.warn(`  (Archivo Expanded not available for ${post.slug}; rendered with fallback font)`);
      await page.waitForTimeout(150);
      const png = await page.screenshot({ type: "png", clip: { x: 0, y: 0, width: W, height: H } });
      // Chromium encodes WebP natively — no sharp/imagemagick dependency.
      const webp = await page.evaluate(async (b64) => {
        const img = new Image();
        img.src = "data:image/png;base64," + b64;
        await img.decode();
        const c = document.createElement("canvas"); c.width = img.width; c.height = img.height;
        c.getContext("2d").drawImage(img, 0, 0);
        return c.toDataURL("image/webp", 0.82).split(",")[1];
      }, png.toString("base64"));
      const out = path.join(OUT_DIR, post.slug + ".webp");
      fs.writeFileSync(out, Buffer.from(webp, "base64"));
      if (process.env.KOD_COVER_PNG) fs.writeFileSync(out.replace(/\.webp$/, ".png"), png); // debug preview
      const kb = Math.round(fs.statSync(out).size / 1024);
      console.log(`  ${post.slug}.webp  ${shots.length} photo${shots.length === 1 ? "" : "s"}  ${kb} KB`);
      ok++;
    } catch (e) {
      failed++;
      console.error(`  FAILED ${post.slug}: ${e.message}`);
    }
  }
  await browser.close();
  console.log(`covers: ${ok} rendered, ${failed} failed`);
  if (failed) process.exitCode = 1;
}
main();

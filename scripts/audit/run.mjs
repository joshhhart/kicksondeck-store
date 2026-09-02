/* ============================================================
   KICKS ON DECK — site audit (screenshots + Lighthouse)
   ------------------------------------------------------------
   Serves the built site, screenshots the key templates at desktop and
   mobile (full page, JPEG), and runs Lighthouse (performance, SEO,
   accessibility, best practices) on a representative page per template.
   Output lands in ./audit/ (git-ignored on main; the site-audit Action
   pushes it to the claude/site-audit-results branch for review).

     node scripts/audit/run.mjs [--no-lighthouse] [--only home,pdp]
   ============================================================ */
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const ROOT = process.cwd();
const OUT = path.join(ROOT, "audit");
const PORT = 5050;
const BASE = `http://127.0.0.1:${PORT}`;
const args = process.argv.slice(2);
const NO_LH = args.includes("--no-lighthouse");
const ONLY = args.includes("--only") ? args[args.indexOf("--only") + 1].split(",") : null;

const PAGES = {
  home: "/",
  shop: "/shop/",
  collection: "/collection/350-v2/",
  pdp: "/product/zebra-yz-boost-350-v2/",
  pdp_foam: "/product/onyx-yz-foam-rnnr/",
  blog: "/blog/",
  post: "/blog/yeezy-slides-sizing/",
  quiz: "/quiz/",
  faq: "/faq/",
  shipping: "/shipping/",
  about: "/about/",
  contact: "/contact/",
  size_guide: "/size-guide/",
  notfound: "/404.html",
};
const LH_PAGES = ["home", "shop", "pdp", "post", "faq"];

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(path.join(OUT, "screens"), { recursive: true });

const server = spawn(process.execPath, [path.join(ROOT, "scripts", "serve.mjs")], { stdio: "ignore" });
await new Promise((r) => setTimeout(r, 1500));

const summary = { generatedAt: new Date().toISOString(), screens: [], lighthouse: {}, console: {} };
try {
  const browser = await chromium.launch();
  for (const [key, url] of Object.entries(PAGES)) {
    if (ONLY && !ONLY.includes(key)) continue;
    for (const [vp, w, h] of [["desktop", 1280, 900], ["mobile", 390, 844]]) {
      const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
      const errors = [];
      page.on("pageerror", (e) => errors.push(String(e)));
      page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
      await page.goto(BASE + url, { waitUntil: "networkidle", timeout: 60000 }).catch(() => {});
      await page.evaluate(() => document.fonts.ready);
      // Settle lazy images / animations, then trigger every lazy image before the full-page shot.
      await page.evaluate(async () => { window.scrollTo(0, document.body.scrollHeight); await new Promise((r) => setTimeout(r, 400)); window.scrollTo(0, 0); });
      await page.waitForTimeout(400);
      const file = `${key}-${vp}.jpg`;
      await page.screenshot({ path: path.join(OUT, "screens", file), fullPage: true, type: "jpeg", quality: 72 });
      const metrics = await page.evaluate(() => ({
        overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
        height: document.documentElement.scrollHeight,
        h1: [...document.querySelectorAll("h1")].map((h) => h.textContent.trim().replace(/\s+/g, " ")),
        title: document.title,
        brokenImgs: [...document.images].filter((i) => i.complete && i.naturalWidth === 0).map((i) => i.currentSrc || i.src).slice(0, 5),
        fontDisplay: getComputedStyle(document.querySelector("h1") || document.body).fontFamily,
      }));
      summary.screens.push({ key, vp, url, file, ...metrics });
      if (errors.length) summary.console[`${key}-${vp}`] = errors.slice(0, 5);
      await page.close();
    }
  }
  await browser.close();

  if (!NO_LH) {
    const lighthouse = (await import("lighthouse")).default;
    const { launch } = await import("chrome-launcher");
    const chrome = await launch({ chromeFlags: ["--headless=new", "--no-sandbox", "--disable-gpu"], chromePath: process.env.CHROME_PATH || undefined });
    try {
      for (const key of LH_PAGES) {
        if (ONLY && !ONLY.includes(key)) continue;
        for (const form of ["mobile", "desktop"]) {
          const r = await lighthouse(BASE + PAGES[key], { port: chrome.port, output: "json", logLevel: "error", onlyCategories: ["performance", "accessibility", "best-practices", "seo"], formFactor: form, screenEmulation: form === "desktop" ? { mobile: false, width: 1350, height: 940, deviceScaleFactor: 1, disabled: false } : undefined, throttlingMethod: "simulate" });
          const lhr = r.lhr;
          const scores = Object.fromEntries(Object.entries(lhr.categories).map(([k, c]) => [k, Math.round((c.score || 0) * 100)]));
          const failing = Object.values(lhr.audits).filter((a) => a.score !== null && a.score < 0.9 && a.scoreDisplayMode !== "informative" && a.scoreDisplayMode !== "notApplicable").map((a) => ({ id: a.id, title: a.title, score: a.score, displayValue: a.displayValue || "" }));
          const m = lhr.audits.metrics?.details?.items?.[0] || {};
          summary.lighthouse[`${key}-${form}`] = { scores, metrics: { lcp: m.largestContentfulPaint, cls: m.cumulativeLayoutShift, tbt: m.totalBlockingTime, fcp: m.firstContentfulPaint, si: m.speedIndex }, failing };
          fs.writeFileSync(path.join(OUT, `lighthouse-${key}-${form}.json`), JSON.stringify(lhr));
          console.log(`  lighthouse ${key} ${form}:`, JSON.stringify(scores));
        }
      }
    } finally { await chrome.kill(); }
  }
} finally {
  server.kill();
}
fs.writeFileSync(path.join(OUT, "summary.json"), JSON.stringify(summary, null, 2));
console.log(`audit: ${summary.screens.length} screenshots, ${Object.keys(summary.lighthouse).length} lighthouse runs -> audit/`);

// Static site generator for Kicks on Deck.
// Reads data/products.json + site.config.json -> writes the deployable site to repo root.
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const data = JSON.parse(fs.readFileSync("data/products.json", "utf8"));
const CFG = JSON.parse(fs.readFileSync("site.config.json", "utf8"));
const products = data.products;
// Supplier feed prefixes its copy with "REP VERSION:" — shouty scraped text
// that was leaking into meta descriptions, og tags and Product JSON-LD.
for (const p of products) {
  if (p.descText) p.descText = p.descText.replace(/REP VERSION:?\s*/gi, "").trim();
  if (p.descHtml) p.descHtml = p.descHtml.replace(/REP VERSION:?\s*/gi, "");
}
const collections = data.collections;
const DOMAIN = CFG.brand.domain;
const ORIGIN = `https://${DOMAIN}`;
const AN = CFG.analytics || {};
const SOCIAL = CFG.social || {};
// Every shipping/returns promise on the site resolves from here (see
// site.config.json -> policy). One edit updates the policy pages, the PDP
// delivery estimate, the marquee, the cart drawer and the Product JSON-LD
// together, so the site can never contradict itself the way it used to
// ("free shipping over $150" in a blog post vs "free on every order" sitewide).
const POLICY = Object.assign({
  dispatchHours: 48, transitMinDays: 7, transitMaxDays: 14, returnDays: 7,
  shipCountries: "United States & Canada",
  freeShippingLine: "Free shipping on every order (US & Canada)",
}, CFG.policy || {});
const HERO_IMG = "/assets/hero-350.webp";
const HERO_GLB = "/assets/3d/zebra-350.glb";

const readJSON = (rel, fallback) => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, rel), "utf8")); } catch { return fallback; } };
const drops = readJSON("data/drops.json", { candidates: [] });
const quiz = readJSON("data/quiz.json", { questions: [] });
const productCopy = readJSON("data/product-copy.json", {});
const OG_DEFAULT = (products.find((p) => /zebra/i.test(p.name)) || products[0]).image;

/* ---------------- helpers ---------------- */
// "Reflective" but NOT "Non-Reflective" (the word reflective is a substring of non-reflective).
const isReflective = (s = "") => /reflective/i.test(s) && !/non[\s-]?reflective/i.test(s);
const money = (n) => "$" + Number(n || 0).toLocaleString("en-US");
const SELF_FONTS = fs.existsSync(path.join(ROOT, "assets", "fonts", "fonts.css"));
const FONT_CSS = SELF_FONTS ? fs.readFileSync(path.join(ROOT, "assets", "fonts", "fonts.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\s+/g, " ").trim() : "";
// styles.css stays the hand-edited source; the pages load a minified copy.
const CSS_MIN = fs.readFileSync(path.join(ROOT, "assets", "styles.css"), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "").replace(/\s*([{}:;,>])\s*/g, "$1").replace(/;}/g, "}").replace(/\s+/g, " ").trim();
fs.mkdirSync(path.join(ROOT, "assets"), { recursive: true });
fs.writeFileSync(path.join(ROOT, "assets", "styles.min.css"), CSS_MIN);
// Google's Organization logo rich result needs a raster (PNG/JPG), not the SVG favicon.
// Shopify's CDN resizes on demand via ?width= — a 300px card no longer downloads a
// 1151px original. srcset covers 1x/2x at the three grid breakpoints.
const imgW = (url = "", w) => /cdn\.shopify\.com/.test(url) ? `${url}${url.includes("?") ? "&" : "?"}width=${w}` : url;
const srcset = (url = "", widths = [400, 600, 900]) => /cdn\.shopify\.com/.test(url) ? widths.map((w) => `${imgW(url, w)} ${w}w`).join(", ") : "";
const CARD_SIZES = "(max-width: 640px) 50vw, (max-width: 1100px) 33vw, 300px";
const LOGO_URL = fs.existsSync(path.join(ROOT, "assets", "logo.png")) ? `${ORIGIN}/assets/logo.png` : `${ORIGIN}/assets/favicon.svg`;
// One source of truth for the sizing rule per silhouette — the PDP FAQ, the
// collection FAQ, the "quick facts" block and llms.txt all read from here so an
// AI answer engine never sees two different rules for the same shoe.
const SIZING_RULE = {
  "350-v2": "The 350 V2 fits close to true to size — take your normal US size, and go up a half if you have wide feet. Women's sizes are labelled W.",
  "foam-rnnr": "Foam Runners run big and only come in whole sizes — size down one from your normal US size. If you're between sizes, take the smaller one.",
  slides: "Slides run big and only come in whole sizes — size down one from your normal US size, or two if you like them snug.",
};
const SIZING_SHORT = {
  "350-v2": "Close to true to size; half up for wide feet",
  "foam-rnnr": "Runs big, whole sizes only; size down one",
  slides: "Runs big, whole sizes only; size down one",
};
const AUTHENTICITY = (what, price) => `No. This is an independently produced 1:1 replica and we say so on every page — Kicks on Deck is not affiliated with, authorized by or endorsed by adidas, Yeezy or any trademark holder. You are buying the silhouette and the build quality${price ? `, at ${price} instead of resale` : ""}.`;
const SHIP_ANSWER = () => `Dispatched within ${POLICY.dispatchHours} hours with tracking emailed at dispatch, then ${POLICY.transitMinDays}–${POLICY.transitMaxDays} business days in transit. Shipping is free to ${POLICY.shipCountries} on every order.`;
const RETURN_ANSWER = () => `You have ${POLICY.returnDays} days from delivery to return an unworn pair or swap it for another size. Email ${CFG.brand.email} with your order number and we send the return address the same day.`;
const faqLd = (items) => ({ "@context": "https://schema.org", "@type": "FAQPage", mainEntity: items.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })) });
const esc = (s = "") => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const priceLabel = (p) => (p.minPrice === p.maxPrice ? money(p.minPrice) : `From ${money(p.minPrice)}`);
// Google truncates the SERP title around 60–65 characters. Half the blog
// titles were being pushed past that purely by the " | Kicks on Deck" suffix,
// which cost the brand name AND the end of the headline. Append the suffix
// only when it fits; posts whose own headline is already too long carry a
// shorter `seoTitle` in their frontmatter.
const brandedTitle = (t = "") => {
  const full = `${t} | Kicks on Deck`;
  return full.length <= 62 ? full : t;
};
const trimDesc = (s = "", max = 155) => {
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  return `${cut.slice(0, lastSpace > 0 ? lastSpace : max)}…`;
};

function sizeLabel(raw) {
  const seg = String(raw).split("/")[0].trim();
  const eu = seg.match(/EU[R]?\s*=?\s*([\d.]+)/i);
  // Kids formats (10K, 3Y, "Kids 12") — none in the catalog yet, but the GHL sync
  // may add them; render correctly the day they appear.
  const kid = seg.match(/\b(\d+(?:\.\d+)?)\s*([KY])\b/i);
  if (kid) return { main: kid[1] + kid[2].toUpperCase(), sub: eu ? "EU " + eu[1] : "Kids" };
  let m = seg.match(/MEN\s*=?\s*US\s*([\d.]+)/i);
  if (m) return { main: "US " + m[1], sub: eu ? "EU " + eu[1] : "" };
  const w = seg.match(/WOMEN\s*S?\s*([\d.]+)\s*\(\s*MEN\s*([\d.]+)\s*\)/i);
  if (w) return { main: "W " + w[1], sub: "M " + w[2] };
  const u = seg.match(/US\s*([\d.]+)/i);
  if (u) return { main: "US " + u[1], sub: eu ? "EU " + eu[1] : "" };
  return { main: seg.replace(/=/g, " ").trim().slice(0, 12) || "One", sub: "" };
}
function variantList(p) {
  return p.variants.map((v) => { const s = sizeLabel(v.name); return { id: v.id, main: s.main, sub: s.sub, size: s.sub ? `${s.main} · ${s.sub}` : s.main, price: v.amount }; });
}
function pdpDesc(html) {
  let s = html || "";
  s = s.replace(/<\/?(script|style|meta|link)[^>]*>/gi, "");
  s = s.replace(/<h1[^>]*>[\s\S]*?<\/h1>/i, "");
  s = s.replace(/<(\/?)(h[1-6])[^>]*>/gi, (_, c, t) => `<${c}h3>`);
  s = s.replace(/<(?!\/?(p|br|strong|b|em|ul|ol|li|h3)\b)[^>]*>/gi, "");
  s = s.replace(/<(p|strong|b|em|ul|ol|li|h3)(\s[^>]*)?>/gi, "<$1>");
  s = s.replace(/(\s*<br\s*\/?>\s*){2,}/gi, "</p><p>");
  return s.trim();
}

/* ---------------- product copy normalisation ----------------
   The GHL catalogue is a supplier feed: shouty scraped ad copy in ALL CAPS with
   emoji, e.g. "EXPERIENCE THE CAPTIVATING ADIDAS YEEZY BOOST 350 V2 ANTLIA".
   That text was being used verbatim as the on-page description AND as the meta
   description on 82 of 94 PDPs, which made every SERP snippet look like spam
   and read as scraped, duplicate content to Google. We keep the factual bullets
   (materials, what's in the box, release history) and generate a clean, unique
   lead paragraph per product from real attributes. */

const KEEP_CAPS = new Set(["US", "EU", "UK", "CM", "V2", "V1", "YZ", "RNNR", "QC", "TPU", "EVA", "SPLY", "SPLY-350", "3D", "1:1", "&", "DIY", "MX", "UV"]);
const stripEmoji = (s = "") => s.replace(/[\u{1F000}-\u{1FAFF}\u{2190}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{2122}\u{00AE}]/gu, "").replace(/\s{2,}/g, " ").trim();
// Sentence-case any run of two or more shouted words, leaving genuine acronyms
// and model designations alone.
function deShout(s = "") {
  return s.replace(/[A-Z][A-Z0-9''’.\-/&]*(?:\s+[A-Z][A-Z0-9''’.\-/&]*)+/g, (run) => {
    const words = run.split(/\s+/);
    if (words.every((w) => KEEP_CAPS.has(w))) return run;
    return words.map((w, i) => {
      if (KEEP_CAPS.has(w)) return w;
      if (/^\d/.test(w)) return w;
      const lower = w.charAt(0) + w.slice(1).toLowerCase();
      return i === 0 ? lower : lower.toLowerCase();
    }).join(" ").replace(/^./, (c) => c.toUpperCase());
  });
}
const cleanSentence = (s = "") => stripEmoji(deShout(String(s).replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ")))
  .replace(/\s+([.,;:!?])/g, "$1")
  // stripping inline tags leaves gaps inside quotes: `" SPLY-350 "` -> `"SPLY-350"`
  .replace(/"\s+([^"]*?)\s+"/g, '"$1"')
  .replace(/\s{2,}/g, " ")
  .trim();

// Colourway = the product name with the silhouette suffix removed
// ("Ash Blue YZ Boost 350 V2" -> "Ash Blue").
const colorway = (p) => (p.name || "")
  .replace(/\s*YZ\s+(Boost\s*350\s*V2|Foam\s*RNNR|Slide)s?\b.*$/i, "")
  .replace(/\((?:non[\s-]?)?reflective\)/gi, "")
  .replace(/\s{2,}/g, " ").trim() || p.name;

const SILHOUETTE = { "350-v2": "350 V2", "foam-rnnr": "Foam Runner", "slides": "Slide", accessories: "care essential" };

// Factual bullets salvaged from the supplier HTML (materials, what's included,
// release history), de-shouted and de-emoji'd.
// Bullets like "Meticulously crafted with attention to detail" or "Unmatched
// comfort and support prioritized" are pure ad copy: they say nothing, they
// repeat across dozens of products, and to a quality classifier they read as
// boilerplate. Keeping a bullet requires a concrete anchor — a material, a
// component, a colour, a construction detail or a date — which is an allowlist
// rather than an endless game of blocking new adjectives.
const CONCRETE = /(primeknit|knit|mesh|textile|suede|leather|monofilament|upper|midsole|outsole|insole|footbed|sole|boost|eva|foam|rubber|cage|stripe|lace|laces|heel|toe|collar|vent|strap|tpu|translucent|reflective|semi[- ]?translucent|gum|colou?r|tonal|debut|unveil|releas|restock|retail|\b(19|20)\d{2}\b|\$\d)/i;
const HYPE = /(must[- ]have|masterpiece|coveted|by storm|sneaker enthusiast|unparalleled|ultimate comfort|turn heads|elevate your|game[- ]chang|iconic status|statement piece|unleash|captivating|mesmeriz|meticulous|attention to detail|effortlessly|unmatched|prioritized|throughout the day|eye[- ]catching)/i;
// The supplier feed writes as if it were the trademark holder ("Step into the
// world of the adidas Yeezy Boost 350 V2", "Adidas' three-stripes trademark").
// On a store that is explicitly and deliberately replica-labelled, that copy
// implies an affiliation we don't have and must never suggest. Bullets that
// assert brand ownership are dropped outright; incidental brand mentions in
// otherwise factual bullets are rewritten to the silhouette name.
const BRAND_CLAIM = /(three[- ]stripe|trademark|adidas['’]|by adidas|official|authentic|licensed|collaboration with)/i;
const deBrand = (s = "") => s
  .replace(/\badidas\s+yeezy\s+boost\s*350\s*v?2?\b/gi, "350 V2")
  .replace(/\byeezy\s+boost\s*350\s*v?2?\b/gi, "350 V2")
  .replace(/\byeezy\s+foam\s+(rnnr|runner)\b/gi, "Foam Runner")
  .replace(/\byeezy\s+slides?\b/gi, "Slide")
  .replace(/\b(adidas|yeezy)\b\s*/gi, "")
  .replace(/\s{2,}/g, " ").trim();

function specBullets(p) {
  const out = [];
  const seen = new Set();
  for (const m of String(p.descHtml || "").matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)) {
    const raw = cleanSentence(m[1]);
    if (BRAND_CLAIM.test(raw)) continue;
    const t = deBrand(raw);
    const key = t.toLowerCase();
    if (t.length < 12 || t.length > 190 || seen.has(key)) continue;
    if (HYPE.test(t) || !CONCRETE.test(t)) continue;
    seen.add(key);
    out.push(t);
    if (out.length >= 6) break;
  }
  return out;
}

// Deterministic per-slug variation so 82 generated leads don't read as one
// template stamped 82 times (which is what thin/duplicate content detection
// looks for), while every sentence stays factually derived from the product.
const slugSeed = (slug = "") => { let s = 2166136261; for (let i = 0; i < slug.length; i++) { s ^= slug.charCodeAt(i); s = Math.imul(s, 16777619) >>> 0; } return s; };
const pick = (arr, seed) => arr[seed % arr.length];

function generatedLead(p) {
  const cw = colorway(p);
  const sil = SILHOUETTE[p.collection] || "silhouette";
  const refl = isReflective(p.name);
  const seed = slugSeed(p.slug);
  if (p.collection === "accessories") {
    return `${cw} — the unglamorous half of owning good sneakers. Keeps knit, foam and rubber looking like the day they arrived, which matters more on a pair you actually wear than on one that lives in the box.`;
  }
  const openers = [
    `The ${cw} ${sil}, built 1:1 and priced like a shoe instead of an asset.`,
    `${cw} — one of the ${sil} colourways people actually wear, not just collect.`,
    `Our 1:1 take on the ${cw} ${sil}: same proportions, same palette, none of the resale tax.`,
    `${cw} on the ${sil} last — a colourway that earns its place in a rotation.`,
  ];
  const middles = {
    "350-v2": [
      "Primeknit-style upper over a boost-grade midsole, with the cage and stripe placement matched to the original last.",
      "Knit upper with the SPLY-350 stripe sitting where it should, on a translucent boost-grade sole that keeps its shape.",
      "The weave, the cage and the sole geometry are matched stitch for stitch — the details that separate a top-tier build from a cheap one.",
    ],
    "foam-rnnr": [
      "One-piece moulded EVA-blend foam — no laces, no seams, nothing to break in beyond a day or two of wear.",
      "Sculpted foam shell with the full lattice of vents, light enough that you forget you put them on.",
      "Moulded in a single piece, so there's no stitching to fail and no upper to crease.",
    ],
    slides: [
      "Soft moulded foam footbed with the contoured arch that makes these the default indoor shoe for half the people who own them.",
      "One-piece foam with a grippy sole and a footbed that softens to your step within a week.",
      "Lightweight moulded foam — the pair that lives by the door and gets worn more than anything else you own.",
    ],
  };
  const closers = [
    `Every pair is inspected before dispatch, ships free to ${POLICY.shipCountries}, and comes with a ${POLICY.returnDays}-day window if the fit isn't right.`,
    `Inspected by hand, dispatched within ${POLICY.dispatchHours} hours, free shipping and ${POLICY.returnDays} days to change your mind.`,
    `Checked over before it leaves, shipped free, and returnable for ${POLICY.returnDays} days if you size it wrong.`,
  ];
  const parts = [
    pick(openers, seed),
    pick(middles[p.collection] || middles["350-v2"], seed >> 3),
    refl ? "The reflective yarn stays invisible in daylight and lights up the whole upper under a flash or headlights." : "",
  ].filter(Boolean).join(" ");
  return `${parts}\n\n${pick(closers, seed >> 6)}`;
}

// Women's-fit guidance per collection — every shoe is unisex, but only the 350s
// carry explicit W labels; Foam Runners and Slides are sized on the men's US scale.
const FIT_NOTES = {
  "350-v2": { text: "Fits men &amp; women — women's sizes listed as W (from W5).", guide: "/blog/yeezy-350-v2-sizing/" },
  "foam-rnnr": { text: "Unisex, men's US scale — women size down ~1.5 (a W8 ≈ US 6.5).", guide: "/blog/yeezy-foam-runner-sizing/" },
  "slides": { text: "Unisex, men's US scale — women size down ~1.5; slides run big.", guide: "/blog/yeezy-slides-sizing/" },
};
const fitNote = (p) => {
  const n = FIT_NOTES[p.collection];
  return n ? `<p style="color:var(--muted);font-family:var(--font-mono);font-size:.72rem;margin-top:10px">${n.text} <a href="${n.guide}" style="color:var(--volt);text-decoration:underline">Sizing guide</a></p>` : "";
};

const colMeta = Object.fromEntries(collections.map((c) => [c.slug, c]));
const colTitle = (slug) => (colMeta[slug]?.title || "Sneakers");
const firstImg = (slug) => (products.find((p) => p.collection === slug)?.image || products[0].image);

// BreadcrumbList JSON-LD — mirrors the visual breadcrumb so SERPs can render a breadcrumb trail.
const crumbLd = (items) => ({
  "@context": "https://schema.org", "@type": "BreadcrumbList",
  itemListElement: items.map((it, i) => ({ "@type": "ListItem", position: i + 1, name: it.name, item: it.url })),
});

/* ---------------- icons ---------------- */
const I = {
  search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>',
  bag: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z"/><path d="M3 6h18M16 10a4 4 0 01-8 0"/></svg>',
  menu: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 6h18M3 12h18M3 18h18"/></svg>',
  close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  arrow: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" width="15" height="15"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
  arrowUR: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" width="18" height="18"><path d="M7 17L17 7M7 7h10v10"/></svg>',
  truck: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M1 3h15v13H1zM16 8h4l3 3v5h-7M5.5 19a2 2 0 100-4 2 2 0 000 4zM18.5 19a2 2 0 100-4 2 2 0 000 4z"/></svg>',
  shield: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M12 2l8 3v6c0 5-3.5 9-8 11-4.5-2-8-6-8-11V5z"/><path d="M9 12l2 2 4-4"/></svg>',
  spark: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M12 2v6M12 16v6M2 12h6M16 12h6"/></svg>',
  globe: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.5 2.5 15 0 18M12 3c-2.5 2.5-2.5 15 0 18"/></svg>',
  lock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 018 0v3"/></svg>',
  refresh: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M3 12a9 9 0 0115-6.7L21 8M21 12a9 9 0 01-15 6.7L3 16"/><path d="M21 4v4h-4M3 20v-4h4"/></svg>',
};

// Card-network + wallet marks for the checkout trust row. Drawn as neutral
// monochrome shapes (no third-party logo files to host or hotlink) — the point
// is "cards and wallets are accepted", not brand reproduction.
const PAY_BADGES = ["Visa", "Mastercard", "Amex", "Discover", "Apple&nbsp;Pay", "Google&nbsp;Pay", "Link"]
  .map((n) => `<span class="pay-badge">${n}</span>`).join("");

/* ---------------- chrome ---------------- */
const navLinks = [
  { href: "/shop/", label: "Shop All" },
  ...collections.filter((c) => c.slug !== "accessories").map((c) => ({ href: `/collection/${c.slug}/`, label: c.title })),
  { href: "/blog/", label: "Blog" },
  { href: "/collection/accessories/", label: "Care" },
];

// Trust surface. Every one of these used to be a dead link to /shop/ or a
// bare mailto — the two things a first-time buyer checks before spending $149.
const PAGE_NAV = [
  { href: "/faq/", label: "FAQ" },
  { href: "/shipping/", label: "Shipping" },
  { href: "/returns/", label: "Returns" },
  { href: "/size-guide/", label: "Size guide" },
  { href: "/about/", label: "About" },
  { href: "/contact/", label: "Contact" },
];

function head(opts) {
  const { title, desc, canonical, ogImg = OG_DEFAULT, extraCss = "", ld = null, ogType = "website", extraMeta = "", preloadImg = "" } = opts;
  const FONT_HREF = "https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@125,600;125,700;125,800;125,900&family=Hanken+Grotesk:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;700&display=swap";
  // Self-hosted fonts (scripts/fonts/vendor.mjs) win when present: no third-party
  // hop, the display face is preloaded, and CI/local renders get the real type.
  const fontTags = () => SELF_FONTS
    ? `<link rel="preload" as="font" type="font/woff2" href="/assets/fonts/archivo-800-w125.woff2" crossorigin>\n<link rel="preload" as="font" type="font/woff2" href="/assets/fonts/hanken-grotesk-400.woff2" crossorigin>\n<style>${FONT_CSS}</style>`
    : `<link rel="preload" as="style" href="${FONT_HREF}">\n<link rel="stylesheet" href="${FONT_HREF}" media="print" onload="this.media='all'">\n<noscript><link rel="stylesheet" href="${FONT_HREF}"></noscript>`;
  // Google Fonts is render-blocking on the critical path and was the single
  // biggest LCP cost on mobile. Load it async (print -> all on load) with a
  // <noscript> fallback; --font-* already list system fallbacks so first paint
  // is readable rather than invisible.
  return `<!doctype html>
<html lang="en" class="no-js">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${canonical}">
<meta property="og:type" content="${ogType}">
<meta property="og:site_name" content="Kicks on Deck">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:image" content="${/^\//.test(ogImg) ? ORIGIN + ogImg : ogImg}">
<meta property="og:url" content="${canonical}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(desc)}">
<meta name="twitter:image" content="${/^\//.test(ogImg) ? ORIGIN + ogImg : ogImg}">
<meta property="og:locale" content="en_US">
<meta name="robots" content="${opts.robots || "index,follow,max-image-preview:large,max-snippet:-1,max-video-preview:-1"}">
<link rel="alternate" type="application/rss+xml" title="Kicks on Deck — Journal" href="${ORIGIN}/blog/feed.xml">
<meta name="theme-color" content="#0a0a0b">
${extraMeta}<link rel="icon" href="/assets/favicon.svg" type="image/svg+xml">
${SELF_FONTS ? "" : `<link rel="preconnect" href="https://fonts.googleapis.com">\n<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n`}<link rel="preconnect" href="https://cdn.shopify.com" crossorigin>
${preloadImg ? `<link rel="preload" as="image" href="${preloadImg}" fetchpriority="high">\n` : ""}${fontTags()}
<link rel="stylesheet" href="/assets/styles.min.css">
${extraCss}${analyticsTags()}
<script>window.KOD_CONFIG=${JSON.stringify({ checkout: CFG.checkout, brand: CFG.brand, analytics: { ga4Id: AN.ga4Id || "", dataEndpoint: AN.dataEndpoint || "" } })};document.documentElement.classList.remove('no-js');</script>
${ld ? `<script type="application/ld+json">${JSON.stringify(ld)}</script>\n` : ""}</head>`;
}

// GA4 + Search Console tags — only emitted once the IDs are set in site.config.json.
function analyticsTags() {
  let s = "";
  if (AN.gscVerification) s += `\n<meta name="google-site-verification" content="${esc(AN.gscVerification)}">`;
  // navigator.webdriver gate keeps headless/automation traffic (our own build
  // verifiers included) out of GA4 — it was drowning real-shopper data.
  if (AN.ga4Id) s += `\n<script>if(!navigator.webdriver){var kge=document.createElement('script');kge.async=true;kge.src='https://www.googletagmanager.com/gtag/js?id=${esc(AN.ga4Id)}';document.head.appendChild(kge);window.dataLayer=window.dataLayer||[];window.gtag=function(){dataLayer.push(arguments)};gtag('js',new Date());gtag('config','${esc(AN.ga4Id)}');}</script>`;
  return s;
}

function header(active = "") {
  return `<header class="header" id="header"><div class="container"><div class="header-inner">
  <a class="brand" href="/"><span class="wordmark">Kicks on Deck<small>EST. MIAMI · REP 1:1</small></span></a>
  <nav class="nav pill-nav" id="pill-nav" aria-label="Primary"><span class="pill-ind" aria-hidden="true"></span>${navLinks.map((l) => `<a href="${l.href}"${active === l.href ? ' class="active"' : ""}>${l.label}</a>`).join("")}</nav>
  <div class="header-actions">
    <button class="icon-btn" id="search-open" aria-label="Search">${I.search}</button>
    <button class="icon-btn" id="cart-open" aria-label="Open bag (0)">${I.bag}<span class="cart-count" id="cart-count" aria-hidden="true">0</span></button>
    <button class="icon-btn menu-toggle" id="menu-toggle" aria-label="Menu">${I.menu}</button>
  </div>
</div></div></header>
<div class="mobile-nav" id="mobile-nav">${navLinks.map((l) => `<a href="${l.href}">${l.label}</a>`).join("")}<a href="/quiz/">Find your pair</a><div class="mobile-nav-sub">${PAGE_NAV.map((l) => `<a href="${l.href}">${l.label}</a>`).join("")}</div></div>`;
}

function marquee() {
  const items = [POLICY.freeShippingLine, "1:1 craftsmanship", "Every pair inspected", `Dispatched in ${POLICY.dispatchHours}h`, `${POLICY.returnDays}-day returns`, "Secure Stripe checkout"];
  const span = items.map((t) => `<span>${t}</span>`).join("");
  return `<div class="marquee" aria-hidden="true"><div class="marquee-track">${span}${span}</div></div>`;
}

function drawerAndSearch() {
  return `
<div class="overlay" id="overlay"></div>
<aside class="drawer" id="cart-drawer" aria-label="Shopping bag">
  <div class="drawer-head"><p class="drawer-title" id="cart-title">Your Bag <span class="count" id="cart-head-count"></span></p><button class="icon-btn" id="cart-close" aria-label="Close">${I.close}</button></div>
  <div class="drawer-body" id="cart-body"></div>
  <div class="drawer-foot" id="cart-foot" style="display:none">
    <div class="cart-reassure">
      <span>${I.truck} ${esc(POLICY.freeShippingLine)}</span>
      <span>${I.refresh} ${esc(POLICY.returnDays)}-day returns if the fit is wrong</span>
      <span>${I.lock} Card details go straight to Stripe — never to us</span>
    </div>
    <div class="cart-row"><span>Subtotal</span><span class="mono" id="cart-subtotal">$0</span></div>
    <div class="cart-row"><span>Shipping</span><span class="mono">Free</span></div>
    <div class="cart-row total"><span>Total</span><span class="mono" id="cart-subtotal-2"></span></div>
    <button class="btn btn-volt btn-block btn-lg" id="checkout-btn">Checkout ${I.arrow}</button>
    <p class="cart-promo">First order? Enter <strong class="mono">FIRSTPAIR</strong> at checkout for 10% off.</p>
    <div class="pay-row" aria-label="Accepted payment methods">${PAY_BADGES}</div>
    <p class="cart-note">Questions before you buy? <a href="/faq/">FAQ</a> · <a href="/size-guide/">Size guide</a> · <a href="mailto:${CFG.brand.email}">${CFG.brand.email}</a></p>
  </div>
</aside>
<div class="search-panel" id="search-panel" aria-label="Search">
  <div class="search-inner">
    <div class="search-field">${I.search}<input id="search-input" placeholder="Search the rotation…" autocomplete="off"><button class="icon-btn" id="search-close" aria-label="Close">${I.close}</button></div>
    <div class="search-results" id="search-results"></div>
    <div class="search-hint">Press ESC to close · type to filter ${products.length} styles</div>
  </div>
</div>`;
}

function socialLink(url, label) {
  if (!url) return "";
  const href = /^https?:\/\//.test(url) ? url : `https://${url}`;
  return `<a href="${esc(href)}" target="_blank" rel="noopener">${label}</a>`;
}

function footer() {
  return `<footer class="footer"><div class="container">
  <div class="footer-top">
    <div>
      <a class="brand" href="/"><span class="wordmark">Kicks on Deck</span></a>
      <p class="footer-blurb">Independent footwear for people who chase the silhouette, not the markup. Curated drops, 1:1 craftsmanship, free U.S. shipping.</p>
    </div>
    <div class="footer-col"><p class="footer-title">Shop</p>${collections.map((c) => `<a href="/collection/${c.slug}/">${c.title}</a>`).join("")}<a href="/shop/">All Styles</a></div>
    <div class="footer-col"><p class="footer-title">Help</p><a href="/faq/">FAQ</a><a href="/size-guide/">Size guide</a><a href="/shipping/">Shipping</a><a href="/returns/">Returns &amp; exchanges</a><a href="mailto:${CFG.brand.email}?subject=Order%20status">Track order</a></div>
    <div class="footer-col"><p class="footer-title">Connect</p><a href="/about/">About us</a><a href="/contact/">Contact</a>${socialLink(SOCIAL.instagram, "Instagram")}${socialLink(SOCIAL.tiktok, "TikTok")}${socialLink(SOCIAL.facebook, "Facebook")}<a href="/quiz/">Find your pair</a></div>
  </div>
  <div class="footer-trust">
    <span>${I.shield} ${esc(POLICY.returnDays)}-day returns</span>
    <span>${I.truck} ${esc(POLICY.freeShippingLine)}</span>
    <span>${I.lock} Secure checkout by Stripe</span>
    <span>${I.spark} Every pair inspected before dispatch</span>
  </div>
  <div class="footer-bottom">
    <p>© ${new Date().getFullYear()} Kicks on Deck · ${esc(CFG.brand.city)}</p>
    <div style="display:flex;gap:18px"><a href="/privacy/">Privacy</a><a href="/terms/">Terms</a><a href="/contact/">Contact</a></div>
  </div>
  <p class="footer-disclaimer">Kicks on Deck sells independently produced footwear inspired by iconic silhouettes. We are not affiliated with, authorized by, or endorsed by adidas, Yeezy, Nike, or any trademark holder; all such marks belong to their respective owners. Products are marketed as replica ("rep") versions.</p>
  <div class="footer-giant" aria-hidden="true">ON DECK</div>
</div></footer>
<script src="/assets/app.js" defer></script>
</body></html>`;
}

function layout({ headOpts, active, body }) {
  return head(headOpts) + `<body>${header(active)}${marquee()}<main>${body}</main>${footer()}${drawerAndSearch()}`;
}

/* ---------------- cards ---------------- */
function card(p, i = 0) {
  const refl = isReflective(p.name);
  const acc = p.collection === "accessories";
  const badge = !p.inStock ? `<span class="badge soft">Sold out</span>` : refl ? `<span class="badge volt">Reflective ✦</span>` : acc ? `<span class="badge soft">Care</span>` : "";
  return `<a class="card reveal" data-spotlight data-d="${(i % 4) + 1}" href="/product/${p.slug}/" data-collection="${p.collection}" data-price="${p.minPrice}" data-name="${esc(p.name)}" data-order="${i}">
    <span class="card-glow" aria-hidden="true"></span>
    <div class="card-media">${badge ? `<div class="badge-wrap">${badge}</div>` : ""}<img src="${imgW(p.image, 600)}"${srcset(p.image) ? ` srcset="${srcset(p.image)}" sizes="${CARD_SIZES}"` : ""} alt="${esc(p.name)}" ${i < 4 ? `loading="eager"${i === 0 ? ' fetchpriority="high"' : ""}` : 'loading="lazy"'} decoding="async" width="600" height="600"></div>
    <div class="card-info"><div class="c-line"><span class="name">${esc(p.name)}</span><span class="price">${priceLabel(p)}</span></div><span class="sub">${colTitle(p.collection)}${refl ? " · Reflective" : ""}</span></div>
  </a>`;
}

/* ---------------- pages ---------------- */
function homePage() {
  const hero = products.find((p) => /zebra/i.test(p.name)) || products.find((p) => /beluga/i.test(p.name)) || products.find((p) => p.collection === "350-v2") || products[0];
  const featKeys = ["zebra", "beluga 2.0", "black red", "bone yz boost", "cream", "static reflective", "onyx yz foam", "onyx yz slide"];
  let featured = featKeys.map((k) => products.find((p) => p.name.toLowerCase().includes(k))).filter(Boolean);
  const have = new Set(featured.map((p) => p.id));
  for (const p of products) { if (featured.length >= 8) break; if (!have.has(p.id)) { featured.push(p); have.add(p.id); } }
  featured = featured.slice(0, 8);

  const body = `
<section class="hero" id="hero" data-hero3d="${HERO_GLB}">
  <div class="hero-bg"><div class="hero-grid-lines"></div><div class="hero-glow" aria-hidden="true"></div><canvas class="hero-particles" id="hero-particles" aria-hidden="true"></canvas></div>
  <a class="hero-link" href="/shop/" aria-label="Shop the rotation"></a>
  <div class="hero-stage">
    <div class="hero-ghost" aria-hidden="true"><span>350</span></div>
    <div class="hero-podium" aria-hidden="true"></div>
    <div class="hero-shoe">
      <img class="hero-img" src="${HERO_IMG}" alt="${esc(hero.name)}" fetchpriority="high">
    </div>
    <div class="container hero-content">
      <p class="eyebrow reveal in">SNEAKER CULTURE <span class="dot">●</span> NO MARKUP</p>
      <h1><span class="line"><span>Kicks</span></span><span class="line"><span class="outline">on</span> <span class="volt shiny-text">Deck</span></span></h1>
      <div class="hero-sub">
        <p>Grail silhouettes, 1:1 craftsmanship, honest prices. ${products.length} styles in rotation — built to wear, not to flip.</p>
        <div class="hero-cta"><a class="btn btn-volt btn-lg" href="/shop/">Shop the rotation ${I.arrow}</a><a class="btn btn-ghost btn-lg" href="/collection/350-v2/">350 V2 →</a><button class="btn btn-ghost btn-lg hero-3d-btn" type="button" id="hero-3d-btn" hidden>Spin it in 3D</button></div>
      </div>
    </div>
    <div class="hero-readout" aria-hidden="true"><span class="ro-k">Now spinning</span><span class="ro-v">${esc(hero.name)}</span></div>
  </div>
</section>

<section class="stats">
  <div class="stat reveal"><div class="num"><span class="volt" data-countup="${products.length}">${products.length}</span></div><div class="lbl">Styles in stock</div></div>
  <div class="stat reveal" data-d="1"><div class="num">1:1</div><div class="lbl">Craftsmanship</div></div>
  <div class="stat reveal" data-d="2"><div class="num"><span data-countup="${POLICY.dispatchHours}">${POLICY.dispatchHours}</span><span class="volt">h</span></div><div class="lbl">Dispatch window</div></div>
  <div class="stat reveal" data-d="3"><div class="num"><span data-countup="${POLICY.returnDays}">${POLICY.returnDays}</span>d</div><div class="lbl">Returns window</div></div>
</section>

<section class="section container">
  <div class="section-head"><div><span class="eyebrow">Collections</span><h2>Pick your<br>silhouette</h2></div><a class="link-arrow" href="/shop/">All styles <span>${I.arrow}</span></a></div>
  <div class="collections-grid">
    ${collections.filter((c) => c.slug !== "accessories").map((c, i) => `
    <a class="col-card span-${i === 0 ? 8 : i === 1 ? 4 : 6}" href="/collection/${c.slug}/">
      <img class="col-img" src="${imgW(firstImg(c.slug), 900)}" alt="" loading="lazy">
      <div class="c-go">${I.arrowUR}</div>
      <h3>${c.title}</h3>
      <div class="c-meta"><span class="c-tag">${c.tagline}</span><span class="c-count">${String(c.count).padStart(2, "0")} styles</span></div>
    </a>`).join("")}
  </div>
</section>

<section class="section container" style="padding-top:0">
  <div class="section-head"><div><span class="eyebrow">Most wanted</span><h2>On rotation</h2></div><a class="link-arrow" href="/shop/">View all ${products.length} <span>${I.arrow}</span></a></div>
  <div class="product-grid">${featured.map((p, i) => card(p, i)).join("")}</div>
</section>

<section class="section container">
  <div class="story">
    <div class="story-copy reveal">
      <span class="eyebrow">The standard</span>
      <h2>Built for<br>the streets</h2>
      <p>Every pair is sourced from the highest tier of independent production — premium Primeknit-style uppers, boost-grade midsoles, and dialed-in proportions. Inspected by hand before it ships.</p>
      <div class="feature-list">
        <div class="fl"><span class="fl-num">01</span><div><h3>1:1 construction</h3><p>Matched to the original last, stitch for stitch.</p></div></div>
        <div class="fl"><span class="fl-num">02</span><div><h3>Inspected & shipped fast</h3><p>QC photos on request. Dispatched within 48 hours.</p></div></div>
        <div class="fl"><span class="fl-num">03</span><div><h3>Buyer protection</h3><p>7-day window. Sizing help any time.</p></div></div>
      </div>
    </div>
    <div class="story-visual reveal" data-d="2"><img src="${(products.find((p) => /cream|bone|sand/i.test(p.name)) || products[1]).image}" alt="Featured pair" loading="lazy" decoding="async" width="900" height="1125"></div>
  </div>
</section>

${trustBand()}
${quizCTA()}
${voteWidget()}
${captureBand()}`;

  const socials = [SOCIAL.instagram, SOCIAL.tiktok, SOCIAL.facebook].filter(Boolean).map((u) => (/^https?:\/\//.test(u) ? u : `https://${u}`));
  const homeLd = [
    { "@context": "https://schema.org", "@type": "Organization", "@id": `${ORIGIN}/#org`, name: "Kicks on Deck", alternateName: "kicksondeck.store", url: `${ORIGIN}/`, logo: { "@type": "ImageObject", url: LOGO_URL }, email: CFG.brand.email, telephone: CFG.brand.phone, slogan: "1:1 craftsmanship, honest pricing, no resale markup", contactPoint: { "@type": "ContactPoint", contactType: "customer service", email: CFG.brand.email, telephone: CFG.brand.phone, areaServed: ["US", "CA"], availableLanguage: "English" }, knowsAbout: ["Yeezy 350 V2 replica sneakers", "Yeezy Foam Runner replicas", "Yeezy Slide replicas", "sneaker sizing", "sneaker cleaning and care"], description: "Independent footwear — 1:1 rep Yeezy 350 V2, Foam Runners and Slides. Honest pricing, free U.S. shipping.", ...(socials.length ? { sameAs: socials } : {}) },
    { "@context": "https://schema.org", "@type": "WebSite", "@id": `${ORIGIN}/#website`, name: "Kicks on Deck", url: `${ORIGIN}/`, inLanguage: "en-US", publisher: { "@id": `${ORIGIN}/#org` } },
    { "@context": "https://schema.org", "@type": ["Store", "OnlineStore"], "@id": `${ORIGIN}/#store`, name: "Kicks on Deck", url: `${ORIGIN}/`, image: hero.image, email: CFG.brand.email, telephone: CFG.brand.phone, priceRange: "$$", parentOrganization: { "@id": `${ORIGIN}/#org` }, address: { "@type": "PostalAddress", addressRegion: "FL", addressCountry: "US" }, areaServed: [{ "@type": "AdministrativeArea", name: "South Florida" }, { "@type": "AdministrativeArea", name: "Treasure Coast" }, { "@type": "Country", name: "United States" }] },
  ];
  return layout({
    headOpts: { title: "Kicks on Deck — Rep 1:1 Sneakers, Foam Runners & Slides", desc: `Shop ${products.length} grail silhouettes — 350 V2, Foam Runners and Slides. 1:1 craftsmanship, honest prices, free U.S. shipping.`, canonical: `${ORIGIN}/`, ogImg: hero.image, ld: homeLd },
    active: "/",
    body,
  });
}

// Collection FAQs: the three or four questions a first-time buyer asks before
// they pick a size. Rendered on the page (answer-engine friendly) and mirrored
// into FAQPage markup; every number comes from site.config.json.
function collectionFaq(slug, list) {
  const sil = SILHOUETTE[slug]; if (!sil || slug === "accessories") return [];
  const lo = list.length ? money(Math.min(...list.map((p) => p.minPrice))) : "";
  const count = list.length;
  return [
    { q: `Do Yeezy ${sil} reps fit true to size?`, a: SIZING_RULE[slug] + ` The ${sil} sizing guide on the blog covers women's and half-size conversions.` },
    { q: `How much do ${sil} reps cost at Kicks on Deck?`, a: `Every ${sil} colourway we stock (${count} styles) starts at ${lo}, with free shipping to ${POLICY.shipCountries} and no resale markup.` },
    { q: `Are these authentic ${sil}s?`, a: AUTHENTICITY(sil, lo) },
    { q: `How fast do ${sil} orders ship?`, a: SHIP_ANSWER() + ` ${RETURN_ANSWER()}` },
  ];
}
function gridPage({ title, h1, eyebrow, list, canonical, active, intro, showFilters, slug = "" }) {
  const faq = collectionFaq(slug, list);
  const faqBlock = faq.length ? `
<section class="container faq-block" aria-labelledby="col-faq-h">
  <h2 id="col-faq-h">Before you pick a size</h2>
  <div class="faq-grid">${faq.map((f) => `<div class="faq-item"><h3>${esc(f.q)}</h3><p>${esc(f.a)}</p></div>`).join("")}</div>
</section>` : "";
  const chips = showFilters ? `<div class="chips">
    <button class="chip" data-filter="all">All</button>
    ${collections.map((c) => `<button class="chip" data-filter="${c.slug}">${c.title}</button>`).join("")}
  </div>` : "";
  const body = `
<section class="container shop-head">
  <span class="eyebrow">${eyebrow}</span>
  <h1>${h1}</h1>
  ${intro ? `<p style="color:var(--ink-dim);max-width:54ch;margin-top:18px">${intro}</p>` : ""}
</section>
<section class="container" style="padding-bottom:120px">
  <div class="filter-bar">
    ${chips}
    <div class="filter-spacer"></div>
    <span class="result-count" id="result-count">${list.length} styles</span>
    <div class="sort-wrap"><label for="sort-select">Sort</label><select id="sort-select"><option value="featured">Featured</option><option value="price-asc">Price ↑</option><option value="price-desc">Price ↓</option><option value="name">A–Z</option></select></div>
  </div>
  <div class="product-grid" id="product-grid">${list.map((p, i) => card(p, i)).join("")}</div>
  <div class="empty-state" id="empty-state" style="display:none">No styles in this collection yet.</div>
</section>${faqBlock}`;
  const crumb = title.split(/[—|]/)[0].trim();
  // ItemList lets Google read the full grid as a product listing rather than
  // as an anonymous page of links, and CollectionPage names the page type.
  const gridLd = [
    crumbLd([{ name: "Home", url: `${ORIGIN}/` }, { name: crumb, url: canonical }]),
    ...(faq.length ? [faqLd(faq)] : []),
    {
      "@context": "https://schema.org", "@type": "CollectionPage",
      name: crumb, url: canonical, description: intro || h1.replace(/<br>/g, " "),
      isPartOf: { "@id": `${ORIGIN}/#website` },
      mainEntity: {
        "@type": "ItemList", numberOfItems: list.length,
        itemListElement: list.slice(0, 60).map((p, i) => ({
          "@type": "ListItem", position: i + 1, url: `${ORIGIN}/product/${p.slug}/`, name: p.name,
        })),
      },
    },
  ];
  return layout({ headOpts: { title, desc: trimDesc(intro || h1.replace(/<br>/g, " ")), canonical, ld: gridLd, preloadImg: list[0]?.image || "" }, active, body });
}

function productPage(p) {
  const vs = variantList(p);
  const refl = isReflective(p.name);
  const acc = p.collection === "accessories";
  // Hand-written copy wins; otherwise generate a clean lead from attributes.
  // Either way the shouty supplier paragraph never reaches the page or the
  // meta description again — only its factual bullets survive, de-shouted.
  const leadText = productCopy[p.slug] || generatedLead(p);
  const bullets = specBullets(p);
  // Reflective / non-reflective twins used to share one meta description; say which one this is.
  const variantTag = refl ? "Reflective version. " : /non[\s-]?reflective/i.test(p.name) ? "Non-reflective version. " : "";
  const descPlain = variantTag + trimDesc(cleanSentence(`${leadText} ${bullets.join(". ")}`), 600 - variantTag.length).replace(/…$/, "");
  const desc = leadText.split(/\n\n+/).map((t) => `<p>${esc(t.trim())}</p>`).join("")
    + (bullets.length ? `<h3>Spec</h3><ul>${bullets.map((b) => `<li>${esc(b)}</li>`).join("")}</ul>` : "");
  const sectionLabel = acc ? "Select option" : "Select size";
  const pdata = { id: p.id, slug: p.slug, name: p.name, image: p.image, price: p.minPrice, collection: colTitle(p.collection), variants: vs.map((v) => ({ id: v.id, size: v.size })) };
  const related = products.filter((x) => x.collection === p.collection && x.id !== p.id).slice(0, 4);
  const single = vs.length <= 1;
  const GUIDES_BY_COLLECTION = {
    "350-v2": ["rep-vs-real-yeezy-350-v2", "yeezy-350-v2-sizing"],
    "foam-rnnr": ["yeezy-foam-runner-sizing", "how-to-clean-yeezy-foam-runner-and-slides"],
    "slides": ["yeezy-slides-sizing", "how-to-clean-yeezy-foam-runner-and-slides"],
  };
  const guides = (GUIDES_BY_COLLECTION[p.collection] || []).map((s) => posts.find((post) => post.slug === s)).filter(Boolean);

  /* Product JSON-LD, built for Google's free merchant listings rather than the
     bare minimum. Previously this carried name/image/description/brand and a
     price-only Offer, which is not enough to be eligible: Google wants an
     identifier, condition, shipping cost + delivery time, and a return policy,
     and it will show shipping/returns annotations in the SERP once they're
     present. No aggregateRating — the store has no reviews yet, and inventing
     them is both a manual-action risk and a lie. */
  const ccy = p.currency || "USD";
  const validUntil = new Date(Date.now() + 330 * 864e5).toISOString().slice(0, 10);
  const shipRegion = [{ "@type": "DefinedRegion", addressCountry: "US" }, { "@type": "DefinedRegion", addressCountry: "CA" }];
  const offerBase = {
    priceCurrency: ccy,
    availability: p.inStock ? "https://schema.org/InStock" : "https://schema.org/OutOfStock",
    itemCondition: "https://schema.org/NewCondition",
    url: `${ORIGIN}/product/${p.slug}/`,
    priceValidUntil: validUntil,
    // Inlined rather than an @id reference — the #org node only exists on the
    // homepage, and merchant parsers read each product page standalone.
    seller: { "@type": "Organization", name: "Kicks on Deck", url: `${ORIGIN}/` },
    shippingDetails: {
      "@type": "OfferShippingDetails",
      shippingRate: { "@type": "MonetaryAmount", value: 0, currency: ccy },
      shippingDestination: shipRegion,
      deliveryTime: {
        "@type": "ShippingDeliveryTime",
        handlingTime: { "@type": "QuantitativeValue", minValue: 0, maxValue: Math.ceil(POLICY.dispatchHours / 24), unitCode: "DAY" },
        transitTime: { "@type": "QuantitativeValue", minValue: POLICY.transitMinDays, maxValue: POLICY.transitMaxDays, unitCode: "DAY" },
      },
    },
    hasMerchantReturnPolicy: {
      "@type": "MerchantReturnPolicy",
      applicableCountry: ["US", "CA"],
      returnPolicyCategory: "https://schema.org/MerchantReturnFiniteReturnWindow",
      merchantReturnDays: POLICY.returnDays,
      returnMethod: "https://schema.org/ReturnByMail",
      returnFees: "https://schema.org/ReturnShippingFees",
      merchantReturnLink: `${ORIGIN}/returns/`,
    },
  };
  const offers = p.minPrice === p.maxPrice
    ? { "@type": "Offer", price: p.minPrice, ...offerBase }
    : { "@type": "AggregateOffer", lowPrice: p.minPrice, highPrice: p.maxPrice, offerCount: vs.length, ...offerBase };
  const ld = {
    "@context": "https://schema.org", "@type": "Product",
    "@id": `${ORIGIN}/product/${p.slug}/#product`,
    name: p.name, image: [p.image], description: descPlain,
    sku: p.id, mpn: p.slug,
    brand: { "@type": "Brand", name: "Kicks on Deck" },
    category: colTitle(p.collection),
    color: colorway(p),
    ...(acc ? {} : { audience: { "@type": "PeopleAudience", suggestedGender: "unisex" }, material: p.collection === "350-v2" ? "Knit textile upper, EVA-blend midsole" : "Moulded EVA-blend foam" }),
    ...(vs.length > 1 ? { size: vs.map((v) => v.main) } : {}),
    offers,
  };
  // Objection-handling FAQ, mirrored into FAQPage markup. These are the exact
  // four questions that stop a first-time replica buyer at the size grid.
  const pdpFaq = acc ? [] : [
    { q: `Are these authentic ${colTitle(p.collection)}s?`, a: `No. This is an independently produced 1:1 replica and we say so on every page — Kicks on Deck is not affiliated with, authorized by or endorsed by adidas, Yeezy or any trademark holder. You are buying the silhouette and the build quality, at ${money(p.minPrice)} instead of resale.` },
    { q: `What size should I order in the ${SILHOUETTE[p.collection] || "this style"}?`, a: SIZING_RULE[p.collection] || "Take your normal US size." },
    { q: "How long will delivery take?", a: `Dispatched within ${POLICY.dispatchHours} hours with tracking emailed at dispatch, then ${POLICY.transitMinDays}–${POLICY.transitMaxDays} business days in transit. Shipping is free to ${POLICY.shipCountries}.` },
    { q: "What if they don't fit?", a: `You have ${POLICY.returnDays} days from delivery to return an unworn pair or swap it for another size. Email ${CFG.brand.email} with your order number and we send the return address the same day.` },
  ];

  const body = `
<section class="container pdp">
  <div class="breadcrumb"><a href="/">Home</a> / <a href="/collection/${p.collection}/">${colTitle(p.collection)}</a> / <span>${esc(p.name)}</span></div>
  <div class="pdp-grid">
    <div class="pdp-media reveal">${refl ? `<span class="badge volt floatbadge">Reflective ✦</span>` : ""}<img src="${imgW(p.image, 1000)}"${srcset(p.image, [600, 900, 1200]) ? ` srcset="${srcset(p.image, [600, 900, 1200])}" sizes="(max-width: 900px) 100vw, 50vw"` : ""} alt="${esc(p.name)} — ${esc(colTitle(p.collection))} in ${esc(colorway(p))}, side profile" width="900" height="900" fetchpriority="high" decoding="async"></div>
    <div class="pdp-info reveal" data-d="1">
      <span class="eyebrow">${colTitle(p.collection)}${refl ? " · Reflective" : ""}</span>
      <h1>${esc(p.name)}</h1>
      <div class="pdp-price">${money(p.minPrice)}${p.variants[0]?.compareAt ? `<span class="was">${money(p.variants[0].compareAt)}</span>` : ""}</div>
      <p class="pdp-value">1:1 craftsmanship · honest pricing, no resale markup · inspected before it ships</p>
      <dl class="glance" aria-label="Quick facts">
        <div><dt>Silhouette</dt><dd>${esc(SILHOUETTE[p.collection] || colTitle(p.collection))}${refl ? " · reflective" : ""}</dd></div>
        <div><dt>Colorway</dt><dd>${esc(colorway(p))}</dd></div>
        ${acc ? "" : `<div><dt>Fit</dt><dd>${esc(SIZING_SHORT[p.collection] || "True to size")}</dd></div>`}
        <div><dt>${acc ? "Options" : "Sizes"}</dt><dd>${vs.length > 1 ? `${vs.length} in stock · ${esc(vs[0].size)} to ${esc(vs[vs.length - 1].size)}` : "One size"}</dd></div>
        <div><dt>Ships</dt><dd>Free to US &amp; Canada · out in ${POLICY.dispatchHours}h · ${POLICY.transitMinDays}–${POLICY.transitMaxDays} business days</dd></div>
        <div><dt>Returns</dt><dd>${POLICY.returnDays} days from delivery, unworn</dd></div>
      </dl>
      <div class="pdp-section">
        <div class="lbl"><span>${sectionLabel}</span><span>${acc ? "" : "Unisex · US / EU"}</span></div>
        ${single ? `<p style="color:var(--muted);font-family:var(--font-mono);font-size:.8rem">One size · ${esc(vs[0]?.size || "Standard")}</p>` :
        `<div class="size-grid">${vs.map((v) => `<button class="size-btn" data-vid="${v.id}" data-size="${esc(v.size)}" data-price="${v.price}">${esc(v.main)}${v.sub ? `<small>${esc(v.sub)}</small>` : ""}</button>`).join("")}</div>`}
        ${fitNote(p)}
      </div>
      <div class="pdp-actions">
        <div class="size-warn" id="size-warn">Please select a ${acc ? "option" : "size"} first</div>
        <button class="btn btn-volt btn-block btn-lg" id="add-btn">Add to bag — ${money(p.minPrice)}</button>
      </div>
      <p class="pdp-eta" data-eta-dispatch="${Math.ceil(POLICY.dispatchHours / 24)}" data-eta-min="${POLICY.transitMinDays}" data-eta-max="${POLICY.transitMaxDays}">
        ${I.truck} Order today — dispatched within ${POLICY.dispatchHours}h, then ${POLICY.transitMinDays}–${POLICY.transitMaxDays} business days in transit.
      </p>
      <div class="trust-row">
        <div class="trust">${I.globe} ${esc(POLICY.freeShippingLine)}</div>
        <div class="trust">${I.refresh} ${esc(POLICY.returnDays)}-day returns</div>
        <div class="trust">${I.shield} Inspected before dispatch</div>
        <div class="trust">${I.lock} Secure Stripe checkout</div>
      </div>
      <div class="pay-row" aria-label="Accepted payment methods">${PAY_BADGES}</div>
      ${acc ? "" : `<details class="pdp-acc">
        <summary>Size chart &amp; how these fit</summary>
        <div class="pdp-acc-body">
          <p>${p.collection === "350-v2" ? "The 350 V2 fits close to true to size. Take your normal US size; go up a half if you're wide-footed. Women's sizes are labelled <strong>W</strong>." : "This style runs big and comes in whole sizes only — <strong>size down one</strong> from your normal US. Between sizes, take the smaller one."}</p>
          <div class="table-wrap"><table><thead><tr><th>US</th><th>UK</th><th>EU</th><th>CM</th></tr></thead><tbody>${
            [[6, 5.5, 38.7, 24], [7, 6.5, 40, 25], [8, 7.5, 41.3, 26], [9, 8.5, 42.7, 27], [10, 9.5, 44, 28], [11, 10.5, 45.3, 29], [12, 11.5, 46.7, 30], [13, 12.5, 48, 31]]
              .map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join("")}</tr>`).join("")}</tbody></table></div>
          <p><a class="link-arrow" href="/size-guide/">Full size guide <span>${I.arrow}</span></a></p>
        </div>
      </details>`}
      <div class="pdp-details">
        <h2 class="pdp-details-h">The details</h2>
        <div class="pdp-desc">${desc}</div>
        ${guides.length ? `<div class="pdp-guides" style="margin-top:20px;font-family:var(--font-mono);font-size:.8rem"><span style="color:var(--muted)">Guides:</span> ${guides.map((g) => `<a class="link-arrow" href="/blog/${g.slug}/" style="margin-right:14px">${esc(g.meta.title || g.slug)}</a>`).join("")}</div>` : ""}
      </div>
      ${pdpFaq.length ? `<div class="pdp-faq">
        <h2 class="pdp-details-h">Before you buy</h2>
        ${pdpFaq.map((f) => `<details class="pdp-acc"><summary>${esc(f.q)}</summary><div class="pdp-acc-body"><p>${esc(f.a)}</p></div></details>`).join("")}
        <p class="pdp-faq-more">More answers on the <a href="/faq/">FAQ</a>, <a href="/shipping/">shipping</a> and <a href="/returns/">returns</a> pages.</p>
      </div>` : ""}
    </div>
  </div>
  ${related.length ? `<div class="section" style="padding-bottom:40px"><div class="section-head"><h2 style="font-size:clamp(1.6rem,4vw,2.8rem)">More ${colTitle(p.collection)}</h2><a class="link-arrow" href="/collection/${p.collection}/">View all <span>${I.arrow}</span></a></div><div class="product-grid">${related.map((r, i) => card(r, i)).join("")}</div></div>` : ""}
</section>
<script type="application/json" id="pdp-data">${JSON.stringify(pdata)}</script>
<script type="application/ld+json">${JSON.stringify(ld)}</script>
<script type="application/ld+json">${JSON.stringify(crumbLd([
  { name: "Home", url: `${ORIGIN}/` },
  { name: colTitle(p.collection), url: `${ORIGIN}/collection/${p.collection}/` },
  { name: p.name, url: `${ORIGIN}/product/${p.slug}/` },
]))}</script>
${pdpFaq.length ? `<script type="application/ld+json">${JSON.stringify(faqLd(pdpFaq))}</script>\n` : ""}<script type="application/ld+json">${JSON.stringify({ "@context": "https://schema.org", "@type": "WebPage", "@id": `${ORIGIN}/product/${p.slug}/`, url: `${ORIGIN}/product/${p.slug}/`, name: p.name, isPartOf: { "@id": `${ORIGIN}/#website` }, mainEntity: { "@id": `${ORIGIN}/product/${p.slug}/#product` }, speakable: { "@type": "SpeakableSpecification", cssSelector: ["h1", ".glance", ".pdp-desc p:first-of-type"] } })}</script>\n`;

  // Title carries the searched terms (colourway + silhouette + "rep") and the
  // price, so the SERP entry answers "how much" before the click. Meta
  // description is written for CTR — benefit, price, shipping, returns — rather
  // than being the first 155 characters of scraped supplier copy.
  // Don't repeat "Reflective" when the colourway name already carries it
  // (e.g. "Static Black Reflective"), which pushed those titles past the SERP
  // truncation point for no added keyword.
  const reflSuffix = refl && !/reflective/i.test(colorway(p)) ? " · Reflective" : "";
  const title = brandedTitle(acc
    ? `${p.name} — ${money(p.minPrice)}`
    : `${colorway(p)} ${SILHOUETTE[p.collection] || ""} Rep — ${money(p.minPrice)}${reflSuffix}`.replace(/\s+/g, " "));
  const metaDesc = acc
    ? trimDesc(`${p.name} — ${money(p.minPrice)}. ${POLICY.freeShippingLine}, dispatched in ${POLICY.dispatchHours}h.`)
    : trimDesc(`1:1 rep ${colorway(p)} ${SILHOUETTE[p.collection] || ""}${refl ? " (reflective)" : /non[\s-]?reflective/i.test(p.name) ? " (non-reflective)" : ""} at ${money(p.minPrice)} — no resale markup. ${vs.length > 1 ? `Sizes ${vs[0].main}–${vs[vs.length - 1].main}. ` : ""}Free shipping, ${POLICY.returnDays}-day returns. Shop now.`.replace(/\s+/g, " "));

  return layout({
    headOpts: {
      title, desc: metaDesc,
      canonical: `${ORIGIN}/product/${p.slug}/`,
      ogImg: p.image, ogType: "product", preloadImg: imgW(p.image, 1000),
      extraMeta: `<meta property="product:price:amount" content="${p.minPrice}">\n<meta property="product:price:currency" content="${ccy}">\n<meta property="product:availability" content="${p.inStock ? "in stock" : "out of stock"}">\n<meta property="og:image:alt" content="${esc(p.name)}">\n`,
    },
    active: "",
    body,
  });
}

/* ---------------- first-party capture surfaces ---------------- */
// "Vote the next drop" — gauges demand for what to stock next. Wired by app.js -> /vote + /stats.
function voteWidget() {
  if (!drops.candidates || !drops.candidates.length) return "";
  return `
<section class="section container" id="vote">
  <div class="vote-band reveal">
    <div class="vote-head"><span class="eyebrow">You decide</span><h2>Vote the next drop</h2><p>We restock what you want. Tap the pair you want us to cop next — live results update instantly.</p></div>
    <div class="vote-grid" id="vote-grid">
      ${drops.candidates.map((d) => `<button class="vote-card" data-vote="${esc(d.id)}"><span class="vote-label">${esc(d.label)}</span>${d.sub ? `<span class="vote-sub">${esc(d.sub)}</span>` : ""}<span class="vote-bar"><span class="vote-fill" style="width:0%"></span></span><span class="vote-pct">—</span></button>`).join("")}
    </div>
    <p class="vote-note" id="vote-note">${drops.candidates.length} contenders · one vote per visitor</p>
  </div>
</section>`;
}

// Email + 2-field survey — builds the owned, retargetable list. Wired by app.js -> /subscribe.
function captureBand() {
  return `
<section class="section container">
  <div class="cta-band reveal" id="capture">
    <span class="eyebrow">Get on the list</span>
    <h2>10% off your first pair</h2>
    <p>Join the list and use code <strong class="mono">FIRSTPAIR</strong> at checkout — plus first dibs on new arrivals and the drops you voted for.</p>
    <form class="news-form" id="news-form">
      <input type="email" name="email" required placeholder="you@email.com" aria-label="Email">
      <button class="btn btn-volt" type="submit">Join</button>
      <div class="news-survey">
        <span class="news-opt">Optional — so we tailor your drops</span>
        <select name="interest" aria-label="What are you after?"><option value="">I'm into…</option><option value="350-v2">350 V2</option><option value="foam-rnnr">Foam Runners</option><option value="slides">Slides</option><option value="everything">A bit of everything</option></select>
        <select name="size" aria-label="Your size"><option value="">My size…</option>${["US 7","US 8","US 9","US 10","US 11","US 12","US 13"].map((s) => `<option value="${s}">${s}</option>`).join("")}</select>
      </div>
    </form>
    <p class="form-msg" id="news-msg" aria-live="polite"></p>
  </div>
</section>`;
}

// Homepage trust band. A first-time visitor to a replica store is running one
// question — "am I going to get scammed" — and the answer used to live only in
// a footer disclaimer. This answers it on the page they land on, and routes
// them to the policy that covers their specific worry.
function trustBand() {
  const items = [
    { i: I.globe, h: "Free shipping, no threshold", p: `Every order ships free to ${POLICY.shipCountries}, tracked, with the label out the door in ${POLICY.dispatchHours} hours.`, href: "/shipping/", cta: "Shipping details" },
    { i: I.refresh, h: `${POLICY.returnDays} days to change your mind`, p: "Sizing is the reason almost every pair comes back. Send it back unworn and we refund or swap it, no argument.", href: "/returns/", cta: "Returns policy" },
    { i: I.lock, h: "Checkout you can verify", p: "Card details go to Stripe's own hosted page — never to this site. Apple Pay, Google Pay and Link all work.", href: "/faq/", cta: "Read the FAQ" },
    { i: I.shield, h: "We say it's a rep", p: "Openly replica-labelled, never sold as authentic. Compare ours against a retail pair yourself before you decide.", href: "/blog/rep-vs-real-yeezy-350-v2/", cta: "Rep vs real" },
  ];
  return `
<section class="section container" style="padding-top:0">
  <div class="section-head"><div><span class="eyebrow">No surprises</span><h2>How buying<br>here works</h2></div><a class="link-arrow" href="/faq/">All questions <span>${I.arrow}</span></a></div>
  <div class="trust-band">
    ${items.map((t, i) => `<a class="tb-card reveal" data-d="${i + 1}" href="${t.href}">
      <span class="tb-ico">${t.i}</span>
      <h3>${t.h}</h3>
      <p>${t.p}</p>
      <span class="tb-cta">${t.cta} ${I.arrow}</span>
    </a>`).join("")}
  </div>
</section>`;
}

function quizCTA() {
  return `
<section class="section container">
  <a class="quiz-cta reveal" href="/quiz/">
    <div><span class="eyebrow">60-second style match</span><h2>Find your pair</h2><p>Answer 3 questions, get the silhouette built for you.</p></div>
    <span class="quiz-cta-go">Take the quiz ${I.arrow}</span>
  </a>
</section>`;
}

/* ---------------- blog ---------------- */
function mdInline(s) {
  s = esc(s);
  s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, '<img src="$2" alt="$1" loading="lazy" class="post-img">');
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2">$1</a>');
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/(^|[^*])\*([^*\s][^*]*?)\*/g, "$1<em>$2</em>");
  s = s.replace(/`([^`]+)`/g, "<code>$1</code>");
  return s;
}
function mdToHtml(md) {
  const lines = String(md).replace(/\r\n/g, "\n").split("\n");
  const out = []; let para = []; let i = 0;
  const flush = () => { if (para.length) { out.push(`<p>${mdInline(para.join(" "))}</p>`); para = []; } };
  while (i < lines.length) {
    const line = lines[i];
    if (/^\s*$/.test(line)) { flush(); i++; continue; }
    if (/^###\s+/.test(line)) { flush(); out.push(`<h3>${mdInline(line.replace(/^###\s+/, ""))}</h3>`); i++; continue; }
    if (/^##?\s+/.test(line)) { flush(); out.push(`<h2>${mdInline(line.replace(/^##?\s+/, ""))}</h2>`); i++; continue; }
    if (/^>\s?/.test(line)) { flush(); const q = []; while (i < lines.length && /^>\s?/.test(lines[i])) { q.push(lines[i].replace(/^>\s?/, "")); i++; } out.push(`<blockquote>${mdInline(q.join(" "))}</blockquote>`); continue; }
    if (/^---\s*$/.test(line)) { flush(); out.push("<hr>"); i++; continue; }
    if (/^[-*]\s+/.test(line)) { flush(); const it = []; while (i < lines.length && /^[-*]\s+/.test(lines[i])) { it.push(`<li>${mdInline(lines[i].replace(/^[-*]\s+/, ""))}</li>`); i++; } out.push(`<ul>${it.join("")}</ul>`); continue; }
    if (/^\d+\.\s+/.test(line)) { flush(); const it = []; while (i < lines.length && /^\d+\.\s+/.test(lines[i])) { it.push(`<li>${mdInline(lines[i].replace(/^\d+\.\s+/, ""))}</li>`); i++; } out.push(`<ol>${it.join("")}</ol>`); continue; }
    if (/^!\[[^\]]*\]\([^)]+\)\s*$/.test(line)) { flush(); out.push(`<figure>${mdInline(line)}</figure>`); i++; continue; }
    // GFM pipe tables — size charts and policy timelines read far better as a
    // table than as prose, and Google parses them for structured answers.
    if (/^\s*\|.*\|\s*$/.test(line) && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1] || "")) {
      flush();
      const cells = (ln) => ln.trim().replace(/^\||\|$/g, "").split("|").map((c) => mdInline(c.trim()));
      const head = cells(line);
      i += 2;
      const rows = [];
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) { rows.push(cells(lines[i])); i++; }
      out.push(`<div class="table-wrap"><table><thead><tr>${head.map((c) => `<th>${c}</th>`).join("")}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`);
      continue;
    }
    para.push(line); i++;
  }
  flush();
  return out.join("\n");
}
// Auto-detects Q&A-style sections (## heading ending in "?") and turns them into
// FAQPage entries — no frontmatter authoring needed, and it only fires on posts
// already written in question form (e.g. the sizing guides).
function extractFaq(body) {
  const lines = String(body).replace(/\r\n/g, "\n").split("\n");
  const faq = []; let i = 0;
  while (i < lines.length) {
    const h = lines[i].match(/^##\s+(.+?)\s*\?\s*$/);
    if (!h) { i++; continue; }
    const q = `${h[1].trim()}?`;
    i++;
    while (i < lines.length && /^\s*$/.test(lines[i])) i++; // skip blank lines after the heading
    const ansLines = [];
    while (i < lines.length && !/^##?\s+/.test(lines[i])) {
      if (/^\s*$/.test(lines[i])) {
        if (!/^>\s?/.test(lines[i + 1] || "")) break; // stop unless a blockquote continues the thought
        i++; continue;
      }
      ansLines.push(lines[i].replace(/^>\s?/, "")); i++;
    }
    const plain = ansLines.join(" ")
      .replace(/!\[[^\]]*\]\([^)]+\)/g, "")
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
      .replace(/\*\*([^*]+)\*\*/g, "$1")
      .replace(/(^|[^*])\*([^*\s][^*]*?)\*/g, "$1$2")
      .replace(/`([^`]+)`/g, "$1")
      .replace(/^>\s?/gm, "")
      .replace(/^[-*]\s+/gm, "")
      .replace(/\s+/g, " ")
      .trim();
    if (plain) faq.push({ q, a: plain });
  }
  return faq;
}
function parsePost(raw, slug) {
  raw = String(raw).replace(/\r\n/g, "\n"); // normalize CRLF so frontmatter parses on any platform
  const m = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  const meta = {}; let body = raw;
  if (m) {
    body = m[2];
    for (const ln of m[1].split("\n")) {
      const mm = ln.match(/^(\w+):\s*(.*)$/);
      if (!mm) continue;
      let v = mm[2].trim();
      if (/^\[.*\]$/.test(v)) v = v.slice(1, -1).split(",").map((x) => x.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
      else v = v.replace(/^["']|["']$/g, "");
      meta[mm[1]] = v;
    }
  }
  return { slug, meta, html: mdToHtml(body), faq: extractFaq(body), excerpt: meta.excerpt || body.replace(/[#>*`\-]/g, "").trim().slice(0, 150) };
}
const POSTS_DIR = path.join(ROOT, "data/posts");
const posts = fs.existsSync(POSTS_DIR)
  ? fs.readdirSync(POSTS_DIR).filter((f) => f.endsWith(".md"))
      .map((f) => parsePost(fs.readFileSync(path.join(POSTS_DIR, f), "utf8"), f.replace(/\.md$/, "")))
      .sort((a, b) => String(b.meta.date || "").localeCompare(String(a.meta.date || "")))
  : [];

const fmtDate = (d) => { try { return new Date(d + "T00:00:00Z").toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" }); } catch { return d || ""; } };
const postImg = (p) => p.cover || OG_DEFAULT;

/* ---------------- blog cover art system ----------------
   Deterministic, self-contained SVG covers (SVG-in-<img> can't load external
   fonts/photos, so everything is vector): editorial layout — pillar chip, big
   wrapped display title, pillar-coded background geometry, and a duotone vector
   silhouette of the shoe type the post is about (350 / Foam RNNR / Slide).
   No brand logos or trademarks — silhouettes only. */

const COVER_SHOES = {
  // Local coords ~ 540x300, toe pointing right. Drawn as: fill body + volt outline,
  // knit/foam texture clipped inside, sole line, ground shadow.
  "350": {
    body: "M22,214 C16,182 34,148 84,122 C138,94 216,76 296,80 C382,84 450,116 488,160 C504,178 510,196 505,212 C500,229 480,237 450,239 L84,245 C48,245 27,237 22,214 Z",
    detail: '<path d="M26,204 C130,226 390,230 500,194" fill="none" stroke="#0a0a0b" stroke-width="7" opacity="0.85"/><path d="M96,120 C150,158 210,170 296,166" fill="none" stroke="#d8ff3e" stroke-width="2.4" opacity="0.5"/><ellipse cx="112" cy="112" rx="34" ry="14" fill="none" stroke="#d8ff3e" stroke-width="2.4" opacity="0.6" transform="rotate(-14 112 112)"/>',
    texture: "knit",
  },
  foam: {
    body: "M26,206 C10,162 30,110 90,82 C158,50 248,46 326,70 C404,94 470,138 492,180 C506,208 496,232 460,238 L76,244 C42,244 34,228 26,206 Z",
    detail: ["150,118,30,21,-18", "236,96,32,23,-6", "318,108,27,19,10", "196,172,25,17,-12", "298,168,29,19,4", "392,150,24,16,14"]
      .map((h) => { const [x, y, rx, ry, r] = h.split(","); return `<ellipse cx="${x}" cy="${y}" rx="${rx}" ry="${ry}" fill="#0a0a0b" stroke="#d8ff3e" stroke-width="2" opacity="0.95" transform="rotate(${r} ${x} ${y})"/>`; }).join(""),
    texture: "none",
  },
  slide: {
    body: "M24,150 C24,116 66,94 148,84 L396,60 C452,54 490,80 496,118 L502,186 C505,220 486,240 448,240 L66,242 C36,242 24,226 24,196 Z",
    detail: '<path d="M52,242 L58,214 M118,242 L124,210 M188,243 L194,208 M258,243 L264,208 M328,242 L334,208 M398,241 L404,208" stroke="#0a0a0b" stroke-width="9" stroke-linecap="round"/><path d="M40,140 C160,108 330,88 480,102" fill="none" stroke="#d8ff3e" stroke-width="2.4" opacity="0.5"/>',
    texture: "foam",
  },
};
const coverShoeFor = (p) => {
  const hay = (p.slug + " " + (Array.isArray(p.meta.products) ? p.meta.products.join(" ") : p.meta.products || "")).toLowerCase();
  if (/foam|rnnr/.test(hay)) return "foam";
  if (/slide/.test(hay)) return "slide";
  return "350";
};
const coverWrap = (title, max = 15) => {
  const words = String(title || "").toUpperCase().replace(/[—–]/g, "-").split(/\s+/);
  const lines = [];
  let cur = "";
  for (const w of words) {
    if ((cur + " " + w).trim().length > max && cur) { lines.push(cur.trim()); cur = w; }
    else cur = (cur + " " + w).trim();
    if (lines.length === 3) break;
  }
  if (lines.length < 3 && cur) lines.push(cur.trim());
  if (lines.length === 3 && words.join(" ").length > lines.join(" ").length + cur.length) lines[2] = lines[2].replace(/\W*$/, "") + "…";
  return lines.slice(0, 3);
};

function blogCover(p) {
  const slug = p.slug || "post";
  let s = 2166136261; for (let i = 0; i < slug.length; i++) { s ^= slug.charCodeAt(i); s = Math.imul(s, 16777619) >>> 0; }
  const rand = () => { s = (Math.imul(s, 1103515245) + 12345) >>> 0; return s / 4294967296; };
  const W = 1200, H = 750, volt = "#d8ff3e", bg = "#0a0a0b", body = "#16161a", ink = "#f4f4f1", muted = "#9a9aa0";
  const tag = String(p.meta.tag || "Journal").toUpperCase();
  const shoe = COVER_SHOES[coverShoeFor(p)];
  const lines = coverWrap(p.meta.title);
  const fsz = lines.some((l) => l.length > 13) ? 58 : 68;
  const titleY = 300;

  // Pillar-coded backdrop geometry (deterministic accent placement per slug).
  const MOTIFS = {
    GUIDES: () => Array.from({ length: 5 }, (_, i) => `<circle cx="${W - 210}" cy="${190}" r="${120 + i * 110}" fill="none" stroke="${volt}" stroke-width="1.1" opacity="${(0.16 - i * 0.025).toFixed(3)}"/>`).join(""),
    SIZING: () => { let d = ""; for (let y = 70; y < H - 60; y += 52) for (let x = 660; x < W - 40; x += 52) { const op = 0.05 + rand() * 0.12; d += `<circle cx="${x}" cy="${y}" r="1.6" fill="${volt}" opacity="${op.toFixed(3)}"/>`; } return d; },
    STYLING: () => Array.from({ length: 6 }, (_, i) => `<path d="M620,${90 + i * 110} C 800,${60 + i * 110} 1000,${130 + i * 110} 1240,${80 + i * 110}" fill="none" stroke="${volt}" stroke-width="1.2" opacity="${(0.14 - i * 0.015).toFixed(3)}"/>`).join(""),
    CULTURE: () => `<g stroke="${volt}" stroke-width="1" opacity="0.12">${Array.from({ length: 7 }, (_, i) => `<line x1="${640 + i * 90}" y1="40" x2="${640 + i * 90}" y2="${H - 40}"/>`).join("")}${Array.from({ length: 6 }, (_, i) => `<line x1="620" y1="${90 + i * 110}" x2="${W - 40}" y2="${90 + i * 110}"/>`).join("")}</g><circle cx="${840 + Math.round(rand() * 200)}" cy="${170 + Math.round(rand() * 160)}" r="7" fill="${volt}" opacity="0.7"/>`,
    DEFAULT: () => Array.from({ length: 5 }, (_, i) => `<line x1="${540 + i * 140}" y1="-40" x2="${340 + i * 140}" y2="${H + 40}" stroke="${volt}" stroke-width="${(1 + rand()).toFixed(1)}" opacity="${(0.05 + rand() * 0.08).toFixed(3)}"/>`).join(""),
  };
  const motif = (MOTIFS[tag] || MOTIFS[tag === "EXPLAINERS" || tag === "LISTS" ? "DEFAULT" : "DEFAULT"] || MOTIFS.DEFAULT)();

  // Texture clipped inside the silhouette body.
  let tex = "";
  if (shoe.texture === "knit") tex = Array.from({ length: 11 }, (_, i) => `<path d="M0,${70 + i * 18} C 140,${58 + i * 18} 380,${84 + i * 18} 540,${64 + i * 18}" fill="none" stroke="${volt}" stroke-width="1.1" opacity="0.16"/>`).join("");
  else if (shoe.texture === "foam") tex = Array.from({ length: 14 }, (_, i) => `<circle cx="${60 + rand() * 420}" cy="${80 + rand() * 140}" r="${(2 + rand() * 4).toFixed(1)}" fill="${volt}" opacity="0.14"/>`).join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(p.meta.title || "Kicks on Deck")}">
<defs>
<filter id="grain"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" stitchTiles="stitch"/><feColorMatrix type="saturate" values="0"/><feComponentTransfer><feFuncA type="linear" slope="0.05"/></feComponentTransfer></filter>
<radialGradient id="floor" cx="50%" cy="50%" r="50%"><stop offset="0%" stop-color="${volt}" stop-opacity="0.28"/><stop offset="100%" stop-color="${volt}" stop-opacity="0"/></radialGradient>
<radialGradient id="wash" cx="78%" cy="30%" r="70%"><stop offset="0%" stop-color="${volt}" stop-opacity="0.10"/><stop offset="100%" stop-color="${volt}" stop-opacity="0"/></radialGradient>
<clipPath id="shoeclip"><path d="${shoe.body}"/></clipPath>
</defs>
<rect width="${W}" height="${H}" fill="${bg}"/>
<rect width="${W}" height="${H}" fill="url(#wash)"/>
${motif}
<g transform="translate(620,330) rotate(-8)">
  <ellipse cx="270" cy="268" rx="290" ry="42" fill="url(#floor)"/>
  <path d="${shoe.body}" fill="${body}" stroke="${volt}" stroke-width="3"/>
  <g clip-path="url(#shoeclip)">${tex}</g>
  ${shoe.detail}
</g>
<g font-family="ui-monospace, monospace">
  <rect x="60" y="64" rx="17" height="34" width="${34 + tag.length * 16}" fill="${volt}"/>
  <text x="${60 + 17 + tag.length * 8}" y="87" fill="${bg}" font-size="19" letter-spacing="4" font-weight="700" text-anchor="middle">${esc(tag)}</text>
</g>
<g font-family="system-ui, sans-serif" font-weight="800" fill="${ink}" letter-spacing="-1">
${lines.map((l, i) => `  <text x="62" y="${titleY + i * (fsz + 12)}" font-size="${fsz}">${esc(l)}</text>`).join("\n")}
</g>
<line x1="62" y1="${H - 118}" x2="342" y2="${H - 118}" stroke="${volt}" stroke-width="3"/>
<g font-family="ui-monospace, monospace">
  <text x="62" y="${H - 74}" fill="${ink}" font-size="30" font-weight="800" letter-spacing="1" font-family="system-ui, sans-serif">KICKS ON DECK</text>
  <text x="62" y="${H - 42}" fill="${muted}" font-size="19" letter-spacing="4">KICKSONDECK.STORE</text>
</g>
<rect width="${W}" height="${H}" filter="url(#grain)" opacity="0.55"/>
</svg>`;
}

function postCard(p) {
  return `<a class="post-card reveal" href="/blog/${p.slug}/">
    <div class="post-thumb"><img src="${postImg(p)}" alt="${esc(p.meta.title || p.slug)}" loading="lazy"></div>
    <div class="post-meta">${p.meta.tag ? `<span class="post-tag">${esc(p.meta.tag)}</span>` : ""}<span class="post-date">${fmtDate(p.meta.date)}</span></div>
    <h2 class="post-card-title">${esc(p.meta.title || p.slug)}</h2>
    <p>${esc(p.excerpt)}</p>
    <span class="post-readmore">Read ${I.arrow}</span>
  </a>`;
}

function blogIndexPage() {
  const [feat, ...rest] = posts;
  const body = `
<section class="container shop-head">
  <span class="eyebrow">The Journal</span>
  <h1>Drops, guides<br>& culture</h1>
  <p style="color:var(--ink-dim);max-width:60ch;margin-top:18px">Sizing guides, rep-vs-real breakdowns, styling, and the Yeezy/hypebeast news worth knowing — written for people who actually wear them.</p>
</section>
<section class="container" style="padding-bottom:120px">
  ${posts.length ? `<div class="post-grid">${posts.map(postCard).join("")}</div>` : `<p style="color:var(--muted)">New stories dropping soon.</p>`}
  ${voteWidget()}
</section>`;
  const blogLd = {
    "@context": "https://schema.org", "@type": "Blog", "@id": `${ORIGIN}/blog/#blog`, name: "Kicks on Deck Journal", url: `${ORIGIN}/blog/`,
    description: "Sizing guides, rep-vs-real breakdowns, styling tips and Yeezy/hypebeast culture from Kicks on Deck.",
    publisher: { "@type": "Organization", name: "Kicks on Deck", url: `${ORIGIN}/` },
    blogPost: posts.map((p) => ({ "@type": "BlogPosting", headline: p.meta.title, url: `${ORIGIN}/blog/${p.slug}/`, datePublished: p.meta.date })),
  };
  return layout({ headOpts: { title: "Blog — Sneaker Guides, Yeezy News & Culture | Kicks on Deck", desc: "Sizing guides, rep-vs-real breakdowns, styling tips and Yeezy/hypebeast culture from Kicks on Deck.", canonical: `${ORIGIN}/blog/`, ogImg: feat ? postImg(feat) : OG_DEFAULT, ld: [crumbLd([{ name: "Home", url: `${ORIGIN}/` }, { name: "Blog", url: `${ORIGIN}/blog/` }]), blogLd] }, active: "/blog/", body });
}

function blogPostPage(p) {
  const related = (Array.isArray(p.meta.products) ? p.meta.products : (p.meta.products ? [p.meta.products] : []))
    .map((slug) => products.find((x) => x.slug === slug)).filter(Boolean).slice(0, 4);
  const updated = p.meta.updated || p.meta.date;
  // Answer-first: the literal answer, not a description of the post. Priority:
  // hand-written `answer:` frontmatter -> the first question-H2's answer ->
  // the opening paragraph. Clipped at a sentence boundary.
  const firstPara = (p.html.match(/<p>([\s\S]*?)<\/p>/) || [])[1] || "";
  const clipAnswer = (t = "") => { t = cleanSentence(t); if (t.length <= 320) return t; const cut = t.slice(0, 320); const i = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("! "), cut.lastIndexOf("? ")); return i > 120 ? cut.slice(0, i + 1) : cut.replace(/\s+\S*$/, "") + "…"; };
  const answer = clipAnswer(p.meta.answer || (p.faq && p.faq[0] && p.faq[0].a) || firstPara || p.meta.description || p.excerpt);
  const words = p.html.replace(/<[^>]+>/g, " ").split(/\s+/).filter(Boolean).length;
  const coverAbs = /^\//.test(postImg(p)) ? ORIGIN + postImg(p) : postImg(p);
  const ld = {
    "@context": "https://schema.org", "@type": "BlogPosting", "@id": `${ORIGIN}/blog/${p.slug}/#post`,
    headline: p.meta.title, image: [coverAbs],
    datePublished: p.meta.date, dateModified: updated,
    author: { "@type": "Organization", name: "Kicks on Deck", url: `${ORIGIN}/about/` },
    publisher: { "@type": "Organization", name: "Kicks on Deck", url: `${ORIGIN}/`, logo: { "@type": "ImageObject", url: LOGO_URL } },
    mainEntityOfPage: `${ORIGIN}/blog/${p.slug}/`, description: p.meta.description || p.excerpt,
    articleSection: p.meta.tag || "Journal", wordCount: words, inLanguage: "en-US", isAccessibleForFree: true,
    keywords: [p.meta.tag, ...(Array.isArray(p.meta.products) ? p.meta.products.map((sl) => (products.find((x) => x.slug === sl) || {}).name).filter(Boolean) : [])].filter(Boolean).join(", "),
    speakable: { "@type": "SpeakableSpecification", cssSelector: ["h1", ".quick-answer p"] },
  };
  const faqLd = (p.faq && p.faq.length) ? {
    "@context": "https://schema.org", "@type": "FAQPage",
    mainEntity: p.faq.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })),
  } : null;
  const body = `
<article class="container post">
  <div class="breadcrumb"><a href="/">Home</a> / <a href="/blog/">Blog</a> / <span>${esc(p.meta.title || p.slug)}</span></div>
  <header class="post-header reveal">
    ${p.meta.tag ? `<span class="post-tag">${esc(p.meta.tag)}</span>` : ""}
    <h1>${esc(p.meta.title || p.slug)}</h1>
    <p class="post-byline">Kicks on Deck · ${fmtDate(p.meta.date)}${updated !== p.meta.date ? ` · Updated ${fmtDate(updated)}` : ""}${p.meta.read ? ` · ${esc(p.meta.read)}` : ""}</p>
  </header>
  ${answer ? `<div class="quick-answer reveal"><span class="qa-label">Quick answer</span><p>${esc(answer)}</p></div>` : ""}
  <div class="post-hero reveal"><img src="${postImg(p)}" alt="${esc(p.meta.title || "")}" width="1200" height="750" fetchpriority="high" decoding="async"></div>
  <div class="post-body reveal">${p.html}</div>
  ${related.length ? `<div class="section" style="padding-top:30px"><div class="section-head"><h2 style="font-size:clamp(1.4rem,3.5vw,2.2rem)">Shop the pairs</h2><a class="link-arrow" href="/shop/">All styles <span>${I.arrow}</span></a></div><div class="product-grid">${related.map((r, i) => card(r, i)).join("")}</div></div>` : ""}
</article>
${quizCTA()}
${captureBand()}
<script type="application/ld+json">${JSON.stringify(ld)}</script>
<script type="application/ld+json">${JSON.stringify(crumbLd([
  { name: "Home", url: `${ORIGIN}/` },
  { name: "Blog", url: `${ORIGIN}/blog/` },
  { name: p.meta.title || p.slug, url: `${ORIGIN}/blog/${p.slug}/` },
]))}</script>
${faqLd ? `<script type="application/ld+json">${JSON.stringify(faqLd)}</script>\n` : ""}`;
  const extraMeta = `<meta property="og:image:width" content="1200">\n<meta property="og:image:height" content="750">\n<meta property="article:published_time" content="${p.meta.date}">\n<meta property="article:modified_time" content="${updated}">\n<meta property="article:section" content="${esc(p.meta.tag || "Journal")}">\n`;
  return layout({ headOpts: { title: brandedTitle(p.meta.seoTitle || p.meta.title), desc: trimDesc(p.meta.description || p.excerpt), canonical: `${ORIGIN}/blog/${p.slug}/`, ogImg: postImg(p), ogType: "article", extraMeta }, active: "/blog/", body });
}

/* ---------------- static trust / policy pages ----------------
   data/pages/*.md -> /<slug>/. These exist because the store had no shipping,
   returns, privacy, terms, FAQ, about or contact page at all — the footer's
   "Privacy" and "Terms" links both pointed at /shop/. For a store that is
   openly selling replicas, "where are the policies" is the first thing a
   cautious buyer checks and the fastest way to lose them. Content is authored
   in markdown with {{TOKENS}} so every number stays tied to site.config.json. */

const PAGE_TOKENS = {
  EMAIL: CFG.brand.email,
  EMAILLINK: `mailto:${CFG.brand.email}`,
  PHONE: CFG.brand.phone,
  CITY: CFG.brand.city,
  COUNT: String(products.length),
  DISPATCH: String(POLICY.dispatchHours),
  TRANSITMIN: String(POLICY.transitMinDays),
  TRANSITMAX: String(POLICY.transitMaxDays),
  RETURNDAYS: String(POLICY.returnDays),
  COUNTRIES: POLICY.shipCountries,
  FREESHIPLINE: POLICY.freeShippingLine,
};
const fillTokens = (s = "") => String(s).replace(/\{\{(\w+)\}\}/g, (m, k) => (k in PAGE_TOKENS ? PAGE_TOKENS[k] : m));

const PAGES_DIR = path.join(ROOT, "data/pages");
const pages = fs.existsSync(PAGES_DIR)
  ? fs.readdirSync(PAGES_DIR).filter((f) => f.endsWith(".md"))
      .map((f) => {
        const raw = fillTokens(fs.readFileSync(path.join(PAGES_DIR, f), "utf8"));
        const p = parsePost(raw, f.replace(/\.md$/, ""));
        p.meta.updated = p.meta.updated || new Date().toISOString().slice(0, 10);
        p.html = p.html.replace(/\{\{UPDATED\}\}/g, fmtDate(p.meta.updated));
        return p;
      })
  : [];

function staticPage(p) {
  const url = `${ORIGIN}/${p.slug}/`;
  const isFaq = p.slug === "faq";
  const ld = [
    crumbLd([{ name: "Home", url: `${ORIGIN}/` }, { name: p.meta.title || p.slug, url }]),
    {
      "@context": "https://schema.org",
      "@type": isFaq ? "FAQPage" : p.slug === "contact" ? "ContactPage" : p.slug === "about" ? "AboutPage" : "WebPage",
      name: p.meta.title, url, description: p.meta.description,
      dateModified: p.meta.updated,
      isPartOf: { "@id": `${ORIGIN}/#website` },
      publisher: { "@id": `${ORIGIN}/#org` },
      ...(isFaq && p.faq.length ? { mainEntity: p.faq.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })) } : {}),
    },
  ];
  const body = `
<section class="container shop-head">
  <div class="breadcrumb"><a href="/">Home</a> / <span>${esc(p.meta.title || p.slug)}</span></div>
  <span class="eyebrow">${esc(p.meta.eyebrow || "Info")}</span>
  <h1>${p.meta.h1 || esc(p.meta.title || p.slug)}</h1>
  <p class="page-updated">Last updated ${fmtDate(p.meta.updated)}</p>
</section>
<section class="container" style="padding-bottom:110px">
  <div class="post-body doc-body">${p.html}</div>
  <div class="doc-nav">${PAGE_NAV.filter((l) => l.href !== `/${p.slug}/`).map((l) => `<a href="${l.href}">${l.label}</a>`).join("")}</div>
</section>
${captureBand()}`;
  return layout({ headOpts: { title: brandedTitle(p.meta.seoTitle || p.meta.title), desc: trimDesc(p.meta.description || p.excerpt), canonical: url, ld }, active: "", body });
}

/* ---------------- quiz ---------------- */
function quizPage() {
  const collMap = Object.fromEntries(collections.map((c) => [c.slug, c.title]));
  const body = `
<section class="container shop-head">
  <span class="eyebrow">Find your pair</span>
  <h1>Which pair<br>is you?</h1>
  <p style="color:var(--ink-dim);max-width:54ch;margin-top:18px">Three quick questions. We'll match you to the silhouette that fits your vibe — and you'll help us learn what to stock next.</p>
</section>
<section class="container" style="padding-bottom:120px">
  <div class="quiz" id="quiz" data-coll='${JSON.stringify(collMap)}'>
    <div class="quiz-progress"><span class="quiz-bar" id="quiz-bar" style="width:0%"></span></div>
    <div id="quiz-stage"></div>
    <div class="quiz-result" id="quiz-result" hidden></div>
  </div>
</section>
${captureBand()}
<script type="application/json" id="quiz-data">${JSON.stringify(quiz)}</script>`;
  return layout({ headOpts: { title: "Find Your Pair — Sneaker Style Quiz | Kicks on Deck", desc: "Take the 60-second quiz and get matched to the Yeezy silhouette built for your style — 350 V2, Foam Runner or Slide — plus the size and colourway to start with.", canonical: `${ORIGIN}/quiz/` }, active: "", body });
}

/* ---------------- write ---------------- */
function write(rel, content) {
  const full = path.join(ROOT, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
}

// Category-page intros carry the buying-guide language people actually search
// ("do they run big", "how much", "which colourway") instead of a tagline and a
// count, which is all these pages used to say above 62 product tiles.
const COLLECTION_INTRO = {
  "350-v2": `Every 350 V2 colourway we stock, built 1:1 and priced from ${money(Math.min(...products.filter((p) => p.collection === "350-v2").map((p) => p.minPrice)))} instead of resale. Knit uppers, boost-grade midsoles, matched cage and stripe placement. Fits close to true to size — women's sizes are labelled W, and the sizing guide settles the half-size question in two minutes. Free shipping to ${POLICY.shipCountries}, ${POLICY.returnDays}-day returns.`,
  "foam-rnnr": `The full Foam Runner rotation — one-piece moulded EVA-blend clogs with the lattice vents, in every colourway we can get. They run big and come in whole sizes only, so size down one from your usual US. Free shipping to ${POLICY.shipCountries}, ${POLICY.returnDays}-day returns if you get the fit wrong.`,
  slides: `Yeezy-silhouette slides in every colourway we stock — moulded foam, contoured arch, the pair that ends up getting worn more than anything else you own. They run big and only come in whole sizes: size down one, or two if you like them snug. Free shipping, ${POLICY.returnDays}-day returns.`,
  accessories: `Cleaning and care gear for knit, foam and rubber. The cheapest way to make a pair last twice as long, and the only thing here that isn't footwear.`,
};

let n = 0;
write("index.html", homePage()); n++;
write("shop/index.html", gridPage({ title: `Shop All Rep Sneakers — ${products.length} Styles from ${money(Math.min(...products.map((p) => p.minPrice)))} | Kicks on Deck`, h1: "Shop<br>All", eyebrow: `The full rotation · ${products.length} styles`, list: products, canonical: `${ORIGIN}/shop/`, active: "/shop/", intro: `All ${products.length} styles in stock — 350 V2, Foam Runners, Slides and care gear, built 1:1 and priced without the resale markup. Filter by silhouette, sort by price, and check the size guide before you pick. Free shipping to ${POLICY.shipCountries}, ${POLICY.returnDays}-day returns.`, showFilters: true })); n++;
for (const c of collections) {
  const list = products.filter((p) => p.collection === c.slug);
  const lo = list.length ? money(Math.min(...list.map((p) => p.minPrice))) : "";
  write(`collection/${c.slug}/index.html`, gridPage({
    title: `${c.title} Reps — ${c.count} Colourways${lo ? ` from ${lo}` : ""} | Kicks on Deck`,
    h1: c.title.replace(/ /g, "<br>"), eyebrow: c.tagline, list,
    canonical: `${ORIGIN}/collection/${c.slug}/`, active: `/collection/${c.slug}/`,
    intro: COLLECTION_INTRO[c.slug] || `${c.count} ${c.title} styles in rotation. ${c.tagline}.`,
    showFilters: false, slug: c.slug,
  }));
  n++;
}
for (const p of products) { write(`product/${p.slug}/index.html`, productPage(p)); n++; }

// blog + quiz
for (const p of posts) {
  // Cover priority: explicit frontmatter -> photographic render from
  // scripts/covers/render.mjs (assets/blog/<slug>.webp, produced by the
  // blog-covers GitHub Action) -> deterministic SVG fallback so a brand-new
  // post is never coverless while the render is in flight.
  if (p.meta.cover || p.meta.image) p.cover = p.meta.cover || p.meta.image;
  else if (fs.existsSync(path.join(ROOT, "assets", "blog", `${p.slug}.webp`))) p.cover = `/assets/blog/${p.slug}.webp`;
  else { p.cover = `/assets/blog/${p.slug}.svg`; write(`assets/blog/${p.slug}.svg`, blogCover(p)); }
}
write("blog/index.html", blogIndexPage()); n++;
for (const p of posts) { write(`blog/${p.slug}/index.html`, blogPostPage(p)); n++; }
write("quiz/index.html", quizPage()); n++;

// trust / policy pages
for (const p of pages) { write(`${p.slug}/index.html`, staticPage(p)); n++; }

// 404
// A 404 is a live shopper who followed a stale link — give them the routes
// back into the catalogue rather than one button and a dead end.
write("404.html", layout({ headOpts: { title: "Page Not Found — Kicks on Deck", desc: `That page has moved or never existed. Jump back into the rotation — ${products.length} styles in stock, free shipping and ${POLICY.returnDays}-day returns.`, canonical: `${ORIGIN}/404`, robots: "noindex,follow" }, active: "", body: `<section class="container" style="min-height:70vh;display:grid;place-items:center;text-align:center;padding-top:120px"><div><h1 class="footer-giant" style="-webkit-text-stroke:1px var(--volt);margin:0">404</h1><p class="eyebrow" style="margin:20px 0">This pair walked off</p><p style="color:var(--ink-dim);max-width:46ch;margin:0 auto 26px">The link is stale, but the rotation isn't — ${products.length} styles are in stock right now.</p><a class="btn btn-volt btn-lg" href="/shop/">Back to the shop ${I.arrow}</a><div class="doc-nav" style="justify-content:center;border:0;margin-top:34px">${[...navLinks.slice(0, 4), ...PAGE_NAV.slice(0, 4)].map((l) => `<a href="${l.href}">${l.label}</a>`).join("")}</div></div></section>` }));

// legacy URL redirects (pre-restructure paths still receiving search traffic)
// data-driven so new legacy-URL leaks found in GA4 landing-page reports can be added
// as one line each, instead of hand-authoring a static stub file per path.
const REDIRECTS = {
  "collections": "/shop/",
  "blogs/news": "/blog/",
  "blogs/news/revolutionizing-footwear-how-adidas-and-kanye-wests-yeezy-boost-350-dominates-the-sneaker-world": "/blog/best-yeezy-350-v2-2026/",
  "blogs/news/step-into-style-and-comfort-discover-the-iconic-yeezy-boost-350-at-kicksondeck-store": "/collection/350-v2/",
  "blogs/news/yeezy-boost-350-discover-why-these-iconic-sneakers-are-must-haves-for-collectors-kicksondeck-store": "/blog/best-yeezy-350-v2-2026/",
  "blogs/news/discover-how-the-yeezy-boost-350-redefines-sneaker-culture-a-deep-dive-into-the-adidas-and-kanye-west-phenomenon": "/blog/yeezy-350-v2-colorways-guide/",
  "blogs/news/discover-the-ultimate-fusion-of-fashion-and-function-with-adidas-yeezy-boost-350-at-kicksondeck-store": "/blog/best-yeezy-350-v2-2026/",
  "blogs/news/uncover-the-hype-why-adidas-yeezy-boost-350-sneakers-are-a-must-have-for-fashion-and-comfort": "/blog/best-yeezy-350-v2-2026/",
  "blogs/news/unlock-the-legacy-why-adidas-yeezy-boost-350-sneakers-are-a-must-have-for-sneakerheads-and-style-enthusiasts": "/blog/yeezy-350-v2-colorways-guide/",
  "blogs/news/unlock-yeezy-magic-discover-the-hype-of-adidas-yeezy-boost-350-at-kicksondeck-store": "/blog/best-yeezy-350-v2-2026/",
  "blogs/news/kanye-wests-legal-drama-genius-or-delusion": "/blog/",
  "blogs/news/unleash-style-and-comfort-the-impact-of-yeezy-boost-350-on-sneaker-culture": "/blog/yeezy-350-v2-colorways-guide/",
  "blogs/news/unlocking-the-hype-why-the-adidas-yeezy-boost-350-is-a-must-have-for-sneaker-enthusiasts": "/blog/best-yeezy-350-v2-2026/",
  "blogs/news/why-the-adidas-yeezy-boost-350-continues-to-dominate-sneaker-culture-a-deep-dive-from-kicksondeck-store": "/blog/yeezy-350-v2-colorways-guide/",
  "blogs/news/why-yeezy-boost-350s-are-a-must-have-in-every-sneakerheads-collection": "/blog/best-yeezy-350-v2-2026/",
  "blogs/news/discover-the-iconic-adidas-and-kanye-west-collaboration-yeezy-boost-350-a-sneaker-revolution": "/blog/yeezy-350-v2-colorways-guide/",
  "blogs/news/discover-the-iconic-yeezy-boost-350-a-must-have-for-sneaker-collectors-at-kicksondeck": "/collection/350-v2/",
  "blogs/news/discover-the-iconic-yeezy-boost-350-elevate-your-sneaker-game-with-kicksondeck": "/collection/350-v2/",
  "blogs/news/discover-the-iconic-yeezy-boost-350-uniting-high-fashion-hip-hop-and-cutting-edge-footwear-technology": "/blog/yeezy-350-v2-colorways-guide/",
  "blogs/news/kanye-west-s-yeezy-in-2025-redefining-sneakers-amid-personal-and-legal-storms": "/blog/",
  "blogs/news/unleashing-style-and-comfort-the-ultimate-guide-to-adidas-yeezy-boost-350-by-kanye-west": "/blog/best-yeezy-350-v2-2026/",
  "blogs/news/discover-the-hype-the-ultimate-guide-to-adidas-yeezy-boost-350-sneakers-for-sneakerheads": "/blog/best-yeezy-350-v2-2026/",
  "blogs/news/discover-why-adidas-yeezy-boost-350-sneakers-are-a-must-have-for-every-sneakerhead-shop-now-at-kicksondeck": "/collection/350-v2/",
  "blogs/news/ultimate-guide-to-adidas-yeezy-boost-350-design-comfort-and-streetwear-legacy": "/blog/best-yeezy-350-v2-2026/",
  "blogs/news/unlock-sneaker-prestige-why-adidas-yeezy-boost-350s-and-kicksondeck-are-a-must-for-sneakerheads": "/blog/yeezy-350-v2-colorways-guide/",
  "blogs/news/unveiling-the-legacy-of-adidas-yeezy-boost-350-the-ultimate-sneaker-game-changer": "/blog/best-yeezy-350-v2-2026/",
  "blogs/news/why-the-adidas-yeezy-boost-350-dominates-sneaker-culture-the-ultimate-guide-to-copping-the-hottest-drops": "/blog/yeezy-350-v2-restock-guide/",
  "blogs/news/discover-the-iconic-adidas-yeezy-boost-350-style-comfort-and-exclusivity-on-kicksondeck": "/collection/350-v2/",
  "blogs/news/embrace-the-ultimate-sneaker-revolution-understanding-the-unmatched-allure-of-the-adidas-yeezy-boost-350": "/blog/yeezy-350-v2-colorways-guide/",
  "blogs/news/unlock-the-hype-how-adidas-yeezy-boost-350-redefines-street-style-for-sneaker-enthusiasts-on-kicksondeck": "/blog/how-to-style-yeezy-350-v2/",
  "blogs/news/unlock-the-style-comfort-exclusivity-of-kanyes-adidas-yeezy-boost-350-your-gateway-to-ultimate-sneaker-experience": "/blog/how-to-style-yeezy-350-v2/",
  "blogs/news/6-must-have-adidas-sneakers-under-100-in-the-end-of-year-new-year-sale": "/shop/",
  "blogs/news/adidas-and-kanye-west-yeezy-boost-350-the-ultimate-sneaker-collaboration-redefining-style-and-comfort": "/blog/yeezy-350-v2-colorways-guide/",
  "blogs/news/discover-the-ultimate-sneaker-experience-the-iconic-yeezy-boost-350-at-kicksondeck": "/collection/350-v2/",
  "blogs/news/the-ultimate-guide-to-yeezy-boost-350-adidas-x-kanye-wests-streetwear-revolution": "/blog/best-yeezy-350-v2-2026/",
  "blogs/news/kanye-wests-yeezy-brand-a-2025-independent-journey": "/blog/",
  "blogs/news/unlock-the-hype-why-yeezy-boost-350s-dominate-sneaker-culture-your-guide-to-comfort-style-and-exclusivity-on-kicksondeck": "/blog/best-yeezy-350-v2-2026/",
  "blogs/news/unraveling-the-iconic-magic-why-adidas-yeezy-boost-350s-are-a-must-have-for-sneaker-enthusiasts": "/blog/best-yeezy-350-v2-2026/",
  "blogs/news/unveiling-the-yeezy-boost-350-a-revolution-in-sneaker-fashion-with-kanye-west-adidas-shop-now-at-kicksondeck-store": "/blog/yeezy-350-v2-colorways-guide/",
  "blogs/news/discover-why-adidas-yeezy-boost-350-by-kanye-west-revolutionized-sneaker-culture-available-at-kicksondeck-store": "/collection/350-v2/",
  "products/automatic-liquid-discharge-shoe-brush": "/product/shoe-brush-with-automatic-liquid-dispenser/",
};
for (const [from, to] of Object.entries(REDIRECTS)) {
  write(`${from}/index.html`, `<!doctype html>\n<html lang="en"><head><meta charset="utf-8">\n<title>Redirecting… — Kicks on Deck</title>\n<link rel="canonical" href="${ORIGIN}${to}">\n<meta http-equiv="refresh" content="0; url=${to}">\n<meta name="robots" content="noindex,follow">\n</head>\n<body style="background:#0a0a0b;color:#f5f5f5;font-family:system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;margin:0">\n<p>Moved to <a href="${to}" style="color:#c6ff2e">${to}</a>&hellip;</p>\n<script>location.replace(${JSON.stringify(to)});</script>\n</body></html>`);
  n++;
}

// slim catalog for search
const catalog = products.map((p) => ({ slug: p.slug, name: p.name, collection: colTitle(p.collection), price: p.minPrice, image: p.image }));
write("data/catalog.json", JSON.stringify(catalog));

// sitemap + robots + CNAME
// lastmod/changefreq/priority + <image:image> on product and post URLs: image
// entries are how a store's photography becomes eligible for Google Images and
// Shopping surfaces, and lastmod is what gets a changed page recrawled.
const TODAY = new Date().toISOString().slice(0, 10);
const smUrl = (loc, { lastmod = TODAY, priority, changefreq, image, imageTitle } = {}) =>
  `  <url><loc>${loc}</loc><lastmod>${lastmod}</lastmod>` +
  (changefreq ? `<changefreq>${changefreq}</changefreq>` : "") +
  (priority ? `<priority>${priority}</priority>` : "") +
  (image ? `<image:image><image:loc>${esc(image)}</image:loc><image:title>${esc(imageTitle || "")}</image:title></image:image>` : "") +
  `</url>`;
const sitemapEntries = [
  smUrl(`${ORIGIN}/`, { priority: "1.0", changefreq: "daily" }),
  smUrl(`${ORIGIN}/shop/`, { priority: "0.9", changefreq: "daily" }),
  ...collections.map((c) => smUrl(`${ORIGIN}/collection/${c.slug}/`, { priority: "0.9", changefreq: "daily", image: firstImg(c.slug), imageTitle: c.title })),
  ...products.map((p) => smUrl(`${ORIGIN}/product/${p.slug}/`, { priority: "0.8", changefreq: "weekly", image: p.image, imageTitle: p.name })),
  smUrl(`${ORIGIN}/blog/`, { priority: "0.7", changefreq: "weekly" }),
  ...posts.map((p) => smUrl(`${ORIGIN}/blog/${p.slug}/`, { lastmod: p.meta.updated || p.meta.date || TODAY, priority: "0.7", changefreq: "monthly", image: /^\//.test(postImg(p)) ? ORIGIN + postImg(p) : postImg(p), imageTitle: p.meta.title })),
  ...pages.map((p) => smUrl(`${ORIGIN}/${p.slug}/`, { lastmod: p.meta.updated, priority: p.slug === "faq" || p.slug === "size-guide" ? "0.7" : "0.5", changefreq: "monthly" })),
  smUrl(`${ORIGIN}/quiz/`, { priority: "0.6", changefreq: "monthly" }),
];
write("sitemap.xml", `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">\n${sitemapEntries.join("\n")}\n</urlset>`);
// The legacy /blogs//collections//products/ stubs stay crawlable on purpose —
// they are noindex,follow redirects, and Google has to fetch them to move the
// old Shopify URLs' equity onto the new ones. Only the raw catalog JSON is
// blocked, since it has no business ranking for anything.
// AI answer engines and search assistants are welcome — they are how a
// growing share of shoppers first hear a store's name. Listed explicitly so
// a future "block all bots" edit has to be deliberate about each one.
const AI_BOTS = ["GPTBot", "ChatGPT-User", "OAI-SearchBot", "ClaudeBot", "Claude-User", "Claude-SearchBot", "anthropic-ai", "PerplexityBot", "Perplexity-User", "Google-Extended", "Googlebot", "Bingbot", "Applebot", "Applebot-Extended", "Amazonbot", "DuckAssistBot", "meta-externalagent", "CCBot"];
write("robots.txt", `User-agent: *\nAllow: /\nDisallow: /data/\n\n# AI assistants and answer engines: allowed. Machine-readable site summary at ${ORIGIN}/llms.txt\n${AI_BOTS.map((b) => `User-agent: ${b}\nAllow: /\nDisallow: /data/\n`).join("\n")}\nSitemap: ${ORIGIN}/sitemap.xml\n`);

// ---- llms.txt / llms-full.txt + RSS -----------------------------------------
// llms.txt is the emerging convention for handing an LLM a curated map of a
// site (llmstxt.org). Everything here is generated from the same data the
// pages use, so the "facts" an assistant repeats are the facts on the site.
{
  const plain = (h = "") => cleanSentence(String(h)).replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  const colLine = (c) => { const list = products.filter((p) => p.collection === c.slug); const lo = list.length ? money(Math.min(...list.map((p) => p.minPrice))) : ""; return `- [${c.title}](${ORIGIN}/collection/${c.slug}/): ${list.length} styles${lo ? `, from ${lo}` : ""}. ${plain(COLLECTION_INTRO[c.slug] || c.tagline || "")}`; };
  const pageLine = (slug, label, blurb) => `- [${label}](${ORIGIN}/${slug}/): ${blurb}`;
  const pageBy = (slug) => pages.find((p) => p.slug === slug);
  const keyFacts = [
    `- What we sell: transparently labelled 1:1 replica Yeezy silhouettes — 350 V2 knit runners, Foam Runner clogs and Slides — plus cleaning gear. ${products.length} styles in stock. Not affiliated with adidas or Yeezy.`,
    `- Where: online store based in ${CFG.brand.city}, shipping to ${POLICY.shipCountries}.`,
    `- Prices: from ${money(Math.min(...products.map((p) => p.minPrice)))}; no resale markup.`,
    `- Shipping: free on every order to ${POLICY.shipCountries}. Dispatched within ${POLICY.dispatchHours} hours, ${POLICY.transitMinDays}–${POLICY.transitMaxDays} business days in transit, tracking emailed at dispatch.`,
    `- Returns: ${POLICY.returnDays} days from delivery for unworn pairs, including size swaps.`,
    `- Sizing 350 V2: ${SIZING_RULE["350-v2"]}`,
    `- Sizing Foam Runner: ${SIZING_RULE["foam-rnnr"]}`,
    `- Sizing Slides: ${SIZING_RULE.slides}`,
    `- Checkout: Stripe (cards, Apple Pay, Google Pay, Link). Promo code FIRSTPAIR = 10% off a first pair for email subscribers.`,
    `- Contact: ${CFG.brand.email} · ${CFG.brand.phone} · Instagram ${SOCIAL.instagram}`,
  ];
  const llms = `# Kicks on Deck

> Independent online sneaker store selling transparently labelled 1:1 replica Yeezy silhouettes (350 V2, Foam Runner, Slides) with free US & Canada shipping, ${POLICY.returnDays}-day returns and honest, resale-free pricing. Every page says "rep" out loud; nothing here is sold as authentic.

## Key facts
${keyFacts.join("\n")}

## Shop
- [All styles](${ORIGIN}/shop/): the full catalogue, filter by silhouette, sort by price.
${collections.map(colLine).join("\n")}

## Help & policies
${pageLine("size-guide", "Size guide", "size charts and the sizing rule for every silhouette")}
${pageLine("faq", "FAQ", "authenticity, 1:1 meaning, delivery, sizing, returns, payment")}
${pageLine("shipping", "Shipping", "dispatch time, transit window, tracking, countries")}
${pageLine("returns", "Returns & exchanges", `${POLICY.returnDays}-day window, how to start a return or size swap`)}
${pageLine("about", "About", "who we are and why the store is replica-transparent")}
${pageLine("contact", "Contact", "email, phone, response times")}
- [Find your pair quiz](${ORIGIN}/quiz/): 60-second quiz that recommends a silhouette and starting size.

## Blog (guides)
${posts.map((p) => `- [${plain(p.meta.title)}](${ORIGIN}/blog/${p.slug}/): ${plain(p.meta.description || p.excerpt)}`).join("\n")}

## Optional
- [Full text version](${ORIGIN}/llms-full.txt): every FAQ answer, policy and the complete product list.
- [Sitemap](${ORIGIN}/sitemap.xml) · [RSS](${ORIGIN}/blog/feed.xml)
`;
  write("llms.txt", llms);

  const faqPage = pageBy("faq");
  const faqText = (faqPage && faqPage.faq ? faqPage.faq : []).map((f) => `### ${plain(f.q)}\n${plain(f.a)}`).join("\n\n");
  const colFaqText = collections.map((c) => { const items = collectionFaq(c.slug, products.filter((p) => p.collection === c.slug)); return items.length ? `### ${c.title}\n` + items.map((f) => `**${plain(f.q)}** ${plain(f.a)}`).join("\n") : ""; }).filter(Boolean).join("\n\n");
  const policyText = ["shipping", "returns", "size-guide", "about"].map((slug) => { const pg = pageBy(slug); return pg ? `## ${plain(pg.meta.title || slug)}\n${plain(pg.html)}` : ""; }).filter(Boolean).join("\n\n");
  const productText = collections.map((c) => `### ${c.title}\n` + products.filter((p) => p.collection === c.slug).map((p) => { const vs = variantList(p); return `- ${plain(p.name)} — ${plain(colorway(p))} — ${priceLabel(p)} — ${vs.length > 1 ? `${vs.length} sizes (${plain(vs[0].size)} to ${plain(vs[vs.length - 1].size)})` : "one size"} — ${p.inStock ? "in stock" : "out of stock"} — ${ORIGIN}/product/${p.slug}/`; }).join("\n")).join("\n\n");
  write("llms-full.txt", `${llms}\n\n---\n\n## FAQ\n${faqText}\n\n## Collection FAQs\n${colFaqText}\n\n${policyText}\n\n## Complete product list (${products.length})\n${productText}\n`);

  const rss = posts.slice(0, 30).map((p) => `  <item>\n    <title>${esc(plain(p.meta.title))}</title>\n    <link>${ORIGIN}/blog/${p.slug}/</link>\n    <guid isPermaLink="true">${ORIGIN}/blog/${p.slug}/</guid>\n    <pubDate>${new Date((p.meta.date || TODAY) + "T12:00:00Z").toUTCString()}</pubDate>\n    ${p.meta.tag ? `<category>${esc(p.meta.tag)}</category>\n    ` : ""}<description>${esc(plain(p.meta.description || p.excerpt))}</description>\n    <enclosure url="${/^\//.test(postImg(p)) ? ORIGIN + postImg(p) : postImg(p)}" type="image/webp" length="0"/>\n  </item>`).join("\n");
  write("blog/feed.xml", `<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">\n<channel>\n  <title>Kicks on Deck — Journal</title>\n  <link>${ORIGIN}/blog/</link>\n  <atom:link href="${ORIGIN}/blog/feed.xml" rel="self" type="application/rss+xml"/>\n  <description>Sizing guides, rep-vs-real breakdowns, styling and care for Yeezy-silhouette sneakers.</description>\n  <language>en-us</language>\n  <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>\n${rss}\n</channel>\n</rss>\n`);
}
write("CNAME", DOMAIN + "\n");

console.log(`Built ${n} HTML pages + ${products.length} catalog entries.`);
console.log(`Pages: index, shop, blog (${posts.length} posts), quiz, ${collections.length} collections, ${products.length} products, ${pages.length} info pages (${pages.map((p) => p.slug).join(", ")}), 404.`);

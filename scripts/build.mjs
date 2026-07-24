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
const esc = (s = "") => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const priceLabel = (p) => (p.minPrice === p.maxPrice ? money(p.minPrice) : `From ${money(p.minPrice)}`);
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
};

/* ---------------- chrome ---------------- */
const navLinks = [
  { href: "/shop/", label: "Shop All" },
  ...collections.filter((c) => c.slug !== "accessories").map((c) => ({ href: `/collection/${c.slug}/`, label: c.title })),
  { href: "/blog/", label: "Blog" },
  { href: "/collection/accessories/", label: "Care" },
];

function head(opts) {
  const { title, desc, canonical, ogImg = OG_DEFAULT, extraCss = "", ld = null } = opts;
  return `<!doctype html>
<html lang="en" class="no-js">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${canonical}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Kicks on Deck">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:image" content="${ogImg}">
<meta property="og:url" content="${canonical}">
<meta name="twitter:card" content="summary_large_image">
<meta name="theme-color" content="#0a0a0b">
<link rel="icon" href="/assets/favicon.svg" type="image/svg+xml">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="preconnect" href="https://cdn.shopify.com">
<link href="https://fonts.googleapis.com/css2?family=Archivo+Expanded:wght@600;700;800;900&family=Hanken+Grotesk:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/assets/styles.css">
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
  <a class="brand" href="/" aria-label="Kicks on Deck home"><span class="wordmark">Kicks on Deck<small>EST. MIAMI · REP 1:1</small></span></a>
  <nav class="nav pill-nav" id="pill-nav" aria-label="Primary"><span class="pill-ind" aria-hidden="true"></span>${navLinks.map((l) => `<a href="${l.href}"${active === l.href ? ' class="active"' : ""}>${l.label}</a>`).join("")}</nav>
  <div class="header-actions">
    <button class="icon-btn" id="search-open" aria-label="Search">${I.search}</button>
    <button class="icon-btn" id="cart-open" aria-label="Open bag">${I.bag}<span class="cart-count" id="cart-count">0</span></button>
    <button class="icon-btn menu-toggle" id="menu-toggle" aria-label="Menu">${I.menu}</button>
  </div>
</div></div></header>
<div class="mobile-nav" id="mobile-nav">${navLinks.map((l) => `<a href="${l.href}">${l.label}</a>`).join("")}<a href="/shop/">Search</a></div>`;
}

function marquee() {
  const items = ["Free U.S. shipping on every order", "1:1 craftsmanship", "Every pair inspected", "Ships US & Canada", "7-day buyer protection", "New drops weekly"];
  const span = items.map((t) => `<span>${t}</span>`).join("");
  return `<div class="marquee" aria-hidden="true"><div class="marquee-track">${span}${span}</div></div>`;
}

function drawerAndSearch() {
  return `
<div class="overlay" id="overlay"></div>
<aside class="drawer" id="cart-drawer" aria-label="Shopping bag">
  <div class="drawer-head"><h3>Your Bag <span class="count" id="cart-head-count"></span></h3><button class="icon-btn" id="cart-close" aria-label="Close">${I.close}</button></div>
  <div class="drawer-body" id="cart-body"></div>
  <div class="drawer-foot" id="cart-foot" style="display:none">
    <div class="cart-row"><span>Subtotal</span><span class="mono" id="cart-subtotal">$0</span></div>
    <div class="cart-row"><span>Shipping</span><span class="mono">Free (US &amp; CA)</span></div>
    <div class="cart-row total"><span>Total</span><span class="mono" id="cart-subtotal-2"></span></div>
    <button class="btn btn-volt btn-block btn-lg" id="checkout-btn">Checkout ${I.arrow}</button>
    <p class="cart-note">Secure checkout powered by Stripe.<br>Questions? <a href="mailto:${CFG.brand.email}">${CFG.brand.email}</a></p>
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
    <div class="footer-col"><h5>Shop</h5>${collections.map((c) => `<a href="/collection/${c.slug}/">${c.title}</a>`).join("")}<a href="/shop/">All Styles</a></div>
    <div class="footer-col"><h5>Support</h5><a href="mailto:${CFG.brand.email}">Contact</a><a href="/shop/">Sizing</a><a href="mailto:${CFG.brand.email}?subject=Order%20status">Track Order</a><a href="mailto:${CFG.brand.email}?subject=Returns">Returns</a></div>
    <div class="footer-col"><h5>Connect</h5>${socialLink(SOCIAL.instagram, "Instagram")}${socialLink(SOCIAL.tiktok, "TikTok")}${socialLink(SOCIAL.facebook, "Facebook")}<a href="/quiz/">Find your pair</a><a href="mailto:${CFG.brand.email}">Email</a></div>
  </div>
  <div class="footer-bottom">
    <p>© ${new Date().getFullYear()} Kicks on Deck · ${esc(CFG.brand.city)}</p>
    <div style="display:flex;gap:18px"><a href="/shop/">Privacy</a><a href="/shop/">Terms</a></div>
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
    <div class="card-media">${badge ? `<div class="badge-wrap">${badge}</div>` : ""}<img src="${p.image}" alt="${esc(p.name)}" loading="lazy" width="600" height="600"></div>
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
        <div class="hero-cta"><a class="btn btn-volt btn-lg" href="/shop/">Shop the rotation ${I.arrow}</a><a class="btn btn-ghost btn-lg" href="/collection/350-v2/">350 V2 →</a></div>
      </div>
    </div>
    <div class="hero-readout" aria-hidden="true"><span class="ro-k">Now spinning</span><span class="ro-v">${esc(hero.name)}</span></div>
  </div>
</section>

<section class="stats">
  <div class="stat reveal"><div class="num"><span class="volt" data-countup="${products.length}">0</span></div><div class="lbl">Styles in stock</div></div>
  <div class="stat reveal" data-d="1"><div class="num">1:1</div><div class="lbl">Craftsmanship</div></div>
  <div class="stat reveal" data-d="2"><div class="num"><span data-countup="48">0</span><span class="volt">h</span></div><div class="lbl">Dispatch window</div></div>
  <div class="stat reveal" data-d="3"><div class="num"><span data-countup="7">0</span>d</div><div class="lbl">Buyer protection</div></div>
</section>

<section class="section container">
  <div class="section-head"><div><span class="eyebrow">Collections</span><h2>Pick your<br>silhouette</h2></div><a class="link-arrow" href="/shop/">All styles <span>${I.arrow}</span></a></div>
  <div class="collections-grid">
    ${collections.filter((c) => c.slug !== "accessories").map((c, i) => `
    <a class="col-card span-${i === 0 ? 8 : i === 1 ? 4 : 6}" href="/collection/${c.slug}/">
      <img class="col-img" src="${firstImg(c.slug)}" alt="" loading="lazy">
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
        <div class="fl"><span class="fl-num">01</span><div><h4>1:1 construction</h4><p>Matched to the original last, stitch for stitch.</p></div></div>
        <div class="fl"><span class="fl-num">02</span><div><h4>Inspected & shipped fast</h4><p>QC photos on request. Dispatched within 48 hours.</p></div></div>
        <div class="fl"><span class="fl-num">03</span><div><h4>Buyer protection</h4><p>7-day window. Sizing help any time.</p></div></div>
      </div>
    </div>
    <div class="story-visual reveal" data-d="2"><img src="${(products.find((p) => /cream|bone|sand/i.test(p.name)) || products[1]).image}" alt="Featured pair"></div>
  </div>
</section>

${quizCTA()}
${voteWidget()}
${captureBand()}`;

  const socials = [SOCIAL.instagram, SOCIAL.tiktok, SOCIAL.facebook].filter(Boolean).map((u) => (/^https?:\/\//.test(u) ? u : `https://${u}`));
  const homeLd = [
    { "@context": "https://schema.org", "@type": "Organization", "@id": `${ORIGIN}/#org`, name: "Kicks on Deck", url: `${ORIGIN}/`, logo: `${ORIGIN}/assets/favicon.svg`, email: CFG.brand.email, description: "Independent footwear — 1:1 rep Yeezy 350 V2, Foam Runners and Slides. Honest pricing, free U.S. shipping.", ...(socials.length ? { sameAs: socials } : {}) },
    { "@context": "https://schema.org", "@type": "WebSite", "@id": `${ORIGIN}/#website`, name: "Kicks on Deck", url: `${ORIGIN}/`, publisher: { "@id": `${ORIGIN}/#org` } },
    { "@context": "https://schema.org", "@type": "Store", "@id": `${ORIGIN}/#store`, name: "Kicks on Deck", url: `${ORIGIN}/`, image: hero.image, email: CFG.brand.email, telephone: CFG.brand.phone, priceRange: "$$", parentOrganization: { "@id": `${ORIGIN}/#org` }, address: { "@type": "PostalAddress", addressRegion: "FL", addressCountry: "US" }, areaServed: [{ "@type": "AdministrativeArea", name: "South Florida" }, { "@type": "AdministrativeArea", name: "Treasure Coast" }, { "@type": "Country", name: "United States" }] },
  ];
  return layout({
    headOpts: { title: "Kicks on Deck — Rep 1:1 Sneakers, Foam Runners & Slides", desc: `Shop ${products.length} grail silhouettes — 350 V2, Foam Runners and Slides. 1:1 craftsmanship, honest prices, free U.S. shipping.`, canonical: `${ORIGIN}/`, ogImg: hero.image, ld: homeLd },
    active: "/",
    body,
  });
}

function gridPage({ title, h1, eyebrow, list, canonical, active, intro, showFilters }) {
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
</section>`;
  const crumb = title.split(/[—|]/)[0].trim();
  const gridLd = {
    "@context": "https://schema.org", "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: `${ORIGIN}/` },
      { "@type": "ListItem", position: 2, name: crumb, item: canonical },
    ],
  };
  return layout({ headOpts: { title, desc: intro || h1, canonical, ld: gridLd }, active, body });
}

function productPage(p) {
  const vs = variantList(p);
  const refl = isReflective(p.name);
  const acc = p.collection === "accessories";
  const copyOverride = productCopy[p.slug];
  const descPlain = copyOverride ? copyOverride.replace(/\s+/g, " ").trim() : p.descText;
  const desc = copyOverride ? copyOverride.split(/\n\n+/).map((t) => `<p>${esc(t.trim())}</p>`).join("") : (pdpDesc(p.descHtml) || `<p>${esc(p.descText)}</p>`);
  const sectionLabel = acc ? "Select option" : "Select size";
  const pdata = { id: p.id, slug: p.slug, name: p.name, image: p.image, price: p.minPrice, variants: vs.map((v) => ({ id: v.id, size: v.size })) };
  const related = products.filter((x) => x.collection === p.collection && x.id !== p.id).slice(0, 4);
  const single = vs.length <= 1;
  const GUIDES_BY_COLLECTION = {
    "350-v2": ["rep-vs-real-yeezy-350-v2", "yeezy-350-v2-sizing"],
    "foam-rnnr": ["yeezy-foam-runner-sizing", "how-to-clean-yeezy-foam-runner-and-slides"],
    "slides": ["yeezy-slides-sizing", "how-to-clean-yeezy-foam-runner-and-slides"],
  };
  const guides = (GUIDES_BY_COLLECTION[p.collection] || []).map((s) => posts.find((post) => post.slug === s)).filter(Boolean);

  const ld = {
    "@context": "https://schema.org", "@type": "Product", name: p.name, image: [p.image], description: descPlain,
    brand: { "@type": "Brand", name: "Kicks on Deck" }, category: colTitle(p.collection),
    offers: { "@type": "Offer", priceCurrency: p.currency || "USD", price: p.minPrice, availability: p.inStock ? "https://schema.org/InStock" : "https://schema.org/OutOfStock", url: `${ORIGIN}/product/${p.slug}/` },
  };

  const body = `
<section class="container pdp">
  <div class="breadcrumb"><a href="/">Home</a> / <a href="/collection/${p.collection}/">${colTitle(p.collection)}</a> / <span>${esc(p.name)}</span></div>
  <div class="pdp-grid">
    <div class="pdp-media reveal">${refl ? `<span class="badge volt floatbadge">Reflective ✦</span>` : ""}<img src="${p.image}" alt="${esc(p.name)}" width="900" height="900"></div>
    <div class="pdp-info reveal" data-d="1">
      <span class="eyebrow">${colTitle(p.collection)}${refl ? " · Reflective" : ""}</span>
      <h1>${esc(p.name)}</h1>
      <div class="pdp-price">${money(p.minPrice)}${p.variants[0]?.compareAt ? `<span class="was">${money(p.variants[0].compareAt)}</span>` : ""}</div>
      <p class="pdp-value">1:1 craftsmanship · honest pricing, no resale markup · inspected before it ships</p>
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
      <div class="trust-row">
        <div class="trust">${I.shield} Buyer protection</div>
        <div class="trust">${I.truck} Ships in 48h</div>
        <div class="trust">${I.globe} Free U.S. shipping</div>
      </div>
      <div class="pdp-details">
        <h2 class="pdp-details-h">The details</h2>
        <div class="pdp-desc">${desc}</div>
        ${guides.length ? `<div class="pdp-guides" style="margin-top:20px;font-family:var(--font-mono);font-size:.8rem"><span style="color:var(--muted)">Guides:</span> ${guides.map((g) => `<a class="link-arrow" href="/blog/${g.slug}/" style="margin-right:14px">${esc(g.meta.title || g.slug)}</a>`).join("")}</div>` : ""}
      </div>
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
]))}</script>`;

  return layout({
    headOpts: { title: `${p.name} — Kicks on Deck`, desc: trimDesc(descPlain) || `${p.name} — ${priceLabel(p)}. 1:1 craftsmanship, free U.S. shipping.`, canonical: `${ORIGIN}/product/${p.slug}/`, ogImg: p.image },
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
    <h3>${esc(p.meta.title || p.slug)}</h3>
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
  return layout({ headOpts: { title: "Blog — Sneaker Guides, Yeezy News & Culture | Kicks on Deck", desc: "Sizing guides, rep-vs-real breakdowns, styling tips and Yeezy/hypebeast culture from Kicks on Deck.", canonical: `${ORIGIN}/blog/`, ogImg: feat ? postImg(feat) : OG_DEFAULT, ld: blogLd }, active: "/blog/", body });
}

function blogPostPage(p) {
  const related = (Array.isArray(p.meta.products) ? p.meta.products : (p.meta.products ? [p.meta.products] : []))
    .map((slug) => products.find((x) => x.slug === slug)).filter(Boolean).slice(0, 4);
  const ld = {
    "@context": "https://schema.org", "@type": "BlogPosting", headline: p.meta.title, image: [postImg(p)],
    datePublished: p.meta.date, dateModified: p.meta.date, author: { "@type": "Organization", name: "Kicks on Deck" },
    publisher: { "@type": "Organization", name: "Kicks on Deck" }, mainEntityOfPage: `${ORIGIN}/blog/${p.slug}/`, description: p.excerpt,
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
    <p class="post-byline">Kicks on Deck · ${fmtDate(p.meta.date)}${p.meta.read ? ` · ${esc(p.meta.read)}` : ""}</p>
  </header>
  <div class="post-hero reveal"><img src="${postImg(p)}" alt="${esc(p.meta.title || "")}"></div>
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
  return layout({ headOpts: { title: `${p.meta.title} | Kicks on Deck`, desc: trimDesc(p.meta.description || p.excerpt), canonical: `${ORIGIN}/blog/${p.slug}/`, ogImg: postImg(p) }, active: "/blog/", body });
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
  return layout({ headOpts: { title: "Find Your Pair — Sneaker Style Quiz | Kicks on Deck", desc: "Take the 60-second quiz and get matched to the Yeezy silhouette built for your style.", canonical: `${ORIGIN}/quiz/` }, active: "", body });
}

/* ---------------- write ---------------- */
function write(rel, content) {
  const full = path.join(ROOT, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
}

let n = 0;
write("index.html", homePage()); n++;
write("shop/index.html", gridPage({ title: `Shop All — ${products.length} Styles | Kicks on Deck`, h1: "Shop<br>All", eyebrow: `The full rotation · ${products.length} styles`, list: products, canonical: `${ORIGIN}/shop/`, active: "/shop/", intro: "Every silhouette in stock — 350 V2, Foam Runners, Slides and care. Filter, sort, and find your size.", showFilters: true })); n++;
for (const c of collections) {
  const list = products.filter((p) => p.collection === c.slug);
  write(`collection/${c.slug}/index.html`, gridPage({ title: `${c.title} — Kicks on Deck`, h1: c.title.replace(/ /g, "<br>"), eyebrow: c.tagline, list, canonical: `${ORIGIN}/collection/${c.slug}/`, active: `/collection/${c.slug}/`, intro: `${c.count} ${c.title} styles in rotation. ${c.tagline}.${FIT_NOTES[c.slug] ? " Unisex sizing for men and women." : ""}`, showFilters: false }));
  n++;
}
for (const p of products) { write(`product/${p.slug}/index.html`, productPage(p)); n++; }

// blog + quiz
for (const p of posts) {
  if (p.meta.image) p.cover = p.meta.image;
  else { p.cover = `/assets/blog/${p.slug}.svg`; write(`assets/blog/${p.slug}.svg`, blogCover(p)); }
}
write("blog/index.html", blogIndexPage()); n++;
for (const p of posts) { write(`blog/${p.slug}/index.html`, blogPostPage(p)); n++; }
write("quiz/index.html", quizPage()); n++;

// 404
write("404.html", layout({ headOpts: { title: "404 — Kicks on Deck", desc: "Page not found", canonical: `${ORIGIN}/404` }, active: "", body: `<section class="container" style="min-height:70vh;display:grid;place-items:center;text-align:center"><div><div class="footer-giant" style="-webkit-text-stroke:1px var(--volt)">404</div><p class="eyebrow" style="margin:20px 0">This pair walked off</p><a class="btn btn-volt btn-lg" href="/shop/">Back to the shop ${I.arrow}</a></div></section>` }));

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
const urls = [`${ORIGIN}/`, `${ORIGIN}/shop/`, `${ORIGIN}/blog/`, `${ORIGIN}/quiz/`, ...collections.map((c) => `${ORIGIN}/collection/${c.slug}/`), ...posts.map((p) => `${ORIGIN}/blog/${p.slug}/`), ...products.map((p) => `${ORIGIN}/product/${p.slug}/`)];
write("sitemap.xml", `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `  <url><loc>${u}</loc></url>`).join("\n")}\n</urlset>`);
write("robots.txt", `User-agent: *\nAllow: /\nSitemap: ${ORIGIN}/sitemap.xml\n`);
write("CNAME", DOMAIN + "\n");

console.log(`Built ${n} HTML pages + ${products.length} catalog entries.`);
console.log(`Pages: index, shop, blog (${posts.length} posts), quiz, ${collections.length} collections, ${products.length} products, 404.`);

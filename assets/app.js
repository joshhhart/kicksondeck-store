/* ============================================================
   KICKS ON DECK — storefront runtime
   Cart · drawer · search · checkout · analytics + first-party capture · A/B
   ============================================================ */
(() => {
  "use strict";
  const CFG = window.KOD_CONFIG || {};
  const AN = CFG.analytics || {};
  const DATA_EP = (AN.dataEndpoint || "").replace(/\/+$/, "");
  const CART_KEY = "kod_cart_v1";
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const money = (n) => "$" + Number(n || 0).toLocaleString("en-US");

  /* ---------- analytics (GA4) + first-party data endpoint ---------- */
  const track = (name, params) => { try { if (window.gtag) window.gtag("event", name, params || {}); } catch {} };
  async function postData(path, payload) {
    if (!DATA_EP) return { ok: false, skipped: true };
    try {
      const res = await fetch(DATA_EP + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      return await res.json().catch(() => ({ ok: res.ok }));
    } catch (e) { return { ok: false, error: String(e) }; }
  }

  /* ---------- cart store ---------- */
  const readCart = () => { try { return JSON.parse(localStorage.getItem(CART_KEY)) || []; } catch { return []; } };
  let cart = readCart();
  const saveCart = () => { localStorage.setItem(CART_KEY, JSON.stringify(cart)); renderCart(); };

  function addToCart(item) {
    const key = item.variantId || item.id;
    const found = cart.find((c) => (c.variantId || c.id) === key);
    if (found) found.qty += item.qty || 1;
    else cart.push({ ...item, qty: item.qty || 1 });
    saveCart();
    track("add_to_cart", { currency: "USD", value: item.price, item_id: key, item_name: item.name });
    toast("Added to bag", item.name);
    openCart();
  }
  function setQty(key, delta) {
    const it = cart.find((c) => (c.variantId || c.id) === key);
    if (!it) return;
    it.qty += delta;
    if (it.qty <= 0) cart = cart.filter((c) => (c.variantId || c.id) !== key);
    saveCart();
  }
  function removeItem(key) { cart = cart.filter((c) => (c.variantId || c.id) !== key); saveCart(); }
  const subtotal = () => cart.reduce((s, c) => s + c.price * c.qty, 0);
  const count = () => cart.reduce((s, c) => s + c.qty, 0);

  /* ---------- cart render ---------- */
  function renderCart() {
    const badge = $("#cart-count");
    const c = count();
    if (badge) { badge.textContent = c; badge.classList.toggle("show", c > 0); }
    const body = $("#cart-body"), foot = $("#cart-foot"), head = $("#cart-head-count");
    if (!body) return;
    if (head) head.textContent = c ? `(${c})` : "";
    if (!cart.length) {
      body.innerHTML = `<div class="cart-empty"><svg class="ce-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z"/><path d="M3 6h18M16 10a4 4 0 01-8 0"/></svg><p>Your bag is empty</p></div>`;
      if (foot) foot.style.display = "none";
      return;
    }
    if (foot) foot.style.display = "block";
    body.innerHTML = cart.map((c) => {
      const key = c.variantId || c.id;
      return `<div class="cart-line">
        <a class="thumb" href="/product/${c.slug}/"><img src="${c.image}" alt="" loading="lazy"></a>
        <div>
          <div class="cl-name">${c.name}</div>
          ${c.size ? `<div class="cl-size">${c.size}</div>` : ""}
          <div class="cl-bottom">
            <div class="qty"><button data-dec="${key}" aria-label="Decrease">–</button><span>${c.qty}</span><button data-inc="${key}" aria-label="Increase">+</button></div>
          </div>
          <button class="remove" data-rm="${key}">Remove</button>
        </div>
        <div class="cl-price">${money(c.price * c.qty)}</div>
      </div>`;
    }).join("");
    $("#cart-subtotal").textContent = money(subtotal());
    const t2 = $("#cart-subtotal-2"); if (t2) t2.textContent = money(subtotal());
    body.querySelectorAll("[data-inc]").forEach((b) => b.onclick = () => setQty(b.dataset.inc, 1));
    body.querySelectorAll("[data-dec]").forEach((b) => b.onclick = () => setQty(b.dataset.dec, -1));
    body.querySelectorAll("[data-rm]").forEach((b) => b.onclick = () => removeItem(b.dataset.rm));
  }

  /* ---------- drawer / overlay ---------- */
  const overlay = $("#overlay"), drawer = $("#cart-drawer");
  function openCart() { overlay?.classList.add("open"); drawer?.classList.add("open"); document.body.style.overflow = "hidden"; }
  function closeCart() { overlay?.classList.remove("open"); drawer?.classList.remove("open"); if (!searchOpen) document.body.style.overflow = ""; }
  $("#cart-open")?.addEventListener("click", openCart);
  $("#cart-close")?.addEventListener("click", closeCart);
  overlay?.addEventListener("click", () => { closeCart(); closeSearch(); });

  /* ---------- checkout handoff ---------- */
  function emailFallback(co) {
    const lines = cart.map((c) => `• ${c.qty}× ${c.name}${c.size ? " — " + c.size : ""} (${money(c.price)})`).join("\n");
    const body = `I'd like to order:\n\n${lines}\n\nSubtotal: ${money(subtotal())}\n\nName:\nShipping address:\nPhone:`;
    const email = co.contactEmail || "hartjosh15@gmail.com";
    window.location.href = `mailto:${email}?subject=${encodeURIComponent("Order — Kicks on Deck")}&body=${encodeURIComponent(body)}`;
  }

  $("#checkout-btn")?.addEventListener("click", async () => {
    if (!cart.length) return;
    const co = CFG.checkout || {};
    localStorage.setItem("kod_pending_order", JSON.stringify({ items: cart, subtotal: subtotal(), at: Date.now() }));
    track("begin_checkout", { currency: "USD", value: subtotal(), items: count() });

    // Stripe via serverless endpoint — builds a real Checkout Session from the bag.
    if (co.mode === "stripe" && co.endpoint) {
      const btn = $("#checkout-btn"), orig = btn.innerHTML;
      btn.disabled = true; btn.textContent = "Redirecting…";
      try {
        const res = await fetch(co.endpoint.replace(/\/+$/, "") + "/checkout", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            items: cart.map((c) => ({ variantId: c.variantId || c.id, id: c.id, qty: c.qty, name: c.name, size: c.size || "", image: c.image })),
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok && data.url) { window.location.href = data.url; return; }
        throw new Error(data.error || ("HTTP " + res.status));
      } catch (err) {
        console.error("Checkout error:", err);
        btn.disabled = false; btn.innerHTML = orig;
        toast("Checkout unavailable — opening email order");
        emailFallback(co);
      }
      return;
    }

    // Legacy direct-URL handoffs / no processor wired yet.
    if (co.mode === "ghl" && co.ghlStoreUrl) { window.location.href = co.ghlStoreUrl; return; }
    if (co.mode === "stripe" && co.stripeUrl) { window.location.href = co.stripeUrl; return; }
    emailFallback(co);
  });

  // Returning from a completed Stripe checkout: empty the bag and confirm.
  (() => {
    const sp = new URLSearchParams(location.search);
    if (sp.get("checkout") !== "success") return;
    cart = []; saveCart();
    toast("Order confirmed — thank you!");
    sp.delete("checkout"); sp.delete("session_id");
    const qs = sp.toString();
    history.replaceState(null, "", location.pathname + (qs ? "?" + qs : ""));
  })();

  /* ---------- PDP size + add ---------- */
  const pdp = $("#pdp-data");
  if (pdp) {
    const data = JSON.parse(pdp.textContent);
    track("view_item", { currency: "USD", value: data.price, item_id: data.id, item_name: data.name });
    let selected = null;
    const warn = $("#size-warn");
    $$(".size-btn").forEach((btn) => btn.addEventListener("click", () => {
      $$(".size-btn").forEach((b) => b.classList.remove("selected"));
      btn.classList.add("selected");
      selected = { variantId: btn.dataset.vid, size: btn.dataset.size, price: Number(btn.dataset.price) };
      warn?.classList.remove("show");
    }));
    $("#add-btn")?.addEventListener("click", () => {
      const variants = data.variants || [];
      if (variants.length > 1 && !selected) { warn?.classList.add("show"); return; }
      const v = selected || { variantId: variants[0]?.id, size: variants[0]?.size || "", price: data.price };
      addToCart({ id: data.id, variantId: v.variantId, slug: data.slug, name: data.name, size: v.size, price: v.price, image: data.image });
    });
  }

  /* ---------- search ---------- */
  let catalog = null, searchOpen = false;
  const sPanel = $("#search-panel"), sInput = $("#search-input"), sResults = $("#search-results");
  async function loadCatalog() {
    if (catalog) return catalog;
    try { catalog = await (await fetch("/data/catalog.json")).json(); } catch { catalog = []; }
    return catalog;
  }
  function openSearch() { searchOpen = true; sPanel?.classList.add("open"); document.body.style.overflow = "hidden"; loadCatalog(); setTimeout(() => sInput?.focus(), 120); }
  function closeSearch() { searchOpen = false; sPanel?.classList.remove("open"); if (!drawer?.classList.contains("open")) document.body.style.overflow = ""; }
  $("#search-open")?.addEventListener("click", openSearch);
  $("#search-close")?.addEventListener("click", closeSearch);
  sInput?.addEventListener("input", async () => {
    const q = sInput.value.trim().toLowerCase();
    const data = await loadCatalog();
    if (!q) { sResults.innerHTML = ""; return; }
    const hits = data.filter((p) => p.name.toLowerCase().includes(q) || (p.collection || "").includes(q)).slice(0, 8);
    sResults.innerHTML = hits.length ? hits.map((p) => `
      <a class="sr-item" href="/product/${p.slug}/">
        <div class="thumb"><img src="${p.image}" alt="" loading="lazy"></div>
        <div><div class="sr-name">${p.name}</div><div class="sr-meta">${p.collection || ""}</div></div>
        <div class="sr-price">${money(p.price)}</div>
      </a>`).join("") : `<div class="search-hint">No matches for "${sInput.value}"</div>`;
  });

  /* ---------- shop filter + sort ---------- */
  const grid = $("#product-grid");
  if (grid) {
    const cards = $$(".card", grid);
    const params = new URLSearchParams(location.search);
    let active = params.get("c") || "all";
    const resultCount = $("#result-count");
    function apply() {
      let shown = 0;
      cards.forEach((card) => {
        const ok = active === "all" || card.dataset.collection === active;
        card.style.display = ok ? "" : "none";
        if (ok) shown++;
      });
      if (resultCount) resultCount.textContent = `${shown} ${shown === 1 ? "pair" : "styles"}`;
      $$(".chip").forEach((ch) => ch.classList.toggle("active", ch.dataset.filter === active));
      const empty = $("#empty-state"); if (empty) empty.style.display = shown ? "none" : "block";
    }
    $$(".chip").forEach((ch) => ch.addEventListener("click", () => { active = ch.dataset.filter; apply(); history.replaceState(null, "", active === "all" ? location.pathname : `?c=${active}`); }));
    const sort = $("#sort-select");
    sort?.addEventListener("change", () => {
      const v = sort.value, arr = cards.slice();
      arr.sort((a, b) => {
        const pa = +a.dataset.price, pb = +b.dataset.price;
        if (v === "price-asc") return pa - pb;
        if (v === "price-desc") return pb - pa;
        if (v === "name") return a.dataset.name.localeCompare(b.dataset.name);
        return (+a.dataset.order) - (+b.dataset.order);
      });
      arr.forEach((c) => grid.appendChild(c));
    });
    apply();
  }

  /* ---------- header scroll + mobile nav ---------- */
  const header = $("#header");
  const onScroll = () => header?.classList.toggle("scrolled", window.scrollY > 24);
  onScroll(); window.addEventListener("scroll", onScroll, { passive: true });
  const mnav = $("#mobile-nav");
  $("#menu-toggle")?.addEventListener("click", () => { const o = mnav?.classList.toggle("open"); document.body.style.overflow = o ? "hidden" : ""; });
  $$("#mobile-nav a").forEach((a) => a.addEventListener("click", () => { mnav?.classList.remove("open"); document.body.style.overflow = ""; }));

  /* ---------- reveal on scroll ---------- */
  const io = new IntersectionObserver((entries) => {
    entries.forEach((e) => { if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); } });
  }, { threshold: 0.12, rootMargin: "0px 0px -8% 0px" });
  $$(".reveal").forEach((el) => io.observe(el));

  /* ---------- keyboard ---------- */
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { closeCart(); closeSearch(); mnav?.classList.remove("open"); document.body.style.overflow = ""; }
    if (e.key === "/" && !/input|textarea/i.test(document.activeElement.tagName)) { e.preventDefault(); openSearch(); }
  });

  /* ---------- toast ---------- */
  let toastT;
  function toast(msg) {
    let t = $("#toast");
    if (!t) { t = document.createElement("div"); t.id = "toast"; t.className = "toast"; document.body.appendChild(t); }
    t.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M5 13l4 4L19 7"/></svg> ${msg}`;
    requestAnimationFrame(() => t.classList.add("show"));
    clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove("show"), 2400);
  }

  /* ---------- email + survey capture ---------- */
  $("#news-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const form = e.target, fd = new FormData(form), msg = $("#news-msg");
    const payload = { email: fd.get("email"), interest: fd.get("interest") || "", size: fd.get("size") || "", source: location.pathname };
    track("email_signup", { interest: payload.interest, size: payload.size });
    const r = await postData("/subscribe", payload);
    form.reset();
    if (msg) msg.textContent = r.skipped ? "You're on the list." : "You're on the list — watch your inbox.";
    else toast("You're on the list");
  });

  /* ---------- vote the next drop ---------- */
  const voteGrid = $("#vote-grid");
  if (voteGrid) {
    const VOTED_KEY = "kod_voted_v1";
    const renderStats = async () => {
      if (!DATA_EP) return;
      let stats; try { stats = await (await fetch(DATA_EP + "/stats")).json(); } catch { return; }
      const counts = (stats && stats.votes) || {};
      const total = Object.values(counts).reduce((a, b) => a + (+b || 0), 0);
      $$("[data-vote]", voteGrid).forEach((b) => {
        const pct = total ? Math.round((+counts[b.dataset.vote] || 0) / total * 100) : 0;
        const fill = b.querySelector(".vote-fill"), pctEl = b.querySelector(".vote-pct");
        if (fill) fill.style.width = pct + "%";
        if (pctEl) pctEl.textContent = total ? pct + "%" : "—";
      });
    };
    if (localStorage.getItem(VOTED_KEY)) voteGrid.classList.add("voted");
    renderStats();
    $$("[data-vote]", voteGrid).forEach((b) => b.addEventListener("click", async () => {
      if (localStorage.getItem(VOTED_KEY)) return;
      const choice = b.dataset.vote;
      localStorage.setItem(VOTED_KEY, choice);
      voteGrid.classList.add("voted");
      b.classList.add("picked");
      track("vote_drop", { choice });
      await postData("/vote", { choice });
      renderStats();
      const note = $("#vote-note"); if (note) note.textContent = "Thanks — your vote's in. Live results below.";
    }));
  }

  /* ---------- find-your-pair quiz ---------- */
  const quizEl = $("#quiz");
  if (quizEl) {
    const data = JSON.parse($("#quiz-data").textContent || "{}");
    const collMap = JSON.parse(quizEl.dataset.coll || "{}");
    const questions = data.questions || [];
    const stage = $("#quiz-stage"), bar = $("#quiz-bar"), resultEl = $("#quiz-result");
    let step = 0; const answers = [];
    const setBar = () => { if (bar) bar.style.width = Math.round((step / questions.length) * 100) + "%"; };
    function renderStep() {
      if (step >= questions.length) return finish();
      const q = questions[step];
      setBar();
      stage.innerHTML = `<div class="quiz-q reveal in"><span class="quiz-count">Question ${step + 1} / ${questions.length}</span><h2>${q.q}</h2><div class="quiz-opts">${q.a.map((a, i) => `<button class="quiz-opt" data-i="${i}">${a.t}</button>`).join("")}</div></div>`;
      $$(".quiz-opt", stage).forEach((b) => b.addEventListener("click", () => { answers.push(q.a[+b.dataset.i]); step++; renderStep(); }));
    }
    async function finish() {
      setBar();
      const tally = {}; let reflective = 0;
      answers.forEach((a) => { tally[a.coll] = (tally[a.coll] || 0) + 1; if (a.reflective) reflective++; });
      const coll = Object.keys(tally).sort((x, y) => tally[y] - tally[x])[0] || "350-v2";
      const wantRefl = reflective >= 2;
      const cat = await loadCatalog();
      const collTitle = collMap[coll] || "";
      let pool = cat.filter((p) => (p.collection || "") === collTitle);
      if (wantRefl) { const r = pool.filter((p) => /reflective/i.test(p.name)); if (r.length) pool = r; }
      if (!pool.length) pool = cat;
      const pick = pool[Math.floor(Math.random() * pool.length)];
      track("quiz_complete", { coll, reflective: wantRefl, recommended: pick && pick.slug });
      postData("/quiz", { answers: answers.map((a) => a.t), coll, reflective: wantRefl, recommended: pick && pick.slug });
      if (stage) stage.hidden = true;
      if (resultEl) {
        resultEl.hidden = false;
        resultEl.innerHTML = `<span class="eyebrow">Your match</span><div class="quiz-pick"><a class="quiz-pick-img" href="/product/${pick.slug}/"><img src="${pick.image}" alt="${pick.name}" loading="lazy"></a><div class="quiz-pick-info"><h2>${pick.name}</h2><p>${pick.collection} · ${money(pick.price)}</p><a class="btn btn-volt btn-lg" href="/product/${pick.slug}/">Shop this pair →</a><button class="btn btn-ghost" id="quiz-retry" type="button">Retake</button></div></div>`;
        $("#quiz-retry")?.addEventListener("click", () => { step = 0; answers.length = 0; if (stage) stage.hidden = false; resultEl.hidden = true; renderStep(); });
      }
    }
    renderStep();
  }

  /* ============================================================
     React Bits effects — vanilla ports (pill nav · particles · count-up · spark · spotlight)
     ============================================================ */
  const reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // Pill Nav — a filled pill slides to the hovered/active link
  (() => {
    const nav = $("#pill-nav"); if (!nav) return;
    const ind = nav.querySelector(".pill-ind");
    const links = $$("a", nav);
    const active = nav.querySelector("a.active");
    const move = (el) => {
      if (!el || !ind) return;
      links.forEach((l) => l.classList.remove("on-pill"));
      el.classList.add("on-pill");
      ind.style.left = el.offsetLeft + "px";
      ind.style.width = el.offsetWidth + "px";
      nav.classList.add("ready");
    };
    const reset = () => { if (active) move(active); else { nav.classList.remove("ready"); links.forEach((l) => l.classList.remove("on-pill")); } };
    links.forEach((l) => l.addEventListener("mouseenter", () => move(l)));
    nav.addEventListener("mouseleave", reset);
    if (active) requestAnimationFrame(reset);
    window.addEventListener("resize", reset, { passive: true });
  })();

  // Particles — drifting volt field behind the hero, lightly cursor-reactive
  (() => {
    const cv = $("#hero-particles"); if (!cv || reduceMotion) return;
    const ctx = cv.getContext("2d"); if (!ctx) return;
    let w = 0, h = 0, dpr = 1, parts = [], raf = 0; const mouse = { x: -999, y: -999 };
    const count = () => Math.min(64, Math.round(window.innerWidth / 24));
    function size() {
      dpr = Math.min(2, window.devicePixelRatio || 1);
      const r = cv.getBoundingClientRect(); w = r.width; h = r.height;
      cv.width = w * dpr; cv.height = h * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    function init() { size(); parts = Array.from({ length: count() }, () => ({ x: Math.random() * w, y: Math.random() * h, vx: (Math.random() - 0.5) * 0.25, vy: (Math.random() - 0.5) * 0.25, r: Math.random() * 1.6 + 0.4 })); }
    function frame() {
      ctx.clearRect(0, 0, w, h);
      for (const p of parts) {
        p.x += p.vx; p.y += p.vy;
        if (p.x < 0) p.x = w; if (p.x > w) p.x = 0; if (p.y < 0) p.y = h; if (p.y > h) p.y = 0;
        const near = Math.hypot(p.x - mouse.x, p.y - mouse.y) < 120;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 6.283);
        ctx.fillStyle = near ? "rgba(216,255,62,0.9)" : "rgba(216,255,62,0.32)"; ctx.fill();
      }
      for (let i = 0; i < parts.length; i++) for (let j = i + 1; j < parts.length; j++) {
        const a = parts[i], b = parts[j], d = Math.hypot(a.x - b.x, a.y - b.y);
        if (d < 92) { ctx.globalAlpha = (1 - d / 92) * 0.12; ctx.strokeStyle = "#d8ff3e"; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); ctx.globalAlpha = 1; }
      }
      raf = requestAnimationFrame(frame);
    }
    init(); frame();
    window.addEventListener("resize", () => { cancelAnimationFrame(raf); init(); frame(); }, { passive: true });
    window.addEventListener("mousemove", (e) => { const r = cv.getBoundingClientRect(); mouse.x = e.clientX - r.left; mouse.y = e.clientY - r.top; }, { passive: true });
    window.addEventListener("mouseout", () => { mouse.x = mouse.y = -999; }, { passive: true });
  })();

  // Count Up — stats tick up when scrolled into view
  (() => {
    const els = $$("[data-countup]"); if (!els.length) return;
    if (reduceMotion) { els.forEach((el) => (el.textContent = el.dataset.countup)); return; }
    const run = (el) => {
      const target = parseFloat(el.dataset.countup) || 0, dur = 1100, t0 = performance.now();
      const tick = (t) => { const p = Math.min(1, (t - t0) / dur); el.textContent = Math.round(target * (1 - Math.pow(1 - p, 3))); if (p < 1) requestAnimationFrame(tick); };
      requestAnimationFrame(tick);
    };
    const io2 = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { run(e.target); io2.unobserve(e.target); } }), { threshold: 0.6 });
    els.forEach((el) => io2.observe(el));
  })();

  // Click Spark — volt burst on click
  (() => {
    if (reduceMotion) return;
    let cv, ctx, raf = 0; const sparks = [];
    const resize = () => { const dpr = Math.min(2, devicePixelRatio || 1); cv.width = innerWidth * dpr; cv.height = innerHeight * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); };
    function ensure() { if (cv) return; cv = document.createElement("canvas"); cv.id = "spark-canvas"; document.body.appendChild(cv); ctx = cv.getContext("2d"); resize(); window.addEventListener("resize", resize, { passive: true }); }
    function loop() {
      ctx.clearRect(0, 0, innerWidth, innerHeight);
      for (let i = sparks.length - 1; i >= 0; i--) { if (sparks[i].life <= 0) sparks.splice(i, 1); }
      for (const s of sparks) {
        s.life--; s.x += s.vx; s.y += s.vy; s.vy += 0.05;
        ctx.globalAlpha = Math.max(0, s.life / s.max); ctx.strokeStyle = "#d8ff3e"; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.lineTo(s.x - s.vx * 2, s.y - s.vy * 2); ctx.stroke();
      }
      ctx.globalAlpha = 1;
      raf = sparks.length ? requestAnimationFrame(loop) : 0;
    }
    window.addEventListener("click", (e) => {
      ensure();
      const n = 10;
      for (let i = 0; i < n; i++) { const a = (Math.PI * 2 * i) / n + Math.random() * 0.4, sp = 2 + Math.random() * 3; sparks.push({ x: e.clientX, y: e.clientY, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 26, max: 26 }); }
      if (!raf) loop();
    }, { passive: true });
  })();

  // Spotlight Card — radial glow follows the cursor across product cards
  if (!reduceMotion) {
    $$("[data-spotlight]").forEach((cardEl) => {
      cardEl.addEventListener("pointermove", (e) => {
        const r = cardEl.getBoundingClientRect();
        cardEl.style.setProperty("--mx", ((e.clientX - r.left) / r.width * 100) + "%");
        cardEl.style.setProperty("--my", ((e.clientY - r.top) / r.height * 100) + "%");
      }, { passive: true });
    });
  }

  renderCart();
})();

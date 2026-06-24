/* ============================================================
   KICKS ON DECK — storefront runtime
   Cart (localStorage) · drawer · search · size select · checkout handoff
   ============================================================ */
(() => {
  "use strict";
  const CFG = window.KOD_CONFIG || {};
  const CART_KEY = "kod_cart_v1";
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const money = (n) => "$" + Number(n || 0).toLocaleString("en-US");

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

  /* ---------- newsletter (graceful, no backend) ---------- */
  $("#news-form")?.addEventListener("submit", (e) => { e.preventDefault(); toast("You're on the list"); e.target.reset(); });

  renderCart();
})();

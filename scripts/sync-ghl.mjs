// Sync GoHighLevel products -> data/products.json
// Usage: GHL_PIT=pit-xxx GHL_LOCATION_ID=loc node scripts/sync-ghl.mjs
// The PIT is read from the environment and is NEVER written to disk or shipped to the browser.
import fs from 'node:fs';

const PIT = process.env.GHL_PIT;
const LOC = process.env.GHL_LOCATION_ID;
const BASE = 'https://services.leadconnectorhq.com';
const HEADERS = { Authorization: `Bearer ${PIT}`, Version: '2021-07-28', Accept: 'application/json' };

if (!PIT || !LOC) { console.error('Missing GHL_PIT or GHL_LOCATION_ID env vars'); process.exit(1); }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(pathname, params = {}) {
  const url = new URL(BASE + pathname);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  for (let tries = 0; ; tries++) {
    const res = await fetch(url, { headers: HEADERS });
    if (res.status === 429) { await sleep(1000 * (tries + 1)); continue; }
    if (!res.ok) throw new Error(`${res.status} ${pathname}: ${(await res.text()).slice(0, 200)}`);
    return res.json();
  }
}

async function listAllProducts() {
  const all = []; const limit = 100;
  for (let offset = 0; ; offset += limit) {
    const j = await api('/products/', { locationId: LOC, limit, offset });
    const items = j.products || [];
    all.push(...items);
    if (items.length < limit) break;
  }
  return all;
}

const pricesFor = async (id) => (await api(`/products/${id}/price`, { locationId: LOC, limit: 100 })).prices || [];

async function pool(items, n, fn) {
  const out = new Array(items.length); let i = 0;
  const worker = async () => { while (i < items.length) { const idx = i++; out[idx] = await fn(items[idx], idx); } };
  await Promise.all(Array.from({ length: n }, worker));
  return out;
}

function classify(name) {
  const n = name.toLowerCase();
  if (n.includes('brush') || n.includes('cleaner') || n.includes('care') || n.includes('accessor') || n.includes('dispenser')) return 'accessories';
  if (n.includes('slide')) return 'slides';
  if (n.includes('foam') || n.includes('rnnr')) return 'foam-rnnr';
  if (n.includes('350') || n.includes('boost')) return '350-v2';
  return 'sneakers';
}
const stripHtml = (h) => (h || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
const slugify = (s) => s.toLowerCase().replace(/rep version:?/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
const cleanName = (s) => s.replace(/rep version:?/i, '').trim();

const raw = await listAllProducts();
console.log('Fetched products:', raw.length);

const seen = new Set();
const products = await pool(raw, 5, async (p) => {
  let prices = [];
  try { prices = await pricesFor(p._id); } catch (e) { console.error('price err', p.name, e.message); }
  await sleep(40);
  const variants = prices
    .filter((pr) => typeof pr.amount === 'number' && !pr.deleted)
    .map((pr) => ({
      id: pr._id, name: pr.name || 'Default', sku: pr.sku || '',
      amount: pr.amount, currency: pr.currency || 'USD', compareAt: pr.compareAtPrice || 0,
      stock: pr.availableQuantity ?? null, allowOOS: !!pr.allowOutOfStockPurchases,
    }));
  const amounts = variants.map((v) => v.amount);
  const images = [];
  if (p.image) images.push(p.image);
  for (const m of (p.medias || [])) { const u = m.url || m; if (u && !images.includes(u)) images.push(u); }
  let slug = slugify(p.name) || p._id;
  while (seen.has(slug)) slug = slug + '-' + p._id.slice(-4);
  seen.add(slug);
  return {
    id: p._id, name: cleanName(p.name), rawName: p.name, slug,
    collection: classify(p.name), type: p.productType,
    descHtml: p.description || '', descText: stripHtml(p.description).slice(0, 400),
    image: images[0] || '', images,
    variants, minPrice: amounts.length ? Math.min(...amounts) : null, maxPrice: amounts.length ? Math.max(...amounts) : null,
    currency: variants[0]?.currency || 'USD',
    inStock: variants.some((v) => v.allowOOS || (v.stock ?? 0) > 0),
    availableInStore: !!p.availableInStore,
  };
});

const order = { '350-v2': 1, 'foam-rnnr': 2, 'slides': 3, 'sneakers': 4, 'accessories': 5 };
products.sort((a, b) => (order[a.collection] - order[b.collection]) || a.name.localeCompare(b.name));

const collectionMeta = [
  { slug: '350-v2', title: '350 V2', tagline: 'The icon, reimagined' },
  { slug: 'foam-rnnr', title: 'Foam Runners', tagline: 'Sculpted future-form' },
  { slug: 'slides', title: 'Slides', tagline: 'Off-duty essential' },
  { slug: 'sneakers', title: 'Sneakers', tagline: 'The full rotation' },
  { slug: 'accessories', title: 'Accessories', tagline: 'Keep them fresh' },
];
const counts = {};
for (const p of products) counts[p.collection] = (counts[p.collection] || 0) + 1;
const collections = collectionMeta.filter((c) => counts[c.slug]).map((c) => ({ ...c, count: counts[c.slug] }));

const out = { generatedAt: new Date().toISOString(), location: LOC, count: products.length, collections, products };
fs.mkdirSync('data', { recursive: true });
fs.writeFileSync('data/products.json', JSON.stringify(out, null, 2));
console.log('Wrote data/products.json:', products.length, 'products');
console.log('By collection:', counts);
const priced = products.filter((p) => p.minPrice != null);
console.log('Priced products:', priced.length, '| range $' + Math.min(...priced.map((p) => p.minPrice)), '- $' + Math.max(...priced.map((p) => p.maxPrice)));
console.log('Products with 0 variants:', products.filter((p) => !p.variants.length).length);

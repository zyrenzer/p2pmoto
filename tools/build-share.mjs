// สร้างหน้าแชร์ของแต่ละสินค้า: p/<id>/index.html
// หน้านี้มีแท็ก og: (รูปแรก ชื่อ ราคา) ให้ Facebook / Messenger / LINE ดึงไปทำรูปตัวอย่าง
// แล้วพาคนที่กดลิงก์ไปหน้าสินค้าในเว็บ (/?p=<id>) ทันที
// รันโดย GitHub Actions (.github/workflows/share-pages.yml) ทุก 15 นาที หรือกดรันเองได้
import { readFileSync, writeFileSync, mkdirSync, rmSync, readdirSync, existsSync } from 'node:fs';

const SITE = 'https://p2pmoto.com';
const html = readFileSync('index.html', 'utf8');
const URL_ = html.match(/SUPABASE_URL:\s*'([^']+)'/)[1];
const KEY = html.match(/SUPABASE_ANON_KEY:\s*'([^']+)'/)[1];
const SUB = (html.match(/SHOP_SUB:\s*'([^']*)'/) || [])[1] || '';

const res = await fetch(`${URL_}/rest/v1/parts?select=id,name,price,photos,options,model,stock,coming`, {
  headers: { apikey: KEY, Authorization: `Bearer ${KEY}` }
});
if (!res.ok) throw new Error('โหลดสินค้าไม่ได้: ' + res.status + ' ' + await res.text());
const parts = await res.json();
if (!Array.isArray(parts) || !parts.length) throw new Error('ไม่พบสินค้า (ไม่ลบหน้าเดิม)');

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = n => Math.round(n || 0).toLocaleString('en-US');
const photoUrl = p => `${URL_}/storage/v1/object/public/parts/${p.split('/').map(encodeURIComponent).join('/')}`;

const priceText = it => {
  const opts = Array.isArray(it.options) ? it.options : [];
  let lo = Number(it.price) || 0, hi = lo, stock = Number(it.stock ?? 1) || 0;
  if (opts.length) {
    const inStock = opts.filter(o => (Number(o.stock) || 0) > 0);
    const ps = (inStock.length ? inStock : opts).map(o => Number(o.price) || 0);
    lo = Math.min(...ps); hi = Math.max(...ps); stock = inStock.length;
  }
  if (!lo) return '';
  let t = (hi > lo ? 'เริ่ม ' : '') + fmt(lo) + ' บาท';
  if (it.coming) t += ' · เร็วๆ นี้';
  else if (stock <= 0) t += ' · สินค้าหมด';
  return t;
};

const page = it => {
  const id = it.id, link = `${SITE}/p/${id}/`, target = `/?p=${encodeURIComponent(id)}`;
  const first = (it.photos || [])[0] || ((it.options || []).find(o => o.photo) || {}).photo;
  const img = first ? photoUrl(first) : `${SITE}/favicon-192.png`;
  const price = priceText(it);
  const title = it.name + (price ? ' · ' + price : '');
  const desc = [it.model, 'P2P Moto ' + SUB].filter(Boolean).join(' · ');
  return `<!DOCTYPE html>
<html lang="th"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} | P2P Moto</title>
<meta name="description" content="${esc(desc)}">
<meta property="og:type" content="product">
<meta property="og:site_name" content="P2P Moto">
<meta property="og:url" content="${esc(link)}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:image" content="${esc(img)}">
<meta property="og:image:secure_url" content="${esc(img)}">
<meta property="og:image:alt" content="${esc(it.name)}">
<meta property="og:locale" content="th_TH">
<meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="/favicon.ico?v=1" sizes="any">
<script>location.replace(${JSON.stringify(target)} + location.hash);</script>
</head><body style="font-family:sans-serif;text-align:center;padding:40px">
<p><a href="${esc(target)}">${esc(it.name)}</a></p>
</body></html>
`;
};

mkdirSync('p', { recursive: true });
const keep = new Set();
for (const it of parts) {
  if (!/^[0-9a-f-]{36}$/i.test(it.id)) continue;
  keep.add(it.id);
  mkdirSync(`p/${it.id}`, { recursive: true });
  writeFileSync(`p/${it.id}/index.html`, page(it));
}
// ลบหน้าของสินค้าที่ถูกลบไปแล้ว
for (const d of readdirSync('p')) if (!keep.has(d) && existsSync(`p/${d}/index.html`)) rmSync(`p/${d}`, { recursive: true });
console.log('หน้าแชร์', keep.size, 'ชิ้น');

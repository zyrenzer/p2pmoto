// สร้างหน้าแชร์ของแต่ละสินค้า: p/<id>/index.html
// หน้านี้มีแท็ก og: (รูปแรก ชื่อ ราคา) ให้ Facebook / Messenger / LINE ดึงไปทำรูปตัวอย่าง
// แล้วพาคนที่กดลิงก์ไปหน้าสินค้าในเว็บ (/?p=<id>) ทันที
// รันโดย GitHub Actions (.github/workflows/share-pages.yml) ทุก 15 นาที หรือกดรันเองได้
import { readFileSync, writeFileSync, mkdirSync, rmSync, readdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createCanvas, loadImage, GlobalFonts } from '@napi-rs/canvas';
GlobalFonts.registerFromPath('fc-vision.woff2', 'FCV');

const SITE = 'https://p2pmoto.com';
const html = readFileSync('index.html', 'utf8');
const URL_ = html.match(/SUPABASE_URL:\s*'([^']+)'/)[1];
const KEY = html.match(/SUPABASE_ANON_KEY:\s*'([^']+)'/)[1];
const cfg = k => (html.match(new RegExp(k + ":\\s*'([^']*)'")) || [])[1] || '';
const SUB = cfg('SHOP_SUB'), LINE = cfg('CONTACT_LINE'), PHONE = cfg('CONTACT_PHONE');
// ข้อความใต้ชื่อสินค้า (ด้านขวาของการ์ดตอนแชร์)
const CONTACT = [LINE && '💬 LINE ' + LINE, PHONE && '📞 ' + PHONE].filter(Boolean).join('   ') || ('P2P Moto ' + SUB);

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
  if (!lo) return null;
  return { from: hi > lo, num: fmt(lo), note: it.coming ? 'เร็วๆ นี้' : stock <= 0 ? 'สินค้าหมด' : '' };
};

// รูปตอนแชร์: รูปแรกของสินค้าเต็มกรอบ + ราคาสีแดงทับบนรูป (มุมซ้ายล่าง ขอบขาวบางๆ ให้อ่านออกทุกพื้น)
// Facebook วาดการ์ดเอง จึงต้องใส่ราคาลงในรูป
const S = 1080, RED = '#e0201b';
const makeImage = async (src, price) => {
  const res = await fetch(src);
  if (!res.ok) throw new Error('โหลดรูปไม่ได้ ' + res.status + ' ' + src);
  const img = await loadImage(Buffer.from(await res.arrayBuffer()));
  const c = createCanvas(S, S), x = c.getContext('2d');
  x.fillStyle = '#fff'; x.fillRect(0, 0, S, S);
  const k = Math.max(S / img.width, S / img.height), w = img.width * k, h = img.height * k;
  x.drawImage(img, (S - w) / 2, (S - h) / 2, w, h);
  if (price) {
    const parts = [];
    if (price.from) parts.push(['เริ่ม ', 56]);
    parts.push([price.num, 96], [' บาท', 58]);
    if (price.note) parts.push([' · ' + price.note, 56]);
    const font = n => `bold ${n}px FCV`;
    let px = 44; const base = S - 52;
    x.lineJoin = 'round';
    for (const [t, n] of parts) {
      x.font = font(n);
      x.shadowColor = 'rgba(0,0,0,.45)'; x.shadowBlur = 14; x.shadowOffsetY = 3;
      x.lineWidth = Math.round(n / 7); x.strokeStyle = '#fff'; x.strokeText(t, px, base);
      x.shadowColor = 'transparent';
      x.fillStyle = RED; x.fillText(t, px, base);
      px += x.measureText(t).width;
    }
  }
  return c.toBuffer('image/jpeg', 86);
};

const page = (it, img, stamp) => {
  const id = it.id, link = `${SITE}/p/${id}/`, target = `/?p=${encodeURIComponent(id)}`;
  const title = [it.name, it.model].filter(Boolean).join(' ');
  const desc = CONTACT;
  return `<!DOCTYPE html>
<html lang="th"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} | P2P Moto</title>
<meta name="description" content="${esc(desc)}">
<meta name="p2p-og" content="${esc(stamp)}">
<meta property="og:type" content="product">
<meta property="og:site_name" content="P2P Moto">
<meta property="og:url" content="${esc(link)}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:image" content="${esc(img)}">
<meta property="og:image:secure_url" content="${esc(img)}">
<meta property="og:image:width" content="${S}">
<meta property="og:image:height" content="${S}">
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
  const dir = `p/${it.id}`;
  mkdirSync(dir, { recursive: true });
  const first = (it.photos || [])[0] || ((it.options || []).find(o => o.photo) || {}).photo;
  const price = priceText(it);
  // สร้างรูปใหม่เฉพาะเมื่อรูปแรกหรือราคาเปลี่ยน
  const stamp = createHash('sha1').update(JSON.stringify([first, price, S, 3])).digest('hex').slice(0, 10);
  const old = existsSync(`${dir}/index.html`) ? (readFileSync(`${dir}/index.html`, 'utf8').match(/name="p2p-og" content="([^"]+)/) || [])[1] : null;
  let img = `${SITE}/favicon-192.png`;
  if (first) {
    try {
      if (old !== stamp || !existsSync(`${dir}/og.jpg`)) writeFileSync(`${dir}/og.jpg`, await makeImage(photoUrl(first), price));
      img = `${SITE}/${dir}/og.jpg?v=${stamp}`;
    } catch (e) { console.warn(it.id, e.message); img = photoUrl(first); }
  }
  writeFileSync(`${dir}/index.html`, page(it, img, stamp));
}
// ลบหน้าของสินค้าที่ถูกลบไปแล้ว
for (const d of readdirSync('p')) if (!keep.has(d) && existsSync(`p/${d}/index.html`)) rmSync(`p/${d}`, { recursive: true });
console.log('หน้าแชร์', keep.size, 'ชิ้น');

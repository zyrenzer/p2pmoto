
(() => {
  const C = window.SHOP_CONFIG || {};
  const MAX = 10, MAX_SIDE = 1400, BUCKET = 'parts';
  const $ = s => document.querySelector(s);
  const SHIP = Number(C.SHIPPING ?? 50) || 0;
  const fmtTHB = n => Math.round(n || 0).toLocaleString('en-US') + '<span class="baht">บาท</span>';
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  // UUID v4 (randomUUID ใช้ได้เฉพาะ https จึงมีสำรองด้วย getRandomValues)
  // รูปย่อสำหรับการ์ด (ด้านยาวไม่เกิน 500px และเพิ่มความคม) เก็บไว้ที่ ts/<ชื่อรูป> · จอคอมย่อรูปใหญ่ 1400px ลงเหลือ 200px แล้วตัวหนังสือแตก
  const TH = p => 'm/' + p, TS = p => 's/' + p;
  const uid = () => crypto.randomUUID ? crypto.randomUUID()
    : ([1e7] + -1e3 + -4e3 + -8e3 + -1e11).replace(/[018]/g, c => (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16));

  $('#shopName').textContent = C.SHOP_NAME || 'P2P Moto';
  $('#shopSub').textContent = C.SHOP_SUB || '';
  document.title = C.SHOP_NAME || 'P2P Moto';

  // ── theme ──
  const setTheme = t => { document.documentElement.dataset.theme = t; try { localStorage.setItem('p2p_theme', t); } catch {} };
  let theme = 'light';
  try { theme = localStorage.getItem('p2p_theme') || 'light'; } catch {}
  setTheme(theme);
  $('#themeBtn').onclick = () => setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');

  // ── backend: Supabase (จริง) หรือ local (โหมดตัวอย่าง) ──
  // photo = { path, url }  · part = { id, name, price, stock, photos:[path], created_at } · sold = stock 0
  const live = !!(C.SUPABASE_URL && C.SUPABASE_ANON_KEY && window.supabase);
  // ลิงก์ตั้งรหัสใหม่จากอีเมล: อ่านก่อนที่ supabase จะล้าง # ออก
  const authHash = (() => { try { return new URLSearchParams(location.hash.slice(1)); } catch { return new URLSearchParams(); } })();
  let recovering = authHash.get('type') === 'recovery';
  const authErr = authHash.get('error_code') || authHash.get('error');
  const sb = live ? window.supabase.createClient(C.SUPABASE_URL, C.SUPABASE_ANON_KEY) : null;

  const Local = (() => {
    let db = null; const blobs = new Map();
    const open = () => new Promise(res => {
      try {
        const r = indexedDB.open('p2p_parts_web', 4);
        r.onupgradeneeded = () => {
          const d = r.result;
          if (!d.objectStoreNames.contains('parts')) d.createObjectStore('parts', { keyPath: 'id' });
          if (!d.objectStoreNames.contains('files')) d.createObjectStore('files');
          if (!d.objectStoreNames.contains('orders')) d.createObjectStore('orders', { keyPath: 'id' });
          if (!d.objectStoreNames.contains('cats')) d.createObjectStore('cats', { keyPath: 'id' });
          if (!d.objectStoreNames.contains('costs')) d.createObjectStore('costs');
        };
        r.onsuccess = () => res(r.result); r.onerror = () => res(null);
      } catch { res(null); }
    });
    // สำรองในหน่วยความจำ ถ้าเบราว์เซอร์ไม่ให้ใช้ IndexedDB (ข้อมูลหายเมื่อรีเฟรช)
    const mem = {};
    const memStore = name => {
      const m = mem[name] || (mem[name] = new Map());
      return { get: k => ({ result: m.get(k) }), getAll: () => ({ result: [...m.values()] }), getAllKeys: () => ({ result: [...m.keys()] }),
        put: (v, k) => { m.set(k ?? v.id, v); return {}; }, delete: k => { m.delete(k); return {}; } };
    };
    const tx = (store, mode, fn) => new Promise(res => {
      if (!db) { const r = fn(memStore(store)); return res(r && r.result); }
      try { const t = db.transaction(store, mode); const r = fn(t.objectStore(store)); t.oncomplete = () => res(r && r.result); t.onerror = () => res(); }
      catch { res(); }
    });
    return {
      async init() { db = await open(); },
      async session() { try { return sessionStorage.getItem('p2p_demo_seller') === '1'; } catch { return false; } },
      async signIn() { try { sessionStorage.setItem('p2p_demo_seller', '1'); } catch {} },
      async signOut() { try { sessionStorage.removeItem('p2p_demo_seller'); } catch {} },
      async list() { return ((await tx('parts', 'readonly', s => s.getAll())) || []).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))); },
      async upload(blob, path = uid() + '.jpg') { await tx('files', 'readwrite', s => s.put(blob, path)); return path; },
      async removeFiles(paths) { for (const p of [...paths, ...paths.map(TH), ...paths.map(TS)]) { await tx('files', 'readwrite', s => s.delete(p)); blobs.delete(p); } },
      async listThumbs() { return null; },
      async save(part) { await tx('parts', 'readwrite', s => s.put(part)); },
      async remove(id) { await tx('parts', 'readwrite', s => s.delete(id)); },
      async listCats() { return ((await tx('cats', 'readonly', s => s.getAll())) || []).sort((a, b) => (a.sort || 0) - (b.sort || 0) || a.created_at.localeCompare(b.created_at)); },
      async saveCat(c) { await tx('cats', 'readwrite', s => s.put(c)); },
      async saveCats(list) { for (const c of list) await tx('cats', 'readwrite', s => s.put(c)); },
      async getSettings() { const d = { shopee_url: 'https://shopee.co.th/', lazada_url: 'https://www.lazada.co.th/' }; try { return JSON.parse(localStorage.getItem('p2p_demo_settings') || 'null') || d; } catch { return d; } },
      async saveSettings(o) { const v = { ...(await this.getSettings()), ...o }; try { localStorage.setItem('p2p_demo_settings', JSON.stringify(v)); } catch {} },
      async listCosts() { return (await tx('costs', 'readonly', s => s.getAll())) || []; },
      async saveCost(c) { await tx('costs', 'readwrite', s => s.put(c, c.part_id)); },
      async setSorts(list) { for (const { id, sort } of list) { const p = await tx('parts', 'readonly', s => s.get(id)); if (p) await tx('parts', 'readwrite', s => s.put({ ...p, sort })); } },
      async removeCat(id) {
        await tx('cats', 'readwrite', s => s.delete(id));
        for (const p of await this.list()) if (p.category_id === id) await tx('parts', 'readwrite', s => s.put({ ...p, category_id: null }));
      },
      async patchParts(ids, patch) {
        for (const id of ids) { const p = await tx('parts', 'readonly', s => s.get(id)); if (p) await tx('parts', 'readwrite', s => s.put({ ...p, ...patch })); }
      },
      // จำลอง trigger ฝั่ง Supabase: เช็คสต็อก ตัดสต็อก และคิดราคาจากข้อมูลจริง
      async placeOrder(o) {
        let total = 0; const out = [];
        for (const i of o.items) {
          const p = await tx('parts', 'readonly', s => s.get(i.id));
          if (!p) throw new Error('สินค้าไม่มีแล้ว');
          const opts = p.options || [];
          if (opts.length) {
            const k = opts.findIndex(x => x.id === i.opt);
            if (k < 0) throw new Error(`กรุณาเลือกตัวเลือกของสินค้า ${p.name} ใหม่`);
            const op = opts[k];
            if (op.stock < i.qty) throw new Error(`สินค้า ${p.name} (${op.name}) เหลือไม่พอ (เหลือ ${op.stock} ชิ้น)`);
            opts[k] = { ...op, stock: op.stock - i.qty };
            await tx('parts', 'readwrite', s => s.put({ ...p, options: opts, stock: Math.max(0, (p.stock ?? 0) - i.qty) }));
            out.push({ id: p.id, opt: op.id, name: `${p.name} (${op.name})`, price: op.price, qty: i.qty });
          } else {
            if ((p.stock ?? 1) < i.qty) throw new Error(`สินค้า ${p.name} เหลือไม่พอ (เหลือ ${p.stock} ชิ้น)`);
            await tx('parts', 'readwrite', s => s.put({ ...p, stock: (p.stock ?? 1) - i.qty }));
            out.push({ id: p.id, name: p.name, price: p.price, qty: i.qty });
          }
        }
        for (const i of out) total += i.price * i.qty;
        await tx('orders', 'readwrite', s => s.put({ ...o, user_id: me ? me.id : null, shipping: SHIP, total: total + SHIP, items: out }));
      },
      async listOrders() { return ((await tx('orders', 'readonly', s => s.getAll())) || []).sort((a, b) => b.created_at.localeCompare(a.created_at)); },
      async setOrderStatus(id, status) {
        const o = await tx('orders', 'readonly', s => s.get(id));
        if (!o) return;
        const d = (o.status !== 'cancelled' && status === 'cancelled') ? 1 : (o.status === 'cancelled' && status !== 'cancelled') ? -1 : 0;
        for (const i of d ? o.items : []) {
          const p = await tx('parts', 'readonly', s => s.get(i.id));
          if (!p) continue;
          const opts = (p.options || []).map(x => x.id === i.opt ? { ...x, stock: x.stock + d * i.qty } : x);
          if (d < 0 && (p.stock < i.qty || opts.some(x => x.stock < 0))) throw new Error(`สินค้า ${i.name} เหลือไม่พอ`);
          await tx('parts', 'readwrite', s => s.put({ ...p, options: opts, stock: p.stock + d * i.qty }));
        }
        await tx('orders', 'readwrite', s => s.put({ ...o, status }));
      },

      // ── สมาชิก (โหมดตัวอย่าง: เก็บในเครื่องนี้) ──
      acc: {
        users() { try { return JSON.parse(localStorage.getItem('p2p_demo_users') || '{}'); } catch { return {}; } },
        put(u) { try { localStorage.setItem('p2p_demo_users', JSON.stringify(u)); } catch {} },
        async current() { let e = null; try { e = localStorage.getItem('p2p_demo_me'); } catch {} const u = e && this.users()[e]; return u ? { id: 'demo-' + e, email: e, name: u.name, phone: u.phone, address: u.address || '', favs: u.favs || [] } : null; },
        async signUp({ email, password, name, phone }) { const u = this.users(); if (u[email]) throw new Error('อีเมลนี้สมัครไว้แล้ว'); if (Object.values(u).some(x => x.phone === phone)) throw new Error('phone taken'); u[email] = { pass: password, name, phone, address: '', favs: [] }; this.put(u); try { localStorage.setItem('p2p_demo_me', email); } catch {} return true; },
        async signIn(email, password) { if (!email.includes('@')) email = (Object.entries(this.users()).find(([, x]) => x.phone === email) || [''])[0]; const u = this.users()[email]; if (!u || u.pass !== password) throw new Error('Invalid login'); try { localStorage.setItem('p2p_demo_me', email); } catch {} },
        async signOut() { try { localStorage.removeItem('p2p_demo_me'); } catch {} },
        async resetSend(id) { const u = this.users(); const e = id.includes('@') ? id : (Object.entries(u).find(([, x]) => x.phone === id) || [''])[0]; if (!u[e]) return 'sent'; try { localStorage.setItem('p2p_demo_me', e); } catch {} return 'demo'; },
        async setPassword(pw) { const e = localStorage.getItem('p2p_demo_me'), u = this.users(); if (!u[e]) throw new Error('no session'); u[e].pass = pw; this.put(u); },
        async isAdmin() { return false; },
        async saveProfile(p) { const e = localStorage.getItem('p2p_demo_me'), u = this.users(); if (!u[e]) return; if (p.phone && Object.entries(u).some(([k, x]) => k !== e && x.phone === p.phone)) throw new Error('phone taken'); Object.assign(u[e], p); this.put(u); },
        async myOrders(me) { return ((await tx('orders', 'readonly', s => s.getAll())) || []).filter(o => o.user_id === me.id).sort((a, b) => b.created_at.localeCompare(a.created_at)); }
      },
      async urlFor(path) {
        if (!blobs.has(path)) { const b = await tx('files', 'readonly', s => s.get(path)); blobs.set(path, b ? URL.createObjectURL(b) : ''); }
        return blobs.get(path);
      }
    };
  })();

  const Remote = {
    async init() {},
    async session() { const { data } = await sb.auth.getSession(); return !!data.session; },
    async signIn(email, password) { const { error } = await sb.auth.signInWithPassword({ email, password }); if (error) throw error; },
    async signOut() { await sb.auth.signOut(); },
    async list() { const { data, error } = await sb.from('parts').select('*').order('created_at', { ascending: false }); if (error) throw error; return data || []; },
    async upload(blob, path = uid() + '.jpg') {
      const { error } = await sb.storage.from(BUCKET).upload(path, blob, { contentType: 'image/jpeg', cacheControl: '31536000' });
      if (error) throw error; return path;
    },
    async removeFiles(paths) { if (paths.length) await sb.storage.from(BUCKET).remove(paths.flatMap(p => [p, TH(p), TS(p), 't/' + p, 'ts/' + p])); },
    async listThumbs() {
      const { data, error } = await sb.storage.from(BUCKET).list('m', { limit: 10000 });
      if (error) throw error; return new Set((data || []).map(f => f.name));
    },
    async save(part) { const { error } = await sb.from('parts').upsert(part); if (error) throw error; },
    async remove(id) { const { error } = await sb.from('parts').delete().eq('id', id); if (error) throw error; },
    async listCats() { const { data, error } = await sb.from('categories').select('*').order('sort').order('created_at'); if (error) throw error; return data || []; },
    async saveCat(c) { const { error } = await sb.from('categories').upsert(c); if (error) throw error; },
    async saveCats(list) { const { error } = await sb.from('categories').upsert(list); if (error) throw error; },
    async getSettings() { const { data, error } = await sb.from('shop_settings').select('key,value'); if (error) throw error; return Object.fromEntries((data || []).map(r => [r.key, r.value])); },
    async saveSettings(o) { const { error } = await sb.from('shop_settings').upsert(Object.entries(o).map(([key, value]) => ({ key, value, updated_at: new Date().toISOString() }))); if (error) throw error; },
    async removeCat(id) { const { error } = await sb.from('categories').delete().eq('id', id); if (error) throw error; },
    // ต้นทุนอยู่ตาราง part_costs แยกจาก parts · RLS ให้อ่าน/เขียนได้เฉพาะอีเมลแอดมิน (ลูกค้าโหลดไม่ได้)
    async listCosts() { const { data, error } = await sb.from('part_costs').select('*'); if (error) throw error; return data || []; },
    async saveCost(c) { const { error } = await sb.from('part_costs').upsert(c); if (error) throw error; },
    async setSorts(list) {
      const rs = await Promise.all(list.map(({ id, sort }) => sb.from('parts').update({ sort }).eq('id', id)));
      const bad = rs.find(r => r.error); if (bad) throw bad.error;
    },
    async patchParts(ids, patch) { if (!ids.length) return; const { error } = await sb.from('parts').update(patch).in('id', ids); if (error) throw error; },
    // ลูกค้าเพิ่มออเดอร์ได้อย่างเดียว อ่านไม่ได้ (จึงไม่ขอข้อมูลคืน)
    async placeOrder(o) { const { error } = await sb.from('orders').insert(o); if (error) throw error; },
    async listOrders() { const { data, error } = await sb.from('orders').select('*').order('created_at', { ascending: false }); if (error) throw error; return data || []; },
    async setOrderStatus(id, status) { const { error } = await sb.from('orders').update({ status }).eq('id', id); if (error) throw error; },

    // ── สมาชิก (Supabase Auth + ตาราง profiles) ──
    acc: {
      async current() {
        const { data } = await sb.auth.getSession(); const u = data.session && data.session.user; if (!u) return null;
        const { data: p } = await sb.from('profiles').select('name,phone,address,favs').eq('id', u.id).maybeSingle();
        const m = u.user_metadata || {};
        return { id: u.id, email: u.email, name: (p && p.name) || m.name || '', phone: (p && p.phone) || m.phone || '', address: (p && p.address) || '', favs: (p && p.favs) || [] };
      },
      async signUp({ email, password, name, phone }) {
        const { data, error } = await sb.auth.signUp({ email, password, options: { data: { name, phone } } });
        if (error) throw error; return !!data.session;
      },
      async signIn(email, password) {
        if (!email.includes('@')) { const { data, error } = await sb.rpc('login_email', { p_phone: email }); if (error) throw error; if (!data) throw new Error('Invalid login'); email = data; }
        const { error } = await sb.auth.signInWithPassword({ email, password }); if (error) throw error;
      },
      async signOut() { await sb.auth.signOut(); },
      async resetSend(id) {
        let email = id;
        if (!id.includes('@')) { const { data, error } = await sb.rpc('login_email', { p_phone: id }); if (error) throw error; if (!data) return 'sent'; email = data; }
        const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname });
        if (error) throw error; return 'sent';
      },
      async setPassword(pw) { const { error } = await sb.auth.updateUser({ password: pw }); if (error) throw error; },
      async isAdmin() { const { data, error } = await sb.rpc('is_admin'); return !error && data === true; },
      async saveProfile(p) { const { data } = await sb.auth.getSession(); const u = data.session && data.session.user; if (!u) return; const { error } = await sb.from('profiles').upsert({ id: u.id, ...p, updated_at: new Date().toISOString() }); if (error) throw error; },
      async myOrders(me) { const { data, error } = await sb.from('orders').select('id,items,total,shipping,status,created_at,customer_name,phone,address,note').eq('user_id', me.id).order('created_at', { ascending: false }).limit(200); if (error) throw error; return data || []; }
    },
    async urlFor(path) { return sb.storage.from(BUCKET).getPublicUrl(path).data.publicUrl; }
  };
  const B = live ? Remote : Local;
  $('#demoBanner').hidden = live;

  // ── state ──
  let items = [], cats = [], curCat = '', seller = false, loaded = false, favView = false;
  // สมาชิก: me = { id, email, name, phone, address } · favs = รายการโปรด (id สินค้า)
  let me = null, favs = new Set();
  // สภาพสินค้า: ของใหม่ / มือสอง (parts.used)
  // '' = ทั้งหมด (ของใหม่ + มือสอง) เป็นค่าเริ่มต้นทุกครั้งที่เปิดเว็บ
  let cond = '';
  const condOk = i => (cond === '' ? true : cond === 'used' ? i.used : !i.used);
  const condHTML = () => `<button data-cond="new" class="${cond === 'new' ? 'on' : ''}" aria-pressed="${cond === 'new'}">ของใหม่</button><button data-cond="used" class="${cond === 'used' ? 'on' : ''}" aria-pressed="${cond === 'used'}">มือสอง</button>`;
  // ต้นทุน: โหลดเฉพาะตอนแอดมินล็อกอิน · ไม่เคยใส่ใน parts หรือ options
  let costs = new Map();
  const loadCosts = async () => { costs = new Map(); if (!seller) return; try { costs = new Map((await B.listCosts()).map(c => [c.part_id, c])); } catch {} };
  const urls = new Map();
  const url = p => urls.get(p) || '';
  // เบราว์เซอร์เลือกรูปย่อที่ใกล้ขนาดจอที่สุด (ย่อเพิ่มน้อยที่สุด ตัวหนังสือไม่แตก) ถ้าไม่มีรูปย่อใช้รูปเต็ม
  const tImg = (p, extra = '', sizes = '(max-width:560px) 46vw, 220px') => {
    const s = url(TS(p)), m = url(TH(p));
    return `<img src="${m || url(p)}" ${s && m ? `srcset="${s} 320w, ${m} 640w" sizes="${sizes}"` : ''} data-full="${url(p)}" onerror="if(this.dataset.full&&this.src!==this.dataset.full){this.removeAttribute('srcset');this.src=this.dataset.full}" alt="" ${extra}>`;
  };
  // รูปที่สินค้าอื่นยังใช้อยู่ (จากการคัดลอก) ห้ามลบ
  const unshared = (paths, id) => paths.filter(p => !items.some(i => i.id !== id && allPhotos(i).includes(p)));
  const allPhotos = it => [...(it.photos || []), ...(it.options || []).map(o => o.photo).filter(Boolean)];
  const resolveUrls = async list => { for (const it of list) for (const p of allPhotos(it)) if (!urls.has(p)) { urls.set(p, await B.urlFor(p)); urls.set(TH(p), await B.urlFor(TH(p))); urls.set(TS(p), await B.urlFor(TS(p))); } };

  const setSeller = v => {
    seller = v;
    if (!v) costs = new Map();
    $('#addBtn').hidden = !v;
    $('#ordersBtn').hidden = !v; $('#shopSetBtn').hidden = !v;
    // ลูกค้าไม่เห็นปุ่มนี้ · แอดมินเข้าทางลิงก์ลับ .../#admin
    $('#sellerBtn').hidden = !(v || /admin/i.test(location.hash + location.search));
    $('#sellerBtn').textContent = v ? 'ออกจากระบบแอดมิน' : 'เข้าสู่ระบบแอดมิน';
    $('#sellerBtn').classList.toggle('on', v);
    $('#admBar').hidden = $('#sellerBtn').hidden && $('#ordersBtn').hidden;
  };

  // ── contact ──
  const contactHTML = name => {
    const out = [];
    if (C.CONTACT_LINE) {
      const id = C.CONTACT_LINE.trim();
      const href = 'https://line.me/R/ti/p/' + encodeURIComponent(id.startsWith('@') ? id : '~' + id);
      out.push(`<a class="line" href="${href}" target="_blank" rel="noopener">💬 LINE ${esc(id)}</a>`);
    }
    if (C.CONTACT_FB) out.push(`<a class="fb" href="${esc(C.CONTACT_FB)}" target="_blank" rel="noopener">📘 Facebook</a>`);
    if (C.CONTACT_PHONE) out.push(`<a class="tel" href="tel:${esc(C.CONTACT_PHONE.replace(/[^\d+]/g, ''))}">📞 ${esc(C.CONTACT_PHONE)}</a>`);
    return out.join('');
  };
  let shopCfg = {};
  const openContact = () => {
    $('#contactLinks').innerHTML = contactHTML() || '<div class="hint">ยังไม่ได้ใส่ช่องทางติดต่อ</div>';
    // ปุ่มหน้าร้าน Shopee / Lazada (แอดมินใส่ลิงก์ที่ ⚙️ ตั้งค่าร้าน)
    const shops = [[shopCfg.shopee_url, 'shopee', 'ร้านเราบน Shopee'], [shopCfg.lazada_url, 'lazada', 'ร้านเราบน Lazada']]
      .filter(([u]) => okUrl(u)).map(([u, c, t]) => `<a class="${c}" href="${esc(u)}" target="_blank" rel="noopener" aria-label="${t}" title="${t}">${t}</a>`);
    $('#contactShops').innerHTML = shops.join(''); $('#contactShops').hidden = !shops.length;
    $('#contactShopHint').hidden = !(seller && shops.length < 2);
    $('#contactBox').classList.add('open');
  };
  $('#fcontact').innerHTML = [C.CONTACT_LINE && 'LINE ' + esc(C.CONTACT_LINE), C.CONTACT_PHONE && 'โทร ' + esc(C.CONTACT_PHONE)].filter(Boolean).join(' · ');

  // ── grid ──
  const catName = id => (cats.find(c => c.id === id) || {}).name || '';
  // หมวดย่อย: categories.parent_id ชี้ไปหมวดหลัก
  const catOf = id => cats.find(c => c.id === id);
  const parentOf = id => { const c = catOf(id); return c && c.parent_id && catOf(c.parent_id) ? c.parent_id : null; };
  // หมวดของใหม่กับมือสองแยกกันคนละชุด (categories.used) · หมวดย่อยตามหมวดหลัก
  // หมวดชุดเดียว ใช้ร่วมกันทั้งของใหม่และมือสอง (ของใหม่/มือสอง ดูจาก parts.used)
  const mains = () => cats.filter(c => !parentOf(c.id));
  const kids = id => cats.filter(c => parentOf(c.id) === id);
  const openMain = () => curCat && curCat !== 'none' ? (parentOf(curCat) || curCat) : null;
  const catsOf = it => [...new Set([it.category_id, ...(it.extra_cats || [])])].filter(id => id && catOf(id));
  const inC = (it, id) => catsOf(it).includes(id);
  const inTree = (it, id) => catsOf(it).some(c => c === id || parentOf(c) === id);
  const inCat = it => condOk(it) && inCatOnly(it);
  // สินค้าในหมวดหลัก (ทั่วไป) แสดงในทุกหมวดย่อยของหมวดนั้นด้วย
  const inSub = (it, sub) => inC(it, sub) || (!!parentOf(sub) && inC(it, parentOf(sub)));
  const inCatOnly = it => curCat === '' || (curCat === 'none' ? !catsOf(it).length : parentOf(curCat) ? inSub(it, curCat) : inTree(it, curCat));
  const catLabel = id => parentOf(id) ? catName(parentOf(id)) + ' › ' + catName(id) : catName(id);
  const cardHTML = (it, grip = false) => `
        <div class="card${it.sold && !it.soon ? ' is-sold' : ''}" data-id="${it.id}" tabindex="0">
          <div class="thumb">
            ${grip ? '<span class="pgrip" data-pgrip title="ลากเพื่อสลับตำแหน่ง" aria-hidden="true">⠿</span>' : ''}
            ${it.photos.length ? tImg(it.photos[0], 'loading="lazy"') : '<div class="none">NO PHOTO</div>'}
            ${it.is_new ? '<span class="newbadge">NEW</span>' : ''}
            ${seller ? `<button class="newtog${it.is_new ? ' on' : ''}" data-new="${it.id}" title="${it.is_new ? 'เอาออกจากอะไหล่เข้าใหม่' : 'เพิ่มเป็นอะไหล่เข้าใหม่'}">${it.is_new ? '× เข้าใหม่' : '+ เข้าใหม่'}</button>` : ''}
            ${it.sold ? `<div class="sold"><span>${it.soon ? 'เร็วๆ นี้' : 'สินค้าหมด'}</span></div>` : ''}
          </div>
          <div class="body">
            <div class="name" title="${esc(it.name)}">${esc(it.name)}</div>
            <div class="model" title="${esc(it.model)}">${it.model ? '🏍 ' + esc(it.model) : '&nbsp;'}</div>
            <div class="price">${priceHTML(it)}${costHTML(it)}</div>
            <div class="hint" style="margin-top:2px">${it.options.length ? it.options.length + ' ตัวเลือก · ' : ''}${it.soon ? 'รอสินค้าเข้า เร็วๆ นี้' : it.sold ? 'สินค้าหมด' : 'เหลือ ' + it.stock + ' ชิ้น'}</div>
            ${cartBtnHTML(it)}
          </div>
        </div>`;
  const mob = matchMedia('(max-width:820px)');
  mob.addEventListener('change', () => renderSide());
  const renderSide = () => {
    if (curCat && curCat !== 'none' && !catName(curCat)) curCat = '';
    const n = f => items.filter(i => condOk(i) && f(i)).length;
    const none = n(i => !catsOf(i).length);
    const real = id => seller && id && id !== 'none';
    const row = (id, name, count, cls = '', parent = '') => `<div class="catrow${cls}"${real(id) ? ` data-cid="${id}" data-parent="${parent}"` : ''}>
        ${real(id) ? `<span class="grip" data-grip="${id}" title="ลากเพื่อสลับลำดับ" aria-hidden="true">⠿</span>` : ''}
        <button class="cat${curCat === id ? ' on' : ''}" data-cat="${id}"><span class="nm">${esc(name)}</span><span class="n">${count}</span></button>
        ${real(id) ? `<button class="cx" data-catdel="${id}" title="ลบหมวด" aria-label="ลบหมวด ${esc(name)}">×</button>` : ''}
      </div>`;
    const om = openMain();
    const subs = id => {
      if (id !== om) return '';
      const k = kids(id);
      const list = k.map(c => row(c.id, c.name, n(i => inSub(i, c.id)), ' sub', id)).join('');
      const add = seller ? `<div class="catadd sub"><input class="in" id="newSub" maxlength="60" placeholder="หมวดย่อยใน ${esc(catName(id))}"><button id="addSub" title="เพิ่มหมวดย่อย" aria-label="เพิ่มหมวดย่อย">+</button></div>` : '';
      return list || add ? `<div class="subwrap">${list}${add}</div>` : '';
    };
    const mainRow = c => row(c.id, c.name, n(i => inTree(i, c.id)), (kids(c.id).length ? ' has-kids' : '') + (c.id === om ? ' open' : '')) + (mob.matches ? '' : subs(c.id));
    const mainRows = mains().map(mainRow).join('');
    const allRow = `<div class="catrow"><button class="cat${cond === '' && curCat === '' ? ' on' : ''}" data-cat="" data-all="1"><span class="nm">ทั้งหมด</span><span class="n">${items.length}</span></button></div>`;
    const condRow = `<div class="condsw" role="group" aria-label="สภาพสินค้า">${condHTML()}</div>`;
    const top = (mob.matches ? allRow : '') + mainRows +
      (cats.length && none ? row('none', 'อื่น ๆ', none) : '') +
      (seller ? '<div class="catadd"><input class="in" id="newCat" maxlength="60" placeholder="ชื่อหมวดหลักใหม่"><button id="addCat" title="เพิ่มหมวด" aria-label="เพิ่มหมวด">+</button></div>' : '');
    if (mob.matches) {
      // มือถือ: หมวดหลักแถวบน · หมวดย่อยของหมวดที่เลือกแยกเป็นอีกแถวด้านล่าง
      const keep = [...$('#side').querySelectorAll('.mrow')].map(r => r.scrollLeft);
      const sub = om ? subs(om).replace('class="subwrap"', 'class="mrow subrow"') : '';
      $('#side').innerHTML = `<div class="mrow">${top}</div>` + sub + condRow;
      $('#side').querySelectorAll('.mrow').forEach((r, i) => { if (keep[i]) r.scrollLeft = keep[i]; });
      const on = $('#side .mrow .cat.on') || $('#side .catrow.open .cat');
      if (on && !keep[0]) on.scrollIntoView({ block: 'nearest', inline: 'center' });
    } else $('#side').innerHTML = allRow + condRow + top;
    document.querySelectorAll('.mcond').forEach(el => { el.innerHTML = condHTML(); });
    $('#side').hidden = !cats.length && !seller;
    $('#catTitle').textContent = favView ? '♥ รายการโปรด' : curCat === '' ? (cond === 'used' ? 'อะไหล่มือสองทั้งหมด' : cond === 'new' ? 'อะไหล่ใหม่ทั้งหมด' : 'อะไหล่ทั้งหมด') : curCat === 'none' ? 'อื่น ๆ' : catLabel(curCat);
    $('#catBar').hidden = !(seller && curCat && curCat !== 'none');
  };
  const renderNew = () => {
    // กรองตามหมวดที่เลือก · หมวดที่ไม่มีของเข้าใหม่ ซ่อนแถวนี้ไปเลย
    const list = items.filter(i => i.is_new && inCat(i));
    // เลือกรุ่นย่อยอยู่: ซ่อนแถวเข้าใหม่ ให้เห็นอะไหล่ของรุ่นนั้นทันที
    const sub = curCat && curCat !== 'none' && parentOf(curCat);
    $('#newSec').hidden = !loaded || !!sub || favView || (!list.length && !(seller && curCat === ''));
    $('#newCount').textContent = list.length ? list.length + ' ชิ้น' : '';
    $('#newRow').innerHTML = list.length ? list.map(it => cardHTML(it)).join('')
      : '<div class="empty">ยังไม่มีอะไหล่เข้าใหม่ · กด "+ เข้าใหม่" ที่การ์ด หรือติ๊กในหน้าแก้ไข</div>';
  };
  const render = () => {
    renderSide(); renderNew();
    const q = $('#q').value.trim().toLowerCase();
    const list = items.filter(it => (favView ? favs.has(it.id) : inCat(it)) && match(it, q)).sort((a, b) => (a.sort || 0) - (b.sort || 0));
    const g = $('#grid');
    // ลากสลับได้เฉพาะแอดมิน ในหน้าหมวด และไม่ได้ค้นหาอยู่
    const grip = seller && curCat !== '' && !q;
    const k = curCat && curCat !== 'none' && !parentOf(curCat) ? kids(curCat) : [];
    g.classList.toggle('sectioned', !!(k.length && list.length && !q && !favView));
    // ยังโหลดสินค้าไม่เสร็จ: แสดงกำลังโหลด ไม่ใช่ "ยังไม่มีอะไหล่"
    if (!loaded) {
      g.innerHTML = '<div class="empty"><span class="spin"></span>กำลังโหลดอะไหล่…</div>';
    } else if (!items.length) {
      g.innerHTML = `<div class="empty"><b>ยังไม่มีอะไหล่ที่ลงขาย</b>${seller ? 'กดปุ่ม + เพื่อเพิ่มรูปอะไหล่และตั้งราคา' : 'แวะมาดูใหม่เร็ว ๆ นี้'}</div>`;
    } else if (!list.length) {
      g.innerHTML = favView ? '<div class="empty"><b>ยังไม่มีรายการโปรด</b>กด ♡ ถูกใจ ในหน้ารายละเอียดอะไหล่ เพื่อเก็บไว้ดูทีหลัง</div>' : `<div class="empty">${q ? 'ไม่พบอะไหล่ที่ค้นหา' : seller && curCat && curCat !== 'none' ? 'หมวดนี้ยังไม่มีอะไหล่ · กด "เลือกอะไหล่เข้าหมวดนี้"' : cond === 'used' ? 'ยังไม่มีอะไหล่มือสองในหมวดนี้' : 'หมวดนี้ยังไม่มีอะไหล่'}</div>`;
    } else {
      if (k.length && !q && !favView) {
        // หมวดหลักที่มีหมวดย่อย: แบ่งเป็นช่วง มีเส้นและชื่อหมวดย่อยคั่น
        const sec = (id, name, arr) => `<section class="subsec">
            <div class="subhead"><span>${esc(name)}</span><span class="n">${arr.length} ชิ้น</span></div>
            ${arr.length ? `<div class="grid" data-sec="${id}">${arr.map(it => cardHTML(it, grip)).join('')}</div>` : '<div class="empty" style="padding:18px">ยังไม่มีอะไหล่ในหมวดย่อยนี้</div>'}
          </section>`;
        g.innerHTML = k.map(c => [c, list.filter(it => inSub(it, c.id))]).filter(([, arr]) => arr.length || seller).map(([c, arr]) => sec(c.id, c.name, arr)).join('');
      } else g.innerHTML = list.map(it => cardHTML(it, grip)).join('');
    }
    $('#count').textContent = list.length + ' ชิ้น';
    $('#fcount').textContent = items.filter(i => !i.sold).length + ' รายการที่มีของ';
    if (typeof drawFavBadge === 'function') drawFavBadge();
  };
  // สินค้าที่มีตัวเลือก: ราคา = ตัวเลือกที่ถูกสุด (ที่ยังมีของ) · สต็อก = รวมทุกตัวเลือก
  // ค้นหาจากชื่อ หรือ SKU ของสินค้า/ตัวเลือก (ไม่สนช่องว่าง ขีด ตัวเล็กตัวใหญ่)
  const flat = v => String(v || '').toLowerCase().replace(/[\s\-_.\/]/g, '');
  const match = (it, q) => {
    if (!q) return true;
    const skus = [it.sku, ...it.options.map(o => o.sku)].map(flat);
    if (flat(q) && skus.some(k => k.includes(flat(q)))) return true;
    // ทุกคำที่พิมพ์ต้องเจอในชื่อ รุ่นรถ ตัวเลือก หรือ SKU (เช่น "monster 1200")
    const text = [it.name, it.model, ...it.options.map(o => o.name)].join(' ').toLowerCase();
    return q.split(/\s+/).filter(Boolean).every(w => text.includes(w) || skus.some(k => k.includes(flat(w))));
  };
  const normItem = i => {
    i.sku = i.sku || ''; i.model = i.model || '';
    i.is_new = !!i.is_new; i.photos = i.photos || []; i.price = Number(i.price) || 0; i.stock = Math.max(0, Number(i.stock ?? 1) || 0);
    i.options = (Array.isArray(i.options) ? i.options : []).map(o => ({ ...o, price: Number(o.price) || 0, stock: Math.max(0, Number(o.stock) || 0) }));
    if (i.options.length) {
      i.stock = i.options.reduce((s, o) => s + o.stock, 0);
      const ps = (i.options.some(o => o.stock > 0) ? i.options.filter(o => o.stock > 0) : i.options).map(o => o.price);
      i.price = Math.min(...ps); i.priceMax = Math.max(...ps);
    } else i.priceMax = i.price;
    // coming = รอสินค้าเข้า: แสดงราคาปกติ แต่ยังสั่งซื้อไม่ได้ (ป้าย "เร็วๆ นี้")
    i.soon = !!i.coming; i.used = !!i.used; i.extra_cats = Array.isArray(i.extra_cats) ? i.extra_cats : [];
    i.sold = i.stock <= 0 || i.soon;
  };
  const costOf = it => {
    const c = costs.get(it.id); if (!c) return null;
    const v = it.options.length ? it.options.map(o => Number((c.opt_costs || {})[o.id]) || 0).filter(n => n > 0) : [Number(c.cost) || 0].filter(n => n > 0);
    return v.length ? { min: Math.min(...v), max: Math.max(...v) } : null;
  };
  const costHTML = it => {
    if (!seller) return '';
    const k = costOf(it);
    return `<span class="cost" title="ต้นทุน (เห็นเฉพาะแอดมิน)">${k ? fmtNum(k.min) + (k.max > k.min ? '–' + fmtNum(k.max) : '') : '—'}</span>`;
  };
  const costLineHTML = it => {
    if (!seller) return '';
    const c = costs.get(it.id) || {}, row = (label, price, cost) => `<div>🔒 ${label}ทุน <b>${cost ? fmtNum(cost) : '—'}</b> · ขาย <b>${fmtNum(price)}</b>${cost ? ` · กำไร <b>${(price - cost).toLocaleString('en-US')}</b> บาท` : ' บาท'}</div>`;
    return '<div class="costline" title="เห็นเฉพาะแอดมิน">' + (it.options.length
      ? it.options.map(o => row(esc(o.name) + ': ', o.price, Number((c.opt_costs || {})[o.id]) || 0)).join('')
      : row('', it.price, Number(c.cost) || 0)) + '</div>';
  };
  const okUrl = u => typeof u === 'string' && /^https:\/\/[^\s]+$/i.test(u.trim());
  const priceHTML = it => (it.priceMax > it.price ? '<span class="from">เริ่ม</span>' : '') + fmtTHB(it.price);
  const reload = async () => {
    try { [items, cats, shopCfg] = await Promise.all([B.list(), B.listCats().catch(() => []), B.getSettings().catch(() => ({}))]); items.forEach(normItem); loaded = true; }
    catch (e) { $('#grid').innerHTML = `<div class="empty"><b>โหลดข้อมูลไม่ได้</b>${esc(e.message || e)}</div>`; return; }
    await loadCosts(); await resolveUrls(items); render(); backfillThumbs();
    openShared();
  };
  // เปิดจากลิงก์ที่แชร์ (?p=id): เด้งไปหน้ารายละเอียดของชิ้นนั้นครั้งเดียว แล้วล้าง ?p ออกจากแถบที่อยู่
  let sharedDone = false;
  const openShared = () => {
    if (sharedDone) return; sharedDone = true;
    let id = null; try { id = new URLSearchParams(location.search).get('p'); } catch {}
    if (!id) return;
    const it = items.find(i => i.id === id);
    try { history.replaceState(null, '', location.pathname + location.hash); } catch {}
    if (it) openDetail(it);
  };
  let qTimer = 0; $('#q').oninput = () => { clearTimeout(qTimer); qTimer = setTimeout(render, 120); };
  document.addEventListener('click', e => {
    const b = e.target.closest('[data-cond]'); if (!b) return;
    if (b.closest('#fCondSw')) return;
    // ตัวกรองอย่างเดียว: อยู่หมวด/รุ่นเดิม · กดปุ่มเดิมซ้ำ = เอาตัวกรองออก
    cond = b.dataset.cond === cond ? '' : b.dataset.cond;
    render();
  });
  const pick = e => {
    if (e.target.closest('[data-pgrip]')) return;
    const nb = e.target.closest('[data-new]');
    if (nb) { e.stopPropagation(); toggleNew(nb.dataset.new); return; }
    const o = e.target.closest('[data-opts]');
    if (o) { e.stopPropagation(); openOptPick(items.find(i => i.id === o.dataset.opts)); return; }
    const a = e.target.closest('[data-cart]');
    if (a) { e.stopPropagation(); if (inCart(a.dataset.cart)) openCart(); else addToCart(a.dataset.cart); return; }
    const c = e.target.closest('.card'); if (c) openDetail(items.find(i => i.id === c.dataset.id));
  };
  $('#grid').addEventListener('click', pick);
  $('#grid').addEventListener('keydown', e => { if (e.key === 'Enter') pick(e); });
  (() => { // กดค้างแล้วลากเลื่อนแถวอะไหล่เข้าใหม่ (เมาส์)
    const row = $('#newRow'); let sx = 0, sl = 0, down = false, moved = false;
    row.addEventListener('dragstart', e => e.preventDefault());
    row.addEventListener('pointerdown', e => {
      if (e.pointerType !== 'mouse' || e.button !== 0) return;
      down = true; moved = false; sx = e.clientX; sl = row.scrollLeft;
    });
    window.addEventListener('pointermove', e => {
      if (!down) return;
      const dx = e.clientX - sx;
      if (!moved && Math.abs(dx) > 5) { moved = true; row.classList.add('drag'); }
      if (moved) { row.scrollLeft = sl - dx; e.preventDefault(); }
    });
    window.addEventListener('pointerup', () => {
      if (!down) return; down = false;
      if (moved) { row.classList.remove('drag'); const h = ev => { ev.stopPropagation(); ev.preventDefault(); }; row.addEventListener('click', h, true); setTimeout(() => { row.removeEventListener('click', h, true); moved = false; }, 0); }
    });
  })();
  $('#newRow').addEventListener('click', pick);
  $('#newRow').addEventListener('keydown', e => { if (e.key === 'Enter') pick(e); });

  // ── หมวดหมู่ / อะไหล่เข้าใหม่ (แอดมิน) ──
  const toggleNew = async id => {
    const it = items.find(i => i.id === id); if (!it) return;
    try { await B.patchParts([id], { is_new: !it.is_new }); it.is_new = !it.is_new; render(); }
    catch (e) { alert('บันทึกไม่สำเร็จ: ' + (e.message || e)); }
  };
  const addCat = async () => {
    const f = $('#newCat'); const name = f.value.trim();
    if (!name) { f.focus(); return; }
    if (mains().some(c => c.name === name)) { alert('มีหมวดนี้แล้ว'); return; }
    const c = { id: uid(), name, sort: cats.reduce((m, x) => Math.max(m, x.sort || 0), 0) + 1, created_at: new Date().toISOString() };
    try { await B.saveCat(c); cats.push(c); curCat = c.id; render(); }
    catch (e) { alert('เพิ่มหมวดไม่สำเร็จ: ' + (e.message || e)); }
  };
  const addSub = async () => {
    const f = $('#newSub'), name = f.value.trim(), parent = openMain();
    if (!name) { f.focus(); return; }
    if (kids(parent).some(c => c.name === name)) { alert('มีหมวดย่อยนี้แล้ว'); return; }
    const c = { id: uid(), name, parent_id: parent, sort: kids(parent).reduce((m, x) => Math.max(m, x.sort || 0), 0) + 1, created_at: new Date().toISOString() };
    try { await B.saveCat(c); cats.push(c); curCat = c.id; render(); }
    catch (e) { alert('เพิ่มหมวดย่อยไม่สำเร็จ: ' + (e.message || e)); }
  };
  let lastCatClick = { id: '', t: 0 };
  const renameCat = id => {
    const cat = cats.find(x => x.id === id);
    const btn = $('#side').querySelector(`.cat[data-cat="${id}"]`);
    if (!cat || !btn) return;
    const inp = document.createElement('input');
    inp.className = 'in catren'; inp.maxLength = 60; inp.value = cat.name;
    btn.replaceWith(inp); inp.focus(); inp.select();
    let done = false;
    const finish = async save => {
      if (done) return; done = true;
      const name = inp.value.trim();
      if (!save || !name || name === cat.name) { render(); return; }
      const sib = cats.filter(x => x.id !== id && (x.parent_id || null) === (cat.parent_id || null));
      if (sib.some(x => x.name === name)) { alert('มีหมวดชื่อนี้แล้ว'); render(); return; }
      const old = cat.name; cat.name = name;
      try { await B.saveCat(cat); }
      catch (err) { cat.name = old; alert('เปลี่ยนชื่อหมวดไม่สำเร็จ: ' + (err.message || err)); }
      render();
    };
    inp.addEventListener('keydown', ev => { ev.stopPropagation(); if (ev.key === 'Enter') { ev.preventDefault(); finish(true); } if (ev.key === 'Escape') finish(false); });
    inp.addEventListener('click', ev => ev.stopPropagation());
    inp.addEventListener('pointerdown', ev => ev.stopPropagation());
    inp.addEventListener('blur', () => finish(true));
  };
  $('#side').addEventListener('click', async e => {
    const d = e.target.closest('[data-catdel]');
    if (d) {
      const id = d.dataset.catdel, k = kids(id);
      if (!confirm(`ลบหมวด "${catName(id)}"?${k.length ? `\nหมวดย่อย ${k.length} หมวดข้างในจะถูกลบด้วย` : ''}\nอะไหล่ในหมวดนี้จะไม่ถูกลบ แค่ย้ายไปอยู่ "อื่น ๆ"`)) return;
      try { for (const c of k) await B.removeCat(c.id); await B.removeCat(id); if (curCat === id || k.some(c => c.id === curCat)) curCat = ''; await reload(); }
      catch (err) { alert('ลบหมวดไม่สำเร็จ: ' + (err.message || err)); }
      return;
    }
    if (e.target.closest('#addCat')) { addCat(); return; }
    if (e.target.closest('#addSub')) { addSub(); return; }
    const c = e.target.closest('[data-cat]');
    if (c) {
      // แอดมิน: ดับเบิลคลิก (หรือแตะสองครั้ง) ที่ชื่อหมวด เพื่อแก้ชื่อ
      const id = c.dataset.cat, now = Date.now();
      if (seller && id && id !== 'none' && lastCatClick.id === id && now - lastCatClick.t < 450) { lastCatClick = { id: '', t: 0 }; renameCat(id); return; }
      lastCatClick = { id, t: now };
      if (c.dataset.all) cond = ''; curCat = id; render();
    }
  });
  $('#side').addEventListener('keydown', e => { if (e.key !== 'Enter') return; if (e.target.id === 'newCat') addCat(); if (e.target.id === 'newSub') addSub(); });
  // ลากที่ ⠿ เพื่อสลับลำดับหมวด (ใช้ได้ทั้งเมาส์และนิ้ว)
  let drag = null;
  $('#side').addEventListener('pointerdown', e => {
    const g = e.target.closest('[data-grip]'); if (!g) return;
    e.preventDefault();
    drag = { row: g.closest('.catrow') };
    drag.row.classList.add('dragging');
    try { g.setPointerCapture(e.pointerId); } catch {}
  });
  window.addEventListener('pointermove', e => {
    if (!drag) return;
    const el = document.elementFromPoint(e.clientX, e.clientY);
    if (drag.card) return dragCard(e);
    const over = el && el.closest('.catrow[data-cid]');
    // สลับได้เฉพาะในกลุ่มเดียวกัน (หมวดหลักด้วยกัน หรือหมวดย่อยในหมวดเดียวกัน)
    if (!over || over === drag.row || over.dataset.parent !== drag.row.dataset.parent) return;
    const r = over.getBoundingClientRect(), me = drag.row.getBoundingClientRect();
    const horiz = Math.abs(r.top - me.top) < 4;
    const before = horiz ? e.clientX < r.left + r.width / 2 : e.clientY < r.top + r.height / 2;
    over.parentNode.insertBefore(drag.row, before ? over : over.nextSibling);
  });
  const endDrag = async () => {
    if (!drag) return;
    if (drag.card) return endCardDrag();
    const parent = drag.row.dataset.parent;
    drag.row.classList.remove('dragging'); drag = null;
    const order = [...$('#side').querySelectorAll('.catrow[data-cid]')].filter(r => r.dataset.parent === parent).map(r => r.dataset.cid);
    const group = (parent ? kids(parent) : mains()).map(c => c.id);
    if (order.join() === group.join()) return;
    const changed = order.map((id, i) => ({ ...catOf(id), sort: i + 1 }));
    cats = cats.map(c => changed.find(x => x.id === c.id) || c).sort((a, b) => (a.sort || 0) - (b.sort || 0));
    render();
    try { await B.saveCats(changed); }
    catch (err) { alert('บันทึกลำดับไม่สำเร็จ: ' + (err.message || err)); reload(); }
  };
  // ลากที่ ⠿ บนรูปสินค้า เพื่อสลับตำแหน่งสินค้าในหมวด
  $('#grid').addEventListener('pointerdown', e => {
    const g = e.target.closest('[data-pgrip]'); if (!g) return;
    e.preventDefault(); e.stopPropagation();
    drag = { card: g.closest('.card') };
    drag.card.classList.add('dragging');
    try { g.setPointerCapture(e.pointerId); } catch {}
  });
  const dragCard = e => {
    // ลากใกล้ขอบจอบน/ล่าง ให้เลื่อนหน้าตาม
    if (e.clientY < 70) window.scrollBy(0, -14); else if (e.clientY > innerHeight - 70) window.scrollBy(0, 14);
    const el = document.elementFromPoint(e.clientX, e.clientY);
    const over = el && el.closest('.card');
    if (!over || over === drag.card || over.parentNode !== drag.card.parentNode) return;
    const r = over.getBoundingClientRect();
    const before = e.clientY < r.top ? true : e.clientY > r.bottom ? false : e.clientX < r.left + r.width / 2;
    over.parentNode.insertBefore(drag.card, before ? over : over.nextSibling);
  };
  const endCardDrag = async () => {
    const box = drag.card.parentNode;
    drag.card.classList.remove('dragging'); drag = null;
    const ids = [...box.querySelectorAll(':scope > .card')].map(c => c.dataset.id);
    const changed = ids.map((id, i) => ({ id, sort: i + 1 })).filter(x => (items.find(i => i.id === x.id) || {}).sort !== x.sort);
    if (!changed.length) return;
    changed.forEach(x => { const it = items.find(i => i.id === x.id); if (it) it.sort = x.sort; });
    render();
    try { await B.setSorts(changed); }
    catch (err) { alert('บันทึกตำแหน่งไม่สำเร็จ: ' + (err.message || err)); reload(); }
  };
  window.addEventListener('pointerup', endDrag);
  window.addEventListener('pointercancel', endDrag);

  let picked = new Set();
  const drawPick = () => {
    const q = $('#pq').value.trim().toLowerCase();
    $('#pickList').innerHTML = items.filter(i => condOk(i) && match(i, q)).map(i => `
      <label class="pickrow">
        <input type="checkbox" data-pick="${i.id}" ${picked.has(i.id) ? 'checked' : ''}>
        ${i.photos.length ? tImg(i.photos[0], '', '44px') : '<div class="noimg"></div>'}
        <div class="info"><div class="nm">${esc(i.name)}</div>${i.model ? `<div class="mdl">🏍 ${esc(i.model)}</div>` : ''}<div class="sub">${catsOf(i).length ? 'หมวด: ' + catsOf(i).map(c => esc(catName(c))).join(', ') : 'ยังไม่มีหมวด'}</div></div>
      </label>`).join('') || '<div class="empty" style="padding:24px">ไม่พบอะไหล่</div>';
  };
  $('#pickBtn').onclick = () => {
    picked = new Set(items.filter(i => inC(i, curCat)).map(i => i.id));
    $('#pTitle').textContent = 'เลือกอะไหล่เข้าหมวด "' + catName(curCat) + '"';
    $('#pq').value = ''; $('#pMsg').textContent = '';
    drawPick(); show('picker');
  };
  $('#pq').oninput = drawPick;
  $('#pickList').addEventListener('change', e => {
    const c = e.target.closest('[data-pick]'); if (!c) return;
    c.checked ? picked.add(c.dataset.pick) : picked.delete(c.dataset.pick);
  });
  $('#pSave').onclick = async () => {
    const add = items.filter(i => picked.has(i.id) && !inC(i, curCat));
    const drop = items.filter(i => inC(i, curCat) && !picked.has(i.id));
    const b = $('#pSave'); b.disabled = true;
    // เพิ่ม: ยังไม่มีหมวด → เป็นหมวดหลัก · มีแล้ว → เพิ่มเป็นหมวดเสริม / เอาออก: ลบเฉพาะหมวดนี้ หมวดอื่นยังอยู่
    const patchOf = (it, list) => { const p = { category_id: list[0] || null }; if (list.length > 1 || it.extra_cats.length) p.extra_cats = list.slice(1); return p; };
    try {
      for (const it of add) await B.patchParts([it.id], patchOf(it, [...catsOf(it), curCat]));
      for (const it of drop) await B.patchParts([it.id], patchOf(it, catsOf(it).filter(c => c !== curCat)));
      hide('picker'); await reload();
    }
    catch (e) { $('#pMsg').textContent = 'บันทึกไม่สำเร็จ: ' + (e.message || e); }
    b.disabled = false;
  };

  // ── overlays ──
  const show = id => $('#' + id).classList.add('open');
  const hide = id => $('#' + id).classList.remove('open');
  // เปิดหน้าต่างอยู่ = ล็อกหน้าด้านหลังไม่ให้เลื่อน (วิธีนี้ใช้ได้กับ iPhone Safari ด้วย)
  let lockY = null;
  const syncLock = () => {
    const open = !!document.querySelector('.overlay.open, .lb.open'), b = document.body.style;
    if (open && lockY === null) {
      lockY = window.scrollY;
      Object.assign(b, { position: 'fixed', top: -lockY + 'px', left: '0', right: '0', width: '100%', overflow: 'hidden' });
    } else if (!open && lockY !== null) {
      Object.assign(b, { position: '', top: '', left: '', right: '', width: '', overflow: '' });
      window.scrollTo(0, lockY); lockY = null;
    }
  };
  new MutationObserver(syncLock).observe(document.body, { subtree: true, attributes: true, attributeFilter: ['class'] });
  document.querySelectorAll('.overlay').forEach(o => {
    o.addEventListener('click', e => { if (e.target === o || e.target.closest('[data-close]')) hide(o.id); });
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') document.querySelectorAll('.overlay.open').forEach(o => hide(o.id));
    if ($('#detail').classList.contains('open') && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) step(e.key === 'ArrowLeft' ? -1 : 1);
  });

  // ── detail ──
  let cur = null, ci = 0;
  const drawViewer = () => {
    const ph = cur.photos;
    $('#viewer').innerHTML = ph.length
      ? `<img src="${url(ph[ci])}" alt="${esc(cur.name)}">` + (ph.length > 1 ? `<button class="nav prev" aria-label="ก่อนหน้า"><svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg></button><button class="nav next" aria-label="ถัดไป"><svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M9 5l7 7-7 7" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg></button><div class="idx">${ci + 1}/${ph.length}</div>` : '')
      : '<div class="thumb" style="height:100%"><div class="none">NO PHOTO</div></div>';
    $('#strip').innerHTML = ph.length > 1 ? ph.map((p, i) => `<button data-i="${i}" class="${i === ci ? 'cur' : ''}">${tImg(p, '', '60px')}</button>`).join('') : '';
  };
  const step = d => { if (!cur || cur.photos.length < 2) return; ci = (ci + d + cur.photos.length) % cur.photos.length; drawViewer(); };
  $('#viewer').addEventListener('click', e => { if (e.target.closest('.prev')) step(-1); else if (e.target.closest('.next')) step(1); else if (e.target.tagName === 'IMG') openLB(ci); });

  // ── ดูรูปเต็มจอ: ซูมสองนิ้ว / แตะสองครั้ง / ลูกกลิ้งเมาส์ · ปัดซ้ายขวาเปลี่ยนรูป ──
  const lb = document.createElement('div');
  lb.className = 'lb';
  lb.innerHTML = '<div class="lbtrack"></div><div class="lbidx"></div><button class="lbx" aria-label="ปิด">✕</button><button class="nav prev" aria-label="ก่อนหน้า"><svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg></button><button class="nav next" aria-label="ถัดไป"><svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M9 5l7 7-7 7" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg></button>';
  document.body.appendChild(lb);
  const track = lb.querySelector('.lbtrack'), pts = new Map();
  // รูปซ้ำหัวท้าย (สุดท้าย | 1..n | แรก) เพื่อปัดวนได้ไม่สะดุด
  let li = 0, sc = 1, zx = 0, zy = 0, dx = 0, g = null, lastTap = 0, wrapT = 0;
  const offLB = () => (nLB() > 1 ? 1 : 0);
  const nLB = () => (cur ? cur.photos.length : 0);
  const curImg = () => track.children[li + offLB()] && track.children[li + offLB()].firstElementChild;
  const clampZ = () => {
    if (sc <= 1) { sc = 1; zx = zy = 0; return; }
    const im = curImg(); if (!im) return;
    const W = lb.clientWidth, H = lb.clientHeight, w = im.offsetWidth * sc, h = im.offsetHeight * sc;
    const mx = Math.max(0, (w - W) / 2), my = Math.max(0, (h - H) / 2);
    zx = Math.max(-mx, Math.min(mx, zx)); zy = Math.max(-my, Math.min(my, zy));
  };
  const applyZ = anim => { const im = curImg(); if (!im) return; im.style.transition = anim ? 'transform .25s ease' : 'none'; im.style.transform = `translate(${zx}px,${zy}px) scale(${sc})`; };
  const applyT = (anim, pos = li + offLB()) => { track.style.transition = anim ? 'transform .3s ease' : 'none'; track.style.transform = `translateX(calc(${-pos * 100}% + ${dx}px))`; };
  const resetZ = () => { sc = 1; zx = zy = 0; [...track.children].forEach(s => { s.firstElementChild.style.transform = ''; }); };
  const drawLB = () => { lb.querySelector('.lbidx').textContent = nLB() > 1 ? (li + 1) + ' / ' + nLB() : ''; lb.querySelector('.prev').hidden = lb.querySelector('.next').hidden = nLB() < 2; };
  const goLB = i => {
    const n = nLB(); resetZ(); dx = 0;
    if (n < 2) { applyT(true); return; }
    clearTimeout(wrapT);
    li = ((i % n) + n) % n;
    applyT(true, i + 1);
    drawLB();
    // เลื่อนไปถึงรูปซ้ำหัว/ท้ายแล้ว กระโดดกลับรูปจริงแบบไม่มีแอนิเมชัน
    if (i < 0 || i >= n) wrapT = setTimeout(() => applyT(false), 320);
  };
  const openLB = i => {
    if (!nLB()) return;
    const ph = cur.photos, slide = p => `<div class="lbs"><img src="${url(p)}" alt="" draggable="false"></div>`;
    track.innerHTML = (ph.length > 1 ? slide(ph[ph.length - 1]) : '') + ph.map(slide).join('') + (ph.length > 1 ? slide(ph[0]) : '');
    li = i; dx = 0; resetZ(); applyT(false); drawLB(); pts.clear(); g = null;
    lb.classList.add('open');
  };
  const closeLB = () => { lb.classList.remove('open'); track.innerHTML = ''; if (cur) { ci = li; drawViewer(); } };
  // ซูมรอบจุด (px, py) บนจอ
  const zoomAt = (ns, px, py, base) => {
    const r = lb.getBoundingClientRect(), cx = px - r.left - r.width / 2, cy = py - r.top - r.height / 2;
    ns = Math.max(1, Math.min(5, ns));
    zx = cx - (cx - base.zx) * ns / base.sc; zy = cy - (cy - base.zy) * ns / base.sc; sc = ns;
  };
  lb.querySelector('.lbx').onclick = closeLB;
  lb.querySelector('.prev').onclick = () => goLB(li - 1);
  lb.querySelector('.next').onclick = () => goLB(li + 1);
  lb.addEventListener('pointerdown', e => {
    if (e.target.closest('button')) return;
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.size === 2) {
      const [a, b] = [...pts.values()];
      g = { mode: 'pinch', d: Math.hypot(a.x - b.x, a.y - b.y) || 1, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2, sc, zx, zy };
      if (dx) { dx = 0; applyT(true); }
    } else if (pts.size === 1) g = { mode: sc > 1 ? 'pan' : 'swipe', x: e.clientX, y: e.clientY, zx, zy, moved: false };
  });
  lb.addEventListener('pointermove', e => {
    if (!pts.has(e.pointerId) || !g) return;
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (g.mode === 'pinch' && pts.size >= 2) {
      const [a, b] = [...pts.values()], mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      zoomAt(g.sc * Math.hypot(a.x - b.x, a.y - b.y) / g.d, g.mx, g.my, g);
      zx += mx - g.mx; zy += my - g.my; clampZ(); applyZ(false);
    } else if (g.mode === 'pan') {
      zx = g.zx + e.clientX - g.x; zy = g.zy + e.clientY - g.y;
      if (Math.abs(e.clientX - g.x) + Math.abs(e.clientY - g.y) > 8) g.moved = true;
      clampZ(); applyZ(false);
    } else if (g.mode === 'swipe') {
      dx = e.clientX - g.x;
      if (Math.abs(dx) + Math.abs(e.clientY - g.y) > 8) g.moved = true;
      if (nLB() < 2) dx /= 3;
      applyT(false);
    }
  });
  const lbUp = e => {
    if (!pts.has(e.pointerId)) return;
    pts.delete(e.pointerId);
    if (!g) return;
    if (g.mode === 'pinch') {
      if (sc < 1.05) { sc = 1; zx = zy = 0; applyZ(true); }
      const p = [...pts.values()][0];
      g = p ? { mode: sc > 1 ? 'pan' : 'swipe', x: p.x, y: p.y, zx, zy, moved: true } : null;
      return;
    }
    if (g.mode === 'swipe' && g.moved) {
      const lim = Math.min(80, lb.clientWidth * 0.18);
      if (dx < -lim && nLB() > 1) goLB(li + 1); else if (dx > lim && nLB() > 1) goLB(li - 1); else { dx = 0; applyT(true); }
    }
    if (!g.moved && e.type === 'pointerup') {
      const now = Date.now();
      if (now - lastTap < 320) {
        if (sc > 1) { sc = 1; zx = zy = 0; } else { zoomAt(2.5, e.clientX, e.clientY, { sc: 1, zx: 0, zy: 0 }); clampZ(); }
        applyZ(true); lastTap = 0;
      } else lastTap = now;
    }
    g = null;
  };
  lb.addEventListener('pointerup', lbUp);
  lb.addEventListener('pointercancel', lbUp);
  lb.addEventListener('wheel', e => {
    e.preventDefault();
    zoomAt(sc * (e.deltaY < 0 ? 1.15 : 1 / 1.15), e.clientX, e.clientY, { sc, zx, zy }); clampZ(); applyZ(false);
  }, { passive: false });
  window.addEventListener('keydown', e => {
    if (!lb.classList.contains('open')) return;
    if (e.key === 'Escape') closeLB(); else if (e.key === 'ArrowLeft') goLB(li - 1); else if (e.key === 'ArrowRight') goLB(li + 1); else return;
    e.stopImmediatePropagation(); e.preventDefault();
  }, true);
  window.addEventListener('resize', () => { if (lb.classList.contains('open')) { applyT(false); clampZ(); applyZ(false); } });
  $('#strip').addEventListener('click', e => { const b = e.target.closest('[data-i]'); if (b) { ci = +b.dataset.i; drawViewer(); } });
  let tx0 = null;
  $('#viewer').addEventListener('touchstart', e => { tx0 = e.touches[0].clientX; }, { passive: true });
  $('#viewer').addEventListener('touchend', e => { if (tx0 === null) return; const dx = e.changedTouches[0].clientX - tx0; if (Math.abs(dx) > 40) step(dx > 0 ? -1 : 1); tx0 = null; });
  const openDetail = it => {
    cur = it; ci = 0; drawViewer();
    $('#dName').textContent = it.name;
    // สำหรับรุ่น: หมวดหลัก › หมวดย่อย ของทุกหมวดที่สินค้าอยู่
    const fit = catsOf(it).map(c => parentOf(c) ? `<li>${esc(catName(parentOf(c)))} <b>${esc(catName(c))}</b></li>` : `<li><b>${esc(catName(c))}</b></li>`);
    $('#dFit').hidden = !fit.length;
    $('#dFit').innerHTML = fit.length ? `<h4>สำหรับรุ่น</h4><ul>${fit.join('')}</ul>` : '';
    $('#dModel').textContent = it.model ? 'รุ่นรถ: ' + it.model : '';
    $('#dSku').textContent = [it.used ? 'สภาพ: มือสอง' : '', it.sku ? 'P/N: ' + it.sku : ''].filter(Boolean).join(' · ');
    $('#dPrice').innerHTML = it.soon ? priceHTML(it) + '<div class="hint" style="font-size:13px">⏳ รอสินค้าเข้า เร็วๆ นี้ · สอบถามได้</div>' : it.sold ? `<span style="color:var(--faint);text-decoration:line-through">${fmtTHB(it.price)}</span> <span style="font-size:16px;color:var(--down)">สินค้าหมด</span>` : priceHTML(it);
    $('#dOpts').hidden = !it.options.length;
    $('#dOpts').innerHTML = it.options.map(o => `<button data-dopt="${esc(o.id)}" ${o.stock > 0 ? '' : 'disabled'}>${o.photo ? tImg(o.photo, '', '30px') : '<span class="noimg"></span>'}${esc(o.name)}${o.stock > 0 ? '' : ' (หมด)'}</button>`).join('');
    $('#dContact').innerHTML = it.sold && !it.soon ? '' : contactHTML(it.name);
    // ปุ่มดูราคาที่ Shopee / Lazada (แอดมินใส่ลิงก์ไว้ต่อสินค้า)
    const shops = [[it.shopee_url, 'shopee', 'ดูราคา Shopee'], [it.lazada_url, 'lazada', 'ดูราคา Lazada']]
      .filter(([u]) => okUrl(u)).map(([u, c, t]) => `<a class="${c}" href="${esc(u)}" target="_blank" rel="noopener nofollow" aria-label="${t}" title="${t}"></a>`);
    $('#dShops').hidden = !shops.length; $('#dShops').innerHTML = shops.join('');
    if (!it.sold) $('#dPrice').insertAdjacentHTML('beforeend', `<div class="hint" style="font-size:13px">เหลือ ${it.stock} ชิ้น</div>`);
    $('#dPrice').insertAdjacentHTML('beforeend', costLineHTML(it));
    drawDetailCart(); drawFav();
    $('#dSeller').hidden = !seller;
    show('detail');
  };
  // แชร์ลิงก์: เปิดลิงก์แล้วเด้งมาที่หน้ารายละเอียดของชิ้นนี้ (?p=id)
  const partLink = it => location.origin + location.pathname + '?p=' + encodeURIComponent(it.id);
  const copyText = async t => {
    try { await navigator.clipboard.writeText(t); return true; } catch {}
    const ta = document.createElement('textarea'); ta.value = t; ta.setAttribute('readonly', ''); ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0';
    document.body.appendChild(ta); ta.select(); let ok = false; try { ok = document.execCommand('copy'); } catch {} ta.remove(); return ok;
  };
  $('#dShare').onclick = async () => {
    if (!cur) return; const url = partLink(cur), btn = $('#dShare'), lab = btn.querySelector('span');
    if (navigator.share && matchMedia('(hover:none)').matches) {
      try { await navigator.share({ title: cur.name + ' | P2P Moto', text: cur.name + (cur.model ? ' (' + cur.model + ')' : ''), url }); return; }
      catch (e) { if (e && e.name === 'AbortError') return; }
    }
    const ok = await copyText(url);
    lab.textContent = ok ? 'คัดลอกลิงก์แล้ว' : url; btn.classList.toggle('ok', ok);
    clearTimeout(btn._t); btn._t = setTimeout(() => { lab.textContent = 'แชร์ลิงก์'; btn.classList.remove('ok'); }, 2200);
  };
  $('#dEdit').onclick = () => { hide('detail'); openEditor(cur); };
  $('#dCopy').onclick = () => { hide('detail'); openEditor(cur, true); };
  const drawDetailCart = () => {
    const b = $('#dCart');
    b.hidden = !!cur.sold;
    b.textContent = cur.options.length ? '🛒 เลือกตัวเลือก แล้วใส่ตะกร้า' : inCart(cur.id) ? '✓ อยู่ในตะกร้าแล้ว · ดูตะกร้า' : '🛒 ใส่ตะกร้า';
  };
  $('#dCart').onclick = () => {
    if (cur.options.length) openOptPick(cur);
    else if (inCart(cur.id)) { hide('detail'); openCart(); }
    else { addToCart(cur.id); drawDetailCart(); }
  };
  $('#dOpts').addEventListener('click', e => { const b = e.target.closest('[data-dopt]'); if (b) openOptPick(cur, b.dataset.dopt); });

  // ── cart (เก็บในเบราว์เซอร์ของลูกค้า) ──
  let cart = [];
  try { cart = JSON.parse(localStorage.getItem('p2p_cart') || '[]'); } catch {}
  const saveCart = () => { try { localStorage.setItem('p2p_cart', JSON.stringify(cart)); } catch {} drawBadge(); };
  const ckey = (id, opt) => id + '|' + (opt || '');
  const inCart = (id, opt) => cart.some(c => ckey(c.id, c.opt) === ckey(id, opt));
  const drawBadge = () => {
    const n = cart.reduce((s, c) => s + c.qty, 0);
    $('#cartBadge').textContent = n; $('#cartBadge').hidden = !n;
  };
  const cartBtnHTML = it => it.sold
    ? `<button class="addcart" disabled>${it.soon ? 'เร็วๆ นี้' : 'สินค้าหมด'}</button>`
    : it.options.length ? (cart.some(c => c.id === it.id)
      ? `<button class="addcart in" data-opts="${it.id}">✓ ในตะกร้า · เพิ่ม</button>`
      : `<button class="addcart" data-opts="${it.id}">🛒 เลือกตัวเลือก</button>`)
    : inCart(it.id) ? `<button class="addcart in" data-cart="${it.id}">✓ อยู่ในตะกร้า</button>`
    : `<button class="addcart" data-cart="${it.id}">🛒 ใส่ตะกร้า</button>`;
  const addToCart = (id, opt) => { if (!inCart(id, opt)) cart.push(opt ? { id, opt, qty: 1 } : { id, qty: 1 }); saveCart(); render(); };
  // แถวในตะกร้า เทียบกับข้อมูลล่าสุด (ราคา/สต็อก/ตัวเลือก)
  const cartLines = () => cart.map(c => {
    const it = items.find(i => i.id === c.id);
    const o = it && c.opt ? it.options.find(x => x.id === c.opt) : null;
    const bad = !it || (c.opt ? !o : it.options.length > 0);
    const stock = bad ? 0 : o ? o.stock : it.stock;
    return { ...c, key: ckey(c.id, c.opt), it, o, bad, stock, sold: !bad && (stock <= 0 || !!(it && it.soon)),
      name: it ? it.name + (o ? ` (${o.name})` : '') : 'สินค้านี้ถูกลบแล้ว',
      price: o ? o.price : it ? it.price : 0,
      photo: (o && o.photo) || (it && it.photos[0]) || '' };
  });
  const buyable = () => cartLines().filter(l => !l.bad && !l.sold).map(l => ({ ...l, qty: Math.min(l.qty, l.stock) }));
  const cartTotal = () => buyable().reduce((s, l) => s + l.price * l.qty, 0);

  // ── เลือกตัวเลือกก่อนใส่ตะกร้า ──
  let pk = null, pkSel = null;
  const openOptPick = (it, sel) => {
    if (!it) return;
    pk = it;
    pkSel = sel || (it.options.find(o => o.stock > 0) || {}).id || null;
    drawOptPick(); show('optPick');
  };
  // ราคาทุนของตัวเลือก (เห็นเฉพาะแอดมิน)
  const optCostHTML = o => {
    if (!seller) return '';
    const v = Number(((costs.get(pk.id) || {}).opt_costs || {})[o.id]) || 0;
    return `<span class="costtag" title="ต้นทุน (เห็นเฉพาะแอดมิน)">ทุน ${v ? fmtNum(v) : '—'}</span>`;
  };
  const drawOptPick = () => {
    $('#opTitle').textContent = pk.name;
    $('#opList').innerHTML = pk.options.map(o => `
      <button class="optcard${o.id === pkSel ? ' on' : ''}" data-op="${esc(o.id)}" ${o.stock > 0 ? '' : 'disabled'}>
        <div class="im">${o.photo ? tImg(o.photo, '', '150px') : 'ไม่มีรูป'}</div>
        <div class="tx"><div class="nm" title="${esc(o.name)}">${esc(o.name)}</div><div class="pr">${fmtTHB(o.price)}${optCostHTML(o)}</div>
        <div class="st">${o.stock > 0 ? 'เหลือ ' + o.stock + ' ชิ้น' : 'หมด'}${inCart(pk.id, o.id) ? ' · ✓ ในตะกร้า' : ''}</div>${o.sku ? `<div class="st">P/N: ${esc(o.sku)}</div>` : ''}</div>
        <span class="tick">✓</span>
      </button>`).join('');
    const b = $('#opAdd'), o = pk.options.find(x => x.id === pkSel);
    b.disabled = !o;
    b.innerHTML = !o ? 'เลือกตัวเลือกก่อน' : inCart(pk.id, o.id) ? '✓ อยู่ในตะกร้าแล้ว · ดูตะกร้า' : '🛒 ใส่ตะกร้า · ' + fmtTHB(o.price);
  };
  $('#opList').addEventListener('click', e => { const b = e.target.closest('[data-op]'); if (b && !b.disabled) { pkSel = b.dataset.op; drawOptPick(); } });
  $('#opAdd').onclick = () => {
    if (!pk || !pkSel) return;
    if (inCart(pk.id, pkSel)) { hide('optPick'); hide('detail'); openCart(); return; }
    addToCart(pk.id, pkSel); drawOptPick();
    if ($('#detail').classList.contains('open')) drawDetailCart();
  };

  let cstep = 'cart', lastOrder = null, formOpenedAt = 0, maxKey = '';
  // สรุปยอด: ราคาสินค้า + ค่าจัดส่ง = ยอดรวม
  const sumHTML = n => `<div class="sumrow" style="margin-top:12px"><span>ราคาสินค้า (${n} ชิ้น)</span><span>${fmtTHB(cartTotal())}</span></div>
      <div class="sumrow"><span>ค่าจัดส่ง</span><span>${fmtTHB(SHIP)}</span></div>
      <div class="total"><span>ยอดรวม</span><b>${fmtTHB(cartTotal() + SHIP)}</b></div>`;
  const openCart = () => { cstep = 'cart'; maxKey = ''; drawCart(); show('cart'); };
  $('#cartBtn').onclick = openCart;
  const drawCart = () => {
    const body = $('#cartBody');
    if (cstep === 'done') {
      $('#cTitle').textContent = 'สั่งซื้อสำเร็จ';
      body.innerHTML = `<div class="done">
        <div class="big">✅</div>
        <div class="no">ออเดอร์ #${esc(lastOrder.no)}</div>
        <p>ยอดรวม <b style="color:var(--up)">${fmtTHB(lastOrder.total)}</b></p>
        ${C.PROMPTPAY ? `<p>โอนผ่าน PromptPay: <b style="color:var(--text)">${esc(C.PROMPTPAY)}</b></p>` : ''}
        <p>ร้านจะติดต่อกลับที่เบอร์ ${esc(lastOrder.phone)} เพื่อยืนยันออเดอร์</p>
        <div class="contact">${contactHTML()}</div>
        <div class="actions" style="margin-top:16px"><button class="btn primary" data-close>กลับไปดูสินค้า</button></div>
      </div>`;
      return;
    }
    const lines = cartLines();
    if (!lines.length) {
      $('#cTitle').textContent = 'ตะกร้าสินค้า';
      body.innerHTML = '<div class="empty" style="padding:36px 16px">ยังไม่มีสินค้าในตะกร้า</div>';
      return;
    }
    if (cstep === 'cart') {
      $('#cTitle').textContent = 'ตะกร้าสินค้า';
      body.innerHTML = lines.map(l => {
        const img = l.photo ? tImg(l.photo, '', '56px') : '<div class="noimg"></div>';
        return `<div class="line-item">
          ${img}
          <div class="info">
            <div class="nm">${esc(l.it ? l.it.name : l.name)}</div>
            ${l.o ? `<div class="op">ตัวเลือก: ${esc(l.o.name)}</div>` : ''}
            ${!l.it ? '<div class="warn">ไม่มีสินค้านี้แล้ว</div>' : l.bad ? '<div class="warn">ตัวเลือกนี้ไม่มีแล้ว · กรุณาลบแล้วเลือกใหม่</div>' : l.sold ? `<div class="warn">${l.it && l.it.soon ? 'สินค้ายังไม่เข้า' : 'สินค้าหมด'} · จะไม่ถูกสั่งซื้อ</div>` : `<div class="pr">${fmtTHB(l.price)}</div>`}
            ${l.key === maxKey ? `<div class="warn">มีของแค่ ${l.stock} ชิ้น</div>` : ''}
          </div>
          ${!l.bad && !l.sold ? `<div class="qty"><button data-q="-1" data-key="${esc(l.key)}" aria-label="ลด">−</button><span>${Math.min(l.qty, l.stock)}</span><button data-q="1" data-key="${esc(l.key)}" aria-label="เพิ่ม">+</button></div>` : ''}
          <button class="x" data-del="${esc(l.key)}" title="เอาออก" aria-label="เอาออก">✕</button>
        </div>`;
      }).join('') +
      sumHTML(buyable().reduce((s, l) => s + l.qty, 0)) + '<div style="height:14px"></div>' +
      `
       <div class="actions"><button class="btn" data-close>เลือกสินค้าต่อ</button><button class="btn primary" id="toCheckout" ${buyable().length ? '' : 'disabled'}>สั่งซื้อ</button></div>`;
      return;
    }
    // checkout
    $('#cTitle').textContent = 'ข้อมูลสำหรับจัดส่ง';
    body.innerHTML = `<div class="fields">
      <div><div class="label"><span>ชื่อผู้รับ</span></div><input class="in" id="oName" autocomplete="name"></div>
      <div><div class="label"><span>เบอร์โทร</span></div><input class="in" id="oPhone" type="tel" inputmode="tel" autocomplete="tel" placeholder="08x-xxx-xxxx"></div>
      <div><div class="label"><span>ที่อยู่จัดส่ง</span><span class="n">ไม่บังคับ</span></div><textarea class="in" id="oAddr" autocomplete="street-address" placeholder="บ้านเลขที่ ถนน ตำบล อำเภอ จังหวัด รหัสไปรษณีย์"></textarea></div>
      <div><div class="label"><span>หมายเหตุ (ถ้ามี)</span></div><input class="in" id="oNote" placeholder="เช่น รุ่นรถ ปีรถ หรือเวลาที่สะดวก"></div>
      <div class="sr" aria-hidden="true"><input id="oWeb" tabindex="-1" autocomplete="off"></div>
      ${sumHTML(buyable().reduce((s, l) => s + l.qty, 0))}
      <div class="msg" id="oMsg"></div>
      <div class="actions"><button class="btn" id="backCart">ย้อนกลับ</button><button class="btn primary" id="placeOrder">ยืนยันสั่งซื้อ</button></div>
    </div>`;
    formOpenedAt = Date.now();
    if (me) { $('#oName').value = me.name || ''; $('#oPhone').value = me.phone || ''; $('#oAddr').value = me.address || ''; }
    else $('#oMsg').innerHTML = '<span class="hint">มีบัญชีอยู่แล้ว? <button class="linkbtn" type="button" data-nav="account">เข้าสู่ระบบ</button> เพื่อกรอกที่อยู่อัตโนมัติและดูสถานะออเดอร์</span>';
    setTimeout(() => (me && me.name ? $('#oNote') : $('#oName')).focus(), 50);
  };
  $('#cartBody').addEventListener('click', async e => {
    const q = e.target.closest('[data-q]');
    if (q) {
      const k = q.dataset.key, l = cartLines().find(x => x.key === k), c = cart.find(x => ckey(x.id, x.opt) === k);
      if (!c || !l) return;
      const n = Math.min(c.qty, l.stock) + +q.dataset.q;
      maxKey = '';
      // กด − ตอนเหลือ 1 ชิ้น = เอาออกจากตะกร้า · กด + เกินสต็อก = แจ้งว่ามีของเท่าไร
      if (n < 1) { cart = cart.filter(x => x !== c); render(); }
      else if (n > l.stock) { c.qty = l.stock; maxKey = k; }
      else c.qty = n;
      saveCart(); drawCart(); return;
    }
    const d = e.target.closest('[data-del]');
    if (d) { cart = cart.filter(x => ckey(x.id, x.opt) !== d.dataset.del); saveCart(); render(); drawCart(); return; }
    if (e.target.id === 'toCheckout') { cstep = 'checkout'; drawCart(); return; }
    if (e.target.id === 'backCart') { cstep = 'cart'; drawCart(); return; }
    if (e.target.id === 'placeOrder') placeOrder(e.target);
  });
  const placeOrder = async btn => {
    const name = $('#oName').value.trim(), phone = $('#oPhone').value.trim(), address = $('#oAddr').value.trim(), note = $('#oNote').value.trim();
    const m = $('#oMsg');
    if (!name) { m.textContent = 'กรุณาใส่ชื่อผู้รับ'; return; }
    if (!/^0\d{8,9}$/.test(phone.replace(/\D/g, ''))) { m.textContent = 'กรุณาใส่เบอร์โทรให้ถูกต้อง เช่น 0812345678'; return; }
    // กันบอท: ช่องซ่อนถูกกรอก หรือกรอกฟอร์มเร็วผิดปกติ → ทำเหมือนสำเร็จแต่ไม่ส่ง
    if ($('#oWeb').value || Date.now() - formOpenedAt < 3000) { lastOrder = { no: uid().slice(0, 8).toUpperCase(), total: cartTotal() + SHIP, phone }; cstep = 'done'; drawCart(); return; }
    await reload(); // เช็คราคา/สถานะล่าสุดก่อนส่ง
    const lines = buyable();
    if (!lines.length) { cstep = 'cart'; drawCart(); return; }
    const order = {
      id: uid(), customer_name: name, phone, address, note, status: 'new',
      items: lines.map(l => ({ id: l.id, ...(l.opt ? { opt: l.opt } : {}), name: l.name, price: l.price, qty: l.qty })),
      shipping: SHIP,
      total: lines.reduce((s, l) => s + l.price * l.qty, 0) + SHIP,
      created_at: new Date().toISOString()
    };
    btn.disabled = true; btn.innerHTML = '<span class="spin"></span>กำลังส่งออเดอร์';
    try {
      await B.placeOrder(order);
      lastOrder = { no: order.id.slice(0, 8).toUpperCase(), total: order.total, phone };
      if (me && (!me.address && address || !me.phone || !me.name)) { const p = { name: me.name || name, phone: me.phone || phone, address: me.address || address }; Object.assign(me, p); B.acc.saveProfile(p).catch(() => {}); }
      cart = cart.filter(c => !lines.some(l => l.key === ckey(c.id, c.opt))); saveCart(); await reload();
      cstep = 'done'; drawCart();
    } catch (e) {
      m.textContent = 'ส่งออเดอร์ไม่สำเร็จ: ' + (e.message || e);
      btn.disabled = false; btn.textContent = 'ยืนยันสั่งซื้อ';
    }
  };
  drawBadge();

  // ── orders (แอดมิน) ──
  const ST = { new: 'ใหม่', confirmed: 'ยืนยันแล้ว', shipped: 'จัดส่งแล้ว', cancelled: 'ยกเลิก' };
  // รายการในออเดอร์: รูป (รูปตัวเลือกที่ลูกค้าเลือก ถ้ามี) + ชื่อ + รุ่นรถ + P/N จากข้อมูลสินค้าปัจจุบัน
  const orderLine = i => {
    const it = items.find(x => x.id === i.id), op = it && i.opt ? it.options.find(x => x.id === i.opt) : null;
    const m = i.opt ? String(i.name).match(/^(.*) \(([^()]*)\)$/) : null;
    const name = m ? m[1] : i.name, optName = m ? m[2] : (op ? op.name : '');
    const photo = (op && op.photo) || (it && it.photos[0]) || '';
    const sku = (op && op.sku) || (it && it.sku) || '';
    const meta = [it && it.model ? '🏍 ' + esc(it.model) : '', sku ? 'P/N: ' + esc(sku) : ''].filter(Boolean).join(' · ');
    return `<li>${photo ? tImg(photo, 'loading="lazy"', '56px') : '<div class="noimg"></div>'}<div class="oi">
      <div class="nm">${esc(name)}</div>${optName ? `<div class="op">ตัวเลือก: ${esc(optName)}</div>` : ''}${meta ? `<div class="mt">${meta}</div>` : ''}
      <div class="q">× ${i.qty} · ${fmtTHB(i.price * i.qty)}</div></div></li>`;
  };
  const drawOrders = async () => {
    const body = $('#ordersBody');
    body.innerHTML = '<div class="empty" style="padding:30px"><span class="spin"></span>กำลังโหลด…</div>';
    let list;
    try { list = await B.listOrders(); }
    catch (e) { body.innerHTML = `<div class="empty"><b>โหลดออเดอร์ไม่ได้</b>${esc(e.message || e)}</div>`; return; }
    if (!list.length) { body.innerHTML = '<div class="empty" style="padding:36px 16px">ยังไม่มีออเดอร์</div>'; return; }
    body.innerHTML = list.map(o => `<div class="order">
      <div class="top">
        <div><div class="no">#${esc(o.id.slice(0, 8).toUpperCase())}</div><div class="when">${new Date(o.created_at).toLocaleString('th-TH', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</div></div>
        <select data-status="${o.id}" class="st-${o.status}">${Object.entries(ST).map(([k, v]) => `<option value="${k}" ${k === o.status ? 'selected' : ''}>${v}</option>`).join('')}</select>
      </div>
      <div class="who"><b style="color:var(--text)">${esc(o.customer_name)}</b> · <a href="tel:${esc(String(o.phone).replace(/[^\d+]/g, ''))}" style="color:var(--blue)">${esc(o.phone)}</a>
${o.address ? esc(o.address) : '(ไม่ได้ใส่ที่อยู่)'}${o.note ? '\nหมายเหตุ: ' + esc(o.note) : ''}</div>
      <ul class="oitems">${(o.items || []).map(orderLine).join('')}</ul>
      ${o.shipping ? `<div class="when" style="margin-top:6px">ค่าจัดส่ง ${fmtTHB(o.shipping)}</div>` : ''}
      <div class="sum">${fmtTHB(o.total)}</div>
    </div>`).join('');
  };
  $('#ordersBtn').onclick = () => { show('orders'); drawOrders(); };
  $('#shopSetBtn').onclick = () => { $('#sShopee').value = shopCfg.shopee_url || ''; $('#sLazada').value = shopCfg.lazada_url || ''; $('#sMsg').textContent = ''; $('#sMsg').className = 'msg'; show('shopSet'); };
  $('#sSave').onclick = async () => {
    const m = $('#sMsg'), v = { shopee_url: $('#sShopee').value.trim(), lazada_url: $('#sLazada').value.trim() };
    m.className = 'msg';
    for (const [k, n] of [['shopee_url', 'Shopee'], ['lazada_url', 'Lazada']]) if (v[k] && !okUrl(v[k])) { m.textContent = `ลิงก์ ${n} ต้องขึ้นต้นด้วย https://`; return; }
    try { await B.saveSettings(v); shopCfg = { ...shopCfg, ...v }; m.className = 'msg ok'; m.textContent = '✓ บันทึกแล้ว'; }
    catch (e) { const t = String(e.message || e); m.textContent = /shop_settings/.test(t) && /schema cache|does not exist/.test(t) ? 'บันทึกไม่สำเร็จ: ยังไม่ได้สร้างตารางตั้งค่าร้าน ให้รัน shop-settings.sql ใน Supabase → SQL Editor ก่อน' : 'บันทึกไม่สำเร็จ: ' + t; }
  };
  $('#ordersBody').addEventListener('change', async e => {
    const s = e.target.closest('[data-status]'); if (!s) return;
    try { await B.setOrderStatus(s.dataset.status, s.value); s.className = 'st-' + s.value; reload(); }
    catch (err) { alert('เปลี่ยนสถานะไม่สำเร็จ: ' + (err.message || err)); drawOrders(); }
  });

  // ── admin login ──
  $('#sellerBtn').onclick = async () => {
    if (seller) { await signOutAll(); return; }
    if (!live) { await B.signIn(); setSeller(true); await loadCosts(); render(); return; }
    openAcct('login');
  };
  $('#lBtn').onclick = async () => {
    const b = $('#lBtn'); b.disabled = true; $('#lMsg').textContent = '';
    try { await B.signIn($('#lEmail').value.trim(), $('#lPass').value); setSeller(true); hide('login'); await loadCosts(); render(); }
    catch (e) { $('#lMsg').textContent = 'เข้าสู่ระบบไม่สำเร็จ: ' + (e.message || e); }
    b.disabled = false;
  };
  $('#lPass').addEventListener('keydown', e => { if (e.key === 'Enter') $('#lBtn').click(); });


  // ── v25: เมนูหัวเว็บ ──
  const ABOUT = () => C.ABOUT || [
    `<p><b>${esc(C.SHOP_NAME || 'P2P Moto')}</b> ${esc(C.SHOP_SUB || '')}</p>`,
    '<ul><li>อะไหล่แท้ DUCATI ทั้งของใหม่และมือสอง</li><li>เช็ครุ่นรถ / Part Number ให้ก่อนสั่งได้</li>' + (SHIP ? `<li>ค่าจัดส่ง ${fmtNum(SHIP)} บาทต่อออเดอร์</li>` : '') + '</ul>',
    '<p>สอบถามสินค้าหรือเช็คของ ทักร้านได้เลย</p>'].join('');
  const openInfo = (title, html) => { $('#iTitle').textContent = title; $('#iBody').innerHTML = html; show('infoBox'); };
  const toTop = () => window.scrollTo({ top: 0, behavior: 'smooth' });
  const toParts = () => { const el = $('#parts'); if (el) window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - $('#hdr').offsetHeight - 10, behavior: 'smooth' }); };
  const drawer = { open() { $('#drawer').classList.add('open'); $('#drawer').setAttribute('aria-hidden', 'false'); }, close() { $('#drawer').classList.remove('open'); $('#drawer').setAttribute('aria-hidden', 'true'); } };
  $('#menuBtn').onclick = () => drawer.open();
  $('#drawer').addEventListener('click', e => { if (e.target.id === 'drawer' || e.target.closest('[data-dclose]')) drawer.close(); });
  const nav = what => {
    drawer.close();
    if (what === 'home') { favView = false; curCat = ''; cond = ''; $('#q').value = ''; render(); toTop(); }
    else if (what === 'all') { favView = false; curCat = ''; cond = ''; render(); toParts(); }
    else if (what === 'favs') { favView = true; curCat = ''; render(); toParts(); }
    else if (what === 'promo') openInfo('โปรโมชั่น', (C.PROMO || '<p>ตอนนี้ยังไม่มีโปรโมชั่น</p><p>ติดตามโปรโมชั่นและของเข้าใหม่ได้ทาง LINE ของร้าน</p>') + `<div class="contact" style="flex-direction:column">${contactHTML()}</div>`);
    else if (what === 'about') openInfo('เกี่ยวกับเรา', ABOUT() + `<div class="contact" style="flex-direction:column">${contactHTML()}</div>`);
    else if (what === 'contact') openContact();
    else if (what === 'account') { hide('cart'); openAcct(); }
  };
  document.addEventListener('click', e => {
    const a = e.target.closest('[data-nav]'); if (!a) return;
    e.preventDefault(); nav(a.dataset.nav);
  });
  $('#searchBtn').onclick = () => { favView = false; render(); toParts(); setTimeout(() => $('#q').focus({ preventScroll: true }), 350); };
  $('#favBtn').onclick = () => nav('favs');
  $('#userBtn').onclick = () => openAcct();

  // ── รายการโปรด (สมาชิก: เก็บในบัญชี · ไม่ได้ล็อกอิน: เก็บในเครื่องนี้) ──
  const loadLocalFavs = () => { try { return JSON.parse(localStorage.getItem('p2p_favs') || '[]'); } catch { return []; } };
  favs = new Set(loadLocalFavs());
  const drawFavBadge = () => {
    const n = [...favs].filter(id => !loaded || items.some(i => i.id === id)).length;
    $('#favBadge').textContent = n; $('#favBadge').hidden = !n; $('#drFav').textContent = n || '';
    $('#favBtn').classList.toggle('on', favView);
  };
  const saveFavs = () => {
    const arr = [...favs].slice(-300);
    if (me) { me.favs = arr; B.acc.saveProfile({ favs: arr }).catch(() => {}); }
    else try { localStorage.setItem('p2p_favs', JSON.stringify(arr)); } catch {}
    drawFavBadge();
  };
  const drawFav = () => {
    const on = !!cur && favs.has(cur.id), b = $('#dFav');
    b.classList.toggle('on', on); b.setAttribute('aria-pressed', on); b.querySelector('span').textContent = on ? 'ถูกใจแล้ว' : 'ถูกใจ';
  };
  $('#dFav').onclick = () => { if (!cur) return; favs.has(cur.id) ? favs.delete(cur.id) : favs.add(cur.id); saveFavs(); drawFav(); if (favView) render(); };

  // ── สมาชิก ──
  const refreshMe = async () => {
    me = await B.acc.current().catch(() => null);
    if (me) {
      // รวมรายการโปรดที่กดไว้ก่อนล็อกอินเข้ากับบัญชี
      const local = loadLocalFavs(), merged = new Set([...(me.favs || []), ...local]);
      favs = merged;
      if (local.length) { try { localStorage.removeItem('p2p_favs'); } catch {} B.acc.saveProfile({ favs: [...merged] }).catch(() => {}); }
    } else favs = new Set(loadLocalFavs());
    if (live) setSeller(!!me && await B.acc.isAdmin().catch(() => false));
    $('#userDot').hidden = !me;
    $('#userBtn').title = me ? 'บัญชีของฉัน' : 'เข้าสู่ระบบ / สมัครสมาชิก';
    $('#drUser').textContent = me ? 'บัญชีของฉัน' + (me.name ? ' (' + me.name + ')' : '') : 'เข้าสู่ระบบ / สมัครสมาชิก';
    drawFavBadge();
  };
  const signOutAll = async () => { await B.acc.signOut().catch(() => {}); if (!live) await B.signOut(); me = null; acctTab = 'login'; setSeller(false); await refreshMe(); hide('acct'); render(); };
  let acctTab = 'login';
  const fld = (id, label, type = 'text', extra = '') => `<div><div class="label"><span>${label}</span></div><input class="in" id="${id}" type="${type}" ${extra}></div>`;
  const openAcct = tab => { if (tab) acctTab = tab; drawAcct(); show('acct'); };
  const drawAcct = async () => {
    const body = $('#acctBody');
    if (!me && acctTab === 'forgot') {
      $('#aTitle').textContent = 'ลืมรหัสผ่าน';
      body.innerHTML = `<div class="hint" style="margin:0 0 12px">ใส่เบอร์โทรหรืออีเมลที่ใช้สมัคร เราจะส่งลิงก์สำหรับตั้งรหัสผ่านใหม่ไปที่อีเมลของคุณ</div>
        <div class="fields">${fld('fId', 'เบอร์โทร หรือ อีเมล', 'text', 'autocomplete="username" autocapitalize="off" spellcheck="false" placeholder="0812345678 หรือ name@email.com"')}
        <div class="msg" id="aMsg"></div><div class="actions"><button class="btn" data-tab="login">กลับ</button><button class="btn primary" id="aGo" style="background:var(--ink);color:var(--on-ink)">ส่งลิงก์ตั้งรหัสใหม่</button></div></div>`;
      setTimeout(() => { const f = $('#fId'); if (f) f.focus(); }, 50);
      return;
    }
    if (me && acctTab === 'reset') {
      $('#aTitle').textContent = 'ตั้งรหัสผ่านใหม่';
      body.innerHTML = `<div class="hint" style="margin:0 0 12px">บัญชี ${esc(me.email)}</div>
        <div class="fields">${fld('rPass', 'รหัสผ่านใหม่ (อย่างน้อย 6 ตัว)', 'password', 'autocomplete="new-password"')}${fld('rPass2', 'ยืนยันรหัสผ่านใหม่', 'password', 'autocomplete="new-password"')}
        <div class="msg" id="aMsg"></div><div class="actions"><button class="btn primary" id="aGo" style="background:var(--ink);color:var(--on-ink)">บันทึกรหัสผ่านใหม่</button></div></div>`;
      setTimeout(() => { const f = $('#rPass'); if (f) f.focus(); }, 50);
      return;
    }
    if (!me) {
      $('#aTitle').textContent = acctTab === 'signup' ? 'สมัครสมาชิก' : 'เข้าสู่ระบบ';
      body.innerHTML = `<div class="tabs" role="tablist"><button data-tab="login" class="${acctTab === 'login' ? 'on' : ''}">เข้าสู่ระบบ</button><button data-tab="signup" class="${acctTab === 'signup' ? 'on' : ''}">สมัครสมาชิก</button></div>
        <div class="fields">` + (acctTab === 'signup'
        ? fld('sName', 'ชื่อ-นามสกุล', 'text', 'autocomplete="name" maxlength="80"') + fld('sPhone', 'เบอร์โทร', 'tel', 'inputmode="tel" autocomplete="tel" placeholder="08x-xxx-xxxx"') +
          fld('sEmail', 'อีเมล', 'email', 'autocomplete="email"') + fld('sPass', 'ตั้งรหัสผ่าน (อย่างน้อย 6 ตัว)', 'password', 'autocomplete="new-password"') +
          `<div class="msg" id="aMsg"></div><div class="actions"><button class="btn primary" id="aGo" style="background:var(--ink);color:var(--on-ink)">สมัครสมาชิก</button></div>
           <div class="hint">สมาชิกจะได้: กรอกที่อยู่อัตโนมัติตอนสั่งซื้อ · ดูสถานะออเดอร์ · เก็บรายการโปรด</div>`
        : fld('aEmail', 'เบอร์โทร หรือ อีเมล', 'text', 'autocomplete="username" autocapitalize="off" spellcheck="false" placeholder="0812345678 หรือ name@email.com"') + fld('aPass', 'รหัสผ่าน', 'password', 'autocomplete="current-password"') +
          `<div class="msg" id="aMsg"></div><div class="actions"><button class="btn primary" id="aGo" style="background:var(--ink);color:var(--on-ink)">เข้าสู่ระบบ</button></div>
           <div class="hint"><button class="linkbtn" data-tab="forgot">ลืมรหัสผ่าน?</button></div>`) + '</div>';
      setTimeout(() => { const f = $(acctTab === 'signup' ? '#sName' : '#aEmail'); if (f) f.focus(); }, 50);
      return;
    }
    $('#aTitle').textContent = 'บัญชีของฉัน';
    body.innerHTML = `<div class="acct-hi"><div class="av">${esc((me.name || me.email || '?').trim().charAt(0).toUpperCase())}</div><div><b>${esc(me.name || 'สมาชิก')}</b><span>${esc(me.email)}</span></div></div>
      ${seller ? '<div class="hint" style="margin:0 0 10px">🔑 บัญชีนี้เป็นแอดมิน</div>' : ''}
      <div class="fields">${fld('pName', 'ชื่อผู้รับ', 'text', 'autocomplete="name" maxlength="80"')}${fld('pPhone', 'เบอร์โทร', 'tel', 'inputmode="tel" autocomplete="tel"')}
        <div><div class="label"><span>ที่อยู่จัดส่ง</span></div><textarea class="in" id="pAddr" maxlength="500" autocomplete="street-address" placeholder="บ้านเลขที่ ถนน ตำบล อำเภอ จังหวัด รหัสไปรษณีย์"></textarea></div>
        <div class="msg" id="aMsg"></div>
        <div class="actions"><button class="btn" id="aOut">ออกจากระบบ</button><button class="btn primary" id="aSave" style="background:var(--ink);color:var(--on-ink)">บันทึกข้อมูล</button></div>
      </div>
      <div class="sect">คำสั่งซื้อของฉัน</div><div class="myorders" id="myOrders"><div class="hint"><span class="spin"></span>กำลังโหลด…</div></div>`;
    $('#pName').value = me.name || ''; $('#pPhone').value = me.phone || ''; $('#pAddr').value = me.address || '';
    let list = [];
    try { list = await B.acc.myOrders(me); } catch (e) { $('#myOrders').innerHTML = `<div class="hint">โหลดออเดอร์ไม่ได้: ${esc(e.message || e)}</div>`; return; }
    if (!$('#myOrders')) return;
    const CST = { new: 'รอร้านยืนยัน', confirmed: 'ร้านยืนยันแล้ว กำลังเตรียมส่ง', shipped: 'จัดส่งแล้ว', cancelled: 'ยกเลิกแล้ว' };
    const STEP = { new: 1, confirmed: 2, shipped: 3 };
    const card = o => {
      const its = o.items || [], d = new Date(o.created_at);
      const when = d.toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' }) + ' ' + d.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
      const n = STEP[o.status] || 0;
      return `<details class="myorder"><summary><div class="top"><span>#${esc(String(o.id).slice(0, 8).toUpperCase())}</span><span class="st-${esc(o.status)}">${esc(CST[o.status] || o.status)}</span></div>
        <div class="it">${when} · ${its.length === 1 ? esc(its[0].name) + ' × ' + its[0].qty : its.length + ' รายการ'}</div>
        <div class="it" style="color:var(--ink);font-weight:700">รวม ${fmtTHB(o.total)}</div>
        ${o.status === 'cancelled' ? '' : `<div class="osteps"><i class="${n >= 1 ? 'on' : ''}"></i><i class="${n >= 2 ? 'on' : ''}"></i><i class="${n >= 3 ? 'on' : ''}"></i></div><div class="osteps-l"><span>สั่งซื้อ</span><span>ร้านยืนยัน</span><span>จัดส่ง</span></div>`}
        <div class="more">แตะเพื่อดูรายละเอียด ▾</div></summary>
        <div class="det">${its.map(i => `<div class="ln"><span>${esc(i.name)} × ${i.qty}</span><span>${fmtTHB((Number(i.price) || 0) * (Number(i.qty) || 0))}</span></div>`).join('')}
          ${Number(o.shipping) ? `<div class="ln"><span>ค่าส่ง</span><span>${fmtTHB(o.shipping)}</span></div>` : ''}
          <div class="ln sum"><span>รวมทั้งหมด</span><span>${fmtTHB(o.total)}</span></div>
          ${o.customer_name || o.address ? `<div class="ship">ส่งถึง: ${esc([o.customer_name, o.phone].filter(Boolean).join(' · '))}${o.address ? '\n' + esc(o.address) : ''}</div>` : ''}
          ${o.note ? `<div class="ship">หมายเหตุ: ${esc(o.note)}</div>` : ''}</div></details>`;
    };
    const act = list.filter(o => o.status === 'new' || o.status === 'confirmed'), past = list.filter(o => !(o.status === 'new' || o.status === 'confirmed'));
    $('#myOrders').innerHTML = !list.length ? '<div class="hint">ยังไม่มีคำสั่งซื้อ · ออเดอร์ที่สั่งตอนล็อกอินอยู่จะแสดงที่นี่</div>'
      : `<div class="ogrp">กำลังดำเนินการ (${act.length})</div>${act.length ? act.map(card).join('') : '<div class="hint">ไม่มีออเดอร์ที่กำลังดำเนินการ</div>'}
         <div class="ogrp">ประวัติการสั่งซื้อ (${past.length})</div>${past.length ? past.map(card).join('') : '<div class="hint">ยังไม่มีประวัติ</div>'}`;
  };
  $('#acctBody').addEventListener('click', async e => {
    const t = e.target.closest('[data-tab]'); if (t) { acctTab = t.dataset.tab; drawAcct(); return; }
    const m = $('#aMsg'), b = e.target.closest('button'); if (!b) return;
    if (b.id === 'aGo') {
      m.className = 'msg'; m.textContent = '';
      b.disabled = true; const label = b.textContent; b.innerHTML = '<span class="spin"></span>กำลังดำเนินการ';
      try {
        if (acctTab === 'forgot') {
          let id = $('#fId').value.trim().toLowerCase();
          if (!id) throw new Error('กรุณาใส่เบอร์โทรหรืออีเมล');
          if (!id.includes('@')) { id = id.replace(/\D/g, ''); if (!/^0\d{8,9}$/.test(id)) throw new Error('เบอร์โทรไม่ถูกต้อง เช่น 0812345678'); }
          const r = await B.acc.resetSend(id);
          if (r === 'demo') { await refreshMe(); acctTab = 'reset'; drawAcct(); const mm = $('#aMsg'); if (mm) { mm.className = 'msg ok'; mm.textContent = '(โหมดตัวอย่าง) บนเว็บจริงลูกค้าจะได้อีเมล กดลิงก์แล้วมาที่หน้านี้'; } return; }
          m.className = 'msg ok'; m.textContent = 'ถ้ามีบัญชีนี้อยู่ เราส่งลิงก์ไปที่อีเมลแล้ว กรุณาเช็คกล่องจดหมาย (และโฟลเดอร์สแปม)';
          b.disabled = false; b.textContent = label; return;
        }
        if (acctTab === 'reset') {
          const p1 = $('#rPass').value, p2 = $('#rPass2').value;
          if (p1.length < 6) throw new Error('รหัสผ่านต้องมีอย่างน้อย 6 ตัว');
          if (p1 !== p2) throw new Error('รหัสผ่านทั้งสองช่องไม่ตรงกัน');
          await B.acc.setPassword(p1); recovering = false; acctTab = 'login'; drawAcct();
          const mm = $('#aMsg'); if (mm) { mm.className = 'msg ok'; mm.textContent = '✓ ตั้งรหัสผ่านใหม่แล้ว ครั้งหน้าใช้รหัสนี้เข้าสู่ระบบ'; }
          return;
        }
        if (acctTab === 'signup') {
          const name = $('#sName').value.trim(), phone = $('#sPhone').value.replace(/\D/g, ''), email = $('#sEmail').value.trim().toLowerCase(), password = $('#sPass').value;
          if (!name) throw new Error('กรุณาใส่ชื่อ');
          if (!/^0\d{8,9}$/.test(phone)) throw new Error('กรุณาใส่เบอร์โทรให้ถูกต้อง เช่น 0812345678');
          if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('กรุณาใส่อีเมลให้ถูกต้อง');
          if (password.length < 6) throw new Error('รหัสผ่านต้องมีอย่างน้อย 6 ตัว');
          const ok = await B.acc.signUp({ email, password, name, phone });
          if (!ok) { m.className = 'msg ok'; m.textContent = 'สมัครเรียบร้อย กรุณากดยืนยันในอีเมล แล้วกลับมาเข้าสู่ระบบ'; b.disabled = false; b.textContent = label; return; }
        } else {
          let email = $('#aEmail').value.trim().toLowerCase(); const password = $('#aPass').value;
          if (!email || !password) throw new Error('กรุณาใส่เบอร์โทรหรืออีเมล และรหัสผ่าน');
          if (!email.includes('@')) { email = email.replace(/\D/g, ''); if (!/^0\d{8,9}$/.test(email)) throw new Error('เบอร์โทรไม่ถูกต้อง เช่น 0812345678'); }
          await B.acc.signIn(email, password);
        }
        await refreshMe(); await loadCosts(); render(); drawAcct();
      } catch (err) {
        const msg = String(err.message || err);
        m.textContent = /invalid login/i.test(msg) ? 'เบอร์โทร/อีเมล หรือรหัสผ่านไม่ถูกต้อง' : /phone taken|database error saving new user|profiles_phone/i.test(msg) ? 'เบอร์นี้มีบัญชีแล้ว ลองเข้าสู่ระบบด้วยเบอร์นี้' : /too many|ถี่เกินไป|rate limit|security purposes/i.test(msg) ? 'ลองหลายครั้งเกินไป กรุณารอสักครู่แล้วลองใหม่' : /same.*password|different from the old/i.test(msg) ? 'รหัสใหม่ต้องไม่ซ้ำกับรหัสเดิม' : /session|not authenticated/i.test(msg) && acctTab === 'reset' ? 'ลิงก์หมดอายุ กรุณากด "ลืมรหัสผ่าน" เพื่อขอลิงก์ใหม่' : /already registered|already been registered/i.test(msg) ? 'อีเมลนี้สมัครไว้แล้ว ลองเข้าสู่ระบบ' : /not confirmed/i.test(msg) ? 'ยังไม่ได้ยืนยันอีเมล กรุณาเช็คอีเมลก่อน' : /signups? not allowed|disabled/i.test(msg) ? 'ขณะนี้ยังไม่เปิดรับสมัครสมาชิก' : msg;
        b.disabled = false; b.textContent = label;
      }
      return;
    }
    if (b.id === 'aSave') {
      const p = { name: $('#pName').value.trim().slice(0, 80), phone: $('#pPhone').value.replace(/\D/g, '').slice(0, 10), address: $('#pAddr').value.trim().slice(0, 500) };
      b.disabled = true;
      try { await B.acc.saveProfile(p); Object.assign(me, p); m.className = 'msg ok'; m.textContent = '✓ บันทึกแล้ว ใช้กรอกอัตโนมัติตอนสั่งซื้อ'; $('#drUser').textContent = 'บัญชีของฉัน' + (me.name ? ' (' + me.name + ')' : ''); }
      catch (err) { m.className = 'msg'; m.textContent = /profiles_phone|duplicate|phone taken/i.test(String(err.message || err)) ? 'เบอร์นี้ถูกใช้กับบัญชีอื่นแล้ว' : 'บันทึกไม่สำเร็จ: ' + (err.message || err); }
      b.disabled = false; return;
    }
    if (b.id === 'aOut') { await signOutAll(); }
  });
  $('#acctBody').addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.tagName === 'INPUT') { const g = $('#aGo'); if (g) g.click(); } });

  // ── editor ──
  // photos: [{ path } (มีอยู่แล้ว) | { blob, preview } (ใหม่)]
  let editing = null, photos = [], dragFrom = null;
  // opts: [{ id, name, price, stock, photo: { path } | { blob, preview } | null }]
  let opts = [], optTarget = -1;
  const prev = p => p.preview || url(TH(p.path)) || url(p.path);
  // copy = เปิดหน้าลงขายใหม่ โดยกรอกข้อมูลและใช้รูปชุดเดิมร่วมกัน (ไม่อัปโหลดซ้ำ)
  const openEditor = (it, copy = false) => {
    editing = it && !copy ? it : null;
    photos = it ? it.photos.map(path => ({ path })) : [];
    $('#mTitle').textContent = copy ? 'ลงขายอะไหล่ (คัดลอกจากรายการเดิม)' : it ? 'แก้ไขอะไหล่' : 'ลงขายอะไหล่';
    $('#fName').value = it ? it.name : '';
    $('#fSku').value = it ? it.sku : '';
    $('#fShopee').value = (it && it.shopee_url) || '';
    $('#fLazada').value = (it && it.lazada_url) || '';
    $('#fModel').value = it ? it.model : '';
    $('#fPrice').value = it && it.price ? Number(it.price).toLocaleString('en-US') : '';
    const cc = (it && costs.get(it.id)) || {};
    $('#fCost').value = fmtNum(cc.cost);
    $('#fStock').value = it ? it.stock : 1;
    edUsed = it ? !!it.used : cond === 'used';
    fillCats(it ? catsOf(it) : (curCat && curCat !== 'none' ? [curCat] : []));
    $('#fNew').checked = it ? !!it.is_new : true;
    $('#fComing').checked = it ? !!it.coming : false;
    $('#delBtn').hidden = !editing;
    $('#msg').textContent = '';
    opts = it ? it.options.map(o => ({ ...o, cost: Number((cc.opt_costs || {})[o.id]) || 0, id: copy ? uid().slice(0, 8) : o.id, photo: o.photo ? { path: o.photo } : null })) : [];
    renderPhotos(); renderOpts(); show('editor');
    setTimeout(() => $('#fName').focus(), 50);
  };
  $('#addBtn').onclick = () => openEditor(null);
  // สวิตช์ของใหม่ / มือสอง ในหน้าแก้ไข: เปลี่ยนชุดหมวดหมู่ในช่องเลือก
  let edUsed = false;
  const inSet = id => !!catOf(id);
  const catOpts = () => '<option value="">— ไม่มีหมวด —</option>' + mains().map(c => `<option value="${c.id}">${esc(c.name)}</option>` + kids(c.id).map(k => `<option value="${k.id}">　└ ${esc(c.name)} ${esc(k.name)}</option>`).join('')).join('');
  const catRow = id => `<div class="catmore"><select class="in" data-xcat>${catOpts()}</select><button type="button" class="x" data-xdel title="เอาหมวดนี้ออก" aria-label="เอาหมวดนี้ออก">✕</button></div>`;
  const pickedCats = () => [...new Set([$('#fCat').value, ...[...document.querySelectorAll('[data-xcat]')].map(s => s.value)].filter(Boolean))];
  // list = หมวดทั้งหมดของสินค้า (ตัวแรก = หมวดหลัก)
  const fillCats = list => {
    list = (list || []).filter(inSet);
    $('#fCat').innerHTML = catOpts();
    $('#fCat').value = list[0] || '';
    $('#fCatsMore').innerHTML = list.slice(1).map(catRow).join('');
    document.querySelectorAll('[data-xcat]').forEach((s, i) => { s.value = list[i + 1]; });
    $('#fCondSw').innerHTML = `<button type="button" data-cond="new" class="${edUsed ? '' : 'on'}">ของใหม่</button><button type="button" data-cond="used" class="${edUsed ? 'on' : ''}">มือสอง</button>`;
  };
  $('#addCatRow').onclick = () => {
    $('#fCatsMore').insertAdjacentHTML('beforeend', catRow(''));
    const all = document.querySelectorAll('[data-xcat]'); all[all.length - 1].focus();
  };
  $('#fCatsMore').addEventListener('click', e => { const x = e.target.closest('[data-xdel]'); if (x) x.closest('.catmore').remove(); });
  $('#fCondSw').addEventListener('click', e => {
    const b = e.target.closest('[data-cond]'); if (!b) return;
    e.stopPropagation();
    const u = b.dataset.cond === 'used'; if (u === edUsed) return;
    edUsed = u; $('#fCondSw').querySelectorAll('button').forEach(x => x.classList.toggle('on', (x.dataset.cond === 'used') === u));
  });

  const renderPhotos = () => {
    const pc = $('#pCount');
    pc.textContent = photos.length + '/' + MAX;
    pc.classList.toggle('full', photos.length >= MAX);
    $('#photoArea').innerHTML = !photos.length
      ? '<div class="zone" id="zone"><div class="ic">📷</div><b>เพิ่มรูปอะไหล่</b><br>ได้สูงสุด 10 รูป</div>'
      : '<div class="photos">' + photos.map((p, i) => `
          <div class="ph" draggable="true" data-i="${i}">
            <img src="${prev(p)}" alt="">
            <button class="rm" data-rm="${i}" title="ลบรูป" aria-label="ลบรูป">×</button>
            ${i === 0 ? '<span class="cover">ปก</span>' : ''}
          </div>`).join('') +
        (photos.length < MAX ? '<button class="drop" id="zone" type="button"><span class="plus">+</span>เพิ่มรูป</button>' : '') + '</div>';
    const z = $('#zone'); if (z) z.onclick = () => $('#file').click();
  };
  const area = $('#photoArea');
  area.addEventListener('click', e => { const b = e.target.closest('[data-rm]'); if (b) { photos.splice(+b.dataset.rm, 1); renderPhotos(); } });
  area.addEventListener('dragstart', e => { const p = e.target.closest('.ph'); if (p) { dragFrom = +p.dataset.i; p.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; } });
  area.addEventListener('dragend', () => { dragFrom = null; area.querySelectorAll('.ph').forEach(p => p.classList.remove('dragging', 'over')); });
  area.addEventListener('dragover', e => {
    e.preventDefault();
    area.querySelectorAll('.ph.over').forEach(p => p.classList.remove('over'));
    const p = e.target.closest('.ph');
    if (dragFrom !== null && p) p.classList.add('over');
    if (dragFrom === null) { const z = $('#zone'); if (z) z.classList.add('hot'); }
  });
  area.addEventListener('dragleave', () => { const z = $('#zone'); if (z) z.classList.remove('hot'); });
  area.addEventListener('drop', e => {
    e.preventDefault();
    const p = e.target.closest('.ph');
    if (dragFrom !== null) {
      if (p) { const [m] = photos.splice(dragFrom, 1); photos.splice(+p.dataset.i, 0, m); }
      dragFrom = null; renderPhotos(); return;
    }
    if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
  });
  $('#file').onchange = e => { addFiles(e.target.files); e.target.value = ''; };

  const shrink = async file => {
    const img = await loadImg(file); if (!img) return null;
    const b = await resizeTo(img, MAX_SIDE, 0.9);
    return b ? { blob: b, preview: URL.createObjectURL(b) } : null;
  };
  // ย่อรูปด้วย pica (Lanczos + unsharp แบบเดียวกับร้านค้าออนไลน์) ถ้าโหลดไม่ได้ใช้ canvas ปกติ
  const P = window.pica ? window.pica({ features: ['js', 'wasm', 'ww'] }) : null;
  const loadImg = src => new Promise(res => {
    const img = new Image(); img.crossOrigin = 'anonymous';
    img.onload = () => res(img); img.onerror = () => res(null);
    img.src = typeof src === 'string' ? src : URL.createObjectURL(src);
  });
  const resizeTo = async (img, side, q) => {
    const w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
    const k = Math.min(1, side / Math.max(w, h));
    const c = document.createElement('canvas'); c.width = Math.round(w * k); c.height = Math.round(h * k);
    if (P) {
      try {
        await P.resize(img, c, { filter: 'lanczos3', unsharpAmount: 70, unsharpRadius: 0.6, unsharpThreshold: 2 });
        return await P.toBlob(c, 'image/jpeg', q);
      } catch {}
    }
    const g = c.getContext('2d'); g.imageSmoothingQuality = 'high'; g.drawImage(img, 0, 0, c.width, c.height);
    return new Promise(r => c.toBlob(r, 'image/jpeg', q));
  };
  // รูปย่อ 2 ขนาด: s = 320px (จอทั่วไป) · m = 640px (จอละเอียด/มือถือ)
  const thumbsOf = async src => {
    const img = await loadImg(src); if (!img) return null;
    return { s: await resizeTo(img, 320, 0.9), m: await resizeTo(img, 640, 0.88) };
  };
  const putThumbs = async (path, t) => {
    for (const [k, b] of Object.entries(t)) {
      if (!b) continue;
      const p = k === 'm' ? TH(path) : TS(path);
      await B.upload(b, p);
      urls.set(p, live ? await B.urlFor(p) : URL.createObjectURL(b));
    }
  };
  const uploadPhoto = async blob => {
    const path = await B.upload(blob);
    const t = await thumbsOf(blob);
    if (t) { try { await putThumbs(path, t); } catch {} }
    return path;
  };
  // สร้างรูปย่อให้รูปเก่าที่ยังไม่มี (ทำครั้งเดียว ตอนแอดมินล็อกอิน)
  let thumbsChecked = false;
  const backfillThumbs = async () => {
    if (thumbsChecked || !live || !seller || !items.length) return;
    thumbsChecked = true;
    try {
      const have = await B.listThumbs();
      const need = [...new Set(items.flatMap(allPhotos))].filter(p => !have.has(p));
      for (const p of need) {
        const t = await thumbsOf(url(p) + '?t=1');
        if (t) await putThumbs(p, t).catch(() => {});
      }
      if (need.length) render();
    } catch {}
  };

  const addFiles = async fileList => {
    const files = [...fileList].filter(f => f.type.startsWith('image/'));
    const room = MAX - photos.length;
    $('#msg').textContent = '';
    if (room <= 0) { $('#msg').textContent = 'ใส่รูปได้สูงสุด 10 รูป'; return; }
    if (files.length > room) $('#msg').textContent = `เลือกมา ${files.length} รูป · เพิ่มได้แค่ ${room} รูป (สูงสุด 10)`;
    for (const f of files.slice(0, room)) { const r = await shrink(f); if (r) photos.push(r); }
    renderPhotos();
  };

  // ── ตัวเลือกสินค้า (แอดมิน) ──
  const fmtNum = v => { const n = String(v ?? '').replace(/[^\d]/g, '').slice(0, 10); return n ? Number(n).toLocaleString('en-US') : ''; };
  const renderOpts = () => {
    $('#priceWrap').hidden = $('#stockWrap').hidden = opts.length > 0;
    $('#oCount').textContent = opts.length ? opts.length + ' ตัวเลือก' : '';
    $('#optHint').textContent = opts.length
      ? 'ราคาและจำนวนตั้งแยกที่แต่ละตัวเลือก · ลูกค้ากดใส่ตะกร้าแล้วจะเห็นรูปของแต่ละตัวเลือกให้เลือก'
      : 'ถ้าสินค้ามีหลายแบบ (เช่น สี ขนาด รุ่น) กดเพิ่มตัวเลือก แต่ละตัวเลือกมีรูป ราคา และจำนวนของตัวเอง · ถ้ามีแบบเดียว ไม่ต้องเพิ่ม';
    $('#optArea').innerHTML = opts.map((o, i) => `
      <div class="optrow">
        <button type="button" class="optph" data-ophoto="${i}" title="เลือกรูปตัวเลือกนี้">${o.photo ? `<img src="${prev(o.photo)}" alt="">` : '<span class="ic">📷</span>ใส่รูป'}</button>
        <div class="optf">
          <label class="wide"><small>ชื่อตัวเลือก</small><input class="in" data-oi="${i}" data-of="name" maxlength="60" placeholder="เช่น สีแดง / ขนาด L / รุ่นปี 2020" value="${esc(o.name)}"></label>
          <label class="wide"><small>P/N ตัวเลือก (ถ้ามี)</small><input class="in" data-oi="${i}" data-of="sku" maxlength="60" placeholder="เช่น 73740321B" value="${esc(o.sku || '')}"></label>
          <label><small>ราคาขาย (บาท)</small><input class="in" data-oi="${i}" data-of="price" inputmode="numeric" placeholder="0" value="${fmtNum(o.price)}"></label>
          <label><small>🔒 ต้นทุน (บาท)</small><input class="in" data-oi="${i}" data-of="cost" inputmode="numeric" placeholder="0" value="${fmtNum(o.cost)}"></label>
          <label><small>จำนวน</small><input class="in" data-oi="${i}" data-of="stock" type="number" min="0" max="9999" inputmode="numeric" value="${o.stock}"></label>
        </div>
        <button type="button" class="x" data-odel="${i}" title="ลบตัวเลือก" aria-label="ลบตัวเลือก">✕</button>
      </div>`).join('');
  };
  $('#addOpt').onclick = () => {
    const price = Number($('#fPrice').value.replace(/[^\d]/g, '')) || '';
    const cost = Number($('#fCost').value.replace(/[^\d]/g, '')) || 0;
    opts.push({ id: uid().slice(0, 8), name: '', price: opts.length ? opts[opts.length - 1].price : price, cost: opts.length ? opts[opts.length - 1].cost : cost, stock: 1, photo: null });
    renderOpts();
    const f = $('#optArea').querySelectorAll('[data-of="name"]'); if (f.length) f[f.length - 1].focus();
  };
  $('#optArea').addEventListener('input', e => {
    const f = e.target.closest('[data-oi]'); if (!f) return;
    const o = opts[+f.dataset.oi], k = f.dataset.of;
    if (k === 'price' || k === 'cost') { f.value = fmtNum(f.value); o[k] = Number(f.value.replace(/[^\d]/g, '')) || 0; }
    else if (k === 'stock') o.stock = Math.max(0, Math.min(9999, parseInt(f.value, 10) || 0));
    else o[k] = f.value;
  });
  $('#optArea').addEventListener('click', e => {
    const d = e.target.closest('[data-odel]');
    if (d) { opts.splice(+d.dataset.odel, 1); renderOpts(); return; }
    const p = e.target.closest('[data-ophoto]');
    if (p) { optTarget = +p.dataset.ophoto; $('#optFile').click(); }
  });
  $('#optFile').onchange = async e => {
    const f = e.target.files[0]; e.target.value = '';
    if (!f || !f.type.startsWith('image/') || !opts[optTarget]) return;
    const r = await shrink(f); if (r) { opts[optTarget].photo = r; renderOpts(); }
  };

  document.querySelectorAll('[data-stock]').forEach(b => b.onclick = () => {
    const f = $('#fStock'); f.value = Math.max(0, Math.min(9999, (parseInt(f.value, 10) || 0) + +b.dataset.stock));
  });
  ['#fPrice', '#fCost'].forEach(sel => $(sel).addEventListener('input', e => {
    const n = e.target.value.replace(/[^\d]/g, '').slice(0, 10);
    e.target.value = n ? Number(n).toLocaleString('en-US') : '';
  }));

  $('#saveBtn').onclick = async () => {
    const name = $('#fName').value.trim();
    const price = Number($('#fPrice').value.replace(/[^\d]/g, ''));
    const m = $('#msg');
    if (!name) { m.textContent = 'กรุณาใส่ชื่ออะไหล่'; return; }
    if (!photos.length) { m.textContent = 'กรุณาเพิ่มรูปอย่างน้อย 1 รูป'; return; }
    const bo = opts.findIndex(o => !o.name.trim() || !o.price);
    if (bo >= 0) { m.textContent = `ตัวเลือกที่ ${bo + 1}: กรุณาใส่ชื่อและราคาให้ครบ`; return; }
    if (!opts.length && !price) { m.textContent = 'กรุณาใส่ราคา (บาท)'; return; }
    for (const [id, nm] of [['#fShopee', 'Shopee'], ['#fLazada', 'Lazada']]) { const v = $(id).value.trim(); if (v && !okUrl(v)) { m.textContent = `ลิงก์ ${nm} ต้องขึ้นต้นด้วย https://`; return; } }
    const stock = opts.length ? opts.reduce((s, o) => s + o.stock, 0) : Math.max(0, Math.min(9999, parseInt($('#fStock').value, 10) || 0));
    const btn = $('#saveBtn'); btn.disabled = true;
    const uploaded = [];
    try {
      const paths = [];
      for (let i = 0; i < photos.length; i++) {
        const p = photos[i];
        if (p.path) { paths.push(p.path); continue; }
        btn.innerHTML = `<span class="spin"></span>อัปโหลดรูป ${i + 1}/${photos.length}`;
        const path = await uploadPhoto(p.blob);
        uploaded.push(path); urls.set(path, live ? await B.urlFor(path) : p.preview); paths.push(path);
      }
      const options = [];
      for (let i = 0; i < opts.length; i++) {
        const o = opts[i]; let photo = null;
        if (o.photo && o.photo.path) photo = o.photo.path;
        else if (o.photo) {
          btn.innerHTML = `<span class="spin"></span>อัปโหลดรูปตัวเลือก ${i + 1}/${opts.length}`;
          photo = await uploadPhoto(o.photo.blob);
          uploaded.push(photo); urls.set(photo, live ? await B.urlFor(photo) : o.photo.preview);
        }
        options.push({ id: o.id, name: o.name.trim(), sku: (o.sku || '').trim(), price: o.price, stock: o.stock, photo });
      }
      btn.innerHTML = '<span class="spin"></span>กำลังบันทึก';
      const part = { id: editing ? editing.id : uid(), name, model: $('#fModel').value.trim(), sku: $('#fSku').value.trim(), price: options.length ? Math.min(...options.map(o => o.price)) : price, stock, photos: paths, options, category_id: pickedCats()[0] || null, is_new: $('#fNew').checked };
      // หมวดเสริม: ส่งเฉพาะเมื่อมี/เคยมี (ใช้ได้แม้ยังไม่ได้เพิ่มคอลัมน์)
      if (pickedCats().length > 1 || (editing && editing.extra_cats.length)) part.extra_cats = pickedCats().slice(1);
      // ส่งช่อง coming เฉพาะเมื่อติ๊ก/เคยติ๊ก (ใช้ได้แม้ยังไม่ได้เพิ่มคอลัมน์)
      if ($('#fComing').checked || (editing && editing.coming)) part.coming = $('#fComing').checked;
      if (edUsed || (editing && editing.used)) part.used = edUsed;
      for (const [id, k] of [['#fShopee', 'shopee_url'], ['#fLazada', 'lazada_url']]) { const v = $(id).value.trim(); if (v || (editing && editing[k])) part[k] = v || null; }
      if (!editing) part.created_at = new Date().toISOString();
      // ส่งช่อง options เฉพาะเมื่อมี/เคยมีตัวเลือก (เว็บยังใช้ได้แม้ยังไม่ได้รัน upgrade-options.sql)
      if (!options.length && !(editing && editing.options.length)) delete part.options;
      await B.save(part);
      let costErr = '';
      if (seller) {
        const cost = Number($('#fCost').value.replace(/[^\d]/g, '')) || null;
        const row = { part_id: part.id, cost: options.length ? null : cost, opt_costs: Object.fromEntries(opts.filter(o => o.cost > 0).map(o => [o.id, o.cost])) };
        if (row.cost || Object.keys(row.opt_costs).length || costs.has(part.id)) {
          try { await B.saveCost(row); } catch (e) { costErr = e.message || String(e); }
        }
      }
      if (editing) { const keep = allPhotos(part); await B.removeFiles(unshared(allPhotos(editing).filter(p => !keep.includes(p)), editing.id)); }
      hide('editor'); await reload();
      if (costErr) { const d = items.find(i => i.id === part.id); if (d) openEditor(d); $('#msg').textContent = 'บันทึกสินค้าแล้ว แต่บันทึกราคาต้นทุนไม่สำเร็จ: ' + costErr; }
    } catch (e) {
      await B.removeFiles(uploaded).catch(() => {});
      m.textContent = 'บันทึกไม่สำเร็จ: ' + (e.message || e);
    }
    btn.disabled = false; btn.textContent = '💾 บันทึก';
  };
  $('#delBtn').onclick = async () => {
    if (!editing || !confirm('ลบรายการนี้และรูปทั้งหมด?')) return;
    try { await B.remove(editing.id); await B.removeFiles(unshared(allPhotos(editing), editing.id)); hide('editor'); await reload(); }
    catch (e) { $('#msg').textContent = 'ลบไม่สำเร็จ: ' + (e.message || e); }
  };

  // ข้อมูลจำลองสำหรับหน้าตัวอย่าง (เฉพาะโหมดตัวอย่าง ไม่มีผลกับเว็บจริง)
  const seedDemo = async () => {
    if ((await B.list()).length || (await B.listCats()).length) return;
    const pic = (t1, t2, bg) => new Promise(r => {
      const c = document.createElement('canvas'); c.width = c.height = 600; const g = c.getContext('2d');
      const gr = g.createLinearGradient(0, 0, 600, 600); gr.addColorStop(0, bg); gr.addColorStop(1, '#111'); g.fillStyle = gr; g.fillRect(0, 0, 600, 600);
      g.fillStyle = '#d0021b'; g.fillRect(330, 40, 240, 70); g.fillStyle = '#fff'; g.font = 'bold 44px sans-serif'; g.fillText('DUCATI', 350, 92);
      g.font = 'bold 50px sans-serif'; g.fillText(t1, 40, 330); g.font = '34px sans-serif'; g.fillText(t2, 40, 390);
      c.toBlob(b => r(b), 'image/jpeg', 0.9);
    });
    const now = Date.now(), at = i => new Date(now - i * 60000).toISOString();
    const C1 = { id: uid(), name: 'สายพาน', sort: 1, created_at: at(90) }, C2 = { id: uid(), name: 'ระบบเบรก', sort: 2, created_at: at(89) }, C3 = { id: uid(), name: 'น้ำมัน & ไส้กรอง', sort: 3, created_at: at(88) };
    const S = (p, name, n) => ({ id: uid(), name, parent_id: p.id, sort: n, created_at: at(80 - n) });
    const s1 = S(C1, 'Multistrada', 1), s2 = S(C1, 'Monster', 2), s3 = S(C1, 'Panigale', 3), s4 = S(C2, 'ผ้าเบรก', 1), s5 = S(C2, 'มือเบรก', 2);
    for (const c of [C1, C2, C3, s1, s2, s3, s4, s5]) await B.saveCat(c);
    const P = [['สายพาน Multistrada 1200', 'Multistrada 1200 (2010-2014)', '73740251B', 6890, s1, '#2b2b2b', true],
      ['สายพาน Multistrada 1200 DVT', 'Multistrada 1200 DVT', '73740321B', 7719, s1, '#3a3a3a'],
      ['สายพาน Multistrada 950', 'Multistrada 950 / V2', '73740251B', 6890, s1, '#333'],
      ['สายพาน Monster 821', 'Monster 821', '73740251B', 4390, s2, '#552222', true],
      ['สายพาน Monster 937', 'Monster 937', '73740251B', 6890, s2, '#4a2a2a'],
      ['สายพาน Panigale 899', 'Panigale 899 / 1199', '73740231A', 5900, s3, '#223355'],
      ['ผ้าเบรกหน้า Brembo', 'Monster / Multistrada', '61340381A', 2950, s4, '#224433', true],
      ['มือเบรก Panigale', 'Panigale V4', '62941181A', 3500, s5, '#333344'],
      ['กรองน้ำมันเครื่อง DUCATI', 'ใช้ได้หลายรุ่น', '44440031C', 943, C3, '#554411'],
      ['ยางรองโซ่ Monster 821', 'Monster 821 / 1200', '4471-A11', 1000, C1, '#3b3b3b']];
    let i = 0;
    for (const [name, model, sku, price, cat, bg, isNew] of P) {
      const b = await pic(name.split(' ').slice(0, 2).join(' '), model, bg);
      const path = await B.upload(b); urls.set(path, URL.createObjectURL(b));
      const id = uid();
      const ops = name.startsWith('ยางรองโซ่') ? [['A ด้านบน+ด้านล่าง', 2842, 1700], ['A ด้านบน', 1620, 980], ['B ด้านล่าง', 1365, 820], ['C ด้านบน ชิ้นเล็ก', 914]].map(([n, pr, c], k) => ({ id: 'op' + k, name: n, price: pr, stock: k === 3 ? 1 : 5, photo: null, _c: c })) : [];
      await B.save({ id, name, model, sku, price, stock: ops.length ? 16 : 2, photos: [path], options: ops.map(({ _c, ...o }) => o), category_id: cat.id, is_new: !!isNew, used: i % 4 === 3, sort: 0, created_at: at(i++) });
      if (ops.length) await B.saveCost({ part_id: id, cost: null, opt_costs: Object.fromEntries(ops.filter(o => o._c).map(o => [o.id, o._c])) });
      else if (i % 3) await B.saveCost({ part_id: id, cost: Math.round(price * 0.62 / 10) * 10, opt_costs: {} });
    }
  };

  (async () => {
    // แสดงปุ่มแอดมินทันที ไม่ต้องรอเชื่อมต่อ
    setSeller(false);
    window.addEventListener('hashchange', () => setSeller(seller));
    await B.init();
    const timeout = new Promise(r => setTimeout(() => r(false), 5000));
    await Promise.race([refreshMe(), timeout]);
    if (!live) setSeller(await B.session().catch(() => false));
    if (live) sb.auth.onAuthStateChange(e => { if (e === 'PASSWORD_RECOVERY') recovering = true; if (e === 'SIGNED_IN' || e === 'SIGNED_OUT' || e === 'USER_UPDATED') setTimeout(() => refreshMe().then(() => { render(); loadCosts().then(render); backfillThumbs(); }), 0); });
    if (!live && C.DEMO_SEED) await seedDemo();
    await reload();
    if (recovering || authErr) {
      try { history.replaceState(null, '', location.pathname + location.search); } catch {}
      if (recovering && !me) await refreshMe();
      if (recovering && me) openAcct('reset');
      else { openAcct('forgot'); const mm = $('#aMsg'); if (mm) mm.textContent = 'ลิงก์ตั้งรหัสใหม่หมดอายุหรือถูกใช้ไปแล้ว กรุณาขอลิงก์ใหม่'; }
    }
  })();
})();

// 👥 โซนคนส่วนมาก (รายย่อย) เข้าออเดอร์ — จากการซื้อขายจริงของ XAUUSDT perp (Binance aggTrades ที่ 🐋 Big Traders ดึงอยู่แล้ว)
//  - ทุกไม้รู้ฝั่ง (ไล่ซื้อ/ไล่ขาย) และขนาด → "ไม้เล็ก" = ขนาดไม่เกินมัธยฐานของจำนวนไม้ ถือเป็นรายย่อย
//  - รวมจำนวนไม้รายย่อยตามราคา ช่องละ $1 ย้อนหลัง 24 ชม. (ไม้ใหม่น้ำหนักมากกว่า: ครึ่งชีวิต ~8 ชม.)
//  - V4.9.19: บนกราฟวาดเป็นโปรไฟล์ทีละ $1 (ฟ้าซื้อ/ส้มขาย) · โซน (ใช้กับ 💀) = ราคาที่ไม้รายย่อยหนาแน่นสุด 4 โซน · เอียงซื้อมีนัย (z ≥ 2) = 🟩 คนส่วนมากเข้า Buy · เอียงขาย = 🟥 Sell · ไม่ชัด = 🟨 สองฝั่ง
//  - ส่งให้ 💀 กับดัก: SL ของคนกลุ่มนี้ = ใต้โซน Buy / เหนือโซน Sell
//  ข้อจำกัด: ตลาดคริปโต (perp) ไม่ใช่โบรก CFD · ไม้เล็กไม่ใช่รายย่อย 100% (บอท/รายใหญ่หั่นไม้ได้) · ต้องเปิด 🐋 Big Traders
(() => {
  'use strict';
  const O = window.OI;
  if (!O || !O.hooks || !(O.sym === 'gold' || O.sym === 'gcy')) return;
  const $ = id => document.getElementById(id);
  const KEY = 'oit_retail' + (O.psfx || ''), SKEY = 'oit_retail_store_v1';
  const cfg = { on: true, res: 1, win: 8 }; // V4.9.22: res = ความละเอียดแถว ($) · V4.9.25: win = ย้อนหลัง (ชม.)
  const RES = [0.1, 0.25, 0.5, 1, 2], WINS = [1, 2, 4, 8, 12, 24];
  const winH = () => WINS.includes(+cfg.win) ? +cfg.win : 8;
  try { Object.assign(cfg, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch (e) {}
  const saveCfg = () => { try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch (e) {} };
  const BK = 15 * 60e3, NC = 16, KEEP = 26 * 3600e3;
  // V4.9.18: FAST = โซนที่แสดง (ไม้ใหม่มีผลไวขึ้น ย้อน 8 ชม. ครึ่งชีวิต 2 ชม. z ≥ 1.5 หนา ≥ 1.15× สูงสุด 6 โซน) · TRAP = ชุดเดิมให้ 💀 (ตรงกับ Worker)
  const FAST = { WIN: 8 * 3600e3, HALF: 2 * 3600e3, Z: 1.5, PEAK: 1.15, MAXZ: 6, MIN: 300 };
  const TRAP = { WIN: 24 * 3600e3, HALF: 8 * 3600e3, Z: 2, PEAK: 1.3, MAXZ: 4, MIN: 500 };
  const TFS = { '1m': 60, '5m': 300, '15m': 900, '30m': 1800, '1h': 3600, '4h': 14400, '1d': 86400 };
  // bins: "ช่วงเวลา 15 นาที|ราคา $1 (perp)" → [ซื้อ: จำนวนไม้ 16 ขนาด][ขาย: 16][ซื้อ oz 16][ขาย oz 16]
  let bins = new Map(), dirty = false;

  // ---------- กันนับซ้ำ: บิตแมปตาม id ของ aggTrade ----------
  let base = 0, bits = new Uint8Array(0);
  function mark(id) { // คืน true = เคยนับแล้ว
    if (!base) { base = id - 1e6; bits = new Uint8Array(250000); }
    let o = id - base;
    if (o < 0) { const add = Math.ceil(-o / 8) + 125000, nb = new Uint8Array(bits.length + add); nb.set(bits, add); bits = nb; base -= add * 8; o = id - base; }
    const by = o >> 3; if (by >= bits.length) { const nb = new Uint8Array(Math.max(by + 125000, bits.length * 2)); nb.set(bits); bits = nb; }
    const m = 1 << (o & 7); if (bits[by] & m) return true; bits[by] |= m; return false;
  }
  function intervals() { const out = []; let lo = -1; for (let by = 0; by < bits.length; by++) { const v = bits[by]; if (v === 0 && lo < 0) continue; if (v === 255 && lo >= 0) continue; for (let k = 0; k < 8; k++) { const on = v & (1 << k), id = base + by * 8 + k; if (on && lo < 0) lo = id; else if (!on && lo >= 0) { out.push([lo, id - 1]); lo = -1; } } } if (lo >= 0) out.push([lo, base + bits.length * 8 - 1]); return out; }

  function sink(t, p, q, s, id) {
    if (id !== undefined && mark(id)) return;
    if (!(q > 0) || !(p > 0) || t < Date.now() - KEEP) return;
    if (id !== undefined && t > Date.now() - 14 * 60e3 && PQ.length < 20000) PQ.push([id, t, p, q, s]); // V4.9.24 ส่งไม้ Binance ให้เซิร์ฟเวอร์
    const c = Math.max(0, Math.min(NC - 1, Math.floor(Math.log2(q * 1000)))), k = Math.floor(t / BK) * BK + '|' + Math.round(p);
    let a = bins.get(k); if (!a) { a = new Float32Array(NC * 4); bins.set(k, a); }
    const i = (s > 0 ? 0 : NC) + c; a[i] += 1; a[2 * NC + i] += q; dirty = true;
  }
  window.OIRetailSink = sink;
  // V4.9.24: เซิร์ฟเวอร์ดึง Binance ไม่ได้ (บล็อก Cloudflare) → เครื่องที่เปิด 🐋 ช่วยส่งไม้ Binance ทุก 1 นาที (เซิร์ฟเวอร์กันนับซ้ำด้วย id)
  const PQ = []; let pushInfo = '';
  async function pushTrades() {
    if (!PQ.length || !O.worker || !cfg.on) return;
    const tr = PQ.splice(0, PQ.length);
    try { const j = await (await fetch(O.worker + '/rtpush', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ src: 'binance', via: 'phone', tr }) })).json(); pushInfo = `ส่ง Binance ${tr.length} ไม้ (ใหม่ ${j.added ?? 0})`; }
    catch (e) { if (PQ.length + tr.length <= 20000) PQ.unshift(...tr); pushInfo = 'ส่งไม้ไม่สำเร็จ จะลองใหม่'; }
  }
  setInterval(pushTrades, 60e3);

  // ---------- เก็บในเครื่อง ----------
  function save() {
    if (!dirty) return; dirty = false;
    try {
      const lim = Date.now() - KEEP, d = {};
      bins.forEach((a, k) => { if (+k.split('|')[0] < lim) { bins.delete(k); return; } const f = []; a.forEach((v, i) => { if (v) f.push(i, i >= 2 * NC ? Math.round(v * 1000) / 1000 : v); }); d[k] = f; });
      localStorage.setItem(SKEY, JSON.stringify({ v: 1, iv: intervals(), d }));
    } catch (e) {}
  }
  (function restore() {
    try {
      const j = JSON.parse(localStorage.getItem(SKEY) || 'null'); if (!j || j.v !== 1) return;
      const lim = Date.now() - KEEP;
      Object.entries(j.d || {}).forEach(([k, f]) => { if (+k.split('|')[0] < lim) return; const a = new Float32Array(NC * 4); for (let i = 0; i < f.length; i += 2) a[f[i]] = f[i + 1]; bins.set(k, a); });
      (j.iv || []).forEach(([lo, hi]) => { if (hi - lo > 5e6) return; for (let id = lo; id <= hi; id++) mark(id); });
    } catch (e) {}
  })();
  setInterval(save, 2 * 60e3);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') save(); });
  // 🐋 ใช้ cache ของตัวเองได้ก็ต่อเมื่อเรามีข้อมูลไม้เล็กย้อนถึงช่วงนั้นแล้ว (ไม่งั้นดึงใหม่ทั้ง 24 ชม. ครั้งแรก)
  function needFull(since) { let mn = Infinity; bins.forEach((a, k) => { const t = +k.split('|')[0]; if (t < mn) mn = t; }); return !bins.size || mn > since + 3600e3; }

  // ---------- คำนวณโซน ----------
  let Z = null, zAt = 0, ZT = null, ztAt = 0;
  function compute(opt = FAST) {
    const now = Date.now(), cnt = new Float64Array(NC), HALF = opt.HALF;
    bins.forEach((a, k) => { if (+k.split('|')[0] < now - opt.WIN) return; for (let c = 0; c < NC; c++) cnt[c] += a[c] + a[NC + c]; });
    const tot = cnt.reduce((x, y) => x + y, 0); if (tot < opt.MIN) return null;
    let mc = 0, acc = 0; for (let c = 0; c < NC; c++) { acc += cnt[c]; if (acc >= tot / 2) { mc = c; break; } }
    const P = new Map(); let n = 0;
    bins.forEach((a, k) => {
      const [tb, pb] = k.split('|').map(Number); if (tb < now - opt.WIN) return;
      const w = Math.pow(0.5, Math.max(0, now - tb - BK / 2) / HALF); let b = 0, s = 0, qb = 0, qs = 0;
      for (let c = 0; c <= mc; c++) { b += a[c]; s += a[NC + c]; qb += a[2 * NC + c]; qs += a[3 * NC + c]; }
      n += b + s; const o = P.get(pb) || { b: 0, s: 0, qb: 0, qs: 0 }; o.b += b * w; o.s += s * w; o.qb += qb * w; o.qs += qs * w; P.set(pb, o);
    });
    const ks = [...P.keys()].sort((x, y) => x - y); if (ks.length < 5) return null;
    const lo = ks[0], arr = []; for (let p = lo; p <= ks[ks.length - 1]; p++) arr.push(Object.assign({ p }, P.get(p) || { b: 0, s: 0, qb: 0, qs: 0 }));
    const mean = arr.reduce((x, o) => x + o.b + o.s, 0) / arr.filter(o => o.b + o.s > 0).length;
    // V4.9.12b: ไม้เล็กซื้อ/ขายแทบ 50/50 ทุกราคา → หาโซนจาก "ความหนาแน่น" (คนเข้าเยอะสุด) แล้วดูว่าเอียงฝั่งไหนแบบมีนัยสถิติ (z ≥ 2)
    const den = arr.map(o => o.b + o.s), sm = den.map((v, i) => v + 0.5 * ((den[i - 1] || 0) + (den[i + 1] || 0)));
    const peaks = sm.map((v, i) => ({ v, i })).filter(x => x.v > 0 && x.v >= (sm[x.i - 1] || 0) && x.v >= (sm[x.i + 1] || 0) && den[x.i] >= mean * opt.PEAK).sort((a, b) => b.v - a.v);
    const pick = []; peaks.forEach(x => { if (pick.length < opt.MAXZ && pick.every(y => Math.abs(y.i - x.i) >= 3)) pick.push(x); });
    const zones = pick.map((x, r) => {
      let a = x.i, b = x.i; while (a > 0 && x.i - a < 2 && den[a - 1] >= den[x.i] * 0.6) a--; while (b < arr.length - 1 && b - x.i < 2 && den[b + 1] >= den[x.i] * 0.6) b++;
      let cb = 0, cs = 0, pq = 0, q = 0; for (let i = a; i <= b; i++) { const o = arr[i]; cb += o.b; cs += o.s; pq += o.p * (o.qb + o.qs); q += o.qb + o.qs; }
      const z = (cb - cs) / Math.sqrt(Math.max(1, cb + cs)), pr = Math.round(cb / Math.max(1, cb + cs) * 100) / 100, side = (pr >= 0.49 && pr <= 0.51) ? 0 : z >= opt.Z ? 1 : z <= -opt.Z ? -1 : 0; // V4.9.15: 49–51% = สองฝั่ง
      return { side, rank: r, lo: arr[a].p - 0.5, hi: arr[b].p + 0.5, avg: q ? pq / q : arr[x.i].p, n: cb + cs, pct: cb / Math.max(1, cb + cs), z };
    });
    return { zones, rows: arr.filter(o => o.b + o.s > 0).map(o => [o.p, o.b, o.s]), mc, maxSz: Math.pow(2, mc + 1) / 1000, n, hrs: (() => { let mn = Infinity; bins.forEach((a, k) => { mn = Math.min(mn, +k.split('|')[0]); }); return Math.min(opt.WIN / 3600e3, (now - mn) / 3600e3); })() };
  }
  function off() { try { const bt = window.OI_bigtr, B = O.series.data() || []; return bt && B.length ? bt.offAt(B[B.length - 1].time) : 0; } catch (e) { return 0; } }
  // V4.9.15: โซนคำนวณที่เซิร์ฟเวอร์ (ไม้จริง Binance + Bybit + Bitget) → ทุกเครื่องได้โซนเดียวกัน ไม่ต้องเปิด 🐋
  //          ถ้าเซิร์ฟเวอร์ยังไม่พร้อม ค่อยใช้ที่เครื่องนี้เก็บเอง (ต้องเปิด 🐋)
  let SZ = null, SZat = 0;
  async function loadSrv() {
    if (!cfg.on || !O.worker) return;
    try { const j = await (await fetch(O.worker + '/retail?win=' + winH(), { cache: 'no-store' })).json(); if (j && j.ready && j.zones) { SZ = j; SZat = Date.now(); O.markDirty(); } } catch (e) {}
  }
  setTimeout(loadSrv, 1500); setInterval(() => { if (document.visibilityState === 'visible') loadSrv(); }, 30000);
  const srvOk = () => SZ && Date.now() - SZat < 5 * 60e3; // V4.9.17: ใช้โซนเซิร์ฟเวอร์ทันที (ไม่รอ 3 ชม.) ทุกเครื่องตรงกัน
  // โซนในสเกลราคากราฟ
  function zones() {
    if (!cfg.on) return [];
    if (srvOk()) { const d = O.sym === 'gcy' ? off() : (O.adj || 0); return SZ.zones.map(z => Object.assign({}, z, { lo: z.lo - d, hi: z.hi - d, avg: z.avg - d })); }
    if (!Z || Date.now() - zAt > 20000) { Z = compute(); zAt = Date.now(); }
    if (!Z) return []; const d = off();
    return Z.zones.map(z => Object.assign({}, z, { lo: z.lo - d, hi: z.hi - d, avg: z.avg - d }));
  }
  const shift = (list, d) => (list || []).map(z => Object.assign({}, z, { lo: z.lo - d, hi: z.hi - d, avg: z.avg - d }));
  // V4.9.18: 💀 กับดักใช้ชุดเดิม (ย้อน 24 ชม. z ≥ 2) ไม่เปลี่ยนตามโซนที่แสดง
  function trapZones() {
    if (!cfg.on) return [];
    if (srvOk() && SZ.trap) return shift(SZ.trap, O.sym === 'gcy' ? off() : (O.adj || 0));
    if (srvOk()) return zones();
    if (!ZT || Date.now() - ztAt > 20000) { ZT = compute(TRAP); ztAt = Date.now(); }
    return ZT ? shift(ZT.zones, off()) : [];
  }
  // V4.9.18: ⚡ ไม้สด 1 ชม. ล่าสุด (จากเซิร์ฟเวอร์)
  function freshZones() {
    if (!cfg.on || !srvOk() || !SZ.fresh) return [];
    return shift(SZ.fresh, O.sym === 'gcy' ? off() : (O.adj || 0));
  }
  // V4.9.19: แถวละเอียดทีละ $1 [ราคากราฟ, ซื้อ, ขาย] (เซิร์ฟเวอร์ ถ้าไม่มีใช้ของเครื่อง)
  // V4.9.22: รวมแถวตามความละเอียดที่ตั้ง (0.1–2$) จากแถวละเอียด $0.1 ของเซิร์ฟเวอร์ (fine) · ไม่มี fine ใช้แถว $1
  let ZW = null;
  function rows() {
    if (!cfg.on) return [];
    const res = RES.includes(+cfg.res) ? +cfg.res : 1;
    const agg = (L, d, r) => { const m = new Map(); L.forEach(x => { const k = Math.round(x[0] / r); const o = m.get(k) || [0, 0]; o[0] += x[1]; o[1] += x[2]; m.set(k, o); }); return [...m.entries()].map(([k, o]) => [k * r - d, o[0], o[1], r]); };
    if (srvOk()) { const d = O.sym === 'gcy' ? off() : (O.adj || 0);
      if (SZ.fine && SZ.fine.length) return agg(SZ.fine, d, res);
      return SZ.rows ? agg(SZ.rows, d, Math.max(1, res)) : []; }
    const h = winH(); if (!ZW || ZW.h !== h || Date.now() - ZW.at > 20000) ZW = { h, at: Date.now(), z: compute(Object.assign({}, FAST, { WIN: h * 3600e3, HALF: h * 900e3, MIN: 50 })) };
    const d = off(); return ZW.z && ZW.z.rows ? agg(ZW.z.rows, d, Math.max(1, res)) : [];
  }
  const live = () => { const bt = window.OI_bigtr; return srvOk() || !!(bt && bt.cfg && bt.cfg.on); };

  // ---------- วาด: แถบแนวนอนชิดขวา (ยาว = จำนวนไม้รายย่อย) ----------
  const fmt = v => v >= 1000 ? (v / 1000).toFixed(1) + 'k' : Math.round(v) + '';
  (O.bgHooks || O.hooks).push((ctx, w, h) => { // V4.9.20: วาดชั้นพื้นหลัง ใต้แถบโซน OI (ไม่บัง OI)
    if (!cfg.on || !live() || (TFS[O.tf] || 60) >= 86400) return;
    const R = rows(), Zs = R.length ? [] : zones(); if (!R.length && !Zs.length && !freshZones().length) return;
    const ts = O.chart.timeScale(), sr = O.series, plotW = ts.width(), plotH = h - ts.height(), px = O.lastClose;
    const mono = getComputedStyle(document.documentElement).getPropertyValue('--mono') || 'monospace';
    hit = [];
    ctx.save(); ctx.font = `bold 9px ${mono}`; ctx.textBaseline = 'middle';
    // V4.9.19: โปรไฟล์ละเอียดทีละ $1 (ไม่รวมเป็นโซนใหญ่ ซึ่งส่วนมากออกสองฝั่ง/เทา) — แต่ละแถว ฟ้า = ไม้รายย่อยไล่ซื้อ ต่อด้วย ส้ม = ไล่ขาย ตามสัดส่วน · ยาว = จำนวนไม้
    //   แถวที่เอียงชัด (z ≥ 1.5 และไม่ใช่ 49–51%) สีเข้ม + ขอบ · แถวไม่เอียง สีจาง · ไม่มีตัวหนังสือ แตะแถวดูรายละเอียด
    if (R.length) {
      const V = R.map(r => ({ p: r[0], b: r[1], s: r[2], y1: sr.priceToCoordinate(r[0] + r[3] / 2), y2: sr.priceToCoordinate(r[0] - r[3] / 2), hw: r[3] / 2 })).filter(r => r.y1 !== null && r.y2 !== null && r.y2 > 0 && r.y1 < plotH);
      const mx = V.length ? Math.max(...V.map(r => r.b + r.s)) : 1, W = plotW * 0.3;
      V.forEach(r => {
        const t = r.b + r.s; if (!(t > 0)) return;
        const pct = r.b / t, z = (r.b - r.s) / Math.sqrt(Math.max(1, t)), pr = Math.round(pct * 100) / 100, side = pr >= 0.49 && pr <= 0.51 ? 0 : z >= 1.5 ? 1 : z <= -1.5 ? -1 : 0;
        if (!side) return; // V4.9.20: ไม่แสดงแถวที่ซื้อ≈ขาย (เดิมเป็นแถบจางสีเทา) เหลือเฉพาะแถวที่เอียงชัด
        const y = Math.round(r.y1) + 0.5, hh = Math.max(1, r.y2 - r.y1 - 1), len = Math.max(2, W * t / mx), x0 = plotW - len, lb = len * pct;
        ctx.globalAlpha = side ? 0.8 : 0.3;
        ctx.fillStyle = side > 0 ? '#38bdf8' : '#ff9f43'; ctx.fillRect(x0, y, len, hh); // V4.9.21: ทั้งแถวเป็นสีฝั่งที่มากกว่า (ไม่ใส่สีอีกฝั่ง)
        if (side) { ctx.globalAlpha = 1; ctx.strokeStyle = side > 0 ? '#38bdf8' : '#ff9f43'; ctx.lineWidth = 1; ctx.strokeRect(x0 - 0.5, y - 0.5, len + 1, hh + 1); }
        const st = side > 0 ? (px < r.p - r.hw ? ' · คนกลุ่มนี้ติดลบ' : px > r.p + r.hw ? ' · คนกลุ่มนี้กำไร' : '') : side < 0 ? (px > r.p + r.hw ? ' · คนกลุ่มนี้ติดลบ' : px < r.p - r.hw ? ' · คนกลุ่มนี้กำไร' : '') : '';
        const lab = side > 0 ? `<b style="color:#38bdf8">Buy ${Math.round(pct * 100)}%</b>` : side < 0 ? `<b style="color:#ff9f43">Sell ${Math.round((1 - pct) * 100)}%</b>` : `สองฝั่ง (ซื้อ ${Math.round(pct * 100)}%)`;
        hit.push({ x0: Math.min(x0, plotW - 40), x1: plotW, y1: r.y1 - 1, y2: r.y2 + 1, txt: `👥 ${r.p.toFixed(r.hw < 0.5 ? 2 : r.hw < 1 ? 1 : 0)} ± ${r.hw} · ${lab} · ไล่ซื้อ ${fmt(r.b)} / ไล่ขาย ${fmt(r.s)} ไม้${st}` });
      });
    }
    const mx = Zs.length ? Math.max(...Zs.map(z => z.n)) : 1;
    Zs.forEach(z => { // (สำรอง: ยังไม่มีแถวละเอียด) แถบโซนแบบเดิม
      let y1 = sr.priceToCoordinate(z.hi), y2 = sr.priceToCoordinate(z.lo); if (y1 === null || y2 === null || y2 < 0 || y1 > plotH) return;
      if (y2 - y1 < 3) { const m = (y1 + y2) / 2; y1 = m - 1.5; y2 = m + 1.5; }
      const len = Math.max(24, plotW * 0.3 * z.n / mx), x0 = plotW - len, col = z.side > 0 ? '#38bdf8' : z.side < 0 ? '#ff9f43' : '#9aa3b8';
      ctx.globalAlpha = z.side ? 0.24 : 0.1; ctx.fillStyle = col; ctx.fillRect(x0, y1, len, y2 - y1);
      ctx.globalAlpha = z.side ? 0.9 : 0.35; ctx.fillRect(x0, y1, 2, y2 - y1);
      const lab = z.side > 0 ? `Buy ${Math.round(z.pct * 100)}%` : z.side < 0 ? `Sell ${Math.round((1 - z.pct) * 100)}%` : 'สองฝั่ง';
      hit.push({ x0, x1: plotW, y1: y1 - 4, y2: y2 + 4, txt: `👥 <b style="color:${col}">${lab}</b> · ${fmt(z.n)} ไม้ · ${z.lo.toFixed(1)}–${z.hi.toFixed(1)}` });
    });
    // V4.9.18: ⚡ ไม้สด 1 ชม. = เส้นประบาง ที่ราคาเฉลี่ย (ไม่มีตัวหนังสือ แตะดูรายละเอียด)
    const Fz = freshZones(), fm = Fz.length ? Math.max(...Fz.map(z => z.n)) : 1;
    Fz.forEach(z => {
      const y = sr.priceToCoordinate(z.avg); if (y === null || y < 0 || y > plotH) return;
      const len = Math.max(30, plotW * 0.4 * z.n / fm), x0 = plotW - len, col = z.side > 0 ? '#38bdf8' : z.side < 0 ? '#ff9f43' : '#9aa3b8';
      ctx.globalAlpha = z.side ? 0.95 : 0.5; ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.setLineDash([4, 3]);
      ctx.beginPath(); ctx.moveTo(x0, Math.round(y) + 0.5); ctx.lineTo(plotW, Math.round(y) + 0.5); ctx.stroke(); ctx.setLineDash([]);
      const lab = z.side > 0 ? `Buy ${Math.round(z.pct * 100)}%` : z.side < 0 ? `Sell ${Math.round((1 - z.pct) * 100)}%` : 'สองฝั่ง';
      hit.push({ x0, x1: plotW, y1: y - 5, y2: y + 5, txt: `⚡ ไม้สด 1 ชม. <b style="color:${col}">${lab}</b> · ${fmt(z.n)} ไม้ · ${z.lo.toFixed(1)}–${z.hi.toFixed(1)} (เฉลี่ย ${z.avg.toFixed(1)})` });
    });
    ctx.restore();
  });

  // แตะแถบ 👥 = รายละเอียดโซน
  let hit = [], dn = null;
  O.chartEl.addEventListener('pointerdown', e => { dn = { x: e.clientX, y: e.clientY }; }, true);
  O.chartEl.addEventListener('pointerup', e => {
    if (!dn || Math.hypot(e.clientX - dn.x, e.clientY - dn.y) > 8) { dn = null; return; } dn = null;
    const r = O.chartEl.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
    const z = hit.find(b => x >= b.x0 && x <= b.x1 && y >= b.y1 && y <= b.y2);
    if (z && O.showToast) setTimeout(() => O.showToast(z.txt, 6000), 120);
  }, true);

  // ---------- เมนู ƒx ----------
  function info() {
    if (srvOk()) return `เซิร์ฟเวอร์ · ${Object.entries(SZ.src || {}).filter(([k]) => !/_via$/.test(k)).map(([k, v]) => k + (SZ.src[k + '_via'] ? '(' + (SZ.src[k + '_via'] === 'phone' ? 'มือถือ' : 'คอมบ้าน') + ')' : '')).join('+') || '-'}${pushInfo ? ' · ' + pushInfo : ''} · ${fmt(SZ.n)} ไม้ · ย้อน ${(SZ.hrs || 0).toFixed(0)} ชม.`;
    if (!live()) return 'รอข้อมูลจากเซิร์ฟเวอร์… (หรือเปิด 🐋 Big Traders ให้เครื่องนี้เก็บเอง)';
    if (!Z) Z = compute(); if (!Z) return 'กำลังเก็บไม้รายย่อย…';
    return `ไม้ ≤ ${Z.maxSz < 1 ? Z.maxSz.toFixed(3) : Z.maxSz} oz · ${fmt(Z.n)} ไม้ · ย้อน ${Z.hrs.toFixed(0)} ชม.`;
  }
  function section() { const d = document.createElement('div'); d.id = 'rtBox'; d.className = 'gsbox'; d.innerHTML = `<div class="row"><button class="gsb${cfg.on ? ' on' : ''}" data-rt="on"><i style="background:linear-gradient(90deg,#38bdf8 50%,#ff9f43 50%)"></i>👥 โซนรายย่อยเข้าออเดอร์</button><span class="gsinfo">${cfg.on ? info() : ''}</span></div>` +
    (cfg.on ? `<div class="row ps"><span class="gsinfo">ความละเอียดแถว</span>${RES.map(r => `<button class="gsb${+cfg.res === r ? ' on' : ''}" data-rtres="${r}">$${r}</button>`).join('')}</div>` +
      `<div class="row ps"><span class="gsinfo">ย้อนหลัง</span>${WINS.map(h => `<button class="gsb${winH() === h ? ' on' : ''}" data-rtwin="${h}">${h} ชม.</button>`).join('')}</div>` : ''); return d; }
  function mount() { const m = $('indMenu'); if (!m || m.hidden || $('rtBox')) return; const box = section(), anchor = $('btBox') || m.querySelector('.t'); anchor ? anchor.after(box) : m.prepend(box); }
  const menu = $('indMenu');
  if (menu) { new MutationObserver(() => mount()).observe(menu, { childList: true }); menu.addEventListener('click', e => { const wb = e.target.closest('[data-rtwin]'); if (wb) { cfg.win = +wb.dataset.rtwin; saveCfg(); const b = $('rtBox'); if (b) b.remove(); mount(); loadSrv(); O.markDirty(); return; } const rb = e.target.closest('[data-rtres]'); if (rb) { cfg.res = +rb.dataset.rtres; saveCfg(); const b = $('rtBox'); if (b) b.remove(); mount(); O.markDirty(); return; } if (!e.target.closest('[data-rt]')) return; cfg.on = !cfg.on; saveCfg(); const b = $('rtBox'); if (b) b.remove(); mount(); O.markDirty(); }); }
  setInterval(() => { if (cfg.on && live()) O.markDirty(); }, 30000);

  window.OI_retail = { zones, rows, trapZones, freshZones, compute, get server() { return srvOk() ? SZ : null; }, save, needFull, get bins() { return bins; }, get cfg() { return cfg; } };
})();

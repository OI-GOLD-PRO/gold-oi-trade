// V4.9.15: ให้ทุกเครื่องเห็นกราฟ/สัญญาณชุดเดียวกัน
//  - /mix    แท่ง XAUUSDT perp รวม 3 แหล่ง (Bybit + Bitget + Binance ผ่าน TradingView) = ค่ากลาง (median) ของแต่ละราคา
//  - /retail โซนรายย่อยเข้าออเดอร์ คำนวณที่เซิร์ฟเวอร์จากไม้จริงของทั้ง 3 ตลาด (เดิมแต่ละเครื่องเก็บเอง → ผลไม่ตรงกัน)
//  - /trapfz แผน 💀 กับดักที่ล็อกครั้งแรก เก็บกลาง ทุกเครื่องใช้แผนเดียวกัน

export const MIX_SRC = ['BYBIT:XAUUSDT.P', 'BITGET:XAUUSDT.P', 'BINANCE:XAUUSDT.P'];
export const MIX_TF = { '1m': '1', '5m': '5', '15m': '15', '30m': '30', '1h': '60', '4h': '240', '1d': '1D' };
const med = a => { const s = a.slice().sort((x, y) => x - y), n = s.length; return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2; };
const r2 = x => Math.round(x * 100) / 100;

// lists: [[t(วินาที), o, h, l, c, v], ...] ต่อแหล่ง → แท่งรวม [t, o, h, l, c, v รวม, จำนวนแหล่ง]
export function mixBars(lists) {
  const m = new Map();
  lists.forEach(L => (L || []).forEach(b => { if (!b || !isFinite(b[4])) return; const g = m.get(b[0]); if (g) g.push(b); else m.set(b[0], [b]); }));
  return [...m.keys()].sort((a, b) => a - b).map(t => {
    const g = m.get(t), o = med(g.map(b => +b[1])), c = med(g.map(b => +b[4]));
    const h = Math.max(med(g.map(b => +b[2])), o, c), l = Math.min(med(g.map(b => +b[3])), o, c);
    return [t, r2(o), r2(h), r2(l), r2(c), Math.round(g.reduce((s, b) => s + (+b[5] || 0), 0) * 1000) / 1000, g.length];
  });
}
// ขนาด n ปัดเป็นขั้น → ทุกเครื่องขอชุดเดียวกัน ได้แคชเดียวกัน
export const mixN = n => n <= 5 ? 5 : n <= 300 ? 300 : n <= 1000 ? 1000 : 1500;

// ---------- โซนรายย่อย ----------
export const RT = { BK: 15 * 60e3, NC: 16, KEEP: 26 * 3600e3, HALF: 8 * 3600e3, NEUTRAL: [0.49, 0.51] };
// V4.9.18: ชุดพารามิเตอร์โซน — FAST = โซนที่แสดง (ตามไม้ใหม่ไวขึ้น) · FRESH = ไม้สด 1 ชม. · TRAP = ชุดเดิมให้ 💀 กับดัก (ไม่เปลี่ยนกติกาที่ backtest ไว้)
export const RT_FAST = { WIN: 8 * 3600e3, HALF: 2 * 3600e3, Z: 1.5, PEAK: 1.15, MAXZ: 6, MIN: 300 };
export const RT_FRESH = { WIN: 3600e3, HALF: 3600e3, Z: 1.5, PEAK: 1.15, MAXZ: 3, MIN: 50 };
export const RT_TRAP = { WIN: 24 * 3600e3, HALF: 8 * 3600e3, Z: 2, PEAK: 1.3, MAXZ: 4, MIN: 500 };
// เพิ่มไม้ลงถัง: buckets = { [เวลาถัง 15 นาที]: { [ราคา $1]: [ซื้อ 16 ขนาด, ขาย 16, ซื้อ oz 16, ขาย oz 16] } }
export function rtAdd(buckets, t, p, q, s) {
  if (!(q > 0) || !(p > 0) || !isFinite(t)) return false;
  const NC = RT.NC, c = Math.max(0, Math.min(NC - 1, Math.floor(Math.log2(q * 1000)))), tb = Math.floor(t / RT.BK) * RT.BK, pb = (Math.round(p * 10) / 10).toFixed(1); // V4.9.22: เก็บละเอียด $0.1 (ของเดิมเป็นเลขเต็ม $1 อ่านร่วมได้)
  const B = buckets[tb] || (buckets[tb] = {}), a = B[pb] || (B[pb] = new Array(NC * 4).fill(0));
  const i = (s > 0 ? 0 : NC) + c; a[i] += 1; a[2 * NC + i] = Math.round((a[2 * NC + i] + q) * 1000) / 1000;
  return true;
}
// คำนวณโซน (เหมือน retail.js เดิม) + V4.9.15: ซื้อ 49–51% = สองฝั่ง เสมอ
export function retailZones(buckets, now, opt = RT_FAST) {
  const { BK, NC, NEUTRAL } = RT, { HALF, WIN, Z, PEAK, MAXZ, MIN } = opt, cnt = new Float64Array(NC), lim = now - WIN;
  let mnT = Infinity;
  Object.entries(buckets).forEach(([tb, B]) => { tb = +tb; if (tb < lim) return; mnT = Math.min(mnT, tb); Object.values(B).forEach(a => { for (let c = 0; c < NC; c++) cnt[c] += a[c] + a[NC + c]; }); });
  const tot = cnt.reduce((x, y) => x + y, 0); if (tot < MIN) return { zones: [], n: tot, hrs: 0, ready: false };
  let mc = 0, acc = 0; for (let c = 0; c < NC; c++) { acc += cnt[c]; if (acc >= tot / 2) { mc = c; break; } }
  const P = new Map(), FN = new Map(); let n = 0;
  Object.entries(buckets).forEach(([tb, B]) => {
    tb = +tb; if (tb < lim) return;
    const w = Math.pow(0.5, Math.max(0, now - tb - BK / 2) / HALF);
    Object.entries(B).forEach(([pk, a]) => {
      const pf = Math.round(+pk * 10), pb = Math.round(+pk); let b = 0, s = 0, qb = 0, qs = 0;
      for (let c = 0; c <= mc; c++) { b += a[c]; s += a[NC + c]; qb += a[2 * NC + c]; qs += a[3 * NC + c]; }
      n += b + s; const o = P.get(pb) || { b: 0, s: 0, qb: 0, qs: 0 }; o.b += b * w; o.s += s * w; o.qb += qb * w; o.qs += qs * w; P.set(pb, o);
      const f = FN.get(pf) || [0, 0]; f[0] += b * w; f[1] += s * w; FN.set(pf, f); // V4.9.22 ละเอียด $0.1
    });
  });
  const ks = [...P.keys()].sort((x, y) => x - y); if (ks.length < 5) return { zones: [], n, hrs: 0, ready: false };
  const arr = []; for (let p = ks[0]; p <= ks[ks.length - 1]; p++) arr.push(Object.assign({ p }, P.get(p) || { b: 0, s: 0, qb: 0, qs: 0 }));
  const mean = arr.reduce((x, o) => x + o.b + o.s, 0) / Math.max(1, arr.filter(o => o.b + o.s > 0).length);
  const den = arr.map(o => o.b + o.s), sm = den.map((v, i) => v + 0.5 * ((den[i - 1] || 0) + (den[i + 1] || 0)));
  const peaks = sm.map((v, i) => ({ v, i })).filter(x => x.v > 0 && x.v >= (sm[x.i - 1] || 0) && x.v >= (sm[x.i + 1] || 0) && den[x.i] >= mean * PEAK).sort((a, b) => b.v - a.v);
  const pick = []; peaks.forEach(x => { if (pick.length < MAXZ && pick.every(y => Math.abs(y.i - x.i) >= 3)) pick.push(x); });
  const zones = pick.map((x, r) => {
    let a = x.i, b = x.i; while (a > 0 && x.i - a < 2 && den[a - 1] >= den[x.i] * 0.6) a--; while (b < arr.length - 1 && b - x.i < 2 && den[b + 1] >= den[x.i] * 0.6) b++;
    let cb = 0, cs = 0, pq = 0, q = 0; for (let i = a; i <= b; i++) { const o = arr[i]; cb += o.b; cs += o.s; pq += o.p * (o.qb + o.qs); q += o.qb + o.qs; }
    const z = (cb - cs) / Math.sqrt(Math.max(1, cb + cs)), pct = cb / Math.max(1, cb + cs), pr = Math.round(pct * 100) / 100;
    const neutral = pr >= NEUTRAL[0] && pr <= NEUTRAL[1];
    const side = neutral ? 0 : z >= Z ? 1 : z <= -Z ? -1 : 0;
    return { side, rank: r, lo: arr[a].p - 0.5, hi: arr[b].p + 0.5, avg: r2(q ? pq / q : arr[x.i].p), n: Math.round(cb + cs), pct: Math.round(pct * 1000) / 1000, z: Math.round(z * 100) / 100 };
  });
  // V4.9.19: แถวละเอียดทีละ $1 ให้แอปวาดโปรไฟล์ (เดิมเห็นแค่โซนรวม ส่วนมากออกสองฝั่ง/เทา) — [ราคา, ซื้อ, ขาย] (ถ่วงน้ำหนักเวลาแล้ว)
  const rows = arr.filter(o => o.b + o.s > 0).map(o => [o.p, Math.round(o.b * 10) / 10, Math.round(o.s * 10) / 10]);
  // V4.9.22: fine = แถวละเอียด $0.1 [ราคา, ซื้อ, ขาย] ให้แอปรวมตามความละเอียดที่ผู้ใช้ตั้ง (0.1–2$)
  const fine = [...FN.entries()].filter(([, f]) => f[0] + f[1] > 0.05).sort((x, y) => x[0] - y[0]).map(([pf, f]) => [pf / 10, Math.round(f[0] * 10) / 10, Math.round(f[1] * 10) / 10]);
  return { zones, rows, fine, n: Math.round(n), mc, maxSz: Math.pow(2, mc + 1) / 1000, hrs: Math.round(Math.min(WIN / 3600e3, (now - mnT) / 3600e3) * 10) / 10, ready: true };
}

// ---------- ดึงไม้จริงจากแต่ละตลาด (ทำทุก 1 นาทีใน Durable Object) ----------
// st = { bn: {id}, by: {t, ids}, bg: {t, ids}, err: {} } · คืนไม้ [t ms, p, q, s]
const fj = async (u, ms = 6000) => { const ac = new AbortController(), tm = setTimeout(() => ac.abort(), ms); try { const r = await fetch(u, { signal: ac.signal, headers: { 'user-agent': 'oi-gold-pro' } }); if (!r.ok) throw new Error('HTTP ' + r.status); return await r.json(); } finally { clearTimeout(tm); } };
export async function pullTrades(st, now = Date.now()) {
  const out = [], err = {}, ok = {};
  // Binance aggTrades: ต่อจาก id ล่าสุด (สูงสุด 6 หน้า/นาที)
  try {
    let n = 0, from = st.bn && st.bn.id ? st.bn.id + 1 : null;
    for (let pg = 0; pg < 6; pg++) {
      const u = 'https://fapi.binance.com/fapi/v1/aggTrades?symbol=XAUUSDT&limit=1000' + (from ? '&fromId=' + from : '');
      const j = await fj(u); if (!Array.isArray(j)) throw new Error((j && j.msg) || 'bad');
      j.forEach(x => { if (from === null || x.a >= from) { out.push([+x.T, +x.p, +x.q, x.m ? -1 : 1]); n++; } });
      if (j.length) { from = j[j.length - 1].a + 1; st.bn = { id: from - 1 }; }
      if (j.length < 1000) break;
    }
    ok.binance = n;
  } catch (e) { err.binance = String(e.message || e); }
  // Bybit recent-trade (1,000 ไม้ล่าสุด) กันซ้ำด้วยเวลา + execId
  try {
    const j = await fj('https://api.bybit.com/v5/market/recent-trade?category=linear&symbol=XAUUSDT&limit=1000');
    if (j.retCode !== 0) throw new Error(j.retMsg || 'bad');
    const L = (j.result.list || []).map(x => ({ t: +x.time, p: +x.price, q: +x.size, s: x.side === 'Buy' ? 1 : -1, id: String(x.execId) }));
    const prev = st.by || { t: 0, ids: [] }, seen = new Set(prev.ids); let n = 0, mx = prev.t;
    L.forEach(x => { if (x.t < prev.t || (x.t === prev.t && seen.has(x.id))) return; if (!prev.t && x.t < now - 90e3) return; out.push([x.t, x.p, x.q, x.s]); n++; if (x.t > mx) mx = x.t; });
    st.by = { t: mx, ids: L.filter(x => x.t === mx).map(x => x.id) }; ok.bybit = n;
  } catch (e) { err.bybit = String(e.message || e); }
  // Bitget fills-history ตั้งแต่ไม้ล่าสุดที่เก็บแล้ว
  try {
    const prev = st.bg || { t: 0, ids: [] }, since = prev.t || now - 90e3;
    const j = await fj(`https://api.bitget.com/api/v2/mix/market/fills-history?symbol=XAUUSDT&productType=usdt-futures&limit=1000&startTime=${since}&endTime=${now}`);
    if (j.code !== '00000') throw new Error(j.msg || 'bad');
    const L = (j.data || []).map(x => ({ t: +x.ts, p: +x.price, q: +x.size, s: x.side === 'buy' ? 1 : -1, id: String(x.tradeId) }));
    const seen = new Set(prev.ids); let n = 0, mx = prev.t;
    L.forEach(x => { if (x.t < prev.t || (x.t === prev.t && seen.has(x.id))) return; out.push([x.t, x.p, x.q, x.s]); n++; if (x.t > mx) mx = x.t; });
    st.bg = { t: mx || since, ids: L.filter(x => x.t === mx).map(x => x.id) }; ok.bitget = n;
  } catch (e) { err.bitget = String(e.message || e); }
  st.err = err; st.ok = ok;
  return out;
}

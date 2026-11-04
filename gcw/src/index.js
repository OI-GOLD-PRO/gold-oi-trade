import { MIX_SRC, MIX_TF, mixBars, mixN, rtAdd, retailZones, pullTrades, RT, RT_FRESH, RT_TRAP, invUpdate } from './mix.js';
export { mixBars, retailZones, rtAdd, RT_FAST, RT_FRESH, RT_TRAP } from './mix.js';
import { newVapid, sendPush } from './push.js';
import { MINI_FLASH_PAGE, MINI_MANIFEST } from './flash.js';
// Worker: ดึงแท่งราคา GC=F (ทองฟิวเจอร์) จาก Yahoo ให้แอป OI Gold Pro เรียกตรง (เปิด CORS) ไม่ต้องรอ GitHub Actions
// GET /?tf=1m|5m|15m|30m|1h|4h|1d   ->   {"symbol":"GC=F","updated":<วินาที>,"bars":{"<tf>":[[t,o,h,l,c],...]}}   (t = วินาที)
const PLAN = {
  '1m': ['1m', '1d'], '5m': ['5m', '5d'], '15m': ['15m', '15d'], '30m': ['30m', '30d'],
  '1h': ['60m', '60d'], '4h': ['60m', '60d'], '1d': ['1d', '1y'],
};
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, POST, OPTIONS', 'access-control-allow-headers': 'content-type', 'cache-control': 'public, max-age=15' };

async function yahoo(interval, range) {
  let lastErr = 'no response';
  for (const host of ['query1', 'query2']) {
    try {
      const r = await fetch(`https://${host}.finance.yahoo.com/v8/finance/chart/GC=F?interval=${interval}&range=${range}`, {
        headers: { 'user-agent': 'Mozilla/5.0 (compatible; OIGoldPro/1.0)', accept: 'application/json' },
        cf: { cacheTtl: 15, cacheEverything: true },
      });
      if (!r.ok) { lastErr = host + ' HTTP ' + r.status; continue; }
      const res = (await r.json()).chart.result[0];
      const q = res.indicators.quote[0], out = [];
      (res.timestamp || []).forEach((t, i) => {
        const o = q.open[i], h = q.high[i], l = q.low[i], c = q.close[i], v = q.volume ? q.volume[i] : null;
        if (o == null || h == null || l == null || c == null) return;
        out.push([t, +o.toFixed(2), +h.toFixed(2), +l.toFixed(2), +c.toFixed(2), v == null ? 0 : v]); // volume สัญญา GC (CME)
      });
      if (out.length) return out;
      lastErr = host + ' empty';
    } catch (e) { lastErr = host + ' ' + (e.message || e); }
  }
  throw new Error(lastErr);
}

export function agg4h(b1h) {
  const m = new Map();
  for (const [t, o, h, l, c, v] of b1h) {
    const k = Math.floor(t / 14400) * 14400, r = m.get(k);
    if (!r) m.set(k, [k, o, h, l, c, v || 0]); else { r[2] = Math.max(r[2], h); r[3] = Math.min(r[3], l); r[4] = c; r[5] += v || 0; }
  }
  return [...m.keys()].sort((a, b) => a - b).map(k => m.get(k));
}

// ---------- ออปชันทองสัญญาที่หมดอายุวันนั้น จาก TradingView (ช้า 10 นาที) ----------
// cron ทุก 1 นาที (เดิม 2) → Durable Object "OptState" ดึง IV/greeks (scanner) + volume/ราคาล่าสุด/bid/ask (quote stream)
// แล้วสะสม volume ที่เพิ่มขึ้นแต่ละรอบ: ราคาล่าสุดใกล้ ask = ซื้อ, ใกล้ bid = ขาย (ประมาณการ)
// GET /opt → {root, exp, expTs, F, updated, polls, oiT, rows:[[k, 'C'|'P', iv, delta, gamma, bid, ask, last, vol, buy, sell, oi], ...]}
const TVH = { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36', origin: 'https://www.tradingview.com', referer: 'https://www.tradingview.com/' };
const UNDER = ['COMEX:GCZ2026', 'COMEX:GCG2027', 'COMEX:GCJ2027', 'COMEX:GCM2027'];
async function tvScanRaw(body) {
  const r = await fetch('https://scanner.tradingview.com/options/scan2?label-product=symbols-options', { method: 'POST', headers: { ...TVH, 'content-type': 'text/plain;charset=UTF-8' }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error('scan HTTP ' + r.status);
  return r.json();
}
export async function tvQuotes(syms, fields, ms = 9000) {
  const resp = await fetch('https://widgetdata.tradingview.com/socket.io/websocket?from=symbols%2FCOMEX-GC1!%2F', { headers: { ...TVH, Upgrade: 'websocket' } });
  const ws = resp.webSocket; if (!ws) throw new Error('ws upgrade failed ' + resp.status);
  ws.accept();
  const out = {}; const send = (m, p) => { const s = JSON.stringify({ m, p }); ws.send('~m~' + s.length + '~m~' + s); };
  let done; const fin = new Promise(r => { done = r; }); let cnt = 0;
  ws.addEventListener('message', e => {
    const d = String(e.data);
    if (/^~m~\d+~m~~h~/.test(d)) { ws.send(d); return; }
    d.split(/~m~\d+~m~/).filter(Boolean).forEach(x => { try { const o = JSON.parse(x); if (o.m === 'qsd') { const q = o.p[1]; out[q.n] = Object.assign(out[q.n] || {}, q.v); } if (o.m === 'quote_completed' && ++cnt >= syms.length) setTimeout(done, 300); } catch (err) {} });
  });
  send('set_auth_token', ['unauthorized_user_token']); send('quote_create_session', ['qs']); send('quote_set_fields', ['qs', ...fields]);
  for (let i = 0; i < syms.length; i += 50) send('quote_add_symbols', ['qs', ...syms.slice(i, i + 50)]);
  await Promise.race([fin, new Promise(r => setTimeout(r, ms))]);
  try { ws.close(); } catch (e) {}
  return out;
}
// เวลาหมดอายุ: 12:30 ตามเวลาชิคาโก (CDT −5 ระหว่างอาทิตย์ที่ 2 มี.ค. ถึงอาทิตย์ที่ 1 พ.ย., นอกนั้น CST −6)
export function expiryTs(ymd) {
  const y = Math.floor(ymd / 10000), m = Math.floor(ymd / 100) % 100, d = ymd % 100;
  const nthSun = (mm, n) => { const f = new Date(Date.UTC(y, mm - 1, 1)).getUTCDay(); return 1 + ((7 - f) % 7) + (n - 1) * 7; };
  const t = Date.UTC(y, m - 1, d), dst = t >= Date.UTC(y, 2, nthSun(3, 2)) && t < Date.UTC(y, 10, nthSun(11, 1));
  return Date.UTC(y, m - 1, d, 12 + (dst ? 5 : 6), 30) / 1000;
}
const ymdOf = ms => { const d = new Date(ms); return d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate(); };
// สะสมซื้อ/ขายจาก volume ที่เพิ่มขึ้น
export function accumulate(prev, q) {
  const vol = Number(q.volume) || 0, pv = prev ? prev.vol : null;
  let buy = prev ? prev.buy : 0, sell = prev ? prev.sell : 0;
  const dv = pv === null ? 0 : vol >= pv ? vol - pv : vol; // volume รีเซ็ตเมื่อขึ้นวันใหม่
  if (dv > 0) {
    const lp = Number(q.lp), bid = Number(q.bid), ask = Number(q.ask);
    if (isFinite(lp) && isFinite(bid) && isFinite(ask) && ask > bid) { const mid = (bid + ask) / 2; if (lp > mid) buy += dv; else if (lp < mid) sell += dv; else { buy += dv / 2; sell += dv / 2; } }
    else { buy += dv / 2; sell += dv / 2; }
  }
  return { vol, buy, sell };
}
// ใช้สัญญาที่หมดอายุใกล้สุดเสมอ (วันที่ตรงกับวันหมดอายุรายเดือน = ใช้ OG รายเดือน เพราะ CME ไม่ออกสัญญารายวันของวันนั้น)
export const isMonthly = root => root === 'OG';
const PICK_V = 2; // เปลี่ยนเลขนี้เมื่อแก้กติกาเลือกสัญญา → เลือกใหม่ทันทีรอบถัดไป
async function pickContract(now) { return (await listContracts(now))[0] || null; }
// สัญญาที่ยังไม่หมดอายุ เรียงจากหมดอายุใกล้สุด
async function listContracts(now) {
  const from = ymdOf(now - 864e5), to = ymdOf(now + 12 * 864e5);
  const j = await tvScanRaw({ columns: ['root', 'expiration'], filter: [{ left: 'type', operation: 'equal', right: 'option' }, { left: 'expiration', operation: 'in_range', right: [from, to] }], ignore_unknown_fields: false, index_filters: [{ name: 'underlying_symbol', values: UNDER }] });
  const seen = new Map();
  (j.symbols || []).forEach(x => { const [root, exp] = x.f; const k = root + '|' + exp; if (!seen.has(k)) seen.set(k, { root, exp, expTs: expiryTs(exp) }); });
  return [...seen.values()].filter(c => c.expTs * 1000 > now).sort((a, b) => a.expTs - b.expTs);
}
// สัญญาปัจจุบันยังไม่มี OI (เพิ่งเปิดซื้อขาย): ยืม OI ของสัญญาถัดไปที่หมดอายุใกล้สุดและมี OI แล้ว
async function borrowOI(now, cur, F) {
  const list = (await listContracts(now)).filter(c => !(c.root === cur.root && c.exp === cur.exp)).slice(0, 3);
  for (const c of list) {
    const sc = await tvScanRaw({ columns: ['strike', 'option-type'], filter: [{ left: 'type', operation: 'equal', right: 'option' }, { left: 'expiration', operation: 'equal', right: c.exp }, { left: 'root', operation: 'equal', right: c.root }, { left: 'strike', operation: 'in_range', right: [Math.floor(F * 0.9), Math.ceil(F * 1.1)] }], ignore_unknown_fields: false, index_filters: [{ name: 'underlying_symbol', values: UNDER }] });
    const sy = sc.symbols || []; if (!sy.length) continue;
    const q = await tvQuotes(sy.map(x => x.s), ['oi'], 20000);
    let oiT = 0; const rows = [];
    sy.forEach(x => { const o = q[x.s] && q[x.s].oi; const v = o && Number(o.value); if (v > 0) { rows.push([x.f[0], x.f[1] === 'call' ? 'C' : 'P', v]); if (o.time > oiT) oiT = o.time; } });
    if (rows.length) return { root: c.root, exp: c.exp, expTs: c.expTs, oiT: oiT || null, rows, forC: cur.root + cur.exp, at: Math.floor(now / 1000) };
  }
  return null;
}
// ---------- ราคาฟิวเจอร์ Gold.F + offset (สำหรับชีต) ----------
// แท่ง 1 นาทีจาก TradingView chart stream
export async function tvBars(sym, res = '1', n = 600, ms = 12000) {
  const resp = await fetch('https://widgetdata.tradingview.com/socket.io/websocket?from=symbols%2FCOMEX-GC1!%2F', { headers: { ...TVH, Upgrade: 'websocket' } });
  const ws = resp.webSocket; if (!ws) throw new Error('ws upgrade failed ' + resp.status);
  ws.accept();
  const send = (m, p) => { const s = JSON.stringify({ m, p }); ws.send('~m~' + s.length + '~m~' + s); };
  let out = null, done; const fin = new Promise(r => { done = r; });
  ws.addEventListener('message', e => {
    const d = String(e.data);
    if (/^~m~\d+~m~~h~/.test(d)) { ws.send(d); return; }
    d.split(/~m~\d+~m~/).filter(Boolean).forEach(x => { try { const o = JSON.parse(x); if (o.m === 'timescale_update' && o.p[1].s) { out = o.p[1].s.s.map(b => b.v); done(); } if (o.m === 'symbol_error' || o.m === 'series_error') done(); } catch (err) {} });
  });
  send('set_auth_token', ['unauthorized_user_token']); send('chart_create_session', ['cs', '']);
  send('resolve_symbol', ['cs', 's1', '=' + JSON.stringify({ symbol: sym, adjustment: 'splits' })]);
  send('create_series', ['cs', 's', 's1', 's1', res, n, '']);
  await Promise.race([fin, new Promise(r => setTimeout(r, ms))]);
  try { ws.close(); } catch (e) {}
  if (!out) throw new Error('no bars ' + sym);
  return out; // [t, o, h, l, c, v]
}
// offset = ระดับ 00/25/50/75 ล่าสุดที่ Gold.F วิ่งผ่าน − ราคา perp ณ จุดตัดในแท่งนาทีเดียวกัน (เทียบสัดส่วนในแท่ง)
export function levelOffset(gf, pp, step = 25) {
  const pm = new Map(pp.map(b => [b[0], b]));
  for (let i = gf.length - 1; i >= 0; i--) {
    const [t, , h, l, c] = gf[i]; const lo = Math.ceil(l / step) * step;
    if (lo > h) continue;
    const p = pm.get(t); if (!p) continue;
    let L = lo; for (let x = lo; x <= h; x += step) if (Math.abs(x - c) < Math.abs(L - c)) L = x;
    const frac = h > l ? (L - l) / (h - l) : 0.5, ref = p[3] + frac * (p[2] - p[3]);
    return { level: L, t, ref: Math.round(ref * 100) / 100, offset: Math.round((L - ref) * 100) / 100 };
  }
  return null;
}
// offset สด = ค่ากลาง (median) ของ (Gold.F − perp) ใน n แท่ง 1 นาทีล่าสุดที่ปิดแล้วและมีทั้งสองฝั่ง
export function liveOffset(gf, pp, nowSec, n = 5) {
  const pm = new Map(pp.map(b => [b[0], b[4]]));
  const d = [];
  for (let i = gf.length - 1; i >= 0 && d.length < n; i--) {
    const [t, , , , c] = gf[i];
    if (t + 60 > nowSec) continue; // แท่งที่ยังไม่ปิด
    const p = pm.get(t); if (p === undefined) continue;
    d.push({ t, off: c - p, gc: c, pp: p });
  }
  if (!d.length) return null;
  const s = d.map(x => x.off).sort((a, b) => a - b), m = s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
  return { offset: Math.round(m * 100) / 100, t: d[0].t, gc: d[0].gc, pp: d[0].pp, n: d.length };
}
const bkk = sec => { const d = new Date(sec * 1000 + 7 * 3600e3); return d.toISOString().slice(0, 16).replace('T', ' '); };

// ---------- Gamma Flip ----------
const npdf = x => Math.exp(-x * x / 2) / Math.sqrt(2 * Math.PI);
// opts: [{k, c(bool), oi, iv, T(ปี)}] → ราคาที่ Net GEX ตัดศูนย์ใกล้ F ที่สุด (สแกน ±6% ทีละ $1, Call +, Put −)
export function gammaFlip(opts, F) {
  const g = S => { let a = 0; for (const o of opts) { const v = o.iv * Math.sqrt(o.T); if (!(v > 0)) continue; const d1 = (Math.log(S / o.k) + v * v / 2) / v; a += (o.c ? 1 : -1) * npdf(d1) / (S * v) * o.oi * 100 * S * S * 0.01; } return a; };
  let best = null, prev = null;
  for (let S = Math.round(F * 0.94); S <= F * 1.06; S++) { const v = g(S); if (prev && prev[1] * v < 0) { const x = prev[0] + (S - prev[0]) * (prev[1] / (prev[1] - v)); if (best === null || Math.abs(x - F) < Math.abs(best - F)) best = x; } prev = [S, v]; }
  return { flip: best === null ? null : Math.round(best * 10) / 10, gexAtF: Math.round(g(F) / 1e5) / 10 };
}
// gmf M: ทุกสัญญาที่หมดอายุภายใน 30 วัน (OI + IV จาก TradingView)
async function computeM(now, F) {
  const sc = await tvScanRaw({ columns: ['strike', 'option-type', 'iv', 'expiration', 'root'], filter: [{ left: 'type', operation: 'equal', right: 'option' }, { left: 'expiration', operation: 'in_range', right: [ymdOf(now - 864e5), ymdOf(now + 30 * 864e5)] }, { left: 'strike', operation: 'in_range', right: [Math.floor(F * 0.9), Math.ceil(F * 1.1)] }], ignore_unknown_fields: false, index_filters: [{ name: 'underlying_symbol', values: UNDER }] });
  const list = (sc.symbols || []).map(x => ({ s: x.s, k: x.f[0], c: x.f[1] === 'call', iv: x.f[2], exp: x.f[3], root: x.f[4] })).filter(o => { const t = expiryTs(o.exp) * 1000; return t > now && t - now <= 30 * 864e5; });
  const q = await tvQuotes(list.map(o => o.s), ['oi'], 25000);
  const opts = [];
  for (const o of list) { const v = q[o.s] && q[o.s].oi && Number(q[o.s].oi.value); if (v > 0 && o.iv > 0) opts.push({ k: o.k, c: o.c, oi: v, iv: Math.min(Math.max(o.iv, 0.03), 1.5), T: (expiryTs(o.exp) * 1000 - now) / (365 * 864e5) }); }
  const f = gammaFlip(opts, F);
  return { M: f.flip, gexM: f.gexAtF, n: opts.length, roots: [...new Set(list.map(o => o.root + o.exp))].length, at: Math.floor(now / 1000), F };
}

// ---------- แจ้งเตือน Telegram (ทำงานแม้ปิดแอป) ----------
// โซน = กำแพง OI 10 อันดับต่อฝั่ง (อันดับ 1-5 กว้าง ±2.5, 6-10 ±1.25) + เส้น Volume วันนี้ 5 อันดับ (±1.25) แบบเดียวกับที่ไฮไลต์ในแอป
const ZH = 2.5, BRK = 2, REACH_COOL = 3600;
export function alertZones(rows, F) {
  const by = new Map();
  rows.forEach(r => { if (F && Math.abs(r.k - F) > F * 0.1) return; const o = by.get(r.k) || { k: r.k, c: 0, p: 0, v: 0 }; if (r.t === 'C') o.c = r.oi || 0; else o.p = r.oi || 0; o.v += r.vol || 0; by.set(r.k, o); });
  const all = [...by.values()];
  const rank = f => { const m = new Map(); all.filter(o => o[f] > 0).sort((a, b) => b[f] - a[f]).slice(0, 10).forEach((o, i) => m.set(o.k, i + 1)); return m; };
  const rC = rank('c'), rP = rank('p');
  const topV = new Set(all.filter(o => o.v > 0).sort((a, b) => b.v - a.v).slice(0, 5).map(o => o.k));
  const out = [];
  all.forEach(o => {
    const c = rC.get(o.k) || 0, p = rP.get(o.k) || 0, useC = c && (!p || o.c >= o.p), rk = useC ? c : p, vol = topV.has(o.k);
    if (!rk && !vol) return;
    const h = rk && rk <= 5 ? ZH : ZH / 2;
    out.push({ k: o.k, lo: o.k - h, hi: o.k + h, c: o.c, p: o.p, v: o.v, side: rk ? (useC ? 'แนวต้าน (Call)' : 'แนวรับ (Put)') + (vol ? ' + Vol' : '') : 'Vol วันนี้' });
  });
  return out.sort((a, b) => a.k - b.k);
}
// bars = แท่ง 1 นาที [t, o, h, l, c] ที่ปิดแล้วและยังไม่เคยตรวจ · st = { z: {k: {inside, lastReach, brokeDay}}, m5: {b, c} }
export function evalAlerts(st, zones, bars, sess) {
  const msgs = []; st.z = st.z || {};
  const keep = new Set(zones.map(z => String(z.k)));
  Object.keys(st.z).forEach(k => { if (!keep.has(k)) delete st.z[k]; });
  for (const b of bars) {
    const [t, , h, l, c] = b, bucket = Math.floor(t / 300);
    // แท่ง M5 ปิดเมื่อข้ามช่วง 5 นาที (ใช้ราคาปิดแท่ง 1 นาทีสุดท้ายของช่วงก่อน)
    let m5 = null;
    if (st.m5 && st.m5.b !== bucket) m5 = st.m5.c;
    st.m5 = { b: bucket, c };
    for (const z of zones) {
      let q = st.z[z.k];
      if (!q) { const ins = c >= z.lo && c <= z.hi; q = st.z[z.k] = { inside: ins, lastReach: ins ? t : -1e12, reached: ins, brokeDay: null }; continue; }
      const touch = l <= z.hi && h >= z.lo;
      if (touch && !q.inside && t - q.lastReach >= REACH_COOL) { q.lastReach = t; q.reached = true; msgs.push({ kind: 'reach', z, price: c > z.hi ? l : c < z.lo ? h : c, t }); } // ราคาที่แตะโซนจริง (ไส้แท่ง) ไม่ใช่ราคาปิดที่อาจอยู่นอกโซน
      q.inside = c >= z.lo && c <= z.hi;
      if (q.reached && m5 !== null && q.brokeDay !== sess) {
        const up = m5 > z.hi + BRK, dn = m5 < z.lo - BRK;
        if (up || dn) { q.brokeDay = sess; q.reached = false; msgs.push({ kind: up ? 'up' : 'down', z, price: m5, t }); }
      }
    }
  }
  return msgs;
}
// ข่าวแดง USD ที่จะออกภายใน 10 นาที (รวมข่าวเวลาเดียวกัน) · warned = รายการเวลาข่าวที่เตือนไปแล้ว
export function newsDue(events, now, warned) {
  const due = events.filter(e => e.c === 'USD' && (e.i || 'H') === 'H').map(e => ({ ...e, ms: Date.parse(e.date) })).filter(e => isFinite(e.ms) && e.ms > now && e.ms - now <= 10 * 60e3 && !warned.includes(e.ms));
  if (!due.length) return null;
  const t0 = Math.min(...due.map(e => e.ms));
  return { ms: t0, list: due.filter(e => e.ms === t0) };
}
const escH = x => String(x ?? '').replace(/[&<>]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[ch]));
const thTime = ms => new Date(ms + 7 * 3600e3).toISOString().slice(11, 16);
export function alertText(a) {
  const z = a.z, info = `strike <b>${z.k}</b> · ${z.side}\nCall ${z.c} · Put ${z.p}${z.v ? ' · Vol ' + z.v : ''}`;
  const rng = `โซน ${z.lo.toFixed(2)}–${z.hi.toFixed(2)}`;
  if (a.kind === 'reach') return `🔔 <b>ราคาถึงโซน</b> แตะ ${a.price.toFixed(2)}\n${rng}\n${info}`;
  return `🚀 <b>เบรกเอ้า${a.kind === 'up' ? 'ขึ้น ▲' : 'ลง ▼'}</b> M5 ปิด ${a.price.toFixed(2)}\n${rng}\n${info}`;
}
async function tgCall(env, method, body) {
  const r = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return r.json();
}

const MIX_LAST = new Map(); // V4.9.29 แท่งล่าสุดที่ได้ของแต่ละแหล่ง (ในหน่วยความจำของ Worker)
const RT_WINS = [1, 2, 4, 8, 12, 24]; // V4.9.25 ช่วงย้อนหลังให้เลือก (ชม.)

export class OptState {
  constructor(state, env) { this.state = state; this.env = env; }
  async fetch(req) {
    const u = new URL(req.url);
    if (u.pathname === '/pushkey') return new Response(JSON.stringify({ key: (await this.vapid()).pub }));
    if (u.pathname === '/pushsub') return new Response(JSON.stringify(await this.pushSub(await req.json().catch(() => null))));
    if (u.pathname === '/pushtest') { // ส่งทดสอบเฉพาะเครื่องที่ขอ
      const b = await req.json().catch(() => null), sub = b && b.sub;
      if (!sub || !sub.endpoint || !sub.keys) return new Response(JSON.stringify({ error: 'bad subscription' }));
      const st = await sendPush(sub, { title: '✅ OI Gold Pro', body: 'ทดสอบแจ้งเตือน Web Push ใช้งานได้', tag: 'test' }, await this.vapid());
      return new Response(JSON.stringify({ status: st, subs: (await this.state.storage.get('push') || []).length }));
    }
    if (u.pathname === '/tglink') return new Response(JSON.stringify(await this.tgLink('diag')));
    if (u.pathname === '/tgtest') {
      const chats = await this.tgLink(false);
      const r = await this.tgSend('✅ ทดสอบแจ้งเตือน OI Gold Pro ทาง Telegram ใช้งานได้');
      return new Response(JSON.stringify({ chats: chats.chats, sent: r }));
    }
    if (u.pathname === '/hist') {
      let h = (await this.state.storage.get('hist') || []).filter(x => marketOpen(x.openT * 1000));
      if (!h || !h.length) { const s = await this.state.storage.get('s'); h = await this.saveHist(s, await this.state.storage.get('m'), true) || []; }
      return new Response(JSON.stringify(h));
    }
    if (u.pathname === '/poll') { const r = await this.poll(); return new Response(JSON.stringify(r)); }
    if (u.pathname === '/rtpoll') return new Response(JSON.stringify(await this.rtPoll()));
    if (u.pathname === '/gexlog') { // V4.9.38 ประวัติแนว GEX บวกรายวัน (ให้กรอบดีลเลอร์รับย้อนหลังใช้แนวของวันนั้น)
      const S = this.state.storage;
      if (req.method === 'POST') {
        const b = await req.json().catch(() => null), d = b && String(b.d || '');
        if (/^\d{4}-\d{2}-\d{2}$/.test(d) && Math.abs(Date.parse(d + 'T00:00:00Z') - Date.now()) < 3 * 86400e3 && Array.isArray(b.lv)) {
          const cur = await S.get('gx:' + d) || { m: {} };
          b.lv.slice(0, 12).forEach(x => { if (!Array.isArray(x)) return; const k = +x[0], pr = +x[1], g = +x[2]; if (!(k > 0 && k < 100000 && pr > 0 && Math.abs(pr - k) < 200 && g > 0 && isFinite(g))) return; const o = cur.m[k] || { p: pr, g: 0, n: 0 }; o.p = pr; o.g = Math.max(o.g, g); o.n = (o.n || 0) + 1; cur.m[k] = o; });
          cur.root = String(b.root || cur.root || '').slice(0, 12); cur.at = Date.now(); await S.put('gx:' + d, cur);
          const all = await S.list({ prefix: 'gx:' }); const keys = [...all.keys()].sort(); for (const k of keys.slice(0, Math.max(0, keys.length - 30))) await S.delete(k);
        }
      }
      const all = await S.list({ prefix: 'gx:' }), out = {}; for (const [k, v] of all) out[k.slice(3)] = v;
      return new Response(JSON.stringify(out));
    }
    if (u.pathname === '/rtpush') return new Response(JSON.stringify(await this.rtPush(await req.json().catch(() => null))));
    if (u.pathname === '/rt') { // V4.9.25 ?win=ชม. → ส่งแถวของช่วงนั้น (ไม่ส่งทุกช่วง ให้ไฟล์เล็ก)
      const z0 = await this.state.storage.get('rt:z') || { zones: [], ready: false };
      // V4.9.31: ใส่ชั่วโมงเองได้ 0.1–24 (ต่ำกว่า 1 ชม. ทีละ 0.1) · ช่วงสำเร็จรูปใช้ที่คำนวณไว้ · ช่วงอื่นคำนวณตอนขอ แล้วจำไว้ 55 วิ
      let h = +u.searchParams.get('win'); h = h > 0 ? Math.min(24, Math.max(0.1, h < 1 ? Math.round(h * 10) / 10 : Math.round(h))) : 0;
      const rt = u.searchParams.get('rt') === '1'; // V4.9.32 โหมดเรียลไทม์ (บัญชีไม่จำกัด): ไม้ Bybit สดผ่าน WebSocket · คำนวณใหม่ทุก ≥ 5 วิ
      if (rt) await this.rtTouch();
      let W = !rt && h && z0.win && z0.win[h];
      if (h && !W) {
        this.rtWC = this.rtWC || new Map(); const c = this.rtWC.get(h);
        if (c && Date.now() - c.at < (rt ? 1.8e3 : 55e3)) W = c.W; // V4.9.33 เรียลไทม์ทุก 2 วิ
        else if (rt) await this.rtFlush();
        if (!W) { const now = Date.now(), all = await this.state.storage.list({ prefix: 'rb:' }), buckets = {}; for (const [k, v] of all) { const tb = +k.slice(3); if (tb >= now - RT.KEEP) buckets[tb] = v; }
          const R = retailZones(buckets, now, { WIN: h * 3600e3, HALF: h * 900e3, Z: 1.5, PEAK: 1.15, MAXZ: 6, MIN: 30 }); W = { rows: R.rows || [], fine: R.fine || [], n: R.n, hrs: R.hrs };
          this.rtWC.set(h, { at: now, W }); if (this.rtWC.size > 30) this.rtWC.delete(this.rtWC.keys().next().value); }
      }
      const { win, ...z } = z0; // ไม่แก้ของที่เก็บไว้ (กันค่าค้างในแคช)
      if (W) Object.assign(z, { rows: W.rows, fine: W.fine, winH: h, winN: W.n, winHrs: W.hrs });
      { const inv = await this.state.storage.get('rt:inv'); if (inv && inv.m) { z.inv = Object.entries(inv.m).filter(([, a]) => a[0] + a[1] >= 0.002).map(([k, a]) => [+k, Math.round(a[0] * 1000) / 1000, Math.round(a[1] * 1000) / 1000]); z.invSince = inv.since; z.invAt = inv.at; z.invOI = inv.oi; } } // V4.9.36 สถานะค้าง
      if (rt) z.rt = { ws: !!(this.bws && this.bws.send && Date.now() - (this.bwsAt || 0) < 30e3), at: Date.now(), err: this.bwsErr || '', oi: this.oiNow || null, invErr: this.invErr || '', q: (this.bwsQ || []).length };
      return new Response(JSON.stringify(z));
    }
    if (u.pathname === '/trapfz') {
      // แผนกับดักที่ล็อกแล้ว: เครื่องแรกที่เห็นสัญญาณเป็นคนล็อก เครื่องอื่นใช้ตาม (ไม่ทับของเดิม)
      const cur = await this.state.storage.get('trapfz') || {};
      if (req.method === 'POST') {
        const b = await req.json().catch(() => null); let add = 0;
        if (b && typeof b === 'object') Object.entries(b).slice(0, 50).forEach(([k, v]) => { if (/^\d{9,11}\|-?1$/.test(k) && v && typeof v === 'object' && !cur[k] && JSON.stringify(v).length < 2000) { cur[k] = v; add++; } });
        const lim = Date.now() / 1000 + 7 * 3600 - 3 * 86400; Object.keys(cur).forEach(k => { if (+k.split('|')[0] < lim) delete cur[k]; });
        if (add) await this.state.storage.put('trapfz', cur);
      }
      return new Response(JSON.stringify(cur));
    }
    const s = await this.state.storage.get('s');
    if (s) s.m = await this.state.storage.get('m') || null;
    return new Response(JSON.stringify(s || null));
  }
  // 👥 เก็บไม้รายย่อยทุก 1 นาที (Binance + Bybit + Bitget) แล้วคำนวณโซนเก็บไว้ให้ทุกเครื่องอ่าน
  async rtPoll() {
    const S = this.state.storage, now = Date.now(), st = await S.get('rt:st') || {};
    // V4.9.36: เปิดสาย Bybit สดค้างไว้ตลอดช่วงตลาดเปิด (cron ทุกนาทีเรียกมาที่นี่) → นับสถานะค้างต่อเนื่อง
    this.rtAlways = now; if (!this.bws) this.bwsOpen(); if (!(await S.getAlarm())) await S.setAlarm(now + 5000);
    const wsLive = !!(this.bws && this.bws.send && now - (this.bwsAt || 0) < 30e3); // V4.9.32 สาย Bybit สดทำงาน → ไม่ดึงซ้ำ
    const trades = await pullTrades(st, now, { skipBybit: wsLive });
    { const st2 = await S.get('rt:st') || {}; if (st2.by && (!st.by || st2.by.t > st.by.t)) st.by = st2.by; if (st2.ws) st.ws = st2.ws; if (wsLive) { st.ok = Object.assign({}, st.ok, { bybit: (st2.ws && st2.ws.n1m) || 0 }); if (st.err) delete st.err.bybit; } } // ระหว่างรอ อาจมีไม้สดเข้ามาแล้ว (กันทับ watermark)
    if (trades.length) st.lastPx = trades[trades.length - 1][1]; // V4.9.24 ราคาอ้างอิงตรวจไม้ที่ส่งมา
    const touched = {};
    for (const [t, p, q, s] of trades) {
      if (t < now - RT.KEEP) continue;
      const tb = Math.floor(t / RT.BK) * RT.BK;
      if (!touched[tb]) touched[tb] = await S.get('rb:' + tb) || {};
      rtAdd({ [tb]: touched[tb] }, t, p, q, s);
    }
    for (const tb of Object.keys(touched)) await S.put('rb:' + tb, touched[tb]);
    const all = await S.list({ prefix: 'rb:' }), buckets = {};
    for (const [k, v] of all) { const tb = +k.slice(3); if (tb < now - RT.KEEP) await S.delete(k); else buckets[tb] = v; }
    const z = retailZones(buckets, now);
    { const F = retailZones(buckets, now, RT_FRESH); z.fresh = F.zones; z.freshRows = F.rows || []; z.freshFine = F.fine || []; } // V4.9.18 ไม้สด 1 ชม. · V4.9.19 + แถว $1
    z.trap = retailZones(buckets, now, RT_TRAP).zones;   // ชุดเดิมให้ 💀 กับดัก (ไม่ส่งแถว)
    // V4.9.25: แถวตามช่วงย้อนหลังที่ผู้ใช้เลือก (1–24 ชม.) · ครึ่งชีวิต = ¼ ของช่วง (8 ชม. = 2 ชม. เท่าชุดหลัก)
    z.win = {}; for (const h of RT_WINS) { const W = retailZones(buckets, now, { WIN: h * 3600e3, HALF: h * 900e3, Z: 1.5, PEAK: 1.15, MAXZ: 6, MIN: 50 }); z.win[h] = { rows: W.rows || [], fine: W.fine || [], n: W.n, hrs: W.hrs }; }
    z.updated = Math.floor(now / 1000); z.src = Object.assign({}, st.ok || {}); z.err = Object.assign({}, st.err || {});
    { const P = await S.get('rt:push') || {}; Object.entries(P).forEach(([k, w]) => { if (w.at > now - 3 * 60e3) { z.src[k] = (w.n || []).filter(e => e[0] > now - 60e3).reduce((a, e) => a + e[1], 0); z.src[k + '_via'] = w.via || ''; delete z.err[k]; } }); } // V4.9.24 ไม้ที่มือถือ/relay ส่งมา
    await S.put('rt:st', st); await S.put('rt:z', z);
    return { added: trades.length, ok: st.ok, err: st.err, zones: z.zones.length };
  }
  // ---------- V4.9.32 👥 เรียลไทม์: สาย WebSocket Bybit (ทุกไม้) เปิดค้างใน DO ขณะมีคนใช้โหมดเรียลไทม์ (≤ 2 นาทีหลังขอครั้งล่าสุด) ----------
  async rtTouch() {
    this.rtReqAt = Date.now();
    if (!this.bws) this.bwsOpen();
    if (!(await this.state.storage.getAlarm())) await this.state.storage.setAlarm(Date.now() + 2000);
  }
  bwsOpen() {
    this.bwsQ = this.bwsQ || []; this.bws = { pending: true }; const me = this.bws;
    (async () => {
      try {
        const resp = await fetch('https://stream.bybit.com/v5/public/linear', { headers: { Upgrade: 'websocket' } });
        const ws = resp.webSocket; if (!ws) throw new Error('ws upgrade ' + resp.status);
        ws.accept(); if (this.bws !== me) { try { ws.close(); } catch (e) {} return; }
        this.bws = ws; this.bwsAt = Date.now(); this.bwsPing = Date.now(); this.bwsErr = '';
        ws.addEventListener('message', e => {
          this.bwsAt = Date.now(); let m; try { m = JSON.parse(e.data); } catch (x) { return; }
          if (m.topic === 'tickers.XAUUSDT' && m.data && m.data.openInterest !== undefined && m.data.openInterest !== '') { const v = +m.data.openInterest; if (v > 0) this.oiNow = v; }
          if (m.topic === 'publicTrade.XAUUSDT' && Array.isArray(m.data)) m.data.forEach(d => { if (this.bwsQ.length < 50000) this.bwsQ.push([+d.T, +d.p, +d.v, d.S === 'Buy' ? 1 : -1, String(d.i)]); });
        });
        const dead = ev => { if (this.bws === ws) { this.bws = null; this.bwsErr = 'closed ' + ((ev && ev.code) || ''); } };
        ws.addEventListener('close', dead); ws.addEventListener('error', dead);
        ws.send(JSON.stringify({ op: 'subscribe', args: ['publicTrade.XAUUSDT', 'tickers.XAUUSDT'] })); // V4.9.36 + tickers (OI สด)
      } catch (e) { if (this.bws === me) this.bws = null; this.bwsErr = String(e.message || e); }
    })();
  }
  async rtFlush() {
    const q = this.bwsQ || []; if (!q.length) return 0; this.bwsQ = [];
    const S = this.state.storage, now = Date.now(), st = await S.get('rt:st') || {}, prev = st.by || { t: 0, ids: [] }, seen = new Set(prev.ids);
    const touched = {}; let mx = prev.t, n = 0; const used = [];
    for (const [t, p, qq, sd, id] of q) {
      if (t < prev.t || (t === prev.t && seen.has(id)) || t < now - RT.KEEP) continue;
      const tb = Math.floor(t / RT.BK) * RT.BK; if (!touched[tb]) touched[tb] = await S.get('rb:' + tb) || {};
      rtAdd({ [tb]: touched[tb] }, t, p, qq, sd); n++; if (t > mx) mx = t; used.push([t, p, qq, sd]);
    }
    for (const tb of Object.keys(touched)) await S.put('rb:' + tb, touched[tb]);
    // V4.9.36: สถานะค้าง (ประมาณ) จาก ΔOI ช่วงนี้
    try {
      const inv = await S.get('rt:inv') || {}, z = await S.get('rt:z') || {}, lp = used.length ? used[used.length - 1][1] : null;
      this.pxH = (this.pxH || []).filter(e => e[0] > now - 70e3); if (lp) this.pxH.push([now, lp]);
      const dir = lp && this.pxH.length ? lp - this.pxH[0][1] : 0, dOI = this.oiNow > 0 && this.oiPrev > 0 ? this.oiNow - this.oiPrev : NaN;
      const r = invUpdate(inv, used, { now, dOI, px: lp, dir, mc: isFinite(z.mc) ? z.mc : 5 });
      if (this.oiNow > 0) this.oiPrev = this.oiNow;
      inv.oi = this.oiNow || inv.oi || null; inv.f = r.f; await S.put('rt:inv', inv);
    } catch (e) { this.invErr = String(e.message || e); }
    const w = st.ws || {}; w.log = (w.log || []).filter(e => e[0] > now - 60e3).concat([[now, n]]); w.n1m = w.log.reduce((a, e) => a + e[1], 0); w.at = now;
    st.by = { t: mx, ids: q.filter(x => x[0] === mx).map(x => x[4]) }; st.lastPx = q[q.length - 1][1]; st.ws = w;
    await S.put('rt:st', st);
    return n;
  }
  async alarm() {
    const now = Date.now();
    try { await this.rtFlush(); } catch (e) {}
    const active = now - (this.rtReqAt || 0) < 120e3; // มีคนดูเรียลไทม์ = ทุก 2 วิ · ไม่มี แต่ตลาดเปิด (cron ยังเรียก) = ทุก 5 วิ
    if (active || now - (this.rtAlways || 0) < 150e3) {
      if (this.bws && this.bws.send && now - (this.bwsPing || 0) > 20e3) { try { this.bws.send('{"op":"ping"}'); this.bwsPing = now; } catch (e) {} }
      if (!this.bws || (this.bws.send && now - (this.bwsAt || 0) > 60e3) || (this.bws.pending && now - (this.rtOpenAt || now) > 30e3)) { try { this.bws && this.bws.close && this.bws.close(); } catch (e) {} this.bws = null; this.rtOpenAt = now; this.bwsOpen(); }
      await this.state.storage.setAlarm(now + (active ? 2000 : 5000)); // V4.9.33 เก็บไม้สดทุก 2 วิ · V4.9.36 ไม่มีคนดู 5 วิ
    } else { try { this.bws && this.bws.close && this.bws.close(); } catch (e) {} this.bws = null; } // ไม่มีใครใช้เรียลไทม์ 2 นาที → ปิดสาย กลับไปดึงทุก 1 นาทีตามเดิม
  }
  // V4.9.24: รับไม้จากมือถือ (🐋 เปิดอยู่) / เครื่องที่บ้าน (relay) สำหรับตลาดที่บล็อก Cloudflare (Binance, Bitget)
  //  body { src: 'binance'|'bitget', tr: [[id, t ms, p, q, s], ...] } · กันนับซ้ำด้วย id (รับเฉพาะ id ที่ใหม่กว่าที่เคยรับ)
  //  กันข้อมูลปลอม: เวลาไม่เก่ากว่า 15 นาที · ราคาห่างราคาล่าสุดของ Bybit ไม่เกิน 1.5% · ขนาด 0 < q < 500 · ครั้งละไม่เกิน 20,000 ไม้
  async rtPush(b) {
    const SRC = ['binance', 'bitget'];
    if (!b || !SRC.includes(b.src) || !Array.isArray(b.tr)) return { error: 'bad body' };
    const S = this.state.storage, now = Date.now(), P = await S.get('rt:push') || {}, w = P[b.src] || { id: '', n: [] };
    const st = await S.get('rt:st') || {}, ref = st.lastPx || null;
    const big = x => String(x).replace(/^0+/, ''), gt = (a, c) => { a = big(a); c = big(c); return a.length !== c.length ? a.length > c.length : a > c; };
    const ok = b.tr.slice(-20000).filter(x => Array.isArray(x) && x.length === 5 && /^\d{1,25}$/.test(String(x[0])) && x[1] > now - 15 * 60e3 && x[1] < now + 60e3 && x[3] > 0 && x[3] < 500 && (x[4] === 1 || x[4] === -1) && x[2] > 0 && (!ref || Math.abs(x[2] / ref - 1) < 0.015))
      .filter(x => !w.id || gt(x[0], w.id)).sort((a, c) => gt(a[0], c[0]) ? 1 : -1);
    if (!ok.length) return { added: 0, wm: w.id };
    const touched = {};
    for (const [, t, p, q, sd] of ok) { const tb = Math.floor(t / RT.BK) * RT.BK; if (!touched[tb]) touched[tb] = await S.get('rb:' + tb) || {}; rtAdd({ [tb]: touched[tb] }, t, p, q, sd); }
    for (const tb of Object.keys(touched)) await S.put('rb:' + tb, touched[tb]);
    w.id = String(ok[ok.length - 1][0]); w.at = now; w.via = String(b.via || '').slice(0, 20); w.n = (w.n || []).filter(e => e[0] > now - 5 * 60e3).concat([[now, ok.length]]);
    P[b.src] = w; await S.put('rt:push', P);
    return { added: ok.length, wm: w.id };
  }
  // รับคำสั่งจากแชท: /start = รับแจ้งเตือน, /stop = หยุด
  async tgLink(reply) {
    if (!this.env.TELEGRAM_BOT_TOKEN) return { error: 'ยังไม่ได้ตั้ง TELEGRAM_BOT_TOKEN', chats: 0 };
    const tg = await this.state.storage.get('tg') || { chats: [], off: 0 };
    const up = await tgCall(this.env, 'getUpdates', { offset: tg.off, timeout: 0, allowed_updates: ['message'] });
    for (const u of (up.result || [])) {
      tg.off = u.update_id + 1;
      const m = u.message; if (!m || !m.text) continue;
      const id = m.chat.id, cmd = m.text.trim().split(/[\s@]/)[0].toLowerCase();
      if (cmd === '/start' && !tg.chats.includes(id)) { tg.chats.push(id); await tgCall(this.env, 'sendMessage', { chat_id: id, text: '✅ เชื่อมต่อแจ้งเตือน OI Gold Pro แล้ว\nจะเตือน: ราคาถึงโซน OI/Vol · เบรกเอ้า M5 · ข่าวแดง USD ก่อน 10 นาที\nพิมพ์ /stop เพื่อหยุด' }); }
      else if (cmd === '/stop' && tg.chats.includes(id)) { tg.chats = tg.chats.filter(x => x !== id); await tgCall(this.env, 'sendMessage', { chat_id: id, text: '🔕 หยุดแจ้งเตือนแล้ว พิมพ์ /start เพื่อเปิดใหม่' }); }
    }
    await this.state.storage.put('tg', tg);
    const me = reply === 'diag' ? await tgCall(this.env, 'getMe', {}) : null;
    return { chats: tg.chats.length, ...(up.ok ? { updates: (up.result || []).length } : { tg_error: up.description || 'unknown' }), ...(me ? { bot: me.ok ? '@' + me.result.username : me.description } : {}) };
  }
  async tgSend(html) {
    if (!this.env.TELEGRAM_BOT_TOKEN) return 0;
    const tg = await this.state.storage.get('tg'); if (!tg || !tg.chats.length) return 0;
    let n = 0;
    for (const id of tg.chats) { try { const r = await tgCall(this.env, 'sendMessage', { chat_id: id, text: html, parse_mode: 'HTML', disable_web_page_preview: true }); if (r.ok) n++; } catch (e) {} }
    return n;
  }
  // ---------- Web Push ----------
  async vapid() { let v = await this.state.storage.get('vapid'); if (!v) { v = await newVapid(); await this.state.storage.put('vapid', v); } return v; }
  async pushSub(body) {
    const subs = await this.state.storage.get('push') || [];
    const ep = body && body.sub && body.sub.endpoint;
    if (!ep || !/^https:\/\//.test(ep) || !body.sub.keys || !body.sub.keys.p256dh || !body.sub.keys.auth) return { error: 'bad subscription' };
    const rest = subs.filter(x => x.endpoint !== ep);
    const types = body.types && typeof body.types === 'object' ? Object.fromEntries(Object.entries(body.types).filter(([k]) => /^[a-z]{2,12}$/.test(k)).map(([k, v]) => [k, !!v])) : null;
    if (!body.off) rest.push({ endpoint: ep, keys: { p256dh: body.sub.keys.p256dh, auth: body.sub.keys.auth }, types, at: Date.now() });
    while (rest.length > 500) rest.shift();
    await this.state.storage.put('push', rest);
    return { ok: true, subs: rest.length };
  }
  async pushSend(items) {
    const subs = await this.state.storage.get('push') || []; if (!subs.length || !items.length) return 0;
    const v = await this.vapid(), dead = new Set(); let n = 0;
    for (const sub of subs) for (const it of items) {
      if (it.kind && sub.types && sub.types[it.kind] === false) continue; // ผู้ใช้ปิดชนิดนี้ไว้ในเมนู ⚙️
      try { const st = await sendPush(sub, it, v); if (st === 404 || st === 410) { dead.add(sub.endpoint); break; } if (st < 300) n++; } catch (e) {}
    }
    if (dead.size) await this.state.storage.put('push', subs.filter(x => !dead.has(x.endpoint)));
    return n;
  }
  async alerts(s, now) {
    if (this.env.TELEGRAM_BOT_TOKEN) { try { await this.tgLink(true); } catch (e) {} }
    const tg = await this.state.storage.get('tg'), subs = await this.state.storage.get('push') || [];
    if ((!this.env.TELEGRAM_BOT_TOKEN || !tg || !tg.chats.length) && !subs.length) return;
    const st = await this.state.storage.get('al') || { lastT: 0, warned: [] };
    const out = [], kinds = [];
    // โซน OI/Vol จากแท่ง 1 นาทีที่ปิดแล้วของ Gold.F (เรียลไทม์ สเกลเดียวกับกราฟในแอป) — COMEX:GC1! แบบไม่ล็อกอินช้า 10 นาที ทำให้ราคาแจ้งเตือนไม่ตรงโซน
    try {
      const bars = (await tvBars('BLACKBULL:GOLD.F', '1', 15)).filter(b => b[0] > st.lastT && b[0] + 60 <= now / 1000);
      if (bars.length) {
        let zr = Object.values(s.rows);
        if (!zr.some(r => r.oi > 0) && s.fb) zr = zr.concat(s.fb.rows.map(([k, t, oi]) => ({ k, t, oi, vol: 0 }))); // ใช้ OI ที่ยืมมาระหว่างรอ
        const zones = alertZones(zr, s.F);
        evalAlerts(st, zones, bars, ymdOf(now + 2 * 3600e3)).forEach(a => { out.push(alertText(a)); kinds.push(a.kind === 'reach' ? 'zone' : 'break'); });
        st.lastT = bars[bars.length - 1][0];
      }
    } catch (e) {}
    // ข่าวแดง USD ก่อนออก 10 นาที
    try {
      let nw = await this.state.storage.get('news');
      if (!nw || now - nw.at > 10 * 60e3) { const j = await (await fetch('https://raw.githubusercontent.com/OI-GOLD-PRO/gold-oi-pro/main/news.json?t=' + Math.floor(now / 600e3))).json(); nw = { at: now, ev: j.events || [] }; await this.state.storage.put('news', nw); }
      const d = newsDue(nw.ev, now, st.warned);
      if (d) {
        st.warned = [...st.warned.filter(x => x > now - 864e5), d.ms];
        kinds.push('news'); out.push(`📰 <b>ข่าวแดง USD อีก ${Math.max(1, Math.round((d.ms - now) / 60e3))} นาที</b> (${thTime(d.ms)} น.)\n` + d.list.map(e => `● ${escH(e.title)}${e.forecast ? ' (คาด ' + escH(e.forecast) + (e.previous ? ' · ก่อน ' + escH(e.previous) : '') + ')' : ''}`).join('\n'));
      }
    } catch (e) {}
    await this.state.storage.put('al', st);
    if (out.length) {
      await this.tgSend(out.join('\n\n'));
      // Push: บรรทัดแรก = หัวข้อ, ที่เหลือ = เนื้อหา (ตัดแท็ก HTML)
      const plain = h => h.replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
      await this.pushSend(out.map((h, i) => { const [t, ...b] = plain(h).split('\n'); return { title: t, body: b.join('\n'), tag: 'oi' + now + i, kind: kinds[i] }; }));
    }
  }
  async saveHist(s, m, seed) {
    if (!s || !s.sess || !s.openEM || !marketOpen(s.openT * 1000)) return;
    const h = await this.state.storage.get('hist') || [];
    if (h.some(x => x.sess === s.sess)) return h;
    const w = walls(Object.values(s.rows), s.openF || s.F);
    h.push({ sess: s.sess, root: s.root, openF: s.openF, openEM: s.openEM, openT: s.openT, itd: s.itd ?? null, M: m && m.M != null ? m.M : null, cw: w.cw, pw: w.pw, ...(seed ? { seed: 1 } : {}) });
    h.sort((a, b) => a.sess - b.sess);
    while (h.length > 60) h.shift();
    await this.state.storage.put('hist', h);
    return h;
  }
  async poll() {
    const now = Date.now();
    let s = await this.state.storage.get('s');
    let c = s && s.expTs * 1000 > now && s.pickV === PICK_V ? { root: s.root, exp: s.exp, expTs: s.expTs } : await pickContract(now);
    if (!c) return { err: 'no contract' };
    // เปลี่ยนสัญญา (หลังหมดอายุ ~01:30 น.) ให้คงค่าเปิดวันเทรดเดิมไว้ ไม่เริ่มกรอบ EM ใหม่กลางวัน
    if (!s || s.root !== c.root || s.exp !== c.exp) s = { ...c, rows: {}, polls: 0, ...(s ? { sess: s.sess, openF: s.openF, openEM: s.openEM, openT: s.openT } : {}) };
    s.pickV = PICK_V;
    const sc = await tvScanRaw({ columns: ['strike', 'option-type', 'iv', 'delta', 'gamma', 'bid', 'ask'], filter: [{ left: 'type', operation: 'equal', right: 'option' }, { left: 'expiration', operation: 'equal', right: c.exp }, { left: 'root', operation: 'equal', right: c.root }], ignore_unknown_fields: false, index_filters: [{ name: 'underlying_symbol', values: UNDER }] });
    const syms = (sc.symbols || []).map(x => x.s);
    const q = await tvQuotes([...syms, 'COMEX:GC1!'], ['lp', 'volume', 'bid', 'ask', 'oi']);
    const F = q['COMEX:GC1!'] && Number(q['COMEX:GC1!'].lp);
    if (isFinite(F) && F > 0) s.F = F;
    (sc.symbols || []).forEach(x => {
      const [k, type, iv, d, g, bid, ask] = x.f, qq = q[x.s] || {};
      const prev = s.rows[x.s];
      const acc = qq.volume !== undefined ? accumulate(prev, { ...qq, bid: qq.bid ?? bid, ask: qq.ask ?? ask }) : (prev ? { vol: prev.vol, buy: prev.buy, sell: prev.sell } : { vol: 0, buy: 0, sell: 0 });
      const oiv = qq.oi && qq.oi.value !== undefined ? Number(qq.oi.value) : (prev ? prev.oi : null), oiT = qq.oi && qq.oi.time ? qq.oi.time : (prev ? prev.oiT : null);
      s.rows[x.s] = { k, t: type === 'call' ? 'C' : 'P', iv, d, g, bid: qq.bid ?? bid, ask: qq.ask ?? ask, lp: qq.lp ?? (prev && prev.lp), oi: oiv, oiT, ...acc };
    });
    // OI จากเว็บ CME (GitHub Actions cme-oi ดึงทุกชั่วโมง → cme_oi.json) ถ้าวันเทรดใหม่กว่า OI ของ TradingView ให้ใช้ของ CME
    try {
      let cm = await this.state.storage.get('cme');
      if (!cm || now - cm.at > 10 * 60e3) {
        const j = await (await fetch('https://raw.githubusercontent.com/OI-GOLD-PRO/gold-oi-pro/main/cme_oi.json?t=' + Math.floor(now / 600e3))).json();
        cm = { at: now, d: j }; await this.state.storage.put('cme', cm);
      }
      s.oiSrc = applyCmeOI(s.rows, cm.d, c.root, c.exp) ? 'cme' : 'tv';
    } catch (e) { s.oiSrc = 'tv'; }
    // Expected Move = ราคา Straddle ของ strike ใกล้ราคาที่สุด (mid ของ Call + Put) · จำค่าแรกของแต่ละวันเทรด (เริ่ม 22:00 UTC)
    const em = straddle(Object.values(s.rows), s.F);
    if (em) {
      s.em = em.em; s.emK = em.k;
      const sess = ymdOf(now + 2 * 3600e3);
      if (s.sess !== sess && marketOpen(now)) { s.sess = sess; s.openF = s.F; s.openEM = em.em; s.openT = Math.floor(now / 1000); s.newSess = true; }
    }
    // gmf itd (สัญญาวันนี้) ฝั่งเซิร์ฟเวอร์ ไว้ให้ชีตใช้ (แอปคำนวณเองทุกนาทีด้วยราคาสด)
    if (s.F) {
      const T = Math.max((s.expTs * 1000 - now) / (365 * 864e5), 60e3 / (365 * 864e5));
      const opts = Object.values(s.rows).filter(r => r.oi > 0 && r.iv > 0).map(r => ({ k: r.k, c: r.t === 'C', oi: r.oi, iv: r.iv, T }));
      const f = gammaFlip(opts, s.F); s.itd = f.flip; s.gexItd = f.gexAtF;
    }
    // OI ของสัญญาปัจจุบันว่างทั้งหมด → ยืมจากสัญญาถัดไป (ตรวจใหม่ทุก 30 นาที)
    const hasOI = Object.values(s.rows).some(r => r.oi > 0);
    if (hasOI) { if (s.fb) delete s.fb; }
    else if (s.F && (!s.fb || s.fb.forC !== s.root + s.exp || now / 1000 - s.fb.at > 1800)) { try { s.fb = await borrowOI(now, s, s.F); } catch (e) {} }
    s.updated = Math.floor(now / 1000); s.polls = (s.polls || 0) + 1;
    const newSess = s.newSess; delete s.newSess;
    await this.state.storage.put('s', s);
    // gmf M ทุก 60 นาที (เก็บแยก key)
    let m = await this.state.storage.get('m');
    if (s.F && (!m || now / 1000 - m.at >= 3600 || m.err)) {
      try { m = await computeM(now, s.F); } catch (e) { m = { err: String(e.message || e), at: Math.floor(now / 1000) }; }
      await this.state.storage.put('m', m);
    }
    // บันทึกระดับประจำวันเทรด (ค่าตอนเปิดวัน) ให้สัญญาณย้อนหลังใช้ระดับของวันนั้นจริง
    if (newSess) await this.saveHist(s, m, false);
    await this.alerts(s, now);
    return { ok: true, root: s.root, exp: s.exp, n: syms.length, F: s.F };
  }
}
// วันเทรด CME (yyyymmdd) ของเวลาที่ TradingView อัปเดต OI: ก่อน 16:00 ชิคาโก = วันทำการก่อนหน้า (OI ปิดวันออกหลังวันจบ)
export function tvTradeDate(t) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(t * 1000)).map(x => [x.type, x.value]));
  const d = new Date(Date.UTC(+p.year, +p.month - 1, +p.day, 12));
  if (+p.hour < 16) d.setUTCDate(d.getUTCDate() - 1);
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d.setUTCDate(d.getUTCDate() - 1);
  return d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate();
}
// ใช้ OI ของ CME แทนถ้าเป็นสัญญาเดียวกันและวันเทรดใหม่กว่า (หรือ TradingView ยังไม่มี OI) · oiT ตั้งเป็น 18:30 ชิคาโกของวันเทรดนั้น (แอปแปลงกลับเป็นวันเทรดได้ตรง)
export function applyCmeOI(rows, cme, root, exp) {
  if (!cme || !cme.rows || !cme.rows.length || cme.root !== root || +cme.exp !== +exp) return false;
  const R = Object.values(rows), tvT = Math.max(0, ...R.map(r => r.oi > 0 ? r.oiT || 0 : 0));
  const cmeTD = +cme.tradeDate, tvTD = tvT ? tvTradeDate(tvT) : 0;
  if (!(cmeTD > tvTD)) return false;
  const m = new Map(cme.rows.map(([k, t, v]) => [k + t, v]));
  const y = Math.floor(cmeTD / 10000), mo = Math.floor(cmeTD / 100) % 100, d = cmeTD % 100;
  const oiT = Date.UTC(y, mo - 1, d, 23, 30) / 1000;
  R.forEach(r => { r.oi = m.get(r.k + r.t) || 0; r.oiT = oiT; });
  return true;
}
// Call Wall / Put Wall = strike ที่ gamma × OI มากสุด (Call ที่ ≥ F−10, Put ที่ ≤ F+10) แบบเดียวกับในแอป
export function walls(rows, F) {
  let cw = null, pw = null, bc = 0, bp = 0;
  if (!F) return { cw, pw };
  rows.forEach(r => {
    if (!(r.oi > 0) || Math.abs(r.k - F) > F * 0.1) return;
    const v = (r.g || 0) * r.oi;
    if (r.t === 'C' && r.k >= F - 10 && v > bc) { bc = v; cw = r.k; }
    if (r.t === 'P' && r.k <= F + 10 && v > bp) { bp = v; pw = r.k; }
  });
  return { cw, pw };
}
export function straddle(rows, F) {
  if (!F) return null;
  const by = new Map(); rows.forEach(r => { const o = by.get(r.k) || {}; o[r.t] = r; by.set(r.k, o); });
  const mid = r => { if (!r) return null; const b = Number(r.bid), a = Number(r.ask); if (isFinite(b) && isFinite(a) && a >= b && a > 0) return (a + b) / 2; const l = Number(r.lp); return isFinite(l) ? l : null; };
  const ks = [...by.keys()].filter(k => by.get(k).C && by.get(k).P).sort((a, b) => Math.abs(a - F) - Math.abs(b - F));
  for (const k of ks.slice(0, 3)) { const c = mid(by.get(k).C), p = mid(by.get(k).P); if (c !== null && p !== null) return { k, em: Math.round((c + p) * 100) / 100 }; }
  return null;
}
// Max Pain = strike ที่ผู้ถือออปชันได้เงินรวมน้อยที่สุดถ้าราคาปิดที่ strike นั้น (ใช้ OI)
export function maxPain(rows) {
  const r = rows.filter(x => x.oi > 0);
  const ks = [...new Set(r.map(x => x.k))].sort((a, b) => a - b);
  let best = null, bv = Infinity;
  for (const S of ks) {
    let v = 0;
    for (const x of r) v += x.t === 'C' ? Math.max(0, S - x.k) * x.oi : Math.max(0, x.k - S) * x.oi;
    if (v < bv) { bv = v; best = S; }
  }
  return best;
}
// ---------- OI Gold Pro Mini (จอ ESP32) ----------
// JSON ขนาดเล็กให้จอ: ราคา Gold.F สด + แท่งเทียน + ระดับประจำวัน + OI/Volume ราย strike แบบในแอป
// b = [[o,h,l,c], ...] (bs = วินาทีต่อแท่ง, bt = เวลาแท่งแรก) · c = ราคาปิด 40 แท่งล่าสุด (เผื่อเฟิร์มแวร์ v0.1)
// s = [[strike, callOI, putOI, volCall, volPut, rankCall(0=ไม่ติด 10 อันดับ), rankPut, topVol(1/0)], ...] ใกล้ราคา ±$80
// z = [strike, lo, hi, 'C'|'P'|'V', callOI, putOI] โซนแจ้งเตือน (กติกาเดียวกับแอป/Telegram)
// ---------- IV คำนวณเอง (Black-76 แบบ live.js ของแอป) ----------
// ราคา = ค่ากลาง bid/ask (spread แคบ) ไม่มีใช้ราคาล่าสุด · F = put-call parity ของ 3 strike ใกล้ราคา · IV ฝั่ง OTM (Put ใต้ F / Call เหนือ F) แบบเส้น Vol ของ CME
const NCDF = x => { const z = Math.abs(x) / Math.SQRT2, t = 1 / (1 + 0.3275911 * z), y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-z * z); return x >= 0 ? 0.5 * (1 + y) : 0.5 * (1 - y); };
const b76 = (F, K, T, sg, call) => { const v = sg * Math.sqrt(T), d1 = (Math.log(F / K) + v * v / 2) / v, d2 = d1 - v; return call ? F * NCDF(d1) - K * NCDF(d2) : K * NCDF(-d2) - F * NCDF(-d1); };
export function implVol(p, F, K, T, call) {
  const intr = Math.max(0, call ? F - K : K - F);
  if (!(p > intr + 0.02) || !(T > 0)) return null;
  let lo = 0.01, hi = 3;
  if (b76(F, K, T, hi, call) < p) return null;
  for (let i = 0; i < 60; i++) { const m = (lo + hi) / 2; if (b76(F, K, T, m, call) > p) hi = m; else lo = m; }
  return (lo + hi) / 2;
}
export function smileIV(rows, ref, T) {
  const by = new Map(); rows.forEach(r => { const o = by.get(r.k) || {}; o[r.t] = r; by.set(r.k, o); });
  const px = (k, t) => { const r = (by.get(k) || {})[t]; if (!r) return null; const b = +r.bid, a = +r.ask; if (b > 0 && a > b) { const m = (a + b) / 2; if (a - b <= Math.max(0.6, m * 0.25)) return m; } const l = +r.lp; return l > 0 ? l : null; };
  const ks = [...by.keys()].sort((a, b) => a - b);
  const par = ks.filter(k => px(k, 'C') && px(k, 'P')).sort((a, b) => Math.abs(a - ref) - Math.abs(b - ref)).slice(0, 3).map(k => k + px(k, 'C') - px(k, 'P')).sort((a, b) => a - b);
  const F = par.length ? par[Math.floor(par.length / 2)] : ref;
  const pts = [];
  ks.forEach(k => {
    if (Math.abs(k - F) > F * 0.08) return;
    const otmC = k >= F, p1 = px(k, otmC ? 'C' : 'P');
    let iv = p1 ? implVol(p1, F, k, T, otmC) : null;
    if (iv === null) { const p2 = px(k, otmC ? 'P' : 'C'); if (p2) iv = implVol(p2, F, k, T, !otmC); }
    if (iv !== null && iv > 0.02 && iv < 2.5) pts.push([k, iv]);
  });
  if (pts.length < 3) return null;
  const ivAt = x => { if (x <= pts[0][0]) return pts[0][1]; if (x >= pts[pts.length - 1][0]) return pts[pts.length - 1][1]; for (let i = 1; i < pts.length; i++) if (x <= pts[i][0]) { const [k0, v0] = pts[i - 1], [k1, v1] = pts[i]; return v0 + (v1 - v0) * (x - k0) / (k1 - k0); } return null; };
  // เส้นโค้ง smile: ถดถอยกำลังสอง iv% = a + b·d + c·d² (d = k − F) เฉพาะ strike ใกล้ราคา (±4%)
  const fp = pts.filter(([k]) => Math.abs(k - F) <= F * 0.04).map(([k, v]) => [k - F, v * 100]);
  let fit = null;
  if (fp.length >= 4) {
    const S = [0, 0, 0, 0, 0], Y = [0, 0, 0];
    fp.forEach(([d, v]) => { let p = 1; for (let i = 0; i < 5; i++) { S[i] += p; if (i < 3) Y[i] += v * p; p *= d; } });
    const M = [[S[0], S[1], S[2], Y[0]], [S[1], S[2], S[3], Y[1]], [S[2], S[3], S[4], Y[2]]];
    for (let i = 0; i < 3; i++) { let piv = i; for (let r = i + 1; r < 3; r++) if (Math.abs(M[r][i]) > Math.abs(M[piv][i])) piv = r; [M[i], M[piv]] = [M[piv], M[i]]; if (Math.abs(M[i][i]) < 1e-12) { fit = false; break; } for (let r = 0; r < 3; r++) if (r !== i) { const f = M[r][i] / M[i][i]; for (let c = i; c < 4; c++) M[r][c] -= f * M[i][c]; } }
    if (fit !== false) fit = [M[0][3] / M[0][0], M[1][3] / M[1][1], M[2][3] / M[2][2]];
    else fit = null;
  }
  return { F, pts, ivAt, fit };
}
// SD ของการกระจาย (OI หรือ Volume) ราย strike: ค่ากลางถ่วงน้ำหนัก + ส่วนเบี่ยงเบนมาตรฐาน
export function distSD(rows, F, field) {
  const by = new Map(); rows.forEach(r => { if (F && Math.abs(r.k - F) > F * 0.1) return; by.set(r.k, (by.get(r.k) || 0) + (Number(r[field]) || 0)); });
  let w = 0, m = 0; by.forEach((v, k) => { w += v; m += v * k; });
  if (!(w > 0)) return null;
  m /= w; let q = 0; by.forEach((v, k) => { q += v * (k - m) * (k - m); });
  return [Math.round(m * 10) / 10, Math.round(Math.sqrt(q / w) * 10) / 10];
}
export function strikeTable(rows, F, win = 80, ivOf = null) {
  const by = new Map();
  rows.forEach(r => { if (F && Math.abs(r.k - F) > F * 0.1) return; const o = by.get(r.k) || { k: r.k, c: 0, p: 0, vc: 0, vp: 0, ivC: null, ivP: null }; if (r.t === 'C') { o.c = r.oi || 0; o.vc += r.vol || 0; if (r.iv > 0) o.ivC = r.iv; } else { o.p = r.oi || 0; o.vp += r.vol || 0; if (r.iv > 0) o.ivP = r.iv; } by.set(r.k, o); });
  const all = [...by.values()];
  const rank = f => { const m = new Map(); all.filter(o => o[f] > 0).sort((a, b) => b[f] - a[f]).slice(0, 10).forEach((o, i) => m.set(o.k, i + 1)); return m; };
  const rC = rank('c'), rP = rank('p');
  const topV = new Set(all.filter(o => o.vc + o.vp > 0).sort((a, b) => (b.vc + b.vp) - (a.vc + a.vp)).slice(0, 5).map(o => o.k));
  return all.filter(o => !F || Math.abs(o.k - F) <= win).sort((a, b) => a.k - b.k)
    .map(o => { const iv = ivOf ? ivOf(o.k) : (F && o.k < F ? (o.ivP || o.ivC) : (o.ivC || o.ivP));  // IV ฝั่ง OTM (แบบ smile)
      return [o.k, Math.round(o.c), Math.round(o.p), Math.round(o.vc), Math.round(o.vp), rC.get(o.k) || 0, rP.get(o.k) || 0, topV.has(o.k) ? 1 : 0, iv ? Math.round(iv * 1000) : 0]; });  // [8] = IV % × 10
}
// ATM IV (%) = เฉลี่ย IV Call/Put ของ strike ใกล้ราคาที่สุดที่มี IV
export function atmIv(rows, F) {
  if (!F) return null;
  const by = new Map(); rows.forEach(r => { if (r.iv > 0) { const a = by.get(r.k) || []; a.push(r.iv); by.set(r.k, a); } });
  const ks = [...by.keys()].sort((a, b) => Math.abs(a - F) - Math.abs(b - F));
  if (!ks.length) return null;
  const a = by.get(ks[0]); return Math.round(a.reduce((x, y) => x + y, 0) / a.length * 1000) / 10;
}
// Dealer รับ/ไล่ (แบบ dealer.js ในแอป แต่ไม่มีส่วน Big Traders): gamma เทียบ flip + แรงตรึง strike OI หนา × ใกล้หมดอายุ × ความหนาแน่น vol/OI
export function dealerScore(rows, P, flip, em, expTs, nowMs) {
  if (!P) return null;
  em = em > 0 ? em : 25;
  const parts = [];
  if (flip) parts.push({ v: Math.tanh((P - flip) / Math.max(3, em * 0.25)), w: 0.4 });
  const by = new Map(); rows.forEach(r => { const o = by.get(r.k) || { k: r.k, oi: 0, vol: 0 }; o.oi += r.oi || 0; o.vol += r.vol || 0; by.set(r.k, o); });
  const all = [...by.values()], maxAll = Math.max(1, ...all.map(o => o.oi));
  const near = all.filter(o => Math.abs(o.k - P) <= em && o.oi > 0).sort((a, b) => b.oi - a.oi);
  if (near.length) {
    const top = near[0], d = Math.abs(top.k - P), prox = Math.exp(-Math.pow(d / 5, 2)), size = Math.min(1, top.oi / maxAll);
    const hrs = expTs ? (expTs * 1000 - nowMs) / 3600e3 : 24, tf = hrs <= 0 ? 0 : hrs <= 6 ? 1 : hrs <= 24 ? 0.6 : 0.3;
    parts.push({ v: prox * size * tf, w: 0.25 });
  }
  if (!parts.length) return null;
  let S = parts.reduce((a, p) => a + p.w * p.v, 0) / parts.reduce((a, p) => a + p.w, 0);
  const n10 = all.filter(o => Math.abs(o.k - P) <= 10), oi10 = n10.reduce((a, o) => a + o.oi, 0), vol10 = n10.reduce((a, o) => a + o.vol, 0);
  if (oi10 > 0) S *= Math.max(0.6, Math.min(1.3, 0.6 + vol10 / oi10));
  S = Math.max(-1, Math.min(1, S));
  return [Math.round(S * 100), S >= 0.2 ? 'A' : S <= -0.2 ? 'C' : 'N'];  // A = รับ (absorb), C = ไล่ (chase), N = กลาง
}
export function miniPayload(s, gf, nowSec, bs = 60, off = null) {
  const r1 = x => x == null || !isFinite(x) ? null : Math.round(x * 10) / 10;
  const last = gf && gf.length ? gf[gf.length - 1] : null;
  const p = last ? last[4] : (s && s.F) || null;
  let rows = s ? Object.values(s.rows || {}) : [];
  const ivT = s && s.expTs ? Math.max((s.expTs - (s.updated || nowSec)) / (365 * 86400), 60 / (365 * 86400)) : null;  // เวลาถึงหมดอายุ ณ เวลาที่ได้ราคาออปชัน
  const sm = ivT && rows.length && (s.F || (gf && gf.length)) ? smileIV(rows, s.F || gf[gf.length - 1][4], ivT) : null;
  if (!rows.some(x => x.oi > 0) && s && s.fb) rows = rows.concat(s.fb.rows.map(([k, t, oi]) => ({ k, t, oi, vol: 0 })));
  const ref = p || (s && s.F);
  const w = walls(rows, ref);
  const zones = s ? alertZones(rows, ref) : [];
  const z = zones.sort((a, b) => Math.abs(a.k - ref) - Math.abs(b.k - ref)).slice(0, 12).sort((a, b) => a.k - b.k)
    .map(o => [o.k, o.lo, o.hi, o.side.indexOf('Call') >= 0 ? 'C' : o.side.indexOf('Put') >= 0 ? 'P' : 'V', o.c || 0, o.p || 0]);
  const m = s && s.m;
  const g = gf || [], b = g.slice(-120), c1 = bs === 60 ? g.slice(-40) : [];
  return {
    v: 2, now: nowSec,
    p: r1(p), pt: last ? last[0] : null,
    bs, bt: b.length ? b[0][0] : null, lt: b.length ? b[b.length - 1][0] : null,
    off: off && off.offset != null ? off.offset : null, // ราคาสด = Bybit XAUUSDT + off (median 5 แท่ง 1 นาที Gold.F − Bybit)
    b: b.map(x => [r1(x[1]), r1(x[2]), r1(x[3]), r1(x[4])]),
    c: c1.map(x => r1(x[4])), ct: c1.length ? c1[0][0] : null,
    F: r1(s && s.F), open: r1(s && s.openF), em: r1(s && s.openEM),
    itd: r1(s && s.itd), gm: r1(m && m.M), mp: maxPain(rows), cw: w.cw, pw: w.pw,
    exp: s && s.expTs ? bkk(s.expTs).slice(5) : null, root: s ? s.root : null,
    upd: s ? s.updated || null : null, mkt: marketOpen(nowSec * 1000),
    s: ref ? strikeTable(rows, ref, 80, sm ? (k => { const p = sm.pts.find(x => x[0] === k); return p ? p[1] : null; }) : null) : [],
    iv: sm ? r1(sm.ivAt(sm.F) * 100) : (ref ? atmIv(rows, ref) : null),   // ATM IV % (คำนวณเองจากราคาออปชัน แบบแอป)
    sm: sm && sm.fit ? [r1(sm.F), +sm.fit[0].toFixed(3), +sm.fit[1].toFixed(5), +sm.fit[2].toFixed(7)] : null,  // เส้นโค้ง IV: iv% = a + b·(k−F) + c·(k−F)²
    os: ref ? distSD(rows, ref, 'oi') : null,   // [ค่ากลาง, SD] ของ OI ราย strike
    vs: ref ? distSD(rows, ref, 'vol') : null,  // [ค่ากลาง, SD] ของ Volume วันนี้
    sd: (() => { const o = ref ? distSD(rows, ref, 'oi') : null; return o ? o[1] : null; })(),  // 1 SD ของ OI (ผู้ใช้กำหนด)
    dl: ref && s ? dealerScore(rows, ref, s.itd || (m && m.M) || null, s.em || s.openEM, s.expTs, nowSec * 1000) : null,
    z,
  };
}
const MINI_TF = { '1': 60, '5': 300, '15': 900, '60': 3600 };
// ข่าวแดง USD 3 รายการถัดไปภายใน 24 ชม. → [[วินาที, ชื่อ ≤28 ตัว ASCII], ...] (จอไม่มีฟอนต์ไทย)
export function miniNews(events, nowMs) {
  return (events || []).filter(e => e.c === 'USD' && (e.i || 'H') === 'H').map(e => ({ ms: Date.parse(e.date), t: String(e.title || '') }))
    .filter(e => isFinite(e.ms) && e.ms > nowMs - 5 * 60e3 && e.ms - nowMs <= 24 * 3600e3).sort((a, b) => a.ms - b.ms).slice(0, 3)
    .map(e => [Math.floor(e.ms / 1000), e.t.replace(/[^\x20-\x7e]/g, '').slice(0, 28)]);
}
async function newsEvents() {
  const ck = new Request('https://cache.local/news'), cache = caches.default;
  const hit = await cache.match(ck); if (hit) return (await hit.json()).events || [];
  try {
    const r = await fetch('https://raw.githubusercontent.com/OI-GOLD-PRO/gold-oi-pro/main/news.json?t=' + Math.floor(Date.now() / 600e3));
    if (!r.ok) return [];
    const j = await r.json();
    await cache.put(ck, new Response(JSON.stringify({ events: j.events || [] }), { headers: { 'cache-control': 'public, max-age=600' } }));
    return j.events || [];
  } catch (e) { return []; }
}
// ผลวิเคราะห์ dashboard (ds) แบบย่อสำหรับจอ: เฉพาะตัวเลข (ข้อความไทยแสดงบนจอไม่ได้)
export function miniDash(A) {
  if (!A) return null;
  return { u: String(A.updated || '').replace(/[^\x20-\x7e]/g, '').slice(0, 20), tr: A.trend || 'side', sc: Math.max(-100, Math.min(100, Math.round(Number(A.score) || 0))),
    g: Math.max(0, Math.min(100, Math.round(Number(A.gauge) || 50))),
    lv: (A.levels || []).map(l => [Number(l.p), String(l.k || '').slice(0, 1), Math.max(1, Math.min(3, Number(l.s) || 1))]).filter(l => isFinite(l[0])).sort((a, b) => b[0] - a[0]).slice(0, 8) };
}
const SHEET_API = 'https://script.google.com/macros/s/AKfycbwQrp29KWhUCVO0ojjS73SiLtDKe1QKx69KOOF90QQOlV3csHXqxfOGUYKYw2D6nZp0tw/exec';
// ---------- รหัสเข้าจอ = รหัสเข้าแอป OI Gold Pro (ตรวจกับ Apps Script ?api=login · แคช 10 นาที) ----------
const ascii = (x, n) => String(x == null ? '' : x).replace(/[^\x20-\x7e]/g, '').slice(0, n);
async function sha16(t) { const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(t)); return [...new Uint8Array(h)].slice(0, 16).map(b => b.toString(16).padStart(2, '0')).join(''); }
export async function checkCode(code, fetcher = fetch) {
  code = String(code || '').trim();
  if (!code || code.length > 64) return { ok: false, reason: 'missing' };
  const hasCache = typeof caches !== 'undefined';
  const ck = hasCache ? new Request('https://cache.local/login/' + await sha16(code)) : null;
  if (hasCache) { const hit = await caches.default.match(ck); if (hit) return hit.json(); }
  let j;
  try { const r = await fetcher(`${SHEET_API}?api=login&code=${encodeURIComponent(code)}&t=${Date.now()}`); j = JSON.parse(await r.text()); }
  catch (e) { return { ok: false, reason: 'server' }; }  // ไม่แคชตอนเซิร์ฟเวอร์ล่ม
  const out = { ok: !!(j && (j.ok || j.legacy)), reason: ascii(j && j.reason, 20), exp: ascii(j && j.expire, 24) };
  if (hasCache) await caches.default.put(ck, new Response(JSON.stringify(out), { headers: { 'cache-control': `public, max-age=${out.ok ? 600 : 120}` } }));
  return out;
}
// ลองตามที่พิมพ์ แล้วตัวพิมพ์ใหญ่/เล็ก (แบบหน้า login ของแอป)
export async function loginCode(code, fetcher = fetch) {
  code = String(code || '').trim();
  let res = await checkCode(code, fetcher), used = code;
  for (const alt of [code.toUpperCase(), code.toLowerCase()]) {
    if (res.ok || res.reason === 'expired' || res.reason === 'server' || alt === used) continue;
    const r2 = await checkCode(alt, fetcher);
    if (r2.ok || r2.reason === 'expired') { res = r2; used = alt; }
  }
  return { ...res, code: res.ok ? used : '' };
}

const marketOpen = now => { const d = new Date(now), wd = d.getUTCDay(), h = d.getUTCHours(); if (wd === 6) return false; if (wd === 0 && h < 22) return false; if (wd === 5 && h >= 22) return false; return true; };

export default {
  async scheduled(event, env, ctx) {
    if (!env.OPT || !marketOpen(Date.now())) return;
    const stub = env.OPT.get(env.OPT.idFromName('main'));
    ctx.waitUntil(stub.fetch('https://do/poll'));
    ctx.waitUntil(env.OPT.get(env.OPT.idFromName('retail')).fetch('https://do/rtpoll').catch(() => {}));
  },
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });
    const url = new URL(request.url);
    if (url.pathname === '/mix') {
      // แท่งรวม 3 แหล่ง (median) · แคชร่วม 2 วินาที → ทุกเครื่องได้ชุดเดียวกัน
      const tf = url.searchParams.get('tf') || '5m', nb = mixN(Math.max(1, +url.searchParams.get('n') || 500));
      const H = { ...CORS, 'content-type': 'application/json', 'cache-control': 'public, max-age=2' };
      if (!MIX_TF[tf]) return new Response(JSON.stringify({ error: 'bad tf' }), { status: 400, headers: H });
      const ck = new Request(`${url.origin}/mix?tf=${tf}&n=${nb}`), cache = caches.default;
      const hit = await cache.match(ck); if (hit) return hit;
      const rs = await Promise.allSettled(MIX_SRC.map(s => tvBars(s, MIX_TF[tf], nb, 8000)));
      // V4.9.29: แหล่งไหนดึงไม่ได้รอบนี้ (TradingView ตอบ 4xx เป็นพัก ๆ) → ใช้แท่งล่าสุดที่เคยได้ของแหล่งนั้น (ไม่เกิน 3 นาที) ค่ากลางจะไม่กระโดด
      const now = Date.now();
      rs.forEach((r, i) => { const k = MIX_SRC[i] + '|' + tf + '|' + nb; if (r.status === 'fulfilled' && r.value && r.value.length) MIX_LAST.set(k, { at: now, v: r.value }); else { const L = MIX_LAST.get(k); if (L && now - L.at < 180e3) rs[i] = { status: 'fulfilled', value: L.v, stale: true }; } });
      const ok = []; rs.forEach((r, i) => { if (r.status === 'fulfilled' && r.value && r.value.length) ok.push(i); });
      if (!ok.length) return new Response(JSON.stringify({ error: 'no source' }), { status: 502, headers: H });
      const bars = mixBars(ok.map(i => rs[i].value)).slice(-nb);
      const res = new Response(JSON.stringify({ tf, src: ok.map(i => MIX_SRC[i].split(':')[0]), stale: ok.filter(i => rs[i].stale).map(i => MIX_SRC[i].split(':')[0]), updated: Math.floor(Date.now() / 1000), bars }), { headers: H });
      await cache.put(ck, res.clone());
      return res;
    }
    if (url.pathname === '/rtpush' && request.method === 'POST') {
      const H = { ...CORS, 'content-type': 'application/json', 'cache-control': 'no-store' };
      if (!env || !env.OPT) return new Response('{}', { status: 500, headers: H });
      const body = await request.text(); if (body.length > 1.5e6) return new Response('{"error":"too big"}', { status: 413, headers: H });
      const r = await env.OPT.get(env.OPT.idFromName('retail')).fetch('https://do/rtpush', { method: 'POST', body });
      return new Response(await r.text(), { headers: H });
    }
    if (url.pathname === '/gexlog') {
      const H = { ...CORS, 'content-type': 'application/json', 'cache-control': 'no-store' };
      if (!env || !env.OPT) return new Response('{}', { status: 500, headers: H });
      const r = await env.OPT.get(env.OPT.idFromName('gex')).fetch('https://do/gexlog', request.method === 'POST' ? { method: 'POST', body: (await request.text()).slice(0, 5000) } : undefined);
      return new Response(await r.text(), { headers: H });
    }
    if (url.pathname === '/retail' || url.pathname === '/trapfz') {
      const H = { ...CORS, 'content-type': 'application/json', 'cache-control': 'no-store' };
      if (!env || !env.OPT) return new Response('{}', { status: 500, headers: H });
      const stub = env.OPT.get(env.OPT.idFromName('retail'));
      const r = url.pathname === '/retail' ? await stub.fetch('https://do/rt' + (url.searchParams.get('poll') ? 'poll' : '') + (url.searchParams.get('win') ? '?win=' + encodeURIComponent(url.searchParams.get('win')) + (url.searchParams.get('rt') === '1' ? '&rt=1' : '') : ''))
        : await stub.fetch('https://do/trapfz', request.method === 'POST' ? { method: 'POST', body: await request.text() } : undefined);
      return new Response(await r.text(), { headers: H });
    }
    if (url.pathname === '/gf') {
      // แท่ง 1 นาทีล่าสุดของ Gold.F (BlackBull, เรียลไทม์) ให้แอปจับคู่กับ perp ของตัวเอง · แคช 20 วินาที
      const ck = new Request(url.origin + '/gf'), cache = caches.default;
      const hit = await cache.match(ck); if (hit) return hit;
      try {
        const gf = await tvBars('BLACKBULL:GOLD.F', '1', 40);
        const res = new Response(JSON.stringify({ symbol: 'BLACKBULL:GOLD.F', updated: Math.floor(Date.now() / 1000), bars: gf.map(b => [b[0], b[1], b[2], b[3], b[4]]) }), { headers: { ...CORS, 'content-type': 'application/json', 'cache-control': 'public, max-age=20' } });
        await cache.put(ck, res.clone());
        return res;
      } catch (e) { return new Response(JSON.stringify({ error: String(e.message || e) }), { status: 502, headers: { ...CORS, 'content-type': 'application/json' } }); }
    }
    if (url.pathname.startsWith('/mini/')) {
      const J = (o, st = 200) => new Response(JSON.stringify(o), { status: st, headers: { ...CORS, 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
      if (!env || !env.OPT) return J({ error: 'no OPT binding' }, 500);
      const stub = env.OPT.get(env.OPT.idFromName('main'));
      if (url.pathname === '/mini/login') return J(await loginCode(url.searchParams.get('code')));  // จอตรวจรหัสตอนผู้ใช้พิมพ์
      if (url.pathname === '/mini/flash') return new Response(MINI_FLASH_PAGE, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=300' } });
      if (url.pathname === '/mini/flash/manifest.json') {
        let v = null; try { v = (await (await fetch('https://raw.githubusercontent.com/OI-GOLD-PRO/gold-oi-trade/main/mini/dist/version.json?t=' + Math.floor(Date.now() / 300e3))).json()).v; } catch (e) {}
        return J(MINI_MANIFEST(v));
      }
      if (url.pathname === '/mini/dash') {
        const uc = String(url.searchParams.get('code') || '').trim();
        { const c = await checkCode(uc); if (!c.ok) return J({ error: 'auth', reason: c.reason }, c.reason === 'server' ? 503 : 401); }
        // อ่านชีตด้วยรหัสของจอเอง (ผ่านการตรวจแล้ว) ก่อน · ถ้าชีตไม่รับ ลอง DASH_CODE (ถ้าตั้งไว้)
        const codes = [uc, env.DASH_CODE].filter((v, i, a) => v && a.indexOf(v) === i);
        const ck = new Request(url.origin + '/mini/dash'), cache = caches.default;
        const hit = await cache.match(ck); if (hit) return hit;
        try {
          let d = null, why = '';
          for (const [i, sc] of codes.entries()) {
            const r = await fetch(`${SHEET_API}?api=data&sym=gold&code=${encodeURIComponent(sc)}&t=${Date.now()}`);
            let j; try { j = JSON.parse(await r.text()); } catch (e) { why = 'sheet HTTP ' + r.status; continue; }
            if (j.error) { why = 'sheet ' + ascii(j.error, 16) + (i ? ' (DASH_CODE)' : ' (code)'); continue; }
            d = j; break;
          }
          if (!d) return J({ error: why || 'sheet error' });
          let A = null; try { A = d.cfg && d.cfg.dash ? JSON.parse(d.cfg.dash) : null; } catch (e) {}
          const out = miniDash(A);
          if (!out) return J({ error: 'no dash' });
          const res = new Response(JSON.stringify(out), { headers: { ...CORS, 'content-type': 'application/json', 'cache-control': 'public, max-age=300' } });
          await cache.put(ck, res.clone());
          return res;
        } catch (e) { return J({ error: String(e.message || e) }, 502); }
      }
      return J({ error: 'not found' }, 404);
    }
    if (url.pathname === '/mini') {
      // จอ OI Gold Pro Mini · แคช 15 วินาที (หลายจอเรียกพร้อมกันได้ไม่หนัก)
      const tf = MINI_TF[url.searchParams.get('tf')] ? url.searchParams.get('tf') : '1';
      // ต้องมีรหัสเข้าแอปที่ยังใช้ได้ (code=…) · ตรวจกับชีตเดียวกับแอป แคช 10 นาที
      { const c = await checkCode(url.searchParams.get('code')); if (!c.ok) return new Response(JSON.stringify({ error: 'auth', reason: c.reason }), { status: c.reason === 'server' ? 503 : 401, headers: { ...CORS, 'content-type': 'application/json' } }); }
      const ck = new Request(url.origin + '/mini?tf=' + tf), cache = caches.default;
      const hit = await cache.match(ck); if (hit) return hit;
      const hdr = { ...CORS, 'content-type': 'application/json', 'cache-control': 'public, max-age=15' };
      try {
        let s = null;
        if (env && env.OPT) { s = await (await env.OPT.get(env.OPT.idFromName('main')).fetch('https://do/get')).json(); }
        const [a, b1, pp, nw] = await Promise.allSettled([tvBars('BLACKBULL:GOLD.F', tf, 120), tf === '1' ? Promise.resolve(null) : tvBars('BLACKBULL:GOLD.F', '1', 12), tvBars('BYBIT:XAUUSDT.P', '1', 12), newsEvents()]);
        let gf = a.status === 'fulfilled' ? a.value : null;
        // แท่ง Gold.F ดึงไม่ได้ชั่วคราว → ลองใหม่ 1 ครั้ง · ยังไม่ได้ → ใช้แท่งชุดล่าสุดที่เก็บไว้ (1 ชม.) · ได้ → เก็บไว้
        const lk = new Request(url.origin + '/mini/lastbars?tf=' + tf);
        if (!gf || !gf.length) { try { gf = await tvBars('BLACKBULL:GOLD.F', tf, 120, 8000); } catch (e) { gf = null; } }
        let stale = false;
        if (gf && gf.length) await cache.put(lk, new Response(JSON.stringify(gf), { headers: { 'cache-control': 'public, max-age=3600' } }));
        else { const lb = await cache.match(lk); if (lb) { try { gf = await lb.json(); stale = true; } catch (e) {} } }
        const g1 = tf === '1' ? gf : (b1.status === 'fulfilled' ? b1.value : null);
        const nowS = Math.floor(Date.now() / 1000);
        const off = g1 && pp.status === 'fulfilled' && pp.value ? liveOffset(g1, pp.value, nowS) : null;
        const pl = miniPayload(s, gf, nowS, MINI_TF[tf], off);
        pl.nx = nw.status === 'fulfilled' ? miniNews(nw.value, Date.now()) : [];
        if (stale || !pl.b.length) pl.bst = 1;  // แท่งเก่าจากที่เก็บไว้/ไม่มีแท่ง: แคชสั้น ให้รอบหน้าลองใหม่
        const res = new Response(JSON.stringify(pl), { headers: pl.bst ? { ...hdr, 'cache-control': 'public, max-age=3' } : hdr });
        await cache.put(ck, res.clone());
        return res;
      } catch (e) { return new Response(JSON.stringify({ error: String(e.message || e) }), { status: 502, headers: { ...CORS, 'content-type': 'application/json' } }); }
    }
    if (url.pathname === '/px') {
      try {
        const [gf, pp] = await Promise.all([tvBars('BLACKBULL:GOLD.F'), tvBars('BYBIT:XAUUSDT.P', '1', 3500)]);
        const lo = levelOffset(gf, pp), last = gf[gf.length - 1], lv = liveOffset(gf, pp, Math.floor(Date.now() / 1000));
        // offset หลัก = แบบสด (median 5 นาที Gold.F − Bybit) · แบบจุดตัด 00/25/50/75 เก็บไว้ใน offset_level
        const out = { gc_price: last[4], gc_time: bkk(last[0]), offset: lv ? lv.offset : (lo ? lo.offset : null), ref_price: lv ? lv.pp : (lo ? lo.ref : null), ref_symbol: 'Bybit XAUUSDT', method: lv ? 'live median 5m Gold.F-Bybit' : 'level cross',
          pair_time: lv ? bkk(lv.t) : null, offset_level: lo ? lo.offset : null, level: lo ? lo.level : null, cross_time: lo ? bkk(lo.t) : null, offset_time: bkk(Math.floor(Date.now() / 1000)) };
        return new Response(JSON.stringify(out), { headers: { ...CORS, 'content-type': 'application/json', 'cache-control': 'public, max-age=60' } });
      } catch (e) { return new Response(JSON.stringify({ error: String(e.message || e) }), { status: 502, headers: { ...CORS, 'content-type': 'application/json' } }); }
    }
    if (url.pathname === '/push/key' || url.pathname === '/push/sub' || url.pathname === '/push/test') {
      if (!env || !env.OPT) return new Response('{}', { status: 500, headers: CORS });
      const stub = env.OPT.get(env.OPT.idFromName('main')), path = url.pathname.slice(6);
      const r = request.method === 'POST' ? await stub.fetch('https://do/push' + path, { method: 'POST', body: await request.text() }) : await stub.fetch('https://do/pushkey');
      return new Response(await r.text(), { headers: { ...CORS, 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
    }
    if (url.pathname === '/tg/link' || url.pathname === '/tg/test') {
      if (!env || !env.OPT) return new Response('{}', { status: 500 });
      const r = await env.OPT.get(env.OPT.idFromName('main')).fetch('https://do/' + (url.pathname === '/tg/link' ? 'tglink' : 'tgtest'));
      return new Response(await r.text(), { headers: { ...CORS, 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
    }
    if (url.pathname === '/contracts') {
      const l = await listContracts(Date.now());
      return new Response(JSON.stringify(l.map(c => ({ ...c, monthly: isMonthly(c.root), exp_th: bkk(c.expTs) }))), { headers: { ...CORS, 'content-type': 'application/json', 'cache-control': 'public, max-age=300' } });
    }
    if (url.pathname === '/levels') {
      // ระดับประจำวันเทรดย้อนหลัง (sess = วันที่เริ่ม 05:00 น. ไทย)
      if (!env || !env.OPT) return new Response(JSON.stringify({ error: 'no OPT binding' }), { status: 500, headers: { ...CORS, 'content-type': 'application/json' } });
      const h = await (await env.OPT.get(env.OPT.idFromName('main')).fetch('https://do/hist')).json();
      return new Response(JSON.stringify({ hist: h }), { headers: { ...CORS, 'content-type': 'application/json', 'cache-control': 'public, max-age=300' } });
    }
    if (url.pathname === '/opt' || url.pathname === '/opt/poll') {
      if (!env || !env.OPT) return new Response(JSON.stringify({ error: 'no OPT binding' }), { status: 500, headers: { ...CORS, 'content-type': 'application/json' } });
      const stub = env.OPT.get(env.OPT.idFromName('main'));
      let r = await stub.fetch('https://do' + (url.pathname === '/opt/poll' ? '/poll' : '/get'));
      let s = await r.json();
      if (url.pathname === '/opt' && (!s || !s.updated)) { await stub.fetch('https://do/poll'); s = await (await stub.fetch('https://do/get')).json(); }
      if (url.pathname === '/opt/poll') return new Response(JSON.stringify(s), { headers: { ...CORS, 'content-type': 'application/json' } });
      const F = s && s.F, rows = s ? Object.values(s.rows).filter(x => !F || Math.abs(x.k - F) <= F * 0.1).sort((a, b) => a.k - b.k || (a.t < b.t ? -1 : 1))
        .map(x => [x.k, x.t, x.iv == null ? null : +x.iv.toFixed(4), x.d == null ? null : +x.d.toFixed(4), x.g == null ? null : +x.g.toPrecision(4), x.bid ?? null, x.ask ?? null, x.lp ?? null, x.vol || 0, Math.round(x.buy || 0), Math.round(x.sell || 0), x.oi ?? null]) : [];
      const pick = k => s ? s[k] ?? null : null;
      const oiT = s ? Math.max(0, ...Object.values(s.rows).map(x => x.oiT || 0)) || null : null;
      return new Response(JSON.stringify({ root: pick('root'), exp: pick('exp'), expTs: pick('expTs'), F, updated: pick('updated'), polls: pick('polls'), em: pick('em'), emK: pick('emK'), sess: pick('sess'), openF: pick('openF'), openEM: pick('openEM'), openT: pick('openT'), itd: pick('itd'), gexItd: pick('gexItd'), oiT, oiSrc: pick('oiSrc'), gmfM: s && s.m ? s.m : null, oiFb: s && s.fb ? s.fb : null, rows }), { headers: { ...CORS, 'content-type': 'application/json', 'cache-control': 'public, max-age=30' } });
    }
    const tf = new URL(request.url).searchParams.get('tf') || '1m';
    const plan = PLAN[tf];
    if (!plan) return new Response(JSON.stringify({ error: 'bad tf' }), { status: 400, headers: { ...CORS, 'content-type': 'application/json' } });
    try {
      let bars = await yahoo(plan[0], plan[1]);
      if (tf === '4h') bars = agg4h(bars);
      return new Response(JSON.stringify({ symbol: 'GC=F', updated: Math.floor(Date.now() / 1000), bars: { [tf]: bars } }), { headers: { ...CORS, 'content-type': 'application/json' } });
    } catch (e) {
      return new Response(JSON.stringify({ error: String(e.message || e) }), { status: 502, headers: { ...CORS, 'content-type': 'application/json' } });
    }
  },
};

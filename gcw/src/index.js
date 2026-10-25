// Worker: ดึงแท่งราคา GC=F (ทองฟิวเจอร์) จาก Yahoo ให้แอป OI Gold Pro เรียกตรง (เปิด CORS) ไม่ต้องรอ GitHub Actions
// GET /?tf=1m|5m|15m|30m|1h|4h|1d   ->   {"symbol":"GC=F","updated":<วินาที>,"bars":{"<tf>":[[t,o,h,l,c],...]}}   (t = วินาที)
const PLAN = {
  '1m': ['1m', '1d'], '5m': ['5m', '5d'], '15m': ['15m', '15d'], '30m': ['30m', '30d'],
  '1h': ['60m', '60d'], '4h': ['60m', '60d'], '1d': ['1d', '1y'],
};
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, OPTIONS', 'cache-control': 'public, max-age=15' };

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
        const o = q.open[i], h = q.high[i], l = q.low[i], c = q.close[i];
        if (o == null || h == null || l == null || c == null) return;
        out.push([t, +o.toFixed(2), +h.toFixed(2), +l.toFixed(2), +c.toFixed(2)]);
      });
      if (out.length) return out;
      lastErr = host + ' empty';
    } catch (e) { lastErr = host + ' ' + (e.message || e); }
  }
  throw new Error(lastErr);
}

export function agg4h(b1h) {
  const m = new Map();
  for (const [t, o, h, l, c] of b1h) {
    const k = Math.floor(t / 14400) * 14400, r = m.get(k);
    if (!r) m.set(k, [k, o, h, l, c]); else { r[2] = Math.max(r[2], h); r[3] = Math.min(r[3], l); r[4] = c; }
  }
  return [...m.keys()].sort((a, b) => a - b).map(k => m.get(k));
}

// ---------- ออปชันทองสัญญาที่หมดอายุวันนั้น จาก TradingView (ช้า 10 นาที) ----------
// cron ทุก 2 นาที → Durable Object "OptState" ดึง IV/greeks (scanner) + volume/ราคาล่าสุด/bid/ask (quote stream)
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
async function pickContract(now) {
  const from = ymdOf(now - 864e5), to = ymdOf(now + 12 * 864e5);
  const j = await tvScanRaw({ columns: ['root', 'expiration'], filter: [{ left: 'type', operation: 'equal', right: 'option' }, { left: 'expiration', operation: 'in_range', right: [from, to] }], ignore_unknown_fields: false, index_filters: [{ name: 'underlying_symbol', values: UNDER }] });
  const seen = new Map();
  (j.symbols || []).forEach(x => { const [root, exp] = x.f; const k = root + '|' + exp; if (!seen.has(k)) seen.set(k, { root, exp, expTs: expiryTs(exp) }); });
  return [...seen.values()].filter(c => c.expTs * 1000 > now).sort((a, b) => a.expTs - b.expTs)[0] || null;
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

export class OptState {
  constructor(state, env) { this.state = state; this.env = env; }
  async fetch(req) {
    const u = new URL(req.url);
    if (u.pathname === '/hist') {
      let h = (await this.state.storage.get('hist') || []).filter(x => marketOpen(x.openT * 1000));
      if (!h || !h.length) { const s = await this.state.storage.get('s'); h = await this.saveHist(s, await this.state.storage.get('m'), true) || []; }
      return new Response(JSON.stringify(h));
    }
    if (u.pathname === '/poll') { const r = await this.poll(); return new Response(JSON.stringify(r)); }
    const s = await this.state.storage.get('s');
    if (s) s.m = await this.state.storage.get('m') || null;
    return new Response(JSON.stringify(s || null));
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
    let c = s && s.expTs * 1000 > now ? { root: s.root, exp: s.exp, expTs: s.expTs } : await pickContract(now);
    if (!c) return { err: 'no contract' };
    // เปลี่ยนสัญญา (หลังหมดอายุ ~01:30 น.) ให้คงค่าเปิดวันเทรดเดิมไว้ ไม่เริ่มกรอบ EM ใหม่กลางวัน
    if (!s || s.root !== c.root || s.exp !== c.exp) s = { ...c, rows: {}, polls: 0, ...(s ? { sess: s.sess, openF: s.openF, openEM: s.openEM, openT: s.openT } : {}) };
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
    return { ok: true, root: s.root, exp: s.exp, n: syms.length, F: s.F };
  }
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
const marketOpen = now => { const d = new Date(now), wd = d.getUTCDay(), h = d.getUTCHours(); if (wd === 6) return false; if (wd === 0 && h < 22) return false; if (wd === 5 && h >= 22) return false; return true; };

export default {
  async scheduled(event, env, ctx) {
    if (!env.OPT || !marketOpen(Date.now())) return;
    const stub = env.OPT.get(env.OPT.idFromName('main'));
    ctx.waitUntil(stub.fetch('https://do/poll'));
  },
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });
    const url = new URL(request.url);
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
      return new Response(JSON.stringify({ root: pick('root'), exp: pick('exp'), expTs: pick('expTs'), F, updated: pick('updated'), polls: pick('polls'), em: pick('em'), emK: pick('emK'), sess: pick('sess'), openF: pick('openF'), openEM: pick('openEM'), openT: pick('openT'), itd: pick('itd'), gexItd: pick('gexItd'), oiT, gmfM: s && s.m ? s.m : null, rows }), { headers: { ...CORS, 'content-type': 'application/json', 'cache-control': 'public, max-age=30' } });
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

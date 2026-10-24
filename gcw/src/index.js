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
// GET /opt → {root, exp, expTs, F, updated, polls, rows:[[k, 'C'|'P', iv, delta, gamma, bid, ask, last, vol, buy, sell], ...]}
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
export class OptState {
  constructor(state, env) { this.state = state; this.env = env; }
  async fetch(req) {
    const u = new URL(req.url);
    if (u.pathname === '/poll') { const r = await this.poll(); return new Response(JSON.stringify(r)); }
    const s = await this.state.storage.get('s');
    return new Response(JSON.stringify(s || null));
  }
  async poll() {
    const now = Date.now();
    let s = await this.state.storage.get('s');
    let c = s && s.expTs * 1000 > now ? { root: s.root, exp: s.exp, expTs: s.expTs } : await pickContract(now);
    if (!c) return { err: 'no contract' };
    if (!s || s.root !== c.root || s.exp !== c.exp) s = { ...c, rows: {}, polls: 0 };
    const sc = await tvScanRaw({ columns: ['strike', 'option-type', 'iv', 'delta', 'gamma', 'bid', 'ask'], filter: [{ left: 'type', operation: 'equal', right: 'option' }, { left: 'expiration', operation: 'equal', right: c.exp }, { left: 'root', operation: 'equal', right: c.root }], ignore_unknown_fields: false, index_filters: [{ name: 'underlying_symbol', values: UNDER }] });
    const syms = (sc.symbols || []).map(x => x.s);
    const q = await tvQuotes([...syms, 'COMEX:GC1!'], ['lp', 'volume', 'bid', 'ask']);
    const F = q['COMEX:GC1!'] && Number(q['COMEX:GC1!'].lp);
    if (isFinite(F) && F > 0) s.F = F;
    (sc.symbols || []).forEach(x => {
      const [k, type, iv, d, g, bid, ask] = x.f, qq = q[x.s] || {};
      const prev = s.rows[x.s];
      const acc = qq.volume !== undefined ? accumulate(prev, { ...qq, bid: qq.bid ?? bid, ask: qq.ask ?? ask }) : (prev ? { vol: prev.vol, buy: prev.buy, sell: prev.sell } : { vol: 0, buy: 0, sell: 0 });
      s.rows[x.s] = { k, t: type === 'call' ? 'C' : 'P', iv, d, g, bid: qq.bid ?? bid, ask: qq.ask ?? ask, lp: qq.lp ?? (prev && prev.lp), ...acc };
    });
    s.updated = Math.floor(now / 1000); s.polls = (s.polls || 0) + 1;
    await this.state.storage.put('s', s);
    return { ok: true, root: s.root, exp: s.exp, n: syms.length, F: s.F };
  }
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
    if (url.pathname === '/opt' || url.pathname === '/opt/poll') {
      if (!env || !env.OPT) return new Response(JSON.stringify({ error: 'no OPT binding' }), { status: 500, headers: { ...CORS, 'content-type': 'application/json' } });
      const stub = env.OPT.get(env.OPT.idFromName('main'));
      let r = await stub.fetch('https://do' + (url.pathname === '/opt/poll' ? '/poll' : '/get'));
      let s = await r.json();
      if (url.pathname === '/opt' && (!s || !s.updated)) { await stub.fetch('https://do/poll'); s = await (await stub.fetch('https://do/get')).json(); }
      if (url.pathname === '/opt/poll') return new Response(JSON.stringify(s), { headers: { ...CORS, 'content-type': 'application/json' } });
      const F = s && s.F, rows = s ? Object.values(s.rows).filter(x => !F || Math.abs(x.k - F) <= F * 0.06).sort((a, b) => a.k - b.k || (a.t < b.t ? -1 : 1))
        .map(x => [x.k, x.t, x.iv == null ? null : +x.iv.toFixed(4), x.d == null ? null : +x.d.toFixed(4), x.g == null ? null : +x.g.toPrecision(4), x.bid ?? null, x.ask ?? null, x.lp ?? null, x.vol || 0, Math.round(x.buy || 0), Math.round(x.sell || 0)]) : [];
      return new Response(JSON.stringify({ root: s && s.root, exp: s && s.exp, expTs: s && s.expTs, F, updated: s && s.updated, polls: s && s.polls, rows }), { headers: { ...CORS, 'content-type': 'application/json', 'cache-control': 'public, max-age=30' } });
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

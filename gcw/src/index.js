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

// ---------- ทดสอบดึงข้อมูลออปชันจาก TradingView ----------
const TVH = { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36', origin: 'https://www.tradingview.com', referer: 'https://www.tradingview.com/' };
export async function tvScan(root, exp, underlying) {
  const body = { columns: ['strike', 'option-type', 'iv', 'delta', 'gamma', 'bid', 'ask', 'theoPrice'], filter: [{ left: 'type', operation: 'equal', right: 'option' }, { left: 'expiration', operation: 'equal', right: exp }, { left: 'root', operation: 'equal', right: root }], ignore_unknown_fields: false, index_filters: [{ name: 'underlying_symbol', values: [underlying] }] };
  const r = await fetch('https://scanner.tradingview.com/options/scan2?label-product=symbols-options', { method: 'POST', headers: { ...TVH, 'content-type': 'text/plain;charset=UTF-8' }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error('scan HTTP ' + r.status);
  return r.json();
}
export async function tvQuotes(syms, fields, ms = 8000) {
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

export default {
  async fetch(request) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });
    const url = new URL(request.url);
    if (url.pathname === '/opt-test') {
      const root = url.searchParams.get('root') || 'G4M', exp = +(url.searchParams.get('exp') || 20261026), und = url.searchParams.get('u') || 'COMEX:GCZ2026';
      const res = { root, exp };
      try { const j = await tvScan(root, exp, und); res.scan = { n: j.totalCount, sample: (j.symbols || []).slice(0, 3) }; res.syms = (j.symbols || []).map(s => s.s); } catch (e) { res.scanErr = String(e.message || e); }
      try { const q = await tvQuotes((res.syms || []).slice(0, 60), ['lp', 'volume', 'bid', 'ask', 'update_mode']); res.quotes = { n: Object.keys(q).length, sample: Object.entries(q).filter(([k, v]) => v.volume).slice(0, 5) }; } catch (e) { res.wsErr = String(e.message || e); }
      delete res.syms;
      return new Response(JSON.stringify(res), { headers: { ...CORS, 'content-type': 'application/json' } });
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

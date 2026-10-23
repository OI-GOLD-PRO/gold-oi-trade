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

export default {
  async fetch(request) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });
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

import worker, { agg4h, accumulate, expiryTs } from './src/index.js';
const arr = (n, f) => Array.from({ length: n }, (_, i) => f(i));
const mk = (n, step) => ({ chart: { result: [{ timestamp: arr(n, i => 1792700000 + i * step), indicators: { quote: [{ open: arr(n, i => 4000 + i), high: arr(n, i => 4001 + i), low: arr(n, i => 3999 + i), close: arr(n, i => i === 3 ? null : 4000.5 + i) }] } }] } });
let calls = [];
globalThis.fetch = async (url) => { calls.push(url); if (url.includes('query1')) return new Response('x', { status: 429 }); return new Response(JSON.stringify(mk(10, 60))); };
let r = await worker.fetch(new Request('https://x/?tf=1m')); let j = await r.json();
console.log(r.status, r.headers.get('access-control-allow-origin'), j.bars['1m'].length, j.bars['1m'][0], calls.length);
if (r.status !== 200 || j.bars['1m'].length !== 9 || calls.length !== 2) throw new Error('1m failed');
r = await worker.fetch(new Request('https://x/?tf=4h')); j = await r.json();
console.log('4h', j.bars['4h'].length, j.bars['4h'][0]);
r = await worker.fetch(new Request('https://x/?tf=zz')); if (r.status !== 400) throw new Error('bad tf');
globalThis.fetch = async () => new Response('nope', { status: 403 });
r = await worker.fetch(new Request('https://x/?tf=5m')); if (r.status !== 502) throw new Error('502 expected'); console.log('502 ok', await r.text());
// ซื้อ/ขายสะสม
let a = accumulate(null, { volume: 10, lp: 2, bid: 1, ask: 2 }); if (a.buy !== 0 || a.vol !== 10) throw new Error('acc first');
a = accumulate(a, { volume: 15, lp: 2, bid: 1, ask: 2.2 }); if (a.buy !== 5) throw new Error('acc buy');
a = accumulate(a, { volume: 18, lp: 1.1, bid: 1, ask: 2 }); if (a.sell !== 3) throw new Error('acc sell');
a = accumulate(a, { volume: 4, lp: 1.5, bid: 1, ask: 2 }); if (a.buy !== 7 || a.sell !== 5) throw new Error('acc reset');
console.log('acc ok', a);
// เวลาหมดอายุ 12:30 ชิคาโก: 26 ต.ค. 2026 (CDT) = 17:30 UTC, 2 พ.ย. 2026 (CST) = 18:30 UTC
if (expiryTs(20261026) !== Date.UTC(2026, 9, 26, 17, 30) / 1000) throw new Error('exp cdt');
if (expiryTs(20261102) !== Date.UTC(2026, 10, 2, 18, 30) / 1000) throw new Error('exp cst');
console.log('expiry ok');
r = await worker.fetch(new Request('https://x/opt'), {}); if (r.status !== 500) throw new Error('opt without binding');
console.log('ALL OK');

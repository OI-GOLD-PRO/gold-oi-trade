import worker, { walls, agg4h, accumulate, expiryTs, straddle, gammaFlip, levelOffset, liveOffset } from './src/index.js';
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
const st = straddle([{ k: 4000, t: 'C', bid: 10, ask: 11 }, { k: 4000, t: 'P', bid: 8, ask: 9 }, { k: 4010, t: 'C', bid: 5, ask: 6 }, { k: 4010, t: 'P', bid: 13, ask: 14 }], 4003);
if (!st || st.k !== 4000 || st.em !== 19) throw new Error('straddle'); console.log('straddle ok', st);
// Put หนาด้านล่าง Call หนาด้านบน → flip อยู่ระหว่าง
const gf = gammaFlip([{ k: 3950, c: false, oi: 1000, iv: 0.2, T: 0.02 }, { k: 4050, c: true, oi: 1000, iv: 0.2, T: 0.02 }], 4000);
if (!gf.flip || gf.flip < 3980 || gf.flip > 4020) throw new Error('flip ' + gf.flip); console.log('flip ok', gf);
// แท่ง 21:36 ของ Gold.F ผ่าน 4000 (3995.88–4004.33) · perp 3992.41–4000.96 → ref 3996.58, offset 3.42
const lo = levelOffset([[100, 3997.23, 4004.33, 3995.88, 4003.53], [160, 4003.5, 4006.3, 4001.7, 4006.3]], [[100, 3994.06, 4000.96, 3992.41, 4000.09], [160, 0, 0, 0, 0]]);
if (!lo || lo.level !== 4000 || lo.offset !== 3.42) throw new Error('levelOffset ' + JSON.stringify(lo)); console.log('offset ok', lo);
const lvo = liveOffset([[0,0,0,0,4010],[60,0,0,0,4011],[120,0,0,0,4012],[180,0,0,0,4013]], [[0,0,0,0,4006],[60,0,0,0,4008],[120,0,0,0,4007.5],[180,0,0,0,4000]], 200, 5);
if (!lvo || lvo.offset !== 4 || lvo.n !== 3) throw new Error('liveOffset ' + JSON.stringify(lvo)); console.log('liveOffset ok', lvo);
const wl = walls([{ k: 4000, t: 'C', g: 0.01, oi: 500 }, { k: 4050, t: 'C', g: 0.008, oi: 900 }, { k: 3980, t: 'C', g: 0.02, oi: 900 }, { k: 3950, t: 'P', g: 0.007, oi: 1200 }, { k: 4005, t: 'P', g: 0.01, oi: 300 }], 4002);
if (wl.cw !== 4050 || wl.pw !== 3950) throw new Error('walls ' + JSON.stringify(wl)); console.log('walls ok', wl);
r = await worker.fetch(new Request('https://x/levels'), {}); if (r.status !== 500) throw new Error('levels without binding');
console.log('ALL OK');

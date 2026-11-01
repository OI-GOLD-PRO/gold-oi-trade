import worker, { loginCode, checkCode, miniNews, miniDash, maxPain, miniPayload, alertZones, evalAlerts, newsDue, alertText, walls, agg4h, accumulate, expiryTs, straddle, gammaFlip, levelOffset, liveOffset, applyCmeOI, tvTradeDate } from './src/index.js';
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
// แจ้งเตือน: โซน OI 4000 (Put อันดับ 1) · ราคาเข้าโซน → เตือนถึง · M5 ปิดต่ำกว่า 3995.5 → เบรกลง ครั้งเดียว
const zr = [{ k: 4000, t: 'P', oi: 500, vol: 10 }, { k: 4000, t: 'C', oi: 20, vol: 0 }, { k: 4050, t: 'C', oi: 300, vol: 0 }];
const zs = alertZones(zr, 4010);
if (zs.length !== 2 || zs[0].k !== 4000 || zs[0].lo !== 3997.5 || !/Put/.test(zs[0].side)) throw new Error('zones ' + JSON.stringify(zs));
const ast = {}; let am = evalAlerts(ast, zs, [[600, 0, 4012, 4008, 4010]], 1);
if (am.length) throw new Error('arm');
am = evalAlerts(ast, zs, [[660, 0, 4006, 3999, 4001], [720, 0, 4001, 3998, 3999]], 1);
if (am.length !== 1 || am[0].kind !== 'reach') throw new Error('reach ' + JSON.stringify(am));
am = evalAlerts(ast, zs, [[780, 0, 3999, 3990, 3992], [840, 0, 3993, 3990, 3991], [900, 0, 3992, 3990, 3991]], 1);
if (am.length !== 1 || am[0].kind !== 'down') throw new Error('break ' + JSON.stringify(am));
am = evalAlerts(ast, zs, [[4500, 0, 4001, 3990, 3999], [4800, 0, 3994, 3990, 3991], [5100, 0, 3992, 3990, 3990]], 1);
if (am.some(a => a.kind === 'down')) throw new Error('break twice'); console.log('alerts ok', alertText(am[0] || { kind: 'reach', z: zs[0], price: 3999 }));
const nd = newsDue([{ c: 'USD', i: 'H', date: '2026-10-28T12:30:00Z', title: 'GDP' }, { c: 'USD', i: 'M', date: '2026-10-28T12:30:00Z', title: 'x' }], Date.parse('2026-10-28T12:21:00Z'), []);
if (!nd || nd.list.length !== 1 || newsDue([{ c: 'USD', i: 'H', date: '2026-10-28T12:30:00Z' }], Date.parse('2026-10-28T12:21:00Z'), [nd.ms])) throw new Error('news'); console.log('news ok');
// Max Pain + payload จอ Mini
const mpr = [{ k: 3950, t: 'P', oi: 100 }, { k: 4000, t: 'C', oi: 50 }, { k: 4000, t: 'P', oi: 50 }, { k: 4050, t: 'C', oi: 100 }];
if (maxPain(mpr) !== 4000) throw new Error('maxPain ' + maxPain(mpr)); console.log('maxPain ok');
const ms = { root: 'G2W', expTs: Date.UTC(2026, 9, 28, 17, 30) / 1000, F: 4012, openF: 4005, openEM: 22.4, itd: 4008.3, updated: 1, m: { M: 3990.4 },
  rows: { a: { k: 4000, t: 'P', oi: 500, vol: 10, g: 0.01 }, b: { k: 4050, t: 'C', oi: 300, vol: 0, g: 0.01 } } };
const mgf = Array.from({ length: 45 }, (_, i) => [1000 + i * 60, 0, 0, 0, 4010 + i * 0.1]);
const mp = miniPayload(ms, mgf, 4000, 60, { offset: 3.2 });
if (mp.off !== 3.2 || mp.lt !== 1000 + 44 * 60) throw new Error('mini off/lt');
if (mp.p !== 4014.4 || mp.c.length !== 40 || mp.ct !== 1300 || mp.b.length !== 45 || mp.b[44][3] !== 4014.4 || mp.s.length !== 2 || mp.s[0][0] !== 4000 || mp.s[0][6] !== 1 || mp.s[0][7] !== 1 || mp.s[1][5] !== 1 || mp.mp !== 4000 || mp.gm !== 3990.4 || mp.z.length !== 2 || mp.z[0][3] !== 'P' || mp.z[1][3] !== 'C' || mp.pw !== 4000 || mp.cw !== 4050) throw new Error('mini ' + JSON.stringify(mp));
const mp0 = miniPayload(null, null, 4000); if (mp0.p !== null || mp0.z.length) throw new Error('mini empty');
console.log('mini ok', JSON.stringify(mp).length, 'bytes');
const mn = miniNews([{ c: 'USD', i: 'H', date: '2026-11-07T08:30:00-05:00', title: 'Non-Farm Employment Change' }, { c: 'USD', i: 'M', date: '2026-11-07T09:00:00-05:00', title: 'x' }, { c: 'EUR', i: 'H', date: '2026-11-07T08:00:00-05:00', title: 'y' }, { c: 'USD', i: 'H', date: '2026-11-09T08:30:00-05:00', title: 'far' }], Date.parse('2026-11-07T10:00:00Z'));
if (mn.length !== 1 || mn[0][1] !== 'Non-Farm Employment Change' || mn[0][0] !== Date.parse('2026-11-07T13:30:00Z') / 1000) throw new Error('miniNews ' + JSON.stringify(mn));
const md = miniDash({ trend: 'up', score: 140, gauge: 62, updated: '01/11 21:30 น.', levels: [{ p: 4000, k: 'S', s: 2 }, { p: 4050, k: 'R', s: 3 }] });
if (md.sc !== 100 || md.g !== 62 || md.lv[0][0] !== 4050 || md.lv[1][1] !== 'S' || /[^\x20-\x7e]/.test(md.u)) throw new Error('miniDash ' + JSON.stringify(md));
{ const { MINI_MANIFEST } = await import('./src/flash.js'); const mf = MINI_MANIFEST('0.6.0'); if (mf.builds[0].chipFamily !== 'ESP32' || !/factory\.bin$/.test(mf.builds[0].parts[0].path)) throw new Error('manifest'); }
{ // รหัสเข้าแอป: ตัวพิมพ์เล็กใหญ่ + หมดอายุ + เซิร์ฟเวอร์ล่ม
  const db = { ABC123: { ok: true, expire: '2026-12-31' }, OLD1: { ok: false, reason: 'expired' } };
  const fk = async u => { const c = new URL(u).searchParams.get('code'); return new Response(JSON.stringify(db[c] || { ok: false, reason: 'invalid' })); };
  let L = await loginCode('abc123', fk); if (!L.ok || L.code !== 'ABC123' || L.exp !== '2026-12-31') throw new Error('login case ' + JSON.stringify(L));
  L = await loginCode('old1', fk); if (L.ok || L.reason !== 'expired') throw new Error('login expired ' + JSON.stringify(L));
  L = await loginCode('zzz', fk); if (L.ok || L.reason !== 'invalid' || L.code) throw new Error('login bad');
  L = await checkCode('', fk); if (L.ok || L.reason !== 'missing') throw new Error('login empty');
  L = await checkCode('x', async () => { throw new Error('down'); }); if (L.reason !== 'server') throw new Error('login server');
  console.log('login ok'); }
console.log('mini news/dash ok');


console.log('ALL OK');

// OI จาก CME แทน TradingView เมื่อวันเทรดใหม่กว่า
{
  const tvT = Date.UTC(2026, 9, 29, 23, 20) / 1000; // อัปเดต 29 ต.ค. 18:20 ชิคาโก = วันเทรด 29 ต.ค.
  if (tvTradeDate(tvT) !== 20261029) throw new Error('tvTradeDate ' + tvTradeDate(tvT));
  const rows = { a: { k: 3990, t: 'C', oi: 0, oiT: tvT }, b: { k: 4000, t: 'P', oi: 143, oiT: tvT } };
  const cme = { root: 'G1M', exp: 20261102, tradeDate: '20261030', rows: [[3990, 'C', 517], [4000, 'P', 378]] };
  if (applyCmeOI(rows, cme, 'G1M', 20261103)) throw new Error('cme other contract');
  if (!applyCmeOI(rows, cme, 'G1M', 20261102)) throw new Error('cme not applied');
  if (rows.a.oi !== 517 || rows.b.oi !== 378 || tvTradeDate(rows.a.oiT) !== 20261030) throw new Error('cme values ' + JSON.stringify(rows));
  const rows2 = { b: { k: 4000, t: 'P', oi: 380, oiT: Date.UTC(2026, 9, 31, 1, 0) / 1000 } }; // TV วันเทรด 30 ต.ค. แล้ว
  if (applyCmeOI(rows2, cme, 'G1M', 20261102)) throw new Error('cme should not override same day');
  console.log('cme oi ok');
}

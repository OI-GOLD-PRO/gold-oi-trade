// offline drive of hub/src/auto.js: synthetic M1 bars, fake EA account that accepts OPEN/CANCEL commands
import { autoStep, newAuto } from '../hub/src/auto.js';
import * as H from '../hub/src/osf.js';
let seed = 11; const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
const GMT = 3 * 3600, OFFGC = 12.5;                              // broker = UTC+3 server time, GC − broker = +12.5
const day0T = Math.floor((Date.UTC(2026, 10, 3) / 1000 + 7 * 3600 - 6 * 3600) / 86400) * 86400 + 6 * 3600; // 06:00 Thai (T)
const utc0 = day0T - 7 * 3600;
const bars = []; let p = 4000;                                    // broker-scale bars from 05:00 to 20:00 Thai
for (let u = utc0 - 3600; u < utc0 + 14 * 3600; u += 60) {
  const o = p, c = o + (rnd() - 0.5) * 2.4 + (rnd() < 0.02 ? (rnd() - 0.5) * 12 : 0);
  bars.push({ utc: u, t: u + GMT, open: o, high: Math.max(o, c) + rnd() * .7, low: Math.min(o, c) - rnd() * .7, close: c }); p = c * .9996 + 4000 * .0004;
}
const gfAt = (u) => { const b = bars.find((x) => x.utc === u); return b ? [u, b.open + OFFGC, 0, 0, b.close + OFFGC] : null; };
const oiJson = { levels: [], cfg: { volume: '{}' } };
const vol = {}; for (let k = 3960 + OFFGC; k <= 4060 + OFFGC; k += 5) { const kk = Math.round(k / 5) * 5; oiJson.levels.push({ strike: kk, type: 'C', oi: Math.floor(rnd() * 900) }, { strike: kk, type: 'P', oi: Math.floor(rnd() * 900) }); vol[kk] = [Math.floor(rnd() * 300), Math.floor(rnd() * 300)]; }
oiJson.cfg.volume = JSON.stringify(vol);
const a = newAuto(), cfg = a.cfg; Object.assign(cfg, { mode: 'live', rr: 1.6, lotMode: 'risk', riskPct: 1, maxOpen: 3 });
const acct = { balance: 2500, orders: [], positions: [], tk: 100 };
const sent = []; let bad = 0;
const io = {
  oi: async () => oiJson, news: async () => ({ events: [] }),
  gf: async () => bars.filter((b) => b.utc + 60 <= cur).map((b) => [b.utc, b.open + OFFGC, 0, 0, b.close + OFFGC]),
  cmd: (c) => {
    sent.push(c);
    if (c.type === 'OPEN') acct.orders.push({ ticket: ++acct.tk, type: c.side + ' LIMIT', price: c.price, sl: c.sl, tp: c.tp, lots: c.lots });
    if (c.type === 'CANCEL') acct.orders = acct.orders.filter((o) => o.ticket !== c.ticket);
  },
};
let cur = 0; const cache = {};
for (let u = utc0 + 60 * 5; u < utc0 + 13 * 3600; u += 15) {
  cur = u; const now = u * 1000;
  const closed = bars.filter((b) => b.utc + 60 <= u).slice(-130);
  const last = closed[closed.length - 1], px = last.close;
  const state = { gmt_offset: GMT, account: { balance: acct.balance }, symbol: { bid: px, ask: px + 0.2, point: 0.01, spread: 20, stops_level: 0, tick_size: 0.01, tick_value: 1, vol_min: 0.01, vol_max: 0.1, vol_step: 0.01 }, orders: acct.orders, positions: acct.positions, pl: { today: 0 } };
  // limit fill simulation (touch) → becomes a position
  acct.orders = acct.orders.filter((o) => { const hit = o.type.startsWith('BUY') ? last.low <= o.price : last.high >= o.price; if (hit) acct.positions.push({ ticket: o.ticket, side: o.type.split(' ')[0], sl: o.sl, tp: o.tp, open: o.price }); return !hit; });
  state.orders = acct.orders; state.positions = acct.positions;
  await autoStep(a, { state, bars: closed.map((b) => ({ t: b.t, open: b.open, high: b.high, low: b.low, close: b.close })), cache }, io, now);
  if (acct.orders.length + acct.positions.length > cfg.maxOpen) { bad++; console.log('over maxOpen', u); }
}
const opens = sent.filter((c) => c.type === 'OPEN'), cancels = sent.filter((c) => c.type === 'CANCEL');
const keys = Object.keys(a.reg);
// every OPEN must be a legal OSF setup: price on a zone edge, SL 3 beyond far edge, lots from risk 1%
const L = a.dayLv && a.dayLv.L.map((z) => ({ ...z, p: z.p - OFFGC }));
opens.forEach((c) => {
  const ok = L.some((z) => [1, 1.5, 2].some((h) => Math.abs(c.price - (z.p + h)) < 0.011 || Math.abs(c.price - (z.p - h)) < 0.011));
  if (!ok) { bad++; console.log('open off-zone', c); }
  const R = Math.abs(c.price - c.sl), want = H.lotsFor(cfg, 2500, R, { tick_size: .01, tick_value: 1, vol_min: .01, vol_max: .1, vol_step: .01 });
  if (Math.abs(want.lots - c.lots) > 1e-9) { bad++; console.log('lots', c.lots, want.lots); }
  if (c.lots > 0.1) { bad++; }
});
const dup = new Set(); Object.entries(a.reg).forEach(([k, r]) => { if (r.status === 'filled' || r.status === 'live') { const id = k; if (dup.has(id)) bad++; dup.add(id); } });
// off mode cancels everything
cfg.mode = 'off'; a.at = 0; cur += 15; await autoStep(a, { state: { gmt_offset: GMT, account: { balance: 2500 }, symbol: {}, orders: acct.orders, positions: [], pl: {} }, bars: [], cache }, io, cur * 1000);
if (acct.orders.length) { bad++; console.log('orders left after OFF', acct.orders); }
console.log(`zones ${L ? L.length : 0} · off ${a.off} · OPEN ${opens.length} · CANCEL ${cancels.length} · reg ${keys.length} · bad ${bad}`);
console.log(a.log.slice(-6).map((l) => l.msg).join('\n'));
process.exit(bad ? 1 : 0);

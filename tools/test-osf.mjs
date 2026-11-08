// parity: hub/src/osf.js scan()/levels() vs OI Gold Pro osf.js (code extracted verbatim from the source file)
import fs from 'fs';
import * as H from '../hub/src/osf.js';
const SRC = process.env.OSF_SRC || '/home/claude/oi-gold-pro/gold-oi-pro/osf.js';
const s = fs.readFileSync(SRC, 'utf8');
const a = s.indexOf('const ARM'), b = s.indexOf('// ---------- OI ย้อนหลังรายวัน');
let code = s.slice(a, b);
// cut the news loader (needs window/fetch); keep levels/atr/scan/view
code = code.replace(/let news = \[\];[\s\S]*?setInterval\(loadNews, 10 \* 60e3\);/, '');
const O = new Function('O', 'const cfg={rr:1}; ' + code + '; return {scan, levels, sessOf, dayStart};')({ oi: null });
let seed = 7; const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
// synthetic gold: 4 trading days of M1 bars (Thai T), random walk with mean reversion round the walls
const day0 = Math.floor((Date.UTC(2026, 9, 12) / 1000 + 7 * 3600 - 6 * 3600) / 86400) * 86400 + 6 * 3600;
const B = []; let p = 4000;
for (let t = day0; t < day0 + 4 * 86400; t += 60) {
  const o = p, d = (rnd() - 0.5) * 2.2 + (rnd() < 0.01 ? (rnd() - 0.5) * 14 : 0), c = o + d;
  B.push({ time: t, open: o, high: Math.max(o, c) + rnd() * 0.8, low: Math.min(o, c) - rnd() * 0.8, close: c }); p = c * 0.9995 + 4000 * 0.0005;
}
const rows = []; for (let k = 3950; k <= 4050; k += 5) rows.push({ strike: k, price: k, c: Math.floor(rnd() * 900), p: Math.floor(rnd() * 900), vc: Math.floor(rnd() * 300), vp: Math.floor(rnd() * 300) });
let bad = 0, tot = 0, real = 0;
const L1 = O.levels(4000, rows), L2 = H.levels(4000, rows);
if (JSON.stringify(L1) !== JSON.stringify(L2)) { bad++; console.log('levels differ'); }
const news = [day0 + 8 * 3600, day0 + 86400 + 15 * 3600];
for (const N of [[], news]) {
  const r1 = O.scan(B, L1, N), r2 = H.scan(B, L2, N);
  tot += r1.length;
  if (r1.length !== r2.length) { bad++; console.log('count', r1.length, r2.length); continue; }
  r1.forEach((x, i) => {
    const y = r2[i]; if (x.real) real++;
    for (const k of ['dir', 'k', 'real', 'fast', 'mv', 'ei', 'entry', 'sl']) if (x[k] !== y[k]) { bad++; console.log('diff', i, k, x[k], y[k]); }
    if (x.S.id !== y.S.id || x.z.k !== y.z.k) { bad++; console.log('zone', i); }
  });
}
// wanted(): the order it would rest before a touch must equal the setup scan() later produces
let chk = 0, mism = 0;
for (let i = 200; i < B.length - 1; i += 7) {
  const now = B[i].time + 61, hist = B.slice(0, i + 1);
  const w = H.wanted(hist, L2, [], now, { rr: 1.6 }, null, 0);
  w.orders.forEach(o => {
    const fut = H.scan(B, L2, [], { from: H.dayStart(now) }).filter((x) => x.ei > i && x.z.k === o.zone && x.S.id === o.sess && x.k === o.k && x.real)[0];
    if (!fut || fut.dir !== o.dir) return; chk++; // arm flipped before the touch → order would be cancelled, not a mismatch
    if (fut.entry !== o.entry && Math.abs(fut.entry - o.entry) > 0.011) mism++;
    if (Math.abs(fut.sl - o.sl) > 0.011 || fut.dir !== o.dir) mism++;
    if (process.env.DBG && (Math.abs(fut.entry-o.entry)>0.011||Math.abs(fut.sl-o.sl)>0.011||fut.dir!==o.dir)) console.log(i, o, fut.entry, fut.sl, fut.dir);
  });
}
// lots
const sym = { tick_size: 0.01, tick_value: 1, vol_min: 0.01, vol_max: 100, vol_step: 0.01 };
const l = H.lotsFor({ lotMode: 'risk', riskPct: 2 }, 2500, 7, sym); // R=7 → $700/lot → 50$/700
if (Math.abs(l.lots - 0.07) > 1e-9) { bad++; console.log('lots', l); }
const l2 = H.lotsFor({ lotMode: 'fixed', lots: 0.05 }, 2500, 7, sym); if (l2.lots !== 0.05) { bad++; console.log('fix', l2); }
console.log(`setups ${tot} (real ${real}) · wanted checked ${chk} mismatch ${mism} · bad ${bad}`);
process.exit(bad || mism ? 1 : 0);

// 🌏 OI Session Fade — hub-side engine (pure functions, no I/O).
// Port of OI Gold Pro osf.js (v0.6): the SAME zone / arm / touch rules, so the hub can run the system without the app open.
// Times: "T" = unix seconds + 7h (Thai wall clock as a number), exactly like osf.js. Prices: BROKER scale.
// parity test: tools/test-osf.mjs runs both this file and OI Gold Pro's osf.js on the same bars.

export const ARM = 3, SLB = 3, RRS = [1, 1.6, 5], RANGE = 60, MOM_N = 5, ATR_N = 60, NB = 30 * 60, NA = 90 * 60;
// Thai minute-of-day windows · half = zone half width ($) · real = touches that count as real trades · realA = same for grade A
export const SESS = [
  { id: "AM", lab: "Asia เช้า", a: 360, b: 600, half: 2, real: 2, realA: 3, mom: 3 },
  { id: "AL", lab: "Asia สาย", a: 600, b: 840, half: 1, real: 0 },
  { id: "LDN", lab: "London", a: 840, b: 1170, half: 1.5, real: 1 },
  { id: "NY", lab: "NY", a: 1170, b: 1530, half: 1.5, real: 0 },
];
const mod = (t) => Math.floor((((t % 86400) + 86400) % 86400) / 60);
export const sessOf = (t) => { const m = mod(t); return SESS.find((s) => (m >= s.a && m < s.b) || (s.b > 1440 && m < s.b - 1440)) || null; };
// trading day starts 06:00 Thai
export const dayStart = (t) => Math.floor((t - 6 * 3600) / 86400) * 86400 + 6 * 3600;
export const toT = (utcSec) => utcSec + 7 * 3600;

// rows: [{strike, price (broker scale), c, p, vc, vp}] → today's walls: top-3 Call OI + top-3 Put OI within ±RANGE of ref
export function levels(ref, rows) {
  if (!rows || !rows.length) return [];
  const R = rows.filter((r) => r.price !== null && r.price !== undefined && Math.abs(r.price - ref) <= RANGE);
  const top = (k, n) => R.filter((r) => r[k] > 0).sort((a, b) => b[k] - a[k]).slice(0, n).map((r) => r.strike);
  const C = top("c", 3), P = top("p", 3), V = new Set(top("vc", 3).concat(top("vp", 3)));
  return [...new Set(C.concat(P))]
    .map((k) => { const r = R.find((x) => x.strike === k); return { k, p: r.price, side: C.includes(k) ? "C" : "P", grade: V.has(k) ? "A" : "B" }; })
    .sort((a, b) => a.p - b.p);
}

export function atrArr(B) {
  const n = B.length, tr = new Array(n).fill(NaN), out = new Array(n).fill(NaN);
  let sum = 0;
  for (let j = 1; j < n; j++) tr[j] = Math.max(B[j].high, B[j - 1].close) - Math.min(B[j].low, B[j - 1].close);
  for (let i = ATR_N + 1; i < n; i++) {
    if (i === ATR_N + 1) { sum = 0; for (let j = 1; j <= ATR_N; j++) sum += tr[j]; } else sum += tr[i - 1] - tr[i - 1 - ATR_N];
    out[i] = sum / ATR_N;
  }
  return out; // out[i] = mean TR of bars i-60..i-1
}
// ATR "as of the next bar" (index n) — used to judge a limit order that has not been touched yet
export function atrNext(B) {
  const n = B.length; if (n < ATR_N + 2) return NaN;
  let s = 0;
  for (let j = n - ATR_N; j < n; j++) s += Math.max(B[j].high, B[j - 1].close) - Math.min(B[j].low, B[j - 1].close);
  return s / ATR_N;
}
export const momAt = (B, A, i, dir) => (i > MOM_N && A[i] > 0 ? ((B[i - 1].close - B[i - 1 - MOM_N].close) * -dir) / A[i] : null);

// B = M1 bars {time (T), open, high, low, close} · L = levels · N = red USD news times (T) · same signature/outputs as osf.js scan(),
// plus `state` (per-zone arm/touch counters of the LAST session in B) for placing limit orders before the touch.
export function scan(B, L, N, opt) {
  opt = opt || {}; N = N || [];
  const from = opt.from || 0, until = opt.until || Infinity, ATR = atrArr(B);
  const out = [], n = B.length;
  let cur = null, st = new Map(), curS = null;
  const inNews = (t) => N.some((x) => t >= x - NB && t <= x + NA);
  for (let i = 0; i < n; i++) {
    const b = B[i]; if (b.time < from || b.time >= until) continue;
    const S = sessOf(b.time), sk = S ? S.id + "|" + dayStart(b.time) : null;
    if (sk !== cur) { cur = sk; st = new Map(); }
    curS = S ? { S, sk } : null;
    if (!S) continue;
    L.forEach((z) => {
      const lo = z.p - S.half, hi = z.p + S.half, s = st.get(z.k) || { arm: 0, k: 0 };
      st.set(z.k, s);
      if (s.arm && b.low <= hi && b.high >= lo) {
        s.k++; const dir = s.arm; s.arm = 0;
        if (s.k > 4 || inNews(b.time)) return;
        let real = S.real > 0 && (s.k <= S.real || (z.grade === "A" && s.k <= (S.realA || 0)));
        const mv = momAt(B, ATR, i, dir), atr = ATR[i] > 0 ? ATR[i] : null, fast = !!(real && S.mom && mv !== null && mv > S.mom);
        if (fast) real = false;
        const entry = dir > 0 ? hi : lo, sl = dir > 0 ? lo - SLB : hi + SLB;
        out.push({ z, S, dir, k: s.k, real, fast, mv: mv !== null ? Math.round(mv * 10) / 10 : null, atr, ei: i, entry, sl, st: 3 });
        return;
      }
      if (b.close > hi + ARM) s.arm = 1; else if (b.close < lo - ARM) s.arm = -1;
    });
  }
  out.state = curS ? { ...curS, zones: st } : null;
  return out;
}

// Which resting limit orders should exist RIGHT NOW? (one per armed zone whose next touch would be a real trade)
// B must end with the last CLOSED M1 bar; nowT = current T; cfg.rr = TP multiple; px = {bid, ask}; minDist = min distance entry↔price ($)
export function wanted(B, L, N, nowT, cfg, px, minDist) {
  const res = { orders: [], skipped: [] };
  if (!B.length || !L.length) return res;
  const day = dayStart(nowT), from = day - (ATR_N + 10) * 60;
  const Bd = B.filter((b) => b.time >= from);
  const lastT = Bd.length ? Bd[Bd.length - 1].time : 0;
  if (nowT - lastT > 150) { res.skipped.push({ why: "แท่ง M1 เก่า " + Math.round(nowT - lastT) + " วิ" }); return res; }
  const S = sessOf(nowT);
  if (!S || S.real <= 0) return res;
  const sc = scan(Bd, L, N, { from: day });
  const stt = sc.state;
  if (!stt || stt.sk !== S.id + "|" + day) return res; // no bar of this session yet
  const A = atrNext(Bd);
  const nearNews = (N || []).find((x) => nowT >= x - NB - 60 && nowT <= x + NA); // inside the no-trade window (or within a minute of it)
  L.forEach((z) => {
    const s = stt.zones.get(z.k); if (!s || !s.arm) return;
    const k = s.k + 1, dir = s.arm;
    if (k > 4) return;
    const real = S.real > 0 && (k <= S.real || (z.grade === "A" && k <= (S.realA || 0)));
    if (!real) return;
    const key = day + "|" + S.id + "|" + z.k + "|" + k;
    if (nearNews) { res.skipped.push({ key, why: "ใกล้ข่าวแดง USD" }); return; }
    const n = Bd.length;
    if (S.mom && n > MOM_N && A > 0) {
      const mv = ((Bd[n - 1].close - Bd[n - 1 - MOM_N].close) * -dir) / A;
      if (mv > S.mom) { res.skipped.push({ key, why: "ราคาพุ่งเข้าโซนเร็ว (" + mv.toFixed(1) + "×ATR)" }); return; }
    }
    const lo = z.p - S.half, hi = z.p + S.half;
    const entry = dir > 0 ? hi : lo, sl = dir > 0 ? lo - SLB : hi + SLB, R = Math.abs(entry - sl);
    const rr = Number(cfg.rr) || 1, tp = entry + dir * rr * R;
    // a limit must rest on the far side of price
    if (px) {
      if (dir > 0 && !(px.ask - entry >= minDist)) { res.skipped.push({ key, why: "ราคาอยู่ใกล้/ในโซนแล้ว" }); return; }
      if (dir < 0 && !(entry - px.bid >= minDist)) { res.skipped.push({ key, why: "ราคาอยู่ใกล้/ในโซนแล้ว" }); return; }
    }
    res.orders.push({ key, zone: z.k, grade: z.grade, side: dir > 0 ? "BUY" : "SELL", dir, k, sess: S.id, entry: r2(entry), sl: r2(sl), tp: r2(tp), R: r2(R), rr });
  });
  return res;
}

const r2 = (v) => Math.round(v * 100) / 100;

// lots for a fixed lot or a % of balance risked on the stop distance R ($ per oz)
// sym = {tick_size, tick_value, vol_min, vol_max, vol_step}
export function lotsFor(cfg, balance, R, sym) {
  const step = sym.vol_step > 0 ? sym.vol_step : 0.01, vmin = sym.vol_min > 0 ? sym.vol_min : 0.01, vmax = sym.vol_max > 0 ? sym.vol_max : 100;
  const fix = (v) => Math.floor(v / step + 1e-9) * step;
  if (cfg.lotMode !== "risk") {
    const l = Math.min(vmax, Math.max(vmin, fix(Number(cfg.lots) || vmin)));
    return { lots: r2(l), risk: riskOf(l, R, sym) };
  }
  const per = riskOf(1, R, sym); // currency lost per 1.00 lot at the stop
  if (!(per > 0) || !(balance > 0)) return { lots: 0, why: "คำนวณ lot ไม่ได้ (ไม่มี tick value/balance)" };
  const want = (balance * (Number(cfg.riskPct) || 1)) / 100;
  let l = fix(want / per);
  if (l < vmin) {
    const risk = riskOf(vmin, R, sym);
    if (risk > want * 1.5) return { lots: 0, why: `lot ต่ำสุดเสี่ยง ${r2(risk)} เกินที่ตั้ง ${r2(want)}` };
    l = vmin;
  }
  l = Math.min(vmax, l);
  return { lots: r2(l), risk: riskOf(l, R, sym) };
}
export const riskOf = (lots, R, sym) => (sym.tick_size > 0 && sym.tick_value > 0 ? (R / sym.tick_size) * sym.tick_value * lots : 0);

// OI rows from the sheet payload ({levels:[{strike,type,oi}], cfg:{volume:'{"4100":[c,p]}'}}) shifted to the broker scale by gcOff (GC − broker)
export function oiRows(data, gcOff) {
  const map = new Map();
  ((data && data.levels) || []).forEach((l) => {
    const r = map.get(l.strike) || { strike: l.strike, p: 0, c: 0 };
    if (l.type === "P") r.p += Number(l.oi) || 0; else r.c += Number(l.oi) || 0;
    map.set(l.strike, r);
  });
  let vol = {};
  try { vol = data && data.cfg && data.cfg.volume ? JSON.parse(data.cfg.volume) : {}; } catch { vol = {}; }
  return [...map.values()].sort((a, b) => a.strike - b.strike).map((r) => {
    const v = vol[String(r.strike)];
    return { ...r, price: r.strike - gcOff, vc: v ? Number(v[0]) : null, vp: v ? Number(v[1]) : null };
  });
}

// red USD news (news.json) → T values
export function newsTimes(json) {
  return ((json && json.events) || []).filter((e) => e.c === "USD" && (e.i || "H") === "H").map((e) => Date.parse(e.date) / 1000 + 7 * 3600).filter(isFinite).sort((a, b) => a - b);
}

// median of (Gold.F close − broker close) over the last same-minute pairs → GC − broker
export function gcOffset(gfBars, brokerBars, nowUtc) {
  const pm = new Map(brokerBars.map((b) => [b.utc, b.close]));
  const d = [];
  for (let i = gfBars.length - 1; i >= 0 && d.length < 5; i--) {
    const t = gfBars[i][0];
    if (t + 60 > nowUtc || !pm.has(t)) continue;
    d.push(gfBars[i][4] - pm.get(t));
  }
  if (d.length < 2) return null;
  const v = d.sort((a, b) => a - b), m = v.length % 2 ? v[(v.length - 1) / 2] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2;
  const off = Math.round(m * 100) / 100;
  return isFinite(off) && Math.abs(off) <= 60 ? off : null;
}

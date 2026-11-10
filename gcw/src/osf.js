// Authoritative closed-M1 state for the web and the MT5 Fade entry plans.
export const OSF_SESS = [
  { id: 'AM', lab: 'Asia เช้า', a: 360, b: 600, half: 2, real: 2, realA: 3, mom: 3 },
  { id: 'AL', lab: 'Asia สาย', a: 600, b: 840, half: 1, real: 0 },
  { id: 'LDN', lab: 'London', a: 840, b: 1170, half: 1.5, real: 1 },
  { id: 'NY', lab: 'NY', a: 1170, b: 1530, half: 1.5, real: 0 },
];
const THAI = 7 * 3600;
export const osfDay = t => Math.floor((t + 3600) / 86400) * 86400 - 3600;
export const osfSession = t => {
  const m = Math.floor(((t + THAI) % 86400) / 60);
  return OSF_SESS.find(s => (m >= s.a && m < s.b) || (s.b > 1440 && m < s.b - 1440));
};
const et = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short', hour: 'numeric', hourCycle: 'h23' });
let checkedHour = -1, marketOpen = false;
export function osfOpen(t) {
  const hour = Math.floor(t / 3600);
  if (hour !== checkedHour) {
    const parts = et.formatToParts(hour * 3600000);
    const day = parts.find(p => p.type === 'weekday').value, h = Number(parts.find(p => p.type === 'hour').value);
    marketOpen = day !== 'Sat' && !(day === 'Fri' && h >= 17) && !(day === 'Sun' && h < 18) && h !== 17;
    checkedHour = hour;
  }
  return marketOpen;
}

const round = n => Math.round(n * 100) / 100;
// ATR(60) at the first 06:00 bar needs the last open-market bars before the day
// (skipping the 05:00-06:00 break and, on Monday, the weekend) — same as the backtest.
export const OSF_WARM = 70;
export const osfWarm = (rows, basis, day) => rows.filter(b => b[0] < day && osfOpen(b[0])).slice(-OSF_WARM)
  .map(b => [b[0], ...b.slice(1, 5).map(p => round(p + basis))]);
export function osfBasis(bars, gold, last) {
  const prices = new Map(bars.map(b => [b[0], b[4]]));
  const d = gold.filter(b => b[0] <= last && b[0] >= last - 600 && prices.has(b[0]))
    .slice(-5).map(b => b[4] - prices.get(b[0])).sort((a, b) => a - b);
  if (d.length < 2) return null;
  const middle = Math.floor(d.length / 2);
  const value = round(d.length % 2 ? d[middle] : (d[middle - 1] + d[middle]) / 2);
  return Math.abs(value) <= 40 ? value : null;
}

export function osfLevels(rows, ref) {
  const byStrike = new Map();
  for (const r of rows) {
    if (!Number.isFinite(r.k) || Math.abs(r.k - ref) > 60 || !['C', 'P'].includes(r.t)) continue;
    if (!byStrike.has(r.k)) byStrike.set(r.k, { k: r.k, C: 0, P: 0, vc: 0, vp: 0 });
    const z = byStrike.get(r.k);
    z[r.t] += +r.oi || 0;
    z[r.t === 'C' ? 'vc' : 'vp'] += +r.vol || 0;
  }
  const list = [...byStrike.values()];
  const top = key => list.filter(x => x[key] > 0).sort((a, b) => b[key] - a[key] || a.k - b.k).slice(0, 3).map(x => x.k);
  const C = top('C'), P = top('P'), volume = new Set([...top('vc'), ...top('vp')]);
  return [...new Set([...C, ...P])].sort((a, b) => a - b).map(k => ({ k, p: k, side: C.includes(k) ? 'C' : 'P', grade: volume.has(k) ? 'A' : 'B' }));
}

function momentum(bars) {
  const n = bars.length;
  if (n < 61) return { atr: null, move: null };
  let sum = 0;
  for (let i = n - 60; i < n; i++) sum += Math.max(bars[i][2], bars[i - 1][4]) - Math.min(bars[i][3], bars[i - 1][4]);
  const atr = sum / 60;
  return atr > 0 ? { atr, move: (bars[n - 1][4] - bars[n - 6][4]) / atr } : { atr: null, move: null };
}

function decision(state, z, t, news) {
  const S = osfSession(t), counter = state.counters[z.k];
  if (!S || S.id !== state.session || !counter?.arm) return null;
  const k = counter.k + 1, dir = counter.arm;
  const { atr, move } = momentum(state.bars);
  const mv = move === null ? null : -dir * move;
  const blocked = news.some(x => t >= x - 1800 && t <= x + 5400);
  const eligible = k <= S.real || (z.grade === 'A' && k <= (S.realA || 0));
  const fast = eligible && !!S.mom && mv !== null && mv > S.mom;
  const key = [state.day, state.expiry, S.id, z.k, k].join('|');
  return { key, z, sid: S.id, dir, k, entry: z.k + dir * S.half, sl: z.k - dir * (S.half + 3),
    mv: mv === null ? null : Math.round(mv * 10) / 10, atr, fast, blocked, real: k <= 4 && eligible && !fast && !blocked };
}

// Inputs are contiguous closed M1 bars. Previously committed bars and decisions stay fixed.
export function advanceOsf(state, incoming, news) {
  for (const b of incoming) {
    const t = b[0];
    if (t <= state.last) continue;
    const normalized = [t, ...b.slice(1, 5).map(p => round(p + state.basis))];
    if (t >= state.day) {
      const S = osfSession(t), sid = S?.id || '';
      if (sid !== state.session) { state.session = sid; state.counters = {}; }
      if (S) for (const z of state.levels) {
        const c = state.counters[z.k] ||= { arm: 0, k: 0 };
        const lo = z.k - S.half, hi = z.k + S.half;
        if (c.arm && normalized[3] <= hi && normalized[2] >= lo) {
          const d = (state.next?.bar === t && state.next.plans.find(p => p.z.k === z.k)) || decision(state, z, t, news);
          c.k++;
          c.arm = 0;
          if (d.k <= 4 && !d.blocked) state.events.push({ ...d, t });
        } else if (normalized[4] > hi + 3) c.arm = 1;
        else if (normalized[4] < lo - 3) c.arm = -1;
      }
    }
    state.bars.push(normalized);
    state.last = t;
  }
  return state;
}

export function prepareOsf(state, news) {
  const bar = state.last + 60;
  if (state.next?.bar === bar) return;
  state.next = { bar, plans: state.levels.map(z => decision(state, z, bar, news)).filter(Boolean) };
}

export function osfSnapshot(state, now, news, compact) {
  const minute = Math.floor(now / 60) * 60;
  const fresh = state && state.last === minute - 60 && state.day === osfDay(minute) && state.expiry > minute && osfOpen(minute);
  const S = osfSession(minute);
  const ready = !!(fresh && news);
  const plans = ready && state.next?.bar === minute ? state.next.plans : [];
  const payload = { version: 1, ready: ready ? 1 : 0, bar: minute, until: ready ? minute + 60 : 0,
    day: state?.day || 0, root: state?.root || '', expiry: state?.expiry || 0, session: S?.id || '',
    zones: (state?.levels || []).map(z => [z.k, z.side, z.grade]),
    plans: plans.map(p => [p.z.k, p.z.side, p.z.grade, p.dir, p.k, p.real ? 1 : 0, p.entry, p.sl, p.key]) };
  // counters: ตัวนับแตะ/สถานะรอของช่วงที่แท่งล่าสุดอยู่ (แอปโชว์ในหน้า OI / Gamma) — { session, c: { strike: [arm, touches] } }
  const counters = { session: state?.session || '', c: Object.fromEntries(Object.entries(state?.counters || {}).map(([k, c]) => [k, [c.arm, c.k]])) };
  return compact ? payload : { ...payload, counters, levels: state?.levels || [], events: state?.events || [], bars: state?.bars || [] };
}

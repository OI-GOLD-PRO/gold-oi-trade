// Sensor clean-up. The inverter (SmartESS) occasionally returns garbage: a current of ~1,900 A, or a row of zeros for
// a minute or two. Those must not reach the Ah counter, the charts or the grid estimate.
//
//  1. LIMITS  – a value outside the physically possible range is replaced by the previous good value.
//  2. ZERO DROP – every inverter value 0 at once while the previous minute was busy is held for one minute;
//     if the next minute is still all-zero it is believed.
//  3. DESPIKE – a value that jumps away from both neighbours (which agree with each other) for ≤ 3 minutes is a spike
//     and is replaced by the neighbours' average. Run over the last few samples every minute, and over history once.

export const LIMITS = {
  inv_chg_a: [0, 130], inv_dis_a: [0, 130], mppt_a: [-2, 90],
  inv_pv_w: [0, 7000], mppt_pv_w: [0, 5000], load_w: [0, 8000],
};
export const SPIKE_T = { inv_chg_a: 25, inv_dis_a: 25, mppt_a: 25, inv_pv_w: 1500, mppt_pv_w: 1500, load_w: 2500 };
export const FIELDS = Object.keys(LIMITS);
const HOLD = ['load_w', 'inv_pv_w', 'inv_chg_a', 'inv_dis_a'];

const inRange = (f, v) => typeof v === 'number' && Number.isFinite(v) && v >= LIMITS[f][0] && v <= LIMITS[f][1];

/** Clean one fresh row in place. prev = last stored sample, pendingZero = a zero-drop was held last minute. */
export function sanitizeLive(row, prev, pendingZero) {
  const fixed = [];
  for (const f of FIELDS) {
    if (row[f] != null && !inRange(f, row[f])) {
      row[f] = prev && inRange(f, prev[f]) ? prev[f] : null;
      fixed.push(f);
    }
  }
  const zero = HOLD.every((f) => row[f] != null ? Math.abs(row[f]) < 0.05 : f !== 'load_w') && row.load_w != null;
  const busyBefore = prev && ((prev.load_w ?? 0) >= 150 || (prev.inv_pv_w ?? 0) >= 150);
  let pending = false;
  if (zero && busyBefore) {
    if (!pendingZero) {                                   // first all-zero minute: hold the previous values
      for (const f of HOLD) row[f] = prev[f];
      pending = true;
      fixed.push('zero-drop');
    }                                                     // second one in a row: it is real, keep the zeros
  }
  return { fixed, pending };
}

const busy = (s) => (s.load_w ?? 0) >= 150 || (s.inv_pv_w ?? 0) >= 150;
const allZero = (s) => HOLD.every((f) => s[f] != null && Math.abs(s[f]) < 0.05);
const lerp = (a, c, t) => Math.round((a + (c - a) * t) * 100) / 100;

/**
 * Remove short spikes from an ascending list of samples (mutates). Returns the samples that changed.
 *  • all-zero dropout of 1–3 minutes between two busy minutes → interpolate
 *  • per field: a run of 1–3 samples that is far (> threshold) on the same side of both neighbours, while the two
 *    neighbours agree with each other (within half the threshold), is a spike → interpolate
 */
export function despike(list) {
  const changed = new Set();
  for (let i = 1; i < list.length - 1; i++) {
    if (!allZero(list[i]) || !busy(list[i - 1])) continue;
    let len = 1; while (len < 3 && i + len < list.length && allZero(list[i + len])) len++;
    const c = list[i + len];
    if (!c || allZero(c) || !busy(c)) continue;
    for (let k = 0; k < len; k++) for (const f of HOLD) { list[i + k][f] = lerp(list[i - 1][f] ?? 0, c[f] ?? 0, (k + 1) / (len + 1)); changed.add(list[i + k]); }
    i += len - 1;
  }
  for (const f of FIELDS) {
    const T = SPIKE_T[f];
    for (let i = 1; i < list.length - 1; i++) {
      const a = list[i - 1][f];
      if (a == null) continue;
      for (let len = 1; len <= 3 && i + len < list.length; len++) {
        const c = list[i + len][f];
        const run = list.slice(i, i + len).map((x) => x[f]);
        if (c == null || run.some((x) => x == null) || Math.abs(a - c) > T / 2) continue;
        const up = run.every((x) => x - Math.max(a, c) > T), down = run.every((x) => Math.min(a, c) - x > T);
        if (!up && !down) continue;
        for (let k = 0; k < len; k++) { list[i + k][f] = lerp(a, c, (k + 1) / (len + 1)); changed.add(list[i + k]); }
        i += len - 1;
        break;
      }
    }
  }
  return [...changed];
}

/** Historical clean-up: out-of-range values become holes, filled from the neighbours; then despike. */
export function cleanHistory(list) {
  const touched = new Set();
  for (const f of FIELDS) {
    const bad = [];
    list.forEach((s, i) => { if (s[f] != null && !inRange(f, s[f])) bad.push(i); });
    for (const i of bad) {
      let p = i - 1; while (p >= 0 && (bad.includes(p) || list[p][f] == null)) p--;
      let n = i + 1; while (n < list.length && (bad.includes(n) || list[n][f] == null)) n++;
      const a = p >= 0 ? list[p][f] : null, c = n < list.length ? list[n][f] : null;
      list[i][f] = a != null && c != null ? Math.round(((a + c) / 2) * 100) / 100 : a ?? c ?? null;
      touched.add(list[i]);
    }
  }
  for (const s of despike(list)) touched.add(s);
  return [...touched];
}

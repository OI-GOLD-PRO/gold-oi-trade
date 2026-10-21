// App-side battery %: pure Ah counting every minute (carry-over + charged in − used), reset only at the two ends.
//  • scale (owner's): 50.0 V = 10 % (empty, 0 % usable), 54.5 V = 90 % (full, 100 % usable)
//  • voltage ≤ 50.0 V → empty: reset to 10 %  (whatever was left is gone; counting starts again from 0)
//  • charging and holding ≥ 54.5 V for ≥ 5 min → full: at least 90 %
//  • never above 90 % (full) and never below 10 % (the inverter cuts off there)
//  • the voltage is used for nothing else — no easing toward the voltage while resting (v2.12)

export const SOC_SCALE = { v0: 50.0, p0: 10, v1: 54.5, p1: 90 };
const FULL_HOLD_MS = 5 * 60000;
const MAX_GAP_MS = 15 * 60000;

const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

export function socFromVoltage(v, s = SOC_SCALE) {
  if (v == null) return null;
  return clamp(s.p0 + ((v - s.v0) * (s.p1 - s.p0)) / (s.v1 - s.v0), 0, 100);
}

/**
 * Advance the state by one sample.
 * state: { soc, ts, restSince, fullSince } | null
 * sample: { ts, v, net } (net = battery current, + charging)
 */
export function stepSoc(state, sample, capacityAh, scale = SOC_SCALE) {
  const { ts, v, net } = sample;
  const vSoc = socFromVoltage(v, scale);
  if (!state || state.soc == null || ts - state.ts > MAX_GAP_MS || ts <= state.ts) {
    return { soc: vSoc, ts, restSince: null, fullSince: null, src: 'voltage' };
  }
  const h = (ts - state.ts) / 3600000;
  let soc = state.soc + ((net ?? 0) * h * 100) / capacityAh;
  let src = 'ah';

  const holdingFull = v != null && v >= scale.v1 && (net ?? 0) > 0;
  const fullSince = holdingFull ? (state.fullSince ?? ts) : null;
  if (holdingFull && ts - fullSince >= FULL_HOLD_MS && soc < scale.p1) { soc = scale.p1; src = 'full'; }

  if (v != null && v <= scale.v0 && soc > scale.p0) { soc = scale.p0; src = 'empty'; }
  // The inverter cuts off at the empty point, so the bank can't go below it.
  if (soc < scale.p0) { soc = scale.p0; src = 'floor'; }
  // Full is full: extra charge past the ceiling is not stored.
  if (soc > scale.p1) { soc = scale.p1; src = 'ceiling'; }

  return { soc: clamp(soc, 0, 100), ts, restSince: null, fullSince, src };
}

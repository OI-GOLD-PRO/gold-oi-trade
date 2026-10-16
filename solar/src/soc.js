// App-side battery % ("แบบผสม"): Ah counting every minute, calibrated by voltage only when it is trustworthy.
//  • voltage scale (owner's): 50.0 V = 10 %, 54.5 V = 90 %, linear in between
//  • at rest (|net| < 3 A for ≥ 10 min) → ease toward the voltage scale
//  • charging and holding ≥ 54.5 V for ≥ 5 min → at least 90 %
//  • voltage ≤ 50.0 V → at most 10 %

export const SOC_SCALE = { v0: 50.0, p0: 10, v1: 54.5, p1: 90 };
const REST_A = 3;
const REST_MIN_MS = 10 * 60000;
const FULL_HOLD_MS = 5 * 60000;
const MAX_GAP_MS = 15 * 60000;
const EASE = 0.2; // per minute toward the rest target

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

  const atRest = net != null && Math.abs(net) < REST_A;
  const restSince = atRest ? (state.restSince ?? ts) : null;
  if (atRest && vSoc != null && ts - restSince >= REST_MIN_MS) {
    soc += (vSoc - soc) * Math.min(1, EASE * (h * 60));
    src = 'rest';
  }

  const holdingFull = v != null && v >= scale.v1 && (net ?? 0) > 0;
  const fullSince = holdingFull ? (state.fullSince ?? ts) : null;
  if (holdingFull && ts - fullSince >= FULL_HOLD_MS && soc < scale.p1) { soc = scale.p1; src = 'full'; }

  if (v != null && v <= scale.v0 && soc > scale.p0) { soc = scale.p0; src = 'empty'; }

  return { soc: clamp(soc, 0, 100), ts, restSince, fullSince, src };
}

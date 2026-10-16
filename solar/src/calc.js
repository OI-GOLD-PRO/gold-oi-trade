// Battery bookkeeping: integrate current over time into Ah / kWh per day.

const MAX_GAP_MS = 15 * 60 * 1000; // ignore gaps longer than this (outages, missing polls)

/**
 * Net battery current (+ charging, − discharging).
 * MPPT charges the battery directly; the inverter both charges and draws from it.
 */
export function netBatteryA(s) {
  const mppt = s.mppt_a ?? 0;
  const chg = s.inv_chg_a ?? 0;
  const dis = s.inv_dis_a ?? 0;
  return mppt + chg - dis;
}

/** Summarise one day of samples (sorted by ts). */
export function summarizeDay(samples, cfg) {
  const r = {
    samples: samples.length,
    ahIn: 0, ahOut: 0,
    ahMppt: 0, ahInvChg: 0, ahInvDis: 0,
    kwhIn: 0, kwhOut: 0,
    kwhPvInv: 0, kwhPvMppt: 0, kwhLoad: 0,
    minV: null, minVAt: null, maxV: null,
    minSoc: null, minSocAt: null,
    cutoffAt: null,
    mpptTodayKwh: null,
  };
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i];
    const v = s.batt_v;
    if (v != null) {
      if (r.minV == null || v < r.minV) { r.minV = v; r.minVAt = s.ts; }
      if (r.maxV == null || v > r.maxV) r.maxV = v;
      if (r.cutoffAt == null && v <= cfg.cutoffV + 0.2) r.cutoffAt = s.ts;
    }
    if (s.soc != null && (r.minSoc == null || s.soc < r.minSoc)) { r.minSoc = s.soc; r.minSocAt = s.ts; }
    if (s.mppt_today_kwh != null) r.mpptTodayKwh = Math.max(r.mpptTodayKwh ?? 0, s.mppt_today_kwh);

    const next = samples[i + 1];
    if (!next) break;
    const dt = next.ts - s.ts;
    if (dt <= 0 || dt > MAX_GAP_MS) continue;
    const h = dt / 3600000;
    const net = netBatteryA(s);
    const vv = v ?? cfg.nominalV;
    if (net > 0) { r.ahIn += net * h; r.kwhIn += (net * vv * h) / 1000; }
    else { r.ahOut += -net * h; r.kwhOut += (-net * vv * h) / 1000; }
    r.ahMppt += (s.mppt_a ?? 0) * h;
    r.ahInvChg += (s.inv_chg_a ?? 0) * h;
    r.ahInvDis += (s.inv_dis_a ?? 0) * h;
    r.kwhPvInv += ((s.inv_pv_w ?? 0) * h) / 1000;
    r.kwhPvMppt += ((s.mppt_pv_w ?? 0) * h) / 1000;
    r.kwhLoad += ((s.load_w ?? 0) * h) / 1000;
  }
  for (const k of Object.keys(r)) if (typeof r[k] === 'number' && !/At$|samples|Soc|V$/.test(k)) r[k] = Math.round(r[k] * 100) / 100;
  return r;
}

/** How long until the bank reaches the cut-off at the current draw. */
export function timeToCutoff(latest, cfg) {
  const net = netBatteryA(latest);
  const soc = latest.soc;
  if (soc == null) return null;
  const remainAh = Math.max(0, ((soc - cfg.cutoffSoc) / 100) * cfg.capacityAh);
  if (net >= -0.5) return { remainAh: Math.round(remainAh), hours: null, state: net > 0.5 ? 'charging' : 'idle' };
  return { remainAh: Math.round(remainAh), hours: Math.round((remainAh / -net) * 10) / 10, state: 'discharging' };
}

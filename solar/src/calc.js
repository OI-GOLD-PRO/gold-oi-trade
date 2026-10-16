// Battery bookkeeping: integrate current over time into Ah / kWh per day.

const MAX_GAP_MS = 15 * 60 * 1000; // ignore gaps longer than this (outages, missing polls)
const SUN_MIN_W = 30;                // inverter PV above this = panels producing

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
    mpptTodayKwh: null, invTodayKwh: null,
    // Daylight window, inverter side only: first → last minute the inverter's panels produce.
    sunStartAt: null, sunEndAt: null, sunHours: 0,
    sunPvKwh: 0, sunLoadKwh: 0,
    sunChgAh: 0, sunChgKwh: 0, sunDisAh: 0, sunDisKwh: 0,
  };
  for (const s of samples) {
    if ((s.inv_pv_w ?? 0) >= SUN_MIN_W) {
      if (r.sunStartAt == null) r.sunStartAt = s.ts;
      r.sunEndAt = s.ts;
    }
  }
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
    if (s.inv_today_kwh != null) r.invTodayKwh = Math.max(r.invTodayKwh ?? 0, s.inv_today_kwh);

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
    if (r.sunStartAt != null && s.ts >= r.sunStartAt && s.ts < r.sunEndAt) {
      r.sunPvKwh += ((s.inv_pv_w ?? 0) * h) / 1000;
      r.sunLoadKwh += ((s.load_w ?? 0) * h) / 1000;
      r.sunChgAh += (s.inv_chg_a ?? 0) * h;
      r.sunChgKwh += ((s.inv_chg_a ?? 0) * vv * h) / 1000;
      r.sunDisAh += (s.inv_dis_a ?? 0) * h;
      r.sunDisKwh += ((s.inv_dis_a ?? 0) * vv * h) / 1000;
    }
  }
  if (r.sunStartAt != null) r.sunHours = (r.sunEndAt - r.sunStartAt) / 3600000;
  // Solar per string: prefer the devices' own day counters, fall back to integrated power.
  r.pvInvKwh = r.invTodayKwh || r.kwhPvInv;
  r.pvMpptKwh = r.mpptTodayKwh || r.kwhPvMppt;
  r.pvTotalKwh = r.pvInvKwh + r.pvMpptKwh;
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

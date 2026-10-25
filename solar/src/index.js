import { readInverter } from './dess.js';
import { readMppt } from './tuya.js';
import { summarizeDay, timeToCutoff, netBatteryA, gridW } from './calc.js';
import { localDate, dayRange, kvGet, kvSet, DAY_START_H, validBattV, BATT_V_MIN, BATT_V_MAX } from './util.js';
import { PAGE } from './page.js';
import { stepSoc } from './soc.js';
import { vapidKeys, addSub, removeSub, pushAll, batteryEvent, notifyBattery, SW_JS } from './push.js';
import { sanitizeLive, despike, cleanHistory, FIELDS } from './clean.js';
import { parseBms, parseLabels } from './bms.js';
import { FLASH_PAGE, FLASH_MANIFEST } from './flash.js';
import { ICON_180, ICON_512 } from './icon.js';

function cfg(env) {
  const cutoffSoc = Number(env.CUTOFF_SOC || 10);
  const fullSoc = Number(env.FULL_SOC || 90);
  // Usable capacity between "empty" (50 V) and "full" (our charge ceiling): 120 Ah (used 200 Ah pack, all of it)
  // + 314 Ah × 80 % (10 % → 90 %) = 371.2 Ah. The % counter runs on a 10 → 90 scale, so one Ah moves it
  // 100 / capacityAh points, where capacityAh = usableAh / ((full − empty) / 100).
  const usableAh = Number(env.USABLE_AH || 371.2);
  return {
    usableAh,
    capacityAh: Math.round((usableAh / ((fullSoc - cutoffSoc) / 100)) * 100) / 100,
    cutoffV: Number(env.CUTOFF_V || 50),
    cutoffSoc,
    fullSoc,
    nominalV: Number(env.NOMINAL_V || 51.2),
  };
}

const r2 = (x) => (x == null ? null : Math.round(x * 100) / 100);

// ---- polling ---------------------------------------------------------------

// Tuya free tier ≈ 26k API calls/month → read the MPPT every MPPT_EVERY_MIN minutes and reuse it in between.
// Night pause: once the MPPT string goes dark after 17:00 (or any time before 05:00) stop calling Tuya
// until 05:00 — saves ~half the monthly API quota. Cached counters (day kWh, temp) are kept.
function mpptAsleep(cached) {
  const h = new Date(Date.now() + 7 * 3600000).getUTCHours();
  if (h < 5) return true;
  return h >= 17 && cached && (cached.data?.values?.pvW ?? 0) < 5;
}

async function readMpptThrottled(env, force) {
  const every = Number(env.MPPT_EVERY_MIN || 2);
  const cached = await kvGet(env.DB, 'mppt_last');
  // Manual refresh: at most one real Tuya call per 30 s, so repeated taps can't burn the quota.
  if (force && cached && Date.now() - cached.ts < 30000) return cached.data;
  if (!force && cached && mpptAsleep(cached)) {
    const v = cached.data.values;
    return { values: { ...v, pvV: 0, pvA: 0, pvW: 0, battW: 0, battA: 0, sleeping: true }, raw: null };
  }
  const minute = Math.floor(Date.now() / 60000);
  if (!force && cached && minute % every !== 0 && Date.now() - cached.ts < (every + 1) * 60000) return cached.data;
  const data = await readMppt(env);
  await kvSet(env.DB, 'mppt_last', { ts: Date.now(), data });
  return data;
}

export async function poll(env, { force = false } = {}) {
  const [inv, mppt] = await Promise.allSettled([readInverter(env), readMpptThrottled(env, force)]);
  const i = inv.status === 'fulfilled' ? inv.value.values : {};
  const m = mppt.status === 'fulfilled' ? mppt.value.values : {};
  const errs = [];
  if (inv.status === 'rejected') errs.push(`SmartESS: ${inv.reason?.message || inv.reason}`);
  if (mppt.status === 'rejected') errs.push(`Tuya: ${mppt.reason?.message || mppt.reason}`);

  const row = {
    ts: Date.now(),
    batt_v: r2(validBattV(i.battV) ?? validBattV(m.battV)),
    soc: i.soc ?? null,
    inv_chg_a: r2(i.chgA),
    inv_dis_a: r2(i.disA),
    mppt_a: r2(m.battA),
    inv_pv_w: r2(i.pvW),
    mppt_pv_w: r2(m.pvW),
    load_w: r2(i.loadW),
    grid_v: r2(i.gridV),
    inv_mode: i.mode ?? null,
    mppt_today_kwh: m.todayKwh ?? null,
    inv_today_kwh: i.pvTodayKwh ?? null,
    mppt_temp: m.tempC ?? null,
    err: errs.length ? errs.join(' | ') : null,
  };
  // One-time re-baseline: battery was empty (hit cut-off) — replay the Ah counter from that moment.
  if (!(await kvGet(env.DB, 'soc_rebase_v1'))) {
    await rebaseSoc(env, row.ts);
    await kvSet(env.DB, 'soc_rebase_v1', { at: row.ts });
  }
  // Garbage from the inverter (1,900 A, a minute of zeros) never reaches the counter, charts or grid estimate.
  {
    const prev = await env.DB.prepare('SELECT * FROM samples ORDER BY ts DESC LIMIT 1').first();
    const san = sanitizeLive(row, prev, !!(await kvGet(env.DB, 'zero_pending')));
    await kvSet(env.DB, 'zero_pending', san.pending ? { ts: row.ts } : false);
    if (san.fixed.length) await kvSet(env.DB, 'clean_last', { ts: row.ts, fixed: san.fixed });
  }
  // One-time repair (v2.13): spikes already stored in the last 3 days → clean, replay the counter, rebuild the days.
  if (!(await kvGet(env.DB, 'spike_repair_v1'))) {
    const from = dayRange(localDate(row.ts - 2 * 86400000))[0];
    const list = await samplesBetween(env, from, row.ts + 1);
    const touched = cleanHistory(list);
    await writeFields(env, touched);
    await rebaseSoc(env, row.ts);
    for (let d = 0; d < 3; d++) await saveDay(env, localDate(row.ts - d * 86400000));
    await kvSet(env.DB, 'spike_repair_v1', { at: row.ts, samples: list.length, fixed: touched.length });
  }
  // One-time repair: drop garbage battery-voltage readings (e.g. 1.4 V) that were stored and had reset the
  // % counter to "empty"; replay the counter from the last real cut-off and rebuild the recent daily rows.
  if (!(await kvGet(env.DB, 'bad_v_repair_v1'))) {
    const res = await env.DB.prepare('UPDATE samples SET batt_v = NULL WHERE batt_v IS NOT NULL AND (batt_v < ? OR batt_v > ?)')
      .bind(BATT_V_MIN, BATT_V_MAX).run();
    await rebaseSoc(env, row.ts);
    for (let d = 0; d < 3; d++) await saveDay(env, localDate(row.ts - d * 86400000));
    await kvSet(env.DB, 'bad_v_repair_v1', { at: row.ts, cleared: res?.meta?.changes ?? null });
  }
  // One-time (v2.12): the counter is now pure Ah counting — replay it from the last cut-off so today's number matches.
  if (!(await kvGet(env.DB, 'soc_pure_v1'))) {
    await rebaseSoc(env, row.ts);
    await kvSet(env.DB, 'soc_pure_v1', { at: row.ts });
  }
  // One-time: rebuild stored daily summaries so past days get the grid numbers.
  if (!(await kvGet(env.DB, 'daily_recalc_grid_v1'))) {
    const { results } = await env.DB.prepare('SELECT date FROM daily').all();
    for (const r of results) await saveDay(env, r.date);
    await kvSet(env.DB, 'daily_recalc_grid_v1', { at: row.ts, days: results.length });
  }
  // Battery current measured by the BMS (both packs, fresh) — stored for reference only, not used for the % .
  row.bms_a = await bmsCurrentNow(env, row.ts);
  // App-side battery % (Ah counting + voltage calibration at rest).
  if (row.batt_v != null || (await kvGet(env.DB, 'soc_state'))) {
    const prevSt = await kvGet(env.DB, 'soc_state');
    const st = stepSoc(prevSt, { ts: row.ts, v: row.batt_v, net: netBatteryA(row) }, cfg(env).capacityAh);
    await kvSet(env.DB, 'soc_state', st);
    // Phone notification: battery empty (touched 50 V) / full (app shows 100 %).
    try { await notifyBattery(env, batteryEvent(prevSt?.soc ?? null, st, row.batt_v, row.ts), row.ts); } catch (e) { /* never block the poll */ }
    row.soc_calc = st.soc == null ? null : Math.round(st.soc * 10) / 10;
  }
  const cols = Object.keys(row);
  await env.DB.prepare(`INSERT OR REPLACE INTO samples (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`)
    .bind(...cols.map((c) => row[c]))
    .run();

  // A spike needs the next minute to be recognised: look at the last few samples now that this one is in.
  {
    const { results } = await env.DB.prepare('SELECT * FROM samples ORDER BY ts DESC LIMIT 6').all();
    const changed = despike(results.reverse());
    if (changed.length) {                                   // the counter already used the raw values → replay it
      await writeFields(env, changed);
      await rebaseSoc(env, row.ts);
    }
  }

  await kvSet(env.DB, 'last_raw', {
    ts: row.ts,
    inverter: inv.status === 'fulfilled' ? inv.value : String(inv.reason),
    mppt: mppt.status === 'fulfilled' ? mppt.value : String(mppt.reason),
  });

  // Daily summary (kept forever): current day every 10 min; previous day closed at 05:05.
  const nowLocal = new Date(row.ts + 7 * 3600000);
  const min = nowLocal.getUTCMinutes();
  if (min % 10 === 0) await saveDay(env, localDate(row.ts));
  if (nowLocal.getUTCHours() === 5 && min === 5) await saveDay(env, localDate(row.ts - 86400000));

  // Keep ~120 days of per-minute samples (daily summaries stay).
  if (nowLocal.getUTCHours() === 3 && min === 0) {
    await env.DB.prepare('DELETE FROM samples WHERE ts < ?').bind(Date.now() - 120 * 86400000).run();
    await env.DB.prepare('DELETE FROM bms WHERE ts < ?').bind(Date.now() - 120 * 86400000).run();
  }
  return row;
}

async function writeFields(env, rows) {
  const sets = FIELDS.map((f) => `${f} = ?`).join(', ');
  const stmts = rows.map((s) => env.DB.prepare(`UPDATE samples SET ${sets} WHERE ts = ?`).bind(...FIELDS.map((f) => s[f] ?? null), s.ts));
  for (let i = 0; i < stmts.length; i += 100) await env.DB.batch(stmts.slice(i, i + 100));
}

/**
 * Re-baseline the app battery %: start at the empty point (cut-off %) from the last time the bank
 * touched the cut-off voltage in the past 24 h (or from 05:00 today if it never did), then replay
 * every sample's net current up to now and rewrite soc_calc for those rows.
 */
export async function rebaseSoc(env, now) {
  const c = cfg(env);
  const hit = await env.DB.prepare('SELECT ts FROM samples WHERE ts >= ? AND batt_v >= ? AND batt_v <= ? ORDER BY ts DESC LIMIT 1')
    .bind(now - 86400000, BATT_V_MIN, c.cutoffV + 0.2).first();
  const from = hit ? hit.ts : dayRange(localDate(now))[0];
  const list = await samplesBetween(env, from, now + 1);
  if (!list.length) return null;
  let st = { soc: c.cutoffSoc, ts: list[0].ts, restSince: null, fullSince: null, src: 'rebase' };
  const upd = [];
  for (let i = 0; i < list.length; i++) {
    const s = list[i];
    if (i > 0) st = stepSoc(st, { ts: s.ts, v: validBattV(s.batt_v), net: netBatteryA(s) }, c.capacityAh);
    upd.push(env.DB.prepare('UPDATE samples SET soc_calc = ? WHERE ts = ?').bind(Math.round(st.soc * 10) / 10, s.ts));
  }
  for (let i = 0; i < upd.length; i += 200) await env.DB.batch(upd.slice(i, i + 200));
  await kvSet(env.DB, 'soc_state', st);
  await kvSet(env.DB, 'soc_rebase_info', { from, fromCutoff: !!hit, samples: list.length, soc: st.soc });
  return st;
}

export async function saveDay(env, date) {
  const [a, b] = dayRange(date);
  const list = await samplesBetween(env, a, b);
  if (!list.length) return;
  const sum = summarizeDay(list, cfg(env));
  await env.DB.prepare('INSERT INTO daily (date, data) VALUES (?, ?) ON CONFLICT(date) DO UPDATE SET data = excluded.data')
    .bind(date, JSON.stringify(sum)).run();
}

// ---- BMS (ESP32 relay) -----------------------------------------------------

/** Device → Worker. The ESP32 sends raw JBD frames in hex; the reply tells it whether to pause Bluetooth. */
async function apiBmsPost(env, body) {
  const now = Date.now();
  const last = (await kvGet(env.DB, 'bms_last')) || {};
  let saved = 0;
  for (const b of body?.b || []) {
    const mac = String(b.mac || '').toUpperCase();
    if (!/^[0-9A-F]{2}(:[0-9A-F]{2}){5}$/.test(mac)) continue;
    const p = parseBms(b.basic, b.cells);
    if (!p) { last[mac] = { ...(last[mac] || {}), mac, err: 'bad frame', errAt: now }; continue; }
    const ts = now - Math.min(600, Math.max(0, Number(b.age) || 0)) * 1000;
    const prev = last[mac] || {};
    const e = { ...p, mac, ts, rssi: b.rssi ?? null, savedAt: prev.savedAt || 0 };
    if (ts - e.savedAt >= 55000) {
      await env.DB.prepare('INSERT OR REPLACE INTO bms (ts, mac, v, a, soc, rem_ah, nom_ah, cycles, cmin, cmax, tmax, prot, fet) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)')
        .bind(ts, mac, p.v, p.a, p.soc, p.remAh, p.nomAh, p.cycles, p.cMin ?? null, p.cMax ?? null, p.tMax, p.prot, p.fet).run();
      e.savedAt = ts; saved++;
    }
    last[mac] = e;
  }
  await kvSet(env.DB, 'bms_last', last);
  await kvSet(env.DB, 'bms_device', { ts: now, fw: body?.fw ?? null, up: body?.up ?? null, rssi: body?.wifi ?? null });
  const until = (await kvGet(env.DB, 'bms_pause_until')) || 0;
  return { ok: true, t: now, saved, pause: Math.max(0, Math.ceil((until - now) / 1000)) };
}

async function apiBmsPause(env, min) {
  const m = Math.max(0, Math.min(120, Number(min) || 0));
  const until = m ? Date.now() + m * 60000 : 0;
  await kvSet(env.DB, 'bms_pause_until', until);
  return { pausedUntil: until };
}

/** Sum of all packs' current if every expected pack reported within 3 min, else null. */
async function bmsCurrentNow(env, now) {
  const last = (await kvGet(env.DB, 'bms_last')) || {};
  const order = parseLabels(env.BMS_LABELS);
  const macs = order.length ? order.map((o) => o.mac) : Object.keys(last);
  if (!macs.length) return null;
  let a = 0;
  for (const mac of macs) {
    const e = last[mac];
    if (!e || e.a == null || Math.abs(now - e.ts) > 180000) return null;
    a += e.a;
  }
  return r2(a);
}

/** Latest per-battery readings + pack totals for the app (null until the ESP32 has reported). */
async function bmsNow(env) {
  const last = (await kvGet(env.DB, 'bms_last')) || {};
  const order = parseLabels(env.BMS_LABELS);
  const macs = [...order.map((o) => o.mac), ...Object.keys(last).filter((m) => !order.some((o) => o.mac === m))];
  const packs = [];
  for (const mac of macs) {
    const e = last[mac];
    if (!e || !e.ts || Date.now() - e.ts > 24 * 3600000) continue;
    packs.push({ ...e, label: order.find((o) => o.mac === mac)?.label || mac });
  }
  if (!packs.length) return null;
  const sum = (k) => packs.reduce((x, p) => x + (p[k] || 0), 0);
  const fresh = packs.filter((p) => Date.now() - p.ts < 180000);
  const rem = sum('remAh'), nom = sum('nomAh');
  return {
    packs,
    total: {
      remAh: r2(rem), nomAh: r2(nom), soc: nom ? r2((rem / nom) * 100) : null,
      a: r2(sum('a')), w: Math.round(sum('w')), live: fresh.length === packs.length,
    },
    device: await kvGet(env.DB, 'bms_device'),
    pausedUntil: (await kvGet(env.DB, 'bms_pause_until')) || 0,
  };
}

// ---- reads -----------------------------------------------------------------

async function samplesBetween(env, from, to) {
  const { results } = await env.DB.prepare('SELECT * FROM samples WHERE ts >= ? AND ts < ? ORDER BY ts').bind(from, to).all();
  return results;
}

/** Column-oriented series for the 8 stacked charts. */
function toSeries(day) {
  const S = { t: [], load: [], grid: [], pv1: [], pv2: [], pv: [], c1: [], c2: [], net: [], v: [] };
  for (const s of day) {
    const c1 = s.inv_chg_a == null && s.inv_dis_a == null ? null : r2((s.inv_chg_a ?? 0) - (s.inv_dis_a ?? 0));
    S.t.push(s.ts);
    S.load.push(s.load_w);
    S.grid.push(gridW(s));
    S.pv1.push(s.inv_pv_w);
    S.pv2.push(s.mppt_pv_w);
    S.pv.push(s.inv_pv_w == null && s.mppt_pv_w == null ? null : r2((s.inv_pv_w ?? 0) + (s.mppt_pv_w ?? 0)));
    S.c1.push(c1);
    S.c2.push(s.mppt_a);
    S.net.push(c1 == null && s.mppt_a == null ? null : r2(netBatteryA(s)));
    S.v.push(s.batt_v);
  }
  return S;
}

async function apiMonth(env, month) {
  const c = cfg(env);
  const today = localDate(Date.now());
  const { results } = await env.DB.prepare("SELECT date, data FROM daily WHERE date LIKE ? AND date < ? ORDER BY date").bind(month + '-%', today).all();
  const out = results.map((r) => ({ date: r.date, ...JSON.parse(r.data) }));
  if (today.startsWith(month)) {
    const [a, b] = dayRange(today);
    const list = await samplesBetween(env, a, b);
    if (list.length) out.push({ date: today, ...summarizeDay(list, c) });
  }
  return out;
}

/**
 * Where "เหลือใช้ได้" comes from: carry-over from yesterday (0 when the bank hit the 50 V cut-off — counting then
 * restarts from 0 at that moment) + Ah charged in − Ah used since then.
 */
async function remainBreakdown(env, latest, c) {
  if (!latest) return null;
  const soc = latest.soc_calc ?? latest.soc;
  const [a] = dayRange(localDate(latest.ts));
  const list = await samplesBetween(env, a, latest.ts + 1);
  if (!list.length || soc == null) return null;
  let k = 0, reset = false;
  for (let i = 0; i < list.length; i++) {
    const v = validBattV(list[i].batt_v);
    if (v != null && v <= c.cutoffV) { k = i; reset = true; }   // last time today it touched the cut-off
  }
  const first = list[0].soc_calc ?? list[0].soc;
  const carry = reset ? 0 : Math.max(0, (((first ?? c.cutoffSoc) - c.cutoffSoc) / 100) * c.capacityAh);
  const sum = summarizeDay(list.slice(k), c);
  const remain = Math.max(0, ((soc - c.cutoffSoc) / 100) * c.capacityAh);
  const wasted = carry + sum.ahIn - sum.ahOut - remain;
  return {
    carryAh: Math.round(carry), inAh: r2(sum.ahIn), outAh: r2(sum.ahOut), remainAh: Math.round(remain),
    resetAt: reset ? list[k].ts : null, fullAh: wasted > 2 ? Math.round(wasted) : 0,
  };
}

async function apiNow(env) {
  const c = cfg(env);
  const latest = await env.DB.prepare('SELECT * FROM samples ORDER BY ts DESC LIMIT 1').first();
  const today = localDate(Date.now());
  const [a, b] = dayRange(today);
  const day = await samplesBetween(env, a, b);
  const ml = await kvGet(env.DB, 'mppt_last');
  return {
    mpptSleeping: !!(ml && mpptAsleep(ml)),
    bms: await bmsNow(env),
    config: { ...c, dayStartH: DAY_START_H },
    latest: latest && { ...latest, net_a: r2(netBatteryA(latest)), grid_w: gridW(latest, c.nominalV) },
    eta: latest ? timeToCutoff(latest, c) : null,
    remain: await remainBreakdown(env, latest, c),
    today: { date: today, ...summarizeDay(day, c) },
    series: toSeries(day),
  };
}

async function apiDay(env, date) {
  const c = cfg(env);
  const [a, b] = dayRange(date);
  const day = await samplesBetween(env, a, b);
  return {
    date,
    summary: summarizeDay(day, c),
    series: toSeries(day),
  };
}

const SUM_KEYS = ['ahIn', 'ahOut', 'ahInvChg', 'ahMppt', 'ahInvDis', 'mpptToInvAh', 'kwhIn', 'kwhOut',
  'pvTotalKwh', 'pvInvKwh', 'pvMpptKwh', 'kwhLoad', 'sunPvKwh', 'sunLoadKwh', 'gridKwh', 'gridMinutes'];

/** Totals over a span of days: sums of the per-day summaries (today's part comes live from samples). */
async function apiRange(env, from, to) {
  const c = cfg(env);
  const today = localDate(Date.now());
  const { results } = await env.DB.prepare('SELECT date, data FROM daily WHERE date >= ? AND date <= ? AND date < ? ORDER BY date')
    .bind(from, to, today).all();
  const days = results.map((r) => ({ date: r.date, ...JSON.parse(r.data) }));
  if (to >= today && from <= today) {
    const [a, b] = dayRange(today);
    const list = await samplesBetween(env, a, b);
    if (list.length) days.push({ date: today, ...summarizeDay(list, c) });
  }
  const t = {};
  for (const k of SUM_KEYS) t[k] = Math.round(days.reduce((x, d) => x + (d[k] || 0), 0) * 100) / 100;
  t.gridPeakW = days.reduce((x, d) => Math.max(x, d.gridPeakW || 0), 0);
  t.cutoffDays = days.filter((d) => d.cutoffAt).length;
  let low = null;
  for (const d of days) if (d.minV != null && (low == null || d.minV < low.v)) low = { v: d.minV, date: d.date, at: d.minVAt };
  t.minV = low ? low.v : null;
  t.minVDate = low ? low.date : null;
  t.minVAt = low ? low.at : null;
  return { from, to, days: days.length, totals: t };
}

async function apiHistory(env, days) {
  const c = cfg(env);
  const today = localDate(Date.now());
  const [a, b] = dayRange(today);
  const live = { date: today, ...summarizeDay(await samplesBetween(env, a, b), c) };
  const { results } = await env.DB.prepare('SELECT date, data FROM daily WHERE date < ? ORDER BY date DESC LIMIT ?').bind(today, days).all();
  const past = results.map((r) => ({ date: r.date, ...JSON.parse(r.data) }));
  return live.samples ? [live, ...past] : past;
}

// ---- HTTP ------------------------------------------------------------------

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

function authorized(req, env) {
  if (!env.APP_KEY) return true;
  const url = new URL(req.url);
  return (req.headers.get('x-key') || url.searchParams.get('key')) === env.APP_KEY;
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const path = url.pathname;

    if (path === '/' || path === '/index.html') {
      return new Response(PAGE, { headers: { 'content-type': 'text/html; charset=utf-8' } });
    }
    if (path === '/flash') return new Response(FLASH_PAGE, { headers: { 'content-type': 'text/html; charset=utf-8' } });
    if (path === '/flash/manifest.json') return json(FLASH_MANIFEST);
    if (path === '/manifest.json') {
      return json({
        name: 'โซลาร์บ้าน', short_name: 'โซลาร์บ้าน', start_url: '/', display: 'standalone',
        background_color: '#0f1412', theme_color: '#0f1412',
        icons: [{ src: '/icon.png', sizes: '180x180', type: 'image/png' }, { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' }],
      });
    }
    if (path === '/icon.png' || path === '/icon-512.png') {
      const b64 = path === '/icon.png' ? ICON_180 : ICON_512;
      const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      return new Response(bin, { headers: { 'content-type': 'image/png', 'cache-control': 'public, max-age=86400' } });
    }

    if (path === '/sw.js') return new Response(SW_JS, { headers: { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-cache' } });
    if (!path.startsWith('/api/')) return new Response('not found', { status: 404 });
    if (!authorized(req, env)) return json({ error: 'unauthorized' }, 401);

    try {
      if (path === '/api/bms' && req.method === 'POST') return json(await apiBmsPost(env, await req.json()));
      if (path === '/api/bms/pause') return json(await apiBmsPause(env, url.searchParams.get('min')));
      if (path === '/api/push/key') return json({ key: (await vapidKeys(env.DB)).pub, devices: ((await kvGet(env.DB, 'push_subs')) || []).length });
      if (path === '/api/push/sub' && req.method === 'POST') return json(await addSub(env.DB, await req.json()));
      if (path === '/api/push/unsub' && req.method === 'POST') return json(await removeSub(env.DB, (await req.json()).endpoint));
      if (path === '/api/push/test') return json(await pushAll(env, { title: '🔔 ทดสอบแจ้งเตือน', body: 'โซลาร์บ้านส่งแจ้งเตือนมาที่เครื่องนี้ได้แล้ว', tag: 'test' }));
      if (path === '/api/now') return json(await apiNow(env));
      if (path === '/api/day') return json(await apiDay(env, url.searchParams.get('date') || localDate(Date.now())));
      if (path === '/api/history') return json(await apiHistory(env, Math.min(3650, Number(url.searchParams.get('days') || 14))));
      if (path === '/api/month') return json(await apiMonth(env, (url.searchParams.get('m') || localDate(Date.now()).slice(0, 7)).slice(0, 7)));
      if (path === '/api/range') {
        const ok = (x) => /^\d{4}-\d{2}-\d{2}$/.test(x || '');
        let from = url.searchParams.get('from'), to = url.searchParams.get('to');
        if (!ok(from) || !ok(to)) return json({ error: 'bad dates' }, 400);
        if (from > to) [from, to] = [to, from];
        const span = (Date.parse(to) - Date.parse(from)) / 86400000;
        if (span > 366) return json({ error: 'range too long (max 366 days)' }, 400);
        return json(await apiRange(env, from, to));
      }
      if (path === '/api/poll') return json(await poll(env, { force: true }));
      if (path === '/api/debug') return json(await kvGet(env.DB, 'last_raw'));
      return json({ error: 'not found' }, 404);
    } catch (e) {
      return json({ error: e.message }, 500);
    }
  },

  async scheduled(_event, env, ctx) {
    ctx.waitUntil(poll(env));
  },
};

import { readInverter } from './dess.js';
import { readMppt } from './tuya.js';
import { summarizeDay, timeToCutoff, netBatteryA } from './calc.js';
import { localDate, dayRange, kvGet, kvSet, DAY_START_H } from './util.js';
import { PAGE } from './page.js';
import { stepSoc } from './soc.js';
import { ICON_180, ICON_512 } from './icon.js';

function cfg(env) {
  return {
    capacityAh: Number(env.CAPACITY_AH || 434),
    cutoffV: Number(env.CUTOFF_V || 50),
    cutoffSoc: Number(env.CUTOFF_SOC || 10),
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
    batt_v: r2(i.battV ?? m.battV),
    soc: i.soc ?? null,
    inv_chg_a: r2(i.chgA),
    inv_dis_a: r2(i.disA),
    mppt_a: r2(m.battA),
    inv_pv_w: r2(i.pvW),
    mppt_pv_w: r2(m.pvW),
    load_w: r2(i.loadW),
    grid_v: r2(i.gridV),
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
  // App-side battery % (Ah counting + voltage calibration at rest).
  if (row.batt_v != null) {
    const st = stepSoc(await kvGet(env.DB, 'soc_state'), { ts: row.ts, v: row.batt_v, net: netBatteryA(row) }, cfg(env).capacityAh);
    await kvSet(env.DB, 'soc_state', st);
    row.soc_calc = st.soc == null ? null : Math.round(st.soc * 10) / 10;
  }
  const cols = Object.keys(row);
  await env.DB.prepare(`INSERT OR REPLACE INTO samples (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`)
    .bind(...cols.map((c) => row[c]))
    .run();

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
  }
  return row;
}

/**
 * Re-baseline the app battery %: start at the empty point (cut-off %) from the last time the bank
 * touched the cut-off voltage in the past 24 h (or from 05:00 today if it never did), then replay
 * every sample's net current up to now and rewrite soc_calc for those rows.
 */
export async function rebaseSoc(env, now) {
  const c = cfg(env);
  const hit = await env.DB.prepare('SELECT ts FROM samples WHERE ts >= ? AND batt_v <= ? ORDER BY ts DESC LIMIT 1')
    .bind(now - 86400000, c.cutoffV + 0.2).first();
  const from = hit ? hit.ts : dayRange(localDate(now))[0];
  const list = await samplesBetween(env, from, now + 1);
  if (!list.length) return null;
  let st = { soc: c.cutoffSoc, ts: list[0].ts, restSince: null, fullSince: null, src: 'rebase' };
  const upd = [];
  for (let i = 0; i < list.length; i++) {
    const s = list[i];
    if (i > 0 && s.batt_v != null) st = stepSoc(st, { ts: s.ts, v: s.batt_v, net: netBatteryA(s) }, c.capacityAh);
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

// ---- reads -----------------------------------------------------------------

async function samplesBetween(env, from, to) {
  const { results } = await env.DB.prepare('SELECT * FROM samples WHERE ts >= ? AND ts < ? ORDER BY ts').bind(from, to).all();
  return results;
}

/** Column-oriented series for the 8 stacked charts. */
function toSeries(day) {
  const S = { t: [], load: [], pv1: [], pv2: [], pv: [], c1: [], c2: [], net: [], v: [] };
  for (const s of day) {
    const c1 = s.inv_chg_a == null && s.inv_dis_a == null ? null : r2((s.inv_chg_a ?? 0) - (s.inv_dis_a ?? 0));
    S.t.push(s.ts);
    S.load.push(s.load_w);
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

async function apiNow(env) {
  const c = cfg(env);
  const latest = await env.DB.prepare('SELECT * FROM samples ORDER BY ts DESC LIMIT 1').first();
  const today = localDate(Date.now());
  const [a, b] = dayRange(today);
  const day = await samplesBetween(env, a, b);
  const ml = await kvGet(env.DB, 'mppt_last');
  return {
    mpptSleeping: !!(ml && mpptAsleep(ml)),
    config: { ...c, dayStartH: DAY_START_H },
    latest: latest && { ...latest, net_a: r2(netBatteryA(latest)) },
    eta: latest ? timeToCutoff(latest, c) : null,
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

    if (!path.startsWith('/api/')) return new Response('not found', { status: 404 });
    if (!authorized(req, env)) return json({ error: 'unauthorized' }, 401);

    try {
      if (path === '/api/now') return json(await apiNow(env));
      if (path === '/api/day') return json(await apiDay(env, url.searchParams.get('date') || localDate(Date.now())));
      if (path === '/api/history') return json(await apiHistory(env, Math.min(3650, Number(url.searchParams.get('days') || 14))));
      if (path === '/api/month') return json(await apiMonth(env, (url.searchParams.get('m') || localDate(Date.now()).slice(0, 7)).slice(0, 7)));
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

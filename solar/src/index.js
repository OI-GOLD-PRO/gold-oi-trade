import { readInverter } from './dess.js';
import { readMppt } from './tuya.js';
import { summarizeDay, timeToCutoff, netBatteryA } from './calc.js';
import { localDate, dayRange, kvGet, kvSet } from './util.js';
import { PAGE } from './page.js';

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
async function readMpptThrottled(env, force) {
  const every = Number(env.MPPT_EVERY_MIN || 2);
  const cached = await kvGet(env.DB, 'mppt_last');
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
    mppt_temp: m.tempC ?? null,
    err: errs.length ? errs.join(' | ') : null,
  };
  const cols = Object.keys(row);
  await env.DB.prepare(`INSERT OR REPLACE INTO samples (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`)
    .bind(...cols.map((c) => row[c]))
    .run();

  await kvSet(env.DB, 'last_raw', {
    ts: row.ts,
    inverter: inv.status === 'fulfilled' ? inv.value : String(inv.reason),
    mppt: mppt.status === 'fulfilled' ? mppt.value : String(mppt.reason),
  });

  // Daily summary (kept forever): today every 10 min, and yesterday once just after midnight.
  const nowLocal = new Date(row.ts + 7 * 3600000);
  const min = nowLocal.getUTCMinutes();
  if (min % 10 === 0) await saveDay(env, localDate(row.ts));
  if (nowLocal.getUTCHours() === 0 && min === 5) await saveDay(env, localDate(row.ts - 86400000));

  // Keep ~120 days of per-minute samples (daily summaries stay).
  if (nowLocal.getUTCHours() === 3 && min === 0) {
    await env.DB.prepare('DELETE FROM samples WHERE ts < ?').bind(Date.now() - 120 * 86400000).run();
  }
  return row;
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

async function apiNow(env) {
  const c = cfg(env);
  const latest = await env.DB.prepare('SELECT * FROM samples ORDER BY ts DESC LIMIT 1').first();
  const today = localDate(Date.now());
  const [a, b] = dayRange(today);
  const day = await samplesBetween(env, a, b);
  return {
    config: c,
    latest: latest && { ...latest, net_a: r2(netBatteryA(latest)) },
    eta: latest ? timeToCutoff(latest, c) : null,
    today: { date: today, ...summarizeDay(day, c) },
    series: day.map((s) => ({ t: s.ts, soc: s.soc, v: s.batt_v, a: r2(netBatteryA(s)), pv: (s.inv_pv_w ?? 0) + (s.mppt_pv_w ?? 0), load: s.load_w })),
  };
}

async function apiDay(env, date) {
  const c = cfg(env);
  const [a, b] = dayRange(date);
  const day = await samplesBetween(env, a, b);
  return {
    date,
    summary: summarizeDay(day, c),
    series: day.map((s) => ({ t: s.ts, soc: s.soc, v: s.batt_v, a: r2(netBatteryA(s)), pv: (s.inv_pv_w ?? 0) + (s.mppt_pv_w ?? 0), load: s.load_w })),
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
        name: 'โซลาร์บ้าน', short_name: 'โซลาร์', start_url: '/', display: 'standalone',
        background_color: '#0f1412', theme_color: '#0f1412',
        icons: [{ src: '/icon.svg', sizes: 'any', type: 'image/svg+xml' }],
      });
    }
    if (path === '/icon.svg') {
      return new Response(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#0f1412"/><circle cx="32" cy="26" r="11" fill="#f2b33d"/><rect x="14" y="42" width="36" height="10" rx="2" fill="#3fbf8a"/></svg>',
        { headers: { 'content-type': 'image/svg+xml' } },
      );
    }

    if (!path.startsWith('/api/')) return new Response('not found', { status: 404 });
    if (!authorized(req, env)) return json({ error: 'unauthorized' }, 401);

    try {
      if (path === '/api/now') return json(await apiNow(env));
      if (path === '/api/day') return json(await apiDay(env, url.searchParams.get('date') || localDate(Date.now())));
      if (path === '/api/history') return json(await apiHistory(env, Math.min(3650, Number(url.searchParams.get('days') || 14))));
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

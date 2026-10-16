// SmartESS / DessMonitor cloud client (unofficial, reverse-engineered API).
// Signing scheme: sign = SHA1(salt + SHA1(password) + "&" + query)       for login
//                 sign = SHA1(salt + secret + token + "&" + query)       for data calls
import { sha1, kvGet, kvSet } from './util.js';

const BASE = 'https://web.dessmonitor.com/public/';
const DEFAULT_COMPANY_KEY = 'bnrl_frRFjEz8Mkn';

/** Same encoding the dessmonitor.com web app signs (query-string with a few escapes undone). */
export function toQuery(params) {
  return Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join('&')
    .replace(/%20/g, '+')
    .replace(/%2B/g, '+')
    .replace(/%3A/g, ':')
    .replace(/%2C/g, ',')
    .replace(/%40/g, '@')
    .replace(/%24/g, '$')
    .replace(/%26/g, '&')
    .replace(/%3D/g, '=')
    .replace(/%28/g, '(')
    .replace(/%29/g, ')');
}

async function getJson(url) {
  const res = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0 solar-monitor' } });
  if (!res.ok) throw new Error(`DESS HTTP ${res.status}`);
  return res.json();
}

async function login(env) {
  if (!env.DESS_USER || !env.DESS_PASSWORD) throw new Error('ยังไม่ได้ตั้ง DESS_USER / DESS_PASSWORD');
  const salt = Date.now().toString();
  const params = {
    action: 'authSource',
    usr: env.DESS_USER,
    source: '1',
    'company-key': env.DESS_COMPANY_KEY || DEFAULT_COMPANY_KEY,
  };
  const q = toQuery(params);
  const sign = await sha1(`${salt}${await sha1(env.DESS_PASSWORD)}&${q}`);
  const data = await getJson(`${BASE}?sign=${sign}&salt=${salt}&${q}`);
  if (data.err !== 0 || !data.dat?.token) {
    throw new Error(`SmartESS login ไม่ผ่าน (err ${data.err} ${data.desc || ''})`);
  }
  const { token, secret, expire } = data.dat;
  const lifeMs = (Number(expire) || 86400) * 1000;
  const auth = { token, secret, expiresAt: Date.now() + lifeMs - Math.min(3600000, lifeMs / 2) };
  await kvSet(env.DB, 'dess_auth', auth);
  return auth;
}

async function request(env, params, retried = false) {
  let auth = await kvGet(env.DB, 'dess_auth');
  if (!auth || Date.now() >= auth.expiresAt) auth = await login(env);
  const salt = Date.now().toString();
  const q = toQuery(params);
  const sign = await sha1(`${salt}${auth.secret}${auth.token}&${q}`);
  const data = await getJson(`${BASE}?sign=${sign}&salt=${salt}&token=${auth.token}&${q}`);
  if (data.err !== 0) {
    // Token rejected/expired early → log in again once.
    if (!retried && [0x0002, 0x0003, 0x0004, 0x000b, 0x0105].includes(Number(data.err))) {
      await kvSet(env.DB, 'dess_auth', null);
      return request(env, params, true);
    }
    throw new Error(`SmartESS ${params.action} err ${data.err} ${data.desc || ''}`);
  }
  return data.dat;
}

/** Find the inverter (pn/sn/devcode/devaddr) once and cache it. */
function dayEnergyFromPars(m) {
  for (const [k, it] of m) {
    if (/(today|of_day|day).*(energy|generat)|(energy|generat).*(today|of_day|day)/i.test(k) && /pv|solar|generat/i.test(k)) {
      const v = toNum(it);
      if (v != null) return /^wh$/i.test((it.unit || '').trim()) ? v / 1000 : v;
    }
  }
  return null;
}

async function getDevice(env) {
  const cached = await kvGet(env.DB, 'dess_device');
  if (cached) return cached;
  const dat = await request(env, { action: 'webQueryDeviceEs', i18n: 'en_US', source: '1', page: '0', pagesize: '50' });
  const list = dat.device || [];
  const want = (env.DESS_SN || '').trim();
  const d = (want && list.find((x) => String(x.sn) === want || String(x.pn) === want)) || list[0];
  if (!d) throw new Error('ไม่พบอินเวอร์เตอร์ในบัญชี SmartESS');
  const device = { pn: String(d.pn), sn: String(d.sn), devcode: String(d.devcode), devaddr: String(d.devaddr) };
  await kvSet(env.DB, 'dess_device', device);
  return device;
}

// ---- value extraction ------------------------------------------------------

function toNum(item) {
  if (!item) return null;
  const n = Number(item.val);
  if (!Number.isFinite(n)) return null;
  return /^kw$/i.test((item.unit || '').trim()) ? n * 1000 : n; // normalise kW → W
}

/** Flatten {gd_:[...], bt_:[...]} into id/par lookups. */
function indexPars(pars = {}) {
  const map = new Map();
  for (const group of Object.values(pars)) {
    if (!Array.isArray(group)) continue;
    for (const it of group) {
      for (const key of [it?.id, it?.par]) if (key != null && !map.has(key)) map.set(key, it);
    }
  }
  return map;
}

function pick(map, keys) {
  for (const k of keys) {
    const v = toNum(map.get(k));
    if (v != null) return v;
  }
  return null;
}

function flowPick(flow, group, par) {
  const hit = flow?.[group]?.find?.((i) => i.par === par);
  return hit ? toNum(hit) : null;
}

/** Read the inverter's latest values in a normalised shape. */
export async function readInverter(env) {
  const dev = await getDevice(env);
  const base = { pn: dev.pn, devcode: dev.devcode, devaddr: dev.devaddr, sn: dev.sn };
  const [last, flow, list] = await Promise.all([
    request(env, { action: 'querySPDeviceLastData', i18n: 'en_US', ...base, source: '1' }),
    request(env, { action: 'webQueryDeviceEnergyFlowEs', ...base, source: '1' }).catch(() => null),
    request(env, { action: 'webQueryDeviceEs', i18n: 'en_US', source: '1', page: '0', pagesize: '15', pn: dev.pn }).catch(() => null),
  ]);
  const row = (list?.device || []).find((d) => String(d.sn) === dev.sn) || list?.device?.[0];
  const m = indexPars(last.pars);
  const out = {
    battV: pick(m, ['bt_battery_voltage', 'Battery Voltage']),
    soc: pick(m, ['bt_battery_capacity', 'bt_battery_soc', 'Battery Capacity']) ?? flowPick(flow, 'bt_status', 'bt_battery_capacity') ?? flowPick(flow, 'bt_status', 'battery_soc'),
    chgA: pick(m, ['bt_battery_charging_current', 'Battery Charging Current']),
    disA: pick(m, ['bt_battery_discharge_current', 'Battery Discharge Current']),
    pvW: pick(m, ['pv_output_power', 'pv_input_power', 'PV Input Power']) ?? flowPick(flow, 'pv_status', 'pv_output_power'),
    pvV: pick(m, ['pv_input_voltage', 'PV Input Voltage']),
    loadW: flowPick(flow, 'bc_status', 'load_active_power') ?? pick(m, ['bc_output_active_power', 'bc_load_active_power', 'Output Active Power']),
    gridV: pick(m, ['gd_ac_input_voltage', 'gd_grid_voltage', 'AC Input Voltage']),
    pvTodayKwh: null,
  };
  const rowToday = row?.energyToday != null ? Number(row.energyToday) : null;
  out.pvTodayKwh = dayEnergyFromPars(m) ?? (Number.isFinite(rowToday) ? rowToday : null);
  return { values: out, raw: { pars: last.pars, flow, deviceRow: row } };
}

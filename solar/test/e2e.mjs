// End-to-end: real Worker code, fake D1 (node:sqlite) and fake upstream APIs.
import fs from 'node:fs';
import http from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import worker, { poll } from '../src/index.js';

const sql = new DatabaseSync(':memory:');
sql.exec(fs.readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
const DB = {
  async batch(stmts) { for (const st of stmts) await st.run(); return []; },
  prepare(q) {
    let args = [];
    const st = {
      bind(...a) { args = a; return st; },
      async run() { sql.prepare(q).run(...args); return {}; },
      async first() { return sql.prepare(q).get(...args) ?? null; },
      async all() { return { results: sql.prepare(q).all(...args) }; },
    };
    return st;
  },
};
const env = { DB, APP_KEY: 'demo', DESS_USER: 'u', DESS_PASSWORD: 'p', TUYA_CLIENT_ID: 'c', TUYA_SECRET: 's', TUYA_DEVICE_ID: 'a388c65aef93d7a41bfjah', TUYA_REGION: 'sg' };

// Simulated day: sun 6–18h, battery charged by day, drained at night.
let clock = Date.parse('2026-10-15T23:00:00Z'); // 06:00 Bangkok
const realNow = Date.now;
Date.now = () => clock;
let soc = 45;
function sim() {
  const h = (new Date(clock + 7 * 3600e3).getUTCHours() + new Date(clock).getUTCMinutes() / 60);
  const sun = Math.max(0, Math.sin(((h - 6) / 12) * Math.PI));
  const pv1 = Math.round(3200 * sun * (0.85 + Math.random() * 0.15));
  const pv2 = Math.round(2300 * sun * (0.85 + Math.random() * 0.15));
  const load = 450 + Math.round(Math.random() * 400) + (h > 18 && h < 22 ? 900 : 0);
  const mpptA = pv2 * 0.95 / 52.5;
  const invNetW = pv1 * 0.93 - load;
  const chg = invNetW > 0 ? invNetW / 52.5 : 0, dis = invNetW < 0 ? -invNetW / 52 : 0;
  soc = Math.max(8, Math.min(100, soc + ((mpptA + chg - dis) * (5 / 60) / 434) * 100));
  const v = 50 + soc / 100 * 4;
  return { pv1, pv2, load, mpptA, chg, dis, soc, v };
}
let cur;
globalThis.invKwh = 0;
globalThis.fetch = async (url) => {
  url = String(url);
  const J = (o) => new Response(JSON.stringify(o));
  if (url.includes('dessmonitor')) {
    if (url.includes('authSource')) return J({ err: 0, dat: { token: 't', secret: 's', expire: 604800 } });
    if (url.includes('webQueryDeviceEs')) return J({ err: 0, dat: { device: [{ pn: 'Q0044528678206', sn: 'Q004452867820609AD05', devcode: 2451, devaddr: 1, energyToday: (globalThis.invKwh || 0).toFixed(1) }] } });
    if (url.includes('querySPDeviceLastData')) return J({ err: 0, dat: { pars: {
      bt_: [{ id: 'bt_battery_voltage', val: cur.v.toFixed(1) }, { id: 'bt_battery_capacity', val: Math.round(cur.soc) }, { id: 'bt_battery_charging_current', val: cur.chg.toFixed(1) }, { id: 'bt_battery_discharge_current', val: cur.dis.toFixed(1) }],
      pv_: [{ id: 'pv_output_power', val: cur.pv1 }], gd_: [{ id: 'gd_ac_input_voltage', val: '236.3' }], bc_: [{ id: 'bc_output_active_power', val: cur.load }] } } });
    if (url.includes('EnergyFlow')) return J({ err: 0, dat: {} });
  }
  if (url.includes('/v1.0/token')) return J({ success: true, result: { access_token: 'x', expire_time: 7200 } });
  if (url.includes('shadow/properties')) {
    globalThis.tuyaCalls = (globalThis.tuyaCalls || 0) + 1;
    const b = (v, a, w) => Buffer.from([v >> 8, v & 255, a >> 8, a & 255, w >> 8, w & 255]).toString('base64');
    return J({ success: true, result: { properties: [
      { code: 'cur_power', value: Math.round(cur.mpptA * cur.v * 10) },
      { code: 'phase_a', value: b(1650, Math.round(cur.pv2 / 16.5), cur.pv2 * 10) },
      { code: 'phase_b', value: b(Math.round(cur.v * 10), Math.round(cur.mpptA * 10), 0) },
      { code: 'forward_energy_total', value: 0 }, { code: 'temp_current', value: 44 } ] } });
  }
  throw new Error('unexpected ' + url);
};

const steps = Number(process.argv[2] || 140); // 06:00 → ~17:40
for (let i = 0; i < steps; i++) { cur = sim(); if (new Date(clock + 7 * 3600e3).getUTCHours() === 0 && new Date(clock).getUTCMinutes() === 0) globalThis.invKwh = 0; globalThis.invKwh += cur.pv1 * Number(process.env.STEP_MS || 300000) / 3.6e9; await poll(env); clock += Number(process.env.STEP_MS || 300000); }
const res = await worker.fetch(new Request('https://x/api/now', { headers: { 'x-key': 'demo' } }), env);
const now = await res.json();
console.log('latest', now.latest, '\neta', now.eta, '\ntoday', now.today);
const unauth = await worker.fetch(new Request('https://x/api/now'), env);
console.log('no key →', unauth.status);
const hist = await (await worker.fetch(new Request('https://x/api/history?days=30', { headers: { 'x-key': 'demo' } }), env)).json();
console.log('tuya calls:', globalThis.tuyaCalls, '| polls:', steps, '| daily rows:', sql.prepare('SELECT COUNT(*) n FROM daily').get().n);
console.log('history:', hist.map((h) => `${h.date} in ${h.ahIn} out ${h.ahOut} samples ${h.samples}`));

// Serve the page + API locally for a visual check.
if (process.argv[3] === 'serve') {
  Date.now = realNow; const frozen = clock;
  Date.now = () => frozen + 60000;
  http.createServer(async (req, res) => {
    const r = await worker.fetch(new Request('http://localhost' + req.url, { headers: req.headers }), env);
    res.writeHead(r.status, Object.fromEntries(r.headers)); res.end(Buffer.from(await r.arrayBuffer()));
  }).listen(8787, () => console.log('serving on 8787'));
}

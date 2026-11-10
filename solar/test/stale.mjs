// Replaced Wi-Fi dongle: SmartESS lists a new sn → app re-discovers it; frozen stretch is blanked by the repair.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import worker, { frozenRuns } from '../src/index.js';
import { readInverter } from '../src/dess.js';

const sql = new DatabaseSync(':memory:');
sql.exec(fs.readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
const DB = { prepare(q) { let a = []; const st = { bind(...x) { a = x; return st; }, async run() { sql.prepare(q).run(...a); return { meta: {} }; }, async first() { return sql.prepare(q).get(...a) ?? null; }, async all() { return { results: sql.prepare(q).all(...a) }; } }; return st; } };
DB.batch = async (l) => { for (const x of l) await x.run(); };
const env = { DB, APP_KEY: 'demo', DESS_USER: 'u', DESS_PASSWORD: 'p' };
const kv = (k, v) => sql.prepare('INSERT OR REPLACE INTO kv (k, v) VALUES (?, ?)').run(k, JSON.stringify(v));

// SmartESS mock: only the new dongle exists; the old sn still answers with frozen values
const NEW = { pn: 'Q0044528678206', sn: 'NEWSN', devcode: 2477, devaddr: 5 };
const asked = [];
globalThis.fetch = async (url) => {
  const u = new URL(url); const action = u.searchParams.get('action');
  if (!u.host.includes('dessmonitor')) throw new Error('offline');
  if (action === 'authSource') return Response.json({ err: 0, dat: { token: 't', secret: 's', expire: 86400 } });
  if (action === 'webQueryDeviceEs') return Response.json({ err: 0, dat: { device: [NEW] } });
  if (action === 'querySPDeviceLastData') {
    asked.push(u.searchParams.get('sn'));
    const old = u.searchParams.get('sn') !== 'NEWSN';
    return Response.json({ err: 0, dat: { pars: { bt_: [{ id: 'bt_battery_voltage', val: old ? '50.8' : '52.4' }], bc_: [{ id: 'bc_output_active_power', val: old ? '498' : '730' }] } } });
  }
  return Response.json({ err: 0, dat: {} });
};
kv('dess_device', { pn: NEW.pn, sn: 'OLDSN', devcode: '2477', devaddr: '5' });
const r = await readInverter(env);
assert.equal(r.values.battV, 52.4, 'reads the new dongle');
assert.equal(JSON.parse(sql.prepare("SELECT v FROM kv WHERE k='dess_device'").get().v).sn, 'NEWSN');
console.log('rediscover OK', asked);

// frozen runs
const t0 = 1_700_000_000_000;
const L = [];
for (let i = 0; i < 100; i++) L.push({ ts: t0 + i * 60000, batt_v: i >= 40 && i < 80 ? 50.8 : 52 + (i % 3) / 10, load_w: i >= 40 && i < 80 ? 498 : 400 + i, inv_pv_w: 0, inv_chg_a: 0, inv_dis_a: 0, grid_v: 230, inv_mode: 'Line Mode' });
assert.deepEqual(frozenRuns(L, 30), [[t0 + 40 * 60000, t0 + 79 * 60000]]);
assert.deepEqual(frozenRuns(L.slice(0, 60), 30), []);

// worker repair: frozen 90 minutes up to now → blanked; the fresh poll value is stored
const now = Date.now();
const ins = sql.prepare('INSERT INTO samples (ts, batt_v, load_w, inv_pv_w, inv_chg_a, inv_dis_a, grid_v, inv_mode, mppt_a, mppt_pv_w) VALUES (?,?,?,?,?,?,?,?,?,?)');
for (let t = now - 3 * 3600000, k = 0; t < now - 30000; t += 60000, k++) {
  const frozen = t > now - 90 * 60000;
  ins.run(t, frozen ? 50.8 : 52 + (k % 4) / 10, frozen ? 498 : 500 + k, 0, 0, 3, 230, 'Line Mode', 10, 600 + k);
}
for (const k of ['soc_rebase_v1', 'daily_recalc_grid_v1', 'bad_v_repair_v1', 'soc_pure_v1', 'spike_repair_v1']) kv(k, {});
kv('dess_device', { pn: NEW.pn, sn: 'OLDSN', devcode: '2477', devaddr: '5' });
await worker.fetch(new Request('https://x/api/poll', { headers: { 'x-key': 'demo' } }), env);
const blank = sql.prepare('SELECT COUNT(*) n FROM samples WHERE load_w IS NULL AND mppt_pv_w IS NOT NULL').get().n;
assert.ok(blank >= 85 && blank <= 91, 'blanked ' + blank);
assert.equal(sql.prepare('SELECT batt_v FROM samples ORDER BY ts DESC LIMIT 1').get().batt_v, 52.4);
console.log('repair OK', JSON.parse(sql.prepare("SELECT v FROM kv WHERE k='dess_stale_repair_v1'").get().v));

// MPPT offline (Tuya keeps serving 14-hour-old values) → error, no frozen numbers stored
{
  const prevFetch = globalThis.fetch;
  const old = Date.now() - 14 * 3600000;
  globalThis.fetch = async (url, init) => {
    const u = String(url);
    if (u.includes('/v1.0/token')) return Response.json({ success: true, result: { access_token: 'x', expire_time: 7200 } });
    if (u.includes('shadow/properties')) return Response.json({ success: true, result: { properties: [
      { code: 'cur_power', value: 0, time: old }, { code: 'phase_a', value: Buffer.from([6, 126, 0, 45, 29, 93]).toString('base64'), time: old } ] } });
    return prevFetch(url, init);
  };
  env.TUYA_CLIENT_ID = 'c'; env.TUYA_SECRET = 's'; env.TUYA_DEVICE_ID = 'd';
  sql.prepare("DELETE FROM kv WHERE k='mppt_last'").run();
  await worker.fetch(new Request('https://x/api/poll', { headers: { 'x-key': 'demo' } }), env);
  const last = sql.prepare('SELECT mppt_pv_w, err FROM samples ORDER BY ts DESC LIMIT 1').get();
  assert.equal(last.mppt_pv_w, null);
  assert.match(last.err || '', /MPPT ออฟไลน์/);
  console.log('mppt offline OK', last.err);
}
console.log('stale OK');

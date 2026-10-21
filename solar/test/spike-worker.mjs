// Stored 1,900 A spikes and a zero dropout are repaired by the one-time repair; a live 1,900 A reading is never stored.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import worker from '../src/index.js';

const sql = new DatabaseSync(':memory:');
sql.exec(fs.readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
const DB = { prepare(q) { let a = []; const st = { bind(...x) { a = x; return st; }, async run() { const r = sql.prepare(q).run(...a); return { meta: { changes: Number(r.changes) } }; }, async first() { return sql.prepare(q).get(...a) ?? null; }, async all() { return { results: sql.prepare(q).all(...a) }; } }; return st; } };
DB.batch = async (l) => { for (const x of l) await x.run(); };
const env = { DB, APP_KEY: 'demo' };
const now = Date.now();
const ins = sql.prepare('INSERT INTO samples (ts, batt_v, mppt_a, inv_chg_a, inv_dis_a, inv_pv_w, load_w) VALUES (?,?,?,?,?,?,?)');
const start = now - 3 * 3600000;
for (let t = start; t < now; t += 60000) {
  const k = Math.round((t - start) / 60000);
  const spike = k === 60 || k === 61;
  const drop = k === 100 || k === 101;
  ins.run(t, 52.5, 10, spike ? 1900 : 12, 0, drop ? 0 : 1800, drop ? 0 : 900);
}
sql.prepare("INSERT INTO kv (k, v) VALUES ('soc_rebase_v1', '{}'), ('daily_recalc_grid_v1', '{}'), ('bad_v_repair_v1','{}'), ('soc_pure_v1','{}')").run();
globalThis.fetch = async () => { throw new Error('offline in test'); };
await worker.fetch(new Request('https://x/api/poll', { headers: { 'x-key': 'demo' } }), env);
assert.equal(sql.prepare('SELECT COUNT(*) n FROM samples WHERE inv_chg_a > 130').get().n, 0, 'spike gone');
assert.equal(sql.prepare('SELECT COUNT(*) n FROM samples WHERE load_w = 0 AND inv_pv_w = 0 AND ts < ?').get(now - 60000).n, 0, 'dropout gone');
assert.ok(sql.prepare("SELECT v FROM kv WHERE k='spike_repair_v1'").get(), 'repair recorded');
console.log('spike-worker OK');

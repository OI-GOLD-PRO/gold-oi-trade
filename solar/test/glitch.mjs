// A garbage battery-voltage reading (1.4 V) must not reset the % counter or pollute the day's min voltage.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import worker from '../src/index.js';
import { summarizeDay } from '../src/calc.js';
import { validBattV } from '../src/util.js';

assert.equal(validBattV(1.4), null); assert.equal(validBattV(52.3), 52.3); assert.equal(validBattV(null), null); assert.equal(validBattV(80), null);

const cfgc = { capacityAh: 434, cutoffV: 50, cutoffSoc: 10, nominalV: 51.2 };
const t0 = Date.parse('2026-10-20T00:00:00Z');
const S = [];
for (let i = 0; i <= 12; i++) S.push({ ts: t0 + i * 60000, batt_v: i === 6 ? 1.4 : 52, mppt_a: 20, inv_chg_a: 0, inv_dis_a: 0 });
const sum = summarizeDay(S, cfgc);
assert.equal(sum.minV, 52); assert.equal(sum.cutoffAt, null);

// full worker path: stored glitch + a cut-off 6 h earlier → repair clears it and replays the counter from the cut-off
const sql = new DatabaseSync(':memory:');
sql.exec(fs.readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
const DB = { prepare(q) { let a = []; const st = { bind(...x) { a = x; return st; }, async run() { const r = sql.prepare(q).run(...a); return { meta: { changes: Number(r.changes) } }; }, async first() { return sql.prepare(q).get(...a) ?? null; }, async all() { return { results: sql.prepare(q).all(...a) }; } }; st.batch = null; return st; } };
DB.batch = async (list) => { for (const x of list) await x.run(); };
const env = { DB, APP_KEY: 'demo' };
const now = Date.now();
const ins = sql.prepare('INSERT INTO samples (ts, batt_v, mppt_a, inv_chg_a, inv_dis_a, soc_calc) VALUES (?,?,?,?,?,?)');
const start = now - 6 * 3600000;
for (let t = start; t < now; t += 60000) {
  const v = t === start ? 50.1 : Math.abs(t - (now - 30 * 60000)) < 1 ? 1.4 : 52.5;
  ins.run(t, v, 36, 0, 0, 13);                                            // 36 A charging for 6 h ≈ 216 Ah
}
sql.prepare("INSERT INTO kv (k, v) VALUES ('soc_rebase_v1', '{}'), ('daily_recalc_grid_v1', '{}')").run();
globalThis.fetch = async () => { throw new Error('offline in test'); };
await worker.fetch(new Request('https://x/api/poll', { headers: { 'x-key': 'demo' } }), env);
assert.equal(sql.prepare('SELECT COUNT(*) n FROM samples WHERE batt_v < 40').get().n, 0);
const now2 = await (await worker.fetch(new Request('https://x/api/now', { headers: { 'x-key': 'demo' } }), env)).json();
const soc = now2.latest.soc_calc;
console.log('soc after repair', soc);
assert.ok(soc > 54 && soc < 59, 'expected ≈ 10 + 216/464*100 = 56.6 % (capacity 464 = 371.2 usable / 0.8), got ' + soc);
console.log('remain', JSON.stringify(now2.remain));
assert.ok(now2.remain && now2.remain.inAh > 200 && now2.remain.outAh === 0 && Math.abs(now2.remain.remainAh - (soc - 10) * 4.64) < 2 && now2.remain.fullAh === 0);
console.log('glitch OK');

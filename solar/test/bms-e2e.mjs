// Device → Worker → app round trip for the BMS relay (fake D1, no upstream calls).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import worker from '../src/index.js';

const sql = new DatabaseSync(':memory:');
sql.exec(fs.readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
const DB = { prepare(q) { let a = []; const st = { bind(...x) { a = x; return st; }, async run() { sql.prepare(q).run(...a); return {}; }, async first() { return sql.prepare(q).get(...a) ?? null; }, async all() { return { results: sql.prepare(q).all(...a) }; } }; return st; } };
const env = { DB, APP_KEY: 'demo', BMS_LABELS: 'A5:C2:39:41:66:FA=200 Ah,A4:C1:37:25:E5:E2=314 Ah' };

const hex = (a) => a.map((x) => x.toString(16).padStart(2, '0')).join('');
const w16 = (x) => [(x >> 8) & 255, x & 255];
const frame = (cmd, data) => { const body = [0, data.length, ...data]; const s = body.reduce((p, q) => p + q, 0); return hex([0xdd, cmd, ...body, ...w16((0x10000 - s) & 0xffff), 0x77]); };
const pack = (v, a, rem, nom, soc, cells) => ({
  basic: frame(0x03, [...w16(v), ...w16(a & 0xffff), ...w16(rem), ...w16(nom), ...w16(25), ...w16(0), 0, 0, 0, 0, ...w16(0), 0x41, soc, 3, 16, 1, ...w16(2731 + 285)]),
  cells: frame(0x04, cells.flatMap(w16)),
});
const call = async (path, init) => worker.fetch(new Request('https://x' + path, { headers: { 'x-key': 'demo', 'content-type': 'application/json' }, ...init }), env);

const p200 = pack(5250, -652, 6013, 19000, 32, Array(16).fill(3281));
const p314 = pack(5258, -805, 13259, 31400, 42, Array(16).fill(3285));
const body = { fw: '1.0', up: 99, b: [{ mac: 'a4:c1:37:25:e5:e2', age: 3, rssi: -60, ...p314 }, { mac: 'A5:C2:39:41:66:FA', age: 1, rssi: -55, ...p200 }, { mac: 'zz', ...p200 }] };

assert.equal((await worker.fetch(new Request('https://x/api/bms', { method: 'POST', body: '{}' }), env)).status, 401);
let now = await (await call('/api/now')).json();
assert.equal(now.bms, null);                                              // nothing reported yet
let r = await (await call('/api/bms', { method: 'POST', body: JSON.stringify(body) })).json();
assert.equal(r.ok, true); assert.equal(r.saved, 2); assert.equal(r.pause, 0);
r = await (await call('/api/bms', { method: 'POST', body: JSON.stringify(body) })).json();
assert.equal(r.saved, 0);                                                 // at most one stored row per battery per minute
now = await (await call('/api/now')).json();
assert.deepEqual(now.bms.packs.map((p) => p.label), ['200 Ah', '314 Ah']); // display order from BMS_LABELS
assert.equal(now.bms.total.remAh, 192.72); assert.equal(now.bms.total.nomAh, 504);
assert.equal(now.bms.total.a, -14.57); assert.equal(now.bms.total.live, true);
assert.equal(sql.prepare('SELECT COUNT(*) n FROM bms').get().n, 2);
// pause round trip
const pz = await (await call('/api/bms/pause?min=10')).json();
assert.ok(pz.pausedUntil > Date.now());
r = await (await call('/api/bms', { method: 'POST', body: JSON.stringify({ b: [] }) })).json();
assert.ok(r.pause > 590 && r.pause <= 600);
await call('/api/bms/pause?min=0');
r = await (await call('/api/bms', { method: 'POST', body: JSON.stringify({ b: [] }) })).json();
assert.equal(r.pause, 0);
// a corrupt frame never overwrites a good reading
const bad = { b: [{ mac: 'A5:C2:39:41:66:FA', basic: 'dd03001b00', cells: '' }] };
await call('/api/bms', { method: 'POST', body: JSON.stringify(bad) });
now = await (await call('/api/now')).json();
assert.equal(now.bms.packs[0].v, 52.5);
// the minute poll stores the BMS current for reference; the battery current stays inverter + MPPT
globalThis.fetch = async () => { throw new Error('offline in test'); };
await call('/api/poll');
now = await (await call('/api/now')).json();
assert.equal(now.latest.bms_a, -14.57); assert.equal(now.latest.net_a, 0);
console.log('bms e2e OK', now.bms.total);

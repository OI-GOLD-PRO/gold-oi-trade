import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { decodePhase, parseMppt, tuyaSign } from '../src/tuya.js';
import { summarizeDay, timeToCutoff } from '../src/calc.js';
import { toQuery } from '../src/dess.js';
import { hmacSha256 } from '../src/util.js';

// 1) MPPT blobs from the user's real device
assert.deepEqual(decodePhase('BnkACAXQ'), { v: 165.7, a: 0.8, w: 148.8 });
const props = JSON.parse(fs.readFileSync(process.argv[2] || new URL('./mppt-sample.json', import.meta.url), 'utf8')).result.properties;
const m = parseMppt(props);
console.log('MPPT parsed:', m);
assert.equal(m.battV, 52.4); assert.equal(m.battW, 130.7); assert.equal(m.todayKwh, 6.39); assert.equal(m.totalKwh, 529.1);

// 2) Tuya HMAC – worked example from Tuya's signing docs (with Signature-Headers)
const sts = ['GET', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', 'area_id:29a33e8796834b1efa6\ncall_id:8afdb70ab2ed11eb85290242ac130003\n', '/v1.0/token?grant_type=1'].join('\n');
assert.equal((await hmacSha256('4OHBOnWOqaEC1mWXOpVL3yV50s0qGSRC', '1KAD46OrT9HafiKdsXeg15889257780005138cc3a9033d69856923fd07b491173' + sts)).toUpperCase(), '9E48A3E93B302EEECC803C7241985D0A34EB944F40FB573C7B5C2A82158AF13E');
assert.match(await tuyaSign({ clientId: 'a', secret: 'b', t: '1', method: 'GET', path: '/x' }), /^[0-9A-F]{64}$/);

// 3) DESS query encoding
assert.equal(toQuery({ action: 'authSource', usr: 'a b@x.com', source: '1', 'company-key': 'k' }), 'action=authSource&usr=a+b@x.com&source=1&company-key=k');

// 4) Ah integration: 1 h at +10 A then 1 h at -5 A (5-min samples)
const cfg = { capacityAh: 434, cutoffV: 50, cutoffSoc: 10, nominalV: 51.2 };
const t0 = Date.parse('2026-10-16T00:00:00Z');
const samples = [];
for (let i = 0; i <= 24; i++) samples.push({ ts: t0 + i * 300000, batt_v: 52, soc: 60, mppt_a: i < 12 ? 8 : 0, inv_chg_a: i < 12 ? 2 : 0, inv_dis_a: i < 12 ? 0 : 5 });
const sum = summarizeDay(samples, cfg);
console.log('Day summary:', sum);
assert.equal(sum.ahIn, 10); assert.equal(sum.ahOut, 5);
const eta = timeToCutoff({ soc: 60, mppt_a: 0, inv_chg_a: 0, inv_dis_a: 21.7 }, cfg);
console.log('ETA:', eta);
assert.equal(eta.remainAh, 217); assert.equal(eta.hours, 10);
console.log('unit tests OK');

// 5) Solar day boundary: 05:00 Thai time
import { localDate, dayRange } from '../src/util.js';
assert.equal(localDate(Date.parse('2026-10-17T04:59:00+07:00')), '2026-10-16');
assert.equal(localDate(Date.parse('2026-10-17T05:00:00+07:00')), '2026-10-17');
assert.deepEqual(dayRange('2026-10-17'), [Date.parse('2026-10-17T05:00:00+07:00'), Date.parse('2026-10-18T05:00:00+07:00')]);
console.log('day boundary OK');

// 6) App-side SOC
import { stepSoc, socFromVoltage } from '../src/soc.js';
assert.equal(socFromVoltage(50), 10); assert.equal(socFromVoltage(54.5), 90); assert.equal(Math.round(socFromVoltage(52.25)), 50);
let st = stepSoc(null, { ts: 0, v: 52.25, net: 0 }, 434);
assert.equal(Math.round(st.soc), 50);
// discharge 43.4 A for 1 h → −10 %, and a voltage sag must NOT pull it down while under load
for (let i = 1; i <= 60; i++) st = stepSoc(st, { ts: i * 60000, v: 51.0, net: -43.4 }, 434);
assert.equal(Math.round(st.soc), 40);
// rest 30 min at 52.8 V (≈ 59.8 %) → eases toward the voltage scale
for (let i = 61; i <= 90; i++) st = stepSoc(st, { ts: i * 60000, v: 52.8, net: 0.5 }, 434);
assert.ok(st.soc > 55 && st.soc < 60, 'rest calibration ' + st.soc);
// hitting 50 V caps at 10 %
st = stepSoc(st, { ts: 91 * 60000, v: 49.9, net: -40 }, 434);
assert.equal(st.soc, 10);
console.log('soc OK');

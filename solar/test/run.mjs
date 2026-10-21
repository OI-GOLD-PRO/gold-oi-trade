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
// rest 30 min at 52.8 V (≈ 59.8 %) → NOT pulled toward the voltage any more (pure Ah counting)
for (let i = 61; i <= 90; i++) st = stepSoc(st, { ts: i * 60000, v: 52.8, net: 0.5 }, 434);
assert.ok(Math.abs(st.soc - 40.05) < 0.1, 'pure Ah counting ' + st.soc);
// charging past full is not stored: ceiling at 90 %
{ let f = { soc: 88, ts: 0, restSince: null, fullSince: null };
  for (let i = 1; i <= 120; i++) f = stepSoc(f, { ts: i * 60000, v: 53.0, net: 30 }, 464);
  assert.equal(f.soc, 90); }
// hitting 50 V caps at 10 %
st = stepSoc(st, { ts: 91 * 60000, v: 49.9, net: -40 }, 434);
assert.equal(st.soc, 10);
console.log('soc OK');

// 7) User's scenario: load 2 kW, PV1 1.5 kW, inverter draws 500 W from DC side, MPPT makes 1 kW
{
  const V = 51;
  const sc = []; for (let i = 0; i <= 60; i++) sc.push({ ts: i * 60000, batt_v: V, inv_pv_w: 1500, mppt_pv_w: 1000, load_w: 2000, inv_chg_a: 0, inv_dis_a: 500 / V, mppt_a: 1000 / V });
  const r = summarizeDay(sc, cfg);
  assert.ok(Math.abs(r.ahIn - 500 / V) < 0.05, 'net charge ' + r.ahIn);  // battery really charges 500 W
  assert.equal(r.ahOut, 0);
  assert.equal(r.sunDisAh, 0);                                              // no real discharge in daylight
  assert.ok(Math.abs(r.sunMpptToInvAh - 500 / V) < 0.05);                   // 500 W bridged MPPT → inverter
  console.log('scenario OK', { ahIn: r.ahIn, sunDisAh: r.sunDisAh, sunMpptToInvAh: r.sunMpptToInvAh });
}

// 8) floor: Ah counting never drops below the empty point
{
  let st = { soc: 12, ts: 0, restSince: null, fullSince: null };
  for (let i = 1; i <= 60; i++) st = stepSoc(st, { ts: i * 60000, v: 50.3, net: -20 }, 434);
  assert.equal(st.soc, 10);
  console.log('floor OK');
}

// 9) grid estimate (SBU: house on grid below 53 V, PV charges the bank)
{
  const { gridW } = await import('../src/calc.js');
  // 09:45 real reading: load 1.15 kW, PV1 1.62 kW, inverter charging 29 A at 52.1 V → ~1.04 kW from grid
  assert.ok(Math.abs(gridW({ grid_v: 233, load_w: 1150, inv_pv_w: 1620, inv_chg_a: 29, inv_dis_a: 0, batt_v: 52.1 }) - 1041) < 2);
  // 13:31 real reading: battery mode, PV covers load + charging → 0
  assert.equal(gridW({ grid_v: 235, load_w: 1473, inv_pv_w: 2250, inv_chg_a: 12, inv_dis_a: 0, batt_v: 53.4 }), 0);
  // night on battery → 0; no mains → 0; inverter says Invert Mode → 0
  assert.equal(gridW({ grid_v: 235, load_w: 900, inv_pv_w: 0, inv_chg_a: 0, inv_dis_a: 19, batt_v: 51 }), 0);
  assert.equal(gridW({ grid_v: 0, load_w: 900, inv_pv_w: 0, inv_chg_a: 0, inv_dis_a: 0, batt_v: 50 }), 0);
  assert.equal(gridW({ grid_v: 235, inv_mode: 'Invert Mode', load_w: 1150, inv_pv_w: 1620, inv_chg_a: 29, inv_dis_a: 0, batt_v: 52.1 }), 0);
  // a day: 2 h on grid at 1 kW, then 1 h on battery
  const day = [];
  for (let i = 0; i <= 180; i++) {
    const onGrid = i < 120;
    day.push({ ts: i * 60000, grid_v: 230, batt_v: 50.5, load_w: 1000, inv_pv_w: 0, inv_chg_a: 0, inv_dis_a: onGrid ? 0 : 20 });
  }
  const r = summarizeDay(day, { cutoffV: 50, nominalV: 51.2 });
  assert.ok(Math.abs(r.gridKwh - 2) < 0.02, 'grid kWh ' + r.gridKwh);
  assert.equal(r.gridMinutes, 120);
  assert.equal(r.gridPeakW, 1000);
  assert.deepEqual(r.gridSpans, [[0, 119 * 60000]]);
  console.log('grid OK', { gridKwh: r.gridKwh, gridMinutes: r.gridMinutes });
}

// 10) JBD BMS frames — built from the user's real XiaoxiangBMS readings (17:57 on 19 Oct)
{
  const { frameData, parseBms, parseLabels } = await import('../src/bms.js');
  const hex = (a) => a.map((x) => x.toString(16).padStart(2, '0')).join('');
  const w16 = (x) => [(x >> 8) & 255, x & 255];
  const frame = (cmd, data) => {
    const body = [0x00, data.length, ...data];
    const sum = body.reduce((a, b) => a + b, 0);
    return hex([0xdd, cmd, ...body, ...w16((0x10000 - sum) & 0xffff), 0x77]);
  };
  const date = ((2025 - 2000) << 9) | (1 << 5) | 19; // 19 Jan 2025
  const basic = [...w16(5258), ...w16((-805) & 0xffff), ...w16(13259), ...w16(31400), ...w16(301), ...w16(date),
    0, 0, 0, 0, ...w16(0), 0x21, 42, 0x03, 16, 2, ...w16(2731 + 281), ...w16(2731 + 295)];
  const cellMv = [3290, 3285, 3281, 3284, 3283, 3282, 3280, 3283, 3285, 3281, 3282, 3279, 3303, 3284, 3279, 3280];
  const b = frame(0x03, basic), c = frame(0x04, cellMv.flatMap(w16));
  const p = parseBms(b, c);
  assert.equal(p.v, 52.58); assert.equal(p.a, -8.05); assert.equal(p.w, -423);
  assert.equal(p.remAh, 132.59); assert.equal(p.nomAh, 314); assert.equal(p.soc, 42); assert.equal(p.cycles, 301);
  assert.deepEqual(p.made, { y: 2025, m: 1, d: 19 });
  assert.deepEqual(p.temps, [28.1, 29.5]); assert.equal(p.tMax, 29.5); assert.equal(p.nCells, 16);
  assert.equal(p.fet, 3); assert.deepEqual(p.protNames, []);
  assert.equal(p.cMin, 3.279); assert.equal(p.cMax, 3.303); assert.equal(p.cDelta, 0.024); assert.equal(p.cMaxIdx, 13);
  // protection bits
  const bad = frame(0x03, basic.map((x, i) => (i === 17 ? 0x05 : x)));       // prot low byte = cell over + pack over
  assert.deepEqual(parseBms(bad, null).protNames, ['cellOver', 'packOver']);
  // corrupt checksum / wrong command / truncated → rejected, basic-only still parses
  assert.equal(parseBms(b.slice(0, -4) + '00' + '77', c), null);
  assert.equal(frameData(b, 0x04), null);
  assert.equal(parseBms(b, null).cells, undefined);
  assert.equal(parseBms('dd03', c), null);
  assert.deepEqual(parseLabels('A5:C2:39:41:66:FA=200 Ah, a4:c1:37:25:e5:e2=314 Ah'), [{ mac: 'A5:C2:39:41:66:FA', label: '200 Ah' }, { mac: 'A4:C1:37:25:E5:E2', label: '314 Ah' }]);
  globalThis.__bmsFrames = { b, c };
  console.log('bms OK', { v: p.v, a: p.a, rem: p.remAh, cMin: p.cMin, cMax: p.cMax });
}

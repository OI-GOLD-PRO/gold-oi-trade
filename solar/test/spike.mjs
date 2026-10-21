import assert from 'node:assert/strict';
import { sanitizeLive, despike, cleanHistory } from '../src/clean.js';

// 1) limits: 1,900 A is replaced by the previous good value
{
  const prev = { load_w: 1500, inv_pv_w: 2000, inv_chg_a: 12, inv_dis_a: 0, mppt_a: 20 };
  const row = { load_w: 1500, inv_pv_w: 2000, inv_chg_a: 1900, inv_dis_a: 0, mppt_a: 20 };
  const r = sanitizeLive(row, prev, false);
  assert.equal(row.inv_chg_a, 12); assert.deepEqual(r.fixed, ['inv_chg_a']); assert.equal(r.pending, false);
}
// 2) all-zero drop: held once, believed the second time
{
  const prev = { load_w: 1500, inv_pv_w: 2000, inv_chg_a: 12, inv_dis_a: 0 };
  let row = { load_w: 0, inv_pv_w: 0, inv_chg_a: 0, inv_dis_a: 0 };
  let r = sanitizeLive(row, prev, false);
  assert.equal(row.load_w, 1500); assert.equal(row.inv_pv_w, 2000); assert.equal(r.pending, true);
  row = { load_w: 0, inv_pv_w: 0, inv_chg_a: 0, inv_dis_a: 0 };
  r = sanitizeLive(row, prev, true);
  assert.equal(row.load_w, 0); assert.equal(r.pending, false);           // second minute in a row → real
  // a quiet night is not a drop
  row = { load_w: 0, inv_pv_w: 0, inv_chg_a: 0, inv_dis_a: 0 };
  sanitizeLive(row, { load_w: 40, inv_pv_w: 0, inv_chg_a: 0, inv_dis_a: 1 }, false);
  assert.equal(row.load_w, 0);
  // inverter read failed (nulls) is not a drop either
  row = { load_w: null, inv_pv_w: null, inv_chg_a: null, inv_dis_a: null };
  assert.equal(sanitizeLive(row, prev, false).pending, false);
}
// 3) despike: 1-, 2- and 3-minute spikes go; a real step (load stays up) and a slow ramp stay
const mk = (vals) => vals.map((v, i) => ({ ts: i, load_w: v, inv_pv_w: 2000, inv_chg_a: 10, inv_dis_a: 0, mppt_a: 10, mppt_pv_w: 500 }));
{
  let l = mk([1500, 1500, 6200, 1500, 1500]); despike(l); assert.deepEqual(l.map((s) => s.load_w), [1500, 1500, 1500, 1500, 1500]);
  l = mk([1500, 1500, 0, 0, 1500, 1500]);                                         // 2-minute all-zero dropout
  for (const k of [2, 3]) Object.assign(l[k], { inv_pv_w: 0, inv_chg_a: 0, inv_dis_a: 0 });
  despike(l); assert.deepEqual(l.map((s) => [s.load_w, s.inv_pv_w, s.inv_chg_a]), Array(6).fill([1500, 2000, 10]));
  l = mk([1500, 6000, 6100, 5900, 1500, 1500]); despike(l); assert.ok(l.every((s) => s.load_w === 1500));
  l = mk([300, 300, 4300, 4300, 4300, 4300]); despike(l); assert.deepEqual(l.map((s) => s.load_w), [300, 300, 4300, 4300, 4300, 4300]); // air-con on: real
  l = mk([300, 800, 1400, 2000, 2600, 3200]); despike(l); assert.deepEqual(l.map((s) => s.load_w), [300, 800, 1400, 2000, 2600, 3200]);
  l = mk([1500, 1500, 1500, 1500]); l[2].inv_pv_w = 0; despike(l); assert.equal(l[2].inv_pv_w, 2000);                              // PV dip to 0
}
// 4) history: stored 1,900 A samples become the neighbours' average
{
  const l = mk([1500, 1500, 1500, 1500]); l[1].inv_chg_a = 1900; l[2].inv_chg_a = 1900;
  const t = cleanHistory(l);
  assert.equal(t.length, 2); assert.deepEqual(l.map((s) => s.inv_chg_a), [10, 10, 10, 10]);
}
console.log('spike OK');

// 👥 คนส่วนมาก vs คนส่วนน้อย (หน้าแดช) — จากรายงาน COT ทองคำ COMEX (CFTC Disaggregated, ข้อมูลวันอังคาร ประกาศคืนวันศุกร์)
//  นับ "หัว" ผู้ถือสถานะรายใหญ่ที่ต้องรายงาน (traders_tot_rept_long/short) → ฝั่งที่คนมากกว่า = คนส่วนมาก
//  + รายย่อย (Non-reportable) ดูจากสัดส่วนสัญญา Long/Short (CFTC ไม่นับจำนวนคนรายย่อย)
//  แยกฝั่งตามกลุ่ม: ผู้ผลิต · Swap (ธนาคาร) · กองทุน · รายใหญ่อื่น → บอกว่าแต่ละฝั่ง "มองยังไง"
(() => {
  'use strict';
  const URL = 'https://publicreporting.cftc.gov/resource/72hh-3qpy.json';
  const F = ['report_date_as_yyyy_mm_dd', 'traders_tot_rept_long_all', 'traders_tot_rept_short_all', 'tot_rept_positions_long_all', 'tot_rept_positions_short',
    'traders_prod_merc_long_all', 'traders_prod_merc_short_all', 'prod_merc_positions_long', 'prod_merc_positions_short',
    'traders_swap_long_all', 'traders_swap_short_all', 'swap_positions_long_all', 'swap__positions_short_all',
    'traders_m_money_long_all', 'traders_m_money_short_all', 'm_money_positions_long_all', 'm_money_positions_short_all',
    'traders_other_rept_long_all', 'traders_other_rept_short', 'other_rept_positions_long', 'other_rept_positions_short',
    'nonrept_positions_long_all', 'nonrept_positions_short_all'];
  const KEY = 'oit_crowd_v1', TTL = 3 * 3600e3;
  const n = v => Number(v) || 0;
  let st = { rows: null, at: 0, err: null };
  try { const c = JSON.parse(localStorage.getItem(KEY) || 'null'); if (c && c.rows) st = c; } catch (e) {}

  async function load(force) {
    if (!force && st.rows && Date.now() - st.at < TTL) return;
    try {
      const r = await fetch(`${URL}?cftc_contract_market_code=088691&$select=${F.join(',')}&$order=report_date_as_yyyy_mm_dd%20DESC&$limit=157`);
      if (!r.ok) throw new Error('CFTC HTTP ' + r.status);
      const j = await r.json();
      st = { rows: j.map(x => {
        const g = (tl, ts, pl, ps) => ({ tl: n(x[tl]), ts: n(x[ts]), pl: n(x[pl]), ps: n(x[ps]) });
        return { d: String(x.report_date_as_yyyy_mm_dd).slice(0, 10), all: g('traders_tot_rept_long_all', 'traders_tot_rept_short_all', 'tot_rept_positions_long_all', 'tot_rept_positions_short'),
          pm: g('traders_prod_merc_long_all', 'traders_prod_merc_short_all', 'prod_merc_positions_long', 'prod_merc_positions_short'),
          sw: g('traders_swap_long_all', 'traders_swap_short_all', 'swap_positions_long_all', 'swap__positions_short_all'),
          mm: g('traders_m_money_long_all', 'traders_m_money_short_all', 'm_money_positions_long_all', 'm_money_positions_short_all'),
          ot: g('traders_other_rept_long_all', 'traders_other_rept_short', 'other_rept_positions_long', 'other_rept_positions_short'),
          nrL: n(x.nonrept_positions_long_all), nrS: n(x.nonrept_positions_short_all) };
      }), at: Date.now(), err: null };
      try { localStorage.setItem(KEY, JSON.stringify(st)); } catch (e) {}
      document.dispatchEvent(new Event('oilive')); // ให้หน้าแดชที่เปิดอยู่วาดใหม่
    } catch (e) { st.err = e.message || String(e); }
  }
  setTimeout(load, 3500);

  const f0 = v => Math.round(v).toLocaleString('en-US');
  const pctRank = (arr, v) => arr.length ? arr.filter(x => x <= v).length / arr.length * 100 : 50;
  const GN = { pm: 'ผู้ผลิต/ผู้ใช้ทอง', sw: 'Swap dealer (ธนาคาร)', mm: 'กองทุนเก็งกำไร', ot: 'รายใหญ่อื่น ๆ' };
  const WHY = { // แต่ละกลุ่มถือฝั่งนั้นเพราะอะไร
    L: { pm: 'ซื้อล็อกต้นทุน (ผู้ใช้ทอง)', sw: 'ธนาคารรับฝั่งตรงข้ามลูกค้า', mm: 'เดิมพันว่าราคาขึ้น (ตามเทรนด์)', ot: 'เก็งกำไรขาขึ้น/ลงทุนระยะยาว' },
    S: { pm: 'ขายล่วงหน้าป้องกันราคา (เหมือง/ร้านทอง)', sw: 'ธนาคารป้องกันความเสี่ยงจากที่ขายทอง/ETF ให้ลูกค้า', mm: 'เดิมพันว่าราคาลง', ot: 'เก็งกำไรขาลง/ป้องกันพอร์ต' },
  };

  window.OICrowdCard = function () {
    if (!st.rows || !st.rows.length) return `<div class="card"><h3>👥 คนส่วนมาก vs คนส่วนน้อย</h3><div class="note">${st.err ? 'โหลด COT ไม่ได้: ' + st.err : 'กำลังโหลด COT…'}</div></div>`;
    const R = st.rows[0], P = st.rows[1] || R, A = R.all;
    const longMaj = A.tl >= A.ts, nTot = A.tl + A.ts;
    const maj = longMaj ? 'L' : 'S', mino = longMaj ? 'S' : 'L';
    const side = s => s === 'L' ? { t: 'LONG', v: 'มองขึ้น', c: '#26c281', n: A.tl, p: A.pl } : { t: 'SHORT', v: 'มองลง', c: '#ef5350', n: A.ts, p: A.ps };
    const M = side(maj), m = side(mino);
    const per = (x) => x.n ? x.p / x.n : 0;
    // กลุ่มในแต่ละฝั่ง เรียงตามจำนวนสัญญา
    const comp = s => ['pm', 'sw', 'mm', 'ot'].map(k => ({ k, n: s === 'L' ? R[k].tl : R[k].ts, p: s === 'L' ? R[k].pl : R[k].ps })).filter(x => x.n > 0).sort((a, b) => b.p - a.p);
    const li = (s) => comp(s).map(x => `<li><b>${GN[x.k]}</b> ${x.n} ราย · ${f0(x.p)} สัญญา <span style="opacity:.7">— ${WHY[s][x.k]}</span></li>`).join('');
    // สัดส่วนหัว Long ในรายใหญ่ เทียบ 3 ปี + รายย่อย Long %
    const share = R.all.tl / nTot * 100, hist = st.rows.map(r => r.all.tl / (r.all.tl + r.all.ts) * 100), sr = pctRank(hist, share);
    const nrPct = R.nrL / Math.max(1, R.nrL + R.nrS) * 100, nrHist = st.rows.map(r => r.nrL / Math.max(1, r.nrL + r.nrS) * 100), nrR = pctRank(nrHist, nrPct);
    const dL = A.tl - P.all.tl, dS = A.ts - P.all.ts;
    const sg = v => (v > 0 ? '+' : v < 0 ? '−' : '±') + Math.abs(v);
    // ฝั่งที่ "เดิมพันทิศทางจริง" (กองทุน + รายใหญ่อื่น) ไม่นับฝั่ง hedge
    const specL = R.mm.pl + R.ot.pl, specS = R.mm.ps + R.ot.ps;
    const hedgeS = R.pm.ps + R.sw.ps;
    let verdict;
    if (sr >= 80 || nrR >= 80) verdict = `<b style="color:#ff9f1a">⚠️ คนส่วนมากเอียงไป Long มากผิดปกติ</b> (สูงกว่า ${Math.max(sr, nrR).toFixed(0)}% ของ 3 ปี) — ตลาดมักวิ่งสวนคนส่วนมากเมื่อเอียงสุดโต่ง ระวังแรงขายทำกำไรพร้อมกัน`;
    else if (sr <= 20 || nrR <= 20) verdict = `<b style="color:#26c281">คนส่วนมากเอียงไป Short/ถือ Long น้อยผิดปกติ</b> (ต่ำกว่า ${Math.min(sr, nrR).toFixed(0)}% ของ 3 ปี) — มักใกล้ก้น มีโอกาสเด้ง`;
    else verdict = `คนส่วนมากยังไม่เอียงสุดโต่ง (หัว Long รายใหญ่อยู่ระดับ ${sr.toFixed(0)}% · รายย่อย ${nrR.toFixed(0)}% ของช่วง 3 ปี) — ยังไม่มีสัญญาณสวนทางจากกลุ่มนี้`;
    const dt = new Date(R.d + 'T00:00:00Z').toLocaleDateString('th-TH', { day: 'numeric', month: 'short', timeZone: 'UTC' });
    const box = (title, x, s, col, extra) => `<div style="border:1px solid ${col};border-radius:10px;padding:8px 10px;margin-top:8px">
      <div style="font:600 13.5px var(--sans)"><span style="color:${col}">${title}: ถือ ${x.t} (${x.v})</span></div>
      <div style="font:12px var(--mono);margin:3px 0">${x.n} ราย (${(x.n / nTot * 100).toFixed(0)}% ของรายใหญ่) · ${f0(x.p)} สัญญา · เฉลี่ยรายละ ${f0(per(x))}</div>
      <ul style="margin:4px 0 0 16px;padding:0;font-size:12px;line-height:1.55">${li(s)}</ul>${extra || ''}</div>`;
    return `<div class="card"><h3>👥 คนส่วนมาก vs คนส่วนน้อย (ทองคำ COMEX)</h3>
      ${box('👥 คนส่วนมาก', M, maj, M.c, `<div style="font-size:12px;margin-top:4px">➕ รายย่อย (ไม่ต้องรายงาน): ถือ Long ${nrPct.toFixed(0)}% ของสัญญารายย่อย → ${nrPct >= 50 ? 'ส่วนใหญ่มองขึ้น' : 'ส่วนใหญ่มองลง'}</div>`)}
      ${box('🎯 คนส่วนน้อย', m, mino, m.c, `<div style="font-size:12px;margin-top:4px">ถือรายละมากกว่า ${per(m) > per(M) ? `<b>${(per(m) / Math.max(1, per(M))).toFixed(1)} เท่า</b> ของฝั่งคนส่วนมาก (ตัวใหญ่)` : 'น้อยกว่าฝั่งคนส่วนมาก'}</div>`)}
      <div class="alert" style="margin-top:10px">${verdict}</div>
      <div style="font-size:12px;line-height:1.6;margin-top:6px">
        ● ฝั่ง Short ส่วนใหญ่เป็น <b>การป้องกันความเสี่ยง</b> (ผู้ผลิต + ธนาคาร ${f0(hedgeS)} สัญญา) ไม่ได้แปลว่ามองลงทั้งหมด · คนที่ <b>เดิมพันทิศทางจริง</b> (กองทุน + รายใหญ่อื่น): Long ${f0(specL)} vs Short ${f0(specS)} → <b style="color:${specL >= specS ? '#26c281' : '#ef5350'}">${specL >= specS ? 'มองขึ้น' : 'มองลง'} ${(Math.max(specL, specS) / Math.max(1, Math.min(specL, specS))).toFixed(1)} เท่า</b><br>
        ● สัปดาห์ล่าสุด: คนถือ Long ${sg(dL)} ราย · คนถือ Short ${sg(dS)} ราย ${dL > 0 && dS <= 0 ? '→ คนแห่เข้าฝั่งซื้อเพิ่ม' : dS > 0 && dL <= 0 ? '→ คนเริ่มย้ายไปฝั่งขาย' : ''}
      </div>
      <div class="note">ข้อมูล ณ วันอังคารที่ ${dt} (CFTC ประกาศคืนวันศุกร์) · นับเฉพาะรายใหญ่ที่ต้องรายงาน ผู้ถือ spread นับทั้งสองฝั่ง · รายย่อยไม่มีจำนวนคน ใช้สัดส่วนสัญญาแทน</div></div>`;
  };
  // สรุปตัวเลขให้ AI (ถาดวิเคราะห์สด)
  function summary() {
    if (!st.rows || !st.rows.length) return null;
    const R = st.rows[0], P = st.rows[1] || R, A = R.all, nTot = A.tl + A.ts;
    const share = A.tl / nTot * 100, hist = st.rows.map(r => r.all.tl / (r.all.tl + r.all.ts) * 100);
    const nrPct = R.nrL / Math.max(1, R.nrL + R.nrS) * 100, nrHist = st.rows.map(r => r.nrL / Math.max(1, r.nrL + r.nrS) * 100);
    const g = k => ({ long_traders: R[k].tl, short_traders: R[k].ts, long_contracts: R[k].pl, short_contracts: R[k].ps });
    return { report_date: R.d, note: 'COT ทองคำ COMEX รายสัปดาห์ (ข้อมูลวันอังคาร)',
      large_traders: { long_traders: A.tl, short_traders: A.ts, long_contracts: A.pl, short_contracts: A.ps, majority_side: A.tl >= A.ts ? 'LONG' : 'SHORT', long_trader_share_pct: +share.toFixed(1), share_pctile_3y: +pctRank(hist, share).toFixed(0), wow_long_traders: A.tl - P.all.tl, wow_short_traders: A.ts - P.all.ts },
      retail_nonreportable: { long_pct: +nrPct.toFixed(1), pctile_3y: +pctRank(nrHist, nrPct).toFixed(0), long: R.nrL, short: R.nrS },
      groups: { producers_hedgers: g('pm'), swap_dealers_banks: g('sw'), managed_money_funds: g('mm'), other_large: g('ot') },
      directional_spec: { long: R.mm.pl + R.ot.pl, short: R.mm.ps + R.ot.ps }, hedgers_short: R.pm.ps + R.sw.ps };
  }
  window.OICrowd = { load, summary, get state() { return st; } };
})();

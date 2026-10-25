// COT ทองคำ COMEX แยกรายกลุ่มผู้ถือสถานะ (CFTC): กองทุน (Managed Money), Commercial (ผู้ผลิต+Swap),
// Non-commercial (Legacy: ผู้เก็งกำไรรายใหญ่ทั้งหมด), รายย่อย (Non-reportable)
// แต่ละกลุ่มแสดง สุทธิ · เปลี่ยน 1 / 8 สัปดาห์ · ตำแหน่งเทียบ 3 ปี  (ข้อมูล ณ วันอังคาร ประกาศคืนวันศุกร์)
// ไฟล์เดียวใช้ได้ทั้ง OI Gold Pro และ OI Trade:  OICotGroups.load(force) → Promise · OICotGroups.html() → string
(() => {
  'use strict';
  const DIS = 'https://publicreporting.cftc.gov/resource/72hh-3qpy.json'; // Disaggregated
  const LEG = 'https://publicreporting.cftc.gov/resource/6dca-aqww.json'; // Legacy
  const CODE = '088691';                                                   // Gold COMEX
  const KEY = 'cotg_v1', TTL = 3 * 3600e3, WEEKS = 157;
  const st = { rows: null, at: 0, err: null };
  const n = v => Number(v) || 0;
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // ---------- โหลด ----------
  async function fetchRows() {
    const q = (base, sel) => `${base}?cftc_contract_market_code=${CODE}&$select=${sel}&$order=report_date_as_yyyy_mm_dd%20DESC&$limit=170`;
    const dSel = ['report_date_as_yyyy_mm_dd', 'open_interest_all', 'm_money_positions_long_all', 'm_money_positions_short_all', 'prod_merc_positions_long', 'prod_merc_positions_short', 'swap_positions_long_all', 'swap__positions_short_all', 'nonrept_positions_long_all', 'nonrept_positions_short_all'].join(',');
    const lSel = ['report_date_as_yyyy_mm_dd', 'noncomm_positions_long_all', 'noncomm_positions_short_all'].join(',');
    const [r1, r2] = await Promise.all([fetch(q(DIS, dSel)), fetch(q(LEG, lSel)).catch(() => null)]);
    if (!r1.ok) throw new Error('CFTC HTTP ' + r1.status);
    const dis = await r1.json();
    const leg = new Map();
    try { if (r2 && r2.ok) (await r2.json()).forEach(x => leg.set(String(x.report_date_as_yyyy_mm_dd).slice(0, 10), n(x.noncomm_positions_long_all) - n(x.noncomm_positions_short_all))); } catch (e) {}
    return dis.map(x => {
      const d = String(x.report_date_as_yyyy_mm_dd).slice(0, 10);
      return {
        d, oi: n(x.open_interest_all),
        mm: n(x.m_money_positions_long_all) - n(x.m_money_positions_short_all),
        cm: n(x.prod_merc_positions_long) + n(x.swap_positions_long_all) - n(x.prod_merc_positions_short) - n(x.swap__positions_short_all),
        nc: leg.has(d) ? leg.get(d) : null,
        nr: n(x.nonrept_positions_long_all) - n(x.nonrept_positions_short_all),
        nrL: n(x.nonrept_positions_long_all), nrS: n(x.nonrept_positions_short_all),
      };
    });
  }
  async function load(force) {
    if (!force && st.rows && Date.now() - st.at < TTL) return st;
    try {
      if (!force) { const c = JSON.parse(localStorage.getItem(KEY) || 'null'); if (c && c.rows && Date.now() - c.at < TTL) { st.rows = c.rows; st.at = c.at; st.err = null; return st; } }
    } catch (e) {}
    try {
      const rows = await fetchRows();
      st.rows = rows; st.at = Date.now(); st.err = null;
      try { localStorage.setItem(KEY, JSON.stringify({ rows, at: st.at })); } catch (e) {}
    } catch (e) { st.err = e.message || String(e); }
    return st;
  }

  // ---------- คำนวณ ----------
  const GROUPS = [
    { k: 'mm', name: 'กองทุน (Managed Money)', hint: 'กองทุนเก็งกำไรรายใหญ่ มักตามเทรนด์', hi: 'Long หนาแน่น (ระวังกลับตัว)', lo: 'Short หนาแน่น (ระวังเด้ง)' },
    { k: 'cm', name: 'Commercial (ผู้ผลิต+Swap)', hint: 'ฝั่งป้องกันความเสี่ยง มักสวนราคา', hi: 'สุทธิสูงสุดช่วง 3 ปี (Short น้อยสุด)', lo: 'Short หนักสุดช่วง 3 ปี (มักตรงกับราคาสูง)' },
    { k: 'nc', name: 'Non-commercial (Legacy)', hint: 'ผู้เก็งกำไรรายใหญ่ทั้งหมด (รวมกองทุน)', hi: 'Long หนาแน่น (สุทธิสูงสุดช่วง 3 ปี)', lo: 'Short หนาแน่น (สุทธิต่ำสุดช่วง 3 ปี)' },
    { k: 'nr', name: 'รายย่อย (Non-reportable)', hint: 'สถานะเล็กจนไม่ต้องรายงานรายตัว มักผิดทางที่จุดสุดโต่ง', hi: 'สุทธิสูงผิดปกติ (Long แน่น เตือนใกล้ยอด)', lo: 'สุทธิต่ำผิดปกติ (มักใกล้ก้น)', contra: true },
  ];
  function calc() {
    const R = st.rows; if (!R || R.length < 10) return null;
    const H = R.slice(0, WEEKS);
    return GROUPS.map(g => {
      const v = i => R[i] ? R[i][g.k] : null;
      const hist = H.map(r => r[g.k]).filter(x => x !== null);
      const now = v(0);
      if (now === null || hist.length < 10) return { g, none: true };
      const lo = Math.min(...hist), hi = Math.max(...hist);
      const pct = hi > lo ? (now - lo) / (hi - lo) * 100 : 50;
      const d1 = v(1) !== null ? now - v(1) : null, d8 = v(8) !== null ? now - v(8) : null;
      return { g, now, d1, d8, pct, lo, hi };
    });
  }

  // ---------- วาด ----------
  if (!document.getElementById('cgStyle')) {
    const s = document.createElement('style'); s.id = 'cgStyle';
    s.textContent = `
    .cg { display: grid; gap: 10px; }
    .cg .cr { display: grid; gap: 3px; padding: 8px 0 9px; border-top: 1px solid var(--line, #243055); }
    .cg .cr:first-child { border-top: 0; padding-top: 0; }
    .cg .t { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; }
    .cg .t b { font: 600 13px var(--sans, sans-serif); }
    .cg .t i { font-style: normal; font: 10px var(--sans, sans-serif); color: var(--muted, #8a93ad); }
    .cg .v { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; font-family: var(--mono, monospace); font-variant-numeric: tabular-nums; }
    .cg .v b { font-size: 18px; }
    .cg .v span { font-size: 11px; color: var(--muted, #8a93ad); }
    .cg .up { color: #26c281; } .cg .dn { color: #ef5350; }
    .cg .bar { position: relative; height: 6px; border-radius: 4px; background: linear-gradient(90deg, rgba(239,83,80,.35), rgba(138,147,173,.18) 50%, rgba(38,194,129,.35)); margin-top: 3px; }
    .cg .bar u { position: absolute; top: -3px; width: 3px; height: 12px; border-radius: 2px; background: var(--gold, #e0b44c); transform: translateX(-50%); }
    .cg .tag { font: 600 10.5px var(--sans, sans-serif); color: var(--gold, #e0b44c); }
    .cg .note { font: 10px var(--sans, sans-serif); color: var(--muted, #8a93ad); line-height: 1.5; }`;
    document.head.appendChild(s);
  }
  const sg = v => v === null || v === undefined ? '–' : (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(Math.round(v)).toLocaleString('en-US');
  const cl = v => v > 0 ? 'up' : v < 0 ? 'dn' : '';
  function html() {
    if (!st.rows) return `<div class="cg"><div class="note">${st.err ? 'โหลด COT ไม่ได้: ' + esc(st.err) : 'กำลังโหลด COT…'}</div></div>`;
    const C = calc();
    if (!C) return '<div class="cg"><div class="note">ข้อมูล COT ไม่พอ</div></div>';
    const dt = new Date(st.rows[0].d + 'T00:00:00Z').toLocaleDateString('th-TH', { day: 'numeric', month: 'short', timeZone: 'UTC' });
    const rows = C.map(x => {
      if (x.none) return `<div class="cr"><div class="t"><b>${esc(x.g.name)}</b></div><div class="note">ไม่มีข้อมูล</div></div>`;
      const g = x.g;
      // รายย่อย: สัญญาณสวนทาง (Long แน่น = เตือน) · กลุ่มอื่นแสดงเป็นข้อเท็จจริงของสถานะ
      const tag = x.pct >= 80 ? g.hi : x.pct <= 20 ? g.lo : 'ปกติเมื่อเทียบ 3 ปี';
      return `<div class="cr"><div class="t"><b>${esc(g.name)}</b><i>${esc(g.hint)}</i></div>
        <div class="v"><b class="${cl(x.now)}">${sg(x.now)}</b><span>สุทธิ · <em class="${cl(x.d1)}" style="font-style:normal">${sg(x.d1)}</em> 1 สัปดาห์ · <em class="${cl(x.d8)}" style="font-style:normal">${sg(x.d8)}</em> 8 สัปดาห์</span></div>
        <div class="bar"><u style="left:${Math.max(1, Math.min(99, x.pct))}%"></u></div>
        <div class="note">เทียบ 3 ปี <b>${x.pct.toFixed(0)}%</b> (0% = ต่ำสุด · 100% = สูงสุด) · <span class="tag">${esc(tag)}</span></div></div>`;
    }).join('');
    return `<div class="cg">${rows}<div class="note">ข้อมูล ณ วันอังคารที่ ${dt} · หน่วยเป็นสัญญา GC · Non-commercial รวมกองทุนและผู้เก็งกำไรรายใหญ่อื่นเข้าด้วยกัน (รายงาน Legacy) จึงไม่เท่ากับ Managed Money · ที่มา CFTC COMEX Gold</div></div>`;
  }
  window.OICotGroups = { load, html, get state() { return st; }, calc };
})();

// 📊 สถานะ OI (หน้าแดช): OI รวม Call/Put ของสัญญาวันนี้ + ทุกสัญญารายสัปดาห์ที่หมดอายุสัปดาห์นี้ (จ.–ศ.)
// ข้อมูล: cme_oi.json (GitHub Actions ดึงจากเว็บ CME ทุกชั่วโมง) → totals = สัญญาวันนี้ · week = [{ymd, group, label, C, P}]
(() => {
  'use strict';
  let J = null;
  async function load() {
    try { const j = await (await fetch('https://oi-gold-pro.github.io/gold-oi-pro/cme_oi.json?t=' + Math.floor(Date.now() / 600e3), { cache: 'no-store' })).json(); if (j && j.root) { const ch = !J || J.fetchedAt !== j.fetchedAt; J = j; if (ch) document.dispatchEvent(new Event('oilive')); } } catch (e) {}
  }
  setTimeout(load, 2500); setInterval(load, 10 * 60e3);

  const f0 = v => Math.round(v || 0).toLocaleString('en-US');
  const DN = ['', 'จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.'];
  const MTH = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
  // หมดอายุ 12:30 ชิคาโกของวันนั้น
  const expMs = ymd => { const y = Math.floor(ymd / 10000), m = Math.floor(ymd / 100) % 100, d = ymd % 100, sun = (mm, k) => { const f = new Date(Date.UTC(y, mm - 1, 1)).getUTCDay(); return 1 + ((7 - f) % 7) + (k - 1) * 7; }, t = Date.UTC(y, m - 1, d), dst = t >= Date.UTC(y, 2, sun(3, 2)) && t < Date.UTC(y, 10, sun(11, 1)); return Date.UTC(y, m - 1, d, 12 + (dst ? 5 : 6), 30); };
  const lab = ymd => { const y = Math.floor(ymd / 10000), m = Math.floor(ymd / 100) % 100, d = ymd % 100, wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); return `${DN[wd] || ''} ${d} ${MTH[m - 1]}`; };
  const pcr = (c, p) => c > 0 ? (p / c).toFixed(2) : '–';
  const lean = (c, p) => { if (!(c + p)) return ''; const r = p / Math.max(1, c); return r >= 1.2 ? '<span style="color:#ef5350">Put มากกว่า (กลัวลง/ป้องกันขาลง)</span>' : r <= 0.8 ? '<span style="color:#26c281">Call มากกว่า (หวังขึ้น)</span>' : 'ใกล้เคียงกัน'; };
  const bar = (c, p) => { const t = Math.max(1, c + p), w = c / t * 100; return `<div style="display:flex;height:8px;border-radius:4px;overflow:hidden;margin:4px 0 2px"><i style="width:${w}%;background:#26c281"></i><i style="width:${100 - w}%;background:#ef5350"></i></div>`; };

  window.OIOIStatCard = function () {
    if (!J) return '';
    const tdS = J.tradeDate ? `${+String(J.tradeDate).slice(6, 8)} ${MTH[+String(J.tradeDate).slice(4, 6) - 1]}` : '–';
    const T = J.totals || { C: 0, P: 0 }, now = Date.now();
    const W = (J.week || []).filter(x => !x.err), live = W.filter(x => expMs(x.ymd) > now);
    const sum = a => a.reduce((o, x) => ({ C: o.C + (x.C || 0), P: o.P + (x.P || 0) }), { C: 0, P: 0 });
    const SW = sum(W), SL = sum(live);
    const rows = (J.week || []).map(x => {
      const gone = expMs(x.ymd) <= now, today = +J.exp === x.ymd;
      return `<tr style="${gone ? 'opacity:.45' : ''}${today ? ';font-weight:700' : ''}"><td>${lab(x.ymd)}${today ? ' ◀ วันนี้' : gone ? ' (หมดแล้ว)' : ''}</td><td style="color:#26c281;text-align:right">${x.err ? '–' : f0(x.C)}</td><td style="color:#ef5350;text-align:right">${x.err ? '–' : f0(x.P)}</td><td style="text-align:right">${x.err ? '' : pcr(x.C, x.P)}</td></tr>`;
    }).join('');
    return `<div class="card"><h3>📊 สถานะ OI (ออปชันทอง CME)</h3>
      <div class="tiles">
        <div class="tile gold"><small>รวมสัญญาวันนี้ (${J.root})</small><b><span style="color:#26c281">Call ${f0(T.C)}</span><br><span style="color:#ef5350">Put ${f0(T.P)}</span></b>${bar(T.C, T.P)}<em>Put/Call ${pcr(T.C, T.P)} · ${lean(T.C, T.P)}</em></div>
        <div class="tile gold"><small>รวมสัญญาอาทิตย์นี้ (ที่ยังไม่หมดอายุ ${live.length} สัญญา)</small><b><span style="color:#26c281">Call ${f0(SL.C)}</span><br><span style="color:#ef5350">Put ${f0(SL.P)}</span></b>${bar(SL.C, SL.P)}<em>Put/Call ${pcr(SL.C, SL.P)} · ${lean(SL.C, SL.P)}</em></div>
      </div>
      ${rows ? `<table style="margin-top:8px"><thead><tr><th>หมดอายุ</th><th style="text-align:right">Call</th><th style="text-align:right">Put</th><th style="text-align:right">P/C</th></tr></thead><tbody>${rows}
        <tr style="border-top:1px solid var(--line)"><td><b>รวมทั้งสัปดาห์</b></td><td style="color:#26c281;text-align:right"><b>${f0(SW.C)}</b></td><td style="color:#ef5350;text-align:right"><b>${f0(SW.P)}</b></td><td style="text-align:right">${pcr(SW.C, SW.P)}</td></tr></tbody></table>` : ''}
      <div class="note">OI ณ สิ้นวันเทรด ${tdS} (CME ประกาศหลังปิดตลาด) · สัญญารายสัปดาห์ จ.–ศ. ไม่รวมสัญญารายเดือน · สัญญาที่หมดอายุแล้วแสดงจาง ไม่นับในช่อง "อาทิตย์นี้"</div></div>`;
  };
  window.OIOIStat = { load, get data() { return J; } };
})();

// 📊 OI Divergence รายวัน (หนังสือ The Invisible Money หน้า 165 "ใช้ OI ยืนยันความมั่นใจ")
//  ราคาทำ High ใหม่ + OI ลด  → ขาขึ้นจากคนปิดสถานะ ไม่ใช่เงินใหม่ → ระวังกลับตัวลง
//  ราคาทำ High ใหม่ + OI พุ่ง → เงินใหม่ไหลเข้าจริง (เบรกจริง) → ห้าม Short สวน
//  ราคาทำ Low ใหม่  + OI ลด  → ขาลงจากคนปิด Long ไม่ใช่ Short ใหม่ → ระวังเด้ง
//  ราคาทำ Low ใหม่  + OI พุ่ง → Short ใหม่เข้าจริง → ห้ามดักซื้อ
// ข้อมูล: gc_oi.json (OI รวมฟิวเจอร์ส GC จาก CME วันละครั้ง) + gcy.json แท่งรายวัน GC=F · High/Low ใหม่ = เลยจุดสูง/ต่ำสุด 10 วันทำการก่อนหน้า
// OI ประกาศหลังปิดตลาด → สัญญาณของวันเทรดล่าสุด ใช้กับรอบเทรดถัดไป
(() => {
  'use strict';
  const O = window.OI;
  if (!O || !O.hooks || !(O.sym === 'gold' || O.sym === 'gcy')) return;
  const LOOK = 10, DN = -0.003, UP = 0.005; // OI ลด ≥ 0.3% / พุ่ง ≥ 0.5% ของ OI รวม
  let rows = [], OIu = 0;

  async function load() {
    const q = '?t=' + Math.floor(Date.now() / 600e3);
    try {
      const [g, y] = await Promise.all([fetch('https://oi-gold-pro.github.io/gold-oi-pro/gc_oi.json' + q, { cache: 'no-store' }).then(r => r.json()), fetch('https://oi-gold-pro.github.io/gold-oi-pro/gcy.json' + q, { cache: 'no-store' }).then(r => r.json())]);
      const px = new Map(((y.bars || {})['1d'] || []).map(b => [new Date(b[0] * 1000).toISOString().slice(0, 10), b]));
      const days = [...px.keys()].sort();
      OIu = g.updated || 0;
      rows = (g.days || []).map(([d, oi, chg, vol, rt]) => {
        const b = px.get(d); if (!b || chg === null) return null;
        const i = days.indexOf(d), prev = days.slice(Math.max(0, i - LOOK), i).map(k => px.get(k));
        if (prev.length < 5) return null;
        const hh = Math.max(...prev.map(p => p[2])), ll = Math.min(...prev.map(p => p[3])), pct = chg / (oi - chg);
        const nh = b[2] > hh, nl = b[3] < ll, oiD = pct <= DN, oiU = pct >= UP;
        let sig = null;
        if (nh && oiD) sig = { k: 'hD', ico: '📉', b: 'ขึ้นหลอก ระวังกลับลง', col: '#ff9f1a', t: 'High ใหม่ + OI ลด', m: 'ขาขึ้นจากคนปิดสถานะ ไม่ใช่เงินใหม่ → <b>ระวังกลับตัวลง</b> (สวนที่กำแพง Call ได้)', fade: 1 };
        else if (nh && oiU) sig = { k: 'hU', ico: '🚀', b: 'ขึ้นจริง ห้าม Short', col: '#22e39a', t: 'High ใหม่ + OI พุ่ง', m: 'เงินใหม่ไหลเข้าจริง = เบรกจริง → <b>ห้าม Short สวน</b>', block: -1 };
        else if (nl && oiD) sig = { k: 'lD', ico: '📈', b: 'ลงหลอก ระวังเด้ง', col: '#ff9f1a', t: 'Low ใหม่ + OI ลด', m: 'ขาลงจากคนปิด Long ไม่ใช่ Short ใหม่ → <b>ระวังเด้ง</b> (สวนที่กำแพง Put ได้)', fade: 1 };
        else if (nl && oiU) sig = { k: 'lU', ico: '🩸', b: 'ลงจริง ห้ามดักซื้อ', col: '#ff4d6a', t: 'Low ใหม่ + OI พุ่ง', m: 'Short ใหม่เข้าจริง = ขาลงจริง → <b>ห้ามดักซื้อ</b>', block: 1 };
        return { d, oi, chg, pct, vol, rt, o: b[1], h: b[2], l: b[3], c: b[4], nh, nl, hh, ll, sig };
      }).filter(Boolean);
      O.markDirty();
    } catch (e) {}
  }
  setTimeout(load, 3000); setInterval(load, 30 * 60e3);

  // สัญญาณล่าสุด (วันเทรดล่าสุดที่มี OI) ยังใช้ได้ถ้าไม่เก่าเกิน 4 วัน
  function latest() {
    const r = rows[rows.length - 1]; if (!r) return null;
    const age = (Date.now() - Date.parse(r.d + 'T22:00:00Z')) / 864e5;
    return age <= 4 ? r : null;
  }
  const fd = d => `${+d.slice(8)}/${+d.slice(5, 7)}`;
  const sp = v => (v >= 0 ? '+' : '−') + Math.abs(v * 100).toFixed(1) + '%';

  (window.OIBadgeExtra = window.OIBadgeExtra || []).push(() => {
    const r = latest(); if (!r || !r.sig) return null;
    return [`${r.sig.ico} ${r.sig.b}`, r.sig.col, 'oidiv', null, 'first']; // V4.5.3: ป้ายบอกความหมายสั้น ๆ (รายละเอียด/วันที่ แตะป้าย)
  });

  function explain() {
    const r = latest();
    const head = r && r.sig ? `<b style="color:${r.sig.col}">${r.sig.ico} ${r.sig.b}: ${r.sig.t}</b> วันเทรด ${fd(r.d)}${r.rt === 'P' ? ' (OI เบื้องต้น)' : ''}<br>${r.sig.m}<br>`
      : r ? `<b>📊 OI Divergence วันเทรด ${fd(r.d)}: ไม่มีสัญญาณ</b><br>${r.nh ? 'ทำ High ใหม่' : r.nl ? 'ทำ Low ใหม่' : 'ไม่ได้ทำ High/Low ใหม่ (10 วัน)'} · OI ${sp(r.pct)}<br>` : '📊 OI Divergence: รอข้อมูล OI รวมจาก CME<br>';
    const tb = rows.slice(-8).reverse().map(x => `${fd(x.d)} ${(x.c - x.o >= 0 ? '+' : '−') + Math.abs(x.c - x.o).toFixed(0)}$ ${x.nh ? '▲H' : x.nl ? '▼L' : '··'} OI ${sp(x.pct)}${x.sig ? ' ' + x.sig.ico : ''}`).join('<br>');
    O.showToast && O.showToast(head +
      `● เกณฑ์: High/Low ใหม่ = เลยจุดสุด 10 วันก่อน · OI ลด ≥ 0.3% / พุ่ง ≥ 0.5% (OI รวมฟิวเจอร์ส GC ทุกเดือน)<br>` +
      `<span style="font-family:var(--mono);font-size:11px">${tb}</span><br>` +
      `<span style="opacity:.6">OI จาก CME ประกาศหลังปิดตลาด → สัญญาณช้า 1 วัน ใช้กับรอบเทรดถัดไป</span>`, 22000);
  }
  let down = null;
  const onBadge = e => { const el = e.target && (e.target.nodeType === 1 ? e.target : e.target.parentElement); return el && el.closest ? el.closest('#badges [data-k="oidiv"]') : null; };
  document.addEventListener('pointerdown', e => { down = onBadge(e) ? { x: e.clientX, y: e.clientY } : null; }, true);
  document.addEventListener('pointerup', e => {
    if (!down) return;
    const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y) > 10; down = null;
    const r = document.querySelector('#badges [data-k="oidiv"]')?.getBoundingClientRect();
    if (!moved && r && e.clientX >= r.left - 4 && e.clientX <= r.right + 4 && e.clientY >= r.top - 6 && e.clientY <= r.bottom + 6) setTimeout(explain, 120);
  }, true);

  window.OI_oidiv = { get rows() { return rows; }, latest, load, explain };
})();

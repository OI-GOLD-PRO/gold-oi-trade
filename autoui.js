// 🤖 OSF auto-trader panel — settings + status for the hub-side 🌏 OI Session Fade robot (hub/src/auto.js)
(() => {
  'use strict';
  const O = window.OI; if (!O) return;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  let D = null, timer = null, dirty = false, F = null;

  const el = document.createElement('div');
  el.id = 'autoP'; el.hidden = true;
  el.innerHTML = `<div class="au-top"><b>🤖 ออโต้ OI Session Fade</b><button id="auX" aria-label="ปิด">✕</button></div><div class="au-body" id="auBody"><div class="au-msg">กำลังโหลด…</div></div>`;
  document.body.appendChild(el);
  $('auX').onclick = close;
  window.OIT_openAuto = open;

  async function api(body) {
    const r = await fetch(O.HUB + '/app/auto', { method: body ? 'POST' : 'GET', cache: 'no-store', headers: { 'X-Key': O.authCode || '', 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    return r.json();
  }
  function open() { el.hidden = false; dirty = false; load(); clearInterval(timer); timer = setInterval(() => { if (!el.hidden && !dirty && document.visibilityState === 'visible') load(); }, 4000); }
  function close() { el.hidden = true; clearInterval(timer); }
  async function load() {
    try { const d = await api(); if (!d.ok) throw new Error(d.error || 'error'); D = d; if (!F || !dirty) F = { ...d.cfg }; paint(); }
    catch (e) { $('auBody').innerHTML = `<div class="au-msg">โหลดไม่ได้: ${esc(e.message)}</div>`; }
  }
  const tm = (ms) => new Date(ms).toLocaleTimeString('th-TH', { hour12: false, timeZone: 'Asia/Bangkok' });
  const MODES = [['off', 'ปิด'], ['dry', 'ซ้อม (ไม่ส่งจริง)'], ['live', 'ส่งจริง']];

  function paint() {
    const d = D, c = F, on = d.cfg.mode;
    const reg = Object.entries(d.reg || {}).filter(([, r]) => r.status !== 'skipped').sort((a, b) => b[1].at - a[1].at).slice(0, 8);
    $('auBody').innerHTML = `
      <div class="au-st ${on}"><b>${on === 'live' ? '🟢 ส่งจริง' : on === 'dry' ? '🟡 โหมดซ้อม' : '⚪ ปิดอยู่'}</b> <span>${esc(d.status || '')}</span>${d.online ? '' : '<em> · EA ออฟไลน์</em>'}</div>
      <div class="au-note">hub ทำงานเอง ไม่ต้องเปิดแอป · วาง LIMIT + SL + TP ล่วงหน้าที่ขอบโซน (ตอนราคาห่างโซน ≥ $3) แล้วยกเลิกถ้าเงื่อนไขเปลี่ยน/ใกล้ข่าวแดง · ไม้จริงเฉพาะ Asia เช้า 06:00–10:00 และ London 14:00–19:30</div>
      <h4>โหมด</h4>
      <div class="au-seg" data-k="mode">${MODES.map(([v, t]) => `<button data-v="${v}" class="${c.mode === v ? 'on' : ''}">${t}</button>`).join('')}</div>
      <h4>TP (เท่าของระยะ SL)</h4>
      <div class="au-seg" data-k="rr">${[1, 1.6, 5].map((v) => `<button data-v="${v}" class="${+c.rr === v ? 'on' : ''}">RR ${v}</button>`).join('')}</div>
      <h4>ขนาดไม้</h4>
      <div class="au-seg" data-k="lotMode"><button data-v="risk" class="${c.lotMode === 'risk' ? 'on' : ''}">เสี่ยง % ของ Balance</button><button data-v="fixed" class="${c.lotMode === 'fixed' ? 'on' : ''}">Lot คงที่</button></div>
      <div class="au-row">${c.lotMode === 'risk'
        ? `<label>เสี่ยงต่อไม้ (%)<input id="auRisk" type="number" step="0.1" min="0.1" max="10" value="${c.riskPct}"></label>`
        : `<label>Lot ต่อไม้<input id="auLots" type="number" step="0.01" min="0.01" max="10" value="${c.lots}"></label>`}
        <label>ไม้พร้อมกันสูงสุด<input id="auMax" type="number" step="1" min="1" max="6" value="${c.maxOpen}"></label>
        <label>หยุดวันนี้ถ้าขาดทุน (%)<input id="auLoss" type="number" step="0.5" min="0.5" max="50" value="${c.dailyLossPct}"></label></div>
      <div class="au-note">Lot ถูกจำกัดด้วย MaxLots ใน EA (ค่าเริ่มต้น 0.10) · จำนวนไม้นับรวมไม้ที่เปิดเองในบัญชีด้วย</div>
      <button id="auSave" class="au-save">${dirty ? '💾 บันทึกการตั้งค่า' : 'บันทึก'}</button>
      <h4>โซนวันนี้ ${d.off !== null && d.off !== undefined ? `<small>(GC−โบรก ${d.off >= 0 ? '+' : ''}${d.off})</small>` : ''}</h4>
      <div class="au-zones">${(d.zones || []).length ? d.zones.map((z) => `<span class="${z.side === 'C' ? 'c' : 'p'}">${z.k} ${z.side === 'C' ? 'Call' : 'Put'}${z.grade === 'A' ? ' ★' : ''}</span>`).join('') : '<small>ยังไม่มี</small>'}</div>
      <h4>ออเดอร์ของระบบ</h4>
      ${reg.length ? reg.map(([k, r]) => `<div class="au-r"><span class="${r.side === 'BUY' ? 'b' : 's'}">${esc(r.side)}</span> <b>${r.lots}</b> @ ${r.price} <small>SL ${r.sl} · TP ${r.tp}</small><span class="sp"></span><i class="s-${esc(r.status)}">${({ sent: 'ส่งแล้ว', live: 'รอแตะ', filled: 'เข้าไม้แล้ว', dry: 'ซ้อม', cancelling: 'กำลังยกเลิก' })[r.status] || esc(r.status)}</i></div>`).join('') : '<small>ยังไม่มี</small>'}
      <h4>บันทึก</h4>
      <div class="au-log">${(d.log || []).map((l) => `<div class="${esc(l.kind)}"><small>${tm(l.at)}</small> ${esc(l.msg)}</div>`).join('') || '<small>ยังไม่มี</small>'}</div>
      <div class="au-note">⚠️ ระบบนี้ส่งออเดอร์จริงเข้าบัญชีเมื่ออยู่โหมด “ส่งจริง” — ควรเริ่มที่ “ซ้อม” ดูบันทึกสักช่วงก่อน · แบ็กเทสไม่รับประกันผลจริง (สลิปเพจ/สเปรด/การแตะภายในแท่งต่างจากข้อมูล M1)</div>`;
  }

  el.addEventListener('click', async (e) => {
    const b = e.target.closest('button'); if (!b) return;
    const seg = b.closest('.au-seg');
    if (seg) { F[seg.dataset.k] = isNaN(+b.dataset.v) ? b.dataset.v : +b.dataset.v; dirty = true; grab(); paint(); return; }
    if (b.id === 'auSave') {
      grab();
      if (F.mode === 'live' && D.cfg.mode !== 'live' && !confirm('เปิดโหมดส่งจริง? ระบบจะวางออเดอร์ LIMIT เข้าบัญชี MT5 เองโดยอัตโนมัติ')) return;
      b.disabled = true;
      try { const d = await api(F); if (d.ok) { D = d; F = { ...d.cfg }; dirty = false; O.showToast && O.showToast('บันทึกแล้ว', 2000); paint(); } else O.showToast && O.showToast('บันทึกไม่ได้: ' + (d.error || ''), 3000); }
      catch (err) { O.showToast && O.showToast('บันทึกไม่ได้: ' + err.message, 3000); }
      b.disabled = false;
    }
  });
  el.addEventListener('input', () => { dirty = true; grab(); });
  function grab() {
    const n = (id, k) => { const i = $(id); if (i && i.value !== '') F[k] = +i.value; };
    n('auRisk', 'riskPct'); n('auLots', 'lots'); n('auMax', 'maxOpen'); n('auLoss', 'dailyLossPct');
  }
})();

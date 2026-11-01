// Dealer Hedge: ประเมินว่าเจ้าตลาด (dealer) น่าจะ "รับ" (เฮจสวนราคา → ราคาเด้ง/ถูกตรึง) หรือ "ไล่" (เฮจตามราคา → ราคาวิ่งต่อ)
// เป็นการอนุมานจากร่องรอย ไม่ใช่ข้อมูลพอร์ตจริงของ dealer
//  1) Gamma ของ dealer ที่ราคาปัจจุบัน  — Flip แบบปรับตามซื้อ/ขายของลูกค้าวันนี้ (live.js gmfAdj) → gmf สด → gmf M ชีต
//  2) แรงตรึงที่ strike OI หนาใกล้ราคา × ใกล้หมดอายุ (pinning)
//  3) แรงไล่ vs ผลลัพธ์ (Big Traders Δ ซื้อ−ขาย 3 แท่งล่าสุด เทียบกับระยะที่ราคาไปได้) — ต้องเปิด Big Traders
//  4) Volume วันนี้ / OI ที่ strike ใกล้ราคา (ความหนาแน่นของการเฮจ ใช้เป็นความมั่นใจ)
(() => {
  'use strict';
  const O = window.OI;
  const G = () => (O && O.gcOff ? O.gcOff() : 0); // GC − โบรก
  if (!O || !O.hooks || !(O.sym === 'gold' || O.sym === 'gcy')) return;
  const $ = id => document.getElementById(id);
  const KEY = 'oit_dealer' + (O.psfx || '');
  const cfg = { on: true };
  try { Object.assign(cfg, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch (e) {}
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch (e) {} };
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const f1 = x => (x >= 0 ? '+' : '') + x.toFixed(1);

  let R = null; // ผลล่าสุด { S, mode, conf, parts: [{k, name, v, w, txt}] }

  function gammaPart(P, c) {
    const em = c && c.em > 0 ? c.em : 25, scale = Math.max(3, em * 0.25);
    let flip = null, src = '';
    if (c && c.match && c.gmfAdj !== null) { flip = c.gmfAdj; src = 'Flip ปรับตามซื้อ/ขายวันนี้'; }
    else if (c && c.match && c.gmf !== null) { flip = c.gmf; src = 'gmf สด'; }
    else { const g = O.oi && O.oi.gmf ? O.oi.gmf.find(x => x.lab === 'gmf M') : null; if (g) { flip = g.p; src = 'gmf M'; } }
    if (flip === null) return null;
    const v = Math.tanh((P - flip) / scale);
    return { k: 'gamma', name: 'Gamma', v, w: 0.4,
      txt: `${v >= 0 ? 'γ+ เหนือ' : 'γ− ใต้'} ${src} ${flip.toFixed(1)} (${f1(P - flip)}) → ${v >= 0 ? 'dealer ขายขึ้น/ซื้อลง = รับ' : 'dealer ไล่ตามราคา'}` };
  }

  function pinPart(P, c) {
    const oi = O.oi; if (!oi || !oi.rows || !oi.rows.length) return null;
    const em = c && c.em > 0 ? c.em : 25;
    const near = oi.rows.filter(r => r.price !== null && Math.abs(r.price - P) <= em).map(r => ({ r, tot: (r.c || 0) + (r.p || 0) }));
    if (!near.length) return null;
    const top = near.sort((a, b) => b.tot - a.tot)[0], maxAll = Math.max(...oi.rows.map(r => (r.c || 0) + (r.p || 0)), 1);
    const d = Math.abs(top.r.price - P), zone = (O.cfg && O.cfg.zone) || 2.5;
    const prox = Math.exp(-Math.pow(d / (zone * 2), 2)), size = clamp(top.tot / maxAll, 0, 1);
    const hrs = c && c.expTs ? (c.expTs * 1000 - Date.now()) / 3600e3 : 24;
    const tf = hrs <= 0 ? 0 : hrs <= 6 ? 1 : hrs <= 24 ? 0.6 : 0.3;
    const v = prox * size * tf;
    return { k: 'pin', name: 'ตรึงราคา', v, w: 0.25,
      txt: `strike ${top.r.strike} OI ${top.tot} ห่าง ${d.toFixed(1)} · หมดอายุอีก ${hrs > 0 ? hrs.toFixed(1) + ' ชม.' : '—'} → แรงตรึง ${(v * 100).toFixed(0)}%` };
  }

  function flowPart() {
    const bt = window.OI_bigtr;
    if (!bt || !bt.cfg || !bt.cfg.on || !bt.delta || !bt.delta.size) return { k: 'flow', name: 'แรงไล่', v: 0, w: 0, txt: 'เปิด 🐋 Big Traders เพื่อวัดแรงไล่ซื้อ/ขายเทียบผลลัพธ์', off: true };
    const B = O.series.data() || []; if (B.length < 20) return null;
    const last = B.slice(-3), D = last.reduce((a, b) => { const x = bt.delta.get(b.time); return a + (x ? x.b - x.s : 0); }, 0);
    const ref = B.slice(-30).map(b => { const x = bt.delta.get(b.time); return x ? Math.abs(x.b - x.s) : 0; }).filter(x => x > 0);
    const avg = ref.length ? ref.reduce((a, b) => a + b, 0) / ref.length : 0;
    const atr = B.slice(-14).reduce((a, b) => a + (b.high - b.low), 0) / 14 || 1;
    const Rm = B[B.length - 1].close - B[B.length - 4].close;
    if (!avg) return null;
    const effort = clamp(Math.abs(D) / (avg * 3 * 1.5), 0, 1);
    let v = 0, why = 'แรงไล่ยังไม่เด่น';
    if (effort >= 0.3) {
      if (Math.sign(D) === Math.sign(Rm) && Math.abs(Rm) > 0.6 * atr) { v = -effort; why = 'ไม้ใหญ่ไล่ไปทางเดียวกับราคาและราคาไปได้จริง = ไล่'; }
      else if (Math.abs(Rm) < 0.3 * atr || Math.sign(D) !== Math.sign(Rm)) { v = effort; why = 'ไม้ใหญ่ไล่แต่ราคาไม่ไป = มีคนรับ (absorption)'; }
    }
    return { k: 'flow', name: 'แรงไล่', v, w: 0.35, txt: `Δ 3 แท่ง ${D >= 0 ? '+' : ''}${D.toFixed(1)} oz · ราคา ${f1(Rm)} (ATR ${atr.toFixed(1)}) → ${why}` };
  }

  function activity(P, c) {
    if (!c || !c.match || !c.strikes) return null;
    const s = c.strikes.filter(x => Math.abs(x.k - P) <= 10);
    const vol = s.reduce((a, x) => a + x.vc + x.vp, 0), oi = s.reduce((a, x) => a + x.c + x.p, 0);
    return oi > 0 ? vol / oi : null;
  }

  function evaluate() {
    const P = O.lastClose === null ? null : O.lastClose + G(); if (P === null || !isFinite(P)) return null;
    const c = window.OILive && window.OILive.calc;
    const parts = [gammaPart(P, c), pinPart(P, c), flowPart()].filter(Boolean);
    const act = parts.filter(p => p.w > 0); if (!act.length) return null;
    const W = act.reduce((a, p) => a + p.w, 0);
    let S = act.reduce((a, p) => a + p.w * p.v, 0) / W;
    const vo = activity(P, c);
    const actF = vo === null ? 1 : clamp(0.6 + vo, 0.6, 1.3); // ซื้อขายออปชันแถวนี้หนา = ต้องเฮจมาก → สัญญาณชัดขึ้น
    S = clamp(S * actF, -1, 1);
    const mode = S >= 0.2 ? 'absorb' : S <= -0.2 ? 'chase' : 'neutral';
    return { S, mode, conf: Math.round(Math.abs(S) * 100), parts, vo };
  }

  const LAB = { absorb: ['🛡 Dealer รับ', '#22e39a'], chase: ['⚡ Dealer ไล่', '#ff8a3d'], neutral: ['⚖️ Dealer กลาง', '#9aa7b8'] };
  const badge = () => {
    if (!cfg.on || !R) return null;
    const [t, col] = LAB[R.mode];
    return [R.mode === 'neutral' ? t : `${t} ${R.conf}%`, col, 'dealer'];
  };
  (window.OIBadgeExtra = window.OIBadgeExtra || []).push(badge);

  // แจ้งเตือนเมื่อโหมดเปลี่ยนระหว่าง รับ ↔ ไล่ (ต้องคงโหมดใหม่ 2 รอบติด, ห่างกันอย่างน้อย 15 นาที)
  let shown = null, pend = null, pendN = 0, lastAlert = 0;
  function checkFlip() {
    if (!R || R.mode === 'neutral') { pend = null; pendN = 0; return; }
    if (shown === null) { shown = R.mode; return; }
    if (R.mode === shown) { pend = null; pendN = 0; return; }
    if (pend === R.mode) pendN++; else { pend = R.mode; pendN = 1; }
    if (pendN < 2) return;
    shown = R.mode; pend = null; pendN = 0;
    if (Date.now() - lastAlert < 15 * 60e3 || !window.OIAlerts || !OIAlerts.on('dealer')) return;
    lastAlert = Date.now();
    O.beep && O.beep();
    O.showToast && O.showToast(R.mode === 'absorb'
      ? `🛡 <b>Dealer เปลี่ยนเป็นโหมด "รับ"</b> (${R.conf}%)<br>ราคามีแนวโน้มเด้ง/ถูกตรึงแถวโซน OI`
      : `⚡ <b>Dealer เปลี่ยนเป็นโหมด "ไล่"</b> (${R.conf}%)<br>การเฮจเติมแรงให้ราคาวิ่งต่อ ระวังเบรกโซน`, 12000);
  }

  function explain() {
    if (!R) { O.showToast && O.showToast('Dealer Hedge: รอข้อมูล OI/ราคา…', 5000); return; }
    const [t, col] = LAB[R.mode];
    const esc = s => String(s).replace(/[&<>]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[ch]));
    const rows = R.parts.map(p => `● <b>${p.name}</b> ${p.off ? '' : `<span style="color:${p.v > 0.05 ? '#22e39a' : p.v < -0.05 ? '#ff8a3d' : '#9aa7b8'}">${f1(p.v * 100)}%</span>`}<br><span style="opacity:.8">${esc(p.txt)}</span>`).join('<br>');
    const meaning = R.mode === 'absorb' ? 'dealer เฮจสวนราคา → ราคามักเด้งที่โซน OI / ถูกตรึงใกล้ strike ใหญ่ เหมาะเทรดกลับตัวที่ขอบโซน'
      : R.mode === 'chase' ? 'dealer เฮจตามราคา → การเคลื่อนไหวถูกขยาย เบรกโซนแล้วมักไปต่อ อย่าสวนเทรนด์'
      : 'สัญญาณยังไม่ชัด รอให้ราคาเข้าใกล้โซนหรือมีแรงไล่ชัดขึ้น';
    O.showToast && O.showToast(`<b style="color:${col}">${t}${R.mode === 'neutral' ? '' : ' ' + R.conf + '%'}</b> · คะแนน ${f1(R.S * 100)}<br>${meaning}<br>${rows}${R.vo !== null && R.vo !== undefined ? `<br>● Vol/OI ใกล้ราคา ${R.vo.toFixed(2)} (หนา = สัญญาณชัดขึ้น)` : ''}<br><span style="opacity:.6">เป็นการอนุมานจากร่องรอย ไม่ใช่ข้อมูลพอร์ต dealer จริง</span>`, 25000);
  }
  // แตะได้ทั้งป้าย (ไม่ใช่แค่ไอคอน): ป้ายถูกวาดใหม่ทุกครั้งที่ % เปลี่ยน ถ้าใช้ click ปุ่มที่ถูกแทนที่ระหว่างกดจะไม่ทำงาน
  // จึงใช้ pointerdown/pointerup ที่ระดับเอกสาร + กันกรณีเลื่อนแถบ (ขยับเกิน 10px = เลื่อน ไม่ใช่แตะ)
  let down = null;
  const onBadge = e => { const el = e.target && (e.target.nodeType === 1 ? e.target : e.target.parentElement); return el && el.closest ? el.closest('#badges [data-k="dealer"]') : null; };
  document.addEventListener('pointerdown', e => { down = onBadge(e) ? { x: e.clientX, y: e.clientY } : null; }, true);
  document.addEventListener('pointerup', e => {
    if (!down) return;
    const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y) > 10; down = null;
    const r = document.querySelector('#badges [data-k="dealer"]')?.getBoundingClientRect();
    if (!moved && r && e.clientX >= r.left - 4 && e.clientX <= r.right + 4 && e.clientY >= r.top - 6 && e.clientY <= r.bottom + 6) setTimeout(explain, 120); // หน่วงให้พ้น click ของนิ้วเดิม (ไม่งั้นโดนป้ายแจ้งเตือนที่เพิ่งขึ้นรับ click แล้วปิดทันที)
  }, true);

  function run() {
    if (!cfg.on) { if (R) { R = null; O.markDirty(); } return; }
    const prev = R && R.mode + R.conf;
    R = evaluate();
    if ((R && R.mode + R.conf) !== prev) O.markDirty();
    checkFlip();
    paintInfo();
  }
  setInterval(run, 5000);
  document.addEventListener('oilive', run);
  setTimeout(run, 4000);

  // ---------- เมนู ƒx ----------
  function paintInfo() {
    const el = $('dhInfo'); if (!el) return;
    el.textContent = !cfg.on ? '' : R ? `${LAB[R.mode][0]}${R.mode === 'neutral' ? '' : ' ' + R.conf + '%'} · แตะป้ายบนกราฟเพื่อดูเหตุผล` : 'รอข้อมูล…';
  }
  function section() {
    const d = document.createElement('div');
    d.id = 'dhBox'; d.className = 'gsbox';
    d.innerHTML = `<div class="row"><button class="gsb${cfg.on ? ' on' : ''}" data-dh="on"><i style="background:linear-gradient(90deg,#22e39a 50%,#ff8a3d 50%)"></i>🛡 Dealer Hedge (รับ / ไล่)</button><span id="dhInfo" class="gsinfo"></span></div>`;
    return d;
  }
  function mount() { const m = $('indMenu'); if (!m || m.hidden || $('dhBox')) return; const box = section(), anchor = $('btBox') || $('ivBox') || m.querySelector('.t'); anchor ? anchor.after(box) : m.prepend(box); paintInfo(); }
  const menu = $('indMenu');
  if (menu) {
    new MutationObserver(() => mount()).observe(menu, { childList: true });
    menu.addEventListener('click', e => {
      const t = e.target.closest('[data-dh]'); if (!t) return;
      cfg.on = !cfg.on; save(); run(); O.markDirty();
      const b = $('dhBox'); if (b) b.remove(); mount();
    });
  }
  if (window.OIAlerts) OIAlerts.reg('dealer', 'Dealer Hedge เปลี่ยนโหมด รับ ↔ ไล่', { desc: 'ป้าย Dealer บนกราฟเปลี่ยนจากรับเป็นไล่ หรือกลับกัน (เว้น 15 นาที)', active: () => cfg.on });
  window.OI_dealer = { get result() { return R; }, get cfg() { return cfg; }, evaluate };
})();

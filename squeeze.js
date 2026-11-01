// ⚠️ Gamma Squeeze: dealer ถือ gamma ติดลบ + ราคาวิ่งเข้า/ทะลุกำแพง OI ใหญ่ → dealer ต้องเฮจตามราคา = เร่งให้วิ่งแรงขึ้น
// เงื่อนไข 5 ข้อ (ข้อละ 0 / 0.5 / 1 คะแนน) · ข้อ 1 (γ−) เป็นเงื่อนไขบังคับ
//  1) Gamma ติดลบ: ราคาอยู่ใต้ Flip (ปรับตามซื้อ/ขายวันนี้) หรือ GEX ที่ราคาปัจจุบันติดลบ
//  2) โมเมนตัม: ราคา 15 นาทีล่าสุด (M1) วิ่งเกิน 1–1.5 เท่า ATR → ได้ทิศทาง ▲/▼
//  3) กำแพง: ราคาเข้าใกล้ (≤ $5) หรือเพิ่งทะลุกำแพง OI อันดับ 1–5 ในทิศทางนั้น
//  4) แรงไล่: ไม้ใหญ่ (Big Traders) 15 นาทีล่าสุดไปทางเดียวกับราคา (ต้องเปิด Big Traders)
//  5) IV ขึ้นใน 1 ชม. (ตลาดเปิด)
// ระดับ (สีป้าย): 🟡 เฝ้าระวัง ≥ 2.5 · 🟠 กำลังก่อตัว ≥ 3.5 · 🔴 Squeeze แรง ≥ 4.5 คะแนน
(() => {
  'use strict';
  const O = window.OI;
  const G = () => (O && O.gcOff ? O.gcOff() : 0); // GC − โบรก
  if (!O || !O.hooks || !(O.sym === 'gold' || O.sym === 'gcy')) return;
  const LV = [null,
    { n: 1, name: 'เฝ้าระวัง', col: '#ffd60a', bg: 'rgba(255,214,10,.12)' },
    { n: 2, name: 'กำลังก่อตัว', col: '#ff9f1a', bg: 'rgba(255,159,26,.18)' },
    { n: 3, name: 'Squeeze แรง', col: '#ff4d6a', bg: 'rgba(255,77,106,.28)' }];
  let R = null, M1 = [], lastFetch = 0;

  async function bars() {
    if (Date.now() - lastFetch < 20000 && M1.length) return M1;
    lastFetch = Date.now();
    try { const b = await O.fetchTF('1m', 60); if (b && b.length > 20) M1 = b; } catch (e) {}
    return M1;
  }
  function topWalls() {
    const oi = O.oi; if (!oi || !oi.rows) return [];
    const out = [];
    oi.rows.forEach(r => {
      if (r.price === null || r.price === undefined) return;
      const rc = oi.rankC ? oi.rankC.get(r.strike) || 0 : 0, rp = oi.rankP ? oi.rankP.get(r.strike) || 0 : 0;
      if ((rc && rc <= 5) || (rp && rp <= 5)) out.push({ p: r.price, k: r.strike, lab: (rc && (!rp || r.c >= r.p) ? 'C' : 'P') + r.strike });
    });
    return out;
  }
  async function evaluate() {
    const P = O.lastClose === null ? null : O.lastClose + G(); if (P === null || !isFinite(P)) return null;
    const c = window.OILive && window.OILive.calc;
    const B = await bars(); if (B.length < 20) return null;
    const fresh = Date.now() / 1000 + 7 * 3600 - B[B.length - 1].time < 600; if (!fresh) return null; // ตลาดปิด
    const parts = [];
    // 1) gamma
    let flip = c && c.match ? (c.gmfAdj ?? c.gmf) : null; if (flip === null) { const g = O.oi && O.oi.gmf ? O.oi.gmf.find(x => x.lab === 'gmf M') : null; flip = g ? g.p : null; }
    const gexNeg = c && c.gexAtF !== null && c.gexAtF < 0, below = flip !== null && P < flip;
    const g1 = gexNeg || below ? 1 : 0;
    parts.push({ k: 'γ− (dealer gamma ติดลบ)', v: g1, txt: below ? `ราคาใต้ Flip ${flip.toFixed(1)}` : gexNeg ? 'GEX ที่ราคาติดลบ' : `ราคาเหนือ Flip${flip !== null ? ' ' + flip.toFixed(1) : ''} (gamma บวก = dealer ดูดแรง)` });
    // 2) momentum
    const n = B.length, atr = B.slice(-15).reduce((a, b) => a + (b.high - b.low), 0) / 15 || 1, mv = B[n - 1].close - B[n - 16].close;
    const dir = mv >= 0 ? 1 : -1, m = Math.abs(mv) / atr, g2 = m >= 1.5 ? 1 : m >= 1 ? 0.5 : 0;
    parts.push({ k: 'โมเมนตัม 15 นาที', v: g2, txt: `${mv >= 0 ? '+' : ''}${mv.toFixed(1)} (${m.toFixed(1)}× ATR)` });
    // 3) wall
    const W = topWalls(), lo15 = Math.min(...B.slice(-15).map(b => b.low)), hi15 = Math.max(...B.slice(-15).map(b => b.high));
    let g3 = 0, wtxt = 'ไม่มีกำแพงใหญ่ใกล้ ๆ ในทิศนี้';
    const crossed = W.filter(w => dir > 0 ? (B[n - 16].close < w.p && P > w.p) || (lo15 < w.p && P > w.p && P - w.p < 8) : (B[n - 16].close > w.p && P < w.p) || (hi15 > w.p && P < w.p && w.p - P < 8));
    const ahead = W.filter(w => dir > 0 ? w.p > P : w.p < P).sort((a, b) => Math.abs(a.p - P) - Math.abs(b.p - P))[0];
    if (crossed.length) { g3 = 1; wtxt = `เพิ่งทะลุ ${crossed.map(w => w.lab).join(', ')}`; }
    else if (ahead && Math.abs(ahead.p - P) <= 5) { g3 = 1; wtxt = `กำลังชน ${ahead.lab} (ห่าง ${Math.abs(ahead.p - P).toFixed(1)})`; }
    else if (ahead && Math.abs(ahead.p - P) <= 10) { g3 = 0.5; wtxt = `ใกล้ ${ahead.lab} (ห่าง ${Math.abs(ahead.p - P).toFixed(1)})`; }
    parts.push({ k: 'กำแพง OI', v: g3, txt: wtxt });
    // 4) flow
    const bt = window.OI_bigtr;
    if (bt && bt.cfg && bt.cfg.on && bt.trades) {
      const T = bt.thr ? bt.thr() : 5, since = Date.now() - 15 * 60e3, tr = bt.trades.filter(x => x.t >= since && x.q >= T);
      const net = tr.reduce((a, x) => a + x.s * x.q, 0), g4 = Math.sign(net) === dir && Math.abs(net) >= 3 * T ? 1 : Math.sign(net) === dir && Math.abs(net) >= T ? 0.5 : 0;
      parts.push({ k: 'แรงไล่ (Big Traders)', v: g4, txt: `ไม้ใหญ่สุทธิ ${net >= 0 ? '+' : ''}${net.toFixed(1)} oz ใน 15 นาที (${tr.length} ไม้)` });
    } else parts.push({ k: 'แรงไล่ (Big Traders)', v: 0, txt: 'เปิด 🐋 Big Traders เพื่อใช้ข้อนี้', off: true });
    // 5) IV
    const iv = window.OI_iv && window.OI_iv.result;
    const d = iv && iv.mode === 'live' ? iv.d1h : null, g5 = d !== null && d >= 0.005 ? 1 : d !== null && d >= 0.002 ? 0.5 : 0;
    parts.push({ k: 'IV ขึ้น (1 ชม.)', v: g5, txt: d === null ? 'ยังไม่มีข้อมูล IV สด' : `${d >= 0 ? '+' : ''}${(d * 100).toFixed(1)} จุด` });
    const score = parts.reduce((a, p) => a + p.v, 0);
    const lv = !g1 ? 0 : score >= 4.5 ? 3 : score >= 3.5 ? 2 : score >= 2.5 ? 1 : 0;
    return { lv, dir, score, parts, P };
  }

  let lastAlert = { lv: 0, dir: 0, t: 0 };
  async function run() {
    const prev = R && R.lv + ':' + R.dir;
    try { R = await evaluate(); } catch (e) { R = null; }
    if ((R && R.lv + ':' + R.dir) !== prev) O.markDirty();
    if (!R || R.lv < 2) { if (!R || R.lv === 0) lastAlert.lv = 0; return; }
    // เตือนเมื่อขึ้นเป็นสีส้ม/แดง (หรือแรงขึ้น) · ทิศ/ระดับเดิมเว้น 10 นาที
    const now = Date.now();
    if (R.lv > lastAlert.lv || R.dir !== lastAlert.dir || now - lastAlert.t > 10 * 60e3) {
      if (R.lv === lastAlert.lv && R.dir === lastAlert.dir && now - lastAlert.t < 10 * 60e3) return;
      lastAlert = { lv: R.lv, dir: R.dir, t: now };
      if (window.OIAlerts && !OIAlerts.on('squeeze')) return;
      O.beep && O.beep();
      try { navigator.vibrate && navigator.vibrate(R.lv === 3 ? [400, 120, 400, 120, 400] : [300, 150, 300]); } catch (e) {}
      const L = LV[R.lv];
      O.showToast && O.showToast(`<b style="color:${L.col}">⚠️ Gamma Squeeze ${R.dir > 0 ? '▲ ขาขึ้น' : '▼ ขาลง'} · ${L.name}</b> (${R.score.toFixed(1)}/5)<br>` +
        `dealer ต้องเฮจตามราคา → ${R.dir > 0 ? 'ราคามีแรงพุ่งต่อ' : 'ราคามีแรงร่วงต่อ'} <b>อย่าสวนเทรนด์</b><br>` + R.parts.filter(p => p.v > 0).map(p => `✓ ${p.k}: ${p.txt}`).join('<br>'), 15000);
    }
  }
  setInterval(run, 20000);
  document.addEventListener('oilive', () => setTimeout(run, 500));
  setTimeout(run, 7000);

  (window.OIBadgeExtra = window.OIBadgeExtra || []).push(() => {
    if (!R || !R.lv) return null;
    const L = LV[R.lv];
    return [`⚠️ Squeeze ${R.dir > 0 ? '▲' : '▼'} ${L.name}`, L.col, 'squeeze', L.bg, 'first'];
  });

  function explain() {
    if (!R) { O.showToast && O.showToast('Gamma Squeeze: ยังไม่มีสัญญาณ (หรือตลาดปิด)', 5000); return; }
    const L = LV[R.lv] || { name: 'ไม่มีสัญญาณ', col: '#9aa7b8' };
    O.showToast && O.showToast(`<b style="color:${L.col}">⚠️ Gamma Squeeze ${R.dir > 0 ? '▲' : '▼'} · ${L.name}</b> · คะแนน ${R.score.toFixed(1)}/5<br>` +
      R.parts.map(p => `${p.off ? '○' : p.v >= 1 ? '✅' : p.v > 0 ? '🟡' : '❌'} <b>${p.k}</b>: ${p.txt}`).join('<br>') +
      `<br><span style="opacity:.75">ระดับ: <b style="color:#ffd60a">เหลือง</b> เฝ้าระวัง ≥2.5 · <b style="color:#ff9f1a">ส้ม</b> กำลังก่อตัว ≥3.5 · <b style="color:#ff4d6a">แดง</b> แรง ≥4.5 · ต้องมี γ− เสมอ</span>`, 22000);
  }
  let down = null;
  const onBadge = e => { const el = e.target && (e.target.nodeType === 1 ? e.target : e.target.parentElement); return el && el.closest ? el.closest('#badges [data-k="squeeze"]') : null; };
  document.addEventListener('pointerdown', e => { down = onBadge(e) ? { x: e.clientX, y: e.clientY } : null; }, true);
  document.addEventListener('pointerup', e => {
    if (!down) return;
    const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y) > 10; down = null;
    const r = document.querySelector('#badges [data-k="squeeze"]')?.getBoundingClientRect();
    if (!moved && r && e.clientX >= r.left - 4 && e.clientX <= r.right + 4 && e.clientY >= r.top - 6 && e.clientY <= r.bottom + 6) setTimeout(explain, 120);
  }, true);
  if (window.OIAlerts) OIAlerts.reg('squeeze', '⚠️ Gamma Squeeze (ส้ม/แดง)', { desc: 'dealer gamma ติดลบ + ราคาเร่งเข้า/ทะลุกำแพง OI · เตือนเมื่อระดับส้มหรือแดง' });
  window.OI_squeeze = { get result() { return R; }, evaluate, run };
})();

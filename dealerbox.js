// 🛡 กล่องขาว "ดีลเลอร์รับ": หาราคาที่ดีลเลอร์ถือ gamma บวก (strike GEX บวก = ขายตอนขึ้น ซื้อตอนลง → ตรึงราคา)
// แล้วราคาวิ่งเข้าไปทดสอบแต่ "ปิดผ่านไม่ได้" อย่างน้อย 2 ครั้ง → ตีกรอบสี่เหลี่ยมเส้นขาวคลุมจุดนั้น
//  - แนว: strike ที่ GEX บวก 8 อันดับแรก (ห่างราคาไม่เกิน 3%) จากข้อมูลออปชันสด (live.js)
//  - ทดสอบ: ไส้แท่ง M5 แตะแนว (ห่างไม่เกิน tol) แต่ราคาปิดกลับฝั่งเดิม · นับครั้งที่ห่างกันอย่างน้อย 2 แท่ง
//  - แตก: ราคาปิดเลยแนวเกิน $2 → ไม่วาดกรอบนั้น · ทดสอบชุดล่าสุดที่ยังไม่แตก = กรอบยืดถึงแท่งล่าสุด
//  ข้อจำกัด: ใช้ GEX ของตอนนี้กับแท่งย้อนหลังทั้งหมด (ไม่มีประวัติ GEX รายแท่ง)
(() => {
  'use strict';
  const O = window.OI;
  if (!O || !O.hooks || !(O.sym === 'gold' || O.sym === 'gcy')) return;
  const $ = id => document.getElementById(id);
  const KEY = 'oit_dbox' + (O.psfx || '');
  const cfg = { on: true };
  try { Object.assign(cfg, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch (e) {}
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch (e) {} };
  const TFS = { '1m': 60, '5m': 300, '15m': 900, '30m': 1800, '1h': 3600, '4h': 14400, '1d': 86400 };
  const BRK = 2, MIN_TEST = 2, GAP = 2;
  let boxes = [], bars = [], busy = false, lastRun = 0;

  function levels() {
    const c = window.OILive && window.OILive.calc, oi = O.oi; if (!c || !c.strikes || !oi || !oi.rows) return [];
    const px = O.lastClose; if (!px) return [];
    const pr = new Map(oi.rows.filter(r => r.price !== null && r.price !== undefined).map(r => [r.strike, r.price]));
    return c.strikes.filter(s => s.gex > 0 && pr.has(s.k) && Math.abs(pr.get(s.k) - px) <= px * 0.03)
      .sort((a, b) => b.gex - a.gex).slice(0, 8).map(s => ({ k: s.k, p: pr.get(s.k), gex: s.gex }));
  }
  function scan(B, L) {
    const n = B.length; if (n < 20) return [];
    let atr = 0; for (let i = Math.max(1, n - 30); i < n; i++) atr += Math.max(B[i].high - B[i].low, Math.abs(B[i].high - B[i - 1].close), Math.abs(B[i].low - B[i - 1].close));
    atr /= Math.min(29, n - 1); const tol = Math.max(0.8, atr * 0.25);
    const out = [];
    L.forEach(l => {
      let cur = null; const fin = () => { if (cur && cur.tests.length >= MIN_TEST) out.push(cur); cur = null; };
      for (let i = 1; i < n; i++) {
        const b = B[i], pc = B[i - 1].close;
        // ราคาปิดเลยแนวเกิน BRK = แตก
        if (cur && (cur.side < 0 ? b.close > l.p + BRK : b.close < l.p - BRK)) { cur.broke = i; cur.end = i; fin(); continue; }
        // ทดสอบจากด้านล่าง (แนวต้าน) / ด้านบน (แนวรับ) แล้วปิดกลับ
        let side = 0;
        if (pc < l.p && b.high >= l.p - tol && b.close < l.p) side = -1;
        else if (pc > l.p && b.low <= l.p + tol && b.close > l.p) side = 1;
        if (!side) continue;
        if (cur && cur.side !== side) fin();
        if (!cur) cur = { l, side, tests: [], ext: side < 0 ? b.high : b.low, start: i, end: i };
        if (!cur.tests.length || i - cur.tests[cur.tests.length - 1] > GAP) cur.tests.push(i);
        cur.ext = side < 0 ? Math.max(cur.ext, b.high) : Math.min(cur.ext, b.low); cur.end = i;
      }
      if (cur) { cur.live = true; fin(); }
    });
    return out;
  }
  async function run(force) {
    if (!cfg.on || busy) return;
    if (!force && Date.now() - lastRun < 25000) return;
    busy = true; lastRun = Date.now();
    try {
      const B = await O.fetchTF('5m', 300);
      if (B && B.length > 20) { bars = B; boxes = scan(B, levels()); O.markDirty(); }
    } catch (e) {} finally { busy = false; }
  }
  setInterval(() => run(false), 30000);
  document.addEventListener('oilive', () => setTimeout(() => run(false), 800));
  setTimeout(() => run(true), 7000);

  const csec = () => TFS[O.tf] || 60, toChart = t => Math.floor(t / csec()) * csec();
  O.hooks.push((ctx, w, h) => {
    if (!cfg.on || !boxes.length || !bars.length || csec() >= 86400) return;
    const ts = O.chart.timeScale(), sr = O.series, plotW = ts.width(), plotH = h - ts.height();
    const X = i => ts.timeToCoordinate(toChart(bars[Math.min(i, bars.length - 1)].time)), Y = p => sr.priceToCoordinate(p);
    const mono = getComputedStyle(document.documentElement).getPropertyValue('--mono') || 'monospace';
    ctx.save(); ctx.font = `bold 9px ${mono}`; ctx.textBaseline = 'bottom';
    boxes.forEach(bx => { // V4.9.7: แตกแล้วยังวาดไว้ (เส้นประ จาง) · ยังยืน = เส้นทึบ
      let x0 = X(bx.start), x1 = bx.live ? plotW - 2 : X(bx.end);
      if (x1 === null || x0 === null) { if (x0 === null && x1 !== null) x0 = 0; else return; }
      const step = Math.max(3, ts.options().barSpacing || 6); x0 -= step / 2; if (!bx.live) x1 += step / 2;
      if (x1 < 0 || x0 > plotW) return;
      const pad = 0.6, top = bx.side < 0 ? Math.max(bx.ext, bx.l.p) + pad : bx.l.p + pad, bot = bx.side < 0 ? bx.l.p - pad : Math.min(bx.ext, bx.l.p) - pad;
      const yt = Y(top), yb = Y(bot); if (yt === null || yb === null || yb < 0 || yt > plotH) return;
      const broke = bx.broke !== undefined;
      ctx.globalAlpha = broke ? 0.5 : 1;
      ctx.fillStyle = 'rgba(255,255,255,.06)'; ctx.fillRect(Math.max(0, x0), yt, Math.min(plotW, x1) - Math.max(0, x0), yb - yt);
      ctx.strokeStyle = '#ffffff'; ctx.lineWidth = broke ? 1 : 1.4; ctx.setLineDash(broke ? [4, 3] : []);
      ctx.strokeRect(Math.max(0, x0) + 0.5, yt + 0.5, Math.min(plotW, x1) - Math.max(0, x0), yb - yt);
      ctx.setLineDash([]); ctx.fillStyle = '#ffffff'; ctx.textAlign = 'left';
      const lab = `🛡 ดีลเลอร์รับ ${bx.l.k} · ${bx.side < 0 ? 'ขึ้นไม่ผ่าน' : 'ลงไม่ผ่าน'} ${bx.tests.length} ครั้ง${broke ? ' (แตกแล้ว)' : ''}`;
      const ly = bx.side < 0 ? yt - 2 : yb + 11;
      // V4.9.2: ผู้ใช้ไม่ต้องการคำบรรยายบนกรอบ (เหลือแค่กรอบขาว)
    });
    ctx.restore();
  });

  // ---------- เมนู ƒx ----------
  function info() { const a = boxes.filter(b => b.broke === undefined); return boxes.length ? `ยังยืน ${a.length} · แตกแล้ว ${boxes.length - a.length}` : 'ยังไม่พบจุดที่ราคาผ่านไม่ได้'; }
  function section() {
    const d = document.createElement('div'); d.id = 'dbBox'; d.className = 'gsbox';
    d.innerHTML = `<div class="row"><button class="gsb${cfg.on ? ' on' : ''}" data-db="on"><i style="background:#fff"></i>🛡 กรอบดีลเลอร์รับ (ราคาผ่านไม่ได้)</button><span class="gsinfo">${cfg.on ? info() : ''}</span></div>`;
    return d;
  }
  function mount() { const m = $('indMenu'); if (!m || m.hidden || $('dbBox')) return; const box = section(), anchor = $('dhBox') || $('s3Box') || $('btBox') || m.querySelector('.t'); anchor ? anchor.after(box) : m.prepend(box); }
  const menu = $('indMenu');
  if (menu) {
    new MutationObserver(() => mount()).observe(menu, { childList: true });
    menu.addEventListener('click', e => { if (!e.target.closest('[data-db]')) return; cfg.on = !cfg.on; save(); boxes = []; O.markDirty(); const b = $('dbBox'); if (b) b.remove(); mount(); run(true); });
  }
  window.OI_dbox = { get boxes() { return boxes; }, levels, scan, run };
})();

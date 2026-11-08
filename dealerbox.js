// 🛡 กรอบขาว "ดีลเลอร์รับ": หาราคาที่ดีลเลอร์ถือ gamma บวก (strike GEX บวก = ขายตอนขึ้น ซื้อตอนลง → ตรึงราคา)
// แล้วราคาวิ่งเข้าไปทดสอบแต่ "ปิดผ่านไม่ได้" ตามจำนวนครั้งที่ตั้ง (ค่าเริ่ม 3 ครั้ง) → ตีกรอบสี่เหลี่ยมเส้นขาวคลุมจุดนั้น
//  - แนว: strike ที่ GEX บวก 8 อันดับแรก (ห่างราคาไม่เกิน 3%) จากข้อมูลออปชันสด (live.js)
//    V4.9.38: เก็บแนวของแต่ละวันไว้ที่เซิร์ฟเวอร์ (/gexlog) → กรอบย้อนหลังใช้แนวของวันนั้น (วันที่ยังไม่มีประวัติ ใช้แนววันนี้แทน = โดยประมาณ)
//  - ทดสอบ: ไส้แท่ง M5 แตะแนว (ห่างไม่เกิน tol) แต่ราคาปิดกลับฝั่งเดิม · นับครั้งที่ห่างกันอย่างน้อย 2 แท่ง
//  - แตก: แท่ง M5 ปิดพ้นขอบกรอบที่ล็อกไว้ → เส้นประจาง · V4.9.38 วัดว่าทะลุแล้ววิ่งต่อไกลแค่ไหน (4 ชม.) และกลับเข้ามาไหม (1 ชม. = หลอก)
//  - V4.9.38 หลักฐานดีลเลอร์รับจริง (ต่อครั้งที่ทดสอบ): Absorption (Volume สูง ตัวแท่งเล็ก) · 🐋 ไม้ใหญ่สวนทาง · 👥 รายย่อยไล่เข้าใส่แนวแต่ราคาไม่ผ่าน (กรอบที่ยังยืน)
//    หลักฐาน ≥ 2 แสดงในรายละเอียดกรอบ · ย้อนหลังได้ ~5 วัน (M5 1,500 แท่ง)
(() => {
  'use strict';
  const O = window.OI;
  if (!O || !O.hooks || !(O.sym === 'gold' || O.sym === 'gcy')) return;
  const $ = id => document.getElementById(id);
  const KEY = 'oit_dbox' + (O.psfx || '');
  const cfg = { on: !window.OI_NEWDEV, minTests: 3 }; // V4.9.29 เครื่องใหม่ปิดเป็นค่าเริ่ม
  try { Object.assign(cfg, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch (e) {}
  const normTests = v => Number.isFinite(+v) && +v > 0 ? Math.max(1, Math.min(20, Math.round(+v))) : null;
  cfg.minTests = normTests(cfg.minTests) ?? 3;
  let requestFrameUpdate = () => {};
  const invalidate = () => { O.markDirty(); requestFrameUpdate(); };
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch (e) {} };
  const TFS = { '1m': 60, '5m': 300, '15m': 900, '30m': 1800, '1h': 3600, '4h': 14400, '1d': 86400 };
  const BRK = 2, GAP = 2, NBARS = 1500, AHEAD = 48, FAKE = 12, TZ = 7 * 3600;
  let boxes = [], bars = [], busy = false, lastRun = 0, hist = {}, histAt = 0, logAt = 0;
  // วันเทรด: รอบ CME เปิด ~05:00–06:00 ไทย → ตัดวันที่ 05:00 (เวลาแท่งเป็นเวลาไทยแล้ว)
  const dayKey = t => new Date((t - 5 * 3600) * 1000).toISOString().slice(0, 10);

  function levels() {
    const c = window.OILive && window.OILive.calc, oi = O.oi; if (!c || !c.strikes || !oi || !oi.rows) return [];
    const px = O.lastClose; if (!px) return [];
    const pr = new Map(oi.rows.filter(r => r.price !== null && r.price !== undefined).map(r => [r.strike, r.price]));
    // V4.9.39: ทุก strike ที่ GEX บวก ≥ 5% ของตัวสูงสุด (เดิม 8 อันดับแรก — 4050 หลุดอันดับ ทั้งที่ราคาไม่ผ่าน) สูงสุด 12 แนว
    const P = c.strikes.filter(s => s.gex > 0 && pr.has(s.k) && Math.abs(pr.get(s.k) - px) <= px * 0.03), gm = Math.max(0, ...P.map(s => s.gex));
    return P.filter(s => s.gex >= gm * 0.05).sort((a, b) => b.gex - a.gex).slice(0, 12).map(s => ({ k: s.k, p: pr.get(s.k), gex: s.gex }));
  }
  // ---------- ประวัติแนวรายวัน (เซิร์ฟเวอร์) ----------
  async function loadHist() { if (!O.worker || O.paused) return; try { const j = await (await fetch(O.worker + '/gexlog', { cache: 'no-store' })).json(); if (j && typeof j === 'object') { hist = j; histAt = Date.now(); } } catch (e) {} }
  async function logToday() {
    if (!O.worker || O.paused || Date.now() - logAt < 10 * 60e3) return; const L = levels(), B = O.series.data() || [];
    if (!L.length || !B.length) return; logAt = Date.now();
    try { const j = await (await fetch(O.worker + '/gexlog', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ d: dayKey(B[B.length - 1].time), root: (window.OILive.calc || {}).root || '', lv: L.map(l => [l.k, +l.p.toFixed(2), +l.gex.toFixed(2)]) }) })).json(); if (j) { hist = j; histAt = Date.now(); } } catch (e) {}
  }
  // แนวที่ใช้กับแต่ละวัน: วันที่มีประวัติ = แนวของวันนั้น (+ แนวสดถ้าเป็นวันนี้) · ไม่มีประวัติ = แนวสดตอนนี้ (โดยประมาณ)
  function dayLevels(d, today, cur) {
    const h = hist[d] && hist[d].m, m = new Map();
    if (h) Object.entries(h).forEach(([k, o]) => m.set(+k, { p: o.p, g: o.g || 0, est: false }));
    if (d === today || !h) cur.forEach(l => { if (!m.has(l.k)) m.set(l.k, { p: l.p, g: l.gex, est: !h }); else if (d === today) { m.get(l.k).p = l.p; m.get(l.k).g = Math.max(m.get(l.k).g, l.gex); } });
    let gm = 0; m.forEach(v => { gm = Math.max(gm, v.g || 0); }); m.forEach(v => { v.w = gm > 0 ? Math.sqrt((v.g || 0) / gm) : 0; }); // น้ำหนักแนว 0–1 (เทียบตัวสูงสุดของวัน)
    return m;
  }

  // ---------- หลักฐาน ----------
  function evAt(B, i, side, p) {
    const b = B[i], out = [];
    // Absorption: Volume ≥ 1.8 เท่าเฉลี่ย 20 แท่ง แต่ตัวแท่ง ≤ 45% ของไส้ถึงไส้
    const vb = B.slice(Math.max(0, i - 20), i).map(x => x.volume || 0), av = vb.reduce((a, c) => a + c, 0) / Math.max(1, vb.length);
    if (av > 0 && (b.volume || 0) >= av * 1.8 && Math.abs(b.close - b.open) <= (b.high - b.low) * 0.45) out.push('Absorption');
    // 🐋 ไม้ใหญ่สุทธิสวนทางที่แท่งทดสอบ (แนวต้าน → อยากเห็นขาย, แนวรับ → ซื้อ)
    try { const bt = window.OI_bigtr; if (bt && bt.cfg && bt.cfg.on && bt.trades) { const t0 = (b.time - TZ) * 1000, T = bt.thr ? bt.thr() : 0;
      const net = bt.trades.filter(x => x.t >= t0 && x.t < t0 + 300e3 && x.q >= T).reduce((a, x) => a + x.s * x.q, 0);
      if (side < 0 ? net < 0 : net > 0) out.push(`🐋 ${side < 0 ? 'ขาย' : 'ซื้อ'}สวน ${Math.abs(net).toFixed(0)} oz`); } } catch (e) {}
    return out;
  }
  function retailEv(side, p) { // 👥 รายย่อยไล่ใส่แนว (Δ ช่วงที่ตั้งไว้) แต่ราคาไม่ผ่าน = มีคนรับ
    try { const R = window.OI_retail && OI_retail.rows ? OI_retail.rows('delta') : []; let net = 0; R.forEach(r => { if (Math.abs(r[0] - p) <= 1.5) net += r[1] - r[2]; });
      if (side < 0 ? net > 0 : net < 0) return [`👥 รายย่อย${side < 0 ? 'ไล่ซื้อ' : 'ไล่ขาย'}ใส่แนว ${Math.round(Math.abs(net))} ไม้`]; } catch (e) {}
    return [];
  }

  function bounds(bx) {
    if (Number.isFinite(bx.top) && Number.isFinite(bx.bot)) return { top: bx.top, bot: bx.bot };
    const pad = 0.6;
    return {
      top: bx.side < 0 ? Math.max(bx.ext, bx.p) + pad : Math.max(bx.p, bx.near) + pad,
      bot: bx.side < 0 ? Math.min(bx.p, bx.near) - pad : Math.min(bx.ext, bx.p) - pad,
    };
  }
  function scan(B, cur) {
    // Only closed M5 candles can confirm a failed test.
    const formingTime = Math.floor((Date.now() / 1000 + TZ) / 300) * 300;
    B = B.filter(b => b.time < formingTime);
    const n = B.length; if (n < 40) return [];
    const TR = B.map((b, i) => i ? Math.max(b.high - b.low, Math.abs(b.high - B[i - 1].close), Math.abs(b.low - B[i - 1].close)) : b.high - b.low), PS = [0]; TR.forEach(v => PS.push(PS[PS.length - 1] + v));
    const ATR = TR.map((v, i) => Math.max(0.8, (PS[i + 1] - PS[Math.max(0, i - 29)]) / Math.min(30, i + 1)));
    const today = dayKey(B[n - 1].time), days = new Map(), DL = new Map();
    B.forEach((b, i) => { const d = dayKey(b.time); days.set(i, d); if (!DL.has(d)) DL.set(d, dayLevels(d, today, cur)); });
    const ks = new Set(); DL.forEach(m => m.forEach((v, k) => ks.add(k)));
    const out = [];
    ks.forEach(k => {
      let cur = null; const fin = () => { if (cur && cur.tests.length >= cfg.minTests) out.push(cur); cur = null; };
      for (let i = 1; i < n; i++) {
        const L = DL.get(days.get(i)).get(k); if (!L) { fin(); continue; }
        // V4.9.39: แนว GEX ใหญ่ ราคามักหยุดก่อนถึง strike (ดีลเลอร์เริ่มขาย/ซื้อก่อน) → ระยะแตะกว้างขึ้นตามขนาด GEX (ตัวใหญ่สุดวันนั้น +$3.5)
        const p = L.p, b = B[i], pc = B[i - 1].close, tol = Math.max(0.8, ATR[i] * 0.25) + 3.5 * (L.w || 0);
        if (cur && Math.abs(cur.p - p) > 3) fin(); // offset เปลี่ยนมาก (ข้ามวัน/เปลี่ยนสัญญา) = แนวใหม่
        // Once confirmed, compare the close against the ORIGINAL frame edge, never a moving strike.
        const confirmed = cur && Number.isFinite(cur.top) && Number.isFinite(cur.bot);
        if (cur && (cur.side < 0 ? b.close > (confirmed ? cur.top : p + BRK) : b.close < (confirmed ? cur.bot : p - BRK))) {
          const dir = cur.side < 0 ? 1 : -1, breakLevel = confirmed ? (cur.side < 0 ? cur.top : cur.bot) : p; let mfe = 0, back = false, end = Math.min(n, i + AHEAD + 1);
          for (let q = i + 1; q < end; q++) { mfe = Math.max(mfe, dir > 0 ? B[q].high - breakLevel : breakLevel - B[q].low); if (q <= i + FAKE && (dir > 0 ? B[q].close < breakLevel : B[q].close > breakLevel)) back = true; }
          cur.broke = i; cur.end = i; cur.run = { usd: mfe, atr: mfe / ATR[i], back, bars: end - i - 1 }; fin(); continue;
        }
        let side = 0;
        if (pc < p && b.high >= p - tol && b.close < p) side = -1;
        else if (pc > p && b.low <= p + tol && b.close > p) side = 1;
        if (!side) continue;
        if (cur && cur.side !== side) fin();
        if (!cur) cur = { k, p, side, tests: [], ev: [], ext: side < 0 ? b.high : b.low, near: side < 0 ? b.high : b.low, start: i, end: i, est: L.est, day: days.get(i), g: L.g };
        if (!cur.tests.length || i - cur.tests[cur.tests.length - 1] > GAP) { cur.tests.push(i); cur.ev.push(...evAt(B, i, side, p)); }
        if (!Number.isFinite(cur.top)) {
          cur.ext = side < 0 ? Math.max(cur.ext, b.high) : Math.min(cur.ext, b.low);
          cur.near = side < 0 ? Math.min(cur.near, b.high) : Math.max(cur.near, b.low);
          cur.p = p;
          if (cur.tests.length >= cfg.minTests) Object.assign(cur, bounds(cur), { confirmed: i });
        }
        cur.end = i;
      }
      if (cur) { cur.live = true; cur.ev.push(...retailEv(cur.side, cur.p)); fin(); }
    });
    return out;
  }
  async function run(force) {
    if (!cfg.on || busy) return;
    if (!force && Date.now() - lastRun < 25000) return;
    busy = true; lastRun = Date.now();
    try {
      if (Date.now() - histAt > 10 * 60e3) await loadHist();
      logToday();
      const B = await O.fetchTF('5m', NBARS);
      if (B && B.length > 40) { bars = B; boxes = scan(B, levels()); invalidate(); }
    } catch (e) {} finally { busy = false; }
  }
  setInterval(() => run(false), 30000);
  document.addEventListener('oilive', () => setTimeout(() => run(false), 800));
  document.addEventListener('oiresume', () => run(true));
  setTimeout(() => run(true), 7000);

  // ---------- วาด ----------
  const csec = () => TFS[O.tf] || 60, toChart = t => Math.floor(t / csec()) * csec();
  let hit = [];
  function drawFrames(ctx, w, h) {
    hit = [];
    if (!cfg.on || !boxes.length || !bars.length || csec() >= 86400) return;
    const ts = O.chart.timeScale(), sr = O.series, plotW = ts.width(), plotH = h - ts.height();
    const X = i => ts.timeToCoordinate(toChart(bars[Math.min(i, bars.length - 1)].time)), Y = p => sr.priceToCoordinate(p);
    const step = ts.options().barSpacing || 6;
    const chartBars = sr.data(), lastBar = chartBars[chartBars.length - 1];
    const latestX = lastBar ? ts.timeToCoordinate(lastBar.time) : X(bars.length - 1);
    ctx.save();
    ctx.beginPath(); ctx.rect(0, 0, plotW, plotH); ctx.clip();
    boxes.forEach(bx => { // Every ended/broken frame uses the same faint dashed outline.
      const inactive = bx.live !== true || bx.broke !== undefined;
      let x0 = X(bx.start), x1 = !inactive ? (latestX === null ? null : latestX + 3 * step) : X(bx.end);
      if (x1 === null || x0 === null) { if (x0 === null && x1 !== null) x0 = 0; else return; }
      x0 -= step / 2; if (inactive) x1 += step / 2;
      if (x1 < 0 || x0 > plotW) return;
      // V4.9.39: กรอบคลุมตั้งแต่ไส้ที่ทดสอบ (ซึ่งอาจหยุดก่อนถึง strike) ถึง strike
      const { top, bot } = bounds(bx);
      const yt = Y(top), yb = Y(bot); if (yt === null || yb === null || yb < 0 || yt > plotH) return;
      if (!inactive) {
        ctx.globalAlpha = 1;
        ctx.fillStyle = 'rgba(255,255,255,.1)';
        ctx.fillRect(Math.max(0, x0), yt, Math.min(plotW, x1) - Math.max(0, x0), yb - yt);
      }
      ctx.globalAlpha = inactive ? 0.45 : 1;
      ctx.strokeStyle = '#ffffff'; ctx.lineWidth = inactive ? 0.75 : 1; ctx.setLineDash(inactive ? [4, 3] : bx.est ? [6, 2] : []);
      ctx.strokeRect(Math.max(0, x0) + 0.5, yt + 0.5, Math.min(plotW, x1) - Math.max(0, x0), yb - yt);
      ctx.setLineDash([]);
      hit.push({ x0: Math.max(0, x0), x1: Math.min(plotW, x1), y1: yt - 3, y2: yb + 3, bx });
    });
    ctx.restore();
  }
  // Native bottom primitive: above the chart background, below candles (CSS pixels via media space).
  const frameRenderer = {
    draw(target) {
      target.useMediaCoordinateSpace(scope => {
        drawFrames(scope.context, scope.mediaSize.width, scope.mediaSize.height + O.chart.timeScale().height());
      });
    },
  };
  const frameViews = [{ zOrder: () => 'bottom', renderer: () => frameRenderer }];
  if (typeof O.series.attachPrimitive === 'function') {
    O.series.attachPrimitive({
      attached({ requestUpdate }) { requestFrameUpdate = requestUpdate; requestUpdate(); },
      detached() { requestFrameUpdate = () => {}; hit = []; },
      paneViews() { return frameViews; },
    });
  } else {
    // Older chart library: retain visible frames until its cached script updates.
    (O.bgHooks || O.hooks).push(drawFrames);
  }
  // แตะกรอบ = รายละเอียด
  function txtOf(bx) {
    const ev = [...new Set(bx.ev)];
    const run = bx.run ? `<br>💥 <b>ทะลุ${bx.side < 0 ? 'ขึ้น' : 'ลง'}</b> แล้ววิ่งต่อสูงสุด <b>$${bx.run.usd.toFixed(1)}</b> (${bx.run.atr.toFixed(1)} ATR) ใน ${Math.round(bx.run.bars * 5 / 60 * 10) / 10} ชม.${bx.run.back ? ' · <b style="color:#ffb347">กลับเข้ามาใน 1 ชม. (ทะลุหลอก)</b>' : ''}` : '';
    return `🛡 <b>ดีลเลอร์รับ ${bx.k}</b> (${bx.p.toFixed(1)}) · ${bx.side < 0 ? 'ขึ้นไม่ผ่าน' : 'ลงไม่ผ่าน'} <b>${bx.tests.length}</b> ครั้ง · ${bx.live ? 'ยังยืน' : bx.broke !== undefined ? 'แตกแล้ว' : 'จบ'}${bx.est ? '<br><small>แนววันนี้ใช้แทน (วันนั้นยังไม่มีประวัติ GEX)</small>' : ''}<br>หลักฐานรับจริง: ${ev.length ? ev.join(' · ') : 'ยังไม่มี'}${run}`;
  }
  let dn = null;
  O.chartEl.addEventListener('pointerdown', e => { dn = { x: e.clientX, y: e.clientY }; }, true);
  O.chartEl.addEventListener('pointerup', e => {
    if (!cfg.on || !dn || Math.hypot(e.clientX - dn.x, e.clientY - dn.y) > 8) { dn = null; return; } dn = null;
    const r = O.chartEl.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
    const z = hit.filter(b => x >= b.x0 && x <= b.x1 && y >= b.y1 && y <= b.y2).sort((a, b) => (a.y2 - a.y1) - (b.y2 - b.y1))[0];
    if (z && O.showToast) setTimeout(() => O.showToast(txtOf(z.bx), 9000), 160);
  }, true);

  // ---------- เมนู ƒx ----------
  function info() {
    if (!boxes.length) return 'ยังไม่พบจุดที่ราคาผ่านไม่ได้';
    const a = boxes.filter(b => b.live), br = boxes.filter(b => b.run), md = arr => { const s = [...arr].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : 0; };
    const days = Object.keys(hist).length;
    return `ยังยืน ${a.length} · แตกแล้ว ${br.length}${br.length ? ` (วิ่งต่อมัธยฐาน $${md(br.map(b => b.run.usd)).toFixed(1)} · หลอก ${Math.round(br.filter(b => b.run.back).length / br.length * 100)}%)` : ''} · ย้อน ~${Math.round(bars.length * 5 / 60 / 24 * 10) / 10} วัน · ประวัติ GEX ${days} วัน`;
  }
  function section() {
    const d = document.createElement('div'); d.id = 'dbBox'; d.className = 'gsbox';
    d.innerHTML = `<div class="row"><button class="gsb${cfg.on ? ' on' : ''}" data-db="on"><i style="background:#fff"></i>🛡 กรอบดีลเลอร์รับ (ราคาผ่านไม่ได้)</button><span class="gsinfo">${cfg.on ? info() : ''}</span></div>` +
      (cfg.on ? `<div class="row ps"><label>ชนไม่ผ่านก่อนแสดง (ครั้ง)<input type="number" inputmode="numeric" min="1" max="20" step="1" data-dbtests value="${cfg.minTests}" style="width:64px"></label></div><div class="row ps"><span class="gsinfo">นับแท่ง M5 ที่ปิดกลับฝั่งเดิม ห่างจากครั้งก่อนอย่างน้อย 3 แท่ง · หลักฐานรับจริงดูได้เมื่อแตะกรอบ · ประยาว = แนววันนั้นยังไม่มีประวัติ (ใช้แนววันนี้) · ประจาง = จบหรือแตกแล้ว · แตะกรอบดูรายละเอียด/ทะลุไปไกลแค่ไหน</span></div>` : '');
    return d;
  }
  function mount() { const m = $('indMenu'); if (!m || m.hidden || $('dbBox')) return; const box = section(), anchor = $('dhBox') || $('s3Box') || $('btBox') || m.querySelector('.t'); anchor ? anchor.after(box) : m.prepend(box); }
  const menu = $('indMenu');
  if (menu) {
    new MutationObserver(() => mount()).observe(menu, { childList: true });
    menu.addEventListener('click', e => { if (!e.target.closest('[data-db]')) return; cfg.on = !cfg.on; save(); boxes = []; invalidate(); const b = $('dbBox'); if (b) b.remove(); mount(); run(true); });
  }
  if (menu) menu.addEventListener('change', e => {
    const input = e.target.closest('[data-dbtests]'); if (!input) return;
    const value = normTests(input.value);
    if (value === null) { input.value = cfg.minTests; return; }
    cfg.minTests = value; input.value = value; save();
    boxes = bars.length ? scan(bars, levels()) : [];
    invalidate(); const b = $('dbBox'); if (b) b.remove(); mount();
    if (!bars.length) run(true);
  });
  window.OI_dbox = { get cfg() { return cfg; }, get boxes() { return boxes; }, get hist() { return hist; }, levels, scan, run, dayKey };
})();

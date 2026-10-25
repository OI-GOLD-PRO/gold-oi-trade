// ข้อมูลออปชันสัญญาที่หมดอายุวันนั้นแบบสด (ช้า 10 นาทีตาม TradingView) จาก Worker /opt
// - gmf itd คำนวณใหม่ทุก 1 นาที (OI ของวันจากชีต + IV สด + เวลาที่เหลือจริง + ราคาปัจจุบัน)
// - volume สดแทน volume ในชีต, ซื้อ/ขายสุทธิราย strike, Vol/OI (🔥), Expected Move, Skew
// - ป้ายสถานะมุมซ้ายบนของกราฟ: γ± · COT · Skew · EM
(() => {
  'use strict';
  const O = window.OI;
  const G = () => (O && O.gcOff ? O.gcOff() : 0); // GC − โบรก: ราคา GC → ราคาบนกราฟโบรก
  if (!O || !O.hooks) return;
  if (!(O.sym === 'gold' || O.sym === 'gcy')) return;
  const URL_OPT = 'https://gc-yahoo.oigoldpro.workers.dev/opt';
  const YEAR = 365 * 864e5;
  const st = { d: null, at: 0, err: null, calc: null, hist: [] };
  window.OILive = st;

  // ---------- Black-76 gamma ----------
  const pdf = x => Math.exp(-x * x / 2) / Math.sqrt(2 * Math.PI);
  const gam = (S, K, T, iv) => { const v = iv * Math.sqrt(T); if (!(v > 0)) return 0; const d1 = (Math.log(S / K) + v * v / 2) / v; return pdf(d1) / (S * v); };
  function flip(opts, F, T, signOf) {
    const g = S => opts.reduce((a, o) => a + signOf(o) * gam(S, o.k, T, o.iv) * o.oi * 100 * S * S * 0.01, 0);
    let best = null, prev = null;
    const lo = F * 0.97, hi = F * 1.03;
    for (let S = Math.floor(lo); S <= hi; S += 0.5) {
      const v = g(S);
      if (prev && prev[1] * v < 0) { const x = prev[0] + (S - prev[0]) * (prev[1] / (prev[1] - v)); if (best === null || Math.abs(x - F) < Math.abs(best - F)) best = x; }
      prev = [S, v];
    }
    return { flip: best === null ? null : Math.round(best * 10) / 10, gexAtF: g(F) };
  }

  // ---------- คำนวณ ----------
  function compute() {
    const d = st.d, oi = O.oi;
    if (!d || !d.rows || !d.rows.length) return null;
    const cfgC = (O.cfgData && O.cfgData.contract) || null;
    const match = !!(oi && cfgC && String(cfgC).toUpperCase() === String(d.root).toUpperCase());
    const now = Date.now(), T = Math.max((d.expTs * 1000 - now) / YEAR, 60e3 / YEAR);
    const S0 = O.lastClose !== null && isFinite(O.lastClose) ? O.lastClose + G() : d.F;
    // รวมรายการต่อ strike
    const map = new Map();
    d.rows.forEach(([k, t, iv, delta, g, bid, ask, lp, vol, buy, sell]) => {
      const r = map.get(k) || { k }; r[t] = { iv, delta, g, bid, ask, lp, vol, buy, sell }; map.set(k, r);
    });
    const oiMap = new Map(); if (match) oi.rows.forEach(r => oiMap.set(r.strike, r));
    const ks = [...map.keys()].sort((a, b) => a - b);
    // IV ที่ขาด: ใช้ค่าข้างเคียง
    ['C', 'P'].forEach(t => { let last = null; ks.forEach(k => { const o = map.get(k)[t]; if (o && o.iv) last = o.iv; else if (o) o.iv = last; }); });
    const strikes = ks.map(k => {
      const r = map.get(k), o = oiMap.get(k) || { c: 0, p: 0 };
      const C = r.C || {}, P = r.P || {};
      return { k, c: o.c || 0, p: o.p || 0, ivC: C.iv, ivP: P.iv, dC: C.delta, dP: P.delta, gC: C.g, gP: P.g,
        vc: C.vol || 0, vp: P.vol || 0, bc: C.buy || 0, sc: C.sell || 0, bp: P.buy || 0, sp: P.sell || 0 };
    });
    // gmf itd สด (สมมติฐานมาตรฐาน Call +, Put −) และแบบปรับตามซื้อ/ขายของวันนี้
    let gmf = null, gmfAdj = null, gexAtF = null;
    if (match) {
      const opts = [];
      strikes.forEach(s => {
        if (s.c > 0 && s.ivC) opts.push({ k: s.k, t: 'C', iv: s.ivC, oi: s.c, buy: s.bc, sell: s.sc });
        if (s.p > 0 && s.ivP) opts.push({ k: s.k, t: 'P', iv: s.ivP, oi: s.p, buy: s.bp, sell: s.sp });
      });
      if (opts.length) {
        const f1 = flip(opts, S0, T, o => o.t === 'C' ? 1 : -1);
        gmf = f1.flip; gexAtF = f1.gexAtF;
        // ลูกค้าขาย (sell > buy) → MM ถือฝั่งซื้อ → gamma บวก · ลูกค้าซื้อ → MM ขาย → gamma ลบ (ต้องมี volume ≥ 10)
        gmfAdj = flip(opts, S0, T, o => { const v = o.buy + o.sell; return v >= 10 ? (o.sell - o.buy) / v : (o.t === 'C' ? 1 : -1); }).flip;
      }
    }
    // Skew 25 delta: IV Put ที่ delta −0.25 ลบ IV Call ที่ delta +0.25 (จุด)
    const ivAtDelta = (t, target) => {
      const pts = strikes.map(s => t === 'C' ? [s.dC, s.ivC] : [s.dP, s.ivP]).filter(p => p[0] != null && p[1]).sort((a, b) => a[0] - b[0]);
      for (let i = 1; i < pts.length; i++) { const [d0, v0] = pts[i - 1], [d1, v1] = pts[i]; if ((d0 - target) * (d1 - target) <= 0 && d1 !== d0) return v0 + (v1 - v0) * (target - d0) / (d1 - d0); }
      return null;
    };
    const p25 = ivAtDelta('P', -0.25), c25 = ivAtDelta('C', 0.25);
    const skew = p25 !== null && c25 !== null ? (p25 - c25) * 100 : null;
    // GEX ราย strike (gamma จาก TradingView)
    const F2 = S0 * S0 * 0.01 * 100;
    strikes.forEach(s => { s.gex = ((s.gC || 0) * s.c - (s.gP || 0) * s.p) * F2; });
    return { match, root: d.root, cfgC, T, S0, gmf, gmfAdj, gexAtF, skew, p25, c25, strikes, em: d.em, emK: d.emK, openF: d.openF, openEM: d.openEM, updated: d.updated, expTs: d.expTs };
  }

  // ---------- ดึงข้อมูล ----------
  async function poll() {
    try {
      const r = await fetch(URL_OPT + '?t=' + Math.floor(Date.now() / 30000), { cache: 'no-store' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const d = await r.json();
      if (!d || !d.rows) throw new Error('ไม่มีข้อมูล');
      st.d = d; st.at = Date.now(); st.err = null;
    } catch (e) { st.err = e.message || String(e); }
    tick();
  }
  // OI ของสัญญาวันนี้จาก Worker (TradingView อัปเดตวันละครั้งเอง) แทน OI ในชีต
  function syncLevels() {
    const d = st.d;
    if (!d || !d.rows || !O.setLevels || !O.cfgData || !O.oi) return;
    const lv = [];
    d.rows.forEach(r => { if (r[11] > 0) lv.push({ strike: r[0], oi: r[11], type: r[1] }); });
    if (!lv.length) return;
    const sig = d.root + '|' + d.oiT + '|' + lv.length + '|' + lv.reduce((a, l) => a + l.oi, 0);
    if (st.lvSig === sig && st.lvOi === O.oi) return;
    const dt = d.oiT ? new Date(d.oiT * 1000).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', timeZone: 'Asia/Bangkok' }) : '';
    O.setLevels(lv, d.root, dt ? `OI ${dt}` : 'OI สด');
    st.lvSig = sig; st.lvOi = O.oi; st.oiSrc = 'tv';
  }
  function tick() {
    syncLevels();
    st.lastOi = O.oi;
    st.calc = compute();
    const c = st.calc;
    if (c && c.gmf !== null) {
      st.hist.push([Date.now(), c.gmf]);
      st.hist = st.hist.filter(h => Date.now() - h[0] < 20 * 60e3);
    }
    applyToOI();
    O.markDirty();
    document.dispatchEvent(new CustomEvent('oilive'));
  }
  setTimeout(poll, 2500);
  setInterval(poll, 60000);
  // ชีตโหลดเสร็จหลังข้อมูลสด หรือโหลดชีตใหม่ (oi ถูกสร้างใหม่): คำนวณซ้ำ
  setInterval(() => {
    if (!st.d || !O.cfgData) return;
    if (!st.calc || st.calc.cfgC !== (O.cfgData.contract || null) || st.lastOi !== O.oi) { st.lastOi = O.oi; tick(); }
  }, 3000);

  // ใส่ volume สด + gmf itd สด ลงในข้อมูล OI ของกราฟ (buildOI สร้าง oi ใหม่ทุกครั้งที่โหลดชีต จึงต้องใส่ซ้ำ)
  function applyToOI() {
    const oi = O.oi, c = st.calc;
    if (!oi || !c || !c.match) return;
    const vm = new Map(c.strikes.map(s => [s.k, s]));
    oi.rows.forEach(r => { const s = vm.get(r.strike); r.vc = s ? s.vc : 0; r.vp = s ? s.vp : 0; });
    oi.maxVol = Math.max(1, ...oi.rows.map(r => Math.max(r.vc || 0, r.vp || 0)));
    oi.hasVol = oi.rows.some(r => r.vc || r.vp);
    oi.topV = [...oi.rows].filter(r => (r.vc || 0) + (r.vp || 0) > 0).sort((a, b) => (b.vc + b.vp) - (a.vc + a.vp)).slice(0, 5).map(r => r.strike);
    // gmf M จาก Worker (คำนวณทุกชั่วโมงจากทุกสัญญา ≤ 30 วัน)
    const gm = st.d && st.d.gmfM;
    if (gm && gm.M !== null && gm.M !== undefined) {
      oi.gmf = (oi.gmf || []).filter(g => g.lab !== 'gmf M');
      oi.gmf.push({ p: gm.M, lab: 'gmf M', col: '--gmfm' });
    }
    if (c.gmf !== null) {
      oi.gmf = (oi.gmf || []).filter(g => g.lab !== 'gmf itd');
      oi.gmf.push({ p: c.gmf, lab: 'gmf itd' + trend(), col: '--gmfi' });
    }
    oi.__live = st.at;
  }
  function trend() {
    const h = st.hist; if (h.length < 2) return '';
    const old = h.find(x => Date.now() - x[0] >= 4 * 60e3) || h[0], cur = h[h.length - 1];
    const dv = cur[1] - old[1];
    return Math.abs(dv) < 0.5 ? '' : dv > 0 ? ' ↑' : ' ↓';
  }

  // 🔥 เงินใหม่: volume วันนี้ ≥ OI (หรือไม่มี OI) และเป็น strike ที่เทรดหนาจริง (≥ 50 และ ≥ ครึ่งหนึ่งของ strike ที่เทรดมากสุดรอบราคา)
  const hot = (s, vMax) => { const v = s.vc + s.vp, o = s.c + s.p; return v >= 50 && v >= vMax * 0.5 && (o === 0 || v / o >= 1); };
  st.hot = hot;

  // ---------- วาดบนกราฟ ----------
  const C = v => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
  O.hooks.push((ctx, w, h) => {
    const oi = O.oi, c = st.calc;
    if (oi && st.at && oi.__live !== st.at) { applyToOI(); if (oi.__live === st.at) setTimeout(() => O.markDirty(), 0); }
    const chart = O.chart, series = O.series;
    const plotW = chart.timeScale().width(), plotH = h - chart.timeScale().height();
    const mono = C('--mono') || 'monospace';
    // 1) แถบ Expected Move ของวัน (Straddle ตอนเปิดวันเทรด)
    if (c && c.openF && c.openEM) {
      const top = series.priceToCoordinate(c.openF + c.openEM - G()), bot = series.priceToCoordinate(c.openF - c.openEM - G());
      if (top !== null && bot !== null) {
        ctx.save();
        ctx.globalAlpha = 0.07; ctx.fillStyle = '#9aa7ff'; ctx.fillRect(0, Math.min(top, bot), plotW, Math.abs(bot - top));
        ctx.globalAlpha = 0.55; ctx.strokeStyle = '#9aa7ff'; ctx.lineWidth = 1; ctx.setLineDash([2, 4]);
        [top, bot].forEach(y => { if (y > 0 && y < plotH) { ctx.beginPath(); ctx.moveTo(0, Math.round(y) + .5); ctx.lineTo(plotW, Math.round(y) + .5); ctx.stroke(); } });
        ctx.setLineDash([]); ctx.globalAlpha = 0.9; ctx.fillStyle = '#9aa7ff'; ctx.font = `9px ${mono}`; ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
        const ex = Math.round(plotW * 0.2);
        if (top > 24 && top < plotH) ctx.fillText(`EM บน ${(c.openF + c.openEM - G()).toFixed(1)}`, ex, top - 2);
        ctx.textBaseline = 'top';
        if (bot > 0 && bot < plotH - 10) ctx.fillText(`EM ล่าง ${(c.openF - c.openEM - G()).toFixed(1)}`, ex, bot + 2);
        ctx.restore();
      }
    }
    // 2) ป้ายท้าย strike ±5 รอบราคา: C▲/C▼ P▲/P▼ (ซื้อ/ขายสุทธิวันนี้) และ 🔥 (Vol/OI ≥ 1)
    if (c && c.match && oi && O.lastClose !== null) {
      const px = O.lastClose + G();
      const near = c.strikes.filter(s => s.vc + s.vp + s.c + s.p > 0).sort((a, b) => Math.abs(a.k - px) - Math.abs(b.k - px)).slice(0, 11);
      ctx.save(); ctx.font = `bold 10px ${mono}`; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
      const x0 = Math.min(plotW * 0.36, 150);
      const vMax = Math.max(1, ...near.map(s => s.vc + s.vp));
      near.forEach(s => {
        const y = series.priceToCoordinate(s.k - G()); if (y === null || y < 26 || y > plotH - 8) return;
        const parts = [];
        const sig = (b, sl, lab) => { const v = b + sl, n = b - sl; if (v >= 10 && Math.abs(n) >= Math.max(5, v * 0.2)) parts.push([lab + (n > 0 ? '▲' : '▼'), n > 0 ? C('--call') : C('--put')]); };
        sig(s.bc, s.sc, 'C'); sig(s.bp, s.sp, 'P');
        const v = s.vc + s.vp, o = s.c + s.p;
        if (hot(s, vMax)) parts.push(['🔥', '#fff']);
        if (!parts.length) return;
        let x = x0;
        parts.forEach(([t, col]) => { ctx.fillStyle = col; ctx.fillText(t, x, y - 6); x += ctx.measureText(t).width + 4; });
      });
      ctx.restore();
    }
    // 3) ป้ายสถานะมุมซ้ายบน
    const badges = [];
    const gm = oi && oi.gmf ? oi.gmf.find(g => g.lab === 'gmf M') : null;
    if (gm && O.lastClose !== null) badges.push(O.lastClose + G() >= gm.p ? ['γ+ เหนือFlip', C('--call')] : ['γ− ใต้Flip', C('--put')]);
    const cot = window.OICot;
    if (cot && cot.bias !== undefined) badges.push(cot.bias > 0 ? ['COT↑', C('--call')] : cot.bias < 0 ? ['COT↓', C('--put')] : ['COT→', C('--gold')]);
    if (c && c.skew !== null) badges.push(c.skew > 1.5 ? ['😨Put skew', C('--put')] : c.skew < -1.5 ? ['🤑Call skew', C('--call')] : ['⚖️Skew กลาง', C('--muted')]);
    if (c && c.em) badges.push([`EM ±${c.em.toFixed(1)}`, '#9aa7ff']);
    if (st.err && !c) badges.push(['ข้อมูลสดไม่ได้', C('--muted')]);
    else if (c && !c.match) badges.push([`สด ${c.root} ≠ ชีต ${c.cfgC || '–'}`, C('--muted')]);
    if (badges.length) {
      ctx.save(); ctx.font = `bold 10px ${mono}`; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
      let x = 6; const y = 12;
      badges.forEach(([t, col]) => {
        const tw = ctx.measureText(t).width + 10;
        if (x + tw > plotW - 4) return;
        ctx.globalAlpha = 0.82; ctx.fillStyle = C('--bg') || '#0b1020'; ctx.fillRect(x, y - 8, tw, 16);
        ctx.globalAlpha = 1; ctx.strokeStyle = col; ctx.lineWidth = 1; ctx.strokeRect(x + .5, y - 7.5, tw - 1, 15);
        ctx.fillStyle = col; ctx.fillText(t, x + 5, y + .5);
        x += tw + 4;
      });
      ctx.restore();
    }
  });
})();

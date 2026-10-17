// Gold Scalping indicator (port of TradingView "GOLD SCALPING (V1.1 by Tammy)")
// Self-contained: needs only window.OI (chart, series, oi, hooks, markDirty) and the ƒx menu (#indMenu).
// Modes: "normal" = every signal like the Pine script; "oi" = only signals near an OI wall / option-volume zone.
(() => {
  'use strict';
  const O = window.OI;
  if (!O) return;
  const $ = id => document.getElementById(id);

  const DEF = {
    on: false, mode: 'normal',
    rsiLen: 14, mid: 50, maType: 'SMA', out: 50, inn: 30,
    dist: 3, walls: true, vol: true,
    trend: false, trendLen: 200, trendType: 'SMA',
    ribbon: false, ribLen: 60, ribType: 'HMA',
  };
  if (O.cfg && O.cfg.tol) DEF.dist = Math.round(O.cfg.tol * 2 * 100) / 100; // ใกล้โซน = 2 เท่าของระยะเตือน (ทอง $3)
  const KEY = 'oit_gs' + (O.sfx || '');
  let cfg = Object.assign({}, DEF);
  try { Object.assign(cfg, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch (e) {}
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch (e) {} };

  // ---------- maths (same as Pine) ----------
  const smaArr = (v, n) => { const o = []; let s = 0, c = 0; v.forEach((x, i) => { s += x; if (i >= n) s -= v[i - n]; o.push(i >= n - 1 ? s / n : null); }); return o; };
  const emaArr = (v, n) => { const k = 2 / (n + 1), o = []; let e = null; v.forEach((x, i) => { if (x === null) { o.push(null); return; } e = e === null ? x : x * k + e * (1 - k); o.push(i >= n - 1 ? e : null); }); return o; };
  const rmaArr = (v, n) => { const o = []; let r = null; v.forEach((x, i) => { if (i < n - 1) { o.push(null); return; } r = r === null ? v.slice(0, n).reduce((a, b) => a + b, 0) / n : (r * (n - 1) + x) / n; o.push(r); }); return o; };
  const wmaArr = (v, n) => { const o = [], d = n * (n + 1) / 2; v.forEach((_, i) => { if (i < n - 1 || v.slice(i - n + 1, i + 1).some(x => x === null)) { o.push(null); return; } let s = 0; for (let j = 0; j < n; j++) s += v[i - n + 1 + j] * (j + 1); o.push(s / d); }); return o; };
  const hmaArr = (v, n) => {
    const a = wmaArr(v, Math.max(1, Math.floor(n / 2))), b = wmaArr(v, n);
    return wmaArr(v.map((_, i) => a[i] === null || b[i] === null ? null : 2 * a[i] - b[i]), Math.max(1, Math.round(Math.sqrt(n))));
  };
  const maOf = (type, v, n) => type === 'EMA' ? emaArr(v, n) : type === 'HMA' ? hmaArr(v, n) : type === 'WMA' ? wmaArr(v, n) : type === 'RMA' ? rmaArr(v, n) : smaArr(v, n);
  const rsiArr = (C, n) => {
    const o = [null]; let ag = 0, al = 0;
    for (let i = 1; i < C.length; i++) {
      const d = C[i] - C[i - 1], g = Math.max(d, 0), l = Math.max(-d, 0);
      if (i <= n) { ag += g / n; al += l / n; o.push(i === n ? (al === 0 ? 100 : 100 - 100 / (1 + ag / al)) : null); }
      else { ag = (ag * (n - 1) + g) / n; al = (al * (n - 1) + l) / n; o.push(al === 0 ? 100 : 100 - 100 / (1 + ag / al)); }
    }
    return o;
  };
  const trArr = B => B.map((b, i) => i ? Math.max(b.high - b.low, Math.abs(b.high - B[i - 1].close), Math.abs(b.low - B[i - 1].close)) : b.high - b.low);

  // ---------- chart objects ----------
  const lineOpt = (color, extra) => Object.assign({ color, lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false }, extra || {});
  let S = null;          // line series
  let R = null;          // last computed result
  let hidden = false;

  function build() {
    if (S) { Object.values(S).forEach(s => { try { O.chart.removeSeries(s); } catch (e) {} }); S = null; }
    try { O.series.setMarkers([]); } catch (e) {}
    R = null;
    if (!cfg.on) { O.markDirty(); paintTbl(); return; }
    const add = o => O.chart.addLineSeries(o);
    S = {
      out_s: add(lineOpt('#ef5350')), out_b: add(lineOpt('#01a546')),
      in_s: add(lineOpt('rgba(253,122,0,.55)')), in_b: add(lineOpt('rgba(16,238,219,.55)')),
      mid: add(lineOpt('#ffffff')),
    };
    if (cfg.trend) S.trend = add(lineOpt('#ffd54f', { lineWidth: 3 }));
    if (cfg.ribbon) { S.rib_o = add(lineOpt('#ff0000', { visible: false })); S.rib_c = add(lineOpt('#62ff42', { visible: false })); }
    lastKey = ''; compute(); tblAt = 0; paintTbl(); refreshTbl(true);
  }

  // nearest-zone test (prices already on the chart's broker scale: OI.oi.rows[].price)
  function zones() {
    const oi = O.oi; if (!oi || oi.offset === null) return [];
    const set = new Set();
    if (cfg.walls) { (oi.top5P || []).forEach(s => set.add(s)); (oi.top5C || []).forEach(s => set.add(s)); }
    if (cfg.vol) (oi.topV || []).forEach(s => set.add(s));
    return oi.rows.filter(r => set.has(r.strike) && r.price !== null).map(r => r.price);
  }

  // one entry per bar: null or { up, strong, mark }
  function sigsOf(B, bd, Z) {
    const { r100, r0, r90, r10 } = bd;
    const near = b => Z && Z.some(z => z >= b.low - cfg.dist && z <= b.high + cfg.dist);
    return B.map((b, i) => {
      if (r10[i] === null || r0[i] === null) return null;
      const buyStrong = b.open < r0[i] && b.close > r0[i], sellStrong = b.open > r100[i] && b.close < r100[i];
      const buyWeak = b.open < r10[i] && b.close > r10[i], sellWeak = b.open > r90[i] && b.close < r90[i];
      let m = null;
      if (buyStrong) m = { s: 'BUY!!', up: true, c: '#216d1f' };
      else if (buyWeak) m = { s: 'BUY', up: true, c: '#60f0b9' };
      else if (sellStrong) m = { s: 'SELL!!', up: false, c: '#ff0000' };
      else if (sellWeak) m = { s: 'SELL', up: false, c: '#f87846' };
      if (!m || (Z && !near(b))) return null;
      return { up: m.up, strong: m.s.endsWith('!!'), mark: { time: b.time, position: m.up ? 'belowBar' : 'aboveBar', color: m.c, shape: m.up ? 'arrowUp' : 'arrowDown', text: m.s, size: 1 } };
    });
  }
  function bandsOf(B) {
    const C = B.map(b => b.close);
    const atr = rmaArr(trArr(B), 100), orsi = rsiArr(C, cfg.rsiLen);
    const adj = C.map((c, i) => atr[i] === null || orsi[i] === null ? null : c + atr[i] * orsi[i] / 100);
    const first = adj.findIndex(v => v !== null);
    const rma = Array(Math.max(first, 0)).fill(null).concat(first < 0 ? [] : maOf(cfg.maType, adj.slice(first), cfg.mid));
    const band = k => rma.map((m, i) => m === null || atr[i] === null ? null : m + atr[i] * k);
    return { r100: band(cfg.out / 10), r0: band(-cfg.out / 10), r90: band(cfg.inn / 10), r10: band(-cfg.inn / 10) };
  }

  // ---------- TF table (M1..H4, last 5 bars) ----------
  const TFL = [['1m', 'M1'], ['5m', 'M5'], ['15m', 'M15'], ['30m', 'M30'], ['1h', 'H1'], ['4h', 'H4']];
  const tblData = {}; let tblBusy = false, tblAt = 0;
  function paintTbl() {
    const el = $('gsTbl'); if (!el) return;
    el.classList.toggle('on', !!cfg.on);
    if (!cfg.on) return;
    el.innerHTML = TFL.map(([t, lab]) => {
      const d = tblData[t] || [];
      const cells = Array.from({ length: 5 }, (_, k) => { const x = d[d.length - 5 + k]; return x ? `<i class="${x.up ? 'u' : 'd'}${x.strong ? ' s' : ''}">${x.up ? '▲' : '▼'}</i>` : '<i>·</i>'; }).join('');
      return `<div class="c${O.tf === t ? ' cur' : ''}" data-tf="${t}"><b>${lab}</b><div class="a">${cells}</div></div>`;
    }).join('');
  }
  async function refreshTbl(force) {
    if (!cfg.on || tblBusy || document.visibilityState === 'hidden') return;
    if (!force && Date.now() - tblAt < 25000) return;
    tblBusy = true;
    try {
      const Z = cfg.mode === 'oi' ? zones() : null;
      const res = await Promise.all(TFL.map(async ([t]) => {
        const B = await O.fetchTF(t, 450);
        if (!B || B.length < 120) return [t, null];
        const sg = sigsOf(B, bandsOf(B), Z);
        return [t, sg.slice(-5).map(x => x)];
      }));
      res.forEach(([t, d]) => { if (d) tblData[t] = d; });
      tblAt = Date.now();
    } catch (e) { console.error(e); }
    tblBusy = false; paintTbl();
  }
  setInterval(() => refreshTbl(false), 10000);
  setInterval(paintTbl, 2000);

  let lastKey = '';
  function compute() {
    if (!S) return;
    const B = O.series.data();
    if (!B || B.length < 120) return;
    const oi = O.oi, key = [B.length, B[B.length - 1].time, B[B.length - 1].close, JSON.stringify(cfg), oi ? oi.rows.length + ':' + (oi.rows[0] && oi.rows[0].price) : 0].join('|');
    if (key === lastKey) return; lastKey = key;

    const T = B.map(b => b.time), C = B.map(b => b.close);
    const atr = rmaArr(trArr(B), 100);
    const orsi = rsiArr(C, cfg.rsiLen);
    const adj = C.map((c, i) => atr[i] === null || orsi[i] === null ? null : c + atr[i] * orsi[i] / 100);
    // MA over a series that starts late: run it on the valid tail only
    const first = adj.findIndex(v => v !== null);
    const tail = first < 0 ? [] : maOf(cfg.maType, adj.slice(first), cfg.mid);
    const rma = Array(Math.max(first, 0)).fill(null).concat(tail);
    const band = k => rma.map((m, i) => m === null || atr[i] === null ? null : m + atr[i] * k);
    const o = cfg.out / 10, n = cfg.inn / 10;
    const r100 = band(o), r0 = band(-o), r90 = band(n), r10 = band(-n);

    const ln = a => a.map((v, i) => v === null || !isFinite(v) ? { time: T[i] } : { time: T[i], value: v });
    S.out_s.setData(ln(r100)); S.out_b.setData(ln(r0)); S.in_s.setData(ln(r90)); S.in_b.setData(ln(r10)); S.mid.setData(ln(rma));
    let rib = null;
    if (S.trend) S.trend.setData(ln(maOf(cfg.trendType, C, cfg.trendLen)));
    if (S.rib_o) {
      const mo = maOf(cfg.ribType, B.map(b => b.open), cfg.ribLen), mc = maOf(cfg.ribType, C, cfg.ribLen);
      S.rib_o.setData(ln(mo)); S.rib_c.setData(ln(mc)); rib = { mo, mc };
    }

    // signals (open crosses back through the band by the close)
    const Z = cfg.mode === 'oi' ? zones() : null;
    const sigs = sigsOf(B, { r100, r0, r90, r10 }, Z);
    const marks = sigs.filter(x => x).map(x => x.mark);
    try { O.series.setMarkers(marks); } catch (e) {}
    R = { T, r100, r0, r90, r10, rib, nSig: marks.length, nZones: Z ? Z.length : null };
    O.markDirty();
    paintInfo();
  }

  // ---------- band / ribbon fills (canvas hook) ----------
  O.hooks.push((ctx, w, h) => {
    if (!R || !S) return;
    const ts = O.chart.timeScale(), vr = ts.getVisibleLogicalRange(); if (!vr) return;
    const i0 = Math.max(0, Math.floor(vr.from) - 1), i1 = Math.min(R.T.length - 1, Math.ceil(vr.to) + 1);
    const X = i => ts.timeToCoordinate(R.T[i]), Y = p => O.series.priceToCoordinate(p);
    const fill = (a, b, col, pick) => {
      ctx.fillStyle = col; ctx.beginPath(); let open = false, seg = [];
      const flush = () => {
        if (seg.length < 2) { seg = []; return; }
        ctx.beginPath(); seg.forEach((p, k) => k ? ctx.lineTo(p.x, p.ya) : ctx.moveTo(p.x, p.ya));
        for (let k = seg.length - 1; k >= 0; k--) ctx.lineTo(seg[k].x, seg[k].yb);
        ctx.closePath(); ctx.fill(); seg = [];
      };
      for (let i = i0; i <= i1; i++) {
        const x = X(i), va = a[i], vb = b[i];
        if (x === null || va === null || vb === null || (pick && !pick(i))) { flush(); continue; }
        const ya = Y(va), yb = Y(vb); if (ya === null || yb === null) { flush(); continue; }
        seg.push({ x, ya, yb });
      }
      flush();
    };
    fill(R.r100, R.r90, 'rgba(248,0,0,.10)');
    fill(R.r10, R.r0, 'rgba(43,255,0,.10)');
    if (R.rib) {
      fill(R.rib.mo, R.rib.mc, 'rgba(255,0,0,.22)', i => R.rib.mo[i] > R.rib.mc[i]);
      fill(R.rib.mo, R.rib.mc, 'rgba(98,255,66,.22)', i => R.rib.mo[i] <= R.rib.mc[i]);
    }
  });

  // refresh when bars / OI / config change (cheap key check once a second)
  setInterval(() => { if (cfg.on) compute(); }, 1000);

  // ---------- ƒx menu section ----------
  const TYPES = ['SMA', 'EMA', 'HMA', 'WMA', 'RMA'];
  const num = (k, lab, step) => `<label>${lab}<input type="number" inputmode="decimal" step="${step || 1}" data-gs="${k}" value="${cfg[k]}"></label>`;
  const sel = (k, lab) => `<label>${lab}<select data-gs="${k}">${TYPES.map(t => `<option${cfg[k] === t ? ' selected' : ''}>${t}</option>`).join('')}</select></label>`;
  const chk = (k, lab) => `<button class="gsb${cfg[k] ? ' on' : ''}" data-gst="${k}">${lab}</button>`;

  function paintInfo() {
    const el = $('gsInfo'); if (!el) return;
    el.textContent = !R ? '' : cfg.mode === 'oi'
      ? (R.nZones ? `โหมด OI: ${R.nSig} สัญญาณใกล้โซน (${R.nZones} โซน)` : 'โหมด OI: ยังไม่มีข้อมูลโซน OI จึงไม่แสดงสัญญาณ')
      : `${R.nSig} สัญญาณบนกราฟ`;
  }
  function section() {
    const d = document.createElement('div');
    d.id = 'gsBox'; d.className = 'gsbox';
    d.innerHTML = `<div class="row"><button class="gsb${cfg.on ? ' on' : ''}" data-gst="on"><i style="background:#60f0b9"></i>Gold Scalping</button><span id="gsInfo" class="gsinfo"></span></div>` +
      (cfg.on ? `
      <div class="row"><button class="gsb${cfg.mode === 'normal' ? ' on' : ''}" data-gsm="normal">ปกติ (ตามโค้ด)</button><button class="gsb${cfg.mode === 'oi' ? ' on' : ''}" data-gsm="oi">เฉพาะใกล้โซน OI</button></div>
      ${cfg.mode === 'oi' ? `<div class="row ps">${num('dist', 'ใกล้ (จุดราคา)', O.cfg && O.cfg.tick < 1 ? 0.05 : 5)}${chk('walls', 'กำแพง OI')}${chk('vol', 'วอลลุ่ม')}</div>` : ''}
      <div class="row ps">${num('rsiLen', 'RSI')}${num('mid', 'MID')}${sel('maType', 'RSI MA')}${num('out', 'OUT')}${num('inn', 'IN')}</div>
      <div class="row ps">${chk('trend', 'MA Trend')}${cfg.trend ? num('trendLen', 'คาบ') + sel('trendType', 'ชนิด') : ''}</div>
      <div class="row ps">${chk('ribbon', 'MA Ribbon')}${cfg.ribbon ? num('ribLen', 'คาบ') + sel('ribType', 'ชนิด') : ''}</div>` : '');
    return d;
  }
  function mount() {
    const m = $('indMenu'); if (!m || m.hidden || $('gsBox')) return;
    const box = section(), t = m.querySelector('.t');
    t ? t.after(box) : m.prepend(box);
    paintInfo();
  }
  function remount() { const b = $('gsBox'); if (b) b.remove(); mount(); }

  const menu = $('indMenu');
  if (menu) {
    new MutationObserver(() => mount()).observe(menu, { childList: true });
    menu.addEventListener('click', e => {
      const t = e.target.closest('[data-gst],[data-gsm]'); if (!t) return;
      if (t.dataset.gsm) cfg.mode = t.dataset.gsm;
      else cfg[t.dataset.gst] = !cfg[t.dataset.gst];
      save(); const rebuild = t.dataset.gst === 'on' || t.dataset.gst === 'trend' || t.dataset.gst === 'ribbon';
      if (rebuild) build(); else { lastKey = ''; compute(); refreshTbl(true); }
      remount(); $('indBtn').classList.toggle('has', cfg.on || $('indBtn').classList.contains('has'));
    });
    menu.addEventListener('change', e => {
      const inp = e.target.closest('[data-gs]'); if (!inp) return;
      const k = inp.dataset.gs;
      if (inp.tagName === 'SELECT') cfg[k] = inp.value;
      else { let v = parseFloat(inp.value); if (!isFinite(v) || v <= 0) v = DEF[k]; if (k !== 'dist') v = Math.max(1, Math.min(500, Math.round(v))); cfg[k] = v; inp.value = v; }
      save(); lastKey = ''; compute(); refreshTbl(true);
    });
  }
  // "reset all" in the ƒx menu should not wipe this indicator's own setting
  if (cfg.on) build();
  window.OI_goldScalp = { get cfg() { return cfg; }, get result() { return R; }, build };
})();

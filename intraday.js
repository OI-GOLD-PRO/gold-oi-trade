// OI Intraday: แผนที่ (Call/Put Wall ตาม GEX, กรอบ EM, Flip) + สัญญาณยิง (VWAP + แท่ง Rejection) + โซนห้ามเทรดรอบข่าวแดง
// VWAP รายวันเริ่มนับใหม่ 05:00 น. (เวลาไทย) จาก volume ของ perp · ลูกศร ▲/▼ พร้อม Entry / TP1 / TP2 / SL เฉพาะ M15 และ H1
// กฎ (จากแนวทางอินทราเดย์ที่ผู้ใช้ให้มา):
//   ▼ Short: ไส้บนแตะ Call Wall หรือขอบบน EM + ไส้บน ≥ 60% ของแท่ง + ปิดใต้ VWAP → TP1 = VWAP/กลางทาง, TP2 = Put Wall หรือขอบล่าง EM, SL = เหนือไส้
//   ▲ Long : กลับด้านกันที่ Put Wall หรือขอบล่าง EM
//   ไม่ออกสัญญาณในโซนข่าวแดง · ★ = ไปทางเดียวกับ Gamma (ใต้ gmf M = Short, เหนือ = Long)
(() => {
  'use strict';
  const O = window.OI;
  const G = () => (O && O.gcOff ? O.gcOff() : 0); // GC − โบรก
  if (!O || !O.hooks || O.sym !== 'gold') return;
  const $ = id => document.getElementById(id);
  const TZ = 7 * 3600, SESS = 5 * 3600; // แกนเวลาของกราฟเป็นเวลาไทย · วันเทรดเริ่ม 05:00
  const DEF = { on: false, sig: true, nb: 15, na: 30 };
  const KEY = 'oit_intra' + (O.psfx || '');
  let cfg = Object.assign({}, DEF);
  try { Object.assign(cfg, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch (e) {}
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch (e) {} };

  // ---------- ข่าวแดง (news.json) ----------
  let news = [];
  async function loadNews() {
    try {
      const own = location.hostname.endsWith('.github.io') ? location.hostname.split('.')[0] : 'OI-GOLD-PRO';
      const j = await (await fetch(`https://raw.githubusercontent.com/${own}/gold-oi-pro/main/news.json?t=${Math.floor(Date.now() / 300000)}`, { cache: 'no-store' })).json();
      news = (j.events || []).filter(e => e.c === 'USD' && (e.i || 'H') === 'H').map(e => Date.parse(e.date) / 1000).filter(isFinite);
    } catch (e) {}
  }
  loadNews(); setInterval(loadNews, 10 * 60e3);
  // เวลาไทยบนแกน (วินาที) → อยู่ในโซนห้ามเทรดไหม
  const inNews = tChart => { const tu = tChart - TZ; return news.some(n => tu >= n - cfg.nb * 60 && tu <= n + cfg.na * 60); };

  // ---------- ระดับของวันเทรดย้อนหลัง (Worker บันทึกตอนเปิดวัน 05:00 น.) ----------
  let hist = new Map();
  async function loadHist() {
    try {
      const j = await (await fetch('https://gc-yahoo.oigoldpro.workers.dev/levels', { cache: 'no-store' })).json();
      hist = new Map((j.hist || []).map(h => [h.sess, h])); lastKey = '';
    } catch (e) {}
  }
  loadHist(); setInterval(loadHist, 15 * 60e3);
  // เลขวันเทรด (นับจากแกนเวลาไทย) → yyyymmdd ของวันที่เริ่ม 05:00 น.
  const sessYmd = s => { const d = new Date((s * 86400 + SESS) * 1000); return d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate(); };
  const histLevels = h => { const s = v => (v === null || v === undefined) ? v : v - G(); return { cw: s(h.cw), pw: s(h.pw), em: h.openEM ? { top: s(h.openF + h.openEM), bot: s(h.openF - h.openEM) } : null, flip: s(h.M ?? null), past: true }; };

  // ---------- ระดับราคา ----------
  function levels(px) {
    px = px + G(); // ราคากราฟโบรก → สเกล GC ของ strike
    const L = window.OILive && window.OILive.calc, oi = O.oi;
    let cw = null, pw = null;
    if (L && L.match && L.strikes && L.strikes.length) {
      let bc = 0, bp = 0;
      L.strikes.forEach(s => {
        const gc = (s.gC || 0) * s.c, gp = (s.gP || 0) * s.p;
        if (s.k >= px - 10 && gc > bc) { bc = gc; cw = s.k; }
        if (s.k <= px + 10 && gp > bp) { bp = gp; pw = s.k; }
      });
    }
    if ((cw === null || pw === null) && oi && oi.rows) { // สำรอง: OI มากสุดแต่ละฝั่ง
      let bc = 0, bp = 0;
      oi.rows.forEach(r => { if (cw === null && r.strike >= px - 10 && r.c > bc) { bc = r.c; cw = r.strike; } if (pw === null && r.strike <= px + 10 && r.p > bp) { bp = r.p; pw = r.strike; } });
    }
    const em = L && L.openEM ? { top: L.openF + L.openEM, bot: L.openF - L.openEM } : null;
    const gm = oi && oi.gmf ? oi.gmf.find(g => g.lab === 'gmf M') : null;
    const sh = v => (v === null || v === undefined) ? v : Math.round((v - G()) * 100) / 100; // กลับเป็นสเกลกราฟโบรก
    return { cw: sh(cw), pw: sh(pw), em: em && { top: sh(em.top), bot: sh(em.bot) }, flip: gm ? sh(gm.p) : null };
  }

  // ---------- VWAP + สัญญาณ ----------
  let R = null, lineV = null, lineU = null, lineD = null, lastSigKey = '';
  function ensureLines() {
    if (lineV || !cfg.on) return;
    const opt = (c, w, st) => ({ color: c, lineWidth: w, lineStyle: st || 0, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
    lineV = O.chart.addLineSeries(opt('#f2f2f2', 2));
    lineU = O.chart.addLineSeries(opt('rgba(200,200,200,.45)', 1, 2));
    lineD = O.chart.addLineSeries(opt('rgba(200,200,200,.45)', 1, 2));
  }
  function dropLines() { [lineV, lineU, lineD].forEach(s => { if (s) try { O.chart.removeSeries(s); } catch (e) {} }); lineV = lineU = lineD = null; R = null; O.markDirty(); }

  let lastKey = '', lastTf = null;
  function compute() {
    if (!cfg.on) return;
    ensureLines();
    const B = O.series.data(); if (!B || B.length < 10) return;
    const vol = new Map((O.rawBars || []).map(k => [Math.floor(k[0] / 1000) + TZ, k[5] || 0]));
    const key = [B.length, B[B.length - 1].time, B[B.length - 1].close, O.tf, JSON.stringify(cfg), O.oi && O.oi.rows.length].join('|');
    if (key === lastKey) return; lastKey = key;
    // เปลี่ยน TF: ล้างเส้น VWAP ของ TF เดิมก่อน (กันจุดเวลาเก่าค้างทำให้แกนเวลา/ตำแหน่งแท่งเพี้ยน)
    if (lastTf !== O.tf) { lastTf = O.tf; try { lineV.setData([]); lineU.setData([]); lineD.setData([]); } catch (e) {} }
    // VWAP รายวัน (เริ่ม 05:00)
    const V = [], U = [], D = [], vw = [];
    let sess = null, pv = 0, vv = 0, pv2 = 0;
    B.forEach((b, i) => {
      const s = Math.floor((b.time - SESS) / 86400);
      if (s !== sess) { sess = s; pv = 0; vv = 0; pv2 = 0; if (i) { V.push({ time: b.time }); U.push({ time: b.time }); D.push({ time: b.time }); } }
      const tp = (b.high + b.low + b.close) / 3, v = vol.get(b.time) || 0;
      pv += tp * v; vv += v; pv2 += tp * tp * v;
      if (vv > 0) {
        const m = pv / vv, sd = Math.sqrt(Math.max(0, pv2 / vv - m * m));
        if (!(V.length && V[V.length - 1].time === b.time)) { V.push({ time: b.time, value: m }); U.push({ time: b.time, value: m + sd }); D.push({ time: b.time, value: m - sd }); }
        vw[i] = m;
      } else { if (!(V.length && V[V.length - 1].time === b.time)) { V.push({ time: b.time }); U.push({ time: b.time }); D.push({ time: b.time }); } vw[i] = null; }
    });
    try { lineV.setData(V); lineU.setData(U); lineD.setData(D); } catch (e) {}
    // สัญญาณ: เฉพาะ M15/H1 · วันนี้ใช้ระดับสด · วันก่อนหน้าใช้ระดับที่บันทึกไว้ของวันนั้น (ไม่มีบันทึก = ไม่แสดง)
    const sigs = [];
    const px = B[B.length - 1].close, Lnow = levels(px);
    let L = Lnow, nPast = 0;
    if (cfg.sig && (O.tf === '15m' || O.tf === '1h')) {
      const todayS = Math.floor((B[B.length - 1].time - SESS) / 86400), tol = 2;
      for (let i = 1; i < B.length - 1; i++) {
        const b = B[i], s = Math.floor((b.time - SESS) / 86400);
        if (vw[i] === null || inNews(b.time)) continue;
        if (s === todayS) L = Lnow;
        else { const h = hist.get(sessYmd(s)); if (!h) continue; L = histLevels(h); }
        const rng = b.high - b.low; if (rng < 1.5) continue;
        const up = b.high - Math.max(b.open, b.close), dn = Math.min(b.open, b.close) - b.low;
        const topLv = [L.cw, L.em && L.em.top].filter(v => v !== null && v !== undefined), botLv = [L.pw, L.em && L.em.bot].filter(v => v !== null && v !== undefined);
        const hitTop = topLv.find(v => b.high >= v - tol && b.close < v), hitBot = botLv.find(v => b.low <= v + tol && b.close > v);
        if (hitTop !== undefined && up >= 0.6 * rng && b.close < vw[i]) {
          const sl = b.high + Math.max(1.5, rng * 0.15), e = b.close;
          const t2c = [L.pw, L.em && L.em.bot].filter(v => v !== null && v !== undefined && v < e - 2).sort((a, c) => c - a)[0];
          const t1 = vw[i] < e - 1 ? vw[i] : (t2c !== undefined ? (e + t2c) / 2 : e - (sl - e));
          if (L.past) nPast++;
          sigs.push({ i, time: b.time, dir: -1, e, sl, t1, t2: t2c !== undefined ? t2c : e - 2 * (sl - e), lvl: hitTop, star: L.flip !== null && e < L.flip });
        } else if (hitBot !== undefined && dn >= 0.6 * rng && b.close > vw[i]) {
          const sl = b.low - Math.max(1.5, rng * 0.15), e = b.close;
          const t2c = [L.cw, L.em && L.em.top].filter(v => v !== null && v !== undefined && v > e + 2).sort((a, c) => a - c)[0];
          const t1 = vw[i] > e + 1 ? vw[i] : (t2c !== undefined ? (e + t2c) / 2 : e + (e - sl));
          if (L.past) nPast++;
          sigs.push({ i, time: b.time, dir: 1, e, sl, t1, t2: t2c !== undefined ? t2c : e + 2 * (e - sl), lvl: hitBot, star: L.flip !== null && e > L.flip });
        }
      }
    }
    R = { B, sigs, L: Lnow, nPast, vwapNow: vw[vw.length - 1] };
    // แจ้งเตือนสัญญาณใหม่บนแท่งที่เพิ่งปิด
    const last = sigs[sigs.length - 1];
    if (last && last.i === B.length - 2) {
      const k = last.time + ':' + last.dir;
      if (lastSigKey && k !== lastSigKey) {
        const txt = `${last.dir > 0 ? '▲ Long' : '▼ Short'}${last.star ? ' ★' : ''} @ ${last.e.toFixed(2)} · TP1 ${last.t1.toFixed(2)} · TP2 ${last.t2.toFixed(2)} · SL ${last.sl.toFixed(2)}`;
        if (O.showToast) O.showToast('🎯 OI Intraday: ' + txt);
        if (O.beep) O.beep();
        try { navigator.vibrate && navigator.vibrate([200, 100, 200]); } catch (e) {}
      }
      lastSigKey = k;
    } else if (!lastSigKey) lastSigKey = last ? last.time + ':' + last.dir : 'none';
    paintInfo();
    O.markDirty();
  }
  setInterval(compute, 1500);

  // ---------- วาด ----------
  O.hooks.push((ctx, w, h) => {
    if (!cfg.on || !R) return;
    const ts = O.chart.timeScale(), sr = O.series;
    const plotW = ts.width(), plotH = h - ts.height();
    const mono = getComputedStyle(document.documentElement).getPropertyValue('--mono') || 'monospace';
    ctx.save();
    // โซนห้ามเทรดรอบข่าวแดง (แถบแดงจางแนวตั้ง)
    news.forEach(n => {
      const a = ts.timeToCoordinate(n + TZ - cfg.nb * 60), b = ts.timeToCoordinate(n + TZ + cfg.na * 60);
      if (a === null && b === null) return;
      const x0 = a === null ? 0 : a, x1 = b === null ? plotW : b;
      if (x1 < 0 || x0 > plotW) return;
      ctx.globalAlpha = 0.10; ctx.fillStyle = '#ef4444'; ctx.fillRect(Math.max(0, x0), 0, Math.min(plotW, x1) - Math.max(0, x0), plotH);
      ctx.globalAlpha = 0.8; ctx.fillStyle = '#ef4444'; ctx.font = `bold 9px ${mono}`; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
      ctx.fillText('⛔ ข่าว', Math.max(2, x0 + 2), 30);
    });
    // Call Wall / Put Wall (GEX)
    const wall = (p, col, lab) => {
      if (p === null || p === undefined) return; const y = sr.priceToCoordinate(p); if (y === null || y < 2 || y > plotH - 2) return;
      ctx.globalAlpha = 0.9; ctx.strokeStyle = col; ctx.lineWidth = 2.5; ctx.setLineDash([]);
      ctx.beginPath(); ctx.moveTo(plotW * 0.55, Math.round(y) + .5); ctx.lineTo(plotW, Math.round(y) + .5); ctx.stroke();
      ctx.font = `bold 9px ${mono}`; ctx.fillStyle = col; ctx.textAlign = 'right'; ctx.textBaseline = 'bottom'; ctx.fillText(`${lab} ${p}`, plotW * 0.55 - 4, y + 4);
    };
    wall(R.L.cw, '#2fbf8f', 'Call Wall'); wall(R.L.pw, '#e5576b', 'Put Wall');
    // ลูกศร + Entry/TP/SL ของสัญญาณล่าสุด
    const bw = Math.max(4, Math.min(14, (ts.options().barSpacing || 8) * 0.8));
    R.sigs.forEach((s, k) => {
      const x = ts.timeToCoordinate(s.time); if (x === null || x < 0 || x > plotW) return;
      const b = R.B[s.i], y = sr.priceToCoordinate(s.dir < 0 ? b.high : b.low); if (y === null) return;
      const col = s.dir < 0 ? '#ff4d6a' : '#22e39a', yy = s.dir < 0 ? y - 8 : y + 8, sz = bw * 0.9;
      ctx.globalAlpha = 1; ctx.fillStyle = col; ctx.beginPath();
      if (s.dir < 0) { ctx.moveTo(x - sz / 2, yy - sz); ctx.lineTo(x + sz / 2, yy - sz); ctx.lineTo(x, yy); }
      else { ctx.moveTo(x - sz / 2, yy + sz); ctx.lineTo(x + sz / 2, yy + sz); ctx.lineTo(x, yy); }
      ctx.closePath(); ctx.fill();
      if (s.star) { ctx.font = `bold 10px ${mono}`; ctx.textAlign = 'center'; ctx.textBaseline = s.dir < 0 ? 'bottom' : 'top'; ctx.fillText('★', x, s.dir < 0 ? yy - sz - 1 : yy + sz + 1); }
      if (k !== R.sigs.length - 1) return;
      // เส้นแผนเทรดของสัญญาณล่าสุด ยื่นไปทางขวา
      const x1 = Math.min(plotW - 2, x + Math.max(80, bw * 14));
      const row = (p, c, lab, dash) => { const yp = sr.priceToCoordinate(p); if (yp === null) return; ctx.strokeStyle = c; ctx.lineWidth = 1.5; ctx.setLineDash(dash || []); ctx.beginPath(); ctx.moveTo(x, Math.round(yp) + .5); ctx.lineTo(x1, Math.round(yp) + .5); ctx.stroke(); ctx.setLineDash([]); ctx.fillStyle = c; ctx.font = `bold 9px ${mono}`; ctx.textAlign = 'left'; ctx.textBaseline = 'bottom'; ctx.fillText(`${lab} ${p.toFixed(1)}`, x1 - 70, yp - 1); };
      row(s.e, '#ffd36b', 'Entry'); row(s.t1, '#22e39a', 'TP1', [4, 3]); row(s.t2, '#22e39a', 'TP2', [4, 3]); row(s.sl, '#ff4d6a', 'SL', [2, 2]);
      const rr = Math.abs(s.t2 - s.e) / Math.max(0.01, Math.abs(s.e - s.sl));
      ctx.fillStyle = '#ffd36b'; ctx.fillText(`R:R 1:${rr.toFixed(1)}`, x1 - 70, (sr.priceToCoordinate(s.e) || 0) + 12);
    });
    ctx.restore();
  });

  // ---------- เมนู ƒx ----------
  function paintInfo() {
    const el = $('ivInfo'); if (!el) return;
    if (!cfg.on || !R) { el.textContent = ''; return; }
    const tfOk = O.tf === '15m' || O.tf === '1h';
    el.textContent = `VWAP ${R.vwapNow ? R.vwapNow.toFixed(2) : '–'} · Call Wall ${R.L.cw ?? '–'} · Put Wall ${R.L.pw ?? '–'}` + (cfg.sig ? (tfOk ? ` · ${R.sigs.length} สัญญาณ` + (R.nPast ? ` (ย้อนหลัง ${R.nPast})` : '') + ` · บันทึกระดับ ${hist.size} วัน` : ' · ลูกศรแสดงเฉพาะ M15/H1') : '');
  }
  function section() {
    const d = document.createElement('div');
    d.id = 'ivBox'; d.className = 'gsbox';
    d.innerHTML = `<div class="row"><button class="gsb${cfg.on ? ' on' : ''}" data-ivt="on"><i style="background:#f2f2f2"></i>OI Intraday (VWAP + Walls)</button><span id="ivInfo" class="gsinfo"></span></div>` +
      (cfg.on ? `<div class="row ps"><button class="gsb${cfg.sig ? ' on' : ''}" data-ivt="sig">ลูกศร + TP/SL</button>
        <label>ข่าว: ก่อน (นาที)<input type="number" inputmode="numeric" data-iv="nb" value="${cfg.nb}"></label>
        <label>หลัง (นาที)<input type="number" inputmode="numeric" data-iv="na" value="${cfg.na}"></label></div>` : '');
    return d;
  }
  function mount() { const m = $('indMenu'); if (!m || m.hidden || $('ivBox')) return; const box = section(), t = m.querySelector('.t'); t ? t.after(box) : m.prepend(box); paintInfo(); }
  function remount() { const b = $('ivBox'); if (b) b.remove(); mount(); }
  const menu = $('indMenu');
  if (menu) {
    new MutationObserver(() => mount()).observe(menu, { childList: true });
    menu.addEventListener('click', e => {
      const t = e.target.closest('[data-ivt]'); if (!t) return;
      cfg[t.dataset.ivt] = !cfg[t.dataset.ivt]; save();
      if (t.dataset.ivt === 'on') { if (cfg.on) { lastKey = ''; compute(); } else dropLines(); }
      else { lastKey = ''; compute(); }
      remount();
      if (cfg.on) $('indBtn').classList.add('has');
    });
    menu.addEventListener('change', e => {
      const inp = e.target.closest('[data-iv]'); if (!inp) return;
      let v = Math.round(parseFloat(inp.value)); if (!isFinite(v) || v < 0) v = DEF[inp.dataset.iv]; v = Math.min(240, v);
      cfg[inp.dataset.iv] = v; inp.value = v; save(); lastKey = ''; compute();
    });
  }
  if (cfg.on) { setTimeout(() => { lastKey = ''; compute(); }, 3000); }
  window.OI_intraday = { get cfg() { return cfg; }, get result() { return R; } };
})();

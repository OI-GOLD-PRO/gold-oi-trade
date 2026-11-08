// 🌡 โหมดตลาดตามความผันผวน (หนังสือ The Invisible Money บทที่ 9–10) + เส้น ±1/2/3σ ของวัน + การ์ด "ความผันผวน & ประวัติ IV" ในหน้าแดช
// ข้อมูล: vol.json / iv_hist.json (GitHub Actions ทุกชั่วโมง: scripts/vol.mjs)
//  โหมด = เปอร์เซ็นไทล์ของ HV 20 วัน (GC=F ตั้งแต่ปี 2000)
//   🟢 < 25%  ตลาดสงบ  → เล่นตามเทรนด์ / เบรกกำแพง
//   🟠 25–75% ปกติ      → สวนกลับที่กำแพง OI (Wall Rejection) ได้ผลดีที่สุด
//   🔴 > 75%  สติแตก    → ลดไม้ ขยาย SL สวนเฉพาะเลย 2–3σ และ IV เริ่มลง · ห้ามสวน Squeeze
//  ขนาดไม้แนะนำ = HV มัธยฐาน ÷ HV ตอนนี้ · SL = HV ตอนนี้ ÷ HV มัธยฐาน
//  เส้น σ: จุดกึ่งกลาง = ราคาเปิดรอบเทรดวันนี้ · 1σ ของวัน = ราคาเปิด × IV ATM วันนี้ (มัธยฐาน) ÷ √365 (IV เราคำนวณเอง) · ไม่มี IV สด → GVZ ÷ √252
(() => {
  'use strict';
  const O = window.OI;
  if (!O || !O.hooks || !(O.sym === 'gold' || O.sym === 'gcy')) return;
  const $ = id => document.getElementById(id);
  const KEY = 'oit_volreg' + (O.psfx || '');
  const cfg = { on: !window.OI_NEWDEV, sd: true }; // V4.9.29 เครื่องใหม่ปิดเป็นค่าเริ่ม
  try { Object.assign(cfg, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch (e) {}
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch (e) {} };
  const ZN = {
    g: { name: 'สงบ', col: '#22e39a', bg: 'rgba(34,227,154,.10)', ico: '🟢', how: 'ตลาดสงบ ราคามักเดินเป็นเทรนด์/ไซด์เวย์แคบ → <b>เล่นตามเทรนด์</b> เบรกกำแพงแล้วตาม ไม่ควรสวน' },
    o: { name: 'ปกติ', col: '#ff9f1a', bg: 'rgba(255,159,26,.10)', ico: '🟠', how: 'ช่วงที่สถิติดีที่สุดของสายสวนกลับ → <b>Wall Rejection / 🎯 3 ขั้น</b> ที่กำแพง OI อันดับต้น ๆ' },
    r: { name: 'แกว่งแรง', col: '#ff4d6a', bg: 'rgba(255,77,106,.12)', ico: '🔴', how: 'กำไรเฉลี่ยของตลาดติดลบ → <b>ลดไม้ ขยาย SL</b> · สวนเฉพาะตอนราคาเลย ±2–3σ และ IV เริ่มลง · ห้ามสวนเมื่อมีป้าย ⚠️ Squeeze · ขาลงแรงกว่าขาขึ้น อย่ารีบดักซื้อ' }
  };
  let V = null, IH = null, sess = null; // sess = { t (เวลาไทยวินาที), open }

  async function load() {
    const q = '?t=' + Math.floor(Date.now() / 600e3);
    try { const j = await (await fetch('https://oi-gold-pro.github.io/gold-oi-pro/vol.json' + q, { cache: 'no-store' })).json(); if (j && j.gc) { V = j; O.markDirty(); } } catch (e) {}
    try { const j = await (await fetch('https://oi-gold-pro.github.io/gold-oi-pro/iv_hist.json' + q, { cache: 'no-store' })).json(); if (j) IH = j; } catch (e) {}
  }
  setTimeout(load, 2500); setInterval(load, 30 * 60e3);

  // ---------- โหมด ----------
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  function regime() {
    if (!V || !V.gc) return null;
    const g = V.gc, z = g.pct < 25 ? 'g' : g.pct <= 75 ? 'o' : 'r';
    return { z, Z: ZN[z], hv: g.last, pct: g.pct, size: clamp(g.p50 / g.last, 0.25, 1.5), sl: clamp(g.last / g.p50, 0.7, 3), g, gvz: V.gvz };
  }

  // ---------- เส้น σ ของวัน ----------
  async function loadSess() {
    try {
      const B = await O.fetchTF('5m', 300); if (!B || B.length < 10) return;
      let i0 = 0; for (let i = B.length - 1; i > 0; i--) if (B[i].time - B[i - 1].time >= 40 * 60) { i0 = i; break; } // รอยต่อพักตลาด (17:00–18:00 NY) = เริ่มรอบเทรดใหม่
      const nxt = { t: B[i0].time, open: B[i0].open };
      if (!sess || sess.t !== nxt.t || sess.open !== nxt.open) { sess = nxt; O.markDirty(); }
    } catch (e) {}
  }
  setTimeout(loadSess, 4000); setInterval(loadSess, 5 * 60e3);
  function sigma() { // → { s (1σ เป็นดอลลาร์), src }
    if (!sess) return null;
    // IV ATM ของเรา: มัธยฐานของค่าที่บันทึกบนเซิร์ฟเวอร์ตั้งแต่เปิดรอบนี้ + ค่าสดตอนนี้ (ช่วงเปิดตลาด spread กว้าง IV เพี้ยนสูง จึงไม่ใช้ค่าแรกค่าเดียว)
    const R = window.OI_iv && window.OI_iv.result, t0 = sess.t - 7 * 3600;
    const xs = (IH && IH.hourly ? IH.hourly.filter(h => h[0] >= t0 + 1800).map(h => h[1] / 100) : []);
    if (R && R.mode === 'live' && R.iv > 0) xs.push(R.iv);
    if (xs.length) { const a = xs.sort((x, y) => x - y), iv = a[Math.floor(a.length / 2)]; return { s: sess.open * iv / Math.sqrt(365), iv, src: `IV ATM วันนี้ (คำนวณเอง, มัธยฐาน ${a.length} ค่า)` }; }
    if (V && V.gvz) return { s: sess.open * V.gvz.last / 100 / Math.sqrt(252), iv: V.gvz.last / 100, src: 'GVZ (IV 30 วันของทอง)' };
    if (V && V.gc) return { s: sess.open * V.gc.last / 100 / Math.sqrt(252), iv: V.gc.last / 100, src: 'HV 20 วัน' };
    return null;
  }
  const zNow = () => { const S = sigma(), P = O.lastClose; return S && P ? (P - sess.open) / S.s : null; };

  // ---------- Expected Range ถึงหมดอายุ แบบ CME QuikStrike (Vol2Vol) — V4.5.4 ----------
  // จุดกึ่งกลาง = ราคาตอนนี้ · 1SD = F × Vol Settle (ที่ราคานั้น จากเส้น smile ของ settlement ล่าสุด) × √(เวลาที่เหลือถึงหมดอายุ ÷ 365)
  // เทียบกับ QuikStrike 2 พ.ย. 16:50: F 3909.3, Vol 19.57%, 0.36 DTE → 1SD 3885–3934 (ตรงกับแถบเทาในกราฟ CME)
  const YEAR = 365 * 864e5;
  const NCDF = x => { const z = Math.abs(x) / Math.SQRT2, t = 1 / (1 + 0.3275911 * z), y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-z * z); return x >= 0 ? 0.5 * (1 + y) : 0.5 * (1 - y); };
  const b76 = (F, K, T, v, c) => { const w = v * Math.sqrt(T), d1 = (Math.log(F / K) + w * w / 2) / w, d2 = d1 - w; return c ? F * NCDF(d1) - K * NCDF(d2) : K * NCDF(-d2) - F * NCDF(-d1); };
  const implVol = (p, F, K, T, c) => { if (!(p > Math.max(0, c ? F - K : K - F) + 0.02)) return null; let lo = 0.01, hi = 3; if (b76(F, K, T, hi, c) < p) return null; for (let i = 0; i < 60; i++) { const m = (lo + hi) / 2; if (b76(F, K, T, m, c) > p) hi = m; else lo = m; } return (lo + hi) / 2; };
  let smile = null; // { key, pts:[[K, iv]] }
  function settleSmile(cme) {
    const key = cme.root + cme.exp + cme.settle.tradeDate; if (smile && smile.key === key) return smile;
    const [m, d, y] = String(cme.settle.tradeDate).split('/').map(Number), e = String(cme.exp);
    const T = (Date.UTC(+e.slice(0, 4), +e.slice(4, 6) - 1, +e.slice(6, 8), 12, 30) - Date.UTC(y, m - 1, d, 17, 0)) / YEAR; // เวลาแบบ CME
    const sm = new Map(cme.settle.rows.map(([k, t, v]) => [k + t, v])), px = (k, t) => sm.get(k + t) || null;
    const ks = [...new Set(cme.settle.rows.map(r => r[0]))].sort((a, b) => a - b);
    const par = ks.filter(k => px(k, 'C') && px(k, 'P')).sort((a, b) => Math.abs(px(a, 'C') - px(a, 'P')) - Math.abs(px(b, 'C') - px(b, 'P'))).slice(0, 3).map(k => k + px(k, 'C') - px(k, 'P')).sort((a, b) => a - b);
    const F = par.length ? par[Math.floor(par.length / 2)] : null, pts = [];
    if (F && T > 0) ks.forEach(k => { if (Math.abs(k - F) > F * 0.08) return; const c = k >= F; let v = px(k, c ? 'C' : 'P') ? implVol(px(k, c ? 'C' : 'P'), F, k, T, c) : null; if (v === null && px(k, c ? 'P' : 'C')) v = implVol(px(k, c ? 'P' : 'C'), F, k, T, !c); if (v && v > 0.02 && v < 2.5) pts.push([k, v]); });
    smile = { key, pts, F, date: cme.settle.tradeDate }; return smile;
  }
  const atK = (pts, x) => { if (!pts.length) return null; if (x <= pts[0][0]) return pts[0][1]; if (x >= pts[pts.length - 1][0]) return pts[pts.length - 1][1]; for (let i = 1; i < pts.length; i++) if (x <= pts[i][0]) { const [k0, v0] = pts[i - 1], [k1, v1] = pts[i]; return v0 + (v1 - v0) * (x - k0) / (k1 - k0); } return null; };
  function erange() {
    const L = window.OILive, P = O.lastClose; if (!L || !L.d || !L.d.expTs || !P) return null;
    const d = L.d, now = Date.now(), Tx = (d.expTs * 1000 - now) / YEAR; if (!(Tx > 0)) return null;
    const r0 = O.oi && O.oi.rows ? O.oi.rows.find(r => r.price !== null && r.price !== undefined) : null, off = r0 ? r0.price - r0.strike : 0;
    const F = P - off; let vol = null, src = '', settle = null;
    if (L.cme && L.cme.settle && L.cme.root === d.root && +L.cme.exp === +d.exp) { const S = settleSmile(L.cme); vol = atK(S.pts, F); if (vol) { src = `Vol Settle CME (${S.date})`; settle = vol; } }
    if (!vol) { const R = window.OI_iv && window.OI_iv.result; if (R && R.iv > 0) { vol = R.iv; src = 'IV สด (คำนวณเอง)'; } }
    if (!vol) return null;
    return { c: P, F, vol, settle, sd: F * vol * Math.sqrt(Tx), dte: Tx * 365, src, root: d.root };
  }

  // V4.5.7: กรอบ SD แบบ "ตรึง" ที่ราคา settle ล่าสุด (เส้นไม่ขยับตามราคา → ราคาวิ่งไปแตะ 1/2/3SD ได้จริง ใช้เป็นแนวสวน/เป้าตามหนังสือหน้า 203)
  //  กึ่งกลาง = ราคาฟิวเจอร์ส settle (put-call parity ของราคาปิด CME) · Vol = Vol Settle ATM · เวลา = จาก settle (17:00 CT) ถึงหมดอายุ แบบ CME
  //  คงที่ทั้งรอบจนกว่า CME จะ settle รอบใหม่ (~01:30 ไทย หลังสัญญาหมดอายุจะเปลี่ยนเป็นสัญญาถัดไป)
  function anchored() {
    const L = window.OILive; if (!L || !L.d || !L.cme || !L.cme.settle || L.cme.root !== L.d.root || +L.cme.exp !== +L.d.exp) return null;
    const S = settleSmile(L.cme); if (!S.F || !S.pts.length) return null;
    const [m, d, y] = String(L.cme.settle.tradeDate).split('/').map(Number), e = String(L.cme.exp);
    const T = (Date.UTC(+e.slice(0, 4), +e.slice(4, 6) - 1, +e.slice(6, 8), 12, 30) - Date.UTC(y, m - 1, d, 17, 0)) / YEAR; if (!(T > 0)) return null;
    const vol = atK(S.pts, S.F); if (!vol) return null;
    const r0 = O.oi && O.oi.rows ? O.oi.rows.find(r => r.price !== null && r.price !== undefined) : null, off = r0 ? r0.price - r0.strike : 0;
    const sd = S.F * vol * Math.sqrt(T), c = S.F + off, P = O.lastClose;
    return { c, F: S.F, vol, sd, days: T * 365, date: S.date, root: L.d.root, z: P ? (P - c) / sd : null };
  }
  const TFS = { '1m': 60, '5m': 300, '15m': 900, '30m': 1800, '1h': 3600, '4h': 14400, '1d': 86400 };
  O.hooks.push((ctx, w, h) => {
    return; // V4.5.8: ผู้ใช้ให้ถอดกรอบ SD ออกจากกราฟ (โค้ดเก็บไว้ เปิดใหม่ได้โดยลบบรรทัดนี้)
    if (!cfg.on || !cfg.sd) return;
    const E = anchored(); if (!E || !O.chart || !O.series) return;
    const ts = O.chart.timeScale(), sr = O.series, plotW = ts.width(), plotH = h - ts.height(), sec = TFS[O.tf] || 60;
    if (sec >= 86400) return;
    const bars = O.bars || null; let x0 = plotW * 0.55;
    const mono = getComputedStyle(document.documentElement).getPropertyValue('--mono') || 'monospace';
    ctx.save(); ctx.font = `bold 9px ${mono}`; ctx.textBaseline = 'middle'; ctx.textAlign = 'right'; ctx.lineWidth = 1;
    const col = ['#9aa7ff', '#22e39a', '#ff9f1a', '#ff4d6a'];
    // แถบ 1SD จาง ๆ + เส้นกึ่งกลาง (settle) + ±1/2/3SD ตรึงทั้งรอบ
    const yc = sr.priceToCoordinate(E.c); if (yc !== null && yc > 0 && yc < plotH) { ctx.strokeStyle = 'rgba(154,167,255,.5)'; ctx.setLineDash([1, 3]); ctx.beginPath(); ctx.moveTo(x0, yc); ctx.lineTo(plotW, yc); ctx.stroke(); ctx.setLineDash([]); ctx.fillStyle = '#9aa7ff'; ctx.fillText(`settle ${E.c.toFixed(0)}`, plotW - 4, yc - 6); }
    const yA = sr.priceToCoordinate(E.c + E.sd), yB = sr.priceToCoordinate(E.c - E.sd);
    if (yA !== null && yB !== null) { ctx.fillStyle = 'rgba(154,167,255,.06)'; ctx.fillRect(x0, Math.max(0, yA), plotW - x0, Math.min(plotH, yB) - Math.max(0, yA)); }
    for (let k = 1; k <= 3; k++) [1, -1].forEach(sg => {
      const p = E.c + sg * k * E.sd, y = sr.priceToCoordinate(p); if (y === null || y < 4 || y > plotH - 4) return;
      ctx.strokeStyle = col[k]; ctx.globalAlpha = k === 1 ? 0.55 : 0.6; ctx.setLineDash(k === 3 ? [6, 3] : [3, 4]);
      ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(plotW, y); ctx.stroke();
      ctx.globalAlpha = 0.9; ctx.setLineDash([]); ctx.fillStyle = col[k]; ctx.fillText(`${sg > 0 ? '+' : '−'}${k}SD ${p.toFixed(0)}`, plotW - 4, y - 6);
    });
    ctx.restore();
  });

  // ---------- ป้าย ----------
  (window.OIBadgeExtra = window.OIBadgeExtra || []).push(() => {
    if (!cfg.on) return null;
    const r = regime(); if (!r) return null;
    const z = null, zt = ''; // V4.5.8: เอา ±SD ออกจากป้าย
    const px = O.lastClose, dd = px ? px * r.hv / 100 / Math.sqrt(252) : 0; // V4.9.8: HV 20 วัน + ระยะวิ่งเฉลี่ยต่อวัน ($)
    return [`🌡${r.Z.ico} ${r.Z.name} ${r.pct.toFixed(0)}% · HV ${r.hv.toFixed(1)}%${dd ? ` ±$${dd.toFixed(0)}/วัน` : ''}${zt}`, r.Z.col, 'volreg', z !== null && Math.abs(z) >= 2 ? r.Z.bg : null, 'first']; // V4.5.7: ตำแหน่งราคาเทียบกรอบ SD ที่ตรึงจาก settle // V4.5.4: เอา ±σ ออก (เส้น SD ใช้แบบ CME ตามราคาปัจจุบันแล้ว) // V4.5.0: ขึ้นหน้าแถบ (เดิมอยู่ท้ายสุด ต้องเลื่อนถึงเห็น)
  });
  function explain() {
    const r = regime(); if (!r) { O.showToast && O.showToast('🌡 โหมดตลาด: กำลังโหลด vol.json…', 4000); return; }
    const g = r.g, sq = window.OI_squeeze && window.OI_squeeze.result;
    const A = anchored(), aLine = A ? `● กรอบ SD ตรึงจาก settle ${A.date} (${A.root}): กลาง ${A.c.toFixed(1)} · 1SD ±${A.sd.toFixed(1)} · 2SD ${(A.c - 2 * A.sd).toFixed(0)}–${(A.c + 2 * A.sd).toFixed(0)} · 3SD ±${(3 * A.sd).toFixed(0)} (Vol ${(A.vol * 100).toFixed(2)}%, ${A.days.toFixed(2)} วัน)<br>● ราคาตอนนี้ <b>${A.z >= 0 ? '+' : '−'}${Math.abs(A.z).toFixed(2)}SD</b> ${Math.abs(A.z) >= 3 ? '→ ถึง 3SD (หางอ้วน: รอแรงเหวี่ยง/IV ลดก่อนสวน)' : Math.abs(A.z) >= 2 ? '→ เลย 2SD เฝ้าจังหวะกลับตัว' : Math.abs(A.z) >= 1 ? '→ เลย 1SD' : '→ อยู่ในกรอบ 1SD'}<br>` : '';
    const E = erange(), zLine = E ? `● กรอบจากราคาตอนนี้ (แบบหน้าจอ QuikStrike ขยับตามราคา): ${E.root}, เหลือ ${E.dte.toFixed(2)} วัน) แบบ CME: 1SD = ±${E.sd.toFixed(1)} → ${(E.c - E.sd).toFixed(0)}–${(E.c + E.sd).toFixed(0)} · 2SD ±${(2 * E.sd).toFixed(0)} · 3SD ±${(3 * E.sd).toFixed(0)} (${E.src} ${(E.vol * 100).toFixed(2)}%)<br>` : '';
    O.showToast && O.showToast(
      `<b style="color:${r.Z.col}">${r.Z.ico} โหมดตลาด: ${r.Z.name}</b> · HV 20 วัน ${g.last.toFixed(1)}% = เปอร์เซ็นไทล์ <b>${g.pct.toFixed(0)}</b> (เทียบตั้งแต่ ${g.since.slice(0, 4)})<br>` +
      (O.lastClose ? `● HV ต่อวัน = ${g.last.toFixed(1)}% ÷ √252 = <b>±${(g.last / Math.sqrt(252)).toFixed(2)}%</b> ≈ <b>±$${(O.lastClose * g.last / 100 / Math.sqrt(252)).toFixed(1)}</b> ต่อวัน — ราคาปิดวันนี้ห่างจากปิดเมื่อวานไม่เกินนี้ ~71% ของวัน (backtest GC 2000–2026) · เกิน 3 เท่า ~2% (เดือนละครั้ง)<br>` +
        `● กรอบระหว่างวัน (สูง−ต่ำ) ≈ ×1.5 = <b>~$${(O.lastClose * g.last / 100 / Math.sqrt(252) * 1.5).toFixed(0)}</b> · ไส้แตะเกิน ±1 เท่าจากปิดเมื่อวาน ~60% ของวัน → อย่าวาง SL ที่ขอบ ±$ พอดี · 🟢 ผันผวนต่ำ ตัวเลขมักต่ำไป (ระวังระเบิด) / 🔴 สูง มักสูงไปนิด<br>` : '') +
      `● เกณฑ์: 🟢 &lt; ${g.p25}% · 🟠 ${g.p25}–${g.p75}% · 🔴 &gt; ${g.p75}% (มัธยฐาน ${g.p50}%)<br>` +
      `● ${r.Z.how}<br>` +
      `● ขนาดไม้แนะนำ <b>×${r.size.toFixed(2)}</b> ของปกติ · ระยะ SL <b>×${r.sl.toFixed(2)}</b><br>` +
      aLine + zLine +
      (r.gvz ? `● IV ทอง (GVZ) ${r.gvz.last.toFixed(1)}% = เปอร์เซ็นไทล์ ${r.gvz.pct.toFixed(0)} (ตั้งแต่ ${r.gvz.since.slice(0, 4)})<br>` : '') +
      `● สถิติรายวัน: Skew ${g.skew} (ปีนี้ ${g.skew1y}) · Kurtosis ${g.kurt} (ปีนี้ ${g.kurt1y}) → ${g.skew < 0 ? 'ขาลงแรงกว่าขาขึ้น' : 'ขาขึ้นแรงกว่า'} · หางอ้วน หลุด 3σ บ่อยกว่าทฤษฎี<br>` +
      (sq && sq.lv >= 2 ? `<b style="color:#ff4d6a">⚠️ ตอนนี้มีป้าย Squeeze → ห้ามสวน</b><br>` : '') +
      `<span style="opacity:.6">ข้อมูล HV/GVZ รายวัน (Yahoo) อัปเดตทุกชั่วโมง · ${g.asof}</span>`, 22000);
  }
  let down = null;
  const onBadge = e => { const el = e.target && (e.target.nodeType === 1 ? e.target : e.target.parentElement); return el && el.closest ? el.closest('#badges [data-k="volreg"]') : null; };
  document.addEventListener('pointerdown', e => { down = onBadge(e) ? { x: e.clientX, y: e.clientY } : null; }, true);
  document.addEventListener('pointerup', e => {
    if (!down) return;
    const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y) > 10; down = null;
    const r = document.querySelector('#badges [data-k="volreg"]')?.getBoundingClientRect();
    if (!moved && r && e.clientX >= r.left - 4 && e.clientX <= r.right + 4 && e.clientY >= r.top - 6 && e.clientY <= r.bottom + 6) setTimeout(explain, 120);
  }, true);

  // ---------- เมนู ƒx ----------
  function section() {
    const d = document.createElement('div'); d.id = 'vrBox'; d.className = 'gsbox'; const r = regime();
    d.innerHTML = `<div class="row"><button class="gsb${cfg.on ? ' on' : ''}" data-vr="on"><i style="background:#ff9f1a"></i>🌡 โหมดตลาด (ความผันผวน)</button><span class="gsinfo">${r ? `${r.Z.ico} ${r.Z.name} · HV ${r.hv.toFixed(1)}% (P${r.pct.toFixed(0)})` : ''}</span></div>` +
      '';
    return d;
  }
  function mount() { const m = $('indMenu'); if (!m || m.hidden || $('vrBox')) return; const box = section(), anchor = $('wrBox') || $('s3Box') || $('dhBox') || $('btBox') || m.querySelector('.t'); anchor ? anchor.after(box) : m.prepend(box); }
  const menu = $('indMenu');
  if (menu) {
    new MutationObserver(() => mount()).observe(menu, { childList: true });
    menu.addEventListener('click', e => {
      const a = e.target.closest('[data-vr]'); if (!a) return;
      if (a.dataset.vr === 'on') cfg.on = !cfg.on; else cfg.sd = !cfg.sd;
      save(); O.markDirty(); const b = $('vrBox'); if (b) b.remove(); mount();
    });
  }

  // ---------- การ์ดหน้าแดช: ความผันผวน & ประวัติ IV ----------
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  function lineChart(series, opt) { // series: [{pts:[[x(ms),y]], col, w, dash, dot}] → svg
    const W = 680, H = opt.h || 240, L = 34, R = 8, T = 10, B = 20;
    const all = series.flatMap(s => s.pts); if (all.length < 2) return '<div class="note">ยังมีข้อมูลไม่พอวาดกราฟ</div>';
    const x0 = Math.min(...all.map(p => p[0])), x1 = Math.max(...all.map(p => p[0]));
    let y0 = Math.min(...all.map(p => p[1])), y1 = Math.max(...all.map(p => p[1])); // พื้นโหมดไม่ขยายสเกล (ถูกตัดตามกรอบ)
    const pad = (y1 - y0) * 0.08 || 1; y0 = Math.max(0, y0 - pad); y1 += pad;
    const X = x => L + (x - x0) / ((x1 - x0) || 1) * (W - L - R), Y = y => T + (1 - (y - y0) / ((y1 - y0) || 1)) * (H - T - B);
    const out = [`<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(opt.label || 'กราฟ')}" style="width:100%;display:block">`];
    (opt.bands || []).forEach(([a, b, c]) => out.push(`<rect x="${L}" width="${W - L - R}" y="${Y(Math.min(b, y1))}" height="${Math.max(0, Y(Math.max(a, y0)) - Y(Math.min(b, y1)))}" fill="${c}"/>`));
    const nice = [y0, (y0 + y1) / 2, y1];
    nice.forEach(v => out.push(`<line x1="${L}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}" stroke="var(--line)" stroke-width=".6"/><text x="${L - 4}" y="${Y(v) + 3}" fill="var(--muted)" font-size="10" text-anchor="end" font-family="JetBrains Mono">${v.toFixed(0)}</text>`));
    const fd = ms => { const d = new Date(ms + 7 * 3600e3); return opt.hourly ? `${d.getUTCDate()}/${d.getUTCMonth() + 1} ${String(d.getUTCHours()).padStart(2, '0')}:00` : `${d.getUTCDate()}/${d.getUTCMonth() + 1}/${String(d.getUTCFullYear()).slice(2)}`; };
    [x0, (x0 + x1) / 2, x1].forEach((x, i) => out.push(`<text x="${X(x)}" y="${H - 5}" fill="var(--muted)" font-size="10" text-anchor="${['start', 'middle', 'end'][i]}" font-family="JetBrains Mono">${fd(x)}</text>`));
    series.forEach(s => {
      if (!s.pts.length) return;
      if (s.pts.length > 1 && !s.dotOnly) out.push(`<polyline fill="none" stroke="${s.col}" stroke-width="${s.w || 1.6}"${s.dash ? ` stroke-dasharray="${s.dash}"` : ''} points="${s.pts.map(p => `${X(p[0]).toFixed(1)},${Y(p[1]).toFixed(1)}`).join(' ')}"/>`);
      if (s.dot || s.dotOnly) s.pts.forEach(p => out.push(`<circle cx="${X(p[0])}" cy="${Y(p[1])}" r="${s.dotOnly ? 3 : 2}" fill="${s.col}"/>`));
      const l = s.pts[s.pts.length - 1]; out.push(`<circle cx="${X(l[0])}" cy="${Y(l[1])}" r="3.5" fill="${s.col}"/>`);
    });
    out.push('</svg>');
    return out.join('');
  }
  const dms = s => Date.parse(s + 'T00:00:00Z');
  window.OIVolCard = function () {
    const r = regime(); if (!r) return '';
    const g = r.g, gv = r.gvz;
    const ivNow = window.OI_iv && window.OI_iv.result;
    const tile = (lab, val, sub, col) => `<div class="tile"><small>${lab}</small><b${col ? ` style="color:${col}"` : ''}>${val}</b><em>${sub}</em></div>`;
    const parts = [`<div class="card"><h3>🌡 ความผันผวน & ประวัติ IV</h3>
      <div class="alert" style="border-color:${r.Z.col};background:${r.Z.bg}">${r.Z.ico} <b style="color:${r.Z.col}">โหมด${r.Z.name}</b> (HV เปอร์เซ็นไทล์ ${g.pct.toFixed(0)}) — ${r.Z.how}<br>ขนาดไม้แนะนำ <b>×${r.size.toFixed(2)}</b> · ระยะ SL <b>×${r.sl.toFixed(2)}</b></div>
      <div class="tiles" style="margin-top:8px">
        ${tile('HV 20 วัน (ความผันผวนจริง)', g.last.toFixed(1) + '%', `เปอร์เซ็นไทล์ ${g.pct.toFixed(0)} · 60 วัน ${g.hv60}%<br>เกณฑ์ 🟢 &lt;${g.p25} · 🔴 &gt;${g.p75}`, r.Z.col)}
        ${tile('IV ทอง 30 วัน (GVZ)', gv ? gv.last.toFixed(1) + '%' : '–', gv ? `เปอร์เซ็นไทล์ ${gv.pct.toFixed(0)} (ตั้งแต่ ${gv.since.slice(0, 4)})<br>มัธยฐาน ${gv.p50}%` : '', gv ? (gv.pct > 75 ? '#ff4d6a' : gv.pct < 25 ? '#22e39a' : '#ff9f1a') : null)}
        ${tile('IV ATM สัญญาวันนี้ (คำนวณเอง)', ivNow ? (ivNow.iv * 100).toFixed(1) + '%' : '–', ivNow ? (ivNow.mode === 'settle' ? `ตลาดปิด · จาก settlement ${esc(ivNow.sd || '')}` : `สด · 1 ชม. ${ivNow.d1h === null ? '–' : (ivNow.d1h >= 0 ? '+' : '−') + Math.abs(ivNow.d1h * 100).toFixed(1)} จุด`) : '', '#c9b8ff')}
        ${(E => tile('Expected Range ถึงหมดอายุ (แบบ CME)', E ? '±' + E.sd.toFixed(1) : '–', E ? `1SD ${(E.c - E.sd).toFixed(0)}–${(E.c + E.sd).toFixed(0)} · เหลือ ${E.dte.toFixed(2)} วัน<br>${E.src} ${(E.vol * 100).toFixed(2)}%` : ''))(erange())}
        ${tile('Skew รายวัน', String(g.skew), `ปีนี้ ${g.skew1y} · ${g.skew < 0 ? 'ขาลงแรงกว่าขาขึ้น' : 'ขาขึ้นแรงกว่า'}`, g.skew < 0 ? '#ff6b82' : '#2fe3a6')}
        ${tile('Kurtosis (หางอ้วน)', String(g.kurt), `ปีนี้ ${g.kurt1y} · ปกติ = 0<br>สูง = หลุด 3σ บ่อย`)}
      </div>`];
    // กราฟ 1 ปี: HV20 + GVZ + IV settlement ของเรา
    const hv = g.series.map(([d, v]) => [dms(d), v]), gz = gv ? gv.series.map(([d, v]) => [dms(d), v]) : [];
    const own = IH && IH.daily ? IH.daily.map(([d, v]) => [dms(d), v]) : [];
    parts.push(`<h3 style="margin-top:12px">ความผันผวน 1 ปี</h3>` + lineChart([
      { pts: hv, col: '#e0b44c', w: 1.8 }, { pts: gz, col: '#9aa7ff', w: 1.4 }, { pts: own, col: '#c9b8ff', dotOnly: true }
    ], { label: 'HV 20 วัน และ GVZ 1 ปี', bands: [[0, g.p25, 'rgba(34,227,154,.07)'], [g.p25, g.p75, 'rgba(255,159,26,.06)'], [g.p75, 999, 'rgba(255,77,106,.07)']] }) +
      `<div class="cleg"><span><i style="background:#e0b44c"></i>HV 20 วัน (ทองวิ่งจริง)</span><span><i style="background:#9aa7ff"></i>GVZ (IV 30 วัน)</span><span><i style="background:#c9b8ff"></i>IV ATM จาก settlement CME (เก็บทุกวัน)</span><span>พื้น 🟢/🟠/🔴 = โหมด</span></div>`);
    // กราฟรายชั่วโมง: IV ATM สด
    const hr = IH && IH.hourly ? IH.hourly.filter(h => Date.now() / 1000 - h[0] < 14 * 86400).map(h => [h[0] * 1000, h[1]]) : [];
    const local = []; try { const H = JSON.parse(localStorage.getItem('oit_iv_hist2') || '{}'); Object.values(H).forEach(a => (a || []).forEach(p => local.push([p[0], p[1] * 100]))); } catch (e) {}
    local.sort((a, b) => a[0] - b[0]);
    parts.push(`<h3 style="margin-top:12px">IV ATM รายชั่วโมง (14 วัน)</h3>` + (hr.length + local.length >= 2 ? lineChart([
      { pts: local, col: 'rgba(201,184,255,.45)', w: 1 }, { pts: hr, col: '#c9b8ff', w: 1.8, dot: true }
    ], { label: 'IV ATM รายชั่วโมง', hourly: true, h: 200 }) : `<div class="note">เริ่มเก็บแล้ว (ทุกชั่วโมงตอนตลาดเปิด) ตอนนี้มี ${hr.length} จุด</div>`) +
      `<div class="cleg"><span><i style="background:#c9b8ff"></i>บันทึกบนเซิร์ฟเวอร์ ทุกชั่วโมง</span><span><i style="background:rgba(201,184,255,.45)"></i>บันทึกในเครื่องนี้ ทุก 5 นาที</span></div>` +
      `<div class="note">IV ของสัญญาที่หมดอายุวันนั้น คิดเวลาเป็นวันปฏิทิน → วันจันทร์หลังเสาร์-อาทิตย์ค่า settlement จะต่ำ และ IV มักสูงขึ้นช่วงใกล้หมดอายุ เทียบแนวโน้มกับ GVZ จะนิ่งกว่า</div></div>`);
    return parts.join('');
  };
  window.OI_vol = { get data() { return V; }, get hist() { return IH; }, regime, sigma, zNow, erange, anchored, get sess() { return sess; }, load };
})();

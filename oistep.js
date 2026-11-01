// 🎯 สูตร 3 ขั้น (OI + CHoCH + Order Block) — ตามแนวคิด "สูตรสำเร็จ 3 ขั้นตอนในการยืนยันจุดเข้า"
//  ① ราคาวิ่งชนโซน OI หนา (โซนไฮไลต์ 10 อันดับต่อฝั่ง + เส้น Volume) → รอ ไม่รีบเข้า
//  ② TF เล็ก (M1/M5) เปลี่ยนโครงสร้าง (CHoCH): ปิดเหนือ swing high ล่าสุด (เด้งขึ้น) / ใต้ swing low ล่าสุด (กดลง)
//  ③ รอราคาย่อกลับมาที่ Order Block / FVG ที่เกิดหลัง CHoCH → เข้า · SL เลยขอบโซน (strike) ไปเล็กน้อย · TP = โซนถัดไป
// คำนวณใหม่ทุก 20 วินาทีจากแท่ง M1/M5 ล่าสุด (ไม่ขึ้นกับ TF ที่ดูอยู่) · โซน = OI ปัจจุบันของสัญญาวันนี้
(() => {
  'use strict';
  const O = window.OI;
  if (!O || !O.hooks || !(O.sym === 'gold' || O.sym === 'gcy')) return;
  const $ = id => document.getElementById(id);
  const KEY = 'oit_step3' + (O.psfx || '');
  const cfg = { on: true, tf: '1m' };
  try { Object.assign(cfg, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch (e) {}
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch (e) {} };
  const SEC = { '1m': 60, '5m': 300 }, TFS = { '1m': 60, '5m': 300, '15m': 900, '30m': 1800, '1h': 3600, '4h': 14400, '1d': 86400 };
  const BRK = 2;            // ปิดเลยขอบโซนเกิน $2 = โซนแตก (ยกเลิก setup)
  const SL_PAD = 1;         // SL เลยขอบโซน/OB ไป $1
  const PIV = 2;            // swing = จุดสูง/ต่ำกว่า 2 แท่งซ้ายขวา
  const LIM = { '1m': { touch: 45, choch: 30, fill: 40 }, '5m': { touch: 12, choch: 8, fill: 12 } };

  let setups = [], bars = [], lastRun = 0, busy = false;

  function zones() {
    const oi = O.oi; if (!oi || !oi.rows || !oi.rows.length) return [];
    const half = (O.cfg && O.cfg.zone) || 2.5, out = [];
    const topV = new Set(oi.topV || []);
    oi.rows.forEach(r => {
      if (r.price === null || r.price === undefined) return;
      const rc = r.c > 0 ? (oi.rankC && oi.rankC.get(r.strike)) || 0 : 0, rp = r.p > 0 ? (oi.rankP && oi.rankP.get(r.strike)) || 0 : 0;
      const rk = rc && (!rp || r.c >= r.p) ? rc : rp, vol = topV.has(r.strike);
      if (!rk && !vol) return;
      const h = rk && rk <= 5 ? half : half / 2;
      out.push({ k: r.strike, p: r.price, lo: r.price - h, hi: r.price + h, lab: rk ? (rc === rk ? 'C' : 'P') + r.strike : 'V' + r.strike });
    });
    return out.sort((a, b) => a.p - b.p);
  }

  // หา setup ทั้งหมดจากแท่งย้อนหลัง (เล่นซ้ำตามลำดับเวลา → ได้ทั้งประวัติและสถานะสด)
  function scan(B, Z) {
    const n = B.length, lim = LIM[cfg.tf] || LIM['1m'], res = [], busyZ = new Map();
    const isPH = i => i >= PIV && i + PIV < n && B.slice(i - PIV, i).every(b => b.high < B[i].high) && B.slice(i + 1, i + 1 + PIV).every(b => b.high <= B[i].high);
    const isPL = i => i >= PIV && i + PIV < n && B.slice(i - PIV, i).every(b => b.low > B[i].low) && B.slice(i + 1, i + 1 + PIV).every(b => b.low >= B[i].low);
    let act = [];
    for (let i = 1; i < n; i++) {
      const b = B[i], pc = B[i - 1].close;
      // ① ชนโซน
      Z.forEach(z => {
        if (busyZ.has(z.k) && i - busyZ.get(z.k) < lim.touch) return;
        if (!(b.low <= z.hi && b.high >= z.lo)) return;
        const dir = pc > z.hi ? 1 : pc < z.lo ? -1 : 0; if (!dir) return;
        if (act.some(s => s.z.k === z.k || (s.dir === dir && Math.abs(s.z.p - z.p) <= 7))) return; // โซนติดกัน (เช่น C3905/P3900) = setup เดียว
        act.push({ z, dir, t: i, st: 1 }); busyZ.set(z.k, i);
      });
      act.forEach(s => {
        const z = s.z;
        if (s.st === 1) {
          if ((s.dir > 0 && b.close < z.lo - BRK) || (s.dir < 0 && b.close > z.hi + BRK)) { s.st = -1; s.why = 'โซนแตก'; s.end = i; return; }
          if (i - s.t > lim.touch) { s.st = -1; s.why = 'ไม่เกิด CHoCH'; s.end = i; return; }
          // ② CHoCH: swing ล่าสุดก่อนแท่งนี้ที่ยืนยันแล้ว (i-PIV) ฝั่งตรงข้ามกับทิศเข้าหาโซน
          let sw = null;
          for (let j = i - PIV - 1; j >= Math.max(PIV, s.t - 25); j--) { if (s.dir > 0 ? isPH(j) : isPL(j)) { sw = j; break; } }
          if (sw === null) return;
          const lvl = s.dir > 0 ? B[sw].high : B[sw].low;
          if (s.dir > 0 ? b.close > lvl : b.close < lvl) {
            s.st = 2; s.ci = i; s.lvl = lvl;
            // ③ Order Block = แท่งสวนทางแท่งสุดท้ายก่อนแรงเหวี่ยง · FVG = ช่องว่าง 3 แท่งในแรงเหวี่ยง
            let ob = null; for (let j = i - 1; j >= Math.max(0, s.t - 6); j--) { const c = B[j]; if (s.dir > 0 ? c.close < c.open : c.close > c.open) { ob = { lo: c.low, hi: c.high, j }; break; } }
            let fvg = null; for (let j = i; j >= Math.max(2, s.t); j--) { if (s.dir > 0 ? B[j].low > B[j - 2].high : B[j].high < B[j - 2].low) { fvg = s.dir > 0 ? { lo: B[j - 2].high, hi: B[j].low, j } : { lo: B[j].high, hi: B[j - 2].low, j }; break; } }
            const ez = fvg || ob; if (!ez) { s.st = -1; s.why = 'ไม่มี OB/FVG'; s.end = i; return; }
            s.ob = ob; s.fvg = fvg; s.ez = ez;
            s.sl = s.dir > 0 ? Math.min(z.lo, ob ? ob.lo : z.lo) - SL_PAD : Math.max(z.hi, ob ? ob.hi : z.hi) + SL_PAD;
            s.entry = s.dir > 0 ? ez.hi : ez.lo;
            const risk = Math.abs(s.entry - s.sl); // TP = โซนถัดไปที่ห่างอย่างน้อย 1R (ใกล้กว่านั้นไม่คุ้มเสี่ยง)
            const nxt = s.dir > 0 ? Z.find(q => q.lo >= s.entry + risk) : [...Z].reverse().find(q => q.hi <= s.entry - risk);
            s.tp = nxt ? (s.dir > 0 ? nxt.lo : nxt.hi) : s.entry + s.dir * 2 * Math.abs(s.entry - s.sl); s.tpLab = nxt ? nxt.lab : '2R';
          }
        } else if (s.st === 2) {
          if (s.dir > 0 ? b.close < s.sl : b.close > s.sl) { s.st = -1; s.why = 'หลุด SL ก่อนเข้า'; s.end = i; return; }
          if (i - s.ci > lim.choch) { s.st = -1; s.why = 'ไม่ย่อกลับมา'; s.end = i; return; }
          if (s.dir > 0 ? b.low <= s.entry : b.high >= s.entry) { s.st = 3; s.ei = i; }
        } else if (s.st === 3) {
          const hitSL = s.dir > 0 ? b.low <= s.sl : b.high >= s.sl, hitTP = s.dir > 0 ? b.high >= s.tp : b.low <= s.tp;
          if (hitSL) { s.st = 5; s.end = i; s.why = 'SL'; } else if (hitTP) { s.st = 4; s.end = i; s.why = 'TP'; }
          else if (i - s.ei > lim.fill * 4) { s.st = 6; s.end = i; s.why = 'หมดเวลา'; }
        }
      });
      act.filter(s => s.st < 0 || s.st >= 4).forEach(s => res.push(s));
      act = act.filter(s => s.st > 0 && s.st < 4);
    }
    return res.concat(act);
  }

  async function run(force) {
    if (!cfg.on || busy) return;
    if (!force && Date.now() - lastRun < 18000) return;
    busy = true; lastRun = Date.now();
    try {
      const B = await O.fetchTF(cfg.tf, cfg.tf === '1m' ? 480 : 300);
      if (B && B.length > 20) { bars = B; const prev = sig(); setups = scan(B, zones()); notify(prev); O.markDirty(); }
    } catch (e) {} finally { busy = false; }
  }
  const sig = () => setups.filter(s => s.st === 2 || s.st === 3).map(s => s.z.k + ':' + s.st + ':' + bars[s.ci].time).join('|');
  // แจ้งเตือนเฉพาะเหตุการณ์ใหม่ที่เกิดในแท่งล่าสุด ๆ (กันเตือนซ้ำตอนเปิดแอป)
  const told = new Set();
  function notify() {
    const n = bars.length;
    setups.forEach(s => {
      const key2 = s.z.k + '|' + (s.ci !== undefined ? bars[s.ci].time : '') , dirT = s.dir > 0 ? '▲ เด้งขึ้น' : '▼ กดลง';
      if (s.st >= 2 && s.ci !== undefined && n - 1 - s.ci <= 2 && !told.has('c' + key2)) {
        told.add('c' + key2);
        alertMsg(`🎯 <b>② CHoCH ${dirT}</b> ที่โซน ${s.z.lab}<br>③ รอย่อเข้า ${s.fvg ? 'FVG' : 'OB'} ${s.ez.lo.toFixed(2)}–${s.ez.hi.toFixed(2)} · SL ${s.sl.toFixed(2)} · TP ${s.tp.toFixed(2)} (${s.tpLab})`);
      }
      if (s.st >= 3 && s.ei !== undefined && n - 1 - s.ei <= 2 && !told.has('e' + key2)) {
        told.add('e' + key2);
        alertMsg(`🎯 <b>③ เข้าได้ ${s.dir > 0 ? 'BUY' : 'SELL'}</b> ${s.entry.toFixed(2)} (โซน ${s.z.lab})<br>SL ${s.sl.toFixed(2)} · TP ${s.tp.toFixed(2)} (${s.tpLab}) · R:R ${(Math.abs(s.tp - s.entry) / Math.abs(s.entry - s.sl)).toFixed(1)}`);
      }
    });
  }
  function alertMsg(html) {
    if (window.OIAlerts && !OIAlerts.on('step3')) return;
    O.beep && O.beep();
    try { navigator.vibrate && navigator.vibrate([200, 100, 200]); } catch (e) {}
    O.showToast && O.showToast(html, 15000);
  }
  setInterval(() => run(false), 20000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') run(true); });
  setTimeout(() => run(true), 6000);

  // ---------- วาด ----------
  const csec = () => TFS[O.tf] || 60, toChart = t => Math.floor((t - 0) / csec()) * csec();
  O.hooks.push((ctx, w, h) => {
    if (!cfg.on || !setups.length || !bars.length) return;
    const ts = O.chart.timeScale(), sr = O.series, plotW = ts.width(), plotH = h - ts.height();
    const X = i => { const t = bars[Math.min(i, bars.length - 1)].time; return ts.timeToCoordinate(toChart(t)); };
    const Y = p => sr.priceToCoordinate(p);
    const mono = getComputedStyle(document.documentElement).getPropertyValue('--mono') || 'monospace';
    ctx.save(); ctx.font = `bold 9px ${mono}`; ctx.textBaseline = 'middle';
    const fresh = Date.now() / 1000 + 7 * 3600 - bars[bars.length - 1].time < 3 * 3600; // ตลาดปิด/ข้อมูลเก่า → ไม่แสดงเป็นสัญญาณสด
    const live = fresh ? setups.filter(s => s.st === 2 || s.st === 3) : [], done = setups.filter(s => s.st >= 3 && s.ei !== undefined);
    // ประวัติ: มาร์กเล็ก ๆ ตรงแท่งที่เข้า (✓ ถึง TP / ✗ โดน SL)
    done.forEach(s => {
      const x = X(s.ei), y = Y(s.entry); if (x === null || y === null || x < 0 || x > plotW) return;
      const col = s.st === 4 ? '#22e39a' : s.st === 5 ? '#ff4d6a' : '#e0b44c';
      ctx.fillStyle = col; ctx.beginPath();
      if (s.dir > 0) { ctx.moveTo(x, y + 2); ctx.lineTo(x - 4, y + 9); ctx.lineTo(x + 4, y + 9); } else { ctx.moveTo(x, y - 2); ctx.lineTo(x - 4, y - 9); ctx.lineTo(x + 4, y - 9); }
      ctx.fill();
      ctx.textAlign = 'center'; ctx.fillText(s.st === 4 ? '✓' : s.st === 5 ? '✗' : '③', x, s.dir > 0 ? y + 16 : y - 16);
    });
    // setup ที่ยังทำงาน: กล่อง OB/FVG + เส้น entry / SL / TP สั้น ๆ ไปทางขวา
    live.forEach(s => {
      const x0 = X(s.ci); if (x0 === null) return;
      const xr = Math.min(plotW - 2, x0 + Math.max(60, (plotW - x0)));
      const ez = s.ez, y1 = Y(ez.hi), y2 = Y(ez.lo); if (y1 === null || y2 === null) return;
      ctx.globalAlpha = 0.22; ctx.fillStyle = s.dir > 0 ? '#22e39a' : '#ff4d6a'; ctx.fillRect(x0, y1, xr - x0, Math.max(2, y2 - y1));
      ctx.globalAlpha = 0.9; ctx.lineWidth = 1;
      const line = (p, col, dash, lab) => { const y = Y(p); if (y === null || y < 0 || y > plotH) return; ctx.strokeStyle = col; ctx.setLineDash(dash); ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(xr, y); ctx.stroke(); ctx.setLineDash([]); ctx.fillStyle = col; ctx.textAlign = 'right'; ctx.fillText(lab, xr - 2, y - 6); };
      line(s.entry, '#e0b44c', [], `${s.st === 3 ? '③ เข้าแล้ว' : '③ รอย่อ'} ${s.dir > 0 ? 'BUY' : 'SELL'} ${s.entry.toFixed(1)}`);
      line(s.sl, '#ff4d6a', [4, 3], `SL ${s.sl.toFixed(1)}`);
      line(s.tp, '#22e39a', [4, 3], `TP ${s.tp.toFixed(1)} ${s.tpLab}`);
      // จุด CHoCH
      const yl = Y(s.lvl); if (yl !== null) { ctx.strokeStyle = '#c9b8ff'; ctx.setLineDash([2, 2]); ctx.beginPath(); ctx.moveTo(Math.max(0, x0 - 40), yl); ctx.lineTo(x0, yl); ctx.stroke(); ctx.setLineDash([]); ctx.fillStyle = '#c9b8ff'; ctx.textAlign = 'right'; ctx.fillText('② CHoCH', x0 - 2, yl + (s.dir > 0 ? -7 : 7)); }
    });
    ctx.restore();
  });

  // ---------- ป้ายสถานะ ----------
  (window.OIBadgeExtra = window.OIBadgeExtra || []).push(() => {
    if (!cfg.on) return null;
    if (!bars.length || Date.now() / 1000 + 7 * 3600 - bars[bars.length - 1].time > 3 * 3600) return null;
    const P = O.lastClose, cur = setups.filter(s => s.st >= 1 && s.st <= 3);
    if (!cur.length) return null;
    const s = cur.sort((a, b) => b.st - a.st || Math.abs(a.z.p - P) - Math.abs(b.z.p - P))[0], d = s.dir > 0 ? '▲' : '▼';
    if (s.st === 1) return [`🎯① ชน ${s.z.lab} ${d} รอ CHoCH`, '#e0b44c', 'step'];
    if (s.st === 2) return [`🎯② CHoCH ${d} รอย่อ ${s.entry.toFixed(1)}`, s.dir > 0 ? '#22e39a' : '#ff8a3d', 'step'];
    return [`🎯③ ${s.dir > 0 ? 'BUY' : 'SELL'} ${s.entry.toFixed(1)} SL ${s.sl.toFixed(1)}`, s.dir > 0 ? '#22e39a' : '#ff8a3d', 'step'];
  });

  // ---------- เมนู ƒx ----------
  function stats() {
    const d = setups.filter(s => s.st === 4 || s.st === 5), w = d.filter(s => s.st === 4).length;
    return d.length ? `ย้อนหลัง ${cfg.tf === '1m' ? '8 ชม.' : '25 ชม.'}: เข้า ${d.length} · ถึง TP ${w} · โดน SL ${d.length - w}` : 'ยังไม่มีสัญญาณครบ 3 ขั้นในช่วงนี้';
  }
  function section() {
    const d = document.createElement('div'); d.id = 's3Box'; d.className = 'gsbox';
    d.innerHTML = `<div class="row"><button class="gsb${cfg.on ? ' on' : ''}" data-s3="on"><i style="background:#e0b44c"></i>🎯 สูตร 3 ขั้น (OI + CHoCH + OB)</button><span id="s3Info" class="gsinfo">${cfg.on ? stats() : ''}</span></div>` +
      (cfg.on ? `<div class="row ps"><button class="gsb${cfg.tf === '1m' ? ' on' : ''}" data-s3tf="1m">CHoCH บน M1</button><button class="gsb${cfg.tf === '5m' ? ' on' : ''}" data-s3tf="5m">CHoCH บน M5</button></div>` : '');
    return d;
  }
  function mount() { const m = $('indMenu'); if (!m || m.hidden || $('s3Box')) return; const box = section(), anchor = $('dhBox') || $('btBox') || m.querySelector('.t'); anchor ? anchor.after(box) : m.prepend(box); }
  const menu = $('indMenu');
  if (menu) {
    new MutationObserver(() => mount()).observe(menu, { childList: true });
    menu.addEventListener('click', e => {
      const a = e.target.closest('[data-s3]'), t = e.target.closest('[data-s3tf]'); if (!a && !t) return;
      if (a) cfg.on = !cfg.on; else cfg.tf = t.dataset.s3tf;
      save(); setups = []; O.markDirty(); const b = $('s3Box'); if (b) b.remove(); mount(); run(true);
    });
  }
  if (window.OIAlerts) OIAlerts.reg('step3', '🎯 สูตร 3 ขั้น (CHoCH + จุดเข้า)', { desc: 'เตือนตอนเกิด CHoCH ที่โซน และตอนราคาย่อเข้า OB/FVG', active: () => cfg.on });
  window.OI_step3 = { get setups() { return setups; }, get bars() { return bars; }, scan, zones, run, get cfg() { return cfg; } };
})();

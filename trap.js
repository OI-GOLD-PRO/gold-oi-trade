// 💀 กับดักคนส่วนน้อย (ไอคอนเดิม 🪤 → 💀 ตามที่ผู้ใช้เลือก V4.8.5) (Liquidity Sweep) — M5
// แนวคิด: รายย่อยวาง SL ที่จุดชัด ๆ → รายใหญ่ดันราคาไปกวาด SL (ได้สภาพคล่องเปิดฝั่งตรงข้าม) → ราคาเด้งกลับ
//  ขั้น 1 จุดที่ SL กอง (แถบ 💀): swing high/low ที่ยังไม่ถูกกวาด (ยอดเท่ากัน = หนักขึ้น) · High/Low รอบเทรดก่อน
//         · เลขกลมฟิวเจอร์ส · เลขกลม "ราคาสปอต" (รายย่อย CFD เห็นราคาสปอตจาก gold-api ซึ่งต่างจากราคากราฟ → บวก basis แปลงเป็นสเกลกราฟ) · เลยกำแพง OI อันดับ 1–5
//         · น้ำหนัก COT: รายย่อยถือ Long มาก → SL ฝั่งล่างหนักกว่า
//  ขั้น 2 การกวาด: ไส้แท่ง M5 แทงเลยแถบ ≥ 0.3 ATR (≥ $1) แล้วปิดกลับเข้าภายใน 3 แท่ง
//         หลักฐานรายใหญ่รับ: ไม้ใหญ่สุทธิสวนทาง · Absorption (Volume สูง ตัวแท่งเล็ก) · ตรงกับ strike gamma บวก (ดีลเลอร์รับ)
//  ขั้น 3 แผน: เข้าที่ราคาปิดแท่งที่กลับเข้าแถบ · SL เลยปลายไส้ $0.5 · TP1 แถบฝั่งตรงข้ามใกล้สุดที่ ≥ 1R (ไม่มี = 1.5R) · TP2 ถัดไป (ไม่มี = 2.5R)
//  ห้ามสวน (ไม่เตือนเข้า): Squeeze ส้ม/แดงไปทางที่กวาด · Dealer ไล่แรงไปทางที่กวาด · โหมด 🔴 ต้องคะแนน ≥ 60
(() => {
  'use strict';
  const O = window.OI;
  const G = () => (O && O.gcOff ? O.gcOff() : 0); // GC − โบรก

  // Frozen plans remain in GC coordinates in memory/storage/server. Convert at use time.
  const shiftPlan = (v, d) => { const r = Object.assign({}, v); for (const k of ['entry','sl','tp1','tp2','ext','pp']) if (Number.isFinite(r[k])) r[k] += d; return r; };

  if (!O || !O.hooks || !(O.sym === 'gold' || O.sym === 'gcy')) return;
  const $ = id => document.getElementById(id);
  const KEY = 'oit_trap' + (O.psfx || '');
  const cfg = { on: true, pools: true };
  try { Object.assign(cfg, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch (e) {}
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch (e) {} };
  const TFS = { '1m': 60, '5m': 300, '15m': 900, '30m': 1800, '1h': 3600, '4h': 14400, '1d': 86400 };
  const PIV = 3, BACK = 3, HOLD = 72, SWN = 12;
  // V4.9.3: ล็อกแผนเมื่อเกิดแล้ว (จุดเข้า/SL/TP/คะแนนไม่เลื่อนตามการคำนวณรอบใหม่) · เก็บในเครื่อง 3 วัน
  const FKEY = 'oit_trap_frozen_gc_v499'; // V4.9.9: กติกาใหม่ (กรองกลางทาง) เริ่มล็อกใหม่ // เปลี่ยนกติกาแล้วเริ่มล็อกใหม่ (ของเดิมคำนวณด้วยกติกาเก่า)
  try { localStorage.removeItem('oit_trap_frozen'); localStorage.removeItem('oit_trap_frozen_v494'); } catch (e) {}
  let frozen = {}; try { frozen = JSON.parse(localStorage.getItem(FKEY) || '{}') || {}; } catch (e) {}
  // V4.9.15: แผนที่ล็อกแล้วเก็บกลางที่เซิร์ฟเวอร์ — เครื่องแรกที่เห็นสัญญาณเป็นคนล็อก เครื่องอื่นใช้แผนเดียวกัน
  const FZ = O.worker ? O.worker + '/trapfz' : null; let fzNew = {};
  function fzApply(j) { if (!j || typeof j !== 'object') return; let ch = false; Object.entries(j).forEach(([k, v]) => { if (JSON.stringify(frozen[k]) !== JSON.stringify(v)) { frozen[k] = v; ch = true; } }); if (ch) { saveF(); lastRun = 0; O.markDirty(); } }
  async function fzSync() {
    if (!FZ) return;
    try {
      const body = null; // shared plans are read-only in Trade fzNew = {};
      const r = await fetch(FZ, body ? { method: 'POST', body, headers: { 'content-type': 'application/json' } } : { cache: 'no-store' });
      fzApply(await r.json());
    } catch (e) {}
  }
  setTimeout(fzSync, 2000); setInterval(() => { if (document.visibilityState === 'visible') fzSync(); }, 30000);
  const saveF = () => { try { const lim = Date.now() / 1000 + 7 * 3600 - 3 * 86400; Object.keys(frozen).forEach(k => { if (+k.split('|')[0] < lim) delete frozen[k]; }); localStorage.setItem(FKEY, JSON.stringify(frozen)); } catch (e) {} };
  let B = [], pools = [], setups = [], atr = 2, busy = false, lastRun = 0;
  // ราคาสปอต XAUUSD (ที่รายย่อย CFD เห็น) ≠ ราคาบนกราฟ (สเกลฟิวเจอร์ส) → basis = กราฟ − สปอต (ดึงทุก 1 นาที)
  let basis = null, basisAt = 0;
  async function loadSpot() {
    try { const r = await (await fetch('https://api.gold-api.com/price/XAU', { cache: 'no-store' })).json(), sp = Number(r.price), px = O.lastClose;
      if (sp > 0 && px > 0 && Math.abs(px - sp) < 80) { basis = px - sp; basisAt = Date.now(); } } catch (e) {}
  }
  setTimeout(loadSpot, 3000); setInterval(loadSpot, 60000);

  // ---------- ขั้น 1: แถบ SL ----------
  function buildPools(B) {
    const n = B.length, c = [];
    let a = 0; for (let i = Math.max(1, n - 50); i < n; i++) a += Math.max(B[i].high - B[i].low, Math.abs(B[i].high - B[i - 1].close), Math.abs(B[i].low - B[i - 1].close));
    atr = Math.max(0.8, a / Math.min(49, n - 1));
    const add = (p, side, w, why, t) => c.push({ p, side, w, why: [why], t });
    // swing ที่ยังไม่ถูกกวาด (ไม่มีแท่งหลังจากนั้นทะลุ)
    for (let i = PIV; i < n - PIV; i++) {
      const b = B[i]; let hi = true, lo = true;
      for (let j = i - PIV; j <= i + PIV; j++) { if (j === i) continue; if (B[j].high >= b.high) hi = false; if (B[j].low <= b.low) lo = false; }
      if (hi) add(b.high, 1, 1, 'ยอด swing', b.time + PIV * 300); // ยืนยัน swing ได้หลัง PIV แท่ง · V4.9.4: swing เดี่ยวน้ำหนัก 1 (ต้องซ้อนแหล่งอื่นถึงขึ้นเป็นแถบ — backtest 60 วัน EV ติดลบ)
      if (lo) add(b.low, -1, 1, 'ก้น swing', b.time + PIV * 300);
    }
    // High/Low ของรอบเทรดก่อน (รอบแบ่งที่ช่วงพักตลาด ≥ 40 นาที)
    let s0 = 0; for (let i = n - 1; i > 0; i--) if (B[i].time - B[i - 1].time >= 2400) { s0 = i; break; }
    let p0 = 0; for (let i = s0 - 1; i > 0; i--) if (B[i].time - B[i - 1].time >= 2400) { p0 = i; break; }
    if (s0 > p0 + 10) { const ps = B.slice(p0, s0), ph = Math.max(...ps.map(x => x.high)), pl = Math.min(...ps.map(x => x.low)), cur = B.slice(s0);
      if (!cur.some(x => x.high > ph)) add(ph, 1, 4, 'High เมื่อวาน', B[s0].time); if (!cur.some(x => x.low < pl)) add(pl, -1, 4, 'Low เมื่อวาน', B[s0].time); }
    const px = B[n - 1].close, rng = atr * 8;
    // เลขกลมฟิวเจอร์ส + เลขกลมราคาสปอต (สปอต = ราคากราฟ + adj)
    for (let r = Math.ceil((px + G() - rng) / 25) * 25; r <= px + G() + rng; r += 25) { const w = r % 100 === 0 ? 2.5 : r % 50 === 0 ? 1.5 : 0.8; add(r - G() + (r - G() > px ? 0.3 : -0.3), r - G() > px ? 1 : -1, w, `เลขกลม ${r}`, null); }
    // เลขกลมของราคาสปอต แปลงเป็นราคาบนกราฟ (สปอต + basis) · รายย่อย CFD ใช้เลขนี้วาง SL มากที่สุด จึงน้ำหนักสูงกว่า
    if (basis !== null && Date.now() - basisAt < 15 * 60e3) for (let r = Math.ceil((px - basis - rng) / 25) * 25; r <= px - basis + rng; r += 25) { const p = r + basis, w = r % 100 === 0 ? 3 : r % 50 === 0 ? 2 : 1; add(p + (p > px ? 0.3 : -0.3), p > px ? 1 : -1, w, `เลขกลมสปอต ${r}`, null); }
    // เลยกำแพง OI อันดับ 1–5 ไปนิด (รายย่อยมองกำแพงเป็นแนวรับ/ต้าน)
    const oi = O.oi;
    if (oi && oi.rows) oi.rows.forEach(r => { if (r.price == null) return; const rc = r.c > 0 && oi.rankC ? oi.rankC.get(r.strike) || 0 : 0, rp = r.p > 0 && oi.rankP ? oi.rankP.get(r.strike) || 0 : 0, rk = Math.min(rc || 99, rp || 99); if (rk > 5 || Math.abs(r.price - px) > rng) return; const up = r.price > px; add(r.price + (up ? 1.5 : -1.5), up ? 1 : -1, 1.5, `เลยกำแพง ${rc && rc === rk ? 'C' : 'P'}${r.strike}`, null); });
    // V4.9.12: 👥 โซนที่รายย่อยเข้าออเดอร์จริง (ไม้เล็ก perp) → SL ของพวกเขา: ใต้โซน Buy / เหนือโซน Sell
    try { (window.OI_retail ? (OI_retail.trapZones ? OI_retail.trapZones() : OI_retail.zones()) : []).forEach(z => { const w = [3, 2, 1.5][z.rank] || 1.5;
      const wb = z.side > 0 ? w : z.side < 0 ? 0 : w * 0.5, ws = z.side < 0 ? w : z.side > 0 ? 0 : w * 0.5; // สองฝั่ง = SL ทั้งบนและล่าง น้ำหนักครึ่ง
      if (wb && z.lo - 0.5 < px) add(z.lo - 0.5, -1, wb, `SL รายย่อย Buy ~${z.avg.toFixed(0)}`, null);
      if (ws && z.hi + 0.5 > px) add(z.hi + 0.5, 1, ws, `SL รายย่อย Sell ~${z.avg.toFixed(0)}`, null); }); } catch (e) {}
    // COT: รายย่อยถือ Long มาก → SL ฝั่งล่าง (ของคนถือ Long) หนักขึ้น
    let tilt = 0; try { const s = window.OICrowd && window.OICrowd.summary(); if (s) tilt = (s.retail_nonreportable.long_pct - 50) / 50; } catch (e) {}
    c.forEach(x => { x.w *= 1 + 0.4 * (x.side < 0 ? tilt : -tilt); });
    // รวมจุดที่ใกล้กัน (≤ 0.35 ATR)
    c.sort((a, b) => a.p - b.p); const out = [];
    c.forEach(x => { const l = out[out.length - 1]; if (l && l.side === x.side && x.p - l.p <= atr * 0.35) { l.p = (l.p * l.w + x.p * x.w) / (l.w + x.w); l.w += x.w; l.why.push(...x.why); l.t = l.t || x.t; } else out.push({ ...x, why: [...x.why] }); });
    // ยอด/ก้นเท่ากัน (2 swing ขึ้นไปรวมกัน) = หนักขึ้นอีก
    out.forEach(x => { const sw = x.why.filter(w => /swing/.test(w)).length; if (sw >= 2) { x.w += 2; x.why.push('ยอด/ก้นเท่ากัน'); } x.why = [...new Set(x.why)]; });
    // ถูกกวาดไปแล้วหรือยัง (ไว้แสดงเฉพาะแถบที่ยังมี SL เหลือ)
    // swing/High-Low เมื่อวาน: ถูกกวาดถ้ามีแท่งทะลุหลังเกิด · เลขกลม/กำแพง (ไม่มีเวลาเกิด): ถือว่า SL กองใหม่ ถ้าราคาไม่ได้แตะใน 1 ชม. ล่าสุด
    const rec = B.slice(-12);
    out.forEach(x => { const hit = b => (x.side > 0 ? b.high > x.p + 0.2 : b.low < x.p - 0.2); x.swept = x.t ? B.some(b => b.time > x.t && hit(b)) : rec.some(hit); });
    return out.filter(x => x.w >= 2);
  }

  // ---------- ขั้น 2–3: กวาด + กลับเข้า → แผน ----------
  function evidence(i0, i1, side) {
    const out = [], bt = window.OI_bigtr;
    let sc = 0;
    // ไม้ใหญ่สุทธิสวนทางช่วงกวาด (side −1 = กวาดลง → อยากเห็นซื้อ)
    try {
      if (bt && bt.cfg && bt.cfg.on && bt.trades) {
        const t0 = (B[i0].time - 7 * 3600) * 1000, t1 = (B[i1].time - 7 * 3600 + 300) * 1000, T = bt.thr ? bt.thr() : 0;
        const net = bt.trades.filter(x => x.t >= t0 && x.t < t1 && x.q >= T).reduce((a, x) => a + x.s * x.q, 0);
        if (side < 0 ? net > 0 : net < 0) { sc += 15; out.push(`ไม้ใหญ่${side < 0 ? 'ซื้อ' : 'ขาย'}สวน ${Math.abs(net).toFixed(0)} oz`); }
      }
    } catch (e) {}
    // Absorption: Volume สูง (≥ 1.8 เท่าเฉลี่ย 20) แต่ตัวแท่งเล็ก
    const vb = B.slice(Math.max(0, i0 - 20), i0).map(x => x.volume || 0), av = vb.reduce((a, b) => a + b, 0) / Math.max(1, vb.length);
    for (let i = i0; i <= i1; i++) { const b = B[i]; if (av > 0 && (b.volume || 0) >= av * 1.8 && Math.abs(b.close - b.open) <= (b.high - b.low) * 0.45) { sc += 10; out.push('Absorption (Volume สูง ตัวแท่งเล็ก)'); break; } }
    // ตรงกับ strike gamma บวก (ดีลเลอร์รับ)
    try {
      const c = window.OILive && window.OILive.calc, oi = O.oi;
      if (c && c.strikes && oi && oi.rows) { const pr = new Map(oi.rows.map(r => [r.strike, r.price])), lv = side < 0 ? B[i0].low : B[i0].high;
        const hit = c.strikes.find(s => s.gex > 0 && pr.has(s.k) && Math.abs(pr.get(s.k) - lv) <= Math.max(2, atr * 0.6));
        if (hit) { sc += 10; out.push(`ดีลเลอร์รับที่ ${hit.k} (gamma บวก)`); } }
    } catch (e) {}
    return { sc, out };
  }
  function track(s, n) { // ผลหลังเข้า: SL / TP1 / หมดเวลา
    const buy = s.side > 0; s.st = 2; s.end = undefined;
    for (let k = s.ri + 1; k < n; k++) { const x = B[k]; if (buy ? x.low <= s.sl : x.high >= s.sl) { s.st = 5; s.end = k; break; } if (buy ? x.high >= s.tp1 : x.low <= s.tp1) { s.st = 4; s.end = k; break; } if (k - s.ri > HOLD) { s.st = 6; s.end = k; break; } }
    if (s.st === 2) s.st = 3;
  }
  function scan() {
    const n = B.length, res = [], nextOk = new Map(), seenF = new Set(); let dirtyF = false;
    const minPoke = Math.max(1, atr * 0.3), BRK = Math.max(2, atr * 0.6);
    for (let i = 1; i < n; i++) {
      const b = B[i];
      pools.forEach((P, pi) => {
        if (i < (nextOk.get(pi) || 0) || (P.t && b.time <= P.t)) return;
        const below = P.side < 0;
        if (below ? b.low > P.p - minPoke : b.high < P.p + minPoke) return;
        if (below ? B[i - 1].close < P.p : B[i - 1].close > P.p) return; // ต้องมาจากอีกฝั่งของแถบ
        // V4.9.9: เลขกลม/กำแพง (ไม่มีเวลาเกิด) ต้องไม่ถูกแตะใน 12 แท่งก่อนหน้า (SL ต้องกองใหม่ก่อน) — กันราคาแกว่งผ่านเลขกลมกลางทางแล้วออกสัญญาณซ้ำ
        if (!P.t && B.slice(Math.max(0, i - 12), i).some(x => below ? x.low < P.p - 0.2 : x.high > P.p + 0.2)) return;
        // หาแท่งที่ปิดกลับเข้า (ภายใน BACK แท่ง) ก่อนจะปิดเลยแถบเกิน BRK
        let ext = below ? b.low : b.high, rk = -1;
        for (let j = i; j < Math.min(n, i + BACK + 1); j++) {
          const x = B[j]; ext = below ? Math.min(ext, x.low) : Math.max(ext, x.high);
          if (below ? x.close < P.p - BRK : x.close > P.p + BRK) break;
          if (below ? x.close > P.p : x.close < P.p) { rk = j; break; }
        }
        nextOk.set(pi, i + BACK + 6);
        // V4.9.9: ไส้ที่กวาดต้องเป็นจุดต่ำสุด/สูงสุดของ 12 แท่ง (1 ชม.) ก่อนหน้า = ปลายสวิงจริง ไม่ใช่กลางทาง
        { let lb = 0; for (let k = i - 1; k >= 0 && lb < SWN; k--) { if (below ? B[k].low < ext : B[k].high > ext) break; lb++; } if (lb < SWN) return; }
        const s = { P, side: below ? 1 : -1, si: i, ext, st: rk < 0 ? (i + BACK >= n ? 1 : -1) : 2, why: rk < 0 ? 'ไม่กลับเข้า = เบรกจริง' : '' };
        if (rk >= 0) {
          const entry = B[rk].close, sl = below ? ext - 0.5 : ext + 0.5, R = Math.abs(entry - sl);
          if (R < 0.6 || R > atr * 4) { s.st = -1; s.why = 'SL ไม่เหมาะ'; res.push(s); return; }
          const fk = B[rk].time + '|' + s.side, F = frozen[fk] && shiftPlan(frozen[fk], -G());
          if (F) { Object.assign(s, { ri: rk, entry: F.entry, sl: F.sl, R: F.R, tp1: F.tp1, tp2: F.tp2, tpLab: F.tpLab, score: F.score, ev: F.ev, ext: F.ext, P: Object.assign({}, P, { p: F.pp, why: F.why, w: F.w }) }); seenF.add(fk); }
          else {
            const opp = pools.filter(q => q.side === -P.side && (below ? q.p > entry + R : q.p < entry - R)).sort((a, b2) => Math.abs(a.p - entry) - Math.abs(b2.p - entry));
            const ev = evidence(i, rk, P.side), base = 40 + Math.min(25, P.w * 3);
            // V4.9.4 TP ตามแหล่ง (backtest 60 วัน): High/Low เมื่อวาน → 2R ดีสุด · ยอด/ก้นเท่ากัน → 1R ดีสุด · อื่น ๆ → แถบฝั่งตรงข้าม (≥1R) หรือ 1.5R
            const isPD = P.why.some(w => /เมื่อวาน/.test(w)), isEQ = P.why.includes('ยอด/ก้นเท่ากัน');
            const t1 = isPD ? [entry + s.side * 2 * R, '2R (High/Low เมื่อวาน)'] : isEQ ? [entry + s.side * R, '1R (ยอด/ก้นเท่ากัน)'] : opp[0] ? [opp[0].p, opp[0].why[0]] : [entry + s.side * 1.5 * R, '1.5R'];
            const far = opp.find(q => (below ? q.p > t1[0] + 0.5 : q.p < t1[0] - 0.5));
            Object.assign(s, { ri: rk, entry, sl, R, tp1: t1[0], tp2: far ? far.p : entry + s.side * Math.max(2.5, isPD ? 3 : 2.5) * R, tpLab: t1[1], score: Math.min(100, Math.round(base + ev.sc)), ev: ev.out });
            frozen[fk] = shiftPlan({ entry: s.entry, sl: s.sl, R: s.R, tp1: s.tp1, tp2: s.tp2, tpLab: s.tpLab, score: s.score, ev: s.ev, ext: s.ext, pp: P.p, why: P.why, w: P.w }, G()); seenF.add(fk); dirtyF = true; fzNew[fk] = frozen[fk]; setTimeout(fzSync, 500);
          }
          // ติดตามผล
          track(s, n);
          if (s.st === 2) s.st = 3; // เข้าแล้ว รอผล
          nextOk.set(pi, (s.end || n) + 1);
        }
        res.push(s);
      });
    }
    // แผนที่ล็อกไว้แต่รอบนี้หาไม่เจอ (แถบเลื่อน) → คงไว้ตามเดิม
    const idx = new Map(B.map((b, k) => [b.time, k]));
    Object.keys(frozen).forEach(fk => { if (seenF.has(fk)) return; const [t, sd] = fk.split('|'), rk = idx.get(+t); if (rk === undefined) return; const F = shiftPlan(frozen[fk], -G());
      const s2 = { P: { p: F.pp, why: F.why, w: F.w, side: -sd }, side: +sd, si: Math.max(0, rk - 1), ri: rk, ext: F.ext, entry: F.entry, sl: F.sl, R: F.R, tp1: F.tp1, tp2: F.tp2, tpLab: F.tpLab, score: F.score, ev: F.ev, st: 2 };
      track(s2, n); res.push(s2); });
    if (dirtyF) saveF();
    res.sort((a, b) => a.si - b.si);
    return res;
  }
  function filters(s) { // คำเตือนห้ามสวน ณ ตอนนี้ (ใช้กับสัญญาณสดเท่านั้น)
    const w = []; let block = false;
    try { const q = window.OI_squeeze && window.OI_squeeze.result; if (q && q.lv >= 2 && q.dir === -s.side) { w.push('⚠️ Squeeze ไปทางที่กวาด'); block = true; } } catch (e) {}
    try { const d = window.OI_dealer && window.OI_dealer.result; if (d && d.S <= -0.4) { w.push('⚡ Dealer ไล่แรง (gamma ลบ)'); block = true; } } catch (e) {}
    try { const v = window.OI_vol && window.OI_vol.regime && window.OI_vol.regime(); if (v && v.z === 'r' && s.score < 60) { w.push('🔴 โหมดแกว่งแรง คะแนนต้อง ≥ 60'); block = true; } } catch (e) {}
    return { w, block };
  }

  async function run(force) {
    if (!cfg.on || busy) return;
    if (!force && Date.now() - lastRun < 18000) return;
    busy = true; lastRun = Date.now();
    try {
      const X = await O.fetchTF('5m', 576);
      if (X && X.length > 60) { B = X.slice(0, -1); pools = buildPools(B); setups = scan(); notify(); O.markDirty(); } // V4.9.3: ใช้เฉพาะแท่งที่ปิดแล้ว (แท่งที่กำลังวิ่งทำให้จุดเข้าเลื่อน)
    } catch (e) {} finally { busy = false; }
  }
  const fresh = () => B.length && Date.now() / 1000 + 7 * 3600 - B[B.length - 1].time < 3 * 3600;
  const told = new Set();
  function notify() {
    if (!fresh()) return;
    const n = B.length;
    setups.forEach(s => {
      const key = s.P.p.toFixed(1) + '|' + B[s.si].time, d = s.side > 0 ? 'BUY' : 'SELL', where = s.side > 0 ? 'ใต้' : 'เหนือ';
      if (n - 1 - s.si <= 1 && !told.has('w' + key)) { told.add('w' + key); alertMsg(`💀 <b>กำลังกวาด SL ${where} ${s.P.p.toFixed(1)}</b> (${s.P.why.join(' + ')})<br>รอแท่ง M5 ปิดกลับ${s.side > 0 ? 'เหนือ' : 'ใต้'}แถบ → ${d}`, false); }
      if (s.ri !== undefined && n - 1 - s.ri <= 1 && !told.has('e' + key)) {
        told.add('e' + key); const f = filters(s);
        alertMsg(`💀 <b>${f.block ? '⛔ กวาดแล้วเด้ง แต่ห้ามสวนตอนนี้' : '✅ รายใหญ่รับ → ' + d}</b> ${s.entry.toFixed(2)} · คะแนน ${s.score}/100<br>SL ${s.sl.toFixed(2)} (เลยไส้) · TP1 ${s.tp1.toFixed(2)} (${s.tpLab}) · TP2 ${s.tp2.toFixed(2)}${s.ev.length ? '<br>หลักฐาน: ' + s.ev.join(' · ') : ''}${f.w.length ? '<br>' + f.w.join('<br>') : ''}`, !f.block);
      }
    });
  }
  function alertMsg(html, strong) {
    if (window.OIAlerts && !OIAlerts.on('trap')) return;
    O.beep && O.beep();
    try { navigator.vibrate && navigator.vibrate(strong ? [200, 100, 200] : [120]); } catch (e) {}
    O.showToast && O.showToast(html, strong ? 15000 : 8000);
  }
  setInterval(() => run(false), 20000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') run(true); });
  setTimeout(() => run(true), 6500);

  // ---------- วาด ----------
  const csec = () => TFS[O.tf] || 60, toChart = t => Math.floor(t / csec()) * csec();
  O.hooks.push((ctx, w, h) => {
    if (!cfg.on || !B.length || csec() >= 86400) return;
    const ts = O.chart.timeScale(), sr = O.series, plotW = ts.width(), plotH = h - ts.height();
    const X = i => ts.timeToCoordinate(toChart(B[Math.min(i, B.length - 1)].time)), Y = p => sr.priceToCoordinate(p);
    const mono = getComputedStyle(document.documentElement).getPropertyValue('--mono') || 'monospace';
    const px = O.lastClose || B[B.length - 1].close;
    ctx.save(); ctx.font = `bold 9px ${mono}`; ctx.textBaseline = 'middle';
    // แถบ SL ใกล้ราคา (±3 ATR) · หนา = SL กองมาก
    if (cfg.pools) pools.filter(p => !p.swept && (p.side > 0 ? p.p > px : p.p < px) && Math.abs(p.p - px) <= atr * 6).sort((a, b) => Math.abs(a.p - px) - Math.abs(b.p - px)).slice(0, 6).forEach(p => {
      const y = Y(p.p); if (y === null || y < 6 || y > plotH - 6) return;
      const th = Math.min(7, 2 + p.w * 0.6);
      ctx.globalAlpha = 0.18; ctx.fillStyle = '#ffb347'; ctx.fillRect(plotW * 0.62, y - th / 2, plotW * 0.38, th);
      ctx.globalAlpha = 0.85; ctx.fillStyle = '#ffb347'; ctx.textAlign = 'left';
      ctx.fillText(`💀 SL ${p.side < 0 ? 'Long' : 'Short'} · ${p.why.slice(0, 2).join('+')}`, plotW * 0.62 + 2, y + (p.side < 0 ? 8 : -8));
    });
    ctx.globalAlpha = 1;
    // V4.8.4: วาดเฉพาะสัญญาณที่ "ครบ" (กวาดแล้วปิดกลับ = มีจุดเข้า) หรือที่กำลังเกิดตอนนี้ · การกวาดที่ไม่กลับเข้า (เบรกจริง) ไม่วาด
    // ใช้จุดเล็ก + ✓/✗ แทนไอคอน 💀 ทุกจุด (เดิมรกมาก โดยเฉพาะ TF ใหญ่ที่หลายสัญญาณ M5 ซ้อนในแท่งเดียว)
    const seen = new Set();
    // V4.9.16: ลดความรก — วาดเฉพาะสัญญาณที่ยังทำงาน (รอปิดกลับ/เข้าแล้วรอผล) ถ้าไม่มี แสดงอันล่าสุดที่จบไม่เกิน 30 นาที · ประวัติดูได้จากการแตะป้าย 💀
    let show = setups.filter(s => s.st === 1 || (s.st === 3 && s.ri !== undefined));
    if (!show.length) show = setups.filter(s => (s.st === 4 || s.st === 5) && s.end !== undefined && B.length - 1 - s.end <= 6).sort((a, b) => b.end - a.end).slice(0, 1);
    show.slice(-3).forEach(s => {
      const x = X(s.ri !== undefined ? s.ri : s.si); if (x === null || x < 0 || x > plotW) return;
      const key = Math.round(x / 6); if (seen.has(key)) return; seen.add(key); // แท่งเดียวกันบน TF ใหญ่ แสดงครั้งเดียว
      const y = Y(s.ri !== undefined ? s.entry : s.ext); if (y === null) return;
      const col = s.st === 4 ? '#22e39a' : s.st === 5 ? '#ff4d6a' : '#ffb347';
      // V4.9.11: ขีดแดง = ราคาที่คนส่วนมากวาง SL (แถบที่ถูกกวาด) คร่อมแท่งที่กวาด → แท่งที่ปิดกลับ
      { const yp = Y(s.P.p), xa = X(s.si), xb = X(s.ri !== undefined ? s.ri : s.si), st = Math.max(4, ts.options().barSpacing || 6);
        if (yp !== null && xa !== null && xb !== null && yp > 0 && yp < plotH) { ctx.strokeStyle = '#ff2e4d'; ctx.lineWidth = 2; ctx.setLineDash([]); ctx.beginPath(); ctx.moveTo(Math.min(xa, xb) - st * 1.2, yp); ctx.lineTo(Math.max(xa, xb) + st * 1.2, yp); ctx.stroke(); ctx.fillStyle = col; } }
      // V4.8.6: 💀 ที่จุดเข้า + ✓ (ถึง TP1) / ✗ (โดน SL) · กำลังรอผล = 💀 เฉย ๆ
      ctx.textAlign = 'center'; ctx.font = `11px ${mono}`; ctx.fillText('💀', x, y);
      if (s.st === 4 || s.st === 5) { ctx.font = `bold 11px ${mono}`; ctx.fillStyle = col; ctx.textAlign = 'left'; ctx.fillText(s.st === 4 ? '✓' : '✗', x + 7, y); }
      ctx.font = `bold 9px ${mono}`;
    });
    // แผนที่ยังทำงาน
    if (fresh()) setups.filter(s => s.st === 3 || s.st === 1).forEach(s => {
      const x0 = X(s.ri !== undefined ? s.ri : s.si); if (x0 === null) return;
      // V4.9.14: เส้นแผนยาวแค่ 4 แท่งจากจุดเข้า (เดิมลากถึงขอบขวา) · ป้ายต่อท้ายเส้น
      const xr = Math.min(plotW - 2, x0 + 4 * Math.max(3, ts.options().barSpacing || 6));
      const line = (p, col, dash, lab) => { const y = Y(p); if (y === null || y < 0 || y > plotH) return; ctx.strokeStyle = col; ctx.lineWidth = 1.2; ctx.setLineDash(dash); ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(xr, y); ctx.stroke(); ctx.setLineDash([]); ctx.fillStyle = col; const right = xr + 90 > plotW; ctx.textAlign = right ? 'right' : 'left'; ctx.fillText(lab, right ? xr - 2 : xr + 3, right ? y - 6 : y); };
      if (s.st === 1) line(s.P.p, '#ffb347', [2, 2], `💀 รอปิดกลับ ${s.P.p.toFixed(1)}`);
      else { line(s.entry, '#e0b44c', [], `💀 ${s.side > 0 ? 'BUY' : 'SELL'} ${s.entry.toFixed(1)} · ${s.score}`); line(s.sl, '#ff4d6a', [4, 3], `SL ${s.sl.toFixed(1)}`); line(s.tp1, '#22e39a', [4, 3], `TP1 ${s.tp1.toFixed(1)}`); line(s.tp2, '#22e39a', [2, 4], `TP2 ${s.tp2.toFixed(1)}`); }
    });
    ctx.restore();
  });

  // ---------- ป้าย ----------
  (window.OIBadgeExtra = window.OIBadgeExtra || []).push(() => {
    if (!cfg.on || !fresh()) return null;
    const cur = setups.filter(s => s.st === 1 || s.st === 3).sort((a, b) => b.si - a.si)[0];
    if (!cur) { const l = setups.filter(s => (s.st === 4 || s.st === 5) && s.end !== undefined && B.length - 1 - s.end <= 6).sort((a, b) => b.end - a.end)[0]; // จบไม่เกิน 30 นาที → ป้ายยังอยู่ให้แตะดูผล
      return l ? [`💀 ${l.side > 0 ? 'BUY' : 'SELL'} ${l.entry.toFixed(1)} ${l.st === 4 ? '✓ TP' : '✗ SL'}`, l.st === 4 ? '#22e39a' : '#ff4d6a', 'trap'] : null; }
    if (cur.st === 1) return [`💀 กวาด SL ${cur.side > 0 ? 'ใต้' : 'เหนือ'} ${cur.P.p.toFixed(0)} รอยืนยัน`, '#ffb347', 'trap'];
    const f = filters(cur);
    return [`💀 ${cur.side > 0 ? 'BUY' : 'SELL'} ${cur.entry.toFixed(1)} · ${cur.score}${f.block ? ' ⛔' : ''}`, f.block ? '#8a93ad' : cur.side > 0 ? '#22e39a' : '#ff8a3d', 'trap'];
  });

  // ---------- แตะป้าย 💀 = การวิเคราะห์ล่าสุด (V4.9.1) ----------
  function explain() {
    const px = O.lastClose || (B.length ? B[B.length - 1].close : 0);
    const cur = setups.filter(s => s.st === 1 || s.st === 3).sort((a, b) => b.si - a.si)[0];
    const last = cur || setups.filter(s => s.ri !== undefined).sort((a, b) => b.si - a.si)[0];
    const tt = i => B[i] ? new Date(B[i].time * 1000).toISOString().slice(11, 16) : '–';
    const f2 = v => v === null || v === undefined || !isFinite(v) ? '–' : v.toFixed(2);
    let h = `<b style="color:#ffb347">💀 กับดักคนส่วนน้อย · M5</b> · ราคา ${f2(px)}<br>`;
    if (last) {
      const d = last.side > 0 ? 'BUY' : 'SELL', where = last.side > 0 ? 'ใต้' : 'เหนือ';
      const stTxt = { 1: '⏳ กำลังกวาด รอแท่งปิดกลับเข้าแถบ', 3: '🟡 เข้าแล้ว รอผล', 4: '✅ ถึง TP1', 5: '❌ โดน SL', 6: '⌛ หมดเวลา' }[last.st] || '';
      h += `<b>${cur ? 'สัญญาณตอนนี้' : 'สัญญาณล่าสุด'} (${tt(last.si)} น.): ${stTxt}</b><br>`;
      h += `● กวาด SL ${where} <b>${last.P.p.toFixed(1)}</b> — ${last.P.why.join(' + ')} (น้ำหนัก ${last.P.w.toFixed(1)})<br>● ไส้แทงไปถึง ${f2(last.ext)}<br>`;
      if (last.ri !== undefined) {
        h += `● แผน <b>${d} ${f2(last.entry)}</b> · SL ${f2(last.sl)} (เสี่ยง $${f2(last.R)}) · TP1 ${f2(last.tp1)} (${last.tpLab}) · TP2 ${f2(last.tp2)}<br>`;
        h += `● คะแนน <b>${last.score}/100</b> = พื้นฐาน + น้ำหนักแถบ${last.ev && last.ev.length ? ' + หลักฐาน: ' + last.ev.join(' · ') : ' (ไม่มีหลักฐานรายใหญ่เพิ่ม)'}<br>`;
        const f = filters(last); if (f.w.length) h += `<b style="color:#ff4d6a">⛔ ห้ามสวนตอนนี้: ${f.w.join(' · ')}</b><br>`;
      }
    } else h += 'ยังไม่มีสัญญาณกวาด SL ในช่วงนี้<br>';
    const up = pools.filter(p => !p.swept && p.side > 0 && p.p > px).sort((a, b) => a.p - b.p).slice(0, 2), dn = pools.filter(p => !p.swept && p.side < 0 && p.p < px).sort((a, b) => b.p - a.p).slice(0, 2);
    h += `<br><b>แถบ SL ที่ยังไม่ถูกกวาด</b><br>` + up.reverse().map(p => `▲ ${p.p.toFixed(1)} SL Short — ${p.why.join(' + ')}`).concat(dn.map(p => `▼ ${p.p.toFixed(1)} SL Long — ${p.why.join(' + ')}`)).join('<br>');
    h += `<br><span style="opacity:.65">${stats()}${basis !== null ? ` · สปอตต่ำกว่ากราฟ ${basis.toFixed(1)}` : ''}</span>`;
    O.showToast && O.showToast(h, 25000);
  }
  let down = null;
  const onBadge = e => { const el = e.target && (e.target.nodeType === 1 ? e.target : e.target.parentElement); return el && el.closest ? el.closest('#badges [data-k="trap"]') : null; };
  document.addEventListener('pointerdown', e => { down = onBadge(e) ? { x: e.clientX, y: e.clientY } : null; }, true);
  document.addEventListener('pointerup', e => {
    if (!down) return;
    const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y) > 10; down = null;
    const r = document.querySelector('#badges [data-k="trap"]')?.getBoundingClientRect();
    if (!moved && r && e.clientX >= r.left - 4 && e.clientX <= r.right + 4 && e.clientY >= r.top - 6 && e.clientY <= r.bottom + 6) setTimeout(explain, 120);
  }, true);

  // ---------- เมนู ƒx ----------
  function stats() { const d = setups.filter(s => s.st === 4 || s.st === 5), w = d.filter(s => s.st === 4).length; return d.length ? `ย้อนหลัง 2 วัน: เข้า ${d.length} · TP1 ${w} · SL ${d.length - w} (${Math.round(w / d.length * 100)}%)` : 'ยังไม่มีสัญญาณครบในช่วงนี้'; }
  function section() {
    const d = document.createElement('div'); d.id = 'trBox'; d.className = 'gsbox';
    d.innerHTML = `<div class="row"><button class="gsb${cfg.on ? ' on' : ''}" data-tr="on"><i style="background:#ffb347"></i>💀 กับดักคนส่วนน้อย (กวาด SL แล้วเด้ง · M5)</button><span class="gsinfo">${cfg.on ? stats() + (basis !== null ? ` · สปอตต่างจากกราฟ ${basis >= 0 ? '−' : '+'}${Math.abs(basis).toFixed(1)}` : '') : ''}</span></div>` +
      (cfg.on ? `<div class="row ps"><button class="gsb${cfg.pools ? ' on' : ''}" data-tr="pools">แสดงแถบ SL กอง</button></div>` : '');
    return d;
  }
  function mount() { const m = $('indMenu'); if (!m || m.hidden || $('trBox')) return; const box = section(), anchor = $('s3Box') || $('dhBox') || $('btBox') || m.querySelector('.t'); anchor ? anchor.after(box) : m.prepend(box); }
  const menu = $('indMenu');
  if (menu) {
    new MutationObserver(() => mount()).observe(menu, { childList: true });
    menu.addEventListener('click', e => { const a = e.target.closest('[data-tr]'); if (!a) return; if (a.dataset.tr === 'on') cfg.on = !cfg.on; else cfg.pools = !cfg.pools; save(); O.markDirty(); const b = $('trBox'); if (b) b.remove(); mount(); run(true); });
  }
  if (window.OIAlerts) OIAlerts.reg('trap', '💀 กับดักคนส่วนน้อย (กวาด SL แล้วเด้ง)', { desc: 'เตือนตอนราคากวาด SL ที่แถบ และตอนแท่ง M5 ปิดกลับ = จุดเข้า (บอกคะแนน/หลักฐาน/คำเตือนห้ามสวน)', active: () => cfg.on });
  window.OI_trap = { explain, get bars() { return B; }, get basis() { return basis; }, get pools() { return pools; }, get setups() { return setups; }, get atr() { return atr; }, run, stats, filters };
})();

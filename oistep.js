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
  const cfg = { on: !window.OI_NEWDEV, tf: '1m', rev: true, zb: true, rng: true }; // V4.9.29 เครื่องใหม่ปิดเป็นค่าเริ่ม · V4.9.59 rev = กลับตัวที่โซน, zb = เบรกโซน, rng = เบรกกรอบไซด์เวย์
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

  // ================= V4.9.59 ท่าเบรก =================
  // A) เบรกโซน OI (zb): ปิดทะลุโซนเกิน $2 → ทำยอดแรก (swing) → รอ BOS ยอดแรก (ปิดเหนือ/ใต้) → ย่อกลับเข้า OB/FVG ของขา BOS = เข้า
  //    SL ใต้/เหนือจุดย่อก่อน BOS · TP โซน OI ถัดไปที่ ≥ 1R (ไม่มี = 2R)
  // B) เบรกกรอบไซด์เวย์ (rng): กรอบ = 24 แท่ง (M1) / 12 แท่ง (M5) สูง-ต่ำไม่เกิน 2.2 ATR · แท่งเบรกยาว (ตัว ≥ 1.2 ATR, ตัว ≥ 60% ของไส้ถึงไส้, ปิดนอกกรอบ)
  //    จังหวะ 1 (rng1): ทำยอดแรก → ย้อนมาทดสอบขอบกรอบที่เบรก = เข้า · SL กลางกรอบ · TP ยอดแรก (≥ 1R) หรือโซนถัดไป / 2R
  //    จังหวะ 2 (rng2): ราคาไปต่อ BOS ยอดแรก → ย่อเข้า OB/FVG ของขา BOS = เข้า · SL ใต้จุดย่อก่อน BOS · TP โซนถัดไป ≥ 1R / 2R
  const TYPE_LAB = { rev: 'กลับตัวที่โซน', zb: 'เบรกโซน', rng1: 'เบรกกรอบ จังหวะ1', rng2: 'เบรกกรอบ จังหวะ2' }, TYPE_MK = { rev: '③', zb: 'Z', rng1: '①', rng2: '②' };
  function scanBrk(B, Z) {
    const n = B.length, out = [], lim = cfg.tf === '5m' ? { pk: 24, bos: 24, fill: 12, W: 12 } : { pk: 60, bos: 60, fill: 30, W: 24 };
    const TR = B.map((b, i) => i ? Math.max(b.high - b.low, Math.abs(b.high - B[i - 1].close), Math.abs(b.low - B[i - 1].close)) : b.high - b.low), PS = [0]; TR.forEach(v => PS.push(PS[PS.length - 1] + v));
    const ATR = i => Math.max(0.3, (PS[i + 1] - PS[Math.max(0, i - 29)]) / Math.min(30, i + 1));
    const pivH = i => i >= PIV && i + PIV < n && B.slice(i - PIV, i).every(b => b.high < B[i].high) && B.slice(i + 1, i + 1 + PIV).every(b => b.high <= B[i].high);
    const pivL = i => i >= PIV && i + PIV < n && B.slice(i - PIV, i).every(b => b.low > B[i].low) && B.slice(i + 1, i + 1 + PIV).every(b => b.low >= B[i].low);
    // TP = โซนถัดไปที่อยู่ระหว่าง 1R–3R (ไกลกว่านั้นมักหมดเวลาก่อนถึง) ไม่มี = 2R
    const tpOf = (dir, entry, risk) => { const nx = dir > 0 ? Z.find(q => q.lo >= entry + risk) : [...Z].reverse().find(q => q.hi <= entry - risk); return nx && Math.abs((dir > 0 ? nx.lo : nx.hi) - entry) <= 3 * risk ? { tp: dir > 0 ? nx.lo : nx.hi, lab: nx.lab } : { tp: entry + dir * 2 * risk, lab: '2R' }; };
    // หลัง BOS: หา OB/FVG ในขาที่ทำ BOS (จากจุดย่อ L ถึงแท่ง BOS) → แผนเข้า
    const planBos = (s, i, L) => {
      const dir = s.dir; let fvg = null, ob = null;
      for (let j = i; j >= Math.max(2, L + 1); j--) { if (dir > 0 ? B[j].low > B[j - 2].high : B[j].high < B[j - 2].low) { fvg = dir > 0 ? { lo: B[j - 2].high, hi: B[j].low, j } : { lo: B[j].high, hi: B[j - 2].low, j }; break; } }
      for (let j = i - 1; j >= L; j--) { const c = B[j]; if (dir > 0 ? c.close < c.open : c.close > c.open) { ob = { lo: c.low, hi: c.high, j }; break; } }
      const ez = fvg || ob; if (!ez) return false;
      const sw = dir > 0 ? Math.min(...B.slice(L, i + 1).map(b => b.low)) : Math.max(...B.slice(L, i + 1).map(b => b.high));
      s.ez = ez; s.fvg = fvg; s.ob = ob; s.entry = dir > 0 ? ez.hi : ez.lo; s.sl = sw - dir * SL_PAD;
      const R = Math.abs(s.entry - s.sl); if (!(R > 0.3) || R > ATR(i) * 4) return false;
      const t = tpOf(dir, s.entry, R); s.tp = t.tp; s.tpLab = t.lab; return true;
    };
    // ติดตาม st 2 (รอย่อ) / 3 (เข้าแล้ว) แบบเดียวกับสูตรเดิม
    const track = (s, i) => {
      const b = B[i];
      if (s.st === 2) {
        if (s.dir > 0 ? b.close < s.sl : b.close > s.sl) { s.st = -1; s.why = 'หลุด SL ก่อนเข้า'; s.end = i; return; }
        if (i - s.ci > lim.fill) { s.st = -1; s.why = 'ไม่ย่อกลับมา'; s.end = i; return; }
        if (s.dir > 0 ? b.low <= s.entry : b.high >= s.entry) { s.st = 3; s.ei = i; }
      } else if (s.st === 3 && i > s.ei) {
        const hitSL = s.dir > 0 ? b.low <= s.sl : b.high >= s.sl, hitTP = s.dir > 0 ? b.high >= s.tp : b.low <= s.tp;
        if (hitSL) { s.st = 5; s.end = i; s.why = 'SL'; } else if (hitTP) { s.st = 4; s.end = i; s.why = 'TP'; }
        else if (i - s.ei > lim.fill * 4) { s.st = 6; s.end = i; s.why = 'หมดเวลา'; }
      }
    };
    const cool = new Map(); // โซน+ทิศ → แท่งที่จบรอบก่อน (กันเบรกซ้ำโซนเดิมตอนราคาแกว่ง)
    let act = []; // ตัวแม่ (เบรก) ระหว่างรอยอดแรก/BOS: {kind:'zb'|'rng', dir, z, bi, box, ph, L, children:[]}
    const kids = [];
    for (let i = 2; i < n; i++) {
      const b = B[i], pc = B[i - 1].close, atr = ATR(i);
      // --- จุดเบรกใหม่ ---
      if (cfg.zb) Z.forEach(z => {
        const dir = pc <= z.hi + BRK && b.close > z.hi + BRK ? 1 : pc >= z.lo - BRK && b.close < z.lo - BRK ? -1 : 0; if (!dir) return;
        if (act.some(a => a.kind === 'zb' && a.dir === dir)) return; // ทิศเดียวกันมีตัวที่รออยู่แล้ว
        if (cool.has(z.k + dir) && i - cool.get(z.k + dir) < lim.pk) return; // โซนเดิมเพิ่งเบรกไปแล้ว
        act.push({ kind: 'zb', dir, z, bi: i, st: 'pk' });
      });
      if (cfg.rng && i > lim.W) {
        const w = B.slice(i - lim.W, i), hi = Math.max(...w.map(x => x.high)), lo = Math.min(...w.map(x => x.low)), body = Math.abs(b.close - b.open);
        if (hi - lo <= atr * 2.2 && hi - lo >= atr * 0.6 && body >= atr * 1.2 && body >= (b.high - b.low) * 0.6) {
          const dir = b.close > hi + atr * 0.1 && b.close > b.open ? 1 : b.close < lo - atr * 0.1 && b.close < b.open ? -1 : 0;
          if (dir && !act.some(a => a.kind === 'rng' && a.dir === dir)) act.push({ kind: 'rng', dir, z: { k: 'R' + Math.round(dir > 0 ? hi : lo), p: dir > 0 ? hi : lo, lo, hi, lab: `กรอบ ${lo.toFixed(1)}–${hi.toFixed(1)}` }, box: { lo, hi, i0: i - lim.W }, bi: i, st: 'pk' });
        }
      }
      // --- ตัวแม่: ยอดแรก → BOS ---
      act.forEach(a => {
        if (a.done) return; const dir = a.dir, edge = a.kind === 'rng' ? (dir > 0 ? a.box.hi : a.box.lo) : (dir > 0 ? a.z.lo : a.z.hi);
        if (dir > 0 ? b.close < (a.kind === 'rng' ? a.box.lo : edge) : b.close > (a.kind === 'rng' ? a.box.hi : edge)) { a.done = 'เบรกหลอก (กลับเข้ามา)'; return; }
        if (a.st === 'pk') {
          if (i - a.bi > lim.pk) { a.done = 'ไม่ทำยอด'; return; }
          const j = i - PIV; if (j > a.bi - 1 && (dir > 0 ? pivH(j) : pivL(j))) { a.ph = j; a.pv = dir > 0 ? B[j].high : B[j].low; a.st = 'bos';
            if (a.kind === 'rng') { // จังหวะ 1: รอย้อนมาทดสอบขอบกรอบที่เบรก
              const e = dir > 0 ? a.box.hi : a.box.lo, sl = (a.box.hi + a.box.lo) / 2 - dir * SL_PAD, R = Math.abs(e - sl);
              if (R > 0.3 && R <= atr * 4) { const pkR = Math.abs(a.pv - e); const t = pkR >= R ? { tp: a.pv, lab: 'ยอดแรก' } : tpOf(dir, e, R);
                kids.push({ type: 'rng1', z: a.z, dir, t: a.bi, ci: j, st: 2, lvl: a.pv, entry: e, sl, tp: t.tp, tpLab: t.lab, ez: { lo: Math.min(e, e + dir * atr * 0.2), hi: Math.max(e, e + dir * atr * 0.2) }, box: a.box, bi: a.bi }); }
            } }
        } else if (a.st === 'bos') {
          if (i - a.ph > lim.bos) { a.done = 'ไม่ BOS ยอดแรก'; return; }
          if (dir > 0 ? b.close > a.pv : b.close < a.pv) { // BOS ยอดแรก → หาจุดเข้าในขานี้
            const s = { type: a.kind === 'zb' ? 'zb' : 'rng2', z: a.z, dir, t: a.bi, ci: i, st: 2, lvl: a.pv, box: a.box, bi: a.bi };
            if (planBos(s, i, a.ph)) kids.push(s); a.done = 'BOS';
          }
        }
      });
      act.forEach(a => { if (a.done && a.kind === 'zb') cool.set(a.z.k + a.dir, i); });
      act = act.filter(a => !a.done);
      kids.forEach(s => { if (s.st === 2 || s.st === 3) { if (i > s.ci) track(s, i); } });
    }
    act.forEach(a => { if (a.st === 'bos' || a.st === 'pk') kids.push({ type: a.kind === 'zb' ? 'zb' : 'rng', z: a.z, dir: a.dir, t: a.bi, ci: a.ph !== undefined ? a.ph : a.bi, st: 1, wait: a.st, lvl: a.pv, box: a.box, bi: a.bi }); });
    return kids;
  }
  async function run(force) {
    if (!cfg.on || busy) return;
    if (!force && Date.now() - lastRun < 18000) return;
    busy = true; lastRun = Date.now();
    try {
      const B = await O.fetchTF(cfg.tf, cfg.tf === '1m' ? 480 : 300);
      if (B && B.length > 20) { bars = B; const prev = sig(), Z = zones(); setups = (cfg.rev !== false ? scan(B, Z).map(s => Object.assign(s, { type: 'rev' })) : []).concat(cfg.zb || cfg.rng ? scanBrk(B, Z) : []); notify(prev); O.markDirty(); }
    } catch (e) {} finally { busy = false; }
  }
  const sig = () => setups.filter(s => s.st === 2 || s.st === 3).map(s => s.z.k + ':' + s.st + ':' + bars[s.ci].time).join('|');
  // แจ้งเตือนเฉพาะเหตุการณ์ใหม่ที่เกิดในแท่งล่าสุด ๆ (กันเตือนซ้ำตอนเปิดแอป)
  const told = new Set();
  function notify() {
    const n = bars.length;
    setups.forEach(s => {
      const key2 = s.z.k + '|' + (s.ci !== undefined ? bars[s.ci].time : '') , dirT = s.dir > 0 ? '▲ เด้งขึ้น' : '▼ กดลง';
      const ty = s.type || 'rev', tl = TYPE_LAB[ty] || '', k3 = ty + '|' + key2;
      if (s.st >= 2 && s.ci !== undefined && s.entry !== undefined && n - 1 - s.ci <= 2 && !told.has('c' + k3)) {
        told.add('c' + k3);
        const head = ty === 'rev' ? `② CHoCH ${dirT}` : ty === 'rng1' ? `${tl}: ทำยอดแรกแล้ว ${dirT}` : `${tl}: BOS ยอดแรก ${s.lvl.toFixed(1)} ${dirT}`;
        alertMsg(`🎯 <b>${head}</b> · ${s.z.lab}<br>รอย่อเข้า ${ty === 'rng1' ? 'ขอบกรอบที่เบรก' : s.fvg ? 'FVG' : 'OB'} ${s.ez.lo.toFixed(2)}–${s.ez.hi.toFixed(2)} · SL ${s.sl.toFixed(2)} · TP ${s.tp.toFixed(2)} (${s.tpLab})`);
      }
      if (s.st >= 3 && s.ei !== undefined && n - 1 - s.ei <= 2 && !told.has('e' + k3)) {
        told.add('e' + k3);
        alertMsg(`🎯 <b>${ty === 'rev' ? '③' : TYPE_MK[ty] + ' ' + tl} เข้าได้ ${s.dir > 0 ? 'BUY' : 'SELL'}</b> ${s.entry.toFixed(2)} (${s.z.lab})<br>SL ${s.sl.toFixed(2)} · TP ${s.tp.toFixed(2)} (${s.tpLab}) · R:R ${(Math.abs(s.tp - s.entry) / Math.abs(s.entry - s.sl)).toFixed(1)}`);
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
    // V4.9.59: กรอบไซด์เวย์ที่เบรก (ตัวที่ยังทำงาน) = สี่เหลี่ยมเส้นประทอง
    if (fresh) setups.filter(s => s.box && s.st >= 1 && s.st <= 3).forEach(s => { const x0 = X(s.box.i0), x1 = X(s.bi), yt = Y(s.box.hi), yb = Y(s.box.lo); if (x0 === null || x1 === null || yt === null || yb === null) return; ctx.strokeStyle = '#e0b44c'; ctx.globalAlpha = 0.8; ctx.setLineDash([4, 3]); ctx.strokeRect(x0, yt, Math.max(2, x1 - x0), yb - yt); ctx.setLineDash([]); ctx.globalAlpha = 1; });
    const live = fresh ? setups.filter(s => (s.st === 2 || s.st === 3) && s.entry !== undefined) : [], done = setups.filter(s => s.st >= 3 && s.ei !== undefined);
    // ประวัติ: มาร์กเล็ก ๆ ตรงแท่งที่เข้า (✓ ถึง TP / ✗ โดน SL)
    done.forEach(s => {
      const x = X(s.ei), y = Y(s.entry); if (x === null || y === null || x < 0 || x > plotW) return;
      const col = s.st === 4 ? '#22e39a' : s.st === 5 ? '#ff4d6a' : '#e0b44c';
      ctx.fillStyle = col; ctx.beginPath();
      if (s.dir > 0) { ctx.moveTo(x, y + 2); ctx.lineTo(x - 4, y + 9); ctx.lineTo(x + 4, y + 9); } else { ctx.moveTo(x, y - 2); ctx.lineTo(x - 4, y - 9); ctx.lineTo(x + 4, y - 9); }
      ctx.fill();
      ctx.textAlign = 'center'; ctx.fillText((s.type && s.type !== 'rev' ? TYPE_MK[s.type] : '') + (s.st === 4 ? '✓' : s.st === 5 ? '✗' : s.type && s.type !== 'rev' ? '' : '③'), x, s.dir > 0 ? y + 16 : y - 16);
    });
    // setup ที่ยังทำงาน: กล่อง OB/FVG + เส้น entry / SL / TP สั้น ๆ ไปทางขวา
    live.forEach(s => {
      const x0 = X(s.ci); if (x0 === null) return;
      const xr = Math.min(plotW - 2, x0 + Math.max(60, (plotW - x0)));
      const ez = s.ez, y1 = Y(ez.hi), y2 = Y(ez.lo); if (y1 === null || y2 === null) return;
      ctx.globalAlpha = 0.22; ctx.fillStyle = s.dir > 0 ? '#22e39a' : '#ff4d6a'; ctx.fillRect(x0, y1, xr - x0, Math.max(2, y2 - y1));
      ctx.globalAlpha = 0.9; ctx.lineWidth = 1;
      const line = (p, col, dash, lab) => { const y = Y(p); if (y === null || y < 0 || y > plotH) return; ctx.strokeStyle = col; ctx.setLineDash(dash); ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(xr, y); ctx.stroke(); ctx.setLineDash([]); ctx.fillStyle = col; ctx.textAlign = 'right'; ctx.fillText(lab, xr - 2, y - 6); };
      const mk = s.type && s.type !== 'rev' ? TYPE_MK[s.type] + ' ' + TYPE_LAB[s.type] : '③';
      line(s.entry, '#e0b44c', [], `${mk} ${s.st === 3 ? 'เข้าแล้ว' : 'รอย่อ'} ${s.dir > 0 ? 'BUY' : 'SELL'} ${s.entry.toFixed(1)}`);
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
    const ty = s.type || 'rev', tl = TYPE_LAB[ty] || '';
    if (s.st === 1) return ty === 'rev' ? [`🎯① ชน ${s.z.lab} ${d} รอ CHoCH`, '#e0b44c', 'step'] : [`🎯 ${ty === 'zb' ? 'เบรกโซน ' + s.z.lab : 'เบรกกรอบ'} ${d} ${s.wait === 'pk' ? 'รอทำยอดแรก' : 'รอ BOS ยอดแรก ' + (s.lvl || 0).toFixed(1)}`, '#e0b44c', 'step'];
    if (s.st === 2) return [ty === 'rev' ? `🎯② CHoCH ${d} รอย่อ ${s.entry.toFixed(1)}` : `🎯${TYPE_MK[ty]} ${tl} ${d} รอย่อ ${s.entry.toFixed(1)}`, s.dir > 0 ? '#22e39a' : '#ff8a3d', 'step'];
    return [`🎯${TYPE_MK[ty]} ${s.dir > 0 ? 'BUY' : 'SELL'} ${s.entry.toFixed(1)} SL ${s.sl.toFixed(1)}`, s.dir > 0 ? '#22e39a' : '#ff8a3d', 'step'];
  });

  // ---------- เมนู ƒx ----------
  function stats() {
    const d = setups.filter(s => s.st === 4 || s.st === 5), w = d.filter(s => s.st === 4).length;
    const per = Object.keys(TYPE_LAB).map(t => { const x = d.filter(s => (s.type || 'rev') === t); return x.length ? `${TYPE_MK[t]} ${x.filter(s => s.st === 4).length}/${x.length}` : ''; }).filter(Boolean).join(' · ');
    return d.length ? `ย้อนหลัง ${cfg.tf === '1m' ? '8 ชม.' : '25 ชม.'}: เข้า ${d.length} · ถึง TP ${w} · โดน SL ${d.length - w}${per ? ' (' + per + ')' : ''}` : 'ยังไม่มีสัญญาณครบ 3 ขั้นในช่วงนี้';
  }
  function section() {
    const d = document.createElement('div'); d.id = 's3Box'; d.className = 'gsbox';
    d.innerHTML = `<div class="row"><button class="gsb${cfg.on ? ' on' : ''}" data-s3="on"><i style="background:#e0b44c"></i>🎯 สูตร 3 ขั้น (OI + CHoCH + OB)</button><span id="s3Info" class="gsinfo">${cfg.on ? stats() : ''}</span></div>` +
      (cfg.on ? `<div class="row ps"><button class="gsb${cfg.tf === '1m' ? ' on' : ''}" data-s3tf="1m">CHoCH บน M1</button><button class="gsb${cfg.tf === '5m' ? ' on' : ''}" data-s3tf="5m">CHoCH บน M5</button></div>` +
        `<div class="row ps">${[['rev', '③ กลับตัวที่โซน'], ['zb', 'Z เบรกโซน'], ['rng', '①② เบรกกรอบไซด์เวย์']].map(([k, l]) => `<button class="gsb${cfg[k] !== false ? ' on' : ''}" data-s3ty="${k}">${l}</button>`).join('')}</div>` : '');
    return d;
  }
  function mount() { const m = $('indMenu'); if (!m || m.hidden || $('s3Box')) return; const box = section(), anchor = $('dhBox') || $('btBox') || m.querySelector('.t'); anchor ? anchor.after(box) : m.prepend(box); }
  const menu = $('indMenu');
  if (menu) {
    new MutationObserver(() => mount()).observe(menu, { childList: true });
    menu.addEventListener('click', e => {
      const a = e.target.closest('[data-s3]'), t = e.target.closest('[data-s3tf]'), y = e.target.closest('[data-s3ty]'); if (!a && !t && !y) return;
      if (a) cfg.on = !cfg.on; else if (y) cfg[y.dataset.s3ty] = cfg[y.dataset.s3ty] === false; else cfg.tf = t.dataset.s3tf;
      save(); setups = []; O.markDirty(); const b = $('s3Box'); if (b) b.remove(); mount(); run(true);
    });
  }
  if (window.OIAlerts) OIAlerts.reg('step3', '🎯 สูตร 3 ขั้น (CHoCH + จุดเข้า)', { desc: 'เตือนตอนเกิด CHoCH ที่โซน และตอนราคาย่อเข้า OB/FVG', active: () => cfg.on });
  window.OI_step3 = { get setups() { return setups; }, get bars() { return bars; }, scan, scanBrk, zones, run, get cfg() { return cfg; }, TYPE_LAB };
})();

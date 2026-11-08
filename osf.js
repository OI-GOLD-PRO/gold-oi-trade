// 🌏 OI Session Fade v0.5 — สวนกำแพง OI ตามช่วงตลาด (จากแบ็กเทส 12 ต.ค.–6 พ.ย. 2026)
//  v0.5: Asia เช้า ข้ามไม้ที่ราคาพุ่งเข้าโซนเกิน 3×ATR ใน 5 แท่ง M1 ก่อนแตะ (ATR = ค่าเฉลี่ย True Range 60 แท่ง) → เป็นไม้บันทึก (กรองพุ่ง)
//  เส้น: Call OI 3 อันดับ + Put OI 3 อันดับ ของสัญญาวันนี้ ในระยะ ±$60 จากราคาตอน 06:00 · เกรด A = strike ติด top 3 volume Call หรือ Put
//  ตั้งรอ: แท่ง M1 ปิดห่างขอบโซน ≥ $3 (เหนือ = รอ BUY / ใต้ = รอ SELL) → แตะขอบใกล้ = เข้า limit ที่ขอบใกล้ · นับครั้งแตะใหม่ทุกช่วงตลาด
//  SL = ขอบไกล ∓ $3 · v0.6: TP คิด 3 แบบพร้อมกัน RR 1 / 1.6 / 5 ถือจนโดน SL หรือถึง TP (ไม่มีเวลาปิด) · ข่าวแดง USD: ไม่เข้า −30/+90 นาที
//  ไม้จริง: Asia เช้า 06:00–10:00 โซน ±2 แตะครั้งที่ 1–2 (เกรด A ถึง 3) · London 14:00–19:30 โซน ±1.5 แตะครั้งที่ 1
//  ที่เหลือ (แตะครั้งอื่น / Asia สาย / NY) = ไม้บันทึก ไว้ forward test เทียบ ไม่ใช่สัญญาณเข้า
(() => {
  'use strict';
  const O = window.OI;
  if (!O || !O.hooks || !(O.sym === 'gold' || O.sym === 'gcy')) return;
  const $ = id => document.getElementById(id);
  const KEY = 'oit_sfade' + (O.psfx || '');
  const cfg = { on: null, paper: false, rr: 1 }; // rr = TP ที่ใช้แสดงบนกราฟ/ป้าย/แจ้งเตือน (คิดครบทั้ง 3 ค่าเสมอ) // on = null → ยังไม่เคยตั้ง: เปิดให้รหัสไม่จำกัดวันที่ไม่ใช่เครื่องใหม่
  try { Object.assign(cfg, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch (e) {}
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch (e) {} };
  const isOn = () => cfg.on === null ? true : !!cfg.on;

  const ARM = 3, SLB = 3, RRS = [1, 1.6, 5], RANGE = 60, MOM_N = 5, ATR_N = 60, MOM_MAX = 3, NB = 30 * 60, NA = 90 * 60, NCLOSE = 5 * 60;
  // นาทีของวัน (เวลาไทย) · NY ข้ามเที่ยงคืนถึง 01:30
  const SESS = [
    { id: 'AM', lab: 'Asia เช้า', a: 360, b: 600, half: 2, real: 2, realA: 3, mom: 3 },
    { id: 'AL', lab: 'Asia สาย', a: 600, b: 840, half: 1, real: 0 },
    { id: 'LDN', lab: 'London', a: 840, b: 1170, half: 1.5, real: 1 },
    { id: 'NY', lab: 'NY', a: 1170, b: 1530, half: 1.5, real: 0 },
  ];
  const mod = t => Math.floor((((t % 86400) + 86400) % 86400) / 60);
  const sessOf = t => { const m = mod(t); return SESS.find(s => (m >= s.a && m < s.b) || (s.b > 1440 && m < s.b - 1440)) || null; };
  // วันเทรด = เริ่ม 06:00 (หลัง OI สิ้นวันเข้า) · คืนค่าเวลาเริ่ม (วินาทีเวลาไทย)
  const dayStart = t => Math.floor((t - 6 * 3600) / 86400) * 86400 + 6 * 3600;

  // ---------- ข่าวแดง USD (news.json เดียวกับอินดี้อื่น) → เวลาไทยบนแกน ----------
  let news = [];
  async function loadNews() {
    try {
      const own = location.hostname.endsWith('.github.io') ? location.hostname.split('.')[0] : 'OI-GOLD-PRO';
      const j = await (await fetch(`https://raw.githubusercontent.com/${own}/gold-oi-pro/main/news.json?t=${Math.floor(Date.now() / 300000)}`, { cache: 'no-store' })).json();
      news = (j.events || []).filter(e => e.c === 'USD' && (e.i || 'H') === 'H').map(e => Date.parse(e.date) / 1000 + 7 * 3600).filter(isFinite).sort((a, b) => a - b);
    } catch (e) {}
  }
  loadNews(); setInterval(loadNews, 10 * 60e3);

  // ---------- เส้นของวัน ----------
  function levels(ref, src) {
    const R0 = src || (O.oi && O.oi.rows); if (!R0 || !R0.length) return [];
    const rows = R0.filter(r => r.price !== null && r.price !== undefined && Math.abs(r.price - ref) <= RANGE);
    const top = (k, n) => rows.filter(r => r[k] > 0).sort((a, b) => b[k] - a[k]).slice(0, n).map(r => r.strike);
    const C = top('c', 3), P = top('p', 3), V = new Set(top('vc', 3).concat(top('vp', 3)));
    return [...new Set(C.concat(P))].map(k => { const r = rows.find(x => x.strike === k); return { k, p: r.price, side: C.includes(k) ? 'C' : 'P', grade: V.has(k) ? 'A' : 'B' }; }).sort((a, b) => a.p - b.p);
  }

  // ---------- โมเมนตัมเข้าโซน: ระยะที่ราคาวิ่งเข้าหาโซนใน 5 แท่งก่อนแท่ง i หารด้วย ATR 60 แท่ง ----------
  function atrArr(B) {
    const n = B.length, tr = new Array(n).fill(NaN), out = new Array(n).fill(NaN); let sum = 0;
    for (let j = 1; j < n; j++) tr[j] = Math.max(B[j].high, B[j - 1].close) - Math.min(B[j].low, B[j - 1].close);
    for (let i = ATR_N + 1; i < n; i++) { if (i === ATR_N + 1) { sum = 0; for (let j = 1; j <= ATR_N; j++) sum += tr[j]; } else sum += tr[i - 1] - tr[i - 1 - ATR_N]; out[i] = sum / ATR_N; }
    return out; // out[i] = เฉลี่ย TR ของแท่ง i-60..i-1
  }
  const momAt = (B, A, i, dir) => (i > MOM_N && A[i] > 0) ? (B[i - 1].close - B[i - 1 - MOM_N].close) * -dir / A[i] : null; // dir = ทิศเทรด (+1 BUY = ราคาวิ่งลงมาหา)

  // ใช้ผลของ RR ที่เลือกเป็นค่าหลัก (st / tp / exit / pnl …) ให้ส่วนวาด/ป้าย/แจ้งเตือนใช้
  function view(s) { const v = s.v[cfg.rr] || s.v[1]; ['tp', 'st', 'end', 'exit', 'why', 't1', 'pnl', 'res'].forEach(k => { s[k] = v[k]; }); return s; }

  // ---------- สแกน (ฟังก์ชันล้วน ใช้ทดสอบย้อนหลังได้) ----------
  // B = แท่ง M1 {time(วินาทีเวลาไทย), open, high, low, close} · L = [{k, p, side, grade}] · N = เวลาข่าว (วินาทีเวลาไทย)
  function scan(B, L, N, opt) {
    opt = opt || {}; N = N || []; const from = opt.from || 0, until = opt.until || Infinity, ATR = atrArr(B);
    const out = [], n = B.length; let cur = null, st = new Map();
    const inNews = t => N.some(x => t >= x - NB && t <= x + NA);
    for (let i = 0; i < n; i++) {
      const b = B[i]; if (b.time < from || b.time >= until) continue;
      const S = sessOf(b.time), sk = S ? S.id + '|' + dayStart(b.time) : null;
      if (sk !== cur) { cur = sk; st = new Map(); }
      if (!S) continue;
      L.forEach(z => {
        const lo = z.p - S.half, hi = z.p + S.half, s = st.get(z.k) || { arm: 0, k: 0 }; st.set(z.k, s);
        if (s.arm && b.low <= hi && b.high >= lo) {
          s.k++; const dir = s.arm; s.arm = 0;
          if (s.k > 4 || inNews(b.time)) return;
          let real = S.real > 0 && (s.k <= S.real || (z.grade === 'A' && s.k <= (S.realA || 0)));
          const mv = momAt(B, ATR, i, dir), atr = ATR[i] > 0 ? ATR[i] : null, fast = !!(real && S.mom && mv !== null && mv > S.mom);
          if (fast) real = false;
          const entry = dir > 0 ? hi : lo, sl = dir > 0 ? lo - SLB : hi + SLB;
          out.push({ z, S, dir, k: s.k, real, fast, mv: mv !== null ? Math.round(mv * 10) / 10 : null, atr, ei: i, entry, sl, st: 3 });
          return;
        }
        if (b.close > hi + ARM) s.arm = 1; else if (b.close < lo - ARM) s.arm = -1;
      });
    }
    // ติดตามผล v0.6: TP 3 แบบ RR 1 / 1.6 / 5 (× ระยะ SL) · ถือจนโดน SL หรือถึง TP (ไม่มีเวลาปิด/ไม่ปิดก่อนข่าว) · แท่งที่เข้าเช็ก SL อย่างเดียว · SL ก่อน TP
    out.forEach(s => {
      s.R = Math.abs(s.entry - s.sl); s.t0 = B[s.ei].time; s.v = {};
      RRS.forEach(rr => {
        const tp = s.entry + s.dir * rr * s.R, v = { rr, tp, st: 3 };
        for (let j = s.ei; j < n; j++) {
          const b = B[j];
          if (s.dir > 0 ? b.low <= s.sl : b.high >= s.sl) { Object.assign(v, { st: 5, end: j, exit: s.sl, why: 'SL' }); break; }
          if (j > s.ei && (s.dir > 0 ? b.high >= tp : b.low <= tp)) { Object.assign(v, { st: 4, end: j, exit: tp, why: 'TP' }); break; }
        }
        v.t1 = v.end !== undefined ? B[v.end].time : null;
        if (v.exit !== undefined) { v.pnl = Math.round((v.exit - s.entry) * s.dir * 100) / 100; v.res = Math.round(v.pnl / s.R * 100) / 100; }
        s.v[rr] = v;
      });
      view(s);
    });
    return out;
  }

  // ---------- OI ย้อนหลังรายวัน (API เดียวกับ Historical OI Zones: oi_backup + oi_recovered) ----------
  let hist = new Map(), histAt = 0, histMsg = '';
  const m1Cache = new Map(), HIST_DAYS = 20, TRACK = 36 * 3600, m1At = new Map(); // วันที่ยังติดตามผลไม่ครบ 36 ชม. ดึงใหม่ทุก 10 นาที // แคชแท่ง M1 รายวันที่จบแล้ว (ไม่ต้องดึงซ้ำ) · แบ็กเทสย้อนหลังสูงสุด 10 วัน
  async function loadHist() {
    if (Date.now() - histAt < 30 * 60e3 || !window.OIHistoryZonesAPI) return;
    histAt = Date.now();
    try {
      const d = await window.OIHistoryZonesAPI();
      hist = new Map((d.days || []).filter(x => /^\d{4}-\d{2}-\d{2}$/.test(x.date) && Array.isArray(x.rows))
        .map(x => [x.date, x.rows.map(r => ({ strike: +r.strike, price: +r.strike, c: +r.c || 0, p: +r.p || 0, vc: 0, vp: 0 }))]));
      histMsg = '';
    } catch (e) { histMsg = 'โหลด OI ย้อนหลังไม่ได้: ' + (e.message || e); histAt = Date.now() - 25 * 60e3; }
  }
  const ymd = t => new Date(t * 1000).toISOString().slice(0, 10); // t = วินาทีเวลาไทย

  let setups = [], today = [], bars = [], lv = [], days = [], lastRun = 0, busy = false;
  async function run(force) {
    if (!isOn() || busy) return;
    if (!force && Date.now() - lastRun < 18000) return;
    busy = true; lastRun = Date.now();
    try {
      await loadHist();
      let [A1, A5] = await Promise.all([O.fetchTF('1m', 6000), O.fetchTF('5m', 1500)]);
      if ((!A1 || A1.length < 300) && O.fetchHist) { const h = await O.fetchHist('1m', Date.now() - 3.5 * 86400e3, Date.now() + 60e3); if (h && h.length > 300) A1 = h; } // เสาร์-อาทิตย์
      if (A1 && A1.length > 30) {
        const d0 = dayStart(A1[A1.length - 1].time), oldKeys = new Set(today.map(key));
        // วันนี้: M1 + OI สด (มีเกรด A จาก volume)
        const i0 = A1.findIndex(b => b.time >= d0);
        // V4.9.78: ตลาดปิด/ข้อมูลเก่า (แท่งล่าสุดเกิน 3 ชม.) → OI สดในแอปเป็นสัญญาณถัดไปแล้ว ใช้ไม่ได้กับแท่งวันนั้น → คิดวันนั้นจาก OI ย้อนหลังแทน
        const live = Date.now() / 1000 + 7 * 3600 - A1[A1.length - 1].time < 3 * 3600;
        bars = i0 >= 0 ? A1.slice(Math.max(0, i0 - ATR_N - 10)) : []; // +70 แท่งก่อน 06:00 ไว้คำนวณ ATR
        lv = i0 >= 0 && live ? levels(A1[i0].open) : [];
        today = bars.length && live ? scan(bars, lv, news, { from: d0 }).map(s => Object.assign(s, { day: ymd(d0), tf: 'M1', live: true })) : [];
        // ย้อนหลัง: วันที่มี OI ในชีต · ใช้ M1 ถ้ามีครบวัน ไม่งั้น M5 (ประมาณ) · เกรด A ย้อนหลังไม่มี (ไม่มี volume รายวัน) = เกรด B ทั้งหมด
        const past = [], dl = live ? [{ day: ymd(d0), tf: 'M1', n: today.length }] : [];
        // V4.9.79: วันที่ M1 ในกราฟไม่ครบ → ดึง M1 ย้อนหลังรายวัน (Bybit/Binance ไล่หน้า) เก็บแคชไว้ · ไม่ได้จริง ๆ ค่อยใช้ M5 (≈ ไม่คิดผล)
        const dts = [...hist.keys()].sort().filter(dt => { const ds = Date.parse(dt + 'T06:00:00Z') / 1000, wd = new Date(ds * 1000).getUTCDay(); return wd >= 1 && wd <= 5 && (live ? ds < d0 : ds <= d0); }).slice(-HIST_DAYS); // V4.9.81: ข้ามเสาร์-อาทิตย์ (เดิมกินโควตาวัน)
        for (const dt of dts) {
          const ds = Date.parse(dt + 'T06:00:00Z') / 1000, de = ds + 86400;
          let src = null, m1 = false;
          if (A1[0].time <= ds - (ATR_N + 10) * 60) { src = A1; m1 = true; } // A1 มีถึงปัจจุบัน ติดตามผลต่อได้เอง
          else {
            if ((!m1Cache.has(dt) || (de + TRACK > Date.now() / 1000 + 7 * 3600 && Date.now() - (m1At.get(dt) || 0) > 10 * 60e3)) && O.fetchHist && de < A1[A1.length - 1].time) m1At.set(dt, Date.now()); m1Cache.set(dt, await O.fetchHist('1m', (ds - 7 * 3600 - (ATR_N + 20) * 60 - (new Date(ds * 1000).getUTCDay() === 1 ? 3 * 86400 : 0)) * 1000, Math.min(Date.now(), (de + TRACK - 7 * 3600) * 1000))); // +36 ชม. ไว้ติดตามผล RR 5 // วันจันทร์: ย้อนถึงศุกร์ไว้คำนวณ ATR
            const c = m1Cache.get(dt); if (c && c.length > 300) { src = c; m1 = true; }
            else if (A5 && A5.length && A5[0].time <= ds + 3600) src = A5;
          }
          if (!src) continue;
          const j0 = src.findIndex(b => b.time >= ds), j1 = src.findIndex(b => b.time >= de), je = j1 < 0 ? src.length : j1;
          if (j0 < 0 || je - j0 < (m1 ? 300 : 60)) continue;
          const j2 = src.findIndex(b => b.time >= de + TRACK), B = src.slice(Math.max(0, j0 - ATR_N - 10), j2 < 0 ? src.length : j2); // ติดตามผลต่อหลังจบวันได้อีก 36 ชม. (RR 5)
          const L = levels(src[j0].open, hist.get(dt)); if (!L.length) continue;
          const r = scan(B, L, news, { from: ds, until: de }).map(s => Object.assign(s, { day: dt, tf: m1 ? 'M1' : 'M5' }));
          past.push(...r); dl.push({ day: dt, tf: m1 ? 'M1' : 'M5', n: r.length });
        }
        setups = past.concat(today); days = dl;
        today.filter(s => s.real).forEach(s => { if (!fp.has(key(s))) fpFetch(s); ivSnap(s); }); // Δ5 ฟุตปริ้นท์ + IV ของไม้จริงวันนี้
        notify(oldKeys); O.markDirty();
      }
    } catch (e) {} finally { busy = false; }
  }
  const key = s => s.S.id + '|' + s.z.k + '|' + s.k + '|' + s.t0;
  const told = new Set();
  function notify(old) {
    const n = bars.length;
    today.filter(s => s.real).forEach(s => {
      const k = key(s);
      if (n - 1 - s.ei <= 2 && !told.has('e' + k) && !old.has(k)) {
        told.add('e' + k);
        alertMsg(`🌏 <b>${s.dir > 0 ? 'BUY' : 'SELL'} ${s.entry.toFixed(2)}</b> · ${s.S.lab} · ${s.z.side}${s.z.k} เกรด ${s.z.grade} · แตะครั้งที่ ${s.k}<br>SL ${s.sl.toFixed(2)} · TP RR1 ${s.v[1].tp.toFixed(2)} · RR1.6 ${s.v[1.6].tp.toFixed(2)} · RR5 ${s.v[5].tp.toFixed(2)}`);
      }
      if (s.st >= 4 && s.end !== undefined && n - 1 - s.end <= 2 && !told.has('x' + k)) {
        told.add('x' + k);
        alertMsg(`🌏 ${s.why === 'TP' ? `✓ ถึง TP RR${cfg.rr}` : s.why === 'SL' ? '✗ โดน SL' : s.why} · ${s.dir > 0 ? 'BUY' : 'SELL'} ${s.z.side}${s.z.k} (${s.res > 0 ? '+' : ''}${s.res}R)`);
      }
    });
  }
  function alertMsg(html) {
    if (window.OIAlerts && !OIAlerts.on('sfade')) return;
    O.beep && O.beep();
    try { navigator.vibrate && navigator.vibrate([200, 100, 200]); } catch (e) {}
    O.showToast && O.showToast(html, 15000);
  }
  setInterval(() => run(false), 20000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') run(true); });
  setTimeout(() => run(true), 7000);

  // ---------- วาด ----------
  const TFS = { '1m': 60, '5m': 300, '15m': 900, '30m': 1800, '1h': 3600, '4h': 14400, '1d': 86400 };
  const csec = () => TFS[O.tf] || 60, toChart = t => Math.floor(t / csec()) * csec();
  const fresh = () => bars.length && Date.now() / 1000 + 7 * 3600 - bars[bars.length - 1].time < 3 * 3600;
  O.hooks.push((ctx, w, h) => {
    if (!isOn() || !setups.length && !lv.length) return;
    const ts = O.chart.timeScale(), sr = O.series, plotW = ts.width(), plotH = h - ts.height();
    const X = t => ts.timeToCoordinate(toChart(t)), Y = p => sr.priceToCoordinate(p), bw = Math.max(2, (X(bars.length ? bars[bars.length - 1].time : 0) || 0) - (X((bars.length ? bars[bars.length - 1].time : 0) - csec()) || 0));
    const mono = getComputedStyle(document.documentElement).getPropertyValue('--mono') || 'monospace';
    ctx.save(); ctx.font = `bold 10px ${mono}`; ctx.textBaseline = 'middle';
    // โซนของช่วงที่เทรดได้ตอนนี้ (Asia เช้า / London) = แถบจาง ๆ
    const S = fresh() ? sessOf(bars[bars.length - 1].time) : null;
    if (S && S.real) lv.forEach(z => {
      const y1 = Y(z.p + S.half), y2 = Y(z.p - S.half); if (y1 === null || y2 === null) return;
      ctx.globalAlpha = z.grade === 'A' ? 0.16 : 0.09; ctx.fillStyle = '#7fd0ff'; ctx.fillRect(0, y1, plotW, Math.max(1, y2 - y1));
      ctx.globalAlpha = 0.85; ctx.fillStyle = '#7fd0ff'; ctx.textAlign = 'left'; ctx.fillText(`🌏 ${z.side}${z.k}${z.grade === 'A' ? ' A' : ''}`, 4, y1 - 5);
    });
    ctx.globalAlpha = 1;
    // ไม้ (แบ็กเทส + วันนี้): กรอบ TP เขียว / SL แดง จากแท่งเข้าถึงแท่งออก (ยังเปิด = ถึงแท่งล่าสุด)
    const lastT = bars.length ? bars[bars.length - 1].time : null;
    setups.filter(s => s.real || s.fast || cfg.paper).forEach(s => {
      // V4.9.80: แท่งเข้าไม่อยู่ในกราฟ (เลื่อนเกิน/ข้อมูลกราฟไม่ถึง) = ไม่วาด · แท่งออกไม่อยู่ในกราฟ: ไม้เปิดอยู่ = ถึงขอบขวา, ไม้จบแล้ว = ไม่วาด (เดิมยืดเต็มจอ ทับกันทั้งกราฟ)
      let x0 = X(s.t0), x1 = X(s.t1 !== null ? s.t1 : (lastT || s.t0));
      if (x0 === null) return;
      if (x1 === null) { if (s.t1 !== null) return; x1 = plotW; }
      x1 = Math.max(x1 + bw, x0 + 6); if (x1 < 0 || x0 > plotW) return;
      const ye = Y(s.entry), yt = Y(s.tp), ys = Y(s.sl); if (ye === null || yt === null || ys === null) return;
      const a = (s.real ? 1 : 0.55) * (s.tf === 'M5' ? 0.75 : 1); // V4.9.76 เข้มขึ้น · ไม้กรองพุ่ง = จางแบบไม้บันทึก + ป้ายแดง
      ctx.globalAlpha = 0.32 * a; ctx.fillStyle = '#22e39a'; ctx.fillRect(x0, Math.min(ye, yt), x1 - x0, Math.abs(yt - ye));
      ctx.fillStyle = '#ff4d6a'; ctx.fillRect(x0, Math.min(ye, ys), x1 - x0, Math.abs(ys - ye));
      ctx.globalAlpha = a; ctx.lineWidth = 1.5;
      ctx.strokeStyle = '#22e39a'; ctx.beginPath(); ctx.moveTo(x0, yt); ctx.lineTo(x1, yt); ctx.stroke();
      ctx.strokeStyle = '#ff4d6a'; ctx.beginPath(); ctx.moveTo(x0, ys); ctx.lineTo(x1, ys); ctx.stroke();
      ctx.strokeStyle = '#7fd0ff'; ctx.beginPath(); ctx.moveTo(x0, ye); ctx.lineTo(x1, ye); ctx.stroke();
      // TP ของ RR อื่น = เส้นประจาง + ป้าย ✓/✗
      RRS.filter(rr => rr !== cfg.rr && s.v[rr]).forEach(rr => { const v = s.v[rr], y = Y(v.tp); if (y === null) return; ctx.save(); ctx.globalAlpha = 0.55 * a; ctx.setLineDash([3, 3]); ctx.strokeStyle = '#22e39a'; ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x1, y); ctx.stroke(); ctx.setLineDash([]); ctx.fillStyle = v.st === 4 ? '#22e39a' : v.st === 5 ? '#ff4d6a' : '#7fd0ff'; ctx.textAlign = 'right'; if (x1 - 2 > 0) ctx.fillText(`${rr}R${v.st === 4 ? '✓' : v.st === 5 ? '✗' : ''}`, x1 - 2, y + (s.dir > 0 ? -6 : 6)); ctx.restore(); });
      // จุดออก
      if (s.t1 !== null && s.exit !== undefined) { const yx = Y(s.exit); if (yx !== null) { ctx.fillStyle = s.pnl > 0 ? '#22e39a' : s.pnl < 0 ? '#ff4d6a' : '#e0b44c'; ctx.beginPath(); ctx.arc(x1 - bw / 2, yx, 3.5, 0, 7); ctx.fill(); } }
      // ป้าย: ทิศ · ครั้งที่แตะ · ผล
      const res = s.st === 3 ? 'เปิดอยู่' : `${s.st === 4 ? '✓' : s.st === 5 ? '✗' : s.why === 'ปิดก่อนข่าว' ? '📰' : '⏱'} ${s.pnl > 0 ? '+' : ''}${s.pnl}$`;
      const lab = `${s.tf === 'M5' ? '≈' : ''}${s.real ? '🌏' : '·'}${s.dir > 0 ? 'B' : 'S'}${s.k} ${cfg.rr}R${s.tf === 'M5' ? '' : ' ' + res}`;
      const ly = s.dir > 0 ? Math.max(yt, 0) - 7 : Math.min(yt, plotH) + 7; let lx = Math.max(2, x0 + 2);
      if (s.fast && lx < plotW) { const t = `⚡${s.mv}×ATR ข้าม `; ctx.globalAlpha = 1; ctx.fillStyle = '#ff3b5c'; ctx.textAlign = 'left'; ctx.fillText(t, lx, ly); lx += ctx.measureText(t).width; }
      ctx.globalAlpha = a; ctx.fillStyle = s.st === 3 ? '#7fd0ff' : s.pnl > 0 ? '#22e39a' : '#ff4d6a'; ctx.textAlign = 'left';
      if (lx < plotW) ctx.fillText(lab, lx, ly);
    });
    ctx.globalAlpha = 1;
    // ไม้จริงที่ยังเปิดอยู่: ราคาเข้า / SL / TP ที่ขอบขวา
    if (fresh()) today.filter(s => s.real && s.st === 3).forEach(s => {
      const line = (p, col, lab) => { const y = Y(p); if (y === null || y < 0 || y > plotH) return; ctx.fillStyle = col; ctx.textAlign = 'right'; ctx.fillText(lab, plotW - 4, y - 6); };
      line(s.entry, '#7fd0ff', `🌏 ${s.dir > 0 ? 'BUY' : 'SELL'} ${s.entry.toFixed(1)} · ${s.z.side}${s.z.k} ครั้งที่ ${s.k}`);
      line(s.sl, '#ff4d6a', `SL ${s.sl.toFixed(1)}`); RRS.forEach(rr => line(s.v[rr].tp, '#22e39a', `TP ${rr}R ${s.v[rr].tp.toFixed(1)}${s.v[rr].st === 4 ? ' ✓' : ''}`));
    });
    ctx.restore();
  });

  // ---------- ฟุตปริ้นท์ Δ5 (V4.9.84, เก็บข้อมูล forward test แยกชุด) ----------
  // แรงซื้อขายเชิงรุก (taker) จาก Binance XAUUSDT perp ใน 5 นาทีก่อนแท่งที่แตะ · push = (ซื้อ−ขาย)/(ซื้อ+ขาย) × ทิศที่ราคาวิ่งเข้าโซน
  // push > 0 = มีแรงไล่ราคาเข้ากำแพง · เกณฑ์ชั่วคราว ≤ 0.08 = "ผ่าน Δ5" (จากแบ็กเทส tick-rule ต.ค. ยังไม่ใช่ volume จริง) · ยังไม่ใช้ตัดไม้ แค่บันทึก
  const FP_WIN = 5 * 60, FP_MAX = 0.08, fp = new Map();
  async function fpFetch(s) {
    const id = key(s); if (fp.has(id)) return; fp.set(id, null);
    const end = (s.t0 - 7 * 3600) * 1000, start = end - FP_WIN * 1000; let buy = 0, sell = 0, n = 0, from = null;
    try {
      for (let g = 0; g < 30; g++) {
        const u = from === null ? `https://fapi.binance.com/fapi/v1/aggTrades?symbol=XAUUSDT&startTime=${start}&endTime=${end - 1}&limit=1000` : `https://fapi.binance.com/fapi/v1/aggTrades?symbol=XAUUSDT&fromId=${from}&limit=1000`;
        const j = await (await fetch(u, { cache: 'no-store' })).json(); if (!Array.isArray(j)) throw new Error(j.msg || 'bad');
        let done = j.length < 1000;
        for (const t of j) { if (t.T >= end) { done = true; break; } if (t.T < start) continue; const q = +t.q; if (t.m) sell += q; else buy += q; n++; }
        if (done || !j.length) break; from = j[j.length - 1].a + 1;
      }
      const tot = buy + sell, push = tot ? -s.dir * (buy - sell) / tot : null;
      fp.set(id, { buy: Math.round(buy * 100) / 100, sell: Math.round(sell * 100) / 100, n, push: push === null ? null : Math.round(push * 1000) / 1000, pass: push !== null && push <= FP_MAX });
    } catch (e) { fp.set(id, { err: String(e.message || e) }); }
  }

  // ---------- IV ตอนเข้าไม้ (V4.9.85, เก็บข้อมูล forward test แยกชุด) ----------
  // ATM IV ของสัญญาวันนั้น จากประวัติที่ป้าย IV เก็บในเครื่องทุก 5 นาที (localStorage oi_iv_hist2) + ค่าสดตอนเกิดไม้
  // d1 / d3 = IV เปลี่ยนใน 1 / 3 ชม. ก่อนแตะ (จุด %) · แบ็กเทส 28 ไม้: IV ขึ้น > +1.8 ใน 3 ชม. แย่สุด · ยังไม่ใช้ตัดไม้ แค่บันทึก
  const IV_D3_MAX = 1.8, ivs = new Map();
  function ivHist() { try { const h = JSON.parse(localStorage.getItem('oit_iv_hist2') || '{}') || {}; return Object.values(h).flat().filter(x => Array.isArray(x) && x[1] > 0).sort((a, b) => a[0] - b[0]); } catch (e) { return []; } }
  function ivSnap(s) {
    const id = key(s); if (ivs.has(id)) return;
    const ms = (s.t0 - 7 * 3600) * 1000, H = ivHist();
    const at = (t, tol) => { let b = null; for (const h of H) { if (h[0] <= t) b = h; else break; } return b && t - b[0] <= tol ? b[1] : null; };
    let iv = at(ms, 15 * 60e3); const R = window.OI_iv && window.OI_iv.result;
    if (iv === null && R && R.iv > 0 && Date.now() - ms < 10 * 60e3) iv = R.iv; // ไม้เพิ่งเกิด ใช้ค่าสด
    if (iv === null) return; // ไม่มีข้อมูล IV ช่วงนั้นในเครื่อง → ไม่บันทึก (ลองใหม่รอบหน้า)
    const i1 = at(ms - 3600e3, 20 * 60e3), i3 = at(ms - 3 * 3600e3, 30 * 60e3), r1 = x => Math.round(x * 1000) / 10;
    ivs.set(id, { iv: r1(iv), d1: i1 === null ? null : r1(iv - i1), d3: i3 === null ? null : r1(iv - i3) });
  }

  // ---------- โมเมนตัมสด: ราคากำลังพุ่งเข้าหาเส้นไหน (ใช้แท่งที่ปิดแล้ว) ----------
  function liveMom() {
    const n = bars.length; if (n < ATR_N + MOM_N + 3) return null; // V4.9.80: คิดได้แม้ไม่มีเส้น (ตลาดปิด)
    const A = atrArr(bars), i = n - 1, a = A[i]; if (!(a > 0)) return null;
    const mvDown = (bars[i - 1 - MOM_N].close - bars[i - 1].close) / a, P = bars[i - 1].close;
    const dn = mvDown > 0, mv = Math.abs(mvDown);
    // เส้นข้างหน้าในทิศที่ราคากำลังวิ่ง (ภายใน $15)
    const ahead = lv.filter(z => dn ? z.p < P : z.p > P).sort((x, y) => Math.abs(x.p - P) - Math.abs(y.p - P))[0];
    return { mv: Math.round(mv * 10) / 10, usd: Math.round(Math.abs(bars[i - 1].close - bars[i - 1 - MOM_N].close) * 10) / 10, dn, z: ahead && Math.abs(ahead.p - P) <= 15 ? ahead : null };
  }

  // ---------- ป้ายสถานะ ----------
  // ป้ายโมเมนตัม หน้าสุดของแถบป้าย (โชว์ค้างตลอดเมื่อเปิดอินดี้) · ≤2×ATR เทา · 2–3× เหลือง · >3× แดง (Asia เช้า = ข้ามไม้ตามกฎ v0.5)
  let lastMom = null;
  (window.OIBadgeExtra = window.OIBadgeExtra || []).push(() => {
    if (!isOn() || !bars.length) return null;
    const m = liveMom() || lastMom; if (!m) return ['⚡ โมเมนตัม –', '#8fa3c8', 'sfmom', null, 'first'];
    lastMom = m;
    const open = fresh(), S = open ? sessOf(bars[bars.length - 1].time) : null, hot = m.mv > MOM_MAX, warm = m.mv > 2;
    const t = `⚡ ${m.dn ? 'ลง' : 'ขึ้น'} ${m.mv}×ATR (${m.usd}$/5น.)${m.z ? ` → ${m.z.side}${m.z.k}` : ''}${!open ? ' · ตลาดปิด' : hot && S && S.mom ? ' · ข้ามไม้' : ''}`;
    return [t, hot ? '#ff3b5c' : warm ? '#e0b44c' : '#8fa3c8', 'sfmom', hot && open ? 'rgba(255,59,92,.18)' : null, 'first'];
  });
  (window.OIBadgeExtra = window.OIBadgeExtra || []).push(() => {
    if (!isOn() || !fresh()) return null;
    const open = today.filter(s => s.real && s.st === 3);
    if (open.length) { const s = open[open.length - 1]; return [`🌏 ${s.dir > 0 ? 'BUY' : 'SELL'} ${s.entry.toFixed(1)} SL ${s.sl.toFixed(1)} TP${cfg.rr}R ${s.tp.toFixed(1)}`, s.dir > 0 ? '#22e39a' : '#ff8a3d', 'sfade']; }
    const S = sessOf(bars[bars.length - 1].time);
    if (S && S.real && lv.length) return [`🌏 ${S.lab} · รอแตะ ${lv.length} เส้น`, '#7fd0ff', 'sfade'];
    return null;
  });

  // ---------- เมนู ƒx ----------
  // สรุปผลของ RR ที่ระบุ (ไม่ส่ง = RR ที่เลือก) · ไม้ที่ยังไม่จบไม่นับ
  function sum(list, rr) {
    const d = list.map(s => s.v[rr || cfg.rr]).filter(v => v && v.st >= 4), w = d.filter(v => v.pnl > 0).length, usd = d.reduce((a, v) => a + v.pnl, 0), r = d.reduce((a, v) => a + v.res, 0);
    const gp = d.filter(v => v.pnl > 0).reduce((a, v) => a + v.pnl, 0), gl = -d.filter(v => v.pnl < 0).reduce((a, v) => a + v.pnl, 0);
    return { n: d.length, w, usd, r, wr: d.length ? Math.round(w / d.length * 100) : 0, pf: gl ? gp / gl : (gp ? Infinity : 0), open: list.length - d.length };
  }
  const fmt = x => `${x.n} ไม้ · ชนะ ${x.wr}% · ${x.usd > 0 ? '+' : ''}${x.usd.toFixed(1)}$ · PF ${isFinite(x.pf) ? x.pf.toFixed(2) : '∞'}${x.open ? ` · ค้าง ${x.open}` : ''}`;
  function stats() {
    const real = setups.filter(s => s.real), nd = days.length, n5 = days.filter(d => d.tf === 'M5').length;
    const r1 = real.filter(s => s.tf === 'M1'), tr = today.filter(s => s.real);
    const dd = days.filter(d => d.tf === 'M1').map(d => d.day).sort(), rng = dd.length ? ` (${dd[0].slice(5)} → ${dd[dd.length - 1].slice(5)})` : '';
    const lines = [`<b>แบ็กเทส M1 ${nd - n5} วัน${rng} · ถือจน SL/TP</b>`];
    RRS.forEach(rr => lines.push(`${rr === cfg.rr ? '▶ ' : ''}<b>RR ${rr}</b>: ${fmt(sum(r1, rr))}<br><span style="opacity:.75">&nbsp;&nbsp;Asia เช้า ${fmt(sum(r1.filter(s => s.S.id === 'AM'), rr))}<br>&nbsp;&nbsp;London ${fmt(sum(r1.filter(s => s.S.id === 'LDN'), rr))}</span>`));
    lines.push(`วันนี้: ${tr.length ? RRS.map(rr => { const x = sum(tr, rr); return `RR${rr} ${x.usd > 0 ? '+' : ''}${x.usd.toFixed(1)}$${x.open ? ` (ค้าง ${x.open})` : ''}`; }).join(' · ') : (bars.length && Date.now() / 1000 + 7 * 3600 - bars[bars.length - 1].time >= 3 * 3600 ? 'ตลาดปิด' : 'ยังไม่มีไม้จริง')}`);
    const f1 = setups.filter(s => s.fast && s.tf === 'M1'); if (f1.length) lines.push(`<span style="color:#ff6b82">⚡ กรองพุ่ง >${MOM_MAX}×ATR (Asia เช้า) ไม้ที่ข้าม: ${RRS.map(rr => { const x = sum(f1, rr); return `RR${rr} ${x.usd > 0 ? '+' : ''}${x.usd.toFixed(0)}$`; }).join(' · ')}</span>`);
    if (n5) lines.push(`<span style="opacity:.7">อีก ${n5} วันไม่มีแท่ง M1 ครบ: วาดจาก M5 เป็นกรอบจาง ≈ ไว้ดูตำแหน่งเท่านั้น ไม่คิดผล</span>`);
    if (cfg.paper) { const pp = setups.filter(s => !s.real && !s.fast && s.tf === 'M1');
      lines.push(`ไม้บันทึก M1 (กฎไม่เข้า): ${RRS.map(rr => { const x = sum(pp, rr); return `RR${rr} ${x.usd > 0 ? '+' : ''}${x.usd.toFixed(0)}$`; }).join(' · ')}`); }
    if (histMsg) lines.push(histMsg); else if (!hist.size) lines.push('ยังไม่มี OI ย้อนหลัง (ต้องเข้าสู่ระบบ)');
    return lines.join('<br>') + `<br><small>หลายไม้ซ้อนกันได้ · ย้อนหลังได้เท่าวันที่มี OI ในชีต (${hist.size ? [...hist.keys()].sort()[0].slice(5) : '–'} เป็นต้นไป) · ยังไม่หักสเปรด · ย้อนหลังเป็นเกรด B ทั้งหมด</small>`;
  }
  function section() {
    const d = document.createElement('div'); d.id = 'sfBox'; d.className = 'gsbox';
    d.innerHTML = `<div class="row"><button class="gsb${isOn() ? ' on' : ''}" data-sf="on"><i style="background:#7fd0ff"></i>🌏 OI Session Fade v0.6</button><span class="gsinfo">${isOn() ? '' : 'Asia เช้า + London สวนกำแพง OI'}</span></div>` + (isOn() ? `<div class="row ps"><span class="gsinfo" style="display:block;line-height:1.55;white-space:normal">${stats()}</span></div>` : '') +
      (isOn() ? `<div class="row ps"><button class="gsb${cfg.paper ? ' on' : ''}" data-sf="paper">แสดงไม้บันทึก (forward test)</button><button class="gsb" data-sf="reload">↻ โหลดแบ็กเทสใหม่</button></div><div class="row ps"><span class="gsinfo">TP บนกราฟ:</span>${RRS.map(rr => `<button class="gsb${cfg.rr === rr ? ' on' : ''}" data-sf="rr" data-rr="${rr}">RR ${rr}</button>`).join('')}</div>` : '');
    return d;
  }
  function mount() { const m = $('indMenu'); if (!m || m.hidden || $('sfBox')) return; const box = section(), anchor = $('s3Box') || $('dhBox') || $('btBox') || m.querySelector('.t'); anchor ? anchor.after(box) : m.prepend(box); }
  const menu = $('indMenu');
  if (menu) {
    new MutationObserver(() => mount()).observe(menu, { childList: true });
    menu.addEventListener('click', e => {
      const a = e.target.closest('[data-sf]'); if (!a) return;
      if (a.dataset.sf === 'on') cfg.on = !isOn(); else if (a.dataset.sf === 'rr') { cfg.rr = +a.dataset.rr; setups.forEach(view); } else if (a.dataset.sf === 'reload') { histAt = 0; m1Cache.forEach((v, k) => { if (!v) m1Cache.delete(k); }); } else cfg.paper = !cfg.paper;
      save(); O.markDirty(); const b = $('sfBox'); if (b) b.remove(); mount(); run(true);
    });
  }
  if (window.OIAlerts) OIAlerts.reg('sfade', '🌏 OI Session Fade (เข้า/ออกไม้จริง)', { desc: 'Asia เช้า + London · เตือนตอนแตะกำแพงแล้วเข้าไม้ และตอนถึง TP/SL', active: isOn });
  window.OI_sfade = { RRS, view, stats, scan, fpOf: s => fp.get(key(s)), FP_MAX, _fpFetch: fpFetch, ivOf: s => ivs.get(key(s)), IV_D3_MAX, _ivSnap: ivSnap, levels, sessOf, dayStart, run, get setups() { return setups; }, get today() { return today; }, get days() { return days; }, get bars() { return bars; }, get levels_() { return lv; }, get cfg() { return cfg; }, isOn };
})();

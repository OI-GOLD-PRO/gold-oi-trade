// 🌏 OI Session Fade v0.5 — สวนกำแพง OI ตามช่วงตลาด (จากแบ็กเทส 12 ต.ค.–6 พ.ย. 2026)
//  v0.5: Asia เช้า ข้ามไม้ที่ราคาพุ่งเข้าโซนเกิน 3×ATR ใน 5 แท่ง M1 ก่อนแตะ (ATR = ค่าเฉลี่ย True Range 60 แท่ง) → เป็นไม้บันทึก (กรองพุ่ง)
//  เส้น: Call OI 3 อันดับ + Put OI 3 อันดับ ของสัญญาวันนี้ ในระยะ ±$60 จากราคาตอน 06:00 · เกรด A = strike ติด top 3 volume Call หรือ Put
//  ตั้งรอ: แท่ง M1 ปิดห่างขอบโซน ≥ $3 (เหนือ = รอ BUY / ใต้ = รอ SELL) → แตะขอบใกล้ = เข้า limit ที่ขอบใกล้ · นับครั้งแตะใหม่ทุกช่วงตลาด
//  SL = ขอบไกล ∓ $3 · v0.6: TP คิด 3 แบบพร้อมกัน RR 1 / 1.6 / 5 ถือจนโดน SL หรือถึง TP (ไม่มีเวลาปิด) · ข่าวแดง USD: ไม่เข้า −30/+90 นาที
//  ไม้จริง: Asia เช้า 06:00–10:00 โซน ±2 แตะครั้งที่ 1–2 (เกรด A ถึง 3) · London 14:00–19:30 โซน ±1.5 แตะครั้งที่ 1
//  ที่เหลือ (แตะครั้งอื่น / Asia สาย / NY) = ไม้บันทึก ไว้ forward test เทียบ ไม่ใช่สัญญาณเข้า
//  V4.9.94 + NY เบรก 19:30–23:00: M5 ปิดพ้นขอบโซน ≥ $2 → เข้าตามทิศเบรก · SL ขอบอีกฝั่งของโซน · ไม่เข้าช่วงข่าว · ไม้จริง (แนะนำ RR 1)
(() => {
  'use strict';
  const O = window.OI;
  if (!O || !O.hooks || !(O.sym === 'gold' || O.sym === 'gcy')) return;
  const $ = id => document.getElementById(id);
  const KEY = 'oit_sfade' + (O.psfx || '');
  const cfg = { on: null, rr: 1 }; // rr = TP ที่ใช้แสดงบนกราฟ/ป้าย/แจ้งเตือน (คิดครบทั้ง 3 ค่าเสมอ) // on = null → ยังไม่เคยตั้ง: เปิดให้รหัสไม่จำกัดวันที่ไม่ใช่เครื่องใหม่
  try { Object.assign(cfg, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch (e) {}
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch (e) {} };
  const isOn = () => cfg.on === null ? true : !!cfg.on;

  const ARM = 3, SLB = 3, RRS = [1, 1.6, 5], RANGE = 60, BO_BUF = 2, BO = { id: 'NYB', lab: 'NY เบรก', a: 1170, b: 1380, half: 1.5, real: 1 } /* V4.9.94 NY เบรกเอาท์ 19:30–23:00 */, MOM_N = 5, ATR_N = 60, MOM_MAX = 3, NB = 30 * 60, NA = 90 * 60, NCLOSE = 5 * 60;
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
    for (let i = 0; opt.fade !== false && i < n; i++) {
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
    // V4.9.94 เบรกเอาท์ช่วง NY เปิด 19:30–23:00: แท่ง M5 ปิดพ้นขอบโซน ≥ $2 (M5 ก่อนหน้ายังไม่พ้นขอบนั้น) → เข้าราคาปิด M5 ที่แท่งถัดไป
    //   ครั้งแรกต่อเส้นต่อวัน (ช่วงข่าวแดง −30/+90 นาที = ข้าม แต่นับว่าใช้เส้นไปแล้ว) · SL = ขอบอีกฝั่งของโซน (บันทึกแบบ SL กลางโซนไว้เทียบด้วย)
    if (opt.bo !== false) {
      const mod5 = t => Math.floor(t / 300), byDay = new Map();
      for (let i = 0; i < n; i++) {
        const b = B[i]; if (b.time < from || b.time >= until) continue;
        const m = mod(b.time); if (m < BO.a || m >= BO.b) continue;
        if (i + 1 < n && mod5(B[i + 1].time) === mod5(b.time)) continue; // ยังไม่จบแท่ง M5
        const dk = dayStart(b.time); let D = byDay.get(dk); if (!D) { D = { prev: new Map(), done: new Set() }; byDay.set(dk, D); }
        const k = i + 1; if (k >= n || mod(B[k].time) >= BO.b || mod(B[k].time) < BO.a) { L.forEach(z => D.prev.set(z.k, b.close)); continue; }
        L.forEach(z => {
          const lo = z.p - BO.half, hi = z.p + BO.half, pv = D.prev.get(z.k); D.prev.set(z.k, b.close);
          if (pv === undefined || D.done.has(z.k)) return;
          const dir = b.close > hi + BO_BUF && pv <= hi ? 1 : b.close < lo - BO_BUF && pv >= lo ? -1 : 0; if (!dir) return;
          D.done.add(z.k); if (inNews(B[k].time)) return;
          const entry = b.close, slE = dir > 0 ? lo : hi, slM = z.p;
          out.push({ z, S: BO, dir, k: 1, bo: true, real: true, fast: false, mv: null, atr: ATR[k] > 0 ? ATR[k] : null, ei: k, entry,
            sl: Math.abs(entry - slE) >= 1 ? slE : entry - dir * 1, slMid: Math.abs(entry - slM) >= 1 ? slM : entry - dir * 1, brk: Math.round((entry - (dir > 0 ? hi : lo)) * dir * 100) / 100, st: 3 });
        });
      }
    }
    return trackSetups(B, out);
  }

  const hitsStop = (bar, dir, sl) => dir > 0 ? bar.low <= sl : bar.high >= sl;
  const chartStops = new Map(), hitTimes = new Map();

  function trackSetups(B, out, stopBars) {
    const n = B.length;
    // TP 1R / 1.6R / 5R · แท่งเข้า Fade เช็ก SL อย่างเดียว · SL ก่อน TP
    out.forEach(s => {
      s.R = Math.abs(s.entry - s.sl); s.t0 = B[s.ei].time; s.v = {};
      const chartStop = stopBars && s.real ? stopBars : null;
      const hitKey = chartStop ? s.key + '|' + s.t0 : null;
      const track = (sl, R, rr) => {
        const savedHit = hitKey ? hitTimes.get(hitKey) : undefined;
        const tp = s.entry + s.dir * rr * R, v = { rr, tp, st: 3 };
        for (let j = s.ei; j < n; j++) {
          const b = B[j];
          const chartBar = chartStop?.get(b.time);
          if (savedHit === b.time || (savedHit === undefined && hitsStop(chartBar || b, s.dir, sl))) {
            if (chartBar && savedHit === undefined) hitTimes.set(hitKey, b.time);
            Object.assign(v, { st: 5, end: j, exit: sl, why: 'SL' });
            break;
          }
          if ((j > s.ei || s.bo) && (s.dir > 0 ? b.high >= tp : b.low <= tp)) { Object.assign(v, { st: 4, end: j, exit: tp, why: 'TP' }); break; } // เบรกเอาท์เข้าที่ราคาปิดแท่งก่อน → TP นับตั้งแต่แท่งแรก
        }
        v.t1 = v.end !== undefined ? B[v.end].time : null;
        if (v.exit !== undefined) { v.pnl = Math.round((v.exit - s.entry) * s.dir * 100) / 100; v.res = Math.round(v.pnl / R * 100) / 100; }
        return v;
      };
      RRS.forEach(rr => { s.v[rr] = track(s.sl, s.R, rr); });
      if (s.bo) { s.vAll = s.v; s.v = {}; RRS.forEach(rr => { s.v[rr] = s.vAll[1]; }); } // V4.9.95: NY เบรกใช้ TP RR 1 เสมอ (ทุกปุ่ม RR / ทุกสรุป) · ผล RR อื่นเก็บใน vAll ไว้บันทึกชุด NY Breakout
      if (s.bo) { const Rm = Math.abs(s.entry - s.slMid); s.vm = {}; RRS.forEach(rr => { s.vm[rr] = track(s.slMid, Rm, rr); }); } // แบบ SL กลางโซน (บันทึกเทียบ)
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
  const THAI = 7 * 3600;
  let shared = null, sharedHistAt = 0;
  const sharedHist = new Map();
  async function loadShared() {
    try {
      const r = await fetch(O.worker + '/osf/v1', { cache: 'no-store', signal: AbortSignal.timeout(12000) });
      if (!r.ok) return;
      const s = await r.json();
      if (s.version === 1 && Array.isArray(s.bars) && Array.isArray(s.events) && Array.isArray(s.levels) && Array.isArray(s.plans)) shared = s;
    } catch (e) {}
  }
  async function loadSharedHist() {
    if (Date.now() - sharedHistAt < 30 * 60e3) return;
    sharedHistAt = Date.now();
    const get = async q => {
      const r = await fetch(O.worker + '/osf/v1?' + q, { signal: AbortSignal.timeout(12000) });
      if (!r.ok) throw Error(r.status);
      return r.json();
    };
    try {
      const { days } = await get('view=history');
      for (const day of days) {
        if (sharedHist.has(day)) continue;
        const s = await get('day=' + day);
        if (s.day === day && Array.isArray(s.bars) && Array.isArray(s.events)) sharedHist.set(day, s);
      }
    } catch (e) { sharedHistAt = Date.now() - 29 * 60e3; }
  }
  const entryMismatches = new Map();
  function validateFadeEntry(s, centralBar, chartBar, live) {
    if (s.bo) return null; // Breakout uses the preceding close, not a limit touch.
    const usable = b => b && Number.isFinite(b.low) && Number.isFinite(b.high);
    const touches = b => usable(b) && Number.isFinite(s.entry) && b.low <= s.entry + 1e-7 && b.high >= s.entry - 1e-7;
    if (!touches(centralBar)) return 'แท่งระบบกลางไม่แตะราคาเข้า';
    if (usable(chartBar) && !touches(chartBar)) return 'แท่งกราฟไม่แตะราคาเข้า';
    if (live && !usable(chartBar)) return 'ยังไม่มีแท่งกราฟยืนยันราคาเข้า';
    return null;
  }
  function sharedTrades(book, follow = [], live = false) {
    if (!book?.day) return [];
    const B = book.bars.concat(follow).map(([t, open, high, low, close]) => ({ time: t + THAI, open, high, low, close }));
    if (live && B.length) {
      const last = B.at(-1).time;
      // แท่งกราฟที่ระบบกลางยังไม่ปิด ใช้เช็ก SL ได้ทันที
      for (const time of [...chartStops.keys()].filter(t => t > last).sort((a, b) => a - b)) B.push({ time });
    }
    const indexes = new Map(B.map((b, i) => [b.time, i]));
    for (const [id, item] of entryMismatches) if (item.day === book.day) entryMismatches.delete(id);
    const trades = book.events.flatMap(s => {
      const S = SESS.find(x => x.id === s.sid), ei = indexes.get(s.t + THAI);
      if (!S || ei === undefined) return [];
      const reason = validateFadeEntry(s, B[ei], chartStops.get(s.t + THAI), live);
      if (reason) {
        entryMismatches.set(book.day + '|' + s.key, { day: book.day, time: s.t + THAI, entry: s.entry, reason });
        return [];
      }
      return [{ ...s, S, ei, tf: 'M1', live, central: true, day: ymd(book.day + THAI) }];
    });
    return trackSetups(B, trades, chartStops);
  }
  const sharedReady = () => !!(shared?.ready && shared.until > Date.now() / 1000);
  // V4.9.102: กะพริบโซนที่ราคาใกล้ขอบเข้า (≤ NEAR $) — วาดใหม่ทุก 100 ms เฉพาะตอนมีโซนกะพริบ
  const NEAR = 0.5; let nearZones = [];
  setInterval(() => { if (nearZones.length && isOn()) O.markDirty(); }, 100);

  let setups = [], today = [], bars = [], lv = [], days = [], lastRun = 0, busy = false;
  async function run(force) {
    if (!isOn() || busy) return;
    if (!force && Date.now() - lastRun < 18000) return;
    busy = true; lastRun = Date.now();
    try {
      void loadSharedHist();
      let [A1, A5] = await Promise.all([O.fetchTF('1m', 6000), O.fetchTF('5m', 1500), loadShared(), loadHist()]);
      const liveDay = dayStart(Date.now() / 1000 + THAI);
      if ((!A1 || A1.length < 300) && O.fetchHist) { const h = await O.fetchHist('1m', Date.now() - 3.5 * 86400e3, Date.now() + 60e3); if (h && h.length > 300) A1 = h; } // เสาร์-อาทิตย์
      chartStops.clear();
      for (const b of A1 || []) chartStops.set(b.time, b);
      for (const b of O.chartM1?.() || []) chartStops.set(b.time, b);
      for (const [id, time] of hitTimes) if (time < liveDay - HIST_DAYS * 86400) hitTimes.delete(id);
      const confirmed = shared?.day + THAI === liveDay ? sharedTrades(shared, [], true) : [];
      const archive = [...sharedHist.values(), ...(shared?.day && shared.day + THAI !== liveDay && !sharedHist.has(shared.day) ? [shared] : [])]
        .sort((a, b) => a.day - b.day).slice(-HIST_DAYS);
      const books = archive.concat(shared?.day + THAI === liveDay ? [shared] : []);
      const archived = archive.flatMap(book => sharedTrades(book, books.filter(x => x.day > book.day && x.day < book.day + 86400 + TRACK)
        .flatMap(x => x.bars.filter(b => b[0] >= book.day + 86400 && b[0] < book.day + 86400 + TRACK))));
      const archivedDays = new Set(archive.map(b => ymd(b.day + THAI)));
      if (A1 && A1.length > 30) {
        const d0 = dayStart(A1[A1.length - 1].time), oldKeys = new Set(today.map(key));
        // วันนี้: M1 + OI สด (มีเกรด A จาก volume)
        const i0 = A1.findIndex(b => b.time >= d0);
        // V4.9.78: ตลาดปิด/ข้อมูลเก่า (แท่งล่าสุดเกิน 3 ชม.) → OI สดในแอปเป็นสัญญาณถัดไปแล้ว ใช้ไม่ได้กับแท่งวันนั้น → คิดวันนั้นจาก OI ย้อนหลังแทน
        const live = Date.now() / 1000 + 7 * 3600 - A1[A1.length - 1].time < 3 * 3600;
        bars = i0 >= 0 ? A1.slice(Math.max(0, i0 - ATR_N - 10)) : []; // +70 แท่งก่อน 06:00 ไว้คำนวณ ATR
        const localLevels = i0 >= 0 && live ? levels(A1[i0].open) : [];
        lv = shared?.day + THAI === d0 ? shared.levels : [];
        today = confirmed.concat(bars.length && live ? scan(bars, localLevels, news, { from: d0, fade: false }).map(s => Object.assign(s, { day: ymd(d0), tf: 'M1', live: true })) : []);
        // ย้อนหลัง: วันที่มี OI ในชีต · ใช้ M1 ถ้ามีครบวัน ไม่งั้น M5 (ประมาณ) · เกรด A ย้อนหลังไม่มี (ไม่มี volume รายวัน) = เกรด B ทั้งหมด
        const past = archived, dl = archive.map(b => ({ day: ymd(b.day + THAI), tf: 'M1', n: b.events.length }));
        if (live && !archivedDays.has(ymd(d0))) dl.push({ day: ymd(d0), tf: 'M1', n: today.length });
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
          const r = scan(B, L, news, { from: ds, until: de, fade: !archivedDays.has(dt) }).map(s => Object.assign(s, { day: dt, tf: m1 ? 'M1' : 'M5' }));
          past.push(...r);
          if (!archivedDays.has(dt)) dl.push({ day: dt, tf: m1 ? 'M1' : 'M5', n: r.length });
        }
        setups = past.concat(today); days = dl;
        const o06 = i0 >= 0 ? A1[i0].open : null;
        today.filter(s => s.real && !s.bo).forEach(s => { if (!fp.has(key(s))) fpFetch(s); ivSnap(s); gxSnap(s, o06); }); // ชุด Δ5/IV/GEX เก็บเฉพาะไม้สวนกำแพง // Δ5 ฟุตปริ้นท์ + IV + gmf/EM ของไม้จริงวันนี้
        notify(oldKeys); O.markDirty();
      } else {
        const oldKeys = new Set(today.map(key));
        today = confirmed;
        lv = shared?.levels || [];
        setups = setups.filter(s => !s.live && !s.central).concat(archived, today);
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
      const recent = (t, i) => s.central ? Date.now() / 1000 + THAI - t < 180 : n - 1 - i <= 2;
      if (recent(s.t0, s.ei) && !told.has('e' + k) && !old.has(k)) {
        told.add('e' + k);
        alertMsg(`🌏 <b>${s.dir > 0 ? 'BUY' : 'SELL'} ${s.entry.toFixed(2)}</b> · ${s.S.lab} · ${s.z.side}${s.z.k} ${s.bo ? `เบรก M5 +${s.brk}$` : `เกรด ${s.z.grade} · แตะครั้งที่ ${s.k}`}<br>SL ${s.sl.toFixed(2)} · ${s.bo ? `TP RR1 ${s.v[1].tp.toFixed(2)}` : `TP RR1 ${s.v[1].tp.toFixed(2)} · RR1.6 ${s.v[1.6].tp.toFixed(2)} · RR5 ${s.v[5].tp.toFixed(2)}`}`);
      }
      if (s.st >= 4 && s.end !== undefined && recent(s.t1, s.end) && !told.has('x' + k)) {
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
  function checkChartStops() {
    if (shared?.day + THAI !== dayStart(Date.now() / 1000 + THAI)) return;
    const active = today.filter(s => s.central && s.real && RRS.some(rr => s.v[rr].st === 3));
    if (!active.length) return;
    const tail = O.chartM1?.(2) || [];
    for (const b of tail) chartStops.set(b.time, b);
    if (!active.some(s => tail.some(b => b.time >= s.t0 && hitsStop(b, s.dir, s.sl)))) return;
    const next = new Map(sharedTrades(shared, [], true).map(s => [s.key, s]));
    const refresh = s => s.live && s.central ? next.get(s.key) : s;
    today = today.map(refresh).filter(Boolean);
    setups = setups.map(refresh).filter(Boolean);
    notify(new Set(today.map(key)));
  }

  // Shared geometry keeps the background fills aligned with foreground price lines.
  function tradeGeometry(s, X, Y, plotW, bw, lastT) {
    // V4.9.80: แท่งเข้าไม่อยู่ในกราฟ (เลื่อนเกิน/ข้อมูลกราฟไม่ถึง) = ไม่วาด · แท่งออกไม่อยู่ในกราฟ: ไม้เปิดอยู่ = ถึงขอบขวา, ไม้จบแล้ว = ไม่วาด (เดิมยืดเต็มจอ ทับกันทั้งกราฟ)
    const exitX = s.t1 !== null ? X(s.t1) : null;
    const x0 = X(s.t0);
    let x1 = s.t1 !== null ? exitX : X(lastT || s.t0);
    if (x0 === null) return null;
    if (x1 === null) { if (s.t1 !== null) return; x1 = plotW; }
    x1 = Math.max(x1 + (exitX === null ? bw : bw / 2), x0 + 6); if (x1 < 0 || x0 > plotW) return;
    const ye = Y(s.entry), yt = Y(s.tp), ys = Y(s.sl); if (ye === null || yt === null || ys === null) return;
    const a = s.tf === 'M5' ? 0.75 : 1;
    return { x0, x1, exitX, ye, yt, ys, a };
  }
  let requestTradeFillUpdate = () => {};
  let tradeFillSignature = '';
  const tradeFillRenderer = {
    draw(target) {
      if (!isOn()) return;
      target.useMediaCoordinateSpace(({ context: ctx, mediaSize }) => {
        const ts = O.chart.timeScale(), X = t => ts.timeToCoordinate(toChart(t));
        const Y = p => O.series.priceToCoordinate(p), lastT = bars.length ? bars[bars.length - 1].time : null;
        const bw = Math.max(2, (X(lastT || 0) || 0) - (X((lastT || 0) - csec()) || 0));
        ctx.save(); ctx.beginPath(); ctx.rect(0, 0, mediaSize.width, mediaSize.height); ctx.clip();
        setups.filter(s => s.real).forEach(s => {
          const g = tradeGeometry(s, X, Y, mediaSize.width, bw, lastT); if (!g) return;
          const { x0, x1, ye, yt, ys, a } = g;
          ctx.globalAlpha = 0.32 * a;
          ctx.fillStyle = '#22e39a'; ctx.fillRect(x0, Math.min(ye, yt), x1 - x0, Math.abs(yt - ye));
          ctx.fillStyle = '#ff4d6a'; ctx.fillRect(x0, Math.min(ye, ys), x1 - x0, Math.abs(ys - ye));
        });
        ctx.restore();
      });
    },
  };
  const tradeFillViews = [{ zOrder: () => 'bottom', renderer: () => tradeFillRenderer }];
  if (typeof O.series.attachPrimitive === 'function') {
    O.series.attachPrimitive({
      attached({ requestUpdate }) { requestTradeFillUpdate = requestUpdate; requestUpdate(); },
      detached() { requestTradeFillUpdate = () => {}; },
      paneViews() { return tradeFillViews; },
    });
  }

  const entryTargets = [];
  const details = $('sfDetails');
  if (details) window.bindRightSwipeDismiss?.(details, () => details.close());
  if (details) O.chart.subscribeClick(({ point }) => {
    if (!isOn() || O.drawingActive || !point || details.open) return;
    let selected = null, distance = 15;
    entryTargets.forEach(({ s, x, y, label }) => {
      const hit = Math.hypot(point.x - x, point.y - y);
      const labelHit = label && point.x >= label.left && point.x <= label.right && Math.abs(point.y - label.y) <= 8;
      const d = labelHit ? 0 : hit;
      if (d <= distance) { selected = s; distance = d; }
    });
    if (!selected) return;
    const s = selected, buy = s.dir > 0, rr = s.bo ? 1 : cfg.rr;
    const price = p => p.toFixed(2);
    const status = s.bo ? 'ผ่านกฎเข้าไม้' : 'ครั้งที่แตะอยู่ในเกณฑ์ของช่วงตลาด และผ่านตัวกรองข่าวแดง USD';
    $('sfDetailsTitle').textContent = `${buy ? 'BUY' : 'SELL'} ${price(s.entry)} · ${s.S.lab}`;
    $('sfDetailsZone').textContent = `${s.z.side === 'C' ? 'Call' : 'Put'} OI ${s.z.k} · เกรด ${s.z.grade} · ${price(s.z.p - s.S.half)}–${price(s.z.p + s.S.half)}`;
    $('sfDetailsReason').textContent = s.bo
      ? `M5 ปิดเบรก${buy ? 'เหนือขอบบน' : 'ใต้ขอบล่าง'} $${s.brk.toFixed(2)} เป็นเบรกแรกของโซนในวันนั้น และผ่านตัวกรองข่าวแดง USD`
      : `${s.tf} ปิดห่างขอบโซนเกิน $3 แล้วราคากลับมาแตะครั้งที่ ${s.k} จาก${buy ? 'ด้านบน' : 'ด้านล่าง'} จึงจำลองเข้า Limit ที่ขอบใกล้`;
    $('sfDetailsStatus').textContent = [status, s.mv !== null ? `โมเมนตัมก่อนแตะ ≈ ${s.mv}×ATR` : '', s.central ? `รหัสกลาง ${s.key}` : '', s.tf === 'M5' ? 'ตำแหน่งย้อนหลังโดยประมาณ' : ''].filter(Boolean).join(' · ');
    $('sfDetailsRisk').textContent = `SL ${price(s.sl)} · TP ${rr}R ${price(s.v[rr].tp)}`;
    details.showModal();
  });
  O.hooks.push((ctx, w, h) => {
    entryTargets.length = 0;
    if (isOn()) checkChartStops();
    // Refresh on data/settings changes, including hiding the indicator; chart handles pan/zoom.
    const fillSignature = JSON.stringify([isOn(), O.tf, bars.length ? bars[bars.length - 1].time : null,
      setups.filter(s => s.real).map(s => [s.t0, s.t1, s.entry, s.tp, s.sl, s.tf])]);
    if (fillSignature !== tradeFillSignature) {
      tradeFillSignature = fillSignature; requestTradeFillUpdate();
    }
    if (!isOn()) return;
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
    // V4.9.90: โซนเกรด A = ขอบสีทองเข้ม (ทุกช่วงเวลา) · ความกว้างเท่าแถบโซน OI หลักตามช่วงเวลา
    {
      let LA = lv; if (!LA.length && O.lastClose != null) { const r0 = O.oi && O.oi.rows ? O.oi.rows.find(r => r.price != null) : null; LA = levels(O.lastClose - (r0 ? r0.price - r0.strike : 0)) || []; }
      const m = Math.floor(((Date.now() / 1000 + 7 * 3600) % 86400) / 60), zh = m >= 360 && m < 600 ? 2 : m >= 600 && m < 840 ? 1 : 1.5;
      LA.filter(z => z.grade === 'A').forEach(z => {
        const y1 = Y(z.p + zh), y2 = Y(z.p - zh); if (y1 === null || y2 === null || y2 < 0 || y1 > plotH) return;
        ctx.save(); ctx.strokeStyle = '#f2a900'; ctx.lineWidth = 2; ctx.shadowColor = 'rgba(242,169,0,.6)'; ctx.shadowBlur = 6;
        ctx.strokeRect(1, Math.round(y1) + .5, plotW - 2, Math.max(2, Math.round(y2 - y1)));
        ctx.shadowBlur = 0; ctx.fillStyle = '#f2a900'; ctx.textAlign = 'right'; ctx.fillText(`🌏A ${z.side}${z.k}`, plotW - 6, Math.round(y1) - 6); ctx.restore();
      });
    }
    // V4.9.102: โซนที่ระบบกลางตั้ง Limit ไม้จริงรออยู่ + ราคาห่างขอบเข้า ≤ $0.5 → กะพริบ · V4.9.103: อยู่ในกรอบแล้วกะพริบต่อ (หยุดเมื่อออกจากกรอบ/ถอยห่าง)
    nearZones = [];
    if (sharedReady() && shared.day + THAI === dayStart(Date.now() / 1000 + THAI) && shared.session === sessOf(Date.now() / 1000 + THAI)?.id && O.lastClose != null) { // Only current, unexpired OI SS execution plans may flash.
      const SN = SESS.find(x => x.id === shared.session);
      if (SN && SN.real) shared.plans.filter(q => q[5] === 1).forEach(q => {
        const [k, side, grade, dir, touch, , entry] = q, d = dir > 0 ? O.lastClose - entry : entry - O.lastClose;
        if (d < -2 * SN.half - 0.01 || d > NEAR) return; // V4.9.103: กะพริบต่อขณะราคาอยู่ในกรอบ (เดิมหยุดทันทีที่แตะ)
        nearZones.push(k);
        const y1 = Y(k + SN.half), y2 = Y(k - SN.half); if (y1 === null || y2 === null || y2 < 0 || y1 > plotH) return;
        const ph = (Math.sin(Date.now() / 800 * Math.PI) + 1) / 2, col = grade === 'A' ? '#f2a900' : '#7fd0ff';
        ctx.save();
        ctx.globalAlpha = 0.12 + 0.38 * ph; ctx.fillStyle = col; ctx.fillRect(0, y1, plotW, Math.max(2, y2 - y1));
        ctx.globalAlpha = 0.5 + 0.5 * ph; ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.strokeRect(1, Math.round(y1) + .5, plotW - 2, Math.max(2, Math.round(y2 - y1)));
        ctx.globalAlpha = 1; ctx.fillStyle = col; ctx.textAlign = 'center';
        ctx.fillText(`🌏 ${dir > 0 ? 'BUY' : 'SELL'} รอ ${entry.toFixed(1)} · ${side}${k} ครั้งที่ ${touch} · ${d < 0 ? 'ราคาอยู่ในกรอบ' : 'ห่าง ' + d.toFixed(2) + '$'}`, plotW / 2, dir > 0 ? Math.round(y1) - 7 : Math.round(y2) + 8);
        ctx.restore();
      });
    }
    // ไม้ (แบ็กเทส + วันนี้): กรอบ TP เขียว / SL แดง จากแท่งเข้าถึงแท่งออก (ยังเปิด = ถึงแท่งล่าสุด)
    const lastT = bars.length ? bars[bars.length - 1].time : null;
    setups.filter(s => s.real).forEach(s => {
      const g = tradeGeometry(s, X, Y, plotW, bw, lastT); if (!g) return;
      const { x0, x1, exitX, ye, yt, ys, a } = g;
      ctx.globalAlpha = a; ctx.lineWidth = 1.5;
      ctx.strokeStyle = '#22e39a'; ctx.beginPath(); ctx.moveTo(x0, yt); ctx.lineTo(x1, yt); ctx.stroke();
      ctx.strokeStyle = '#ff4d6a'; ctx.beginPath(); ctx.moveTo(x0, ys); ctx.lineTo(x1, ys); ctx.stroke();
      ctx.strokeStyle = '#7fd0ff'; ctx.beginPath(); ctx.moveTo(x0, ye); ctx.lineTo(x1, ye); ctx.stroke();
      // TP ของ RR อื่น = เส้นประจาง + ป้าย ✓/✗
      RRS.filter(rr => !s.bo && rr !== cfg.rr && s.v[rr]).forEach(rr => { const v = s.v[rr], y = Y(v.tp); if (y === null) return; ctx.save(); ctx.globalAlpha = 0.55 * a; ctx.setLineDash([3, 3]); ctx.strokeStyle = '#22e39a'; ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x1, y); ctx.stroke(); ctx.setLineDash([]); ctx.fillStyle = v.st === 4 ? '#22e39a' : v.st === 5 ? '#ff4d6a' : '#7fd0ff'; ctx.textAlign = 'right'; if (x1 - 2 > 0) ctx.fillText(`${rr}R${v.st === 4 ? '✓' : v.st === 5 ? '✗' : ''}`, x1 - 2, y + (s.dir > 0 ? -6 : 6)); ctx.restore(); });
      // จุดออก
      if (s.t1 !== null && s.exit !== undefined) { const yx = Y(s.exit); if (yx !== null) { ctx.fillStyle = s.pnl > 0 ? '#22e39a' : s.pnl < 0 ? '#ff4d6a' : '#e0b44c'; ctx.beginPath(); ctx.arc(exitX, yx, 3.5, 0, 7); ctx.fill(); } }
      // ป้าย: ทิศ · ครั้งที่แตะ · ผล
      const res = s.st === 3 ? 'เปิดอยู่' : `${s.st === 4 ? '✓' : s.st === 5 ? '✗' : s.why === 'ปิดก่อนข่าว' ? '📰' : '⏱'} ${s.pnl > 0 ? '+' : ''}${s.pnl}$`;
      const lab = `${s.tf === 'M5' ? '≈' : ''}🌏${s.bo ? 'NY⚡' : ''}${s.dir > 0 ? 'B' : 'S'}${s.bo ? '' : s.k} ${s.bo ? 1 : cfg.rr}R${s.tf === 'M5' ? '' : ' ' + res}`;
      const ly = s.dir > 0 ? Math.max(yt, 0) - 7 : Math.min(yt, plotH) + 7, lx = Math.max(2, x0 + 2);
      ctx.globalAlpha = a; ctx.fillStyle = s.st === 3 ? '#7fd0ff' : s.pnl > 0 ? '#22e39a' : '#ff4d6a'; ctx.textAlign = 'left';
      if (lx < plotW) ctx.fillText(lab, lx, ly);
      const label = lx < plotW && ly >= 0 && ly <= plotH
        ? { left: lx, right: Math.min(plotW, lx + ctx.measureText(lab).width), y: ly } : null;
      if (x0 >= 0 && ye >= 0 && ye <= plotH) {
        ctx.fillStyle = '#7fd0ff'; ctx.beginPath(); ctx.arc(x0, ye, 4, 0, Math.PI * 2); ctx.fill();
        entryTargets.push({ s, x: x0, y: ye, label });
      } else if (label) {
        entryTargets.push({ s, x: -Infinity, y: -Infinity, label });
      }
    });
    ctx.globalAlpha = 1;
    // ไม้จริงที่ยังเปิดอยู่: ราคาเข้า / SL / TP ที่ขอบขวา
    if (fresh()) today.filter(s => s.real && s.st === 3).forEach(s => {
      // V4.9.108: ป้ายมีพื้นทึบ + หลบป้าย 🌏A ของโซนที่อยู่ระดับเดียวกัน (เดิมซ้อนกันอ่านไม่ออก)
      const Sx = sessOf(s.t0) || s.S, hz = Sx && Sx.half ? Sx.half : 1.5;
      const aY = (lv || []).filter(z => z.grade === 'A').map(z => Y(z.k + hz)).filter(y => y !== null);
      const line = (p, col, lab) => {
        let y = Y(p); if (y === null || y < 0 || y > plotH) return; y = Math.round(y) - 6;
        if (aY.some(a => Math.abs(a - 6 - y) < 15)) y -= 18; // ป้ายโซนเกรด A อยู่ตรงนี้ → ยกขึ้นอีกบรรทัด
        const w = ctx.measureText(lab).width + 10;
        ctx.fillStyle = 'rgba(11,16,30,.86)'; ctx.fillRect(plotW - 4 - w, y - 13, w, 17);
        ctx.fillStyle = col; ctx.textAlign = 'right'; ctx.fillText(lab, plotW - 9, y);
      };
      line(s.entry, '#7fd0ff', `🌏 ${s.dir > 0 ? 'BUY' : 'SELL'} ${s.entry.toFixed(1)} · ${s.z.side}${s.z.k} ครั้งที่ ${s.k}`);
      line(s.sl, '#ff4d6a', `SL ${s.sl.toFixed(1)}`); (s.bo ? [1] : RRS).forEach(rr => line(s.v[rr].tp, '#22e39a', `TP ${rr}R ${s.v[rr].tp.toFixed(1)}${s.v[rr].st === 4 ? ' ✓' : ''}`));
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

  // ---------- gmf itd + Expected Move ตอนเข้าไม้ (V4.9.92, เก็บข้อมูล forward test แยกชุด) ----------
  // จาก live.js (OILive.calc): gmf itd สด (สเกลเดียวกับกราฟ) + EM ($) · emUse = |ราคาเข้า − ราคาเปิด 06:00| ÷ EM
  // แบ็กเทส 28 ไม้: ใต้ flip RR1 ชนะ 94% / เหนือ flip RR5 ดีกว่า · ใช้ EM ไม่ถึงครึ่ง RR1 ชนะ 89% · ยังไม่ใช้ตัดไม้ แค่บันทึก
  const gxs = new Map();
  function gxSnap(s, open06) {
    const id = key(s); if (gxs.has(id)) return;
    const L = window.OILive, c = L && L.calc; if (!c || !c.match) return;
    const ms = (s.t0 - 7 * 3600) * 1000, late = Date.now() - ms > 10 * 60e3;
    let gmf = c.gmf; const h = (L.hist || []).filter(x => x[0] <= ms + 60e3).pop(); if (h && ms - h[0] < 5 * 60e3) gmf = h[1]; // ค่าใกล้เวลาแตะที่สุดถ้ามี
    const em = c.em > 0 ? c.em : null, r2x = x => Math.round(x * 100) / 100;
    gxs.set(id, { gmf: gmf === null || gmf === undefined ? null : r2x(gmf), above: gmf == null ? null : s.entry > gmf, dist: gmf == null ? null : r2x(s.entry - gmf),
      em: em === null ? null : r2x(em), emUse: em && open06 ? r2x(Math.abs(s.entry - open06) / em) : null, late });
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
  // ป้ายโมเมนตัม · ขึ้นพื้นเขียว ลงพื้นส้ม เกิน 3×ATR พื้นแดงกะพริบทั้งสองทิศ
  let lastMom = null;
  (window.OIBadgeExtra = window.OIBadgeExtra || []).push(() => {
    if (!isOn() || !bars.length) return null;
    const m = liveMom() || lastMom; if (!m) return ['⚡ โมเมนตัม –', '#8fa3c8', 'sfmom', null, 'first'];
    lastMom = m;
    const open = fresh(), S = open ? sessOf(bars[bars.length - 1].time) : null, hot = m.mv > MOM_MAX;
    const t = `⚡ ${m.dn ? 'ลง' : 'ขึ้น'} ${m.mv}×ATR (${m.usd}$/5น.)${m.z ? ` → ${m.z.side}${m.z.k}` : ''}${!open ? ' · ตลาดปิด' : hot && S && S.mom ? ' · ข้ามไม้' : ''}`;
    if (hot) return [t, '#ffffff', 'sfmom-hot', '#d0142f', 'first'];
    return m.dn ? [t, '#fff4e8', 'sfmom', '#9a420c', 'first'] : [t, '#eafff4', 'sfmom', '#0f7a46', 'first'];
  });
  (window.OIBadgeExtra = window.OIBadgeExtra || []).push(() => {
    if (!isOn() || !fresh()) return null;
    const open = today.filter(s => s.real && s.st === 3);
    if (open.length) { const s = open[open.length - 1]; return [`🌏 ${s.dir > 0 ? 'BUY' : 'SELL'} ${s.entry.toFixed(1)} SL ${s.sl.toFixed(1)} TP${cfg.rr}R ${s.tp.toFixed(1)}`, s.dir > 0 ? '#22e39a' : '#ff8a3d', 'sfade']; }
    const S = sessOf(Date.now() / 1000 + THAI);
    if (S?.real && !sharedReady()) return ['🌏 รอข้อมูลสัญญาณกลาง', '#8fa3c8', 'sfade'];
    if (S?.real) {
      const plans = shared.plans.filter(p => p[5] === 1);
      const p = plans[0];
      if (p) return [`🌏 ${p[3] > 0 ? 'BUY' : 'SELL'} ${p[1]}${p[0]} ครั้งที่ ${p[4]}${plans.length > 1 ? ' +' + (plans.length - 1) : ''}`, '#7fd0ff', 'sfade'];
      return [`🌏 ${S.lab} · รอตั้งสัญญาณ`, '#7fd0ff', 'sfade'];
    }
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
    RRS.forEach(rr => lines.push(`${rr === cfg.rr ? '▶ ' : ''}<b>RR ${rr}</b>: ${fmt(sum(r1, rr))}<br><span style="opacity:.75">&nbsp;&nbsp;Asia เช้า ${fmt(sum(r1.filter(s => s.S.id === 'AM'), rr))}<br>&nbsp;&nbsp;London ${fmt(sum(r1.filter(s => s.S.id === 'LDN'), rr))}<br>&nbsp;&nbsp;NY เบรก (RR1 เสมอ) ${fmt(sum(r1.filter(s => s.S.id === 'NYB'), rr))}</span>`));
    lines.push(`วันนี้: ${tr.length ? RRS.map(rr => { const x = sum(tr, rr); return `RR${rr} ${x.usd > 0 ? '+' : ''}${x.usd.toFixed(1)}$${x.open ? ` (ค้าง ${x.open})` : ''}`; }).join(' · ') : (bars.length && Date.now() / 1000 + 7 * 3600 - bars[bars.length - 1].time >= 3 * 3600 ? 'ตลาดปิด' : 'ยังไม่มีไม้จริง')}`);
    if (n5) lines.push(`<span style="opacity:.7">อีก ${n5} วันไม่มีแท่ง M1 ครบ: วาดจาก M5 เป็นกรอบจาง ≈ ไว้ดูตำแหน่งเท่านั้น ไม่คิดผล</span>`);
    if (histMsg) lines.push(histMsg); else if (!hist.size) lines.push('ยังไม่มี OI ย้อนหลัง (ต้องเข้าสู่ระบบ)');
    return lines.join('<br>') + `<br><small>หลายไม้ซ้อนกันได้ · ย้อนหลังได้เท่าวันที่มี OI ในชีต (${hist.size ? [...hist.keys()].sort()[0].slice(5) : '–'} เป็นต้นไป) · ยังไม่หักสเปรด · ย้อนหลังเป็นเกรด B ทั้งหมด</small>`;
  }
  function section() {
    const d = document.createElement('div'); d.id = 'sfBox'; d.className = 'gsbox';
    d.innerHTML = `<div class="row"><button class="gsb${isOn() ? ' on' : ''}" data-sf="on"><i style="background:#7fd0ff"></i>🌏 OI Session Fade v0.6</button><span class="gsinfo">${isOn() ? '' : 'Asia เช้า + London สวนกำแพง · NY เบรก'}</span></div>` + (isOn() ? `<div class="row ps"><span class="gsinfo" style="display:block;line-height:1.55;white-space:normal">${stats()}</span></div>` : '') +
      (isOn() ? `<div class="row ps"><button class="gsb" data-sf="plan" style="border-color:#f2a900;color:#ffd66e">📋 แผนตอนนี้</button></div><div class="row ps"><button class="gsb" data-sf="reload">↻ โหลดแบ็กเทสใหม่</button></div><div class="row ps"><span class="gsinfo">TP บนกราฟ:</span>${RRS.map(rr => `<button class="gsb${cfg.rr === rr ? ' on' : ''}" data-sf="rr" data-rr="${rr}">RR ${rr}</button>`).join('')}</div>` : '');
    return d;
  }
  function mount() { const m = $('indMenu'); if (!m || m.hidden || $('sfBox')) return; const box = section(), anchor = $('s3Box') || $('dhBox') || $('btBox') || m.querySelector('.t'); anchor ? anchor.after(box) : m.prepend(box); }
  const menu = $('indMenu');
  if (menu) {
    new MutationObserver(() => mount()).observe(menu, { childList: true });
    menu.addEventListener('click', e => {
      const a = e.target.closest('[data-sf]'); if (!a) return;
      if (a.dataset.sf === 'plan') { openPlan(); return; }
      if (a.dataset.sf === 'on') cfg.on = !isOn(); else if (a.dataset.sf === 'rr') { cfg.rr = +a.dataset.rr; setups.forEach(view); } else if (a.dataset.sf === 'reload') { histAt = 0; m1Cache.forEach((v, k) => { if (!v) m1Cache.delete(k); }); } else return;
      save(); O.markDirty(); const b = $('sfBox'); if (b) b.remove(); mount(); run(true);
    });
  }
  if (window.OIAlerts) OIAlerts.reg('sfade', '🌏 OI Session Fade (เข้า/ออกไม้จริง)', { desc: 'Asia เช้า + London · เตือนตอนแตะกำแพงแล้วเข้าไม้ และตอนถึง TP/SL', active: isOn });
  // ---------- V4.9.106: 📋 แผนตอนนี้ (แดชบอร์ด oi ss) ----------
  const hm = t => { const m = mod(t); return String(Math.floor(m / 60) % 24).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0'); };
  const dur = sec => { sec = Math.max(0, Math.round(sec / 60)); const h = Math.floor(sec / 60), m = sec % 60; return (h ? h + ' ชม. ' : '') + m + ' นาที'; };
  const f1 = x => x.toFixed(1), sg = x => (x > 0 ? '+' : '') + x.toFixed(1);
  let planTimer = null;
  function planHTML() {
    const now = Date.now() / 1000, nowT = now + THAI, S = sessOf(nowT), m = mod(nowT), d0 = dayStart(nowT), P = O.lastClose;
    const open = fresh(), rr = cfg.rr;
    const C = (t, x) => `<span style="color:${t}">${x}</span>`;
    const G = '#22e39a', Rd = '#ff4d6a', Au = '#ffd66e', Mu = '#8fa3c8', Bl = '#7fd0ff';
    const h = [];
    // 1) สถานะตอนนี้
    const realS = [{ id: 'AM', lab: 'Asia เช้า สวนกำแพง', a: 360, b: 600 }, { id: 'LDN', lab: 'London สวนกำแพง', a: 840, b: 1170 }, { id: 'NYB', lab: 'NY เบรก', a: 1170, b: 1380 }];
    const cur = realS.find(x => m >= x.a && m < x.b), nxt = realS.find(x => m < x.a) || realS[0];
    const nxtIn = ((nxt.a - m + 1440) % 1440) * 60;
    const nb = news.filter(n => nowT >= n - NB && nowT <= n + NA)[0];
    const mm = liveMom();
    h.push(`<div class="sp-card"><div class="sp-h">สถานะตอนนี้ · ${hm(nowT)} น.</div>`
      + (!open ? C(Mu, 'ตลาดปิด / ไม่มีแท่งล่าสุด') : cur ? `${C(Au, '● ' + cur.lab)} · เหลือ ${dur((cur.b - m) * 60)}` : `${C(Mu, '○ ' + (S ? S.lab : '') + ' ไม่มีไม้จริง')}`)
      + `<br>ถัดไป: ${cur && cur.id !== nxt.id ? '' : ''}${nxt.lab} ${hm(nxt.a * 60)} น. (อีก ${dur(nxtIn)})`
      + (mm ? `<br>⚡ ${mm.dn ? 'ลง' : 'ขึ้น'} ${mm.mv}×ATR (${mm.usd}$/5น.) ${mm.mv > MOM_MAX ? C(Rd, cur && cur.id === 'AM' ? '· เกิน 3×ATR ข้ามไม้' : '· เกิน 3×ATR') : C(G, '· ปกติ')}` : '')
      + `<br>${nb ? C(Rd, `⛔ ช่วงข่าวแดง ${hm(nb)} น. ห้ามเข้าถึง ${hm(nb + NA)} น.`) : C(G, '✓ ไม่ติดข่าว')}`
      + (P != null ? `<br>ราคาตอนนี้ ${C('#fff', f1(P))}` : '') + `</div>`);
    const unconfirmed = [...entryMismatches.values()].filter(x => x.day + THAI === d0);
    if (unconfirmed.length) h.push('<div class="sp-card"><div class="sp-h">⚠️ รายการกลางยังไม่ยืนยันกับกราฟ (' + unconfirmed.length + ')</div>' +
      unconfirmed.map(x => '<div class="sp-row">' + hm(x.time) + ' น. · ราคา ' + f1(x.entry) + ' · ' + x.reason + '</div>').join('') +
      '<div class="sp-mu">ไม่นับเป็นไม้เข้าและไม่รวมผล TP/SL ในแอป · ไม่ได้ยกเลิกหรือแก้ไขออเดอร์ MT5</div></div>');
    // 2) ตารางเส้น
    const plans = sharedReady() ? shared.plans.filter(q => q[5] === 1) : [];
    const half = S ? S.half : 1.5;
    const rows = (lv || []).slice().sort((a, b) => P == null ? a.k - b.k : Math.abs(a.p - P) - Math.abs(b.p - P)).map((z, index) => {
      const q = touchOf(z.k) || { quota: 0, k: 0, arm: 0, live: false };
      const lo = z.p - half, hi = z.p + half, dist = P == null ? null : P > hi ? P - hi : P < lo ? lo - P : 0;
      let st, plan = '';
      if (!S || !S.real) {
        const NS = SESS.find(x => x.id === (nxt.id === 'NYB' ? 'AM' : nxt.id)), nh = NS.half, nq = NS.realA && z.grade === 'A' ? NS.realA : NS.real;
        st = C(Mu, `นอกช่วงไม้จริง · ${NS.lab} โซน ${f1(z.p - nh)}–${f1(z.p + nh)} โควตา ${nq} ครั้ง`);
        if (P != null && Math.abs(P - z.p) > nh) {
          const dir = P > z.p ? 1 : -1, en = z.k + dir * nh, sl = z.k - dir * (nh + SLB), R_ = Math.abs(en - sl);
          plan = `<div class="sp-plan">${C(Mu, `ถ้าตั้งรอตอน ${NS.lab}: `)}${dir > 0 ? 'BUY' : 'SELL'} LIMIT <b>${f1(en)}</b> · SL ${C(Rd, f1(sl))} (${f1(R_)}$) · TP ${rr}R ${C(G, f1(en + dir * rr * R_))}</div>`;
        }
      }
      else if (q.k >= q.quota) st = C(Mu, `ครบโควตา (${q.k}/${q.quota})`);
      else if (!q.arm) st = C(Mu, `ยังไม่ตั้งรอ · ต้องปิด${P != null && P < z.p ? 'ใต้' : 'เหนือ'}โซนเกิน 3$`);
      else {
        const dir = q.arm, pl = plans.find(x => x[0] === z.k && x[3] === dir);
        const en = pl ? pl[6] : z.k + dir * half, sl = pl ? pl[7] : z.k - dir * (half + SLB), R_ = Math.abs(en - sl), tp = en + dir * rr * R_;
        const gap = P == null ? null : (P - en) * dir;
        st = C(dir > 0 ? G : Rd, `รอ ${dir > 0 ? 'BUY ▲' : 'SELL ▼'}`) + (gap != null ? ` · ห่าง ${f1(Math.max(0, gap))}$` : '') + (!pl && sharedReady() ? C(Mu, ' (ระบบกลางไม่วาง: ข่าว/พุ่ง)') : '');
        plan = `<div class="sp-plan">${dir > 0 ? 'BUY' : 'SELL'} LIMIT <b>${f1(en)}</b> · SL ${C(Rd, f1(sl))} (${f1(R_)}$) · TP ${rr}R ${C(G, f1(tp))}</div>`;
      }
      return `<div class="sp-row"><div>${C(Au, `<b>แผนที่ ${index + 1}</b>`)} · <b class="${z.side === 'C' ? 'sp-c' : 'sp-p'}">${z.side}${z.k}</b> <i class="sp-g${z.grade}">🌏${z.grade}</i> <span class="sp-mu">${S && S.real ? `โซน ${f1(lo)}–${f1(hi)} · แตะ ${q.k}/${q.quota}` : ''}${dist != null ? ` · ห่าง ${f1(dist)}$` : ''}</span></div><div>${st}</div>${plan}</div>`;
    });
    h.push(`<div class="sp-card"><div class="sp-h">เส้นของวัน (เรียงจากใกล้ราคา) · TP ใช้ RR ${rr}</div>${rows.length ? rows.join('') : C(Mu, 'ยังไม่มีเส้น (รอ 06:00 / รอข้อมูลกลาง)')}</div>`);
    // 3) ไม้ที่เปิดอยู่
    const op = today.filter(x => x.real && x.st === 3);
    h.push(`<div class="sp-card"><div class="sp-h">ไม้ที่เปิดอยู่ (${op.length})</div>` + (op.length ? op.map(x => {
      const R_ = Math.abs(x.entry - x.sl), pn = P == null ? 0 : (P - x.entry) * x.dir;
      return `<div class="sp-row"><div>${C(x.dir > 0 ? G : Rd, x.dir > 0 ? 'BUY' : 'SELL')} ${x.bo ? 'NY เบรก' : x.S.lab} ${x.z.side}${x.z.k} · เข้า ${hm(x.t0)} น.</div><div>เข้า <b>${f1(x.entry)}</b> · SL ${C(Rd, f1(x.sl))} · TP ${x.bo ? 1 : rr}R ${C(G, f1(x.tp))}</div><div>ตอนนี้ ${C(pn >= 0 ? G : Rd, `${sg(pn)}$ (${sg(pn / R_)}R)`)}</div></div>`;
    }).join('') : C(Mu, 'ไม่มี')) + `</div>`);
    // 4) NY เบรก
    const used = new Set(today.filter(x => x.bo).map(x => x.z.k));
    const nyRows = (lv || []).slice().sort((a, b) => b.k - a.k).map(z => used.has(z.k) ? `<div class="sp-row">${z.side}${z.k} ${C(Mu, '· เบรกไปแล้ววันนี้')}</div>`
      : `<div class="sp-row">${z.side}${z.k} · BUY ถ้า M5 ปิด > ${C(G, f1(z.p + BO.half + BO_BUF))} · SELL ถ้าปิด &lt; ${C(Rd, f1(z.p - BO.half - BO_BUF))}</div>`);
    h.push(`<div class="sp-card"><div class="sp-h">NY เบรก 19:30–23:00 (TP RR 1 · SL ขอบอีกฝั่ง)</div>${m >= 1170 && m < 1380 ? C(Au, '● กำลังทำงาน') : C(Mu, m < 1170 ? `เริ่ม 19:30 น. (อีก ${dur((1170 - m) * 60)})` : 'จบแล้ววันนี้')}${nyRows.join('')}</div>`);
    // 5) ข่าวแดง
    const nd = news.filter(n => n >= d0 && n < d0 + 86400);
    h.push(`<div class="sp-card"><div class="sp-h">ข่าวแดง USD วันนี้</div>${nd.length ? nd.map(n => `<div class="sp-row">${hm(n)} น. · ห้ามเข้า ${hm(n - NB)}–${hm(n + NA)} ${nowT > n + NA ? C(Mu, '(ผ่านแล้ว)') : nowT >= n - NB ? C(Rd, '(ตอนนี้)') : ''}</div>`).join('') : C(Mu, 'ไม่มี')}</div>`);
    // 6) สรุปแต่ละขาตาม RR ของ EA · NY เบรกมี TP เดียว
    const fade = today.filter(x => x.real && !x.bo), ny = today.filter(x => x.real && x.bo);
    const resultRow = (label, trades, target) => {
      const legs = trades.map(x => x.v[target]).filter(Boolean);
      const tp = legs.filter(x => x.st === 4).length, sl = legs.filter(x => x.st === 5).length;
      const pending = legs.filter(x => x.st === 3).length;
      const result = legs.reduce((total, x) => total + (x.res || 0), 0);
      return `<div class="sp-row"><b>${label} · RR ${target}</b><br>ปิด ${tp + sl} · ${C(G, 'ถึง TP ' + tp)} · ${C(Rd, 'โดน SL ' + sl)} · ค้าง ${pending} · ${C(result >= 0 ? G : Rd, sg(result) + 'R')}</div>`;
    };
    const splitRows = RRS.map((target, i) => resultRow('TP' + (i + 1), fade, target));
    h.push(`<div class="sp-card"><div class="sp-h">สรุปวันนี้ · แบ่ง TP 3 ไม้</div><div class="sp-mu">คำนวณตาม RR มาตรฐานของ EA</div>${splitRows.join('')}${resultRow('NY เบรก', ny, 1)}</div>`);
    const totalsLine = ({ tp, sl, net }) =>
      `<div><b>รวม</b> · ${C(G, 'TP ' + tp)} · ${C(Rd, 'SL ' + sl)} · สุทธิ ${C(net >= 0 ? G : Rd, sg(net) + 'R')}</div>`;
    const dayTotals = { tp: 0, sl: 0, net: 0 };
    const tradeRows = [...fade, ...ny].sort((a, b) => a.t0 - b.t0).map((x, index) => {
      const totals = { tp: 0, sl: 0, net: 0 };
      const legs = (x.bo ? [1] : RRS).map((target, legIndex) => {
        const leg = x.v[target];
        const label = x.bo ? 'TP' : 'TP' + (legIndex + 1);
        let outcome = C(Mu, 'ไม่มีข้อมูล');
        if (leg?.st === 3) outcome = C(Au, 'ยังเปิดอยู่');
        if (leg?.st === 4 || leg?.st === 5) {
          if (leg.st === 4) totals.tp++;
          else totals.sl++;
          totals.net += leg.res || 0;
          outcome = C(leg.st === 4 ? G : Rd, `${leg.st === 4 ? 'ถึง TP' : 'โดน SL'} ${sg(leg.res)}R`);
          if (leg.t1 != null) outcome += ` · ออก ${hm(leg.t1)} น.`;
        }
        return `<div><b>${label} · RR ${target}</b> · ${outcome}</div>`;
      });
      dayTotals.tp += totals.tp;
      dayTotals.sl += totals.sl;
      dayTotals.net += totals.net;
      const side = x.dir > 0 ? C(G, 'BUY') : C(Rd, 'SELL');
      return `<div class="sp-row"><div><b>ไม้ที่ ${index + 1}</b> · ${side} ${x.z.side}${x.z.k} · ${x.bo ? 'NY เบรก' : x.S.lab}</div><div>เข้า ${hm(x.t0)} น. ที่ <b>${f1(x.entry)}</b> · SL ${C(Rd, f1(x.sl))}</div>${legs.join('')}${totalsLine(totals)}</div>`;
    });
    h.push(`<div class="sp-card"><div class="sp-h">รายไม้วันนี้ (${tradeRows.length})</div>${tradeRows.length ? totalsLine(dayTotals) + tradeRows.join('') : C(Mu, 'ยังไม่มีไม้วันนี้')}</div>`);
    return h.join('') + `<div class="sp-mu" style="text-align:center;margin:8px 0 2px">แผนเข้าจากระบบกลาง · SL จำลองอิงไส้เทียน M1 ของแอปเมื่อมีข้อมูล</div>`;
  }
  function openPlan() {
    let el = $('sfPlan');
    if (!el) {
      el = document.createElement('div'); el.id = 'sfPlan';
      el.innerHTML = `<style>#sfPlan{position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.55);display:flex;align-items:flex-end}#sfPlan .sp-in{width:100%;max-height:86vh;box-sizing:border-box;overflow-y:auto;overflow-x:hidden;touch-action:pan-y;overscroll-behavior-x:contain;background:#0e1527;border-top:2px solid #f2a900;border-radius:18px 18px 0 0;padding:12px 12px calc(16px + env(safe-area-inset-bottom));font-size:13px;line-height:1.5;color:#dfe6f5}#sfPlan .sp-top{display:flex;justify-content:space-between;align-items:center;margin-bottom:8px}#sfPlan .sp-top b{color:#ffd66e;font-size:16px}#sfPlan .sp-x{background:#1c2640;border:0;color:#fff;border-radius:10px;padding:6px 12px;font-size:14px}#sfPlan .sp-card{background:#131c33;border:1px solid #26304a;border-radius:12px;padding:8px 10px;margin-bottom:8px}#sfPlan .sp-h{color:#ffd66e;font-weight:700;margin-bottom:4px}#sfPlan .sp-row{border-top:1px solid #1f2842;padding:5px 0}#sfPlan .sp-row:first-of-type{border-top:0}#sfPlan .sp-mu{color:#8fa3c8;font-size:12px}#sfPlan .sp-c{color:#22e39a}#sfPlan .sp-p{color:#ff4d6a}#sfPlan i{font-style:normal;font-weight:700}#sfPlan .sp-gA{color:#1a1200;background:#f2a900;border-radius:5px;padding:0 4px}#sfPlan .sp-gB{color:#7fd0ff}#sfPlan .sp-plan{margin-top:3px;padding:4px 8px;border-radius:8px;background:#0b1222;border:1px dashed #3a4a70}</style><div class="sp-in"><div class="sp-top"><b>📋 แผน 🌏 oi ss ตอนนี้</b><button class="sp-x">ปิด ✕</button></div><div class="sp-body"></div></div>`;
      document.body.appendChild(el);
      // Keep the touched node alive: replacing sp-body mid-swipe can lose touchend on iOS.
      el._planTouching = false;
      el.addEventListener('touchstart', () => { el._planTouching = true; }, { passive: true, capture: true });
      const release = () => { el._planTouching = false; };
      el.addEventListener('touchend', release, { passive: true, capture: true });
      el.addEventListener('touchcancel', release, { passive: true, capture: true });
      window.bindRightSwipeDismiss?.(el.querySelector('.sp-in'), closePlan);
      el.addEventListener('click', e => { if (e.target === el || e.target.closest('.sp-x')) closePlan(); });
    }
    const draw = () => { if (el._planTouching || !el.isConnected) return; try { el.querySelector('.sp-body').innerHTML = planHTML(); } catch (e) { el.querySelector('.sp-body').textContent = 'คำนวณแผนไม่ได้: ' + e.message; } };
    draw(); run(); clearInterval(planTimer); planTimer = setInterval(() => { run(); draw(); }, 3000);
  }
  function closePlan() { clearInterval(planTimer); planTimer = null; const el = $('sfPlan'); if (el) el.remove(); }
  // V4.9.105: ตัวนับแตะ/สถานะรอของเส้นในช่วงปัจจุบัน (จาก counters ของระบบกลาง) — ใช้ในหน้า OI / Gamma
  function touchOf(k) {
    const now = Date.now() / 1000, nowT = now + 7 * 3600, S = sessOf(nowT); // แอปใช้เวลาไทยแบบเลื่อน +7 ชม. · ระบบกลางใช้ UTC
    if (!S) return null;
    const z = (lv || []).find(x => x.k === k); if (!z) return null;
    const quota = S.real ? (S.realA && z.grade === 'A' ? S.realA : S.real) : 0;
    const C = shared?.counters, fresh = C && shared.day + 7 * 3600 === dayStart(nowT) && shared.bar > now - 180;
    const c = fresh && C.session === S.id ? C.c[k] || C.c[String(k)] : null;
    return { sess: S.id, lab: S.lab, quota, k: c ? c[1] : 0, arm: c ? c[0] : 0, live: !!fresh };
  }
  window.OI_sfade = { openPlan, _planHTML: () => planHTML(), touchOf, RRS, view, stats, scan, fpOf: s => fp.get(key(s)), FP_MAX, _fpFetch: fpFetch, ivOf: s => ivs.get(key(s)), IV_D3_MAX, gxOf: s => gxs.get(key(s)), _gxSnap: gxSnap, _ivSnap: ivSnap, levels, sessOf, dayStart, run, get setups() { return setups; }, get today() { return today; }, get days() { return days; }, get bars() { return bars; }, get levels_() { return lv; }, get cfg() { return cfg; }, isOn };
})();

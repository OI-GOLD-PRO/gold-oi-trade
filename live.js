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

  // ---------- IV คำนวณเอง (Black-76) ----------
  // ตลาดเปิด + ข้อมูลสด → ค่ากลาง bid/ask (เฉพาะ strike ที่ spread แคบ) · ตลาดปิด/ข้อมูลค้าง → ราคา settlement ของ CME (cme_oi.json)
  // ใช้ IV ฝั่ง OTM ของแต่ละ strike (Put ใต้ราคา / Call เหนือราคา) แบบเดียวกับเส้น Vol Settle ของ CME
  const NCDF = x => { const z = Math.abs(x) / Math.SQRT2, t = 1 / (1 + 0.3275911 * z), y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-z * z); return x >= 0 ? 0.5 * (1 + y) : 0.5 * (1 - y); };
  const b76 = (F, K, T, s, call) => { const v = s * Math.sqrt(T), d1 = (Math.log(F / K) + v * v / 2) / v, d2 = d1 - v; return call ? F * NCDF(d1) - K * NCDF(d2) : K * NCDF(-d2) - F * NCDF(-d1); };
  function implVol(p, F, K, T, call) {
    const intr = Math.max(0, call ? F - K : K - F);
    if (!(p > intr + 0.02) || !(T > 0)) return null;
    let lo = 0.01, hi = 3;
    if (b76(F, K, T, hi, call) < p) return null;
    for (let i = 0; i < 60; i++) { const m = (lo + hi) / 2; if (b76(F, K, T, m, call) > p) hi = m; else lo = m; }
    return (lo + hi) / 2;
  }
  // ตลาด CME ทองเปิด? (ปิด ศ. 17:00 – อา. 18:00 นิวยอร์ก และพักทุกวัน 17:00–18:00)
  const etFmt = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short', hour: '2-digit', hourCycle: 'h23' });
  function cmeOpen(ms) { const p = Object.fromEntries(etFmt.formatToParts(new Date(ms)).map(x => [x.type, x.value])), h = +p.hour, wd = p.weekday; return !(wd === 'Sat' || (wd === 'Fri' && h >= 17) || (wd === 'Sun' && h < 18) || h === 17); }
  // เวลา settlement CME (13:30 ชิคาโก) ของวันเทรด MM/DD/YYYY → ms
  function settleMs(mdY) {
    const [m, d, y] = String(mdY).split('/').map(Number); if (!y) return null;
    const nthSun = (mm, n) => { const f = new Date(Date.UTC(y, mm - 1, 1)).getUTCDay(); return 1 + ((7 - f) % 7) + (n - 1) * 7; };
    const t = Date.UTC(y, m - 1, d), dst = t >= Date.UTC(y, 2, nthSun(3, 2)) && t < Date.UTC(y, 10, nthSun(11, 1));
    return Date.UTC(y, m - 1, d, 13 + (dst ? 5 : 6), 30);
  }
  async function loadCme() { try { const j = await (await fetch('https://oi-gold-pro.github.io/gold-oi-pro/cme_oi.json?t=' + Math.floor(Date.now() / 600e3), { cache: 'no-store' })).json(); if (j && j.root) { st.cme = j; tick(); } } catch (e) {} }
  setTimeout(loadCme, 1500); setInterval(loadCme, 10 * 60e3);

  function ownIV(d, map, ks, now, S0) {
    let mode = null, px = null, Tiv = null, settleDate = null;
    if (cmeOpen(now) && d.updated && now / 1000 - d.updated < 900) {
      mode = 'live'; Tiv = Math.max((d.expTs * 1000 - now) / YEAR, 60e3 / YEAR);
      px = (k, t) => { const o = (map.get(k) || {})[t]; if (!o) return null; const b = +o.bid, a = +o.ask; if (b > 0 && a > b) { const m = (a + b) / 2; if (a - b <= Math.max(0.6, m * 0.25)) return m; } return null; };
    } else if (st.cme && st.cme.settle && st.cme.root === d.root && +st.cme.exp === +d.exp) {
      // V4.4.1: เวลาแบบเดียวกับ CME/QuikStrike (เทียบ Vol Settle แล้ว 3 สัญญา): จาก 17:00 ชิคาโกของวันเทรด → 12:30 ชิคาโกวันหมดอายุ นับตามเวลานาฬิกา (ไม่บวกชั่วโมงเปลี่ยน DST)
      const sm = new Map(st.cme.settle.rows.map(([k, t, v]) => [k + t, v])), [sM, sD, sY] = String(st.cme.settle.tradeDate).split('/').map(Number), e = String(d.exp);
      const Ts = sY ? (Date.UTC(+e.slice(0, 4), +e.slice(4, 6) - 1, +e.slice(6, 8), 12, 30) - Date.UTC(sY, sM - 1, sD, 17, 0)) / YEAR : null;
      if (Ts > 0) { mode = 'settle'; settleDate = st.cme.settle.tradeDate; Tiv = Math.max(Ts, 60e3 / YEAR); px = (k, t) => sm.get(k + t) || null; }
      ks = [...new Set([...ks, ...st.cme.settle.rows.map(r => r[0])])].sort((a, b) => a - b);
    }
    if (!mode) return null;
    // ราคาฟิวเจอร์สอ้างอิง = put-call parity (K + C − P) ของ 3 strike ที่ใกล้ราคาที่สุด
    const ref = S0 || d.F, par = ks.filter(k => px(k, 'C') && px(k, 'P')).sort((a, b) => Math.abs(a - ref) - Math.abs(b - ref)).slice(0, 3).map(k => k + px(k, 'C') - px(k, 'P')).sort((a, b) => a - b);
    const F = par.length ? par[Math.floor(par.length / 2)] : ref;
    const pts = [];
    ks.forEach(k => {
      if (Math.abs(k - F) > F * 0.08) return;
      const otmC = k >= F, p1 = px(k, otmC ? 'C' : 'P');
      let iv = p1 ? implVol(p1, F, k, Tiv, otmC) : null;
      if (iv === null) { const p2 = px(k, otmC ? 'P' : 'C'); if (p2) iv = implVol(p2, F, k, Tiv, !otmC); }
      if (iv !== null && iv > 0.02 && iv < 2.5) pts.push([k, iv]);
    });
    if (pts.length < 3) return null;
    const ivAt = x => { if (x <= pts[0][0]) return pts[0][1]; if (x >= pts[pts.length - 1][0]) return pts[pts.length - 1][1]; for (let i = 1; i < pts.length; i++) if (x <= pts[i][0]) { const [k0, v0] = pts[i - 1], [k1, v1] = pts[i]; return v0 + (v1 - v0) * (x - k0) / (k1 - k0); } return null; };
    // EM = ราคา straddle ATM ณ เวลาที่เหลือตอนนี้ (Black-76 ด้วย IV ATM) · ตลาดเปิดใช้ราคา straddle จริงถ้ามี
    const em = T => {
      if (mode === 'live') { const K = ks.reduce((b, k) => Math.abs(k - F) < Math.abs(b - F) ? k : b, ks[0]), c = px(K, 'C'), p = px(K, 'P'); if (c && p) return c + p; }
      const iv = ivAt(F); return iv ? 2 * b76(F, F, T, iv, true) : null;
    };
    return { mode, F, pts, ivAt, em, settleDate };
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
    // IV คำนวณเอง → แทน IV/delta/gamma ของ TradingView (ซึ่งเพี้ยนเมื่อราคาค้าง/spread กว้าง)
    const own = ownIV(d, map, ks, now, S0);
    if (own) strikes.forEach(s => {
      const iv = own.ivAt(s.k); if (!(iv > 0)) return;
      const v = iv * Math.sqrt(T), d1 = (Math.log(own.F / s.k) + v * v / 2) / v, g = pdf(d1) / (own.F * v);
      s.ivC = s.ivP = iv; s.dC = NCDF(d1); s.dP = NCDF(d1) - 1; s.gC = s.gP = g;
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
    const emOwn = own ? own.em(T) : null;
    return { match, root: d.root, cfgC, T, S0, gmf, gmfAdj, gexAtF, skew, p25, c25, strikes, em: emOwn || d.em, emTv: d.em, ivAtm: own ? own.ivAt(own.F) : null, ivMode: own ? own.mode : null, ivF: own ? own.F : null, ivSettle: own ? own.settleDate : null, smile: own ? own.pts : null, emK: d.emK, openF: d.openF, openEM: d.openEM, updated: d.updated, expTs: d.expTs };
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
  // OI ของ CME เป็นตัวเลข "ปิดวันเทรด" และออกหลังวันนั้นจบ → เวลาที่ TradingView อัปเดต (oi.time) มักเป็นวันถัดไป
  // วันเทรดที่แท้จริง = วันทำการก่อนหน้าเวลาที่อัปเดต (ถ้าอัปเดตหลัง 16:00 ชิคาโก นับวันนั้นได้) และข้ามเสาร์-อาทิตย์
  function tradeDate(t) {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(t * 1000)).map(x => [x.type, x.value]));
    const d = new Date(Date.UTC(+p.year, +p.month - 1, +p.day, 12));
    if (+p.hour < 16) d.setUTCDate(d.getUTCDate() - 1);
    while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d.setUTCDate(d.getUTCDate() - 1);
    return d.toLocaleDateString('th-TH', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
  }
  // ชื่อเต็มของสัญญา: OG = รายเดือน (อ้างอิงฟิวเจอร์สเดือนถัดไป) · อื่น ๆ = รายสัปดาห์ตามวันหมดอายุ "สัปดาห์ที่ N" ของเดือน · พร้อมรหัสเต็ม เช่น G1MX6
  function contractName(root, exp) {
    if (!root || !exp) return '';
    const y = Math.floor(exp / 10000), m = Math.floor(exp / 100) % 100, dd = exp % 100;
    const MC = 'FGHJKMNQUVXZ', TH = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
    const DAY = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    if (root === 'OG') { const nm = m % 12 + 1, ny = m === 12 ? y + 1 : y; return `Gold Monthly Options ${['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'][nm - 1]} ${ny} (OG${MC[nm - 1]}${ny % 10})`; }
    const wd = new Date(Date.UTC(y, m - 1, dd)).getUTCDay();
    return `Gold Weekly ${DAY[wd]} Options สัปดาห์ ${Math.ceil(dd / 7)} ${TH[m - 1]} ${y} (${root}${MC[m - 1]}${y % 10})`;
  }
  function syncLevels() {
    const d = st.d;
    if (!d || !d.rows || !O.setLevels || !O.cfgData || !O.oi) return;
    let lv = [], fb = null;
    d.rows.forEach(r => { if (r[11] > 0) lv.push({ strike: r[0], oi: r[11], type: r[1] }); });
    // สัญญาวันนี้ยังไม่มี OI (เพิ่งเปิด) → ใช้ OI ของสัญญาถัดไปที่ Worker ยืมมาให้
    if (!lv.length && d.oiFb && d.oiFb.rows && d.oiFb.rows.length) { fb = d.oiFb; lv = fb.rows.map(([k, t, oi]) => ({ strike: k, oi, type: t })); }
    if (!lv.length) return;
    const sig = d.root + '|' + d.oiT + '|' + (d.oiSrc || '') + '|' + (fb ? fb.root + fb.exp : '') + '|' + lv.length + '|' + lv.reduce((a, l) => a + l.oi, 0);
    if (st.lvSig === sig && st.lvOi === O.oi) return;
    // ป้าย: วันหมดอายุของสัญญา (เวลาไทย) + OI เป็นของวันเทรดไหน (วันตามเวลาชิคาโกที่ CME ปิดตัวเลข)
    const th = (t, o) => new Date(t * 1000).toLocaleString('th-TH', Object.assign({ timeZone: 'Asia/Bangkok' }, o));
    const exp = d.expTs ? `หมด ${th(d.expTs, { weekday: 'short', day: 'numeric', month: 'short' })} ${th(d.expTs, { hour: '2-digit', minute: '2-digit', hour12: false })}` : '';
    const oiT = fb ? fb.oiT : d.oiT;
    let oiD = oiT ? `OI${d.oiSrc === 'cme' && !fb ? ' CME' : ''} ปิด ${tradeDate(oiT)}` : 'OI สด';
    if (fb) oiD = `⚠️ ยืม OI จาก ${fb.root} (หมด ${th(fb.expTs, { weekday: 'short', day: 'numeric', month: 'short' })}) · ${oiD}`;
    O.setLevels(lv, d.root, [contractName(d.root, d.exp), exp, oiD].filter(Boolean).join(' · '));
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
  st.poll = poll; // ให้ปุ่ม ⟳ เรียกดึงข้อมูลสดทันที
  setInterval(poll, 30000); // V4.4.2: Worker ดึงข้อมูลทุก 1 นาที → โหลดทุก 30 วินาที (IV บนกราฟอัปเดตทุก ~1 นาที)
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
      oi.gmf = (oi.gmf || []).filter(g => !/^gmf itd/.test(g.lab)); // ลบทั้งของชีตและของสดรอบก่อน (ป้ายมี ↑/↓ ต่อท้าย)
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
      // วางชิดซ้ายของแท่ง OI ฝั่งขวา (ใต้เส้น strike ไม่ทับป้าย Cxx Pxx ที่อยู่เหนือเส้น)
      const barMax = Math.min(plotW * 0.32, 150), rowOf = new Map((oi.rows || []).map(r => [r.strike, r]));
      const vMax = Math.max(1, ...near.map(s => s.vc + s.vp));
      near.forEach(s => {
        const r = rowOf.get(s.k), y = series.priceToCoordinate(r ? r.price : s.k - G()); if (y === null || y < 26 || y > plotH - 8) return;
        const parts = [];
        const sig = (b, sl, lab) => { const v = b + sl, n = b - sl; if (v >= 10 && Math.abs(n) >= Math.max(5, v * 0.2)) { parts.push([lab, lab === 'C' ? C('--call') : C('--put'), 0]); parts.push([n > 0 ? '▲' : '▼', n > 0 ? C('--call') : C('--put'), 4]); } }; // C เขียว P แดง · ▲ เขียว ▼ แดง
        sig(s.bc, s.sc, 'C'); sig(s.bp, s.sp, 'P');
        const v = s.vc + s.vp, o = s.c + s.p;
        // V4.9.28: ผู้ใช้ไม่เอาไอคอน 🔥 บนกราฟ (ยังดู 'เงินใหม่' ได้ในหน้าแดช)
        if (!parts.length) return;
        const L = r && oi.maxOI ? barMax * Math.max(r.c, r.p) / oi.maxOI : 0;
        const wAll = parts.reduce((a, [t, , g]) => a + ctx.measureText(t).width + g, 0);
        let x = plotW - L - 6 - wAll;
        parts.forEach(([t, col, g]) => { ctx.fillStyle = col; ctx.fillText(t, x, y + 7); x += ctx.measureText(t).width + g; });
      });
      ctx.restore();
    }
    // 3) ป้ายสถานะมุมซ้ายบน
    const badges = [];
    const gm = oi && oi.gmf ? oi.gmf.find(g => g.lab === 'gmf M') : null;
    // V4.4.3: ผู้ใช้ขอเอาป้ายนี้ออก
    if (false && gm && O.lastClose !== null) badges.push(O.lastClose + G() >= gm.p ? ['γ+ เหนือFlip', C('--call')] : ['γ− ใต้Flip', C('--put')]);
    const cot = window.OICot;
    // V4.4.3: ผู้ใช้ขอเอาป้ายนี้ออก
    if (false && cot && cot.bias !== undefined) badges.push(cot.bias > 0 ? ['COT↑', C('--call')] : cot.bias < 0 ? ['COT↓', C('--put')] : ['COT→', C('--gold')]);
    if (c && c.skew !== null) badges.push(c.skew > 1.5 ? ['😨Put skew', C('--put')] : c.skew < -1.5 ? ['🤑Call skew', C('--call')] : ['⚖️Skew กลาง', C('--muted')]);
    if (c && c.em) badges.push([`EM ±${c.em.toFixed(1)}`, '#9aa7ff']);
    if (st.err && !c) badges.push(['ข้อมูลสดไม่ได้', C('--muted')]);
    else if (c && !c.match) badges.push([`สด ${c.root} ≠ ชีต ${c.cfgC || '–'}`, C('--muted')]);
    // ป้ายจากอินดี้อื่น (เช่น dealer.js) → [ข้อความ, สี, key สำหรับแตะ]
    { const first = []; (window.OIBadgeExtra || []).forEach(f => { try { const x = f(); if (x) { if (x[4] === 'first') first.push(x); else badges.push(x); } } catch (e) {} }); badges.unshift(...first); }
    // V4.5.2: ลำดับที่ผู้ใช้กำหนด: ⚠️ Squeeze (เมื่อมีสัญญาณ) → Dealer → IV → OI Divergence (High/Low + OI) → HV (🌡) → ที่เหลือตามเดิม
    { const ORD = ['sfmom', 'squeeze', 'dealer', 'iv', 'oidiv', 'volreg'], rk = x => { const i = ORD.indexOf(x[2]); return i < 0 ? ORD.length : i; }; badges.splice(0, badges.length, ...badges.map((x, i) => [x, i]).sort((a, b) => rk(a[0]) - rk(b[0]) || a[1] - b[1]).map(z => z[0])); } // V4.5.0: ป้าย 'first' หลายอันเรียงตามลำดับโหลด // [ข้อความ, สี, key, พื้นหลัง, 'first' = ขึ้นหน้าสุด]
    // V3.5.7: ป้ายสถานะอยู่ในแถบของตัวเองเหนือกราฟ (เดิมวาดทับกราฟ ทำให้ซ้อนกับป้ายราคา/OI มุมซ้ายบน)
    const wrap = document.getElementById('wrap');
    if (wrap) {
      let bar = document.getElementById('badges');
      if (!bar) { bar = document.createElement('div'); bar.id = 'badges'; wrap.appendChild(bar); }
      const esc = t => String(t).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
      const html = badges.map(([t, col, k, bg]) => `<span style="color:${col};border-color:${col}${bg ? ';background:' + bg : ''}"${k ? ` data-k="${esc(k)}"` : ''}>${esc(t)}</span>`).join('');
      if (bar.dataset.h !== html) { bar.dataset.h = html; bar.innerHTML = html; wrap.classList.toggle('bdg', badges.length > 0); }
    }
  });
})();

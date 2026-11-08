// Big Traders: ไม้ใหญ่ (ไล่ซื้อ/ไล่ขายจริงจาก perp XAUUSDT) วางบนแท่งเทียนตรงราคาที่เข้า + Delta (ซื้อ − ขาย) ต่อแท่ง
// ข้อมูล: Binance USDⓈ-M (aggTrades มีฝั่ง taker จริง, klines มี taker buy volume → Delta ย้อนหลังได้ทุก TF)
//        สำรอง Bitget (fills มีฝั่ง taker) ถ้าเครือข่ายเข้า Binance ไม่ได้
// ไม่ใช่วอลลุ่ม CME แต่เป็นการซื้อขายจริงที่รู้ฝั่ง ใช้ดูว่าเจ้าใหญ่ไล่ราคาฝั่งไหน ที่ราคาเท่าไหร่
(() => {
  'use strict';
  const O = window.OI;
  if (!O || !O.hooks || !(O.sym === 'gold' || O.sym === 'gcy')) return;
  const $ = id => document.getElementById(id);
  const SYM = 'XAUUSDT', TZ = 7 * 3600;
  const TFS = { '1m': 60, '5m': 300, '15m': 900, '30m': 1800, '1h': 3600, '4h': 14400, '1d': 86400 };
  const DEF = { on: false, auto: true, thr: 5, delta: true, hours: 24, v: 2 };
  const KEY = 'oit_bigtr' + (O.psfx || '');
  let cfg = Object.assign({}, DEF);
  let saved0 = {}; try { saved0 = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; Object.assign(cfg, saved0); } catch (e) {}
  // V4.9.53: share ingestion with Volume Profile without enabling whale overlays/alerts.
  const profileHours = () => window.OI_volumeProfile?.historyHours?.() ?? (window.OI_volumeProfile?.cfg.on ? window.OI_volumeProfile.cfg.win : 0);
  const collecting = () => cfg.on || profileHours() > 0;
  const historyHours = () => Math.max(cfg.on ? cfg.hours : 0, profileHours()) || cfg.hours;
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch (e) {} };
  if (saved0.v !== 2) { cfg.hours = 24; cfg.v = 2; save(); } // V4.3.3: ค่าเริ่มย้อนหลัง 24 ชม.

  // ---------- สถานะ ----------
  let src = null;             // 'binance' | 'bitget'
  let trades = [];            // ไม้ใหญ่ {t ms, p, q, s: 1 ซื้อ / -1 ขาย}
  // ขนาดไม้ล่าสุด (วงแหวน 20,000 ค่า) ใช้คำนวณเกณฑ์อัตโนมัติ · คำนวณเกณฑ์ใหม่ทุก 20 วินาที ไม่ใช่ทุกไม้ (กันกราฟหน่วง)
  const RING = 20000; let sizes = new Float32Array(RING), sN = 0, thrCache = 5, thrAt = 0;
  let delta = new Map();      // เวลาแท่ง (วินาทีแกนกราฟ) → { b, s } ปริมาณไล่ซื้อ/ไล่ขาย
  let pxOff = new Map();      // เวลาแท่ง → ราคา perp − ราคาบนกราฟ (แปลงราคาไม้ให้ตรงแกน)
  let curTf = null, busy = false, ws = null, wsTimer = null, status = '', pendingCollection = false;
  const thr = () => { if (!cfg.auto) return Math.max(0.01, +cfg.thr || 5); if (Date.now() - thrAt > 20000) { thrAt = Date.now(); thrCache = autoThr(); } return thrCache; };
  function autoThr() { const n = Math.min(sN, RING); if (n < 200) return 5; const a = sizes.slice(0, n).sort(); return Math.max(1, Math.round(a[Math.floor(n * 0.995)] * 10) / 10); }
  const barOf = ms => { const sec = TFS[O.tf] || 60; return Math.floor(ms / 1000 / sec) * sec + TZ; };
  const fetchJ = async (u, ms) => { const ac = new AbortController(), t = setTimeout(() => ac.abort(), ms || 8000); try { const r = await fetch(u, { signal: ac.signal, cache: 'no-store' }); if (!r.ok) throw new Error('HTTP ' + r.status); return await r.json(); } finally { clearTimeout(t); } };

  // ---------- Delta + ราคาอ้างอิงต่อแท่ง (Binance klines: k[9] = taker buy volume) ----------
  let referenceLoad = null;
  function loadKlines() {
    if (referenceLoad) return referenceLoad;
    referenceLoad = loadPriceReference().finally(() => { referenceLoad = null; });
    return referenceLoad;
  }
  async function loadPriceReference() {
    const B = O.series.data() || []; if (B.length < 3) return;
    // กราฟยังเป็นแท่งของ TF เดิม (เพิ่งกดเปลี่ยน) → รอแล้วลองใหม่ ไม่งั้นจับคู่ราคาผิดแท่ง
    const step = TFS[O.tf] || 60;
    if (O.tf !== '1d' && B[B.length - 1].time - B[B.length - 2].time !== step && B[B.length - 2].time - B[B.length - 3].time !== step) { setTimeout(() => loadKlines().then(() => O.markDirty()), 1500); return; }
    const anchor = collectionAnchor();
    const endTime = anchor.closed ? '&endTime=' + (anchor.end - 1) : '';
    const n = Math.min(1500, Math.max(100, B.length));
    if (src !== 'bitget') {
      try {
        const k = await fetchJ(`https://fapi.binance.com/fapi/v1/klines?symbol=${SYM}&interval=${O.tf}&limit=${n}${endTime}`);
        const dm = new Map(), om = new Map();
        k.forEach(x => { const t = Math.floor(x[0] / 1000) + TZ, v = +x[5], tb = +x[9]; dm.set(t, { b: tb, s: v - tb }); om.set(t, +x[4]); });
        delta = dm; if (om.size >= 5) pxOff = om; src = 'binance'; return;
      } catch (e) { window.__btErr = 'klines: ' + (e && e.message || e); src = 'bitget'; }
    }
    // สำรอง: Bitget klines (ไม่มีฝั่ง taker) → ใช้แค่ราคาอ้างอิง ส่วน Delta คิดจากไม้ที่ดึงได้
    try {
      const G = { '1m': '1m', '5m': '5m', '15m': '15m', '30m': '30m', '1h': '1H', '4h': '4H', '1d': '1D' };
      const j = await fetchJ(`https://api.bitget.com/api/v2/mix/market/candles?symbol=${SYM}&productType=usdt-futures&granularity=${G[O.tf]}&limit=${Math.min(1000, n)}${endTime}`);
      const om = new Map(); (j.data || []).forEach(x => { const t = Math.floor(+x[0] / 1000) + TZ; om.set(t, +x[4]); });
      if (om.size >= 5) pxOff = om;
    } catch (e) {}
  }
  // ราคาไม้ → ราคาบนกราฟ (ใช้ส่วนต่างของแท่งนั้น ถ้าไม่มีใช้ของแท่งใกล้สุด)
  // pxOff เก็บราคาปิด perp ต่อแท่ง → ส่วนต่าง = ราคาปิด perp − ราคาปิดบนกราฟ "ตอนนี้" (offset ของแอปเปลี่ยนได้หลังโหลด)
  let dispKey = '', dispMap = new Map();
  function dispNow() { const B = O.series.data() || []; const k = B.length + '|' + (B.length ? B[B.length - 1].close + '|' + B[0].close : ''); if (k !== dispKey) { dispKey = k; dispMap = new Map(B.map(b => [b.time, b.close])); } return dispMap; }
  function offAt(t) {
    const D = dispNow();
    if (pxOff.has(t) && D.has(t)) return pxOff.get(t) - D.get(t);
    let best = null, bd = Infinity; pxOff.forEach((v, k) => { if (!D.has(k)) return; const d = Math.abs(k - t); if (d < bd) { bd = d; best = v - D.get(k); } });
    return best === null ? 0 : best;
  }

  // ---------- ย้อนหลังไม้ใหญ่ ----------
  function addTrade(t, p, q, s, keepAll, id) {
    if (id !== undefined && window.OIVolumeSink) window.OIVolumeSink('binance', id, t, p, q, s);
    sizes[sN % RING] = q; sN++;
    if (window.OIRetailSink) window.OIRetailSink(t, p, q, s, id); // V4.9.12: 👥 โซนรายย่อย (ไม้เล็ก)
    if (src === 'bitget') { const bt = barOf(t), d = delta.get(bt) || { b: 0, s: 0 }; if (s > 0) d.b += q; else d.s += q; delta.set(bt, d); }
    if (keepAll || q >= Math.max(1, thrCache * 0.4)) trades.push({ t, p, q, s }); // เก็บเฉพาะไม้ที่มีโอกาสถึงเกณฑ์ (ประหยัดหน่วยความจำ 24 ชม.)
  }
  // V4.3.3: โหลดจากใหม่ไปเก่า (แท่งล่าสุดขึ้นก่อน) · จำไม้ใหญ่ไว้ในเครื่อง (cache) เปิดครั้งถัดไปโหลดเฉพาะช่วงที่ขาด
  //         · ใส่จังหวะไม่เกิน ~90 ครั้ง/นาที (aggTrades weight 20, เพดาน Binance 2400/นาที)
  const CKEY = 'oit_bigtr_cache', MINQ = 0.5;
  let lastId = 0, lastMsg = 0, filling = false, covHi = 0, sinceT = 0, limited = false, closedAnchor = false; // covHi = id สูงสุดที่มีไม้ต่อเนื่องครบ (ใช้กับ cache)
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  function loadCache() { try { const c = JSON.parse(localStorage.getItem(CKEY) || 'null'); return c && c.v === 2 ? c : null; } catch (e) { return null; } }
  function saveCache() {
    try {
      const keep = Math.min(Date.now() - 25 * 3600e3, sinceT || Infinity), rows = trades.slice().sort((a, b) => a.t - b.t).filter(x => x.t >= keep && x.q >= Math.max(MINQ, thrCache * 0.4)).map(x => [x.t, +x.p.toFixed(2), +x.q.toFixed(3), x.s]);
      localStorage.setItem(CKEY, JSON.stringify({ v: 2, hiId: covHi, lim: limited, since: sinceT, rows }));
      if (window.OI_retail) OI_retail.save();
    } catch (e) {}
  }
  // ดึง 1 หน้า: โดนจำกัดความถี่ (429/418) หรือเน็ตสะดุด → รอแล้วลองใหม่ ไม่โยนทิ้งไปใช้ Bitget
  async function page(fromId, lim) {
    for (let k = 0; ; k++) {
      try { return await fetchJ(`https://fapi.binance.com/fapi/v1/aggTrades?symbol=${SYM}&fromId=${fromId}&limit=${lim || 1000}`); }
      catch (e) { if (k >= 4 || /HTTP 400/.test(e.message)) throw e; status = /429|418/.test(e.message) ? 'Binance ขอให้รอสักครู่…' : status; paintInfo(); await sleep(/429|418/.test(e.message) ? 20000 : 3000); }
    }
  }
  // ดึงช่วง id (lo..hi] จากใหม่ไปเก่า ครั้งละ 3 หน้าพร้อมกัน
  async function pullRange(lo, hi, since, label) {
    let to = hi, done = 0; const total = Math.max(1, Math.ceil((hi - lo) / 1000));
    while (to > lo && collecting()) {
      const batch = [];
      for (let k = 0; k < 4 && to > lo; k++) { const from = Math.max(lo + 1, to - 999); batch.push(page(from)); to = from - 1; }
      const res = (await Promise.all(batch.map(p => p.catch(e => { if (/HTTP 400/.test(e.message)) return null; throw e; })))).filter(Boolean);
      if (!res.length) { limited = true; break; }
      let oldest = Infinity;
      res.forEach(a => a.forEach(x => { addTrade(x.T, +x.p, +x.q, x.m ? -1 : 1, false, x.a); if (x.T < oldest) oldest = x.T; }));
      done += res.length;
      status = `${label} ${Math.min(99, Math.round(done / total * 100))}%`; paintInfo(); O.markDirty();
      if (oldest < since) break;
      await sleep(2500);
    }
    trades.sort((a, b) => a.t - b.t);
  }
  // id ของไม้แรกตั้งแต่เวลา ms: ลอง startTime ก่อน (ใช้ได้เฉพาะช่วงใกล้ ๆ) ไม่ได้ → ค้นแบบแบ่งครึ่งตามเลข id
  const page1 = fromId => page(fromId, 1);
  async function idAt(ms, topId) {
    try { const f = await fetchJ(`https://fapi.binance.com/fapi/v1/aggTrades?symbol=${SYM}&startTime=${ms}&endTime=${ms + 3600e3}&limit=1`); if (f.length) return f[0].a; } catch (e) {}
    // Binance ให้ย้อนได้แค่ 2 วันล่าสุด (code −4166 → HTTP 400) → นับเป็น "เก่ากว่าที่ต้องการ" จะได้ไปจบที่ขอบที่ดึงได้
    const T = async id => { try { const a = await page1(id); return a.length ? a[0].T : Infinity; } catch (e) { if (/HTTP 400/.test(e.message)) return -Infinity; throw e; } };
    let hi = topId, lo = topId, step = 200000;
    for (let k = 0; k < 8; k++) { lo = Math.max(1, hi - step); if (await T(lo) < ms) break; hi = lo; step *= 2; await sleep(300); }
    while (hi - lo > 500) { const mid = Math.floor((lo + hi) / 2); if (await T(mid) < ms) lo = mid; else hi = mid; await sleep(250); }
    return T(lo).then(t => t === -Infinity ? hi : lo);
  }
  // V4.3.6: ตลาด CME ปิด (เสาร์–อาทิตย์/ช่วงพัก) → นับย้อนหลังจากแท่งสุดท้ายบนกราฟ ไม่ใช่เวลาปัจจุบัน และดึงเฉพาะช่วงที่มีแท่ง
  function anchorMs(fromLastBar = false) {
    const now = Date.now(), bars = O.series.data() || [];
    if (!bars.length) return { end: now, closed: false };
    const seconds = TFS[O.tf] || 60, end = (bars.at(-1).time - TZ + seconds) * 1000;
    const closed = now - end > (fromLastBar ? 0 : 30 * 60e3);
    return { end: closed ? end : now, closed };
  }
  const collectionAnchor = () => anchorMs(window.OI_footprint?.active);
  async function backfill() {
    trades = []; sN = 0; thrAt = 0; limited = false;
    const A = collectionAnchor(), since = A.end - historyHours() * 3600e3; closedAnchor = A.closed;
    sinceT = since;
    if (src !== 'bitget') {
      try {
        const head = await fetchJ(`https://fapi.binance.com/fapi/v1/aggTrades?symbol=${SYM}&limit=1000`);
        if (!head.length) throw new Error('no data');
        src = 'binance';
        head.forEach(x => addTrade(x.T, +x.p, +x.q, x.m ? -1 : 1, true, x.a));
        const top = head[head.length - 1].a, low = head[0].a;
        lastId = top; lastMsg = Date.now(); thrAt = 0; thr(); O.markDirty();
        status = 'กำลังหาช่วงเวลา…'; paintInfo();
        // Seed the last chart bars before resolving the full history range.
        // The latest exchange trades may be hours ahead of a closed chart.
        if (A.closed && window.OI_footprint?.active) {
          try {
            const start = Math.max(since, A.end - 5 * 60000);
            const recent = await fetchJ(`https://fapi.binance.com/fapi/v1/aggTrades?symbol=${SYM}&startTime=${start}&endTime=${A.end - 1}&limit=1000`);
            for (const x of recent) {
              // Seed only the deduplicated sink. The full backfill also feeds Whale and Retail.
              window.OIVolumeSink?.('binance', x.a, x.T, +x.p, +x.q, x.m ? -1 : 1);
            }
            O.markDirty();
          } catch (_) { /* Continue with the existing ID-based history. */ }
        }
        const hiNeed = A.closed ? await idAt(A.end, top) : low - 1;
        const c = loadCache();
        let loNeed = null;
        if (c && c.hiId && c.rows.length && !(window.OI_volumeProfile?.needFull(since)) && !(window.OI_retail && OI_retail.cfg.on && OI_retail.needFull(since)) && (c.rows[0][0] <= since + 3600e3 || (c.lim && c.since <= since + 3600e3)) && c.hiId > top - 3000000) {
          c.rows.forEach(([t, p, q, s]) => { if (t >= since && t < head[0].T) trades.push({ t, p, q, s }); });
          loNeed = c.hiId; // มีของเดิมแล้ว ดึงเฉพาะช่วงที่ขาด
        }
        if (loNeed === null) loNeed = (await idAt(since, top)) - 1;
        if (hiNeed > loNeed) await pullRange(loNeed, hiNeed, since, 'กำลังโหลดย้อนหลัง');
        covHi = A.closed ? Math.max(hiNeed, loNeed) : top;
        trades = trades.filter(x => x.t >= since);
        trades.sort((a, b) => a.t - b.t);
        saveCache();
        return;
      } catch (e) { window.__btErr = 'backfill: ' + (e && e.stack || e); src = 'bitget'; await loadKlines(); }
    }
    // Bitget: ไล่ย้อนจากล่าสุดทีละ 1000 (ไม้ย่อยเวลาเดียวกัน ฝั่งเดียวกัน = ออเดอร์เดียว → รวมกัน)
    let idLess = null, calls = 0; const raw = [];
    while (collecting() && calls < Math.min(150, 10 + historyHours() * 6)) {
      const j = await fetchJ(`https://api.bitget.com/api/v2/mix/market/fills-history?symbol=${SYM}&productType=usdt-futures&limit=1000${idLess ? '&idLessThan=' + idLess : ''}`); calls++;
      const d = j.data || []; if (!d.length) break;
      d.forEach(x => { if (window.OIVolumeSink) window.OIVolumeSink('bitget', x.tradeId, +x.ts, +x.price, +x.size, /buy/i.test(x.side) ? 1 : -1); });
      d.forEach(x => raw.push([+x.ts, +x.price, +x.size, /buy/i.test(x.side) ? 1 : -1]));
      idLess = d[d.length - 1].tradeId;
      if (+d[d.length - 1].ts < since) break;
    }
    raw.sort((a, b) => a[0] - b[0]);
    let g = null;
    raw.filter(x => x[0] >= since).forEach(x => { if (g && g.t === x[0] && g.s === x[3]) { g.pq += x[1] * x[2]; g.q += x[2]; } else { if (g) addTrade(g.t, g.pq / g.q, g.q, g.s); g = { t: x[0], s: x[3], q: x[2], pq: x[1] * x[2] }; } });
    if (g) addTrade(g.t, g.pq / g.q, g.q, g.s);
  }

  // ---------- สด ----------
  function openWS() {
    closeWS();
    try {
      if (src === 'binance') {
        ws = new WebSocket(`wss://fstream.binance.com/ws/${SYM.toLowerCase()}@aggTrade`);
        ws.onmessage = e => { const x = JSON.parse(e.data); if (x.e === 'aggTrade') { lastMsg = Date.now(); if (lastId && x.a > lastId + 1) gapFill(); if (x.a > lastId) { if (covHi === lastId) covHi = x.a; lastId = x.a; addTrade(x.T, +x.p, +x.q, x.m ? -1 : 1, false, x.a); live(x.T); } } };
      } else {
        ws = new WebSocket('wss://ws.bitget.com/v2/ws/public');
        ws.onopen = () => { ws.send(JSON.stringify({ op: 'subscribe', args: [{ instType: 'USDT-FUTURES', channel: 'trade', instId: SYM }] })); wsTimer = setInterval(() => { try { ws.send('ping'); } catch (e) {} }, 25000); };
        ws.onmessage = e => { lastMsg = Date.now(); if (e.data === 'pong') return; const m = JSON.parse(e.data); (m.data || []).forEach(x => { if (window.OIVolumeSink) window.OIVolumeSink('bitget', x.tradeId, +x.ts, +x.price, +x.size, /buy/i.test(x.side) ? 1 : -1); addTrade(+x.ts, +x.price, +x.size, /buy/i.test(x.side) ? 1 : -1); live(+x.ts); }); };
      }
      ws.onclose = () => { if (collecting()) setTimeout(() => { if (collecting() && (!ws || ws.readyState > 1)) openWS(); }, 5000); };
    } catch (e) {}
  }
  function closeWS() { clearInterval(wsTimer); if (ws) { ws.onclose = null; try { ws.close(); } catch (e) {} ws = null; } }
  let lastLive = 0, lastAlert = 0;
  function live(t) {
    // ไม้ใหม่ใหญ่มาก (≥ 3 เท่าเกณฑ์) → แจ้งในแอป
    const x = trades[trades.length - 1];
    if (cfg.on && x && x.t === t && x.q >= thrCache * 3 && Date.now() - lastAlert > 20000 && (!window.OIAlerts || OIAlerts.on('whale'))) { lastAlert = Date.now(); O.showToast && O.showToast(`🐋 ไม้ใหญ่ ${x.s > 0 ? '<b style="color:#2fe3a6">ไล่ซื้อ</b>' : '<b style="color:#ff6b82">ไล่ขาย</b>'} ${x.q.toFixed(2)} oz @ ${(x.p - offAt(barOf(x.t))).toFixed(2)}`, 6000); }
    if (x && x.t === t && x.q >= thrCache && Date.now() - lastLive > 500) { lastLive = Date.now(); O.markDirty(); }
  }
  // V4.3.3: เติมไม้ที่หายระหว่างสายหลุด/แอปอยู่เบื้องหลัง (ไล่จาก id ล่าสุดที่มี ไปข้างหน้า)
  async function gapFill() {
    if (filling || src !== 'binance' || !lastId || busy) return; filling = true;
    try {
      for (let k = 0; k < 120; k++) {
        const a = await page(lastId + 1); if (!a.length) break;
        a.forEach(x => { if (x.a > lastId) { if (covHi === lastId) covHi = x.a; lastId = x.a; addTrade(x.T, +x.p, +x.q, x.m ? -1 : 1, false, x.a); } });
        O.markDirty();
        if (a.length < 1000) break;
        await sleep(700);
      }
      trades.sort((a, b) => a.t - b.t); saveCache();
    } catch (e) {} finally { filling = false; }
  }
  // สายเงียบ > 45 วิ (ตลาด perp เปิด 24 ชม. แต่ช่วงเงียบมีไม้น้อย) → ต่อใหม่ + เติมช่วงที่ขาด
  setInterval(() => { if (!collecting() || busy || document.visibilityState === 'hidden') return; if (lastMsg && Date.now() - lastMsg > 45000) { lastMsg = Date.now(); openWS(); gapFill(); } }, 15000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && collecting() && !busy) { if (!ws || ws.readyState > 1) openWS(); gapFill(); loadKlines().then(() => O.markDirty()); } });
  setInterval(() => { if (collecting() && !busy) saveCache(); }, 5 * 60e3);
  // ตัดไม้เล็ก/เก่าทิ้งเป็นระยะ ไม่ให้หน่วยความจำโต
  setInterval(() => { if (!collecting()) return; const T = thr() * 0.5, since = Math.min(Date.now() - (cfg.hours + 1) * 3600e3, sinceT || Infinity); trades = trades.filter(x => x.q >= Math.min(T, MINQ) && x.t >= since); }, 60000);

  async function reload() {
    if (busy || !collecting()) return; busy = true; curTf = O.tf;
    status = 'กำลังโหลด…'; paintInfo();
    try { await loadKlines(); await backfill(); thrAt = 0; thr(); if (collecting()) openWS(); status = ''; } catch (e) { status = 'โหลดไม่ได้: ' + (e.message || e); }
    busy = false; paintInfo(); O.markDirty();
    if (pendingCollection) { pendingCollection = false; if (collecting()) setTimeout(reload, 0); }
  }
  // Delta/ราคาอ้างอิงอัปเดตทุก 30 วินาที · เปลี่ยน TF → โหลด klines ใหม่ (ไม้ใหญ่ใช้ชุดเดิม)
  setInterval(async () => {
    if (!collecting() || busy) return;
    if (curTf !== O.tf) { curTf = O.tf; await loadKlines(); O.markDirty(); paintInfo(); return; }
    if (src === 'binance' || !pxOff.size) { await loadKlines(); O.markDirty(); paintInfo(); }
  }, 3000 * 10);
  setInterval(() => {
    // Mobile cold start/resume: raw trades can arrive before chart bars or price reference.
    // Retry the reference even during history backfill, for either exchange.
    if (!collecting() || document.visibilityState === 'hidden') return;
    if ((!busy && curTf !== O.tf) || !pxOff.size) {
      if ((O.series.data() || []).length < 3) return;
      curTf = O.tf; loadKlines().then(() => { O.markDirty(); paintInfo(); });
    }
  }, 1500);

  // ---------- วาด ----------
  O.hooks.push((ctx, w, h) => {
    if (!cfg.on) return;
    const ts = O.chart.timeScale(), sr = O.series, plotW = ts.width(), plotH = h - ts.height();
    const mono = getComputedStyle(document.documentElement).getPropertyValue('--mono') || 'monospace';
    const sp = ts.options().barSpacing || 6, T = thr();
    ctx.save();
    // 1) ไม้ใหญ่: รวมไม้แท่งเดียวกัน ฝั่งเดียวกัน ที่อยู่ใกล้กันบนจอ (< 8px) แล้วเก็บ 4 กลุ่มใหญ่สุดต่อแท่งต่อฝั่ง
    const groups = new Map();
    trades.forEach(x => { if (x.q < T) return; const bt = barOf(x.t), k = bt + '|' + x.s; (groups.get(k) || groups.set(k, []).get(k)).push({ p: x.p - offAt(bt), q: x.q }); });
    const list = [];
    groups.forEach((arr, k) => {
      const [bt, s] = k.split('|').map(Number); const x = ts.timeToCoordinate(bt); if (x === null || x < 0 || x > plotW) return;
      arr.sort((a, b) => a.p - b.p); const cl = [];
      arr.forEach(t => { const y = sr.priceToCoordinate(t.p); if (y === null) return; const c = cl[cl.length - 1]; if (c && Math.abs(c.y - y) < 8) { c.pq += t.p * t.q; c.q += t.q; c.y = sr.priceToCoordinate(c.pq / c.q); } else cl.push({ y, pq: t.p * t.q, q: t.q }); });
      cl.sort((a, b) => b.q - a.q).slice(0, 4).forEach(c => list.push({ x, y: c.y, q: c.q, s }));
    });
    list.sort((a, b) => a.q - b.q);
    const rMax = Math.max(6, Math.min(16, sp * 0.9));
    list.forEach(a => {
      if (a.y < 0 || a.y > plotH) return;
      const r = Math.max(3, Math.min(rMax, 2.5 + 4 * Math.sqrt(a.q / T)));
      ctx.globalAlpha = 0.28; ctx.fillStyle = a.s > 0 ? '#22e39a' : '#ff4d6a'; ctx.beginPath(); ctx.arc(a.x, a.y, r, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 0.9; ctx.lineWidth = 1.3; ctx.strokeStyle = a.s > 0 ? '#22e39a' : '#ff4d6a'; ctx.stroke();
    });
    // ป้ายขนาดเฉพาะ 3 ไม้ใหญ่สุดที่มองเห็น
    list.filter(a => a.y >= 0 && a.y <= plotH).sort((a, b) => b.q - a.q).slice(0, 3).forEach(a => { const r = Math.max(3, Math.min(rMax, 2.5 + 4 * Math.sqrt(a.q / T))); ctx.globalAlpha = 1; ctx.font = `bold 9px ${mono}`; ctx.fillStyle = a.s > 0 ? '#9ff5cf' : '#ffb3bf'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillText(`${a.s > 0 ? 'B' : 'S'}${a.q >= 100 ? Math.round(a.q) : a.q.toFixed(1)}`, a.x + r + 2, a.y); });
    // 2) Delta ต่อแท่ง: แถบล่างของกราฟ (ตัวเลขเมื่อแท่งกว้างพอ ไม่งั้นเป็นแท่งสี)
    if (cfg.delta && delta.size) {
      const B = O.series.data() || [], lr = ts.getVisibleLogicalRange(); if (lr) {
        const i0 = Math.max(0, Math.floor(lr.from)), i1 = Math.min(B.length - 1, Math.ceil(lr.to));
        let mx = 1; for (let i = i0; i <= i1; i++) { const d = delta.get(B[i].time); if (d) mx = Math.max(mx, Math.abs(d.b - d.s)); }
        const base = plotH - 4, H = 16;
        for (let i = i0; i <= i1; i++) {
          const b = B[i], d = delta.get(b.time); if (!d) continue;
          const x = ts.timeToCoordinate(b.time); if (x === null) continue;
          const v = d.b - d.s, col = v >= 0 ? '#22e39a' : '#ff4d6a';
          if (sp >= 26) { ctx.globalAlpha = 0.95; ctx.font = `bold 9px ${mono}`; ctx.fillStyle = col; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom'; ctx.fillText((v > 0 ? '+' : '') + (Math.abs(v) >= 100 ? Math.round(v) : v.toFixed(1)), x, base); }
          else { const hh = Math.max(1, Math.abs(v) / mx * H); ctx.globalAlpha = 0.75; ctx.fillStyle = col; ctx.fillRect(x - Math.max(1, sp * 0.35), v >= 0 ? base - hh : base - H, Math.max(2, sp * 0.7), v >= 0 ? hh : Math.max(1, hh)); }
        }
        ctx.globalAlpha = 0.6; ctx.font = `9px ${mono}`; ctx.fillStyle = '#8a93ad'; ctx.textAlign = 'left'; ctx.textBaseline = 'bottom'; ctx.fillText('Δ ซื้อ−ขาย', 4, base - (sp >= 26 ? 10 : H + 1));
      }
    }
    ctx.restore();
  });

  // ---------- เมนู ƒx ----------
  function paintInfo() {
    const el = $('btInfo'); if (!el) return;
    if (!cfg.on) { el.textContent = ''; return; }
    const T = thr(), since = sinceT || Date.now() - cfg.hours * 3600e3, n = trades.filter(x => x.q >= T && x.t >= since), nb = n.filter(x => x.s > 0).length;
    const B = O.series.data() || [], lt = B.length ? delta.get(B[B.length - 1].time) : null;
    el.textContent = status || `${src === 'bitget' ? 'Bitget' : 'Binance'} · ไม้ใหญ่ ≥ ${T} oz${cfg.auto ? ' (อัตโนมัติ)' : ''} · ${cfg.hours} ชม.: ซื้อ ${nb} / ขาย ${n.length - nb}` + (lt ? ` · Δ แท่งนี้ ${(lt.b - lt.s) >= 0 ? '+' : ''}${(lt.b - lt.s).toFixed(1)}` : '') + (closedAnchor ? ' · ตลาดปิด: นับจากแท่งสุดท้าย' : '') + (limited ? ' · Binance ย้อนได้แค่ 2 วัน' : '');
  }
  setInterval(paintInfo, 5000);
  function section() {
    const d = document.createElement('div');
    d.id = 'btBox'; d.className = 'gsbox';
    d.innerHTML = `<div class="row"><button class="gsb${cfg.on ? ' on' : ''}" data-btt="on"><i style="background:linear-gradient(90deg,#22e39a 50%,#ff4d6a 50%)"></i>🐋 Big Traders (ไม้ใหญ่ + Delta)</button><span id="btInfo" class="gsinfo"></span></div>` +
      (cfg.on ? `<div class="row ps"><button class="gsb${cfg.delta ? ' on' : ''}" data-btt="delta">Δ ซื้อ−ขาย ต่อแท่ง</button><button class="gsb${cfg.auto ? ' on' : ''}" data-btt="auto">เกณฑ์อัตโนมัติ</button>
        <label>ไม้ใหญ่ ≥ (oz)<input type="number" inputmode="decimal" step="0.5" data-bt="thr" value="${cfg.thr}" ${cfg.auto ? 'disabled' : ''}></label>
        <label>ย้อนหลัง (ชม.)<input type="number" inputmode="numeric" data-bt="hours" value="${cfg.hours}"></label></div>` : '');
    return d;
  }
  function mount() { const m = $('indMenu'); if (!m || m.hidden || $('btBox')) return; const box = section(), anchor = $('ivBox') || m.querySelector('.t'); anchor ? anchor.after(box) : m.prepend(box); paintInfo(); }
  function remount() { const b = $('btBox'); if (b) b.remove(); mount(); }
  const menu = $('indMenu');
  if (menu) {
    new MutationObserver(() => mount()).observe(menu, { childList: true });
    menu.addEventListener('click', e => {
      const t = e.target.closest('[data-btt]'); if (!t) return;
      const k = t.dataset.btt; cfg[k] = !cfg[k]; save();
      if (k === 'on') { if (cfg.on) reload(); else if (!collecting()) { closeWS(); trades = []; delta = new Map(); O.markDirty(); } }
      O.markDirty(); remount();
      if (cfg.on) $('indBtn').classList.add('has');
    });
    menu.addEventListener('change', e => {
      const inp = e.target.closest('[data-bt]'); if (!inp) return;
      let v = parseFloat(inp.value);
      if (inp.dataset.bt === 'hours') { v = Math.max(1, Math.min(24, Math.round(v || 24))); cfg.hours = v; save(); reload(); }
      else { v = Math.max(0.1, v || 5); cfg.thr = v; save(); }
      inp.value = v; O.markDirty(); paintInfo();
    });
  }
  if (collecting()) setTimeout(reload, 3500);
  if (window.OIAlerts) OIAlerts.reg('whale', 'ไม้ใหญ่ 🐋 Big Traders', { desc: 'ไม้ไล่ซื้อ/ไล่ขายใหญ่กว่าเกณฑ์ 3 เท่า', active: () => cfg.on });
  window.OI_bigtr = { get pxOff() { return pxOff; }, offAt, anchorMs, get busy() { return busy; }, get status() { return status; }, get limited() { return limited; }, syncCollection() { if (collecting()) { if (busy) pendingCollection = true; else reload(); } else closeWS(); }, get cfg() { return cfg; }, get trades() { return trades; }, get delta() { return delta; }, get src() { return src; }, thr, reload };
})();


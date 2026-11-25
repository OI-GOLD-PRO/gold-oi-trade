// Volume Profile: all trade sizes, actual executed quantity (oz), one exchange at a time.
// Shared raw feed with Big Traders. Never uses retail-filtered rows, OI or candle estimates.
(() => {
  'use strict';
  const O = window.OI;
  if (!O || !O.hooks || !['gold', 'gcy'].includes(O.sym)) return;
  const $ = id => document.getElementById(id), KEY = 'oit_vprofile' + (O.psfx || ''), STORE = 'oit_vprofile_data_v1';
  const cfg = { on: false, res: 1, win: 8, mode: 'all', poc: true };
  try { Object.assign(cfg, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch (_) {}
  const RES = [0.1, 0.5, 1, 2, 5, 10], WINS = [1, 4, 8, 24], MODES = ['all', 'delta'];
  // Keep raw price cents as integer ticks so custom $0.1 rows do not inherit coarse $1 rounding.
  const normRes = v => Number.isFinite(+v) && +v > 0 ? Math.min(1000, Math.max(0.1, Math.round(+v * 10) / 10)) : null;
  const normWin = v => Number.isFinite(+v) && +v > 0 ? Math.min(24, Math.max(0.1, Math.round(+v * 10) / 10)) : null;
  cfg.res = normRes(cfg.res) ?? 1;
  cfg.win = normWin(cfg.win) ?? 8;
  if (!MODES.includes(cfg.mode)) cfg.mode = 'all';
  const MINUTE = 60000, KEEP = 72 * 3600e3, BUY = '#38bdf8', SELL = '#f97316';
  // Per exchange/minute: price -> [buy oz, sell oz], and exact trade-id ranges for dedup.
  let buckets = new Map(), dirty = false, revision = 0, cache = null, hit = [], down = null;
  let footprintOn = false, diamondsOn = false, repaint = null;
  const needsFootprint = () => footprintOn || diamondsOn;
  const collecting = () => cfg.on || needsFootprint();
  const FOOTPRINT_HOURS = 24;
  const historyHours = () => Math.max(cfg.on ? cfg.win : 0, needsFootprint() ? FOOTPRINT_HOURS : 0);
  const saveCfg = () => { try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch (_) {} };
  function seen(ranges, id) {
    const n = BigInt(id); let lo = 0, hi = ranges.length;
    while (lo < hi) { const m = (lo + hi) >>> 1; if (ranges[m][1] < n) lo = m + 1; else hi = m; }
    if (lo < ranges.length && ranges[lo][0] <= n) return true;
    const left = lo > 0 && ranges[lo - 1][1] + 1n === n, right = lo < ranges.length && ranges[lo][0] - 1n === n;
    if (left && right) { ranges[lo - 1][1] = ranges[lo][1]; ranges.splice(lo, 1); }
    else if (left) ranges[lo - 1][1] = n;
    else if (right) ranges[lo][0] = n;
    else ranges.splice(lo, 0, [n, n]);
    return false;
  }
  function sink(source, id, t, p, q, side) {
    if (!collecting() || !['binance', 'bitget'].includes(source) || !Number.isFinite(t) || !Number.isFinite(p) || !Number.isFinite(q) || !(p > 0 && q > 0) || ![1, -1].includes(side) || t < Date.now() - KEEP || t > Date.now() + MINUTE) return;
    // Never count unidentified/replayed fills as new volume.
    if (id === undefined || !/^\d+$/.test(String(id))) return;
    const time = Math.floor(t / MINUTE) * MINUTE, key = source + '|' + time;
    let b = buckets.get(key);
    if (!b) { b = { source, time, ids: [], prices: new Map(), first: t, last: t }; buckets.set(key, b); }
    if (seen(b.ids, id)) return;
    const price = Math.round(p * 100), v = b.prices.get(price) || [0, 0];
    v[side > 0 ? 0 : 1] += q; b.prices.set(price, v);
    b.first = Math.min(b.first, t); b.last = Math.max(b.last, t);
    dirty = true; revision++;
    if (diamondsOn) deltaPending.add(key);
    if (needsFootprint() && repaint === null) repaint = setTimeout(() => {
      repaint = null;
      if (needsFootprint() && !O.paused && document.visibilityState === 'visible') O.markDirty();
    }, 100);
  }
  window.OIVolumeSink = sink;
  const DELTA_KEEP = 30 * 86400e3;
  const deltaArchive = new Map(), deltaPending = new Set();
  let deltaDB = null;

  function bucketTotals(bucket) {
    let buy = 0, sell = 0;
    if (bucket) for (const [b, s] of bucket.prices.values()) { buy += b; sell += s; }
    return { delta: buy - sell, total: buy + sell };
  }
  function openDeltaArchive() {
    if (deltaDB || !window.indexedDB) return;
    const request = window.indexedDB.open('oit_delta_history', 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore('minutes', { keyPath: 'key' }).createIndex('time', 'time');
    };
    request.onsuccess = () => {
      deltaDB = request.result;
      const tx = deltaDB.transaction('minutes', 'readwrite');
      const index = tx.objectStore('minutes').index('time');
      const cutoff = Date.now() - DELTA_KEEP;
      index.getAll(IDBKeyRange.lowerBound(cutoff)).onsuccess = e => {
        for (const row of e.target.result) {
          if (row.total > (deltaArchive.get(row.key)?.total ?? 0)) deltaArchive.set(row.key, row);
        }
        O.markDirty();
      };
      index.openCursor(IDBKeyRange.upperBound(cutoff, true)).onsuccess = e => {
        const cursor = e.target.result;
        if (cursor) { cursor.delete(); cursor.continue(); }
      };
      tx.oncomplete = flushDeltaArchive;
    };
  }
  function flushDeltaArchive() {
    const now = Date.now(), cutoff = now - DELTA_KEEP, rows = [];
    for (const key of deltaPending) {
      const bucket = buckets.get(key);
      if (!bucket || bucket.time < cutoff) { deltaPending.delete(key); continue; }
      if (bucket.time + MINUTE > now) continue;
      const value = bucketTotals(bucket);
      if (value.total <= 0) continue;
      // Backfill may initially have fewer trades than the copy already saved.
      const current = deltaArchive.get(key);
      if (!current || value.total > current.total) {
        const row = { key, time: bucket.time, ...value };
        deltaArchive.set(key, row);
      }
      if (deltaDB) { rows.push(deltaArchive.get(key)); deltaPending.delete(key); }
    }
    for (const [key, row] of deltaArchive) if (row.time < cutoff) deltaArchive.delete(key);
    if (!rows.length) return;
    const tx = deltaDB.transaction('minutes', 'readwrite');
    const store = tx.objectStore('minutes');
    for (const row of rows) {
      const request = store.get(row.key);
      request.onsuccess = () => {
        if (row.total > (request.result?.total ?? 0)) store.put(row);
      };
    }
    const expired = store.index('time').openCursor(IDBKeyRange.upperBound(cutoff, true));
    expired.onsuccess = () => {
      const cursor = expired.result;
      if (cursor) { cursor.delete(); cursor.continue(); }
    };
    tx.onabort = () => { for (const row of rows) deltaPending.add(row.key); };
  }
  function saveData() {
    if (!dirty) return;
    try {
      const data = [];
      buckets.forEach((b, k) => { if (b.time < Date.now() - KEEP) { buckets.delete(k); return; }
        data.push({ source: b.source, time: b.time, first: b.first, last: b.last, ids: b.ids.map(a => a.map(String)), prices: [...b.prices] }); });
      localStorage.setItem(STORE, JSON.stringify({ v: 2, data })); dirty = false;
    } catch (_) {} // Quota failure keeps the in-memory profile; never erase another indicator's data.
  }
  try {
    const j = JSON.parse(localStorage.getItem(STORE) || 'null');
    // Old $1 buckets cannot be split into true $0.1 data: rebuild from raw history.
    if (j && j.v === 2) (j.data || []).forEach(b => { if (b.time < Date.now() - KEEP || !['binance', 'bitget'].includes(b.source)) return;
      buckets.set(b.source + '|' + b.time, { ...b, ids: b.ids.map(a => a.map(BigInt)), prices: new Map(b.prices) }); });
  } catch (_) { buckets = new Map(); }
  const feed = () => window.OI_bigtr;
  const source = () => feed() && feed().src;
  const endTime = () => feed() ? feed().anchorMs().end : Date.now();
  function needFull(since) {
    // Whale cache contains large trades only; always request raw pages for a profile.
    // Dedup ranges make repeated backfills safe, including after restoring local data.
    return collecting();
  }
  function footprintWindow() {
    const end = feed()?.anchorMs(true).end ?? Date.now();
    return { start: end - FOOTPRINT_HOURS * 3600e3, end };
  }
  function footprint(start, end) {
    const src = source();
    if (!src) return [];
    const prices = new Map();
    const firstMinute = Math.ceil(Math.max(start, Date.now() - KEEP) / MINUTE) * MINUTE;
    for (let time = firstMinute; time < end; time += MINUTE) {
      const bucket = buckets.get(src + '|' + time);
      if (!bucket) continue;
      bucket.prices.forEach(([buy, sell], price) => {
        const key = Math.round(price / 10);
        const row = prices.get(key) || { price: key / 10, buy: 0, sell: 0 };
        row.buy += buy;
        row.sell += sell;
        prices.set(key, row);
      });
    }
    return [...prices.values()].sort((a, b) => b.price - a.price);
  }
  function footprintTotals(start, end, preferredOnly = false) {
    const preferred = source(), now = Date.now();
    function sum(src, archivedOnly) {
      let delta = 0, total = 0;
      const firstMinute = Math.ceil(Math.max(start, now - DELTA_KEEP) / MINUTE) * MINUTE;
      for (let time = firstMinute; time < end; time += MINUTE) {
        const key = src + '|' + time;
        const stored = deltaArchive.get(key);
        const live = archivedOnly ? null : buckets.get(key);
        const current = live ? bucketTotals(live) : null;
        const value = current && current.total >= (stored?.total ?? 0) ? current : stored;
        if (value) { delta += value.delta; total += value.total; }
      }
      return { delta, total };
    }
    const current = preferred ? sum(preferred, false) : { delta: 0, total: 0 };
    if (preferredOnly || current.total || end > now) return current;
    // Use a saved exchange only when the preferred one has no data for the candle.
    const fallback = preferred === 'binance' ? ['bitget'] : preferred === 'bitget' ? ['binance'] : ['binance', 'bitget'];
    for (const src of fallback) {
      const saved = sum(src, true);
      if (saved.total) return saved;
    }
    return current;
  }
  function setDiamonds(on) {
    if (diamondsOn === on) return;
    diamondsOn = on;
    if (on) {
      openDeltaArchive();
      for (const key of buckets.keys()) deltaPending.add(key);
    } else flushDeltaArchive();
    if (on || !collecting()) feed()?.syncCollection();
    if (!collecting()) saveData();
  }
  function setFootprint(on) {
    if (footprintOn === on) return;
    footprintOn = on;
    if (on || !collecting()) feed()?.syncCollection();
    if (!collecting()) saveData();
  }
  function profile() {
    const src = source(), end = endTime(), start = Math.floor((end - cfg.win * 3600e3) / MINUTE) * MINUTE;
    const key = [src, start, Math.floor(end / MINUTE), cfg.res, revision].join('|');
    if (cache && cache.key === key) return cache.value;
    const prices = new Map(), rowTicks = Math.round(cfg.res * 100); let first = Infinity, last = 0;
    buckets.forEach(b => { if (b.source !== src || b.time < start || b.time >= end) return;
      first = Math.min(first, b.first); last = Math.max(last, b.last);
      b.prices.forEach((v, p) => { const k = Math.round(p / rowTicks) * rowTicks / 100, a = prices.get(k) || [0, 0]; a[0] += v[0]; a[1] += v[1]; prices.set(k, a); }); });
    const rows = [...prices].map(([p, v]) => ({ p, buy: v[0], sell: v[1], total: v[0] + v[1], delta: v[0] - v[1] })).sort((a, b) => a.p - b.p);
    const total = rows.reduce((s, r) => s + r.total, 0), poc = rows.reduce((a, r) => !a || r.total > a.total ? r : a, null);
    const value = { rows, total, poc, source: src, first, last, start, end };
    cache = { key, value }; return value;
  }
  const fmt = n => n >= 1000 ? (n / 1000).toFixed(1) + 'k' : n.toFixed(2);
  // Lock the price basis from paired CLOSED candles, never from the moving last close.
  // A new TF or refreshed klines must not drag historical volume with each live tick.
  let alignment = null;
  function offset() {
    const f = feed(); if (!f || !f.src) return null;
    const key = [f.src, O.src || '', O.sym].join('|');
    const adj = O.sym === 'gold' && Number.isFinite(O.adj) ? O.adj : 0;
    if (alignment && alignment.key === key) return alignment.shift + adj - alignment.adj;
    const bars = O.series.data() || [], differences = [];
    for (let i = bars.length - 2; i >= 0 && differences.length < 5; i--) {
      const b = bars[i], reference = f.pxOff.get(b.time);
      if (Number.isFinite(reference) && Number.isFinite(b.close)) differences.push(reference - b.close);
    }
    if (!differences.length) return null;
    differences.sort((a, b) => a - b);
    const mid = Math.floor(differences.length / 2);
    const shift = differences.length % 2 ? differences[mid] : (differences[mid - 1] + differences[mid]) / 2;
    alignment = { key, shift, adj }; return shift;
  }
  (O.bgHooks || O.hooks).push((ctx, w, h) => {
    hit = [];
    if (!cfg.on || !feed() || !feed().pxOff.size) return;
    const P = profile(); if (!P.rows.length) return;
    const ts = O.chart.timeScale(), width = ts.width(), height = h - ts.height(), shift = offset();
    if (shift === null) return;
    const maxWidth = Math.min(180, width * 0.32);
    const visible = P.rows.map(r => {
      const p = r.p - shift;
      return { r, p, a: O.series.priceToCoordinate(p + cfg.res / 2), b: O.series.priceToCoordinate(p - cfg.res / 2) };
    }).filter(v => v.a !== null && v.b !== null && Number.isFinite(v.a) && Number.isFinite(v.b) && v.b >= 0 && v.a <= height);
    // Scale against visible rows; a large trade outside the mobile viewport must not hide every bar.
    const max = visible.reduce((m, v) => Math.max(m, cfg.mode === 'delta' ? Math.abs(v.r.delta) : v.r.total), 1e-9);
    if (width <= 0 || height <= 0) return;
    ctx.save(); ctx.beginPath(); ctx.rect(0, 0, width, height); ctx.clip();
    ctx.font = 'bold 9px monospace'; ctx.textBaseline = 'middle';
    visible.forEach(({ r, p, a, b }) => {
      const y = Math.max(0, Math.floor(a)), bottom = Math.min(height, b), barH = Math.max(1, Math.floor(bottom - y - 1));
      const amount = cfg.mode === 'delta' ? Math.abs(r.delta) : r.total;
      if (!(amount > 0)) return;
      const len = Math.min(maxWidth, Math.max(1, maxWidth * amount / max));
      const x = width - len, strong = P.poc === r;
      ctx.globalAlpha = strong ? 0.95 : 0.72;
      if (cfg.mode === 'all') { const buyW = len * r.buy / r.total;
        ctx.fillStyle = BUY; ctx.fillRect(x, y, buyW, barH);
        ctx.fillStyle = SELL; ctx.fillRect(x + buyW, y, len - buyW, barH);
      } else { ctx.fillStyle = r.delta >= 0 ? BUY : SELL; ctx.fillRect(x, y, len, barH); }
      if (barH >= 10 && len >= 44) { ctx.globalAlpha = 1; ctx.fillStyle = '#fff'; ctx.textAlign = 'right'; ctx.fillText((cfg.mode === 'delta' && r.delta > 0 ? '+' : '') + fmt(cfg.mode === 'delta' ? r.delta : r.total), width - 3, y + barH / 2); }
      hit.push({ x, y, bottom: Math.max(bottom, y + 3), r, p });
    });
    if (cfg.poc && P.poc) { const p = P.poc.p - shift, y = O.series.priceToCoordinate(p);
      if (y !== null && y >= 0 && y <= height) { ctx.globalAlpha = 0.85; ctx.strokeStyle = '#a7f3b5'; ctx.lineWidth = 1; ctx.setLineDash([5, 4]); ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke(); ctx.setLineDash([]); ctx.fillStyle = '#a7f3b5'; ctx.textAlign = 'left'; ctx.fillText('VP POC ' + p.toFixed(2), 6, Math.max(7, y - 8)); }
    }
    ctx.restore();
  });
  O.chartEl.addEventListener('pointerdown', e => { down = [e.clientX, e.clientY]; }, true);
  O.chartEl.addEventListener('pointerup', e => {
    if (!cfg.on || !down) return;
    const d = down; down = null; if (Math.hypot(e.clientX - d[0], e.clientY - d[1]) > 8) return;
    const rect = O.chartEl.getBoundingClientRect(), x = e.clientX - rect.left, y = e.clientY - rect.top;
    const z = hit.find(a => x >= a.x && x <= O.chart.timeScale().width() && y >= a.y && y <= a.bottom);
    if (z && O.showToast) { const r = z.r; setTimeout(() => O.showToast('Volume Profile · ' + source() + '<br>ราคา ' + z.p.toFixed(2) + '<br><b style="color:' + BUY + '">ซื้อ ' + fmt(r.buy) + '</b> · <b style="color:' + SELL + '">ขาย ' + fmt(r.sell) + '</b><br>รวม ' + fmt(r.total) + ' oz · Δ ' + fmt(r.delta) + ' oz', 6500), 150); }
  }, true);
  function info() {
    const f = feed(), p = profile();
    if (!f) return 'กำลังรอระบบรับข้อมูล…';
    const status = f.busy ? (f.status || 'กำลังโหลดย้อนหลัง…') : f.status;
    if (!p.rows.length) return status || 'รอธุรกรรมจริงจาก ' + (source() || 'ตลาด') + '…';
    if (offset() === null) return 'รับธุรกรรมแล้ว · รอราคาอ้างอิงจากแท่งปิด…';
    const hrs = Math.max(0, (p.end - p.first) / 3600e3);
    return (source() || '') + ' · ' + fmt(p.total) + ' oz · ข้อมูลที่รับได้ ' + Math.min(cfg.win, hrs).toFixed(1) + '/' + cfg.win + ' ชม.' + (status ? ' · ' + status : '') + (f.limited ? ' · ประวัติจากตลาดมีจำกัด' : '');
  }
  function section() {
    const d = document.createElement('div'); d.id = 'vpBox'; d.className = 'gsbox';
    d.innerHTML = `<div class="row"><button class="gsb${cfg.on ? ' on' : ''}" data-vp="on"><i style="background:linear-gradient(90deg,${BUY} 50%,${SELL} 50%)"></i>Volume Profile · ซื้อขายทั้งหมด</button><span class="gsinfo" id="vpInfo">${cfg.on ? info() : ''}</span></div>` +
      (cfg.on ? `<div class="row ps"><label>ขนาดแถว ($)<input type="number" inputmode="decimal" min="0.1" max="1000" step="0.1" data-vpin="res" value="${cfg.res}" style="width:76px;max-width:100%"></label></div><div class="row ps"><span class="gsinfo">เลือกเร็ว</span>${RES.map(r => `<button class="gsb${cfg.res === r ? ' on' : ''}" data-vpres="${r}">$${r}</button>`).join('')}</div><div class="row ps"><label>ย้อนหลัง (ชม.)<input type="number" inputmode="decimal" min="0.1" max="24" step="0.1" data-vpin="win" value="${cfg.win}" style="width:76px;max-width:100%"></label></div><div class="row ps"><span class="gsinfo">เลือกเร็ว</span>${WINS.map(h => `<button class="gsb${cfg.win === h ? ' on' : ''}" data-vpwin="${h}">${h} ชม.</button>`).join('')}</div><div class="row ps">${MODES.map(m => `<button class="gsb${cfg.mode === m ? ' on' : ''}" data-vpmode="${m}">${m === 'all' ? 'ซื้อ + ขาย' : 'Δ ซื้อ−ขาย'}</button>`).join('')}<button class="gsb${cfg.poc ? ' on' : ''}" data-vp="poc">POC</button></div><div class="row ps"><span class="gsinfo">ทุกขนาดไม้ · ปริมาณ oz · ไม่ถ่วงอายุ · ฟ้าซื้อ / ส้มขาย · แสดงทีละตลาด perp<br>ช่วงเวลาปัดเป็นนาที · แถวราคาละเอียดได้ถึง $0.1 · POC = แถวที่วอลลุ่มรวมสูงสุด<br>แสดงเฉพาะข้อมูลที่รับได้ อาจไม่ครบช่วงที่เลือก ไม่ใช่วอลลุ่มรวมทุกตลาดหรือ CME</span></div>` : ''); return d;
  }
  function mount() { const m = $('indMenu'); if (!m || m.hidden || $('vpBox')) return; const a = $('rtBox') || m.querySelector('.t'), d = section(); a ? a.after(d) : m.prepend(d); }
  function remount() { const d = $('vpBox'); if (d) d.remove(); mount(); }
  const menu = $('indMenu');
  if (menu) {
    new MutationObserver(mount).observe(menu, { childList: true });
    menu.addEventListener('click', e => {
      const b = e.target.closest('[data-vp],[data-vpres],[data-vpwin],[data-vpmode]'); if (!b) return;
      let sync = false;
      if (b.dataset.vp) { cfg[b.dataset.vp] = !cfg[b.dataset.vp]; sync = b.dataset.vp === 'on'; if (!cfg.on) { saveData(); hit = []; } }
      if (b.dataset.vpres && RES.includes(+b.dataset.vpres)) cfg.res = +b.dataset.vpres;
      if (b.dataset.vpwin && WINS.includes(+b.dataset.vpwin)) { sync = +b.dataset.vpwin > cfg.win; cfg.win = +b.dataset.vpwin; }
      if (MODES.includes(b.dataset.vpmode)) cfg.mode = b.dataset.vpmode;
      saveCfg(); cache = null; remount(); O.markDirty();
      if (sync && feed()) feed().syncCollection();
    });
  }
  if (menu) menu.addEventListener('change', e => {
    const input = e.target.closest('[data-vpin]'); if (!input) return;
    const key = input.dataset.vpin;
    if (key !== 'res' && key !== 'win') return;
    const value = key === 'res' ? normRes(input.value) : normWin(input.value);
    if (value === null) { input.value = cfg[key]; return; }
    const sync = key === 'win' && value > cfg.win;
    cfg[key] = value; input.value = value;
    saveCfg(); cache = null; remount(); O.markDirty();
    if (sync && cfg.on && feed()) feed().syncCollection();
  });
  setInterval(() => { if (!cfg.on || O.paused || document.visibilityState !== 'visible') return; O.markDirty(); const e = $('vpInfo'); if (e) e.textContent = info(); }, 1000);
  setInterval(saveData, 60000);
  setInterval(flushDeltaArchive, 30000);
  window.addEventListener('pagehide', flushDeltaArchive);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') { flushDeltaArchive(); saveData(); } });
  window.OI_volumeProfile = { cfg, profile, needFull, historyHours, footprintWindow, footprint, footprintTotals, setFootprint, setDiamonds, offset, save: saveData };
})();

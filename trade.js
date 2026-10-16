// OI Gold Pro Trade — order ticket, draggable entry/SL/TP on the chart, positions, account strip.
// Talks to the hub (HUB/app/state, HUB/app/cmd). The chart is already in broker price scale (see index.html).
(function () {
  'use strict';
  const O = window.OI;
  if (!O) return;
  const $ = id => document.getElementById(id);
  const css = getComputedStyle(document.documentElement);
  const C = k => css.getPropertyValue(k).trim();
  const esc = s => String(s).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));

  const SNAP_PX = 12;            // snap SL/TP/entry to an OI wall when this close (px)
  const DEF_SL = 5, DEF_TP = 10; // default SL/TP distance ($) when switched on
  const POLL_MS = 1000;

  // ---------------- state ----------------
  let S = null;                // latest EA state from hub
  let online = false, ageMs = null, lastOkAt = 0;
  let brokerBasis = null;      // EMA of (perp − broker mid)
  const pend = new Map();      // cmd id → label, waiting for result
  const T = { side: 'BUY', mode: 'MARKET', lots: 0.01, entry: null, sl: null, tp: null, slOn: false, tpOn: false, risk: 0, snap: true, mod: null };
  try { Object.assign(T, JSON.parse(localStorage.getItem('oit_tk') || '{}'), { mode: 'MARKET', entry: null, sl: null, tp: null, slOn: false, tpOn: false, mod: null }); } catch (e) {}
  const savePrefs = () => { try { localStorage.setItem('oit_tk', JSON.stringify({ side: T.side, mode: T.mode, lots: T.lots, risk: T.risk, snap: T.snap })); } catch (e) {} };

  // ---------------- helpers ----------------
  const sym = () => (S && S.symbol) || null;
  const acc = () => (S && S.account) || null;
  const dg = () => (sym() && sym().digits) || 2;
  const fx = (n, d = 2) => (n === null || n === undefined || !isFinite(n)) ? '–' : Number(n).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
  const sg = (n, d = 2) => (n === null || !isFinite(n)) ? '–' : (n > 0 ? '+' : n < 0 ? '−' : '') + fx(Math.abs(n), d);
  const cls = n => n > 0 ? 'pos' : n < 0 ? 'neg' : '';
  function roundPx(p) {
    const s = sym(); const ts = s && s.tick_size > 0 ? s.tick_size : 0.01;
    return +(Math.round(p / ts) * ts).toFixed(dg());
  }
  // money per 1.0 price move per 1 lot (account currency)
  const perUnit = () => { const s = sym(); return s && s.tick_size > 0 ? s.tick_value / s.tick_size : null; };
  const stepDec = () => { const st = (sym() && sym().vol_step) || 0.01; return Math.max(0, Math.min(4, Math.round(-Math.log10(st)))); };
  function normLots(l) {
    const s = sym(); const st = (s && s.vol_step) || 0.01, mn = (s && s.vol_min) || 0.01, mx = (s && s.vol_max) || 100;
    l = Math.floor(l / st + 1e-9) * st;
    return +Math.min(mx, Math.max(mn, l)).toFixed(stepDec());
  }
  const vib = ms => { try { navigator.vibrate && navigator.vibrate(ms); } catch (e) {} };

  // the price an order would fill at / the entry being edited
  function entryPrice() {
    if (T.mod) return T.mod.isOrder ? T.entry : T.mod.open;
    if (T.mode === 'MARKET') { const s = sym(); return s ? (T.side === 'BUY' ? s.ask : s.bid) : (O.lastClose ?? null); }
    return T.entry;
  }
  function pendingKind() {
    const s = sym(), e = T.entry; if (!s || e === null) return 'LIMIT';
    return T.side === 'BUY' ? (e < s.ask ? 'LIMIT' : 'STOP') : (e > s.bid ? 'LIMIT' : 'STOP');
  }
  const lotsNow = () => T.mod ? T.mod.lots : effLots();
  function effLots() {
    const a = acc(), pu = perUnit(), e = entryPrice();
    if (T.risk > 0 && T.slOn && a && pu && e !== null && T.sl !== null) {
      const dist = Math.abs(e - T.sl);
      if (dist > 0) return normLots(a.equity * T.risk / 100 / (dist * pu));
    }
    return T.lots;
  }
  const money = (from, to) => { const pu = perUnit(); if (!pu || from === null || to === null) return null; const d = T.side === 'BUY' ? to - from : from - to; return d * lotsNow() * pu; };
  const wrongSide = (k, v) => { const e = entryPrice(); if (e === null || v === null) return false; const buy = T.side === 'BUY'; return k === 'sl' ? (buy ? v >= e : v <= e) : (buy ? v <= e : v >= e); };

  // ---------------- hub ----------------
  async function api(path, body) {
    const r = await fetch(O.HUB + path, { method: body ? 'POST' : 'GET', cache: 'no-store', headers: { 'X-Key': O.authCode || '', 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    return r.json();
  }
  let polling = false;
  async function poll() {
    if (polling || !O.authCode || document.visibilityState !== 'visible') return;
    polling = true;
    try {
      const d = await api('/app/state');
      if (d.ok) {
        lastOkAt = Date.now();
        online = !!d.online; ageMs = d.age_ms; S = d.state || S;
        handleResults(d.results || []);
        updateBasis();
      }
    } catch (e) { /* keep last state */ }
    polling = false;
    if (Date.now() - lastOkAt > 8000) online = false;
    render();
  }
  setInterval(poll, POLL_MS);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') poll(); });

  // chart follows the broker price while the EA is online
  function updateBasis() {
    const s = sym();
    if (!online || !s || !(s.bid > 0) || O.rawClose === null) { if (!online && brokerBasis !== null) { brokerBasis = null; O.clearBrokerBasis(); } return; }
    const b = O.rawClose - (s.bid + s.ask) / 2;
    if (!isFinite(b) || Math.abs(b) > 40) return;
    brokerBasis = brokerBasis === null ? b : brokerBasis * 0.8 + b * 0.2;
    O.setBrokerBasis(brokerBasis);
  }
  window.OIT_state = () => S;
  window.OIT_brokerPrice = () => (online && sym() && sym().bid > 0) ? sym().bid : null;

  function handleResults(list) {
    for (const r of list) {
      if (!pend.has(r.id)) continue;
      if (r.status === 'done') { O.showToast(`✅ ${esc(pend.get(r.id))} สำเร็จ${r.ticket ? ' <b>#' + r.ticket + '</b>' : ''}`, 5000); vib(30); pend.delete(r.id); }
      else if (r.status === 'failed' || r.status === 'expired') { O.showToast(`⚠️ ${esc(pend.get(r.id))} ไม่สำเร็จ: ${esc(r.msg || r.status)}`, 10000); vib([80, 60, 80]); pend.delete(r.id); }
    }
  }

  async function send(cmd, label, ask = true) {
    if (!online) { O.showToast('EA ออฟไลน์ ส่งคำสั่งไม่ได้'); return false; }
    if (ask && !confirm('ยืนยัน: ' + label)) return false;
    try {
      const d = await api('/app/cmd', cmd);
      if (!d.ok) { O.showToast('⚠️ ส่งไม่สำเร็จ: ' + esc(d.error || 'error'), 8000); return false; }
      pend.set(d.id, label);
      O.showToast('⏳ ส่งแล้ว: ' + esc(label), 4000);
      setTimeout(poll, 400);
      return true;
    } catch (e) { O.showToast('⚠️ เชื่อมต่อ hub ไม่ได้', 6000); return false; }
  }

  // ---------------- ticket actions ----------------
  function setLevel(k, on) {
    const e = entryPrice();
    if (on && e !== null) {
      const dir = T.side === 'BUY' ? 1 : -1;
      if (T[k] === null || wrongSide(k, T[k])) T[k] = roundPx(k === 'sl' ? e - dir * DEF_SL : e + dir * DEF_TP);
    }
    T[k + 'On'] = on;
    refit(); render();
  }
  function editLevel(k) {
    const cur = T[k + 'On'] ? T[k] : '';
    const v = prompt(`${k.toUpperCase()} ราคา (เว้นว่าง = ปิด ${k.toUpperCase()})`, cur === '' ? '' : String(cur));
    if (v === null) return;
    if (v.trim() === '') { T[k + 'On'] = false; refit(); render(); return; }
    const n = Number(v.replace(/,/g, ''));
    if (!isFinite(n) || n <= 0) { O.showToast('ราคาไม่ถูกต้อง'); return; }
    T[k] = roundPx(n); T[k + 'On'] = true; refit(); render();
  }
  // move SL/TP with the entry, keeping their distance (mirrored when the side flips)
  function relocate(prevE, prevSide) {
    const e = entryPrice(); if (prevE === null || e === null) return;
    for (const k of ['sl', 'tp']) {
      if (T[k] === null) continue;
      let d = T[k] - prevE; if (prevSide !== T.side) d = -d;
      T[k] = roundPx(e + d);
    }
  }
  function pendingStart(side) {
    const s = sym(); const p = s ? (side === 'BUY' ? s.ask : s.bid) : O.lastClose;
    return p === null ? null : roundPx(p + (side === 'BUY' ? -3 : 3));
  }
  // SELL / BUY at market: one tap → confirm → send
  function pressMarket(side) {
    if (T.mod) return;
    const prevE = entryPrice(), prevSide = T.side, wasPending = T.mode === 'PENDING';
    T.side = side; T.mode = 'MARKET';
    if (prevSide !== side || wasPending) relocate(prevE, prevSide);
    savePrefs(); refit(); render();
    submit();
  }
  // ตั้งราคา SELL / BUY: first tap shows the ENTRY line to drag, second tap sends
  function pressPending(side) {
    if (T.mod) return;
    if (T.mode === 'PENDING' && T.side === side) return submit();
    const prevE = entryPrice(), prevSide = T.side;
    T.side = side; T.mode = 'PENDING'; T.entry = pendingStart(side);
    relocate(prevE, prevSide);
    savePrefs(); refit(); render();
    O.showToast(`ลากเส้น ENTRY ไปราคาที่ต้องการ แล้วกดปุ่ม ${side} อีกครั้งเพื่อส่ง`, 4000);
  }
  function cancelPending() {
    if (T.mode !== 'PENDING') return;
    const prevE = entryPrice();
    T.mode = 'MARKET'; relocate(prevE, T.side); T.entry = null;
    savePrefs(); refit(); render();
  }
  function stepLot(dir) {
    const st = (sym() && sym().vol_step) || 0.01;
    T.risk = 0; T.lots = normLots((effLots() || 0) + dir * st); savePrefs(); render();
  }
  function setRisk() {
    const v = prompt('ความเสี่ยงต่อไม้ (% ของ Equity) ใช้คำนวณล็อตจากระยะ SL\n0 = ปิด ใช้ล็อตที่ตั้งเอง', T.risk ? String(T.risk) : '1');
    if (v === null) return;
    const n = Number(v);
    if (!isFinite(n) || n < 0 || n > 20) { O.showToast('ใส่ 0 – 20 %'); return; }
    T.risk = n; if (n > 0 && !T.slOn) setLevel('sl', true); savePrefs(); render();
  }

  function submit() {
    const s = sym(), e = entryPrice();
    if (!online || !s) return O.showToast('EA ออฟไลน์');
    if (T.mod) {
      const m = T.mod;
      const sl = T.slOn ? T.sl : 0, tp = T.tpOn ? T.tp : 0;
      if (T.slOn && wrongSide('sl', T.sl)) return O.showToast('SL อยู่ผิดฝั่งของราคาเข้า');
      if (T.tpOn && wrongSide('tp', T.tp)) return O.showToast('TP อยู่ผิดฝั่งของราคาเข้า');
      const label = `แก้ #${m.ticket} SL ${sl ? fx(sl, dg()) : 'ไม่ตั้ง'} TP ${tp ? fx(tp, dg()) : 'ไม่ตั้ง'}${m.isOrder ? ' ราคา ' + fx(T.entry, dg()) : ''}`;
      send({ type: 'MODIFY', ticket: m.ticket, price: m.isOrder ? T.entry : 0, sl, tp }, label).then(ok => { if (ok) exitModify(); });
      return;
    }
    const lots = effLots();
    if (!(lots > 0)) return O.showToast('ล็อตไม่ถูกต้อง');
    if (T.mode === 'PENDING' && !(T.entry > 0)) return O.showToast('ลากเส้น ENTRY เพื่อตั้งราคา');
    if (T.slOn && wrongSide('sl', T.sl)) return O.showToast('SL อยู่ผิดฝั่งของราคาเข้า');
    if (T.tpOn && wrongSide('tp', T.tp)) return O.showToast('TP อยู่ผิดฝั่งของราคาเข้า');
    const kind = T.mode === 'MARKET' ? 'MARKET' : pendingKind();
    const cmd = { type: 'OPEN', side: T.side, kind, lots, price: kind === 'MARKET' ? 0 : T.entry, sl: T.slOn ? T.sl : 0, tp: T.tpOn ? T.tp : 0 };
    const slM = T.slOn ? money(e, T.sl) : null, tpM = T.tpOn ? money(e, T.tp) : null;
    const label = `${T.side} ${kind === 'MARKET' ? 'ราคาตลาด' : kind + ' @ ' + fx(T.entry, dg())} ${lots} lot` +
      (T.slOn ? `\nSL ${fx(T.sl, dg())} (${sg(slM)})` : '\nไม่ตั้ง SL') + (T.tpOn ? `\nTP ${fx(T.tp, dg())} (${sg(tpM)})` : '');
    send(cmd, label.replace(/\n/g, ' · '), kind !== 'MARKET'); // market orders go without a confirm dialog
  }

  function enterModify(ticket, isOrder) {
    const list = isOrder ? (S.orders || []) : (S.positions || []);
    const x = list.find(p => p.ticket === ticket); if (!x) return;
    const side = isOrder ? (x.type.startsWith('BUY') ? 'BUY' : 'SELL') : x.side;
    T.mod = { ticket, isOrder, side, open: isOrder ? x.price : x.open, lots: x.lots, type: isOrder ? x.type : x.side };
    T.side = side; T.entry = isOrder ? x.price : null;
    T.sl = x.sl > 0 ? x.sl : null; T.slOn = x.sl > 0;
    T.tp = x.tp > 0 ? x.tp : null; T.tpOn = x.tp > 0;
    closeSheet(); refit(); render();
    O.showToast('ลากเส้น SL / TP' + (isOrder ? ' / ENTRY' : '') + ' บนกราฟ แล้วกดบันทึก', 5000);
  }
  function exitModify() { T.mod = null; T.entry = null; T.slOn = false; T.tpOn = false; T.sl = null; T.tp = null; refit(); render(); }

  // ---------------- UI ----------------
  $('ticket').innerHTML = `
    <div class="tk-mod" id="tkMod" hidden><span id="tkModTxt"></span></div>
    <div class="tk-row">
      <button class="tk-lvl sl" id="tkSL"><small>SL</small><b></b><em></em></button>
      <button class="tk-lvl tp" id="tkTP"><small>TP</small><b></b><em></em></button>
      <div class="tk-rr" id="tkRR"><small>R:R</small>–</div>
      <button class="tk-snap" id="tkSnap" title="ดูดเข้า OI wall">🧲</button>
    </div>
    <div class="tk-row" id="tkOpts">
      <div class="tk-lot" id="tkLotBox"><button data-lot="-1">−</button><input id="tkLot" inputmode="decimal" aria-label="lot"><button data-lot="1">+</button></div>
      <button class="tk-risk" id="tkRisk">risk –</button>
    </div>
    <div class="tk-row tk-pend" id="tkPend">
      <button class="tk-p sell" data-pend="SELL">ตั้งราคา SELL</button>
      <button class="tk-x" id="tkPendX" hidden>✕</button>
      <button class="tk-p buy" data-pend="BUY">ตั้งราคา BUY</button>
    </div>
    <div class="tk-row tk-mkt" id="tkMkt">
      <button class="tk-m sell" data-mkt="SELL"><small>SELL</small><b id="tkBid">–</b></button>
      <div class="tk-spr" id="tkSpr">–</div>
      <button class="tk-m buy" data-mkt="BUY"><small>BUY</small><b id="tkAsk">–</b></button>
    </div>
    <div class="tk-row" id="tkModRow" hidden>
      <button class="tk-modx" id="tkModX">ยกเลิกแก้ไข</button>
      <button class="tk-go" id="tkGo">บันทึก</button>
    </div>`;
  $('tkMkt').addEventListener('click', e => { const b = e.target.closest('[data-mkt]'); if (b) pressMarket(b.dataset.mkt); });
  $('tkPend').addEventListener('click', e => { const b = e.target.closest('[data-pend]'); if (b) pressPending(b.dataset.pend); });
  $('tkPendX').addEventListener('click', cancelPending);
  $('tkOpts').addEventListener('click', e => { const l = e.target.closest('[data-lot]'); if (l) stepLot(+l.dataset.lot); });
  $('tkLot').addEventListener('change', e => { const n = Number(e.target.value); if (isFinite(n) && n > 0) { T.risk = 0; T.lots = normLots(n); savePrefs(); } render(); });
  $('tkRisk').addEventListener('click', setRisk);
  // SL / TP chip: tap = on / off, long-press = type an exact price
  for (const k of ['sl', 'tp']) {
    const chip = $('tk' + k.toUpperCase());
    let lp = null, longDone = false;
    const startLP = () => { longDone = false; clearTimeout(lp); lp = setTimeout(() => { longDone = true; vib(15); editLevel(k); }, 550); };
    const stopLP = () => clearTimeout(lp);
    chip.addEventListener('touchstart', startLP, { passive: true });
    chip.addEventListener('touchend', stopLP); chip.addEventListener('touchmove', stopLP, { passive: true }); chip.addEventListener('touchcancel', stopLP);
    chip.addEventListener('contextmenu', e => { e.preventDefault(); if (!longDone) { longDone = true; editLevel(k); } });
    chip.addEventListener('click', () => { if (longDone) { longDone = false; return; } setLevel(k, !T[k + 'On']); });
  }
  $('tkSnap').addEventListener('click', () => { T.snap = !T.snap; savePrefs(); render(); O.showToast(T.snap ? '🧲 เปิดดูด SL/TP เข้า OI wall' : 'ปิดดูดเข้า OI wall', 2500); });
  $('tkGo').addEventListener('click', submit);
  $('tkModX').addEventListener('click', exitModify);

  function render() {
    const s = sym(), a = acc(), d = dg();
    // account strip
    const nPos = S ? (S.positions || []).length + (S.orders || []).length : 0;
    $('acct').innerHTML = `<span class="ea ${online ? 'on' : ''}"><i></i>${online ? 'EA' : (S ? 'EA ออฟไลน์' : 'รอ EA…')}</span>` +
      (a ? `<span>Eq <b>${fx(a.equity, a.equity >= 10000 ? 0 : 2)}</b> ${esc(a.currency)}</span><span>ลอย <b class="${cls(a.profit)}">${sg(a.profit)}</b></span><span>วันนี้ <b class="${cls(S.pl && S.pl.today)}">${sg(S.pl && S.pl.today)}</b></span>` : '') +
      `<button id="dashBtn" aria-label="แดชบอร์ด">📊</button><button id="posBtn" aria-label="ออเดอร์">📋 <b>${nPos}</b></button>`;
    $('posBtn').onclick = openSheet;
    $('dashBtn').onclick = () => window.OIT_openDash && window.OIT_openDash();
    if (s) { const b = document.querySelector('header .sym b'); if (b && b.textContent !== s.name) b.textContent = s.name; }

    // prices
    $('tkAsk').textContent = s ? fx(s.ask, d) : '–';
    $('tkBid').textContent = s ? fx(s.bid, d) : '–';
    $('tkSpr').textContent = s ? (s.ask - s.bid).toFixed(d) : '–';
    const pendOn = !T.mod && T.mode === 'PENDING';
    document.querySelectorAll('[data-pend]').forEach(b => {
      const act = pendOn && b.dataset.pend === T.side;
      b.classList.toggle('on', act);
      b.textContent = act ? `ส่ง ${T.side} ${pendingKind()} @ ${fx(T.entry, d)}` : `ตั้งราคา ${b.dataset.pend}`;
      b.disabled = !online;
    });
    $('tkPendX').hidden = !pendOn;
    document.querySelectorAll('[data-mkt]').forEach(b => { b.disabled = !online; b.classList.toggle('dim', pendOn); });

    // modify banner
    $('tkMod').hidden = !T.mod;
    $('tkOpts').style.display = T.mod ? 'none' : '';
    $('tkPend').hidden = !!T.mod; $('tkMkt').hidden = !!T.mod; $('tkModRow').hidden = !T.mod;
    if (T.mod) $('tkModTxt').textContent = `✎ แก้ไข #${T.mod.ticket} · ${T.mod.type} ${T.mod.lots} lot @ ${fx(T.mod.open, d)}`;

    // lots
    const lots = lotsNow();
    const auto = !T.mod && T.risk > 0 && T.slOn;
    $('tkLotBox').classList.toggle('auto', auto);
    if (document.activeElement !== $('tkLot')) $('tkLot').value = (lots ?? 0).toFixed(stepDec());
    $('tkRisk').textContent = T.risk > 0 ? `risk ${T.risk}%` : 'risk –';
    $('tkRisk').classList.toggle('on', T.risk > 0);
    $('tkSnap').classList.toggle('on', T.snap);

    // SL / TP chips
    const e = entryPrice();
    for (const k of ['sl', 'tp']) {
      const el = $('tk' + k.toUpperCase()), on = T[k + 'On'];
      el.classList.toggle('on', on);
      el.classList.toggle('bad', on && wrongSide(k, T[k]));
      el.querySelector('b').textContent = on ? fx(T[k], d) : '';
      el.title = on ? 'แตะ = ปิด · กดค้าง = พิมพ์ราคา' : 'แตะ = เปิด';
      const m = on ? money(e, T[k]) : null;
      el.querySelector('em').textContent = on ? sg(m) : '';
    }
    const risk = T.slOn ? -money(e, T.sl) : null, rew = T.tpOn ? money(e, T.tp) : null;
    $('tkRR').innerHTML = `<small>R:R</small>${risk > 0 && rew > 0 ? '1:' + (rew / risk).toFixed(2) : '–'}`;

    // modify save button / offline note
    const go = $('tkGo');
    go.classList.toggle('sell', T.side === 'SELL');
    go.disabled = !online;
    if (T.mod) go.textContent = online ? `บันทึก SL/TP #${T.mod.ticket}` : 'EA ออฟไลน์';
    if (!online) { $('tkSpr').textContent = S ? 'ออฟไลน์' : '…'; }
    O.showPrice();
    O.markDirty();
    if (!$('sheet').hidden) paintSheet();
  }

  // ---------------- positions sheet ----------------
  let sheetTab = 'pos';
  function openSheet() { $('sheet').hidden = false; paintSheet(); }
  function closeSheet() { $('sheet').hidden = true; }
  function paintSheet() {
    const d = dg(), a = acc(), P = (S && S.positions) || [], Q = (S && S.orders) || [], pl = (S && S.pl) || {};
    const sc = $('sheet').scrollTop;
    const total = P.reduce((t, x) => t + x.profit, 0);
    const winRate = pl.trades_month ? Math.round(pl.wins_month / pl.trades_month * 100) + '%' : '–';
    $('sheet').innerHTML = `
      <h3>บัญชี ${a ? esc(a.login) + ' · ' + esc(a.currency) : ''}<button id="shX">✕</button></h3>
      <div class="stats">
        <div class="stat"><small>Balance</small><b>${fx(a && a.balance)}</b></div>
        <div class="stat"><small>Equity</small><b>${fx(a && a.equity)}</b></div>
        <div class="stat"><small>Margin level</small><b>${a && a.margin_level ? fx(a.margin_level, 0) + '%' : '–'}</b></div>
        <div class="stat"><small>วันนี้</small><b class="${cls(pl.today)}">${sg(pl.today)}</b></div>
        <div class="stat"><small>สัปดาห์นี้</small><b class="${cls(pl.week)}">${sg(pl.week)}</b></div>
        <div class="stat"><small>เดือนนี้ · ชนะ ${winRate}</small><b class="${cls(pl.month)}">${sg(pl.month)}</b></div>
      </div>
      <h3>ออเดอร์ที่เปิดอยู่ (${P.length}) <span class="${cls(total)} mono" style="font-size:13px">${sg(total)}</span>${P.length > 1 ? '<button class="danger" id="shAll">ปิดทั้งหมด</button>' : ''}</h3>
      ${P.length ? P.map(x => `<div class="row">
          <div><span class="${x.side === 'BUY' ? 'b' : 's'}">${x.side}</span> <span class="mono">${x.lots}</span>
            <small>@ ${fx(x.open, d)} · SL ${x.sl > 0 ? fx(x.sl, d) : '–'} · TP ${x.tp > 0 ? fx(x.tp, d) : '–'}</small></div>
          <span class="sp"></span><b class="mono ${cls(x.profit)}">${sg(x.profit)}</b>
          <button data-mod="${x.ticket}">แก้</button><button class="danger" data-close="${x.ticket}">ปิด</button></div>`).join('') : '<div class="empty">ไม่มีออเดอร์</div>'}
      <h3>Pending (${Q.length})</h3>
      ${Q.length ? Q.map(x => `<div class="row">
          <div><span class="${x.type.startsWith('BUY') ? 'b' : 's'}">${esc(x.type)}</span> <span class="mono">${x.lots}</span>
            <small>@ ${fx(x.price, d)} · SL ${x.sl > 0 ? fx(x.sl, d) : '–'} · TP ${x.tp > 0 ? fx(x.tp, d) : '–'}</small></div>
          <span class="sp"></span>
          <button data-modo="${x.ticket}">แก้</button><button class="danger" data-cancel="${x.ticket}">ยกเลิก</button></div>`).join('') : '<div class="empty">ไม่มี</div>'}`;
    $('sheet').scrollTop = sc;
  }
  $('sheet').addEventListener('click', e => {
    const t = e.target.closest('button'); if (!t) return;
    if (t.id === 'shX') return closeSheet();
    if (t.id === 'shAll') return send({ type: 'CLOSEALL' }, `ปิดออเดอร์ทั้งหมด ${(S.positions || []).length} ไม้`);
    if (t.dataset.close) { const x = S.positions.find(p => p.ticket == t.dataset.close); return send({ type: 'CLOSE', ticket: +t.dataset.close }, `ปิด #${t.dataset.close} ${x ? x.side + ' ' + x.lots + ' (' + sg(x.profit) + ')' : ''}`); }
    if (t.dataset.cancel) return send({ type: 'CANCEL', ticket: +t.dataset.cancel }, `ยกเลิก pending #${t.dataset.cancel}`);
    if (t.dataset.mod) return enterModify(+t.dataset.mod, false);
    if (t.dataset.modo) return enterModify(+t.dataset.modo, true);
  });

  // ---------------- chart drawing ----------------
  function label(ctx, x, y, text, bg, fg, small) {
    ctx.font = `bold ${small ? 9 : 11}px ${C('--mono')}`;
    const pad = small ? 4 : 6, w = ctx.measureText(text).width + pad * 2, h = small ? 13 : 18;
    ctx.globalAlpha = 0.95; ctx.fillStyle = bg;
    ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(x, y - h / 2, w, h, 4); else ctx.rect(x, y - h / 2, w, h); ctx.fill();
    ctx.globalAlpha = 1; ctx.fillStyle = fg; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText(text, x + pad, y + .5);
    return w;
  }
  function handle(ctx, x, y, col) {
    ctx.globalAlpha = 1; ctx.fillStyle = col;
    ctx.beginPath(); ctx.arc(x, y, 10, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5;
    for (const dy of [-3, 0, 3]) { ctx.beginPath(); ctx.moveTo(x - 4, y + dy + .5); ctx.lineTo(x + 4, y + dy + .5); ctx.stroke(); }
  }
  function hline(ctx, y, x0, x1, col, w, dash) {
    ctx.strokeStyle = col; ctx.lineWidth = w; ctx.setLineDash(dash || []);
    ctx.beginPath(); ctx.moveTo(x0, Math.round(y) + .5); ctx.lineTo(x1, Math.round(y) + .5); ctx.stroke(); ctx.setLineDash([]);
  }
  const Y = p => (p === null || p === undefined) ? null : O.series.priceToCoordinate(p);
  const LX = 46; // label x (leaves room for OI strike numbers)

  O.hooks.push((ctx, w, h) => {
    const ts = O.chart.timeScale(), plotW = ts.width(), plotH = h - ts.height();
    const inPlot = y => y !== null && y > -20 && y < plotH + 20;
    const d = dg(), buyC = C('--buy') || '#26a69a', sellC = C('--sell') || '#ef5350', tpC = C('--tp') || '#2fbf8f', slC = C('--sl') || '#e5576b';

    // open positions + pending orders
    if (S) {
      for (const x of S.positions || []) {
        if (T.mod && !T.mod.isOrder && T.mod.ticket === x.ticket) continue;
        const col = x.side === 'BUY' ? buyC : sellC, y = Y(x.open);
        if (inPlot(y)) { ctx.globalAlpha = .8; hline(ctx, y, 0, plotW, col, 1, [6, 4]); label(ctx, 1, y, `${x.side} ${x.lots} ${sg(x.profit)}`, col, '#fff', true); }
        for (const [k, c] of [['sl', slC], ['tp', tpC]]) { const yy = Y(x[k] > 0 ? x[k] : null); if (inPlot(yy)) { ctx.globalAlpha = .55; hline(ctx, yy, plotW * .55, plotW, c, 1, [2, 3]); ctx.globalAlpha = .8; ctx.font = `9px ${C('--mono')}`; ctx.fillStyle = c; ctx.textAlign = 'right'; ctx.fillText(k.toUpperCase() + ' #' + x.ticket, plotW - 4, yy - 6); } }
      }
      for (const x of S.orders || []) {
        if (T.mod && T.mod.isOrder && T.mod.ticket === x.ticket) continue;
        const y = Y(x.price); if (!inPlot(y)) continue;
        const col = x.type.startsWith('BUY') ? buyC : sellC;
        ctx.globalAlpha = .7; hline(ctx, y, 0, plotW, col, 1, [1, 3]);
        label(ctx, 1, y, `${x.type} ${x.lots}`, C('--panel'), col, true);
      }
    }

    // ticket: entry + SL/TP zones — only while something is being set up
    if (!ticketActive()) return;
    const e = entryPrice(), ye = Y(e);
    if (e === null || ye === null) return;
    const zone = (p, col) => { const y = Y(p); if (y === null) return; ctx.globalAlpha = .13; ctx.fillStyle = col; ctx.fillRect(0, Math.min(ye, y), plotW, Math.abs(y - ye)); };
    if (T.tpOn) zone(T.tp, tpC);
    if (T.slOn) zone(T.sl, slC);
    const sideC = T.side === 'BUY' ? buyC : sellC;
    const lots = lotsNow();
    for (const [k, col, sign] of [['tp', tpC, 'TP'], ['sl', slC, 'SL']]) {
      if (!T[k + 'On']) continue;
      const y = Y(T[k]); if (!inPlot(y)) continue;
      const m = money(e, T[k]), bad = wrongSide(k, T[k]);
      ctx.globalAlpha = 1; hline(ctx, y, 0, plotW, col, 2);
      const r = (k === 'tp' && T.slOn && money(e, T.sl) < 0) ? `  ${(m / -money(e, T.sl)).toFixed(1)}R` : '';
      const snapped = T.snap && nearWall(T[k]) ? ' 🧲' : '';
      label(ctx, LX, y, `${sign} ${fx(T[k], d)}  ${bad ? 'ผิดฝั่ง!' : sg(m)}${r}${snapped}`, bad ? '#7a1d1d' : col, '#fff');
      handle(ctx, plotW - 24, y, col);
    }
    const kindTxt = T.mod ? `#${T.mod.ticket}` : (T.mode === 'MARKET' ? 'ตลาด' : pendingKind());
    ctx.globalAlpha = 1; hline(ctx, ye, 0, plotW, sideC, 1.5, T.mode === 'MARKET' && !T.mod ? [5, 3] : []);
    label(ctx, LX, ye, `${T.side} ${kindTxt} ${(lots ?? 0).toFixed(stepDec())}  ${fx(e, d)}`, sideC, '#fff');
    if (draggable('entry')) handle(ctx, plotW - 24, ye, sideC);
    ctx.globalAlpha = 1;
  });

  // ---------------- keep ticket lines on screen ----------------
  let frozen = null;
  const ticketActive = () => !!T.mod || T.slOn || T.tpOn || T.mode === 'PENDING';
  function autoscale(orig) {
    const r = orig();
    if (!r || !r.priceRange) return r;
    if (frozen) return { priceRange: { ...frozen }, margins: r.margins };
    let mn = r.priceRange.minValue, mx = r.priceRange.maxValue;
    if (ticketActive()) {
      const add = p => { if (p !== null && p !== undefined && isFinite(p)) { mn = Math.min(mn, p); mx = Math.max(mx, p); } };
      add(entryPrice()); if (T.slOn) add(T.sl); if (T.tpOn) add(T.tp);
    }
    return { priceRange: { minValue: mn, maxValue: mx }, margins: r.margins };
  }
  const refit = () => { try { O.series.applyOptions({ autoscaleInfoProvider: autoscale }); } catch (e) {} };
  refit();

  // ---------------- drag lines on the chart ----------------
  function walls() {
    const oi = O.oi; if (!oi || oi.offset === null) return [];
    const set = new Set([...oi.top5C, ...oi.top5P, ...oi.topC, ...oi.topP]);
    const out = oi.rows.filter(r => set.has(r.strike) && r.price !== null).map(r => r.price);
    if (oi.mpPrice !== null) out.push(oi.mpPrice);
    return out;
  }
  function nearWall(p) {
    const y = Y(p); if (y === null) return false;
    return walls().some(wp => { const yw = Y(wp); return yw !== null && Math.abs(yw - y) < 0.5; });
  }
  const draggable = k => k === 'entry' ? ((T.mod && T.mod.isOrder) || (!T.mod && T.mode === 'PENDING')) : T[k + 'On'];
  const valOf = k => k === 'entry' ? entryPrice() : T[k];

  let drag = null;
  const wrap = $('wrap');
  function hitTest(clientX, clientY) {
    const r = O.chartEl.getBoundingClientRect(), x = clientX - r.left, y = clientY - r.top;
    if (O.drawTool) return null;
    if (x < 0 || x > O.chart.timeScale().width()) return null;
    let best = null;
    for (const k of ['tp', 'sl', 'entry']) {
      if (!draggable(k)) continue;
      const yy = Y(valOf(k)); if (yy === null) continue;
      const dd = Math.abs(yy - y);
      if (dd <= 22 && (!best || dd < best.d)) best = { k, d: dd };
    }
    return best ? best.k : null;
  }
  function moveTo(clientY) {
    const r = O.chartEl.getBoundingClientRect(), y = clientY - r.top;
    let p = O.series.coordinateToPrice(y); if (p === null) return;
    let snapped = false;
    if (T.snap) {
      for (const wp of walls()) { const yw = Y(wp); if (yw !== null && Math.abs(yw - y) <= SNAP_PX) { p = wp; snapped = true; break; } }
    }
    p = roundPx(p);
    if (snapped && drag.snapAt !== p) { vib(12); drag.snapAt = p; } else if (!snapped) drag.snapAt = null;
    if (drag.k === 'entry') T.entry = p; else T[drag.k] = p;
    render();
  }
  function start(k) {
    drag = { k, snapAt: null }; O.lockChart(true); O.hideToast(); vib(10);
    const h = O.chartEl.clientHeight - O.chart.timeScale().height();
    const top = O.series.coordinateToPrice(0), bot = O.series.coordinateToPrice(h);
    frozen = (top !== null && bot !== null) ? { minValue: bot, maxValue: top } : null;
  }
  function end() { if (!drag) return; drag = null; frozen = null; O.lockChart(false); refit(); render(); }

  wrap.addEventListener('touchstart', e => {
    if (e.touches.length !== 1) return;
    const t = e.touches[0], k = hitTest(t.clientX, t.clientY);
    if (!k) return;
    e.stopPropagation(); start(k);
  }, { capture: true, passive: true });
  wrap.addEventListener('touchmove', e => {
    if (!drag) return;
    e.stopPropagation(); e.preventDefault(); moveTo(e.touches[0].clientY);
  }, { capture: true, passive: false });
  const tEnd = e => { if (!drag) return; e.stopPropagation(); end(); };
  wrap.addEventListener('touchend', tEnd, { capture: true });
  wrap.addEventListener('touchcancel', tEnd, { capture: true });
  // mouse (desktop)
  wrap.addEventListener('mousedown', e => { const k = hitTest(e.clientX, e.clientY); if (!k) return; e.stopPropagation(); e.preventDefault(); start(k); }, { capture: true });
  window.addEventListener('mousemove', e => { if (drag) { e.preventDefault(); moveTo(e.clientY); } }, { capture: true });
  window.addEventListener('mouseup', () => end(), { capture: true });
  wrap.addEventListener('pointerdown', e => { if (drag || (e.pointerType !== 'touch' && hitTest(e.clientX, e.clientY))) e.stopPropagation(); }, { capture: true });
  wrap.addEventListener('mousemove', e => { if (!drag) wrap.style.cursor = hitTest(e.clientX, e.clientY) ? 'ns-resize' : ''; });

  render();
  poll();
})();

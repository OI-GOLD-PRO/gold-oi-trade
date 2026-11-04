// OI Gold Pro Trade — full-screen dashboard (📊): KPIs, balance/equity curve, P/L calendar,
// sessions, BUY/SELL split and closed-trade history. Data: HUB/app/history (whole account, all trades).
(function () {
  'use strict';
  const O = window.OI;
  if (!O) return;
  const $ = id => document.getElementById(id);
  const esc = s => String(s).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
  const fx = (n, d = 2) => (n === null || n === undefined || !isFinite(n)) ? '–' : Number(n).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
  const sg = (n, d = 2) => (n === null || n === undefined || !isFinite(n)) ? '–' : (n > 0 ? '+' : n < 0 ? '−' : '') + fx(Math.abs(n), d);
  const cls = n => n > 0 ? 'pos' : n < 0 ? 'neg' : '';
  const TZ = 7 * 3600;
  const thDate = (utc, opt) => new Date(utc * 1000).toLocaleDateString('th-TH-u-ca-gregory', { timeZone: 'Asia/Bangkok', ...opt });
  const thTime = utc => new Date(utc * 1000).toLocaleTimeString('th-TH', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit', hour12: false });
  const COL = { bal: '#b38a28', eq: '#2f86d0' }; // validated pair on the dark surface

  // EA start date + starting capital (editable at the bottom of the dashboard; stored on this device)
  const CFGK = 'oit_dash_cfg';
  const cfg = { start: '2026-10-20', cap: 2500 };
  try { Object.assign(cfg, JSON.parse(localStorage.getItem(CFGK) || '{}')); } catch (e) {}
  const saveCfg = () => { try { localStorage.setItem(CFGK, JSON.stringify(cfg)); } catch (e) {} };
  const startUtc = () => Math.floor(Date.parse(cfg.start + 'T00:00:00+07:00') / 1000) || 0;
  let V = null; // H restricted to the days since the EA start
  function view() {
    const t0 = startUtc(), inT = t => t >= t0;
    const trades = H.trades.filter(t => t.ct && inT(t.ct));
    const chrono = trades.slice().reverse();
    const daily = {}; Object.keys(H.daily).forEach(k => { if (k >= cfg.start) daily[k] = H.daily[k]; });
    let wins = 0, losses = 0, gW = 0, gL = 0, best = null, worst = null, cw = 0, cl = 0, mcw = 0, mcl = 0, cum = 0, peak = 0, dd = 0, ddp = 0;
    const sess = [['asia', 0, 7], ['london', 7, 13], ['ny', 13, 21], ['late', 21, 24]].map(([k, f, to]) => ({ k, f, to, n: 0, w: 0, net: 0 }));
    const sides = { BUY: { n: 0, w: 0, net: 0 }, SELL: { n: 0, w: 0, net: 0 } };
    chrono.forEach(t => {
      const v = t.pnl;
      if (v > 0) { wins++; gW += v; cw++; cl = 0; } else { losses++; gL += v; cl++; cw = 0; }
      mcw = Math.max(mcw, cw); mcl = Math.max(mcl, cl);
      if (best === null || v > best) best = v; if (worst === null || v < worst) worst = v;
      cum += v; if (cum > peak) peak = cum; const d = peak - cum; if (d > dd) { dd = d; ddp = (cfg.cap + peak) > 0 ? d / (cfg.cap + peak) * 100 : 0; }
      const h = new Date((t.ot || t.ct) * 1000).getUTCHours(), x = sess.find(z => h >= z.f && h < z.to); x.n++; x.net += v; if (v > 0) x.w++;
      const sd = sides[t.side] || (sides[t.side] = { n: 0, w: 0, net: 0 }); sd.n++; sd.net += v; if (v > 0) sd.w++;
    });
    const n = trades.length, r2 = v => Math.round(v * 100) / 100;
    const days = Object.keys(daily);
    const net = days.length ? days.reduce((a, k) => a + daily[k][0], 0) : cum;
    const names = { asia: 'เอเชีย', london: 'ลอนดอน', ny: 'นิวยอร์ก', late: 'ดึก' };
    V = {
      net: r2(net), trunc: H.count.trades > H.trades.length && H.trades.length && trades.length === H.trades.length,
      count: n, daysN: days.length, upDays: days.filter(k => daily[k][0] > 0).length,
      stats: { net: r2(net), gross_win: r2(gW), gross_loss: r2(gL), profit_factor: gL < 0 ? r2(gW / -gL) : null, win_rate: n ? r2(wins / n * 100) : null, wins, losses,
        avg_win: wins ? r2(gW / wins) : null, avg_loss: losses ? r2(gL / losses) : null, best: best === null ? null : r2(best), worst: worst === null ? null : r2(worst),
        max_consec_wins: mcw, max_consec_losses: mcl, max_dd: r2(dd), max_dd_pct: r2(ddp), deposits: H.stats.deposits, withdrawals: H.stats.withdrawals },
      daily, trades,
      balance: H.balance.filter(b => inT(b[0])), equity: H.equity.filter(e => inT(e[0])),
      sessions: sess.map(z => ({ k: z.k, name: names[z.k], n: z.n, net: r2(z.net), win_rate: z.n ? r2(z.w / z.n * 100) : null })),
      sides: Object.fromEntries(Object.entries(sides).map(([k, z]) => [k, { n: z.n, net: r2(z.net), win_rate: z.n ? r2(z.w / z.n * 100) : null }])),
    };
  }
  let H = null, timer = null, chart = null, sBal = null, sEq = null, shown = 30, month = null;

  const el = document.createElement('div');
  el.id = 'dash'; el.hidden = true;
  el.innerHTML = `
    <div class="dh-top"><b>📊 แดชบอร์ด</b><span id="dhAcc"></span><button id="dhX" aria-label="ปิด">✕</button></div>
    <div class="dh-body" id="dhBody"><div class="dh-msg">กำลังโหลด…</div></div>`;
  document.body.appendChild(el);
  $('dhX').onclick = close;

  window.OIT_openDash = open;
  function open() { el.hidden = false; load(); clearInterval(timer); timer = setInterval(() => { if (!el.hidden && document.visibilityState === 'visible') load(); }, 60000); }
  function close() { el.hidden = true; clearInterval(timer); }

  async function load() {
    try {
      const r = await fetch(O.HUB + '/app/history?t=' + Date.now(), { cache: 'no-store', headers: { 'X-Key': O.authCode || '' } });
      const d = await r.json();
      if (!d.ok) { if (!H) $('dhBody').innerHTML = `<div class="dh-msg">${esc(d.error === 'EA not connected yet' ? 'รอ EA เชื่อมต่อ…' : (d.error || 'โหลดไม่ได้'))}</div>`; return; }
      const first = !H; H = d; view();
      if (first) build(); else paint();
    } catch (e) { if (!H) $('dhBody').innerHTML = '<div class="dh-msg">เชื่อมต่อ hub ไม่ได้</div>'; }
  }

  function build() {
    $('dhBody').innerHTML = `
      <section class="dh-hero" id="dhHero"></section>
      <section class="dh-kpis" id="dhKpis"></section>
      <section class="dh-card">
        <div class="dh-h"><b>Balance / Equity</b>
          <div class="dh-rng" id="dhRng"><button data-r="7">7ว</button><button data-r="30">30ว</button><button data-r="90">90ว</button><button data-r="0" class="on">ทั้งหมด</button></div></div>
        <div class="dh-leg" id="dhLeg"></div>
        <div id="dhChart" class="dh-chart"></div>
      </section>
      <section class="dh-card">
        <div class="dh-h"><button id="dhPrev">‹</button><b id="dhMonth"></b><button id="dhNext">›</button></div>
        <div class="dh-cal" id="dhCal"></div>
        <div class="dh-sum" id="dhMonthSum"></div>
      </section>
      <section class="dh-card"><div class="dh-h"><b>ช่วงเวลาที่เปิดไม้ (เวลาไทย)</b></div><div id="dhSess"></div></section>
      <section class="dh-card"><div class="dh-h"><b>BUY / SELL</b></div><div id="dhSide"></div></section>
      <section class="dh-card"><div class="dh-h"><b>🏦 COT ทองคำ แยกกลุ่ม</b></div><div id="dhCot"></div></section>
      <section class="dh-card" id="dhMarket"></section>
      <section class="dh-card"><div class="dh-h"><b>ประวัติไม้ที่ปิดแล้ว</b><span id="dhCount" class="dh-mut"></span></div><div id="dhTrades"></div><button class="dh-more" id="dhMore">แสดงเพิ่ม</button></section>
      <div class="dh-foot" id="dhFoot"></div>`;
    chart = LightweightCharts.createChart($('dhChart'), {
      layout: { background: { color: 'transparent' }, textColor: '#8a93ab', fontFamily: 'JetBrains Mono, monospace', fontSize: 10 },
      grid: { vertLines: { visible: false }, horzLines: { color: 'rgba(138,147,171,.12)' } },
      rightPriceScale: { borderVisible: false }, timeScale: { borderVisible: false, timeVisible: false },
      crosshair: { mode: LightweightCharts.CrosshairMode.Magnet }, autoSize: true, handleScroll: false, handleScale: false,
    });
    sBal = chart.addLineSeries({ color: COL.bal, lineWidth: 2, priceLineVisible: false, lastValueVisible: true });
    sEq = chart.addLineSeries({ color: COL.eq, lineWidth: 2, priceLineVisible: false, lastValueVisible: true });
    chart.subscribeCrosshairMove(p => legend(p));
    $('dhRng').onclick = e => { const b = e.target.closest('[data-r]'); if (!b) return; document.querySelectorAll('#dhRng button').forEach(x => x.classList.toggle('on', x === b)); range(+b.dataset.r); };
    $('dhPrev').onclick = () => { const m = shiftMonth(month, -1), sm = cfg.start.slice(0, 7); if (`${m[0]}-${String(m[1] + 1).padStart(2, '0')}` >= sm) { month = m; paintCal(); } };
    $('dhNext').onclick = () => { month = shiftMonth(month, 1); paintCal(); };
    $('dhMore').onclick = () => { shown += 30; paintTrades(); };
    $('dhFoot').addEventListener('click', e => {
      if (!e.target.closest('#dhCfgOk')) return;
      const d = $('dhStart').value, c = Number($('dhCap').value);
      if (/^\d{4}-\d{2}-\d{2}$/.test(d)) cfg.start = d;
      if (isFinite(c) && c >= 0) cfg.cap = c;
      saveCfg(); view(); const m = new Date(Date.now() + TZ * 1000); month = [m.getUTCFullYear(), m.getUTCMonth()]; paint(); chart.timeScale().fitContent();
    });
    paint();
    chart.timeScale().fitContent();
    if (window.OICotGroups) {
      $('dhCot').innerHTML = window.OICotGroups.html();
      window.OICotGroups.load().then(() => { const e = $('dhCot'); if (e) e.innerHTML = window.OICotGroups.html(); });
    }
  }

  function paintMarket() {
    const el = $('dhMarket'); if (!el) return;
    el.innerHTML = [window.OIOIStatCard, window.OICrowdCard, window.OIVolCard].filter(f => typeof f === 'function').map(f => f()).join('');
  }
  document.addEventListener('oilive', paintMarket);
  setInterval(paintMarket, 30000);

  function paint() {
    paintMarket();
    const s = V.stats, st = window.OIT_state ? window.OIT_state() : null, a = st && st.account;
    const cur = esc(H.currency || '');
    $('dhAcc').textContent = `${H.login} · ${H.currency || ''}`;
    $('dhHero').innerHTML = `
      <div><small>Equity ตอนนี้</small><b>${fx(a ? a.equity : null)}</b><span class="dh-mut">${cur}</span></div>
      <div><small>กำไรสุทธิตั้งแต่เริ่ม EA</small><b class="${cls(s.net)}">${sg(s.net)}</b><span class="dh-mut">${cfg.cap > 0 ? `<b class="${cls(s.net)}">${sg(s.net / cfg.cap * 100, 1)}%</b> ของทุน ${fx(cfg.cap, 0)} · ` : ''}ตั้งแต่ ${thDate(startUtc(), { day: 'numeric', month: 'short', year: 'numeric' })}</span></div>`;
    const k = (label, val, sub, c = '') => `<div class="dh-kpi"><small>${label}</small><b class="${c}">${val}</b>${sub ? `<span>${sub}</span>` : ''}</div>`;
    $('dhKpis').innerHTML =
      k('Win rate', s.win_rate === null ? '–' : fx(s.win_rate, 1) + '%', `ชนะ ${s.wins} · แพ้ ${s.losses}`) +
      k('Profit factor', s.profit_factor === null ? '–' : fx(s.profit_factor), `+${fx(s.gross_win)} / ${fx(s.gross_loss)}`) +
      k('Max Drawdown', fx(s.max_dd), s.max_dd_pct ? fx(s.max_dd_pct, 1) + '% ของทุน+กำไรสูงสุด' : '', s.max_dd > 0 ? 'neg' : '') +
      k('เฉลี่ยไม้ชนะ', sg(s.avg_win), 'สูงสุด ' + sg(s.best), 'pos') +
      k('เฉลี่ยไม้แพ้', sg(s.avg_loss), 'ต่ำสุด ' + sg(s.worst), 'neg') +
      k('ติดกันสูงสุด', `${s.max_consec_wins} / ${s.max_consec_losses}`, 'ชนะ / แพ้') +
      k('เฉลี่ยต่อวัน', V.daysN ? sg(s.net / V.daysN) : '–', `${V.daysN} วัน · บวก ${V.upDays}`, cls(s.net)) +
      k('ทุนเริ่มต้น', fx(cfg.cap, 0), `${cur}${a && cfg.cap > 0 ? ' · Eq ' + sg((a.equity - cfg.cap) / cfg.cap * 100, 0) + '%' : ''}`);
    // curve
    // resample both curves onto one even time grid, so horizontal distance = real time
    const g = grid();
    sBal.setData(g.bal); sEq.setData(g.eq);
    legend(null);
    if (month === null) { const d = new Date(Date.now() + TZ * 1000); month = [d.getUTCFullYear(), d.getUTCMonth()]; }
    paintCal(); paintSess(); paintTrades();
    $('dhFoot').innerHTML = `${V.trunc ? '<div class="dh-mut">⚠️ สถิติคำนวณจาก ' + H.trades.length + ' ไม้ล่าสุด (hub ส่งรายการได้จำกัด) กำไรสุทธิและปฏิทินใช้ข้อมูลครบทุกวัน</div>' : ''}<div class="dh-cfg">เริ่มใช้ EA <input id="dhStart" type="date" value="${esc(cfg.start)}"> ทุน <input id="dhCap" type="number" inputmode="decimal" min="0" step="any" value="${cfg.cap}" style="width:90px"> ${cur} <button id="dhCfgOk">บันทึก</button></div>ฝาก ${fx(s.deposits)} · ถอน ${fx(s.withdrawals)} · ${H.count.deals.toLocaleString()} deals · ${H.count.trades.toLocaleString()} ไม้ · อัปเดต ${thTime(H.updated / 1000)} น.`;
  }

  function grid() {
    const B = V.balance, E = V.equity;
    const t0 = Math.min(B.length ? B[0][0] : Infinity, E.length ? E[0][0] : Infinity);
    const t1 = Math.max(B.length ? B[B.length - 1][0] : 0, E.length ? E[E.length - 1][0] : 0, Math.floor(Date.now() / 1000));
    if (!isFinite(t0)) return { bal: [], eq: [] };
    const step = Math.max(300, Math.ceil((t1 - t0) / 500 / 300) * 300);
    const bal = [], eq = [];
    let i = 0, j = 0, lb = null, le = null;
    for (let t = t0 - (t0 % step); t <= t1 + step; t += step) {
      while (i < B.length && B[i][0] <= t) lb = B[i++][1];
      while (j < E.length && E[j][0] <= t) le = E[j++][2];
      if (lb !== null) bal.push({ time: t + TZ, value: lb });
      if (le !== null && E.length && t <= E[E.length - 1][0] + step) eq.push({ time: t + TZ, value: le });
    }
    return { bal, eq };
  }

  function legend(p) {
    const val = (series, arr, idx) => {
      if (p && p.time !== undefined) { const v = p.seriesData.get(series); return v ? v.value : null; }
      return arr.length ? arr[arr.length - 1][idx] : null;
    };
    const b = val(sBal, V.balance, 1), e = val(sEq, V.equity, 2);
    const when = p && p.time !== undefined ? thDate(p.time - TZ, { day: 'numeric', month: 'short', year: '2-digit' }) : 'ล่าสุด';
    $('dhLeg').innerHTML = `<span><i style="background:${COL.bal}"></i>Balance <b>${fx(b)}</b></span><span><i style="background:${COL.eq}"></i>Equity <b>${fx(e)}</b></span><span class="dh-mut">${when}</span>`;
  }
  function range(days) {
    if (!days) return chart.timeScale().fitContent();
    const to = Math.floor(Date.now() / 1000) + TZ;
    chart.timeScale().setVisibleRange({ from: to - days * 86400, to });
  }

  // --- calendar (diverging: green = profit day, red = loss day, intensity = size within the month) ---
  const shiftMonth = ([y, m], d) => { const t = new Date(Date.UTC(y, m + d, 1)); return [t.getUTCFullYear(), t.getUTCMonth()]; };
  function paintCal() {
    const [y, m] = month;
    $('dhMonth').textContent = new Date(Date.UTC(y, m, 15)).toLocaleDateString('th-TH-u-ca-gregory', { month: 'long', year: 'numeric', timeZone: 'UTC' });
    const days = new Date(Date.UTC(y, m + 1, 0)).getUTCDate(), lead = (new Date(Date.UTC(y, m, 1)).getUTCDay() + 6) % 7;
    const key = d => `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    let tot = 0, nT = 0, up = 0, dn = 0, maxAbs = 0;
    for (let d = 1; d <= days; d++) { const v = V.daily[key(d)]; if (v) { maxAbs = Math.max(maxAbs, Math.abs(v[0])); } }
    const today = new Date(Date.now() + TZ * 1000).toISOString().slice(0, 10);
    let html = ['จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส', 'อา'].map(w => `<div class="dh-wd">${w}</div>`).join('');
    for (let i = 0; i < lead; i++) html += '<div></div>';
    for (let d = 1; d <= days; d++) {
      const v = V.daily[key(d)];
      let style = '', txt = '';
      if (v) {
        tot += v[0]; nT += v[1]; if (v[0] > 0) up++; else if (v[0] < 0) dn++;
        const a = maxAbs ? 0.18 + 0.62 * Math.abs(v[0]) / maxAbs : 0.2;
        style = `background:${v[0] >= 0 ? `rgba(38,166,154,${a.toFixed(2)})` : `rgba(239,83,80,${a.toFixed(2)})`}`;
        txt = `<em>${compact(v[0])}</em>`;
      }
      html += `<div class="dh-day${key(d) === today ? ' today' : ''}" style="${style}" title="${key(d)}${v ? ` · ${sg(v[0])} · ${v[1]} ไม้` : ''}"><span>${d}</span>${txt}</div>`;
    }
    $('dhCal').innerHTML = html;
    $('dhMonthSum').innerHTML = `เดือนนี้ <b class="${cls(tot)}">${sg(tot)}</b> · ${nT} ไม้ · วันบวก ${up} · วันลบ ${dn}`;
  }
  function compact(v) { const a = Math.abs(v); const s = a >= 1e6 ? (a / 1e6).toFixed(1) + 'M' : a >= 1e4 ? (a / 1e3).toFixed(0) + 'k' : a >= 1000 ? (a / 1e3).toFixed(1) + 'k' : a >= 100 ? a.toFixed(0) : a.toFixed(1); return (v < 0 ? '−' : '+') + s; }
  // tap a day: show it in a toast (hover layer for touch)
  el.addEventListener('click', e => { const c = e.target.closest('.dh-day'); if (c && c.title) O.showToast(esc(c.title), 3000); });

  // --- sessions + sides: diverging bars around zero ---
  function bars(rows) {
    const max = Math.max(1e-9, ...rows.map(r => Math.abs(r.net)));
    return rows.map(r => {
      const w = Math.abs(r.net) / max * 50;
      return `<div class="dh-bar"><span class="dh-bl">${esc(r.name)}<small>${r.n} ไม้ · ชนะ ${r.win_rate === null ? '–' : fx(r.win_rate, 0) + '%'}</small></span>
        <span class="dh-track"><i class="${r.net >= 0 ? 'pos' : 'neg'}" style="${r.net >= 0 ? 'left:50%' : `left:${50 - w}%`};width:${w}%"></i></span>
        <b class="${cls(r.net)}">${sg(r.net)}</b></div>`;
    }).join('');
  }
  function paintSess() {
    const hrs = { asia: '07–14', london: '14–20', ny: '20–04', late: '04–07' };
    $('dhSess').innerHTML = bars(V.sessions.map(s => ({ ...s, name: `${s.name} ${hrs[s.k] || ''}` })));
    $('dhSide').innerHTML = bars(['BUY', 'SELL'].map(k => ({ name: k, ...(V.sides[k] || { n: 0, net: 0, win_rate: null }) })));
  }

  function paintTrades() {
    const T = V.trades.slice(0, shown);
    $('dhCount').textContent = `ล่าสุด ${T.length} จาก ${V.count.toLocaleString()} ไม้ (ตั้งแต่เริ่ม EA)`;
    $('dhTrades').innerHTML = T.length ? T.map(t => `<div class="dh-tr">
        <div><span class="${t.side === 'BUY' ? 'b' : 's'}">${t.side}</span> <span class="mono">${t.vol}</span> <span class="dh-mut">${esc(t.sym)}${t.magic ? ' · #' + t.magic : ''}</span>
        <small>${t.ct ? thDate(t.ct, { day: 'numeric', month: 'short' }) + ' ' + thTime(t.ct) : ''} · ${fx(t.open, 2)} → ${fx(t.close, 2)}</small></div>
        <b class="mono ${cls(t.pnl)}">${sg(t.pnl)}</b></div>`).join('') : '<div class="dh-msg">ยังไม่มีไม้ที่ปิด (ถ้าเพิ่งอัปเดต EA ประวัติจะทยอยขึ้นภายในไม่กี่นาที)</div>';
    $('dhMore').hidden = shown >= V.trades.length;
  }
})();

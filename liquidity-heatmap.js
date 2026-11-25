import { liquidityRange, rankBook } from './liquidity-levels.mjs?v=409160';
// Sample displayed Binance limit orders. Each column is one book, not traded volume.
(() => {
  'use strict';
  const O = window.OI;
  if (!O || O.sym !== 'gold') return;
  const pref = 'oit_liquidity_enabled' + (O.psfx || '');
  const suffix = O.psfx || '';
  const interval = 30000, retention = 3600000, row = 1;
  const endpoint = 'https://oi-gold-liquidity.oigoldpro.workers.dev/history';
  const periods = {'1m':60,'5m':300,'15m':900,'30m':1800,'1h':3600,'4h':14400,'1d':86400};
  const scale = O.chart.timeScale();
  let enabled = localStorage.getItem(pref) === '1', samples = [], busy = false, retryAt = 0, redraw;
  let syncKey='', historyKey='', syncing=false, sourceStatus='', syncStatus='', generation=0;
  function setStatus(value) {
    sourceStatus=value;
    const node=document.getElementById('liqStatus');
    if (node) node.textContent=[sourceStatus,syncStatus].filter(Boolean).join(' · ');
  }
  function merge(items) {
    const slots=new Map();
    for (const s of [...samples,...items]) {
      if (!Number.isFinite(s.offset) || !s.rows?.length || s.time<=Date.now()-retention) continue;
      const slot=Math.floor(s.time/interval), prev=slots.get(slot);
      if (!prev || prev.time<s.time || (prev.time===s.time && s.synced))
        slots.set(slot,{...s,peak:Math.max(...s.rows.map(r=>Math.abs(r[1])))});
    }
    samples=[...slots.values()].sort((a,b)=>a.time-b.time);
  }
  function saveHistory() {
    if (historyKey) try { localStorage.setItem(historyKey,JSON.stringify(samples)); } catch {}
  }
  function importOld() {
    const owner='oit_liq_migration_owner'+suffix;
    if (localStorage.getItem(owner) && localStorage.getItem(owner)!==syncKey) return;
    for (const name of ['oit_liquidity_xau_depth_v1','oit_liquidity_xau_depth_ranked_v2']) {
      const old=JSON.parse(localStorage.getItem(name+suffix)||'[]');
      const slots=new Map();
      for (const s of old) if (s.time>Date.now()-retention && !s.remote && Number.isFinite(s.offset))
        slots.set(Math.floor(s.time/interval),s);
      for (const s of slots.values()) {
        if (s.step===1) { merge([s]); continue; }
        const step=s.step||0.1;
        const entries=s.rows.map(([tick,q])=>[(tick+0.5)*step,q]);
        const bids=entries.filter(r=>r[1]>0).sort((a,b)=>b[0]-a[0]);
        const asks=entries.filter(r=>r[1]<0).sort((a,b)=>a[0]-b[0]).map(([p,q])=>[p,-q]);
        try { merge([{...rankBook({bids,asks}),time:s.time,offset:s.offset}]); } catch {}
      }
    }
    localStorage.setItem(owner,syncKey);
  }
  async function sync() {
    if (syncing || !syncKey || document.hidden) return;
    syncing=true;
    const key=syncKey, headers={Authorization:'Bearer '+key};
    try {
      const pending=samples.filter(s=>!s.synced && s.time>Date.now()-retention+5000);
      for (let i=0;i<pending.length;i+=20) {
        const part=pending.slice(i,i+20);
        const res=await fetch(endpoint,{method:'POST',headers:{...headers,'Content-Type':'application/json'},
          body:JSON.stringify(part.map(({time,offset,step,rows})=>({time,offset,step,rows}))),signal:AbortSignal.timeout(10000)});
        if (!res.ok) throw Error('HTTP '+res.status);
        if (key!==syncKey) return;
        merge(part.map(s=>({...s,synced:true})));
      }
      const res=await fetch(endpoint,{headers,cache:'no-store',signal:AbortSignal.timeout(10000)});
      if (!res.ok) throw Error('HTTP '+res.status);
      const data=await res.json();
      if (key!==syncKey) return;
      merge(data.samples.map(s=>({...s,synced:true})));
      if (data.samples.length && localStorage.getItem(pref)===null) {
        enabled=true;
        const btn=document.querySelector('#liquidityBookBox button');
        if (btn) { btn.classList.add('on'); btn.setAttribute('aria-pressed','true'); }
      }
      syncStatus='ส่วนกลาง '+data.samples.length+' รอบ'+(data.samples.length?' · ล่าสุด '+new Date(data.samples.at(-1).time).toLocaleTimeString('th-TH'):'');
      saveHistory(); if (enabled) redraw?.();
    } catch (e) {
      if (key===syncKey) syncStatus='รอซิงก์ส่วนกลาง · '+e.message;
    } finally { syncing=false; setStatus(sourceStatus); }
  }
  const login=document.getElementById('login');
  async function session() {
    const token=++generation;
    syncKey=''; historyKey=''; samples=[]; syncStatus=''; setStatus('');
    redraw?.();
    const code=localStorage.getItem('oit_code');
    if (!code || !login.hidden) return;
    const encoder=new TextEncoder();
    const material=await crypto.subtle.importKey('raw',encoder.encode(code),'PBKDF2',false,['deriveBits']);
    const bits=await crypto.subtle.deriveBits({name:'PBKDF2',salt:encoder.encode('OI Gold Pro / liquidity history / v1'),iterations:210000,hash:'SHA-256'},material,256);
    if (generation!==token) return;
    syncKey=Array.from(new Uint8Array(bits),v=>v.toString(16).padStart(2,'0')).join('');
    historyKey='oit_liq_sync_v1_'+syncKey+suffix;
    try { merge(JSON.parse(localStorage.getItem(historyKey)||'[]')); importOld(); } catch {}
    if (enabled) redraw?.();
    sync(); sample();
  }
  async function sample() {
    if (!syncKey || busy || document.hidden || Date.now() < retryAt) return;
    busy = true;
    const key=syncKey;
    try {
      const res = await fetch('https://fapi.binance.com/fapi/v1/depth?symbol=XAUUSDT&limit=1000',
        {cache:'no-store', signal:AbortSignal.timeout(7000)});
      if (!res.ok) {
        if (res.status === 429 || res.status === 418)
          retryAt = Date.now() + Math.max(60, Number(res.headers.get('Retry-After')) || 60) * 1000;
        throw Error('HTTP ' + res.status);
      }
      const book = await res.json();
      const time = Number(book.E || book.T);
      if (key!==syncKey || document.hidden) return;
      if (!Number.isFinite(time) || Math.abs(time - Date.now()) > 30000) throw Error('ข้อมูลล่าช้า');
      if (time <= (samples.at(-1)?.time || 0)) { setStatus('รอสมุดคำสั่งชุดใหม่'); return; }
      if (!Number.isFinite(O.adj)) throw Error('รอข้อมูลระดับราคา');
      const snapshot = rankBook(book);
      merge([{time,...snapshot,offset:O.adj-O.gcOff()}]); saveHistory(); sync();
      setStatus('ข้อมูลล่าสุด ' + new Date(time).toLocaleTimeString('th-TH') + ' · ระยะที่เห็นจริง Bid −$' + snapshot.coverage[0].toFixed(2) + ' / Ask +$' + snapshot.coverage[1].toFixed(2));
      if (enabled) redraw?.();
    } catch (err) {
      setStatus('อ่านสมุดคำสั่ง Binance ไม่ได้ · ' + err.message + ' · จะลองใหม่อัตโนมัติ');
      if (enabled) redraw?.();
      retryAt = Math.max(retryAt, Date.now() + 10000);
    } finally { busy = false; }
  }
  function render(target) {
    if (!enabled || O.tf !== O.displayedTF || !samples.length) return;
    const duration = periods[O.tf], bars = O.series.data();
    if (!duration || !bars.length) return;
    const spacing = scale.options().barSpacing;
    target.useMediaCoordinateSpace(({context:ctx,mediaSize}) => {
      let i = bars.length - 1, lastPixel = Infinity;
      for (let j = samples.length - 1; j >= 0; j--) {
        const s = samples[j], time = s.time / 1000 + O.tzShift;
        if (s.time < Date.now() - retention) break;
        while (i >= 0 && bars[i].time > time) i--;
        if (i < 0) break;
        const fraction = (time - bars[i].time) / duration;
        if (fraction >= 1) continue;
        const center = scale.timeToCoordinate(bars[i].time);
        if (!Number.isFinite(center)) continue;
        const x = Math.floor(center + (fraction - 0.5) * spacing);
        const end = Math.min(samples[j+1]?.time ?? Date.now(), s.time + interval * 1.5);
        const width = Math.max(1, spacing * (end - s.time) / (duration * 1000));
        if (x + width < 0) break;
        if (x >= mediaSize.width || x === lastPixel) continue;
        lastPixel = x;
        const step = s.step || 0.10;
        const offset = O.adj;
        for (const [tick, signed] of s.rows) {
          const y = O.series.priceToCoordinate((tick + 1) * step - offset);
          const bottom = O.series.priceToCoordinate(tick * step - offset);
          if (!Number.isFinite(y) || !Number.isFinite(bottom) || y > mediaSize.height || bottom < 0) continue;
          const intensity = Math.abs(signed) / s.peak;
          const alpha = 0.12 + 0.78 * Math.sqrt(intensity);
          const rgb = signed > 0 ? (intensity >= 0.65 ? '129,255,62' : '14,166,91') :
            (intensity >= 0.65 ? '255,157,28' : '221,51,61');
          ctx.fillStyle = 'rgba(' + rgb + ',' + alpha + ')';
          ctx.fillRect(x,y,Math.ceil(width),Math.max(2,bottom-y));
        }
      }
    });
  }
  const view = {zOrder:()=>'bottom', renderer:()=>({draw:render})};
  O.series.attachPrimitive({attached({requestUpdate}) { redraw = requestUpdate; }, paneViews:()=>[view]});
  const menu = document.getElementById('indMenu');
  function mount() {
    if (!menu || menu.hidden || document.getElementById('liquidityBookBox')) return;
    const box = document.createElement('div');
    box.id = 'liquidityBookBox'; box.className = 'gsbox';
    box.innerHTML = '<div class="row"><button type="button" class="gsb">Liquidity Heatmap</button></div><span class="gsinfo">Binance Futures · XAUUSDT · Bid เขียว / Ask ส้ม · ช่วง ±$' + liquidityRange + ' จากราคากลาง Binance · รวมช่องละ $1 · สูงสุด 10 แนวต่อฝั่ง เรียงตามปริมาณ · เก็บทุก 30 วินาที ย้อนหลัง 1 ชม. · ซิงก์ประวัติข้ามเครื่องที่ใช้รหัสแอปเดียวกัน</span><span class="gsinfo" id="liqStatus"></span>';
    const btn = box.querySelector('button');
    function paint() { btn.classList.toggle('on',enabled); btn.setAttribute('aria-pressed',String(enabled)); }
    btn.onclick = () => {
      enabled = !enabled;
      try { localStorage.setItem(pref,enabled?'1':'0'); } catch (_) {}
      paint(); redraw?.(); if (enabled) sync();
    };
    paint(); menu.append(box); setStatus(sourceStatus);
  }
  if (menu) { new MutationObserver(mount).observe(menu,{childList:true,attributes:true,attributeFilter:['hidden']}); mount(); }
  setInterval(sync,interval);
  setInterval(sample, interval);
  setInterval(() => { if (!document.hidden) saveHistory(); },60000);
  document.addEventListener('visibilitychange',()=>{ if (document.hidden) saveHistory(); else { sync(); sample(); } });
  window.addEventListener('pagehide',saveHistory);
  new MutationObserver(session).observe(login,{attributes:true,attributeFilter:['hidden']});
  session();
})();
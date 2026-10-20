export const PAGE = /* html */ `<!doctype html>
<html lang="th">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Stamp HOME</title>
<link rel="manifest" href="/manifest.json">
<link rel="icon" type="image/png" href="/icon.png">
<link rel="apple-touch-icon" href="/icon.png">
<meta name="apple-mobile-web-app-title" content="โซลาร์บ้าน">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="theme-color" content="#0f1412">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Thai:wght@400;500;600;700&family=JetBrains+Mono:wght@500;700&family=Orbitron:wght@600;800&display=swap" rel="stylesheet">
<style>
:root{
  --bg:#0f1412; --card:#171e1b; --line:#26302c; --text:#e8efe9; --muted:#8a9a92;
  --sun:#f2b33d; --sun2:#e8793a; --charge:#3fbf8a; --drain:#ef6f5e; --grid:#6ea8ff; --gridx:#b58cff;
  --num:'JetBrains Mono',ui-monospace,monospace;
}
@media (prefers-color-scheme: light){
  :root{ --bg:#f3f1ea; --card:#ffffff; --line:#e3e0d6; --text:#1c2420; --muted:#6c7770;
    --sun:#c9850c; --sun2:#c4581c; --charge:#16875a; --drain:#c8432f; --grid:#2f6fd6; --gridx:#7b4fd6; }
}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font:15px/1.45 'IBM Plex Sans Thai',system-ui,sans-serif;
  padding:max(14px,env(safe-area-inset-top)) 16px calc(28px + env(safe-area-inset-bottom));max-width:560px;margin-inline:auto}
header{margin:2px 2px 14px}
.topbar{display:flex;align-items:center;justify-content:space-between;gap:8px}
.ver{font:600 11px var(--num);color:var(--muted);border:1px solid var(--line);border-radius:999px;padding:2px 8px;letter-spacing:.5px}
.upd{color:var(--muted);font-size:12.5px;text-align:right}
.brand{text-align:center;margin-top:10px;position:relative}
.brand h1{margin:0;font-family:'Orbitron',var(--num);font-weight:800;font-size:30px;letter-spacing:3px;line-height:1.1;
  background:linear-gradient(92deg,var(--sun) 0%,#ffe08a 38%,var(--charge) 100%);-webkit-background-clip:text;background-clip:text;color:transparent;
  filter:drop-shadow(0 0 12px color-mix(in srgb,var(--sun) 35%,transparent))}
.brand .bar{height:2px;width:150px;margin:8px auto 0;border-radius:2px;background:linear-gradient(90deg,transparent,var(--charge),var(--sun),transparent);box-shadow:0 0 10px var(--charge)}
.brand .tag{margin-top:6px;font:600 9.5px 'Orbitron',var(--num);letter-spacing:4px;color:var(--muted)}
.dot{display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--charge);margin-right:6px;vertical-align:1px}
.dot.old{background:var(--drain)}
.tabs{display:grid;grid-template-columns:1fr 1fr;gap:4px;padding:4px;background:var(--card);border:1px solid var(--line);border-radius:14px;margin-bottom:12px;position:sticky;top:max(6px,env(safe-area-inset-top));z-index:5}
.tabs button{border:0;background:transparent;color:var(--muted);font:600 15px 'IBM Plex Sans Thai',system-ui,sans-serif;padding:9px;border-radius:10px}
.tabs button.on{background:color-mix(in srgb,var(--text) 10%,transparent);color:var(--text)}
.card{background:var(--card);border:1px solid var(--line);border-radius:18px;padding:16px;margin-bottom:12px}
.label{color:var(--muted);font-size:13px}
.num{font-family:var(--num);font-weight:700;letter-spacing:-.5px}
.hero{display:grid;grid-template-columns:auto 1fr;gap:16px;align-items:center;position:relative}
.refresh{position:absolute;top:12px;right:12px;width:38px;height:38px;border-radius:50%;border:1px solid var(--line);background:var(--card2,transparent);color:var(--text);font-size:19px;line-height:1;display:flex;align-items:center;justify-content:center;padding:0;cursor:pointer}
.refresh:disabled{opacity:.6;cursor:default}
.refresh.busy{animation:spin 1s linear infinite;border-color:var(--charge);color:var(--charge)}
@keyframes spin{to{transform:rotate(360deg)}}
.batt{width:64px;height:112px;border:3px solid var(--text);border-radius:12px;position:relative;padding:4px;opacity:.95}
.batt:before{content:"";position:absolute;top:-9px;left:20px;width:18px;height:6px;border-radius:3px 3px 0 0;background:var(--text)}
.fill{position:absolute;left:4px;right:4px;bottom:4px;border-radius:7px;background:var(--charge);transition:height .6s}
.soc{font-size:46px;line-height:1}
.soc small{font-size:20px;color:var(--muted)}
.state{margin-top:6px;font-weight:600}
.state.c{color:var(--charge)} .state.d{color:var(--drain)}
.eta{margin-top:8px;padding:8px 10px;border-radius:10px;background:color-mix(in srgb,var(--text) 6%,transparent);font-size:14px}
.tiles{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px}
.tile{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:12px 14px}
.tile .v{font-size:22px;margin-top:2px}
.tile .v small{font-size:13px;color:var(--muted);font-family:inherit;font-weight:500}
.tile .sub{color:var(--muted);font-size:12px;margin-top:2px}
.sun{color:var(--sun)} .gridc{color:var(--grid)}
h2{font-size:15px;margin:0 0 10px;font-weight:600}
h2 .label{font-weight:400}
.io{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.io .big{font-size:28px}
.io .big small{font-size:14px;color:var(--muted);font-weight:500;font-family:inherit}
.rows{margin-top:12px;border-top:1px solid var(--line)}
.row{display:flex;justify-content:space-between;gap:10px;padding:8px 0;border-bottom:1px solid var(--line);font-size:14px}
.row:last-child{border-bottom:0}
.row span:last-child{font-family:var(--num);font-weight:500;text-align:right}
.row.total span{font-weight:700}
.row.hl{margin:6px -10px;padding:12px 12px;border:1px solid color-mix(in srgb,var(--grid) 55%,transparent);border-radius:12px;
  background:linear-gradient(90deg,color-mix(in srgb,var(--grid) 18%,transparent),color-mix(in srgb,var(--grid) 6%,transparent));
  box-shadow:0 0 14px color-mix(in srgb,var(--grid) 25%,transparent)}
.row.hl span:first-child{font-weight:700;color:var(--text)}
.row.hl span:last-child{font-size:20px;font-weight:700;color:var(--grid)}
.row.hl small{font-size:12px;color:var(--muted);font-weight:500}
.sub-h{margin:14px 0 2px;font-size:12px;color:var(--muted);letter-spacing:.3px}
svg{display:block;width:100%;height:auto}
.ch{padding:10px 0 6px;border-top:1px solid var(--line)}
.ch:first-child{border-top:0;padding-top:0}
.ch-h{display:flex;justify-content:space-between;align-items:baseline;font-size:13px;margin-bottom:2px}
.ch-h b{font-weight:600}
.ch-h .rv{font-family:var(--num);font-weight:700;font-size:14px}
.ch-h .rv small{color:var(--muted);font-weight:500}
.ch svg{touch-action:pan-y}
.cursor{font-size:12px;color:var(--muted);text-align:center;margin-top:4px}
.cal-nav{display:flex;justify-content:space-between;align-items:center;margin-bottom:10px}
.cal-nav button{border:1px solid var(--line);background:transparent;color:var(--text);width:40px;height:36px;border-radius:10px;font-size:18px}
.cal-nav button:disabled{opacity:.3}
.cal-nav b{font-size:16px}
.cal{display:grid;grid-template-columns:repeat(7,1fr);gap:4px}
.cal .wd{text-align:center;font-size:11px;color:var(--muted);padding-bottom:2px}
.cal .d{border:1px solid var(--line);border-radius:10px;min-height:62px;padding:4px 3px;text-align:center;background:transparent;color:var(--text);font-family:inherit;display:flex;flex-direction:column;align-items:center;gap:1px}
.cal .d .n{font-size:13px;font-weight:600}
.cal .d .a,.cal .d .b{font-family:var(--num);font-size:10.5px;line-height:1.25}
.cal .d .a{color:var(--sun)} .cal .d .b{color:var(--drain)}
.cal .d .c{font-family:var(--num);font-size:10.5px;line-height:1.25;color:var(--gridx)}
.cal .d.none{opacity:.35}
.cal .d.today{border-color:var(--muted)}
.cal .d.sel{border-color:var(--charge);background:color-mix(in srgb,var(--charge) 12%,transparent)}
.cal .pad{min-height:62px}
.pk{padding:12px 0;border-top:1px solid var(--line)} .pk:first-of-type{border-top:0;padding-top:4px}
.pk-h{display:flex;justify-content:space-between;align-items:baseline}
.pk-m{display:flex;align-items:center;gap:16px;margin:4px 0}
.pk-m .soc{font-size:36px;line-height:1}
.pk.stale{opacity:.55}
.chip{display:inline-block;padding:2px 9px;border-radius:999px;font-size:11.5px;background:color-mix(in srgb,var(--drain) 20%,transparent);color:var(--drain);margin:4px 4px 0 0}
.pk svg{display:block;width:100%;height:46px;margin:6px 0 2px}
.pk{cursor:pointer;-webkit-tap-highlight-color:transparent}
.pk .more{color:var(--muted);font-size:12px;margin-top:6px;text-align:right}
.sheet{position:fixed;inset:0;z-index:50;background:var(--bg);overflow-y:auto;-webkit-overflow-scrolling:touch;padding:0 16px calc(24px + env(safe-area-inset-bottom))}
.sheet-in{max-width:520px;margin:0 auto}
.sheet-top{position:sticky;top:0;background:var(--bg);display:flex;justify-content:space-between;align-items:center;padding:calc(12px + env(safe-area-inset-top)) 0 10px;z-index:2}
.sheet-top b{font-size:18px}
.xbtn{width:38px;height:38px;border-radius:999px;border:1px solid var(--line);background:var(--card);color:var(--text);font-size:18px;font-family:inherit}
.cellrow{display:grid;grid-template-columns:30px 62px 1fr 56px;gap:8px;align-items:center;padding:5px 0;font-size:13px}
.cellrow .n{color:var(--muted);font-family:var(--num)}
.cellrow .vv{font-family:var(--num);font-size:14px;font-weight:600}
.cellrow .bar{height:14px;border-radius:7px;background:var(--line);overflow:hidden}
.cellrow .bar i{display:block;height:100%;border-radius:7px}
.cellrow .dv{font-family:var(--num);font-size:11.5px;text-align:right;color:var(--muted)}
.cellrow.hi .vv{color:var(--sun)} .cellrow.lo .vv{color:var(--drain)}
.bal{display:inline-block;font-size:10px;padding:1px 6px;border-radius:999px;background:color-mix(in srgb,var(--gridx) 22%,transparent);color:var(--gridx);margin-left:4px;vertical-align:1px}
.sheet .grid2{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:10px 0}
.sheet .grid2 div{background:var(--card);border-radius:12px;padding:10px}
.sheet .grid2 .big{font-size:20px}
.cal .d.inr{background:color-mix(in srgb,var(--gridx) 16%,transparent);border-color:var(--gridx)}
.rbtn{width:100%;padding:10px;border-radius:12px;border:1px solid var(--line);background:transparent;color:var(--text);font-weight:600;font-size:14px;font-family:inherit;margin-top:12px}
.rbtn.on{border-color:var(--gridx);color:var(--gridx)}
.rng{margin-top:12px;padding:12px;border-radius:14px;border:1px solid color-mix(in srgb,var(--gridx) 45%,transparent);background:color-mix(in srgb,var(--gridx) 6%,transparent)}
.rng .tiles2{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:8px 0}
.rng .tiles2 div{background:var(--card);border-radius:12px;padding:8px}
.rng .tiles2 .big{font-size:20px}
.legend{display:flex;gap:14px;font-size:12px;color:var(--muted);margin-top:8px;flex-wrap:wrap}
.legend i{display:inline-block;width:9px;height:9px;border-radius:3px;margin-right:5px;vertical-align:-1px}
.err{background:color-mix(in srgb,var(--drain) 14%,transparent);border:1px solid color-mix(in srgb,var(--drain) 40%,transparent);color:var(--text);border-radius:12px;padding:10px 12px;font-size:13px;margin-bottom:12px;display:none}
.keybox{display:none}
.keybox input{width:100%;padding:12px;border-radius:12px;border:1px solid var(--line);background:var(--bg);color:var(--text);font-size:16px;margin:10px 0}
.keybox button,.btn{width:100%;padding:12px;border-radius:12px;border:0;background:var(--charge);color:#06120c;font-weight:700;font-size:15px;font-family:inherit}
.muted{color:var(--muted)}
.hide{display:none}
.flow{background:radial-gradient(120% 90% at 50% 0%,color-mix(in srgb,var(--charge) 8%,var(--card)),var(--card))}
.flow svg{max-width:420px;margin:0 auto}
#day-detail{scroll-margin-top:72px}
</style>
</head>
<body>
<header>
  <div class="topbar">
    <span class="ver" id="ver"></span>
    <div class="upd"><span class="dot" id="dot"></span><span id="upd">กำลังโหลด…</span></div>
  </div>
  <div class="brand">
    <h1>Stamp HOME</h1>
    <div class="bar"></div>
    <div class="tag">SOLAR · BATTERY · GRID</div>
  </div>
</header>

<div class="card keybox" id="keybox">
  <h2>ใส่รหัสเข้าใช้</h2>
  <div class="label">รหัส SOLAR_APP_KEY (ใส่ครั้งเดียว เครื่องนี้จะจำไว้)</div>
  <input id="keyin" type="password" autocomplete="current-password" placeholder="รหัส">
  <button onclick="saveKey()">เข้าใช้</button>
</div>

<div class="err" id="err"></div>

<div id="app" class="hide">
  <nav class="tabs">
    <button id="tab-now" class="on" onclick="showTab('now')">วันนี้</button>
    <button id="tab-hist" onclick="showTab('hist')">ย้อนหลัง</button>
  </nav>

  <!-- ===== TODAY ===== -->
  <div id="view-now">
    <section class="card hero">
      <button class="refresh" id="refbtn" onclick="pollNow(this)" aria-label="ดึงค่าล่าสุด" title="ดึงค่าล่าสุด">↻</button>
      <div class="batt"><div class="fill" id="fill"></div></div>
      <div>
        <div class="label">แบตเตอรี่ · LiFePO4 <span id="cap"></span></div>
        <div class="soc num"><span id="soc">–</span><small>%</small></div>
        <div class="num muted" id="volt">– V</div>
        <div class="label" id="socinv"></div>
        <div class="state" id="state">–</div>
      </div>
      <div class="eta" id="eta" style="grid-column:1/-1">–</div>
    </section>

    <section class="card flow"><h2>การไหลของพลังงาน <span class="label">· ตอนนี้</span></h2><div id="flow"></div></section>

    <section class="card hide" id="bmscard"></section>
    <div class="sheet hide" id="sheet"><div class="sheet-in" id="sheet-in"></div></div>

    <div class="tiles">
      <div class="tile"><div class="label">แผงชุด 1 · อินเวอร์เตอร์</div><div class="v num sun" id="pv1">–</div><div class="sub">8 แผง</div></div>
      <div class="tile"><div class="label">แผงชุด 2 · MPPT</div><div class="v num" style="color:var(--sun2)" id="pv2">–</div><div class="sub" id="pv2sub">4 แผง</div></div>
      <div class="tile"><div class="label">ไฟที่บ้านใช้</div><div class="v num gridc" id="load">–</div><div class="sub">จากอินเวอร์เตอร์</div></div>
      <div class="tile"><div class="label">ไฟกริด</div><div class="v num" id="grid">–</div><div class="sub" id="gridsub">&nbsp;</div></div>
    </div>

    <div id="today-summary"></div>
    <section class="card"><h2>กราฟวันนี้ <span class="label">· แตะหรือลากบนกราฟเพื่อดูค่า</span></h2><div id="today-charts"></div></section>

    <button class="btn" onclick="pollNow(this)">ดึงค่าล่าสุดตอนนี้</button>
    <p class="muted" style="font-size:12px;margin-top:12px">อัปเดตทุก 1 นาที · 1 วัน = 05:00 ถึง 05:00 · ตัวเลข Ah คำนวณจากกระแส MPPT + อินเวอร์เตอร์ (ค่าประมาณ ±5–10%)</p>
  </div>

  <!-- ===== HISTORY ===== -->
  <div id="view-hist" class="hide">
    <section class="card">
      <div class="cal-nav">
        <button id="prevM" onclick="moveMonth(-1)" aria-label="เดือนก่อน">‹</button>
        <b id="monthTitle">–</b>
        <button id="nextM" onclick="moveMonth(1)" aria-label="เดือนถัดไป">›</button>
      </div>
      <div class="cal" id="cal"></div>
      <button class="rbtn" id="rangeBtn" onclick="toggleRange()">เลือกช่วงวัน</button>
      <div class="legend"><span><i style="background:var(--sun)"></i>โซลาร์รวม kWh</span><span><i style="background:var(--drain)"></i>ใช้แบต Ah</span><span><i style="background:var(--gridx)"></i>กริด kWh</span></div>
      <div class="rows" id="monthTotals"></div>
    </section>
    <div id="range-box"></div>
    <div id="day-detail"><p class="muted" style="text-align:center">แตะวันที่ในปฏิทินเพื่อดูรายละเอียด</p></div>
  </div>
</div>

<script>
const $ = (id) => document.getElementById(id);
const APP_VERSION = 'v2.10';
document.addEventListener('DOMContentLoaded', () => { $('ver').textContent = APP_VERSION; });
let KEY = '';
try { KEY = localStorage.getItem('solar_key') || ''; } catch (e) {}
let DAY_START = 5, CFG = { cutoffV: 50 };
// Usable % shown to the user: 0 % = cut-off (50 V, the 10 % reserve), 100 % = full.
const usable = (soc) => (soc == null ? null : Math.max(0, Math.min(100, ((soc - (CFG.cutoffSoc ?? 10)) / (100 - (CFG.cutoffSoc ?? 10))) * 100)));

function saveKey() {
  KEY = $('keyin').value.trim();
  try { localStorage.setItem('solar_key', KEY); } catch (e) {}
  $('keybox').style.display = 'none';
  load();
}

async function api(path) {
  const r = await fetch(path, { headers: { 'x-key': KEY } });
  if (r.status === 401) { $('keybox').style.display = 'block'; $('app').classList.add('hide'); throw new Error('auth'); }
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || r.status);
  return j;
}

const fmt = (x, d = 0) => (x == null || isNaN(x) ? '–' : Number(x).toLocaleString('th-TH', { minimumFractionDigits: d, maximumFractionDigits: d }));
const watts = (w) => (w == null ? '–' : w >= 1000 ? fmt(w / 1000, 2) + '<small> kW</small>' : fmt(w) + '<small> W</small>');
const hhmm = (t) => (t ? new Date(t).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Bangkok' }) : '–');
const ago = (t) => { const m = Math.round((Date.now() - t) / 60000); return m < 1 ? 'เมื่อสักครู่' : m < 60 ? m + ' นาทีที่แล้ว' : Math.round(m / 60) + ' ชม.ที่แล้ว'; };
const thaiDate = (d, opt) => new Date(d + 'T00:00:00Z').toLocaleDateString('th-TH', Object.assign({ timeZone: 'UTC' }, opt));
const solarDay = (ts) => new Date(ts + (7 - DAY_START) * 3600000).toISOString().slice(0, 10);

// ---------- tabs ----------
function showTab(t) {
  $('view-now').classList.toggle('hide', t !== 'now');
  $('view-hist').classList.toggle('hide', t !== 'hist');
  $('tab-now').classList.toggle('on', t === 'now');
  $('tab-hist').classList.toggle('on', t === 'hist');
  if (t === 'hist' && !MONTH) { MONTH = solarDay(Date.now()).slice(0, 7); loadMonth(); }
}

// ---------- summary card (shared by today + history day) ----------
function summaryHTML(t, title) {
  const sun = t.sunStartAt
    ? 'แผงเริ่มผลิต ' + hhmm(t.sunStartAt) + ' → ' + (t.sunLive ? 'ยังผลิตอยู่' : 'หมดแดด ' + hhmm(t.sunEndAt)) + ' · ' + fmt(t.sunHours, 1) + ' ชม.'
    : 'ไม่มีข้อมูลช่วงมีแดด';
  return '<section class="card"><h2>' + title + '</h2>' +
    '<div class="io">' +
      '<div><div class="label">ชาร์จเข้าแบต</div><div class="big num" style="color:var(--charge)">' + fmt(t.ahIn, 1) + ' <small>Ah</small></div><div class="num muted">' + fmt(t.kwhIn, 2) + ' kWh</div></div>' +
      '<div><div class="label">ใช้ไปจากแบต</div><div class="big num" style="color:var(--drain)">' + fmt(t.ahOut, 1) + ' <small>Ah</small></div><div class="num muted">' + fmt(t.kwhOut, 2) + ' kWh</div></div>' +
    '</div>' +
    '<div class="sub-h">แบตเตอรี่</div><div class="rows">' +
      '<div class="row"><span>ชาร์จแบต 1 · อินเวอร์เตอร์</span><span>' + fmt(t.ahInvChg, 1) + ' Ah</span></div>' +
      '<div class="row"><span>ชาร์จแบต 2 · MPPT</span><span>' + fmt(t.ahMppt, 1) + ' Ah</span></div>' +
      '<div class="row"><span>อินเวอร์เตอร์ดึงจากฝั่ง DC (แบต+MPPT)</span><span>' + fmt(t.ahInvDis, 1) + ' Ah</span></div>' +
      '<div class="row"><span>· ในนั้นมาจาก MPPT โดยตรง</span><span>' + fmt(t.mpptToInvAh, 1) + ' Ah</span></div>' +
      '<div class="row"><span>แบตต่ำสุด</span><span>' + (t.minV != null ? fmt(t.minV, 1) + ' V · ' + hhmm(t.minVAt) : '–') + '</span></div>' +
      '<div class="row"><span>แตะ ' + CFG.cutoffV + 'V (จุดตัด)</span><span>' + (t.cutoffAt ? hhmm(t.cutoffAt) : 'ไม่ถึง') + '</span></div>' +
    '</div>' +
    '<div class="sub-h">โซลาร์และไฟในบ้าน</div><div class="rows">' +
      '<div class="row"><span>แผงชุด 1 · อินเวอร์เตอร์</span><span>' + fmt(t.pvInvKwh, 2) + ' kWh</span></div>' +
      '<div class="row"><span>แผงชุด 2 · MPPT</span><span>' + fmt(t.pvMpptKwh, 2) + ' kWh</span></div>' +
      '<div class="row total"><span>แผงรวม</span><span>' + fmt(t.pvTotalKwh, 2) + ' kWh</span></div>' +
      '<div class="row hl"><span>🏠 ไฟที่บ้านใช้ทั้งวัน</span><span>' + fmt(t.kwhLoad, 2) + ' <small>kWh</small></span></div>' +
      gridRows(t) +
    '</div>' +
    '<div class="sub-h">ช่วงมีแดด · ฝั่งอินเวอร์เตอร์</div><div class="label" style="margin-top:4px">' + sun + '</div><div class="rows">' +
      '<div class="row"><span>แผงผลิต</span><span class="sun">' + fmt(t.sunPvKwh, 2) + ' kWh</span></div>' +
      '<div class="row"><span>บ้านใช้ไป</span><span>' + fmt(t.sunLoadKwh, 2) + ' kWh</span></div>' +
      '<div class="row"><span>เหลือชาร์จเข้าแบต</span><span style="color:var(--charge)">' + fmt(t.sunChgAh, 1) + ' Ah · ' + fmt(t.sunChgKwh, 2) + ' kWh</span></div>' +
      '<div class="row"><span>ดึงจากแบตจริงช่วงมีแดด</span><span style="color:var(--drain)">' + fmt(t.sunDisAh, 1) + ' Ah</span></div>' +
      '<div class="row"><span>MPPT ส่งไปช่วยอินเวอร์เตอร์</span><span style="color:var(--sun2)">' + fmt(t.sunMpptToInvAh, 1) + ' Ah · ' + fmt(t.sunMpptToInvKwh, 2) + ' kWh</span></div>' +
      '<div class="row"><span>แผงพอใช้ในบ้าน</span><span>' + (t.sunLoadKwh > 0 ? fmt((t.sunPvKwh / t.sunLoadKwh) * 100) + '%' : '–') + '</span></div>' +
    '</div></section>';
}

function gridRows(t) {
  if (!(t.gridKwh > 0)) return '<div class="row"><span>🔌 ใช้ไฟกริด</span><span class="muted">ไม่ได้ใช้</span></div>';
  const spans = (t.gridSpans || []).filter((p) => p[1] - p[0] >= 5 * 60000);
  const mins = Math.round(t.gridMinutes || 0);
  return '<div class="row"><span>🔌 ใช้ไฟกริด <span class="label">(คำนวณ)</span></span><span style="color:var(--gridx)">' + fmt(t.gridKwh, 2) + ' kWh</span></div>' +
    '<div class="row"><span>· เวลาที่ใช้กริด</span><span>' + Math.floor(mins / 60) + ' ชม. ' + (mins % 60) + ' น. · สูงสุด ' + fmt(t.gridPeakW) + ' W</span></div>' +
    (spans.length ? '<div class="row"><span>· ช่วงเวลา</span><span style="text-align:right">' + spans.slice(0, 4).map((p) => hhmm(p[0]) + '–' + hhmm(p[1])).join('<br>') + (spans.length > 4 ? '<br>+' + (spans.length - 4) + ' ช่วง' : '') + '</span></div>' : '') +
    '<div class="row"><span>· แผง+แบตพอใช้ในบ้าน</span><span>' + (t.kwhLoad > 0 ? fmt(Math.max(0, 100 - (t.gridKwh / t.kwhLoad) * 100)) + '%' : '–') + '</span></div>';
}

// ---------- stacked charts with a shared cursor ----------
const CHARTS = [
  { k: 'load', title: 'ไฟที่บ้านใช้ทั้งหมด', unit: 'W', color: '--grid', kind: 'area' },
  { k: 'grid', title: 'ไฟจากกริด <span class="label">(คำนวณ)</span>', unit: 'W', color: '--gridx', kind: 'area', onlyIfUsed: true },
  { k: 'pv1', title: 'แผงชุด 1 · อินเวอร์เตอร์', unit: 'W', color: '--sun', kind: 'area' },
  { k: 'pv2', title: 'แผงชุด 2 · MPPT', unit: 'W', color: '--sun2', kind: 'area' },
  { k: 'pv', title: 'แผงรวม', unit: 'W', color: '--sun', kind: 'area' },
  { k: 'c1', title: 'ชาร์จแบต 1 · อินเวอร์เตอร์ (+เข้า / −ดึงออก)', unit: 'A', color: '--charge', kind: 'signed', d: 1 },
  { k: 'c2', title: 'ชาร์จแบต 2 · MPPT', unit: 'A', color: '--charge', kind: 'area', d: 1 },
  { k: 'net', title: 'ชาร์จรวม · กระแสแบตสุทธิ', unit: 'A', color: '--charge', kind: 'signed', d: 1 },
  { k: 'v', title: 'แรงดันแบต', unit: 'V', color: '--text', kind: 'line', d: 1 },
];

function css(n) { return getComputedStyle(document.documentElement).getPropertyValue(n).trim(); }

// ---------- per-battery BMS card (data relayed by the ESP32) ----------
const PROT_TH = { cellOver: 'เซลล์แรงดันเกิน', cellUnder: 'เซลล์แรงดันต่ำ', packOver: 'แพ็กแรงดันเกิน', packUnder: 'แพ็กแรงดันต่ำ',
  chgOverTemp: 'ชาร์จร้อนเกิน', chgUnderTemp: 'ชาร์จเย็นเกิน', disOverTemp: 'จ่ายร้อนเกิน', disUnderTemp: 'จ่ายเย็นเกิน',
  chgOverCurrent: 'ชาร์จกระแสเกิน', disOverCurrent: 'จ่ายกระแสเกิน', shortCircuit: 'ลัดวงจร', icError: 'ชิป BMS ผิดปกติ', mosLock: 'MOS ล็อก' };
function cellBars(p) {
  if (!p.cells || !p.cells.length) return '';
  const v = p.cells.map((x) => x / 1000), n = v.length, W = 340, H = 46;
  const lo = Math.min(...v), hi = Math.max(...v), span = Math.max(0.05, hi - lo + 0.02), base = lo - 0.01;
  const bw = W / n;
  let g = '';
  v.forEach((x, i) => {
    const h = Math.max(3, ((x - base) / span) * (H - 12));
    const col = x === hi && hi - lo > 0.004 ? css('--sun') : x === lo && hi - lo > 0.004 ? css('--drain') : css('--charge');
    g += '<rect x="' + (i * bw + 1.5).toFixed(1) + '" y="' + (H - 10 - h).toFixed(1) + '" width="' + (bw - 3).toFixed(1) + '" height="' + h.toFixed(1) + '" rx="2" fill="' + col + '" opacity=".75"/>' +
      '<text x="' + (i * bw + bw / 2).toFixed(1) + '" y="' + (H - 1) + '" font-size="7.5" text-anchor="middle" fill="' + css('--muted') + '">' + (i + 1) + '</text>';
  });
  return '<svg viewBox="0 0 ' + W + ' ' + H + '">' + g + '</svg>';
}
function packHTML(p) {
  const stale = Date.now() - p.ts > 180000;
  const col = p.a > 0.3 ? 'var(--charge)' : p.a < -0.3 ? 'var(--drain)' : 'var(--muted)';
  const chips = (p.protNames || []).map((k) => '<span class="chip">⚠ ' + (PROT_TH[k] || k) + '</span>').join('') +
    (p.fet != null && !(p.fet & 1) ? '<span class="chip">ปิดชาร์จ (MOS)</span>' : '') + (p.fet != null && !(p.fet & 2) ? '<span class="chip">ปิดจ่าย (MOS)</span>' : '');
  return '<div class="pk' + (stale ? ' stale' : '') + '" onclick="openPack(\\'' + p.mac + '\\')"><div class="pk-h"><b>' + p.label + '</b><span class="label">' + (stale ? 'ไม่ได้อัปเดต ' + ago(p.ts) : 'ล่าสุด ' + hhmm(p.ts)) + '</span></div>' +
    '<div class="pk-m"><div class="soc num">' + fmt(p.soc) + '<small>%</small></div><div><div class="num">' + fmt(p.v, 2) + ' V</div>' +
    '<div class="num" style="color:' + col + '">' + (p.a > 0 ? '+' : '') + fmt(p.a, 2) + ' A · ' + fmt(Math.abs(p.w)) + ' W</div></div></div>' +
    '<div class="label">เหลือ <b class="num">' + fmt(p.remAh, 1) + '</b> จาก ' + fmt(p.nomAh, 0) + ' Ah · ' + fmt(p.cycles) + ' รอบ' + (p.tMax != null ? ' · ' + fmt(p.tMax, 0) + '°C' : '') + '</div>' +
    cellBars(p) +
    (p.cMin != null ? '<div class="label">เซลล์ ' + fmt(p.cMin, 3) + '–' + fmt(p.cMax, 3) + ' V · ต่างกัน ' + fmt(p.cDelta * 1000) + ' mV</div>' : '') +
    chips + '<div class="more">แตะดูรายละเอียดแต่ละเซลล์ ›</div></div>';
}
let bmsData = null, openMac = null;
function openPack(mac) { openMac = mac; renderSheet(); const sh = $('sheet'); sh.classList.remove('hide'); sh.scrollTop = 0; document.body.style.overflow = 'hidden'; }
function closePack() { openMac = null; $('sheet').classList.add('hide'); document.body.style.overflow = ''; }
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closePack(); });
const CELL_LO = 2.8, CELL_HI = 3.65; // LiFePO4 working range → the bar
function renderSheet() {
  const p = bmsData && bmsData.packs && bmsData.packs.find((x) => x.mac === openMac);
  const el = $('sheet-in');
  if (!p) { el.innerHTML = '<div class="sheet-top"><b>ไม่พบข้อมูลแบต</b><button class="xbtn" onclick="closePack()">✕</button></div>'; return; }
  const stale = Date.now() - p.ts > 180000;
  const col = p.a > 0.3 ? 'var(--charge)' : p.a < -0.3 ? 'var(--drain)' : 'var(--muted)';
  const cells = (p.cells || []).map((x) => x / 1000);
  const avg = cells.length ? cells.reduce((a, b) => a + b, 0) / cells.length : null;
  const hi = cells.length ? Math.max(...cells) : null, lo = cells.length ? Math.min(...cells) : null;
  const uneven = hi != null && hi - lo > 0.004;
  const rows = cells.map((v, i) => {
    const pct = Math.max(2, Math.min(100, ((v - CELL_LO) / (CELL_HI - CELL_LO)) * 100));
    const isHi = uneven && v === hi, isLo = uneven && v === lo;
    const warn = v >= 3.6 || v <= 3.0;
    const c = warn ? css('--drain') : isHi ? css('--sun') : isLo ? css('--drain') : css('--charge');
    const dv = Math.round((v - avg) * 1000);
    const bal = p.balancing && (p.balancing >>> i) & 1 ? '<span class="bal">สมดุล</span>' : '';
    return '<div class="cellrow' + (isHi ? ' hi' : '') + (isLo ? ' lo' : '') + '"><span class="n">' + (i + 1) + '</span><span class="vv">' + v.toFixed(3) + '</span>' +
      '<span class="bar"><i style="width:' + pct.toFixed(1) + '%;background:' + c + '"></i></span><span class="dv">' + (dv > 0 ? '+' : '') + dv + ' mV' + '</span></div>' + (bal ? '<div style="margin:-4px 0 2px 38px">' + bal + '</div>' : '');
  }).join('');
  const chips = (p.protNames || []).map((k) => '<span class="chip">⚠ ' + (PROT_TH[k] || k) + '</span>').join('') +
    (p.fet != null && !(p.fet & 1) ? '<span class="chip">ปิดชาร์จ (MOS)</span>' : '') + (p.fet != null && !(p.fet & 2) ? '<span class="chip">ปิดจ่าย (MOS)</span>' : '');
  const made = p.made && p.made.y > 2000 ? p.made.d + '/' + p.made.m + '/' + (p.made.y + 543) : '–';
  el.innerHTML = '<div class="sheet-top"><b>' + p.label + '</b><button class="xbtn" onclick="closePack()">✕</button></div>' +
    '<div class="label">' + (stale ? 'ไม่ได้อัปเดต ' + ago(p.ts) : 'อัปเดตล่าสุด ' + hhmm(p.ts)) + (p.mac ? ' · ' + p.mac : '') + '</div>' +
    '<div class="grid2">' +
      '<div><div class="label">แรงดันแพ็ก</div><div class="big num">' + fmt(p.v, 2) + ' V</div></div>' +
      '<div><div class="label">กระแส · กำลัง</div><div class="big num" style="color:' + col + '">' + (p.a > 0 ? '+' : '') + fmt(p.a, 2) + ' A</div><div class="label num">' + fmt(Math.abs(p.w)) + ' W</div></div>' +
      '<div><div class="label">เหลือ (BMS บอก)</div><div class="big num">' + fmt(p.remAh, 1) + ' Ah</div><div class="label">จาก ' + fmt(p.nomAh, 0) + ' Ah</div></div>' +
      '<div><div class="label">รอบชาร์จ</div><div class="big num">' + fmt(p.cycles) + '</div><div class="label">ผลิต ' + made + '</div></div>' +
    '</div>' + (chips ? '<div>' + chips + '</div>' : '') +
    '<section class="card" style="margin-top:10px"><h2>แรงดันแต่ละเซลล์ <span class="label">· ' + cells.length + ' เซลล์</span></h2>' +
      (cells.length ? '<div class="rows" style="margin:0 0 6px">' +
        '<div class="row"><span>สูงสุด / ต่ำสุด</span><span class="num">' + hi.toFixed(3) + ' / ' + lo.toFixed(3) + ' V</span></div>' +
        '<div class="row"><span>ต่างกัน</span><span class="num" style="color:' + (hi - lo > 0.05 ? 'var(--drain)' : hi - lo > 0.02 ? 'var(--sun)' : 'var(--charge)') + '">' + Math.round((hi - lo) * 1000) + ' mV</span></div>' +
        '<div class="row"><span>เฉลี่ย</span><span class="num">' + avg.toFixed(3) + ' V</span></div></div>' + rows +
        '<div class="label" style="margin-top:8px">แถบวัดช่วง ' + CELL_LO + '–' + CELL_HI.toFixed(2) + ' V · <span style="color:var(--sun)">เหลือง</span> สูงสุด · <span style="color:var(--drain)">แดง</span> ต่ำสุดหรือเกินช่วงปลอดภัย (≥3.60 / ≤3.00 V)</div>'
        : '<p class="muted">ยังไม่ได้รับค่าแรงดันเซลล์</p>') + '</section>' +
    '<section class="card"><h2>อุณหภูมิ <span class="label">· เซนเซอร์ใน BMS</span></h2><div class="rows">' +
      ((p.temps || []).length ? p.temps.map((t, i) => '<div class="row"><span>จุดที่ ' + (i + 1) + '</span><span class="num">' + fmt(t, 1) + ' °C</span></div>').join('') : '<div class="row"><span>ไม่มีข้อมูล</span><span>–</span></div>') +
      '</div></section>' +
    '<section class="card"><h2>สถานะ</h2><div class="rows">' +
      '<div class="row"><span>MOS ชาร์จ</span><span>' + (p.fet == null ? '–' : p.fet & 1 ? 'เปิด' : 'ปิด') + '</span></div>' +
      '<div class="row"><span>MOS จ่าย</span><span>' + (p.fet == null ? '–' : p.fet & 2 ? 'เปิด' : 'ปิด') + '</span></div>' +
      '<div class="row"><span>การป้องกันที่ทำงานอยู่</span><span>' + ((p.protNames || []).length ? (p.protNames || []).map((k) => PROT_TH[k] || k).join(', ') : 'ไม่มี') + '</span></div>' +
    '</div></section>';
}
function renderBms(b, L) {
  const el = $('bmscard');
  bmsData = b;
  if (openMac) renderSheet();
  if (!b || !b.packs || !b.packs.length) { el.classList.add('hide'); return; }
  el.classList.remove('hide');
  const t = b.total, appSoc = L ? (L.soc_calc ?? L.soc) : null;
  const paused = b.pausedUntil && b.pausedUntil > Date.now();
  el.innerHTML = '<h2>แบตรายลูก <span class="label">· อ่านจาก BMS</span></h2>' + b.packs.map(packHTML).join('') +
    '<div class="rows" style="margin-top:6px">' +
      '<div class="row"><span>รวม ' + b.packs.length + ' ลูก · BMS บอกเหลือ</span><span>' + fmt(t.remAh, 1) + ' / ' + fmt(t.nomAh, 0) + ' Ah</span></div>' +
      '<div class="row"><span>กระแสรวม</span><span style="color:' + (t.a > 0.3 ? 'var(--charge)' : t.a < -0.3 ? 'var(--drain)' : 'var(--muted)') + '">' + (t.a > 0 ? '+' : '') + fmt(t.a, 2) + ' A · ' + fmt(Math.abs(t.w)) + ' W</span></div>' +
    '</div>' +
    '<button class="rbtn" onclick="pauseBms(' + (paused ? 0 : 10) + ')">' + (paused ? 'พักบลูทูธอยู่ถึง ' + hhmm(b.pausedUntil) + ' · กดเพื่อกลับมาอ่านต่อ' : 'พักบลูทูธ 10 นาที (เพื่อเปิดแอป XiaoxiangBMS)') + '</button>';
}
async function pauseBms(min) {
  try { await api('/api/bms/pause?min=' + min); await load(); } catch (e) {}
}

// ---------- energy flow diagram ----------
function renderFlow(L) {
  const V = L.batt_v || 51.2;
  const pv1 = Math.max(0, L.inv_pv_w || 0), pv2 = Math.max(0, L.mppt_pv_w || 0);
  const load = Math.max(0, L.load_w || 0);
  const c1 = (L.inv_chg_a || 0) - (L.inv_dis_a || 0);           // + inverter → battery
  const invBatW = c1 * V, mpptBatW = Math.max(0, (L.mppt_a || 0) * V);
  const netW = invBatW + mpptBatW;                                // + into the battery cells
  const gridW = L.grid_w ?? 0;                                   // estimated server-side (SmartESS has no grid watts)
  const soc = usable(L.soc_calc ?? L.soc) ?? 0;
  const C = { sun: css('--sun'), sun2: css('--sun2'), chg: css('--charge'), dr: css('--drain'), grid: css('--grid'), text: css('--text'), muted: css('--muted'), line: css('--line'), card: css('--card') };
  const kw = (w) => (w >= 1000 ? (w / 1000).toFixed(2) + ' kW' : Math.round(w) + ' W');

  // edges: path, watts, color, reverse?
  const E = [
    { d: 'M180,74 V124', w: pv1, c: C.sun },                          // PV1 → inverter
    { d: 'M290,74 V104', w: pv2, c: C.sun2 },                         // PV2 → MPPT
    { d: 'M290,140 V177', w: mpptBatW, c: C.sun2 },                   // MPPT → DC bus
    { d: 'M78,150 H140', w: gridW, c: C.grid },                       // grid → inverter
    { d: 'M180,176 V222', w: load, c: C.text },                       // inverter → home
    { d: 'M220,158 C252,158 256,185 282,185', w: Math.abs(invBatW), c: invBatW >= 0 ? C.chg : C.sun2, rev: invBatW < 0 }, // inverter ↔ DC bus
    { d: 'M290,193 V224', w: Math.abs(netW), c: netW >= 0 ? C.chg : C.dr, rev: netW < 0 },  // DC bus ↔ battery (net, what the cells really do)
  ];
  let g = '<defs><filter id="glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="2.4" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>' +
    '<radialGradient id="hub" cx="50%" cy="40%" r="70%"><stop offset="0" stop-color="' + C.chg + '" stop-opacity=".35"/><stop offset="1" stop-color="' + C.chg + '" stop-opacity="0"/></radialGradient></defs>';
  // faint tech grid
  for (let x = 20; x < 360; x += 20) g += '<line x1="' + x + '" y1="0" x2="' + x + '" y2="300" stroke="' + C.line + '" stroke-width=".5" opacity=".5"/>';
  for (let y = 20; y < 300; y += 20) g += '<line x1="0" y1="' + y + '" x2="360" y2="' + y + '" stroke="' + C.line + '" stroke-width=".5" opacity=".5"/>';

  E.forEach((e, i) => {
    const on = e.w >= 20;
    g += '<path id="fp' + i + '" d="' + e.d + '" fill="none" stroke="' + (on ? e.c : C.muted) + '" stroke-width="' + (on ? 2.4 : 1.4) + '" opacity="' + (on ? .55 : .25) + '" stroke-dasharray="' + (on ? '' : '3 4') + '" stroke-linecap="round"/>';
    if (on) {
      const dur = Math.max(0.6, Math.min(3.2, 3.4 - Math.log10(e.w) * 0.9)).toFixed(2);
      for (let k = 0; k < 3; k++) {
        g += '<circle r="3.2" fill="' + e.c + '" filter="url(#glow)"><animateMotion dur="' + dur + 's" repeatCount="indefinite" begin="' + (k * dur / 3).toFixed(2) + 's"' +
          (e.rev ? ' keyPoints="1;0" keyTimes="0;1" calcMode="linear"' : '') + '><mpath href="#fp' + i + '"/></animateMotion></circle>';
      }
    }
  });

  const node = (x, y, r, color, inner, active) =>
    '<circle cx="' + x + '" cy="' + y + '" r="' + (r + 6) + '" fill="' + color + '" opacity="' + (active ? .12 : .04) + '"/>' +
    '<circle cx="' + x + '" cy="' + y + '" r="' + r + '" fill="' + C.card + '" stroke="' + color + '" stroke-width="1.6" opacity="' + (active ? 1 : .55) + '"' + (active ? ' filter="url(#glow)"' : '') + '/>' + inner;
  const panel = (x, y, col) => '<g transform="translate(' + (x - 13) + ',' + (y - 8) + ')" stroke="' + col + '" fill="none" stroke-width="1.4"><path d="M3,0 H26 L23,16 H0 Z"/><path d="M10,0 L8,16 M17,0 L15,16 M1.5,8 H24.5"/></g>';
  const label = (x, y, t, v, col, anchor) => '<text x="' + x + '" y="' + y + '" text-anchor="' + (anchor || 'middle') + '" font-size="10" fill="' + C.muted + '">' + t + '</text>' +
    '<text x="' + x + '" y="' + (y + 14) + '" text-anchor="' + (anchor || 'middle') + '" font-size="12.5" font-weight="700" font-family="JetBrains Mono,monospace" fill="' + col + '">' + v + '</text>';

  // PV1
  g += node(180, 50, 22, C.sun, panel(180, 50, C.sun), pv1 >= 20) + label(148, 42, 'แผงชุด 1', kw(pv1), C.sun, 'end');
  // PV2
  g += node(290, 50, 22, C.sun2, panel(290, 50, C.sun2), pv2 >= 20) + label(300, 82, 'แผงชุด 2', kw(pv2), C.sun2, 'start');
  // Inverter hub
  g += '<rect x="132" y="122" width="96" height="56" rx="14" fill="url(#hub)"/>' +
       '<rect x="140" y="126" width="80" height="48" rx="12" fill="' + C.card + '" stroke="' + C.chg + '" stroke-width="1.6" filter="url(#glow)"/>' +
       '<path d="M156,146 q6,-10 12,0 t12,0 t12,0" fill="none" stroke="' + C.chg + '" stroke-width="2" stroke-linecap="round" transform="translate(4,0)"/>' +
       '<text x="180" y="166" text-anchor="middle" font-size="9.5" fill="' + C.muted + '" letter-spacing="1">INVERTER</text>';
  // MPPT
  g += '<rect x="266" y="104" width="48" height="36" rx="10" fill="' + C.card + '" stroke="' + C.sun2 + '" stroke-width="1.4" opacity="' + (pv2 >= 20 ? 1 : .6) + '"/>' +
       '<text x="290" y="126" text-anchor="middle" font-size="10" font-weight="700" fill="' + C.sun2 + '">MPPT</text>' +
       '<text x="300" y="164" font-size="11.5" font-weight="700" font-family="JetBrains Mono,monospace" fill="' + C.chg + '">' + (L.mppt_a != null ? L.mppt_a.toFixed(1) : '–') + 'A</text>';
  // Grid tower
  const gridOn = !!L.grid_v;
  g += node(52, 150, 22, C.grid, '<g stroke="' + C.grid + '" fill="none" stroke-width="1.4" stroke-linejoin="round"><path d="M45,166 L52,134 L59,166 M47,156 H57 M48.5,146 H55.5 M42,140 H62"/></g>', gridW > 0) +
       label(52, 188, 'กริด ' + (gridOn ? Math.round(L.grid_v) + 'V' : 'ไม่มีไฟ'), gridW > 0 ? '~' + kw(gridW) : (gridOn ? 'ไม่ได้ใช้' : '–'), C.grid);
  // Home
  g += node(180, 250, 24, C.text, '<path d="M168,252 L180,240 L192,252 M171,250 V262 H189 V250" fill="none" stroke="' + C.text + '" stroke-width="1.6" stroke-linejoin="round"/><path d="M178,262 V255 H182 V262" fill="none" stroke="' + C.text + '" stroke-width="1.4"/>', load >= 20) +
       label(132, 246, 'บ้านใช้', kw(load), C.text, 'end');
  // DC bus (battery terminals: MPPT, inverter and cells meet here)
  g += '<circle cx="290" cy="185" r="9" fill="' + C.card + '" stroke="' + C.muted + '" stroke-width="1.4"/><text x="290" y="188.5" text-anchor="middle" font-size="7.5" font-weight="700" fill="' + C.muted + '">DC</text>' +
       (Math.abs(invBatW) > 20 ? '<text x="242" y="206" text-anchor="middle" font-size="9" fill="' + C.muted + '">' + (invBatW < 0 ? 'ไปอินเวอร์เตอร์' : 'จากอินเวอร์เตอร์') + '</text><text x="242" y="218" text-anchor="middle" font-size="10.5" font-weight="700" font-family="JetBrains Mono,monospace" fill="' + (invBatW < 0 ? C.sun2 : C.chg) + '">' + kw(Math.abs(invBatW)) + '</text><text x="242" y="231" text-anchor="middle" font-size="10.5" font-weight="700" font-family="JetBrains Mono,monospace" fill="' + (invBatW < 0 ? C.sun2 : C.chg) + '">' + Math.abs(c1).toFixed(1) + 'A</text>' : '');
  // Battery
  const bc = soc < 20 ? C.dr : soc < 45 ? C.sun : C.chg;
  const fillH = Math.max(1, Math.min(26, (soc / 100) * 26));
  g += '<circle cx="290" cy="250" r="30" fill="' + bc + '" opacity=".1"/>' +
       '<rect x="276" y="230" width="28" height="40" rx="5" fill="' + C.card + '" stroke="' + bc + '" stroke-width="1.8" filter="url(#glow)"/>' +
       '<rect x="284" y="225" width="12" height="5" rx="1.5" fill="' + bc + '"/>' +
       '<rect x="280" y="' + (266 - fillH) + '" width="20" height="' + fillH + '" rx="2.5" fill="' + bc + '" opacity=".85"/>' +
       '<text x="290" y="290" text-anchor="middle" font-size="12.5" font-weight="700" font-family="JetBrains Mono,monospace" fill="' + bc + '">' + Math.round(soc) + '%' + (netW >= 20 ? ' · ชาร์จ' : netW <= -20 ? ' · จ่าย' : '') + '</text>' +
       '<text x="312" y="246" font-size="11.5" font-weight="700" font-family="JetBrains Mono,monospace" fill="' + (netW >= 0 ? C.chg : C.dr) + '">' + (netW >= 0 ? '+' : '') + (c1 + (L.mppt_a || 0)).toFixed(1) + 'A</text>' +
       '<text x="312" y="260" font-size="9.5" font-family="JetBrains Mono,monospace" fill="' + C.muted + '">' + (L.batt_v != null ? L.batt_v.toFixed(1) + 'V' : '') + '</text>';
  $('flow').innerHTML = '<svg viewBox="0 0 360 300" role="img" aria-label="แผนภาพการไหลของพลังงาน">' + g + '</svg>';
}


function renderCharts(el, S, date) {
  const t0 = Date.parse(date + 'T00:00:00Z') - (7 - DAY_START) * 3600000, t1 = t0 + 86400000;
  if (!S || !S.t || !S.t.length) { el.innerHTML = '<div class="muted">ไม่มีข้อมูลกราฟของวันนี้</div>'; return; }
  const W = 340, H = 92, P = { l: 34, r: 6, t: 6, b: 14 }, iw = W - P.l - P.r, ih = H - P.t - P.b;
  const x = (t) => P.l + ((t - t0) / (t1 - t0)) * iw;
  const line = css('--line'), muted = css('--muted');
  let html = '';
  const list = CHARTS.filter((c) => !c.onlyIfUsed || (S[c.k] || []).some((v) => v > 0));
  list.forEach((c, ci) => {
    const vals = S[c.k] || [];
    const nums = vals.filter((v) => v != null);
    let lo, hi;
    if (c.kind === 'line') { lo = Math.min(...nums, CFG.cutoffV) - 0.3; hi = Math.max(...nums, lo + 1) + 0.3; }
    else if (c.kind === 'signed') { const m = Math.max(5, ...nums.map(Math.abs)); lo = -m; hi = m; }
    else { lo = 0; hi = Math.max(c.unit === 'A' ? 5 : 100, ...nums); }
    const y = (v) => P.t + ih - ((v - lo) / (hi - lo)) * ih;
    const col = css(c.color);
    let g = '';
    for (let h = 0; h <= 24; h += 6) { const xx = x(t0 + h * 3600000); g += '<line x1="' + xx + '" x2="' + xx + '" y1="' + P.t + '" y2="' + (P.t + ih) + '" stroke="' + line + '"/>'; g += '<text x="' + xx + '" y="' + (H - 2) + '" font-size="8.5" text-anchor="' + (h === 24 ? 'end' : 'middle') + '" fill="' + muted + '">' + String((h + DAY_START) % 24).padStart(2, '0') + ':00</text>'; }
    // build segments, breaking on gaps > 5 min
    const segs = []; let cur = [];
    for (let i = 0; i < S.t.length; i++) {
      const v = vals[i];
      if (v == null || (i && S.t[i] - S.t[i - 1] > 300000)) { if (cur.length) segs.push(cur); cur = []; }
      if (v != null) cur.push([x(S.t[i]), v]);
    }
    if (cur.length) segs.push(cur);
    if (c.kind === 'signed') {
      const z = y(0);
      g += '<line x1="' + P.l + '" x2="' + (P.l + iw) + '" y1="' + z + '" y2="' + z + '" stroke="' + muted + '" stroke-dasharray="2 3" stroke-width=".7"/>';
      for (const sg of segs) {
        const pos = sg.map(([px, v]) => px.toFixed(1) + ',' + y(Math.max(0, v)).toFixed(1)).join(' ');
        const neg = sg.map(([px, v]) => px.toFixed(1) + ',' + y(Math.min(0, v)).toFixed(1)).join(' ');
        const a = sg[0][0].toFixed(1), b = sg[sg.length - 1][0].toFixed(1);
        g += '<polygon points="' + a + ',' + z + ' ' + pos + ' ' + b + ',' + z + '" fill="' + css('--charge') + '" opacity=".55"/>';
        g += '<polygon points="' + a + ',' + z + ' ' + neg + ' ' + b + ',' + z + '" fill="' + css('--drain') + '" opacity=".55"/>';
      }
    } else {
      for (const sg of segs) {
        const pts = sg.map(([px, v]) => px.toFixed(1) + ',' + y(v).toFixed(1)).join(' ');
        if (c.kind === 'area') { const base = y(lo); g += '<polygon points="' + sg[0][0].toFixed(1) + ',' + base + ' ' + pts + ' ' + sg[sg.length - 1][0].toFixed(1) + ',' + base + '" fill="' + col + '" opacity=".22"/>'; }
        g += '<polyline points="' + pts + '" fill="none" stroke="' + col + '" stroke-width="1.3" stroke-linejoin="round"/>';
      }
      if (c.k === 'v') { const yc = y(CFG.cutoffV); g += '<line x1="' + P.l + '" x2="' + (P.l + iw) + '" y1="' + yc + '" y2="' + yc + '" stroke="' + css('--drain') + '" stroke-dasharray="4 3" stroke-width=".8"/><text x="' + (P.l + iw - 2) + '" y="' + (yc - 3) + '" font-size="8.5" text-anchor="end" fill="' + css('--drain') + '">ตัด ' + CFG.cutoffV + 'V</text>'; }
    }
    const tick = (v) => (c.unit === 'W' && Math.abs(v) >= 1000 ? (v / 1000).toFixed(1) + 'k' : (c.kind === 'line' ? v.toFixed(1) : Math.round(v)));
    g += '<text x="' + (P.l - 4) + '" y="' + (P.t + 8) + '" font-size="8.5" text-anchor="end" fill="' + muted + '">' + tick(hi) + '</text>';
    g += '<text x="' + (P.l - 4) + '" y="' + (P.t + ih) + '" font-size="8.5" text-anchor="end" fill="' + muted + '">' + tick(lo) + '</text>';
    g += '<line class="cx" x1="0" x2="0" y1="' + P.t + '" y2="' + (P.t + ih) + '" stroke="' + css('--text') + '" stroke-width=".8" opacity="0"/>';
    html += '<div class="ch"><div class="ch-h"><b>' + c.title + '</b><span class="rv" data-k="' + c.k + '"></span></div><svg viewBox="0 0 ' + W + ' ' + H + '" data-ci="' + ci + '">' + g + '</svg></div>';
  });
  html += '<div class="cursor">–</div>';
  el.innerHTML = html;

  const svgs = el.querySelectorAll('svg'), rvs = el.querySelectorAll('.rv'), cursor = el.querySelector('.cursor');
  function show(i, active) {
    rvs.forEach((r) => {
      const c = CHARTS.find((q) => q.k === r.dataset.k), v = S[c.k][i];
      r.innerHTML = v == null ? '–' : (c.unit === 'W' ? watts(v) : fmt(v, c.d || 0) + '<small> ' + c.unit + '</small>');
      if (c.kind === 'signed' && v != null) r.style.color = v >= 0 ? css('--charge') : css('--drain');
    });
    const px = x(S.t[i]);
    svgs.forEach((s) => { const l = s.querySelector('.cx'); l.setAttribute('x1', px); l.setAttribute('x2', px); l.setAttribute('opacity', active ? '.7' : '0'); });
    cursor.textContent = (active ? 'เวลา ' : 'ล่าสุด ') + hhmm(S.t[i]);
  }
  function at(evt, s) {
    const r = s.getBoundingClientRect();
    const t = t0 + ((((evt.clientX - r.left) / r.width) * W - P.l) / iw) * (t1 - t0);
    let lo = 0, hi = S.t.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (S.t[m] < t) lo = m; else hi = m; }
    return Math.abs(S.t[lo] - t) < Math.abs(S.t[hi] - t) ? lo : hi;
  }
  svgs.forEach((s) => {
    s.addEventListener('pointerdown', (e) => show(at(e, s), true));
    s.addEventListener('pointermove', (e) => { if (e.pointerType === 'mouse' || e.buttons) show(at(e, s), true); });
  });
  show(S.t.length - 1, false);
}

// ---------- today ----------
function renderNow(d) {
  const L = d.latest;
  CFG = d.config; DAY_START = CFG.dayStartH ?? 5;
  $('app').classList.remove('hide');
  if (!L) { $('err').style.display = 'block'; $('err').textContent = 'ยังไม่มีข้อมูล รอรอบดึงข้อมูลแรก (ไม่เกิน 1 นาที) หรือกด "ดึงค่าล่าสุดตอนนี้"'; return; }
  const old = Date.now() - L.ts > 10 * 60000;
  $('dot').className = 'dot' + (old ? ' old' : '');
  $('upd').textContent = 'อัปเดต ' + hhmm(L.ts) + ' · ' + ago(L.ts);
  if (L.err) { $('err').style.display = 'block'; $('err').textContent = 'ดึงข้อมูลบางส่วนไม่ได้: ' + L.err; } else $('err').style.display = 'none';

  $('cap').textContent = '· ' + CFG.capacityAh + ' Ah';
  const socRaw = L.soc_calc ?? L.soc;
  const socMain = usable(socRaw);
  $('soc').textContent = fmt(socMain);
  $('volt').textContent = fmt(L.batt_v, 1) + ' V';
  $('socinv').textContent = 'ใช้ได้จริงก่อนถึง ' + CFG.cutoffV + 'V' + (socRaw != null ? ' · รวมสำรองในแบต ' + fmt(socRaw) + '%' : '') + (L.soc_calc != null && L.soc != null ? ' · อินเวอร์เตอร์บอก ' + fmt(L.soc) + '%' : '');
  const pct = Math.max(0, Math.min(100, socMain ?? 0));
  $('fill').style.height = 'calc(' + pct + '% - 8px)';
  $('fill').style.background = pct < 25 ? 'var(--drain)' : pct < 45 ? 'var(--sun)' : 'var(--charge)';
  const net = L.net_a ?? 0, st = $('state');
  if (net > 0.5) { st.className = 'state c'; st.innerHTML = '▲ กำลังชาร์จ <span class="num">+' + fmt(net, 1) + ' A</span>'; }
  else if (net < -0.5) { st.className = 'state d'; st.innerHTML = '▼ กำลังจ่ายออก <span class="num">' + fmt(net, 1) + ' A</span>'; }
  else { st.className = 'state'; st.textContent = 'นิ่ง (ไม่ชาร์จ/ไม่จ่าย)'; }

  const e = d.eta;
  if (e && e.hours != null) {
    const until = new Date(Date.now() + e.hours * 3600000);
    const dd = Math.round((Date.parse(solarDay(until.getTime() + DAY_START * 3600000)) - Date.parse(solarDay(Date.now() + DAY_START * 3600000))) / 86400000);
    const when = (dd === 0 ? '' : dd === 1 ? 'พรุ่งนี้ ' : 'อีก ' + dd + ' วัน ') + hhmm(until);
    $('eta').innerHTML = 'ใช้ต่อได้อีกประมาณ <b class="num">' + fmt(e.hours, 1) + ' ชม.</b> จนถึง ' + CFG.cutoffV + 'V (ราว ' + when + ') · เหลือใช้ได้ ~' + fmt(e.remainAh) + ' Ah';
  } else if (e) {
    $('eta').innerHTML = (e.state === 'charging' ? 'กำลังชาร์จ · ' : '') + 'เหลือใช้ได้ ~<b class="num">' + fmt(e.remainAh) + ' Ah</b> ก่อนถึง ' + CFG.cutoffV + 'V';
  }
  $('pv1').innerHTML = watts(L.inv_pv_w);
  $('pv2').innerHTML = watts(L.mppt_pv_w);
  $('pv2sub').textContent = d.mpptSleeping ? '4 แผง · พักดึงค่ากลางคืน ถึง 05:00' : '4 แผง · ชาร์จ ' + fmt(L.mppt_a, 1) + ' A' + (L.mppt_temp != null ? ' · ' + L.mppt_temp + '°C' : '');
  $('load').innerHTML = watts(L.load_w);
  $('grid').innerHTML = L.grid_v ? fmt(L.grid_v, 0) + '<small> V</small>' : 'ไม่มีไฟ';
  $('gridsub').textContent = !L.grid_v ? 'ไฟดับ / ไม่ได้ต่อ' : L.grid_w > 0 ? 'กำลังใช้กริด ~' + (L.grid_w >= 1000 ? fmt(L.grid_w / 1000, 2) + ' kW' : L.grid_w + ' W') : 'มีไฟ · ไม่ได้ใช้';

  const t = d.today;
  t.sunLive = L.inv_pv_w >= 30 && t.sunEndAt && Date.now() - t.sunEndAt < 10 * 60000;
  $('today-summary').innerHTML = summaryHTML(t, 'วันนี้ <span class="label">· 05:00 ถึง 05:00 พรุ่งนี้</span>');
  renderCharts($('today-charts'), d.series, t.date);
  renderFlow(L);
  renderBms(d.bms, L);
}

// ---------- history: calendar ----------
let MONTH = null, SEL = null, MONTHDATA = {};
function moveMonth(n) {
  const [y, m] = MONTH.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  MONTH = d.toISOString().slice(0, 7);
  loadMonth();
}
async function loadMonth() {
  $('monthTitle').textContent = thaiDate(MONTH + '-01', { month: 'long', year: 'numeric' });
  $('nextM').disabled = MONTH >= solarDay(Date.now()).slice(0, 7);
  $('cal').innerHTML = '<div class="muted" style="grid-column:1/-1;text-align:center;padding:20px">กำลังโหลด…</div>';
  try {
    const rows = await api('/api/month?m=' + MONTH);
    MONTHDATA = Object.fromEntries(rows.map((r) => [r.date, r]));
    drawCal();
  } catch (e) { if (e.message !== 'auth') $('cal').innerHTML = '<div class="muted">โหลดไม่ได้: ' + e.message + '</div>'; }
}
function drawCal() {
  const [y, m] = MONTH.split('-').map(Number);
  const first = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const today = solarDay(Date.now());
  let h = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'].map((w) => '<div class="wd">' + w + '</div>').join('');
  for (let i = 0; i < first; i++) h += '<div class="pad"></div>';
  let tot = { pv: 0, load: 0, grid: 0, in: 0, out: 0, n: 0 };
  for (let dnum = 1; dnum <= days; dnum++) {
    const ds = MONTH + '-' + String(dnum).padStart(2, '0');
    const r = MONTHDATA[ds];
    const inR = RA && (RB ? ds >= RA && ds <= RB : ds === RA);
    const cls = 'd' + (r ? '' : ' none') + (ds === today ? ' today' : '') + (ds === SEL ? ' sel' : '') + (inR ? ' inr' : '');
    if (r) { tot.pv += r.pvTotalKwh || 0; tot.load += r.kwhLoad || 0; tot.grid += r.gridKwh || 0; tot.in += r.ahIn || 0; tot.out += r.ahOut || 0; tot.n++; }
    h += '<button class="' + cls + '"' + (RANGE_MODE || r ? ' onclick="pickDay(\\'' + ds + '\\')"' : ' disabled') + '><span class="n">' + dnum + '</span>' +
      (r ? '<span class="a">' + fmt(r.pvTotalKwh, 1) + '</span><span class="b">' + fmt(r.ahOut, 0) + '</span>' + (r.gridKwh > 0.05 ? '<span class="c">' + fmt(r.gridKwh, 1) + '</span>' : '') : '') + '</button>';
  }
  $('cal').innerHTML = h;
  $('monthTotals').innerHTML = tot.n ? (
    '<div class="row"><span>รวมทั้งเดือน (' + tot.n + ' วันที่มีข้อมูล)</span><span></span></div>' +
    '<div class="row"><span>โซลาร์ผลิตรวม</span><span class="sun">' + fmt(tot.pv, 1) + ' kWh</span></div>' +
    '<div class="row"><span>ไฟที่บ้านใช้</span><span>' + fmt(tot.load, 1) + ' kWh</span></div>' +
    '<div class="row"><span>ใช้ไฟกริด (คำนวณ)</span><span style="color:var(--gridx)">' + fmt(tot.grid, 1) + ' kWh</span></div>' +
    '<div class="row"><span>ชาร์จเข้าแบต / ใช้แบต</span><span><span style="color:var(--charge)">' + fmt(tot.in, 0) + '</span> / <span style="color:var(--drain)">' + fmt(tot.out, 0) + '</span> Ah</span></div>') : '';
}
// ---------- range totals ----------
let RANGE_MODE = false, RA = null, RB = null;
function toggleRange() {
  RANGE_MODE = !RANGE_MODE; RA = RB = null;
  $('rangeBtn').classList.toggle('on', RANGE_MODE);
  $('rangeBtn').textContent = RANGE_MODE ? 'ยกเลิกการเลือกช่วง' : 'เลือกช่วงวัน';
  $('range-box').innerHTML = RANGE_MODE ? '<p class="muted" style="text-align:center">แตะวันเริ่มต้น แล้วแตะวันสุดท้ายของช่วง</p>' : '';
  drawCal();
}
function pickDay(ds) {
  if (!RANGE_MODE) { openDay(ds); return; }
  if (!RA || RB) { RA = ds; RB = null; $('range-box').innerHTML = '<p class="muted" style="text-align:center">แตะวันสุดท้ายของช่วง</p>'; drawCal(); return; }
  RB = ds; if (RB < RA) [RA, RB] = [RB, RA];
  drawCal(); loadRange();
}
async function loadRange() {
  const box = $('range-box');
  box.innerHTML = '<p class="muted" style="text-align:center">กำลังคำนวณ…</p>';
  try { box.innerHTML = rangeHTML(await api('/api/range?from=' + RA + '&to=' + RB)); }
  catch (e) { if (e.message !== 'auth') box.innerHTML = '<p class="muted">คำนวณไม่ได้: ' + e.message + '</p>'; }
}
function rangeHTML(d) {
  const t = d.totals, n = d.days;
  const title = thaiDate(RA, { day: 'numeric', month: 'short', year: 'numeric' }) + ' – ' + thaiDate(RB, { day: 'numeric', month: 'short', year: 'numeric' });
  if (!n) return '<div class="rng"><b>' + title + '</b><p class="muted">ไม่มีข้อมูลในช่วงนี้</p></div>';
  const avg = (x) => fmt(x / n, 2);
  const h = (x) => Math.floor(x / 60) + ' ชม. ' + (x % 60) + ' น.';
  return '<div class="rng"><b>รวมช่วง ' + title + '</b> <span class="label">· มีข้อมูล ' + n + ' วัน</span>' +
    '<div class="tiles2">' +
      '<div><div class="label">โซลาร์ผลิต</div><div class="num big sun">' + fmt(t.pvTotalKwh, 1) + ' <small>kWh</small></div><div class="label">เฉลี่ย ' + avg(t.pvTotalKwh) + ' kWh/วัน</div></div>' +
      '<div><div class="label">ไฟที่บ้านใช้</div><div class="num big">' + fmt(t.kwhLoad, 1) + ' <small>kWh</small></div><div class="label">เฉลี่ย ' + avg(t.kwhLoad) + ' kWh/วัน</div></div>' +
      '<div><div class="label">ใช้ไฟกริด (คำนวณ)</div><div class="num big" style="color:var(--gridx)">' + fmt(t.gridKwh, 1) + ' <small>kWh</small></div><div class="label">' + h(t.gridMinutes) + ' · สูงสุด ' + fmt(t.gridPeakW) + ' W</div></div>' +
      '<div><div class="label">แบต ชาร์จ / ใช้</div><div class="num big"><span style="color:var(--charge)">' + fmt(t.ahIn, 0) + '</span> / <span style="color:var(--drain)">' + fmt(t.ahOut, 0) + '</span> <small>Ah</small></div><div class="label">' + fmt(t.kwhIn, 1) + ' / ' + fmt(t.kwhOut, 1) + ' kWh</div></div>' +
    '</div>' +
    '<div class="rows">' +
      '<div class="row"><span>ไฟบ้าน − โซลาร์ (ที่ต้องพึ่งแบต/กริด)</span><span>' + fmt(t.kwhLoad - t.pvTotalKwh, 1) + ' kWh</span></div>' +
      '<div class="row"><span>โซลาร์ 1 · อินเวอร์เตอร์</span><span>' + fmt(t.pvInvKwh, 1) + ' kWh</span></div>' +
      '<div class="row"><span>โซลาร์ 2 · MPPT</span><span>' + fmt(t.pvMpptKwh, 1) + ' kWh</span></div>' +
      '<div class="row"><span>ชาร์จแบต 1 · อินเวอร์เตอร์</span><span>' + fmt(t.ahInvChg, 0) + ' Ah</span></div>' +
      '<div class="row"><span>ชาร์จแบต 2 · MPPT</span><span>' + fmt(t.ahMppt, 0) + ' Ah</span></div>' +
      '<div class="row"><span>แบตต่ำสุดในช่วง</span><span>' + (t.minV != null ? fmt(t.minV, 1) + ' V · ' + thaiDate(t.minVDate, { day: 'numeric', month: 'short' }) + ' ' + hhmm(t.minVAt) : '–') + '</span></div>' +
      '<div class="row"><span>วันที่ถึงจุดตัด ' + CFG.cutoffV + 'V</span><span>' + t.cutoffDays + ' จาก ' + n + ' วัน</span></div>' +
    '</div></div>';
}

async function openDay(ds) {
  SEL = ds; drawCal();
  const el = $('day-detail');
  el.innerHTML = '<p class="muted" style="text-align:center">กำลังโหลด…</p>';
  try {
    const d = await api('/api/day?date=' + ds);
    const title = thaiDate(ds, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) + ' <span class="label">· 05:00 ถึง 05:00</span>';
    el.innerHTML = summaryHTML(d.summary, title) + '<section class="card"><h2>กราฟ <span class="label">· แตะหรือลากบนกราฟเพื่อดูค่า</span></h2><div id="day-charts"></div></section>';
    renderCharts($('day-charts'), d.series, ds);
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (e) { if (e.message !== 'auth') el.innerHTML = '<p class="muted">โหลดไม่ได้: ' + e.message + '</p>'; }
}

// ---------- load / refresh ----------
async function load() {
  try { renderNow(await api('/api/now')); }
  catch (e) { if (e.message !== 'auth') { $('err').style.display = 'block'; $('err').textContent = 'โหลดข้อมูลไม่ได้: ' + e.message; } }
}
async function pollNow(btn) {
  btn.disabled = true; btn.classList.add('busy');
  try { await api('/api/poll'); await load(); }
  catch (e) { if (e.message !== 'auth') { $('err').style.display = 'block'; $('err').textContent = 'ดึงค่าไม่สำเร็จ: ' + e.message; } }
  finally { btn.disabled = false; btn.classList.remove('busy'); }
}
load();
setInterval(() => { if (!document.hidden && !$('view-now').classList.contains('hide')) load(); }, 60000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) load(); });
</script>
</body>
</html>`;

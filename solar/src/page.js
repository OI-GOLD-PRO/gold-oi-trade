export const PAGE = /* html */ `<!doctype html>
<html lang="th">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>โซลาร์บ้าน</title>
<link rel="manifest" href="/manifest.json">
<link rel="icon" href="/icon.svg">
<link rel="apple-touch-icon" href="/icon.svg">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="theme-color" content="#0f1412">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Thai:wght@400;500;600;700&family=JetBrains+Mono:wght@500;700&display=swap" rel="stylesheet">
<style>
:root{
  --bg:#0f1412; --card:#171e1b; --line:#26302c; --text:#e8efe9; --muted:#8a9a92;
  --sun:#f2b33d; --charge:#3fbf8a; --drain:#ef6f5e; --grid:#6ea8ff;
  --num:'JetBrains Mono',ui-monospace,monospace;
}
@media (prefers-color-scheme: light){
  :root{ --bg:#f3f1ea; --card:#ffffff; --line:#e3e0d6; --text:#1c2420; --muted:#6c7770;
    --sun:#c9850c; --charge:#16875a; --drain:#c8432f; --grid:#2f6fd6; }
}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font:15px/1.45 'IBM Plex Sans Thai',system-ui,sans-serif;
  padding:max(14px,env(safe-area-inset-top)) 16px calc(28px + env(safe-area-inset-bottom));max-width:560px;margin-inline:auto}
header{display:flex;align-items:baseline;justify-content:space-between;margin:4px 2px 14px}
h1{font-size:20px;margin:0;font-weight:700;letter-spacing:.2px}
.upd{color:var(--muted);font-size:13px}
.dot{display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--charge);margin-right:6px;vertical-align:1px}
.dot.old{background:var(--drain)}
.card{background:var(--card);border:1px solid var(--line);border-radius:18px;padding:16px;margin-bottom:12px}
.label{color:var(--muted);font-size:13px}
.num{font-family:var(--num);font-weight:700;letter-spacing:-.5px}
.hero{display:grid;grid-template-columns:auto 1fr;gap:16px;align-items:center}
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
.io{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.io .big{font-size:28px}
.io .big small{font-size:14px;color:var(--muted);font-weight:500;font-family:inherit}
.rows{margin-top:12px;border-top:1px solid var(--line)}
.row{display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--line);font-size:14px}
.row:last-child{border-bottom:0}
.row span:last-child{font-family:var(--num);font-weight:500}
svg{display:block;width:100%;height:auto}
.legend{display:flex;gap:14px;font-size:12px;color:var(--muted);margin-top:6px;flex-wrap:wrap}
.legend i{display:inline-block;width:10px;height:3px;border-radius:2px;margin-right:5px;vertical-align:3px}
.hist .row{display:grid;grid-template-columns:1.1fr 1fr 1fr .8fr;gap:6px}
.hist .row span{font-family:var(--num);font-size:13px}
.hist .head span{font-family:inherit;color:var(--muted);font-size:12px}
.err{background:color-mix(in srgb,var(--drain) 14%,transparent);border:1px solid color-mix(in srgb,var(--drain) 40%,transparent);color:var(--text);border-radius:12px;padding:10px 12px;font-size:13px;margin-bottom:12px;display:none}
.keybox{display:none}
.keybox input{width:100%;padding:12px;border-radius:12px;border:1px solid var(--line);background:var(--bg);color:var(--text);font-size:16px;margin:10px 0}
.keybox button,.btn{width:100%;padding:12px;border-radius:12px;border:0;background:var(--charge);color:#06120c;font-weight:700;font-size:15px;font-family:inherit}
.muted{color:var(--muted)}
</style>
</head>
<body>
<header>
  <h1>โซลาร์บ้าน</h1>
  <div class="upd"><span class="dot" id="dot"></span><span id="upd">กำลังโหลด…</span></div>
</header>

<div class="card keybox" id="keybox">
  <h2>ใส่รหัสเข้าใช้</h2>
  <div class="label">รหัสเดียวกับ APP_KEY ที่ตั้งใน Cloudflare (ใส่ครั้งเดียว เครื่องนี้จะจำไว้)</div>
  <input id="keyin" type="password" autocomplete="current-password" placeholder="รหัส">
  <button onclick="saveKey()">เข้าใช้</button>
</div>

<div class="err" id="err"></div>

<div id="app" style="display:none">
  <section class="card hero">
    <div class="batt"><div class="fill" id="fill"></div></div>
    <div>
      <div class="label">แบตเตอรี่ · LiFePO4 <span id="cap"></span></div>
      <div class="soc num"><span id="soc">–</span><small>%</small></div>
      <div class="num muted" id="volt">– V</div>
      <div class="state" id="state">–</div>
    </div>
    <div class="eta" id="eta" style="grid-column:1/-1">–</div>
  </section>

  <div class="tiles">
    <div class="tile"><div class="label">โซลาร์ 1 · อินเวอร์เตอร์</div><div class="v num sun" id="pv1">–</div><div class="sub">8 แผง</div></div>
    <div class="tile"><div class="label">โซลาร์ 2 · MPPT</div><div class="v num sun" id="pv2">–</div><div class="sub" id="pv2sub">4 แผง</div></div>
    <div class="tile"><div class="label">โหลดในบ้าน</div><div class="v num" id="load">–</div><div class="sub">จากอินเวอร์เตอร์</div></div>
    <div class="tile"><div class="label">ไฟกริด</div><div class="v num gridc" id="grid">–</div><div class="sub" id="gridsub">&nbsp;</div></div>
  </div>

  <section class="card">
    <h2>วันนี้</h2>
    <div class="io">
      <div><div class="label">ชาร์จเข้าแบต</div><div class="big num" style="color:var(--charge)"><span id="ahin">–</span> <small>Ah</small></div><div class="num muted" id="kwhin">– kWh</div></div>
      <div><div class="label">ใช้ไปจากแบต</div><div class="big num" style="color:var(--drain)"><span id="ahout">–</span> <small>Ah</small></div><div class="num muted" id="kwhout">– kWh</div></div>
    </div>
    <div class="rows">
      <div class="row"><span>MPPT ชาร์จเข้า</span><span id="ahm">–</span></div>
      <div class="row"><span>อินเวอร์เตอร์ ชาร์จเข้า</span><span id="ahic">–</span></div>
      <div class="row"><span>อินเวอร์เตอร์ ดึงออก</span><span id="ahid">–</span></div>
      <div class="row"><span>โซลาร์ผลิตรวม</span><span id="pvk">–</span></div>
      <div class="row"><span>โหลดใช้ไฟรวม</span><span id="loadk">–</span></div>
      <div class="row"><span>แบตต่ำสุด</span><span id="minv">–</span></div>
      <div class="row"><span>แตะ 50V (จุดตัด)</span><span id="cut">–</span></div>
    </div>
  </section>

  <section class="card">
    <h2>แบต % และกระแสวันนี้</h2>
    <div id="chart"></div>
    <div class="legend">
      <span><i style="background:var(--text)"></i>แบต %</span>
      <span><i style="background:var(--charge)"></i>ชาร์จเข้า (A)</span>
      <span><i style="background:var(--drain)"></i>จ่ายออก (A)</span>
      <span><i style="background:var(--sun)"></i>โซลาร์ (W)</span>
    </div>
  </section>

  <section class="card hist">
    <h2>ย้อนหลัง</h2>
    <div class="row head"><span>วันที่</span><span>เข้า Ah</span><span>ออก Ah</span><span>ต่ำสุด</span></div>
    <div id="hist"></div>
  </section>

  <button class="btn" onclick="pollNow(this)">ดึงค่าล่าสุดตอนนี้</button>
  <p class="muted" style="font-size:12px;margin-top:12px">ข้อมูลอัปเดตทุก 5 นาที · ตัวเลข Ah คำนวณจากกระแส MPPT + อินเวอร์เตอร์ (ค่าประมาณ ±5–10%)</p>
</div>

<script>
const $ = (id) => document.getElementById(id);
let KEY = '';
try { KEY = localStorage.getItem('solar_key') || ''; } catch (e) {}

function saveKey() {
  KEY = $('keyin').value.trim();
  try { localStorage.setItem('solar_key', KEY); } catch (e) {}
  $('keybox').style.display = 'none';
  load();
}

async function api(path) {
  const r = await fetch(path, { headers: { 'x-key': KEY } });
  if (r.status === 401) { $('keybox').style.display = 'block'; $('app').style.display = 'none'; throw new Error('auth'); }
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || r.status);
  return j;
}

const fmt = (x, d = 0) => (x == null || isNaN(x) ? '–' : Number(x).toLocaleString('th-TH', { minimumFractionDigits: d, maximumFractionDigits: d }));
const watts = (w) => (w == null ? '–' : w >= 1000 ? fmt(w / 1000, 2) + '<small> kW</small>' : fmt(w) + '<small> W</small>');
const hhmm = (t) => (t ? new Date(t).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Bangkok' }) : '–');
const ago = (t) => { const m = Math.round((Date.now() - t) / 60000); return m < 1 ? 'เมื่อสักครู่' : m < 60 ? m + ' นาทีที่แล้ว' : Math.round(m / 60) + ' ชม.ที่แล้ว'; };

function render(d) {
  const L = d.latest;
  if (!L) { $('err').style.display = 'block'; $('err').textContent = 'ยังไม่มีข้อมูล รอรอบดึงข้อมูลแรก (ไม่เกิน 5 นาที) หรือกดปุ่ม "ดึงค่าล่าสุดตอนนี้"'; $('app').style.display = 'block'; return; }
  $('app').style.display = 'block';
  const old = Date.now() - L.ts > 20 * 60000;
  $('dot').className = 'dot' + (old ? ' old' : '');
  $('upd').textContent = 'อัปเดต ' + hhmm(L.ts) + ' · ' + ago(L.ts);
  if (L.err) { $('err').style.display = 'block'; $('err').textContent = 'ดึงข้อมูลบางส่วนไม่ได้: ' + L.err; } else $('err').style.display = 'none';

  const c = d.config;
  $('cap').textContent = '· ' + c.capacityAh + ' Ah';
  $('soc').textContent = fmt(L.soc);
  $('volt').textContent = fmt(L.batt_v, 1) + ' V';
  const pct = Math.max(0, Math.min(100, L.soc ?? 0));
  $('fill').style.height = 'calc(' + pct + '% - 8px)';
  $('fill').style.background = pct < 25 ? 'var(--drain)' : pct < 45 ? 'var(--sun)' : 'var(--charge)';

  const net = L.net_a ?? 0;
  const st = $('state');
  if (net > 0.5) { st.className = 'state c'; st.innerHTML = '▲ กำลังชาร์จ <span class="num">+' + fmt(net, 1) + ' A</span>'; }
  else if (net < -0.5) { st.className = 'state d'; st.innerHTML = '▼ กำลังจ่ายออก <span class="num">' + fmt(net, 1) + ' A</span>'; }
  else { st.className = 'state'; st.textContent = 'นิ่ง (ไม่ชาร์จ/ไม่จ่าย)'; }

  const e = d.eta;
  if (e && e.hours != null) {
    const until = new Date(Date.now() + e.hours * 3600000);
    const dayKey = (t) => new Date(t + 7 * 3600000).toISOString().slice(0, 10);
    const dd = Math.round((Date.parse(dayKey(until.getTime())) - Date.parse(dayKey(Date.now()))) / 86400000);
    const when = (dd === 0 ? '' : dd === 1 ? 'พรุ่งนี้ ' : 'อีก ' + dd + ' วัน ') + hhmm(until);
    $('eta').innerHTML = 'ใช้ต่อได้อีกประมาณ <b class="num">' + fmt(e.hours, 1) + ' ชม.</b> จนถึง ' + c.cutoffV + 'V (ราว ' + when + ') · เหลือใช้ได้ ~' + fmt(e.remainAh) + ' Ah';
  } else if (e) {
    $('eta').innerHTML = (e.state === 'charging' ? 'กำลังชาร์จ · ' : '') + 'เหลือใช้ได้ ~<b class="num">' + fmt(e.remainAh) + ' Ah</b> ก่อนถึง ' + c.cutoffV + 'V';
  }

  $('pv1').innerHTML = watts(L.inv_pv_w);
  $('pv2').innerHTML = watts(L.mppt_pv_w);
  $('pv2sub').textContent = '4 แผง · ชาร์จ ' + fmt(L.mppt_a, 1) + ' A' + (L.mppt_temp != null ? ' · ' + L.mppt_temp + '°C' : '');
  $('load').innerHTML = watts(L.load_w);
  $('grid').innerHTML = L.grid_v ? fmt(L.grid_v, 0) + '<small> V</small>' : 'ไม่มีไฟ';
  $('gridsub').textContent = L.grid_v ? 'มีไฟกริด' : 'ไฟดับ / ไม่ได้ต่อ';

  const t = d.today;
  $('ahin').textContent = fmt(t.ahIn, 1);
  $('ahout').textContent = fmt(t.ahOut, 1);
  $('kwhin').textContent = fmt(t.kwhIn, 2) + ' kWh';
  $('kwhout').textContent = fmt(t.kwhOut, 2) + ' kWh';
  $('ahm').textContent = fmt(t.ahMppt, 1) + ' Ah';
  $('ahic').textContent = fmt(t.ahInvChg, 1) + ' Ah';
  $('ahid').textContent = fmt(t.ahInvDis, 1) + ' Ah';
  const pvMppt = t.mpptTodayKwh || t.kwhPvMppt;
  $('pvk').textContent = fmt(t.kwhPvInv + pvMppt, 2) + ' kWh';
  $('loadk').textContent = fmt(t.kwhLoad, 2) + ' kWh';
  $('minv').textContent = t.minV != null ? fmt(t.minV, 1) + ' V · ' + hhmm(t.minVAt) : '–';
  $('cut').textContent = t.cutoffAt ? hhmm(t.cutoffAt) : 'ยังไม่ถึง';

  chart(d.series);
}

function chart(s) {
  const W = 340, H = 170, P = { l: 26, r: 30, t: 8, b: 20 };
  const iw = W - P.l - P.r, ih = H - P.t - P.b;
  const css = getComputedStyle(document.documentElement);
  const col = (n) => css.getPropertyValue(n).trim();
  if (!s.length) { $('chart').innerHTML = '<div class="muted">ยังไม่มีข้อมูลวันนี้</div>'; return; }
  const d0 = new Date(s[0].t + 7 * 3600000); d0.setUTCHours(0, 0, 0, 0);
  const t0 = d0.getTime() - 7 * 3600000, t1 = t0 + 86400000;
  const x = (t) => P.l + ((t - t0) / (t1 - t0)) * iw;
  const maxA = Math.max(10, ...s.map((p) => Math.abs(p.a || 0)));
  const maxPv = Math.max(500, ...s.map((p) => p.pv || 0));
  const yA = (a) => P.t + ih / 2 - (a / maxA) * (ih / 2);
  const ySoc = (v) => P.t + ih - (v / 100) * ih;
  const yPv = (w) => P.t + ih - (w / maxPv) * ih;
  let g = '';
  for (const h of [0, 6, 12, 18, 24]) {
    const xx = x(t0 + h * 3600000);
    g += '<line x1="' + xx + '" x2="' + xx + '" y1="' + P.t + '" y2="' + (P.t + ih) + '" stroke="' + col('--line') + '"/>';
    g += '<text x="' + xx + '" y="' + (H - 5) + '" font-size="10" text-anchor="middle" fill="' + col('--muted') + '">' + String(h).padStart(2, '0') + ':00</text>';
  }
  g += '<line x1="' + P.l + '" x2="' + (P.l + iw) + '" y1="' + yA(0) + '" y2="' + yA(0) + '" stroke="' + col('--line') + '" stroke-dasharray="3 3"/>';
  const bw = Math.max(1, iw / 288 - 0.3);
  for (const p of s) {
    if (p.a == null) continue;
    const y = yA(p.a), y0 = yA(0);
    g += '<rect x="' + (x(p.t) - bw / 2) + '" y="' + Math.min(y, y0) + '" width="' + bw + '" height="' + Math.abs(y - y0) + '" fill="' + (p.a >= 0 ? col('--charge') : col('--drain')) + '" opacity=".75"/>';
  }
  const line = (key, yf, color, w) => {
    const pts = s.filter((p) => p[key] != null).map((p) => x(p.t).toFixed(1) + ',' + yf(p[key]).toFixed(1));
    return pts.length > 1 ? '<polyline points="' + pts.join(' ') + '" fill="none" stroke="' + color + '" stroke-width="' + w + '" stroke-linejoin="round"/>' : '';
  };
  g += line('pv', yPv, col('--sun'), 1.2);
  g += line('soc', ySoc, col('--text'), 2);
  for (const v of [0, 50, 100]) g += '<text x="' + (P.l - 4) + '" y="' + (ySoc(v) + 3) + '" font-size="9" text-anchor="end" fill="' + col('--muted') + '">' + v + '%</text>';
  for (const a of [maxA, -maxA]) g += '<text x="' + (P.l + iw + 4) + '" y="' + (a > 0 ? yA(a) + 8 : yA(a) - 3) + '" font-size="9" fill="' + col('--muted') + '">' + (a > 0 ? '+' : '') + Math.round(a) + 'A</text>';
  $('chart').innerHTML = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="กราฟแบต % และกระแสวันนี้">' + g + '</svg>';
}

function renderHist(list) {
  $('hist').innerHTML = list.map((r) => {
    const d = new Date(r.date + 'T00:00:00Z').toLocaleDateString('th-TH', { day: 'numeric', month: 'short', weekday: 'short', timeZone: 'UTC' });
    return '<div class="row"><span style="font-family:inherit">' + d + '</span><span style="color:var(--charge)">' + fmt(r.ahIn, 0) + '</span><span style="color:var(--drain)">' + fmt(r.ahOut, 0) + '</span><span>' + (r.minSoc != null ? fmt(r.minSoc) + '%' : fmt(r.minV, 1) + 'V') + '</span></div>';
  }).join('') || '<div class="muted" style="padding:8px 0">ยังไม่มีข้อมูล</div>';
}

async function load() {
  try {
    const [now, hist] = await Promise.all([api('/api/now'), api('/api/history?days=14')]);
    render(now);
    renderHist(hist);
  } catch (e) {
    if (e.message !== 'auth') { $('err').style.display = 'block'; $('err').textContent = 'โหลดข้อมูลไม่ได้: ' + e.message; }
  }
}

async function pollNow(btn) {
  btn.disabled = true; btn.textContent = 'กำลังดึง…';
  try { await api('/api/poll'); await load(); } catch (e) {}
  btn.disabled = false; btn.textContent = 'ดึงค่าล่าสุดตอนนี้';
}

load();
setInterval(load, 60000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) load(); });
</script>
</body>
</html>`;

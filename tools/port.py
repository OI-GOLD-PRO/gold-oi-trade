"""Builds the trade app's index.html from an OI Gold Pro index.html (read-only source).
Run: python3 tools/port.py <path-to-oi-gold-pro/index.html> [APP_VER]
Every edit is an exact anchor replacement and fails loudly if OI Gold Pro changed that spot.
"""
import re, sys, os

src = open(sys.argv[1], encoding="utf-8").read()
APP_VER = sys.argv[2] if len(sys.argv) > 2 else "0.3.00"
s = src


def rep(old, new):
    global s
    n = s.count(old)
    if n != 1:
        raise SystemExit(f"anchor found {n}x (expected 1): {old[:90]!r}")
    s = s.replace(old, new)


def rep_re(pattern, new):
    global s
    s2, n = re.subn(pattern, new, s, count=1, flags=re.S)
    if n != 1:
        raise SystemExit(f"regex anchor not found: {pattern[:90]!r}")
    s = s2


src_ver = re.search(r"const APP_VER = '([^']*)';", s).group(1)

# --- branding / assets ---
rep('<title>OI Gold Pro</title>', '<title>OI Gold Pro Trade</title>')
rep('href="favicon.png"', 'href="icon/favicon-32.png"')
rep('href="icon-180.png"', 'href="icon/apple-touch-icon.png"')
rep('content="OI Gold Pro"', 'content="OI Trade"')
rep('<h1>OI Gold</h1>', '<h1>OI Trade</h1>')
rep('ใส่รหัสผ่านเพื่อเข้าดูกราฟ', 'ใส่รหัสเข้าแอปเทรด')
rep('</style>\n</head>', '</style>\n<link rel="stylesheet" href="trade.css">\n</head>')
rep_re(r"const APP_VER = '[^']*';", f"const APP_VER = '{APP_VER}'; // based on OI Gold Pro V{src_ver}")
# own localStorage keys (same origin as OI Gold Pro)
s = re.sub(r"localStorage\.(getItem|setItem|removeItem)\('oi_", r"localStorage.\1('oit_", s)

# --- trade UI containers + script ---
# V1.10+: the page body is wrapped in #main and has a 2nd-chart iframe; the trade app is single chart only
rep('''  </div>
  </div>
  <div id="splitter" hidden role="separator" aria-label="ลากเพื่อปรับขนาดกราฟ"></div>
  <iframe id="paneB" title="กราฟที่ 2" hidden></iframe>

<script>
(function () {''', '''  </div>
  <div id="acct"></div>
  <div id="ticket"></div>
  <div id="sheet" hidden></div>
  </div>

<script>
(function () {''')
rep('''    <button class="icon" id="layBtn" aria-label="เลย์เอาต์กราฟ: 1 กราฟ / บนล่าง / ซ้ายขวา">▭</button>\n''', '')
# (source dash.js = market-analysis dashboard: not ported; the trade app's own dash.js is the P/L dashboard)
rep_re(r'<script src="goldscalp\.js"></script>\n<script src="dash\.js[^"]*"></script>\n<script src="live\.js[^"]*"></script>\n</body>', '''<script src="trade.js"></script>
<script src="dash.js"></script>
<script src="goldscalp.js"></script>
<script src="live.js"></script>
</body>''')
# single chart only: no 2nd-chart layout
rep_re(r"  // ---- เลย์เอาต์ 2 กราฟ: กราฟที่ 2 = iframe.*?\n  let SYM = 'gold';", "  const EMBED = false, PSFX = '', LAY = '';\n  let SYM = 'gold';")
rep_re(r"  // ---------- เลือกสัญลักษณ์ \(ทอง / น้ำมัน\) ----------\n  \$\('symName'\)\.textContent = SC\.name;\n.*?(?=  window\.OI = \{)", "  $('symName').textContent = SC.name;\n")
rep_re(r"    // ดึงข้อมูลชีตของสัญลักษณ์ใดก็ได้ \(ใช้ในแดชบอร์ด dash\.js\)\n    async fetchData\(sym\) \{.*?\n    \},\n(?=    showToast)", "")

# --- gold only (V1.9+ has a symbol switcher; the trade app trades the MT5 gold symbol only) ---
rep('''<button id="symBtn" class="symbtn" aria-label="เลือกสัญลักษณ์"><b id="symName">XAUUSD</b><i>▾</i></button>''', '<b id="symName">XAUUSD</b>')
rep('    <div id="symMenu" hidden></div>\n', '')
rep_re(r"  try \{ const q = new URLSearchParams\(location\.search\)\.get\('sym'\)[^\n]*\n", "")
# no body-height hacks (they pushed the ticket off-screen on iPhone; trade.css lays the page out)
rep_re(r"  /\* เต็มจอจริงบน iPhone[^\n]*\n  body \{ position: fixed;[^\n]*\n", "")
rep_re(r"  // บางเครื่องความสูงจอไม่ตรงกับ CSS[^\n]*\n  const fitH = [^\n]*\n  fitH\(\);[^\n]*\n", "")

# --- chart shift: adj = perp − broker (chart), gAdj = perp − GC (for OI strikes) ---
rep("let adj = 0, basisEma = null,", "let adj = 0, gAdj = 0, brokerBasis = null, basisEma = null,")
rep_re(r"(    return \{ top5P, top5C, rows, offset: ok \? off : null,[^\n]*?) \};", r"\1, mpPrice: null };")
rep("    oi = calcOI(d);\n    afterOI(d);", "    oi = calcOI(d); rebaseOI();\n    afterOI(d);")
rep("    oi = calcOI({ levels, cfg: lastCfg });", "    oi = calcOI({ levels, cfg: lastCfg }); rebaseOI();")
rep("`offset <b>${(-adj).toFixed(2)}</b>`", "`GC−โบรก <b>${gcOff() >= 0 ? '+' : ''}${gcOff().toFixed(2)}</b>`")
# live Yahoo pairing compares against the GC offset (gAdj), not the broker shift (adj)
rep("Math.abs(-off - adj) >= 0.01", "Math.abs(-off - gAdj) >= 0.01")
rep_re(r"  function applyAdj\(next\) \{\n.*?\n  \}\n",
       '''  // gAdj = perp − GC (ใช้แปลง strike ของ OI), adj = perp − ราคาโบรก (ใช้เลื่อนกราฟ)
  function applyAdj(next) {
    gAdj = Math.round(next * 100) / 100; adjSet = true; adjAt = new Date();
    rebaseOI(); paintOff(); showPrice();
  }
  // ส่วนต่าง GC − ราคาโบรก: strike ของ OI บนกราฟ = strike − gcOff
  function gcOff() { return adj - gAdj; }
  function rebaseOI() {
    if (!oi) return;
    const g = gcOff();
    oi.rows.forEach(r => { r.price = oi.offset !== null ? Math.round((r.strike - g) * 100) / 100 : null; });
    oi.mpPrice = oi.maxPain === null ? null : oi.maxPain - g;
    dirty = true;
    if (typeof resetArming === 'function' && lastClose !== null) resetArming(lastClose);
  }
  // เลื่อนกราฟให้เท่าราคาโบรก (จาก EA) หรือราคา spot ถ้า EA ยังไม่ออนไลน์
  function setChartAdj(next) {
    next = Math.round(next * 100) / 100;
    if (next === adj) return;
    adj = next;
    if (rawBars.length) { try { series.setData(rawBars.map(toBar)); } catch (e) {} if (typeof indRefresh === 'function') indRefresh(); }
    if (rawClose !== null) lastClose = rawClose - adj;
    rebaseOI(); showPrice(); paintOff();
  }
''')
rep('''      basisEma = first ? basis : basisEma * 0.7 + basis * 0.3;
      if (first) refreshAdj(true);''', '''      basisEma = first ? basis : basisEma * 0.7 + basis * 0.3;
      if (brokerBasis === null) setChartAdj(basisEma);
      if (first) refreshAdj(true);''')
# max pain line in broker scale
rep("const ym = series.priceToCoordinate(oi.maxPain);", "const ym = series.priceToCoordinate(oi.mpPrice);")
rep("const lab = oi.maxPain.toFixed(2);", "const lab = oi.mpPrice.toFixed(2);")
# tip + alert toast
rep("strike <b>${r.strike}</b> → ${SC.note} ${r.price.toFixed(SC.dec)}", "strike <b>${r.strike}</b> → โบรก ${r.price.toFixed(2)}")
rep("strike <b>${r.strike}</b> (${SC.note} ${r.price.toFixed(SC.dec)})", "strike <b>${r.strike}</b> (${r.price.toFixed(2)})")
# second axis now shows GC price
rep("const sTop = top + adj, sBot = bot + adj,", "const sTop = top + gcOff(), sBot = bot + gcOff(),")
rep("const y = series.priceToCoordinate(v - adj);", "const y = series.priceToCoordinate(v - gcOff());")
rep("ctx.fillStyle = '#000'; ctx.fillText(rawClose.toFixed(2), x0 + 6, y + .5);",
    "ctx.fillStyle = '#000'; ctx.fillText((lastClose + gcOff()).toFixed(2), x0 + 6, y + .5);")
rep("ctx.fillText('SPOT', x0 + aw / 2, 9);", "ctx.fillText('GC', x0 + aw / 2, 9);")
# (MM vs Max Pain readout was removed in OI Gold Pro V1.14.01)
# header price = broker bid when EA online
rep("    $('price').textContent = lastClose.toFixed(SC.dec);",
    "    const bp = window.OIT_brokerPrice ? window.OIT_brokerPrice() : null;\n    $('price').textContent = (bp !== null && bp !== undefined ? bp : lastClose).toFixed(2);")

# (overlay hooks: OI Gold Pro V1.8+ already has overlayHooks and exports it as window.OI.hooks)

# --- data + login through the hub ---
rep_re(r"  const API_BASE = '[^']*';\n  const apiData = [^\n]*\n",
       "  // ข้อมูล OI และการเข้าสู่ระบบผ่าน hub ของแอปเทรด (hub อ่านข้อมูล OI ให้แบบอ่านอย่างเดียว)\n  const HUB = 'https://oi-trade-hub.oigoldpro.workers.dev';\n")
rep('''        const r = await fetch(apiData() + '&t=' + Date.now(), { cache: 'no-store', signal: ac.signal });
        if (!r.ok) throw new Error('HTTP ' + r.status);''', '''        const r = await fetch(HUB + '/app/oi?t=' + Date.now(), { cache: 'no-store', signal: ac.signal, headers: { 'X-Key': authCode } });
        if (r.status === 401) { const j = await r.json().catch(() => ({})); syncing = false; showLogin(j.reason === 'expired' ? 'รหัสผ่านนี้หมดอายุแล้ว' : 'รหัสผ่านใช้ไม่ได้แล้ว กรุณาเข้าสู่ระบบใหม่'); return; }
        if (!r.ok) throw new Error('HTTP ' + r.status);''')
rep_re(r"  async function checkLogin\(code\) \{\n.*?\n  \}\n(?=  async function tryLogin)", '''  async function checkLogin(code) {
    const ac = new AbortController(); const timer = setTimeout(() => ac.abort(), 15000);
    try {
      const r = await fetch(`${HUB}/app/login?t=${Date.now()}`, { cache: 'no-store', signal: ac.signal, headers: { 'X-Key': code } });
      return await r.json();
    } finally { clearTimeout(timer); }
  }
''')
rep("      showLogin(res.reason === 'expired' ?",
    "      if (res.error === 'not found') { showLogin('hub ยังเป็นรุ่นเก่า — รัน npx wrangler deploy ในโฟลเดอร์ hub ก่อน'); return; }\n      showLogin(res.reason === 'expired' ?")
# news from the OI Gold Pro repo (read-only)
rep_re(r"  const GH_OWNER =.*?\n(?=  // หมายเหตุ: raw\.githubusercontent)",
       "  const GH_OWNER = 'OI-GOLD-PRO', GH_REPO = 'gold-oi-pro';\n  const NEWS_URL = `https://raw.githubusercontent.com/${GH_OWNER}/${GH_REPO}/main/news.json`;\n")

# --- expose an API for trade.js (extends the window.OI that OI Gold Pro already exports) ---
rep("    markDirty() { dirty = true; },\n  };", '''    markDirty() { dirty = true; },
    HUB, get rawClose() { return rawClose; }, get authCode() { return authCode; },
    get drawTool() { return typeof drawTool === 'undefined' ? null : drawTool; },
    gcOff, showPrice,
    setBrokerBasis(b) { brokerBasis = b; setChartAdj(b); },
    clearBrokerBasis() { if (brokerBasis === null) return; brokerBasis = null; if (basisEma !== null) setChartAdj(basisEma); },
  };''')

# gamma-flip lines are GC-scale in the sheet/live data; the trade chart is in broker scale
rep("      const yg = series.priceToCoordinate(g.p);", "      const gp = g.p - gcOff(), yg = series.priceToCoordinate(gp);")
rep("ctx.fillText(g.p.toFixed(2), bx + (axW - 1) / 2, by + bh / 2 + .5);", "ctx.fillText(gp.toFixed(2), bx + (axW - 1) / 2, by + bh / 2 + .5);")
rep("ctx.fillText(`${g.lab} ${g.p.toFixed(1)}`,", "ctx.fillText(`${g.lab} ${gp.toFixed(1)}`,")

out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "index.html")
open(out, "w", encoding="utf-8").write(s)
print(f"ported OI Gold Pro V{src_ver} → trade app V{APP_VER}")

gs_src = os.path.join(os.path.dirname(os.path.abspath(sys.argv[1])), "goldscalp.js")
if os.path.exists(gs_src):
    g = open(gs_src, encoding="utf-8").read()
    if g.count("'oi_gs'") != 1:
        raise SystemExit("goldscalp.js: storage key anchor not found")
    open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "goldscalp.js"), "w", encoding="utf-8").write(g.replace("'oi_gs'", "'oit_gs'"))
    print("goldscalp.js copied from OI Gold Pro")

# live.js (live day-contract options from the OI Gold Pro worker): same maths in GC scale, drawing shifted to the broker scale
live_src = os.path.join(os.path.dirname(os.path.abspath(sys.argv[1])), "live.js")
if os.path.exists(live_src):
    l = open(live_src, encoding="utf-8").read()
    def lrep(old, new):
        global l
        if l.count(old) != 1:
            raise SystemExit(f"live.js anchor found {l.count(old)}x: {old[:80]!r}")
        l = l.replace(old, new)
    lrep("  const O = window.OI;\n", "  const O = window.OI;\n  const G = () => (O && O.gcOff ? O.gcOff() : 0); // GC − โบรก: ราคา GC → ราคาบนกราฟโบรก\n")
    lrep("const S0 = O.lastClose !== null && isFinite(O.lastClose) ? O.lastClose : d.F;", "const S0 = O.lastClose !== null && isFinite(O.lastClose) ? O.lastClose + G() : d.F;")
    lrep("series.priceToCoordinate(c.openF + c.openEM), bot = series.priceToCoordinate(c.openF - c.openEM);", "series.priceToCoordinate(c.openF + c.openEM - G()), bot = series.priceToCoordinate(c.openF - c.openEM - G());")
    lrep("`EM บน ${(c.openF + c.openEM).toFixed(1)}`", "`EM บน ${(c.openF + c.openEM - G()).toFixed(1)}`")
    lrep("`EM ล่าง ${(c.openF - c.openEM).toFixed(1)}`", "`EM ล่าง ${(c.openF - c.openEM - G()).toFixed(1)}`")
    lrep("      const px = O.lastClose;\n", "      const px = O.lastClose + G();\n")
    lrep("const y = series.priceToCoordinate(s.k);", "const y = series.priceToCoordinate(s.k - G());")
    lrep("badges.push(O.lastClose >= gm.p ?", "badges.push(O.lastClose + G() >= gm.p ?")
    open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "live.js"), "w", encoding="utf-8").write(l)
    print("live.js copied from OI Gold Pro (scale-adjusted)")

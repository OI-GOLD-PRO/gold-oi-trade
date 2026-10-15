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
rep('''  </div>

<script>
(function () {''', '''  </div>
  <div id="acct"></div>
  <div id="ticket"></div>
  <div id="sheet" hidden></div>

<script>
(function () {''')
rep('''})();
</script>
</body>''', '''})();
</script>
<script src="trade.js"></script>
</body>''')

# --- chart shift: adj = perp − broker (chart), gAdj = perp − GC (for OI strikes) ---
rep("let adj = 0, basisEma = null,", "let adj = 0, gAdj = 0, brokerBasis = null, basisEma = null,")
rep_re(r"(    oi = \{ top5P, top5C, rows, offset: ok \? off : null,[^\n]*?maxPain) \};",
       r"\1, mpPrice: null };\n    rebaseOI();")
rep("    el.innerHTML = `offset <b>${(-adj).toFixed(2)}</b>`;",
    "    const g = gcOff();\n    el.innerHTML = `GC−โบรก <b>${g >= 0 ? '+' : ''}${g.toFixed(2)}</b>`;")
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
rep("strike <b>${r.strike}</b> → GC ${r.price.toFixed(2)}", "strike <b>${r.strike}</b> → โบรก ${r.price.toFixed(2)}")
rep("strike <b>${r.strike}</b> (GC ${r.price.toFixed(2)})", "strike <b>${r.strike}</b> (${r.price.toFixed(2)})")
# second axis now shows GC price
rep("const sTop = top + adj, sBot = bot + adj,", "const sTop = top + gcOff(), sBot = bot + gcOff(),")
rep("const y = series.priceToCoordinate(v - adj);", "const y = series.priceToCoordinate(v - gcOff());")
rep("ctx.fillStyle = '#000'; ctx.fillText(rawClose.toFixed(2), x0 + 6, y + .5);",
    "ctx.fillStyle = '#000'; ctx.fillText((lastClose + gcOff()).toFixed(2), x0 + 6, y + .5);")
rep("ctx.fillText('SPOT', x0 + aw / 2, 9);", "ctx.fillText('GC', x0 + aw / 2, 9);")
# MM vs Max Pain uses GC-scale price
rep("const S = lastClose, M = oi.maxPain;", "const S = lastClose + gcOff(), M = oi.maxPain;")
# header price = broker bid when EA online
rep("    $('price').textContent = lastClose.toFixed(2);",
    "    const bp = window.OIT_brokerPrice ? window.OIT_brokerPrice() : null;\n    $('price').textContent = (bp !== null && bp !== undefined ? bp : lastClose).toFixed(2);")

# --- overlay hooks for trade.js ---
rep("    drawMeasure(w, h);\n  }", "    drawMeasure(w, h);\n    overlayHooks.forEach(f => { try { f(ctx, w, h); } catch (e) { console.error(e); } });\n  }")
rep("  let dirty = true, lastKey = '';", "  let dirty = true, lastKey = '';\n  const overlayHooks = [];")

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
       "  const NEWS_URL = 'https://raw.githubusercontent.com/OI-GOLD-PRO/gold-oi-pro/main/news.json';\n")

# --- expose an API for trade.js ---
rep_re(r"(  if \(saved\) \{ \$\('login'\)\.hidden = true;[^\n]*\n)\}\)\(\);", r'''\1
  window.OI = {
    HUB, chart, series, chartEl, hooks: overlayHooks,
    get oi() { return oi; }, get lastClose() { return lastClose; }, get rawClose() { return rawClose; },
    get authCode() { return authCode; },
    get drawTool() { return typeof drawTool === 'undefined' ? null : drawTool; },
    gcOff, showToast, hideToast, lockChart, showPrice,
    markDirty() { dirty = true; },
    setBrokerBasis(b) { brokerBasis = b; setChartAdj(b); },
    clearBrokerBasis() { if (brokerBasis === null) return; brokerBasis = null; if (basisEma !== null) setChartAdj(basisEma); },
  };
})();''')

out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "index.html")
open(out, "w", encoding="utf-8").write(s)
print(f"ported OI Gold Pro V{src_ver} → trade app V{APP_VER}")

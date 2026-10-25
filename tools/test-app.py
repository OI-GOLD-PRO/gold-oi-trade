"""Browser test for the trade app with a mocked hub / EA / price feeds.
Run: python3 tools/test-app.py <path-to-lightweight-charts.js> <out-dir>
Serves the repo locally, intercepts every network call, plays through login → ticket → drag TP → send → sheet.
"""
import json, math, sys, os, threading, http.server, functools, time
from playwright.sync_api import sync_playwright

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
LWC, OUT = sys.argv[1], sys.argv[2]
os.makedirs(OUT, exist_ok=True)

srv = http.server.ThreadingHTTPServer(("127.0.0.1", 8765), functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT))
threading.Thread(target=srv.serve_forever, daemon=True).start()

now_ms = int(time.time() * 1000)
def bars(n, step_ms):
    out, p = [], 4150.0
    for i in range(n):
        t = now_ms - (n - i) * step_ms
        o = p; p = 4150 + 8 * math.sin(i / 25) + 3 * math.sin(i / 4.3)
        out.append([str(t - t % step_ms), f"{o:.2f}", f"{max(o,p)+1.2:.2f}", f"{min(o,p)-1.1:.2f}", f"{p:.2f}"])
    return out
BARS = bars(800, 300_000)
PERP_LAST = float(BARS[-1][4])
BID = round(PERP_LAST - 6.75, 2)

state = {
    "ea": "v0.1.00",
    "account": {"login": 123456, "server": "Demo", "currency": "USC", "balance": 13363.35, "equity": 12519.26, "margin_level": 12170, "profit": -844.09},
    "symbol": {"name": "GOLD", "bid": BID, "ask": round(BID + 0.5, 2), "digits": 2, "point": 0.01, "contract": 100, "tick_value": 1, "tick_size": 0.01, "vol_min": 0.01, "vol_max": 0.1, "vol_step": 0.01, "stops_level": 0},
    "positions": [{"ticket": 501, "side": "SELL", "lots": 0.05, "open": round(BID + 4.8, 2), "sl": 0, "tp": round(BID - 10, 2), "profit": -24.1}],
    "orders": [{"ticket": 777, "type": "BUY LIMIT", "lots": 0.02, "price": round(BID - 9, 2), "sl": round(BID - 14, 2), "tp": 0}],
    "pl": {"today": -0.93, "week": 120.5, "month": 380.0, "trades_today": 2, "trades_month": 20, "wins_month": 13},
}
levels = []
for k in range(4100, 4276, 25):
    levels.append({"strike": k, "type": "C", "oi": 300 + (k - 4100) * 4, "chg": 12})
    levels.append({"strike": k, "type": "P", "oi": 900 - (k - 4100) * 4, "chg": -5})
OI = {"levels": levels, "cfg": {"offset": 28, "carry": 34, "contract": "OGZ6", "volume": "{}"}}
cmds, results = [], []

def route(rt):
    u = rt.request.url
    if "lightweight-charts" in u: return rt.fulfill(path=LWC, content_type="application/javascript")
    if "fonts.googleapis" in u or "fonts.gstatic" in u: return rt.fulfill(body="", content_type="text/css")
    if "/app/login" in u: return rt.fulfill(json={"ok": True, "name": "Owner", "expire": "9999-12-31"})
    if "/app/oi" in u: return rt.fulfill(json=OI)
    if "/app/history" in u: return rt.fulfill(path=os.environ.get("HIST_JSON", ""), content_type="application/json") if os.environ.get("HIST_JSON") else rt.fulfill(json={"ok": False, "error": "no history"})
    if "/app/state" in u: return rt.fulfill(json={"ok": True, "online": True, "age_ms": 400, "state": state, "results": results})
    if "/app/cmd" in u:
        b = json.loads(rt.request.post_data); cmds.append(b)
        cid = f"c{len(cmds)}"; results.insert(0, {"id": cid, "ok": True, "status": "done", "ticket": 9000 + len(cmds), "at": now_ms})
        return rt.fulfill(json={"ok": True, "id": cid})
    if "gc-yahoo" in u and "/opt" in u:
        rows = []
        for l in levels:
            rows.append([l["strike"], l["type"], 0.2, 0.5 if l["type"] == "C" else -0.5, 0.002, 1, 1.2, 1.1, 60, 40, 20, l["oi"]])
        return rt.fulfill(json={"rows": rows, "root": "OGZ6", "expTs": now_ms / 1000 + 18000, "F": PERP_LAST + 34, "openF": PERP_LAST + 30, "openEM": 18, "em": 22, "updated": now_ms / 1000, "oiT": now_ms / 1000})
    if "api.bybit.com" in u:
        n = 2 if "interval=D" in u else 800
        return rt.fulfill(json={"retCode": 0, "result": {"list": list(reversed(BARS[-n:]))}})
    if "gold-api.com" in u: return rt.fulfill(json={"price": round(PERP_LAST - 6.4, 2)})
    if "news.json" in u: return rt.fulfill(json={"events": []})
    if u.startswith("http://127.0.0.1:8765"): return rt.continue_()
    return rt.abort()

errors = []
with sync_playwright() as p:
    br = p.chromium.launch(executable_path="/opt/pw-browsers/chromium-1194/chrome-linux/chrome", args=["--no-sandbox"])
    ctx = br.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, has_touch=True, is_mobile=True)
    ctx.route("**/*", route)
    ctx.route_web_socket("**/*", lambda ws: None)  # no live feed in test
    page = ctx.new_page()
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.on("console", lambda m: m.type == "error" and errors.append(m.text))
    page.on("dialog", lambda d: d.accept())
    page.add_init_script("""(() => { const C = window.AudioContext; window.__tones = 0;
      window.AudioContext = function () { const c = new C(); const o = c.createOscillator.bind(c); c.createOscillator = () => { window.__tones++; return o(); }; return c; }; })();""")
    page.goto("http://127.0.0.1:8765/index.html")
    page.screenshot(path=f"{OUT}/0-login.png")
    page.fill("#code", "test-code"); page.click("#loginBtn")
    page.wait_for_function("document.querySelector('#tkAsk').textContent !== '–' && !document.querySelector('[data-mkt=BUY]').disabled", timeout=15000)
    page.wait_for_timeout(2500)
    page.click("#toast") if page.is_visible("#toast") else None
    page.screenshot(path=f"{OUT}/1-main.png")

    info = page.evaluate("""() => ({ adjOK: Math.abs(OI.lastClose - %f) < 0.6, price: document.getElementById('price').textContent,
        gcoff: OI.gcOff(), wall: OI.oi.rows.find(r => r.strike === 4175).price })""" % BID)
    print("chart/broker:", info)
    print("dbg offsets:", page.evaluate("() => ({ gc: OI.gcOff(), off: OI.oi.offset, last: OI.lastClose, raw: OI.rawClose })"))

    page.click("#tkSL"); page.click("#tkTP")
    page.wait_for_timeout(400)
    page.click("#tkSL"); page.wait_for_timeout(150)
    print("SL tap again turns it off:", page.evaluate("() => !document.getElementById('tkSL').classList.contains('on')"))
    page.click("#tkSL"); page.wait_for_timeout(150)
    page.screenshot(path=f"{OUT}/2-sltp.png")

    # drag the TP line up by touch (CDP)
    tp = float(page.inner_text("#tkTP b").replace(",", ""))
    vis = page.evaluate(f"() => {{ const y = OI.series.priceToCoordinate({tp}); return y > 0 && y < OI.chartEl.clientHeight - OI.chart.timeScale().height(); }}")
    print("TP line on screen after autoscale:", vis)
    box = page.evaluate("() => { const r = OI.chartEl.getBoundingClientRect(); return {x: r.left, y: r.top}; }")
    y0 = page.evaluate(f"() => OI.series.priceToCoordinate({tp})") + box["y"]
    x0 = box["x"] + 200
    cdp = ctx.new_cdp_session(page)
    cdp.send("Input.dispatchTouchEvent", {"type": "touchStart", "touchPoints": [{"x": x0, "y": y0}]})
    for i in range(1, 11):
        cdp.send("Input.dispatchTouchEvent", {"type": "touchMove", "touchPoints": [{"x": x0, "y": y0 - i * 9}]})
    cdp.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []})
    page.wait_for_timeout(300)
    tp2 = float(page.inner_text("#tkTP b").replace(",", ""))
    print(f"TP drag: {tp} -> {tp2}")
    page.screenshot(path=f"{OUT}/3-dragged.png")

    page.click("[data-mkt=BUY]")
    page.wait_for_timeout(1800)
    print("sent BUY market:", cmds[-1] if cmds else None)
    print("sound played on fill:", page.evaluate("() => window.__tones") >= 2)
    page.click("[data-mkt=SELL]")
    page.wait_for_timeout(1200)
    print("sent SELL market (lines mirrored):", cmds[-1])
    page.screenshot(path=f"{OUT}/4-sent.png")

    # pending order with entry line
    page.click("[data-pend=BUY]")
    page.wait_for_timeout(300)
    page.click("#toast") if page.is_visible("#toast") else None
    page.screenshot(path=f"{OUT}/5-pending.png")
    page.click("[data-pend=BUY]"); page.wait_for_timeout(800)
    print("pending:", cmds[-1])
    page.click("#tkPendX"); page.wait_for_timeout(200)
    print("indicator/draw buttons present:", page.evaluate("() => !!document.getElementById('indBtn') && !!document.getElementById('drawBtn')"))

    # Gold Scalping indicator: normal vs OI mode
    page.click("#indBtn"); page.wait_for_timeout(300)
    page.click("[data-gst=on]"); page.wait_for_timeout(1800)
    gs = page.evaluate("() => { const g = window.OI_goldScalp; return { on: g.cfg.on, sig: g.result && g.result.nSig }; }")
    page.screenshot(path=f"{OUT}/12-gs-menu.png")
    page.evaluate("() => document.getElementById('indMenu').hidden = true"); page.wait_for_timeout(500)
    page.screenshot(path=f"{OUT}/12-gs-normal.png")
    page.click("#indBtn"); page.wait_for_timeout(200)
    page.click("[data-gsm=oi]"); page.wait_for_timeout(1500)
    gs2 = page.evaluate("() => { const g = window.OI_goldScalp; return { sig: g.result && g.result.nSig, zones: g.result && g.result.nZones }; }")
    page.evaluate("() => document.getElementById('indMenu').hidden = true"); page.wait_for_timeout(500)
    page.screenshot(path=f"{OUT}/13-gs-oi.png")
    page.click("#indBtn"); page.wait_for_timeout(200)
    page.wait_for_timeout(3500)
    print("live.js:", page.evaluate("() => { const L = window.OILive; return { rows: !!(L && L.d), err: L && L.err, gmf: L && L.calc && L.calc.gmf, match: L && L.calc && L.calc.match, gmfLines: (window.OI.oi.gmf || []).map(g => g.lab) }; }"))
    page.click("[data-ivt=on]"); page.wait_for_timeout(2500)
    iv = page.evaluate("() => { const r = window.OI_intraday.result; return r ? { cw: r.L.cw, pw: r.L.pw, flip: r.L.flip, em: r.L.em } : null; }")
    print("intraday levels (broker scale):", iv)
    page.screenshot(path=f"{OUT}/14-intraday-menu.png")
    print("goldscalp normal:", gs, " oi:", gs2, " menu inputs:", page.evaluate("() => document.querySelectorAll('#gsBox [data-gs]').length"))
    page.click("#indBtn") if page.is_visible("#indMenu") else None
    page.wait_for_timeout(200)
    page.click("#maxBtn"); page.wait_for_timeout(400)
    page.screenshot(path=f"{OUT}/11-max.png")
    print("max: acct hidden", page.evaluate("() => getComputedStyle(document.getElementById('acct')).display === 'none'"), "market row visible", page.is_visible("#tkMkt"))
    page.click("#maxBtn"); page.wait_for_timeout(200)
    page.click("#posBtn"); page.wait_for_timeout(300)
    page.screenshot(path=f"{OUT}/6-sheet.png")
    page.click("[data-mod='501']"); page.wait_for_timeout(300)
    page.click("#tkSL"); page.wait_for_timeout(200)
    page.screenshot(path=f"{OUT}/7-modify.png")
    page.click("#tkGo"); page.wait_for_timeout(800)
    print("modify:", cmds[-1])
    page.click("#dashBtn"); page.wait_for_timeout(1500)
    page.screenshot(path=f"{OUT}/8-dash.png")
    page.evaluate("() => document.getElementById('dhBody').scrollTop = 620"); page.wait_for_timeout(300)
    page.screenshot(path=f"{OUT}/9-dash2.png")
    page.evaluate("() => document.getElementById('dhBody').scrollTop = 1400"); page.wait_for_timeout(300)
    page.screenshot(path=f"{OUT}/10-dash3.png")
    br.close()
srv.shutdown()
print("errors:", errors or "none")

// 🌏 OI Session Fade — auto-trader runner (hub side). Pure-ish: all I/O is injected so tools/test-auto.mjs can drive it offline.
// Called from Hub.eaSync() on every EA sync; does real work at most every STEP_MS.
import { wanted, lotsFor, oiRows, levels, newsTimes, gcOffset, dayStart, sessOf, toT } from "./osf.js";

export const AUTO_DEFAULT = {
  mode: "off",       // off | dry (log only, no orders) | live
  rr: 1.6,           // TP = entry ± rr × R   (1 / 1.6 / 5)
  lotMode: "risk",   // risk (% of balance on the stop) | fixed
  lots: 0.01,
  riskPct: 1,
  maxOpen: 2,        // open positions + resting orders from this system
  dailyLossPct: 5,   // stop for the day when today's P/L ≤ −x % of balance
};
export const STEP_MS = 10_000;
const OI_TTL = 300_000, NEWS_TTL = 600_000, GF_TTL = 60_000, RETRY_MS = 60_000, ORDER_GRACE_MS = 25_000, LOG_MAX = 60;
const near = (a, b) => Math.abs(a - b) < 0.011;

export function cleanCfg(inp, cur) {
  const c = { ...AUTO_DEFAULT, ...(cur || {}) };
  if (!inp || typeof inp !== "object") return c;
  const num = (v, lo, hi) => { const n = Number(v); return Number.isFinite(n) && n >= lo && n <= hi ? n : null; };
  if (["off", "dry", "live"].includes(inp.mode)) c.mode = inp.mode;
  if ([1, 1.6, 5].includes(Number(inp.rr))) c.rr = Number(inp.rr);
  if (["risk", "fixed"].includes(inp.lotMode)) c.lotMode = inp.lotMode;
  let n;
  if ((n = num(inp.lots, 0.01, 10)) !== null) c.lots = n;
  if ((n = num(inp.riskPct, 0.1, 10)) !== null) c.riskPct = n;
  if ((n = num(inp.maxOpen, 1, 6)) !== null) c.maxOpen = Math.floor(n);
  if ((n = num(inp.dailyLossPct, 0.5, 50)) !== null) c.dailyLossPct = n;
  return c;
}

export function newAuto() { return { cfg: { ...AUTO_DEFAULT }, reg: {}, log: [], dayLv: null, off: null, offAt: 0, status: "", at: 0 }; }

function log(a, now, msg, kind) { a.log.unshift({ at: now, kind: kind || "info", msg }); if (a.log.length > LOG_MAX) a.log.length = LOG_MAX; }

// io = { oi(): Promise<json|null>, news(): Promise<json|null>, gf(): Promise<bars[]|null>, cmd(c): void }
// cache = in-memory fetch cache { oi:{at,d,fail}, news:…, gf:… }
async function cached(cache, key, ttl, now, fn) {
  const c = cache[key] || (cache[key] = { at: 0, d: null, fail: 0 });
  if (c.d && now - c.at < ttl) return c.d;
  if (now - c.fail < RETRY_MS) return c.d;
  try { const d = await fn(); if (d) { c.d = d; c.at = now; return d; } } catch {}
  c.fail = now;
  return c.d;
}

// returns true when a.* changed (caller persists)
export async function autoStep(a, S, io, now) {
  if (now - a.at < STEP_MS) return false;
  a.at = now;
  const cfg = a.cfg, st = S.state;
  const setStatus = (s) => { if (a.status !== s) { a.status = s; return true; } return false; };
  if (!st || !st.symbol || !st.account) return setStatus("รอ EA");
  const orders = st.orders || [], positions = st.positions || [];
  let dirty = false;

  // ---- OFF: take down anything this system still has resting
  if (cfg.mode === "off") {
    for (const [key, r] of Object.entries(a.reg)) {
      if (r.status === "sent" || r.status === "live") {
        const o = orders.find((x) => r.ticket ? x.ticket === r.ticket : near(x.price, r.price));
        if (o) io.cmd({ type: "CANCEL", ticket: o.ticket });
        log(a, now, `ปิดระบบ → ยกเลิกออเดอร์ ${key}`); dirty = true;
      }
      delete a.reg[key];
    }
    return setStatus("ปิด") || dirty;
  }

  const nowUtc = now / 1000, nowT = toT(nowUtc), day = dayStart(nowT), off = Number(st.gmt_offset) || 0;
  // prune old days
  for (const k of Object.keys(a.reg)) if (!k.startsWith(day + "|")) { delete a.reg[k]; dirty = true; }
  const sess = sessOf(nowT);

  // ---- data
  const [oi, news, gf] = await Promise.all([
    cached(S.cache, "oi", OI_TTL, now, io.oi), cached(S.cache, "news", NEWS_TTL, now, io.news), cached(S.cache, "gf", GF_TTL, now, io.gf),
  ]);
  const brokerBars = (S.bars || []).map((b) => ({ ...b, utc: b.t - off }));
  const bars = brokerBars.map((b) => ({ time: toT(b.utc), open: b.open, high: b.high, low: b.low, close: b.close }));
  if (gf && brokerBars.length) {
    const o = gcOffset(gf, brokerBars, nowUtc);
    if (o !== null) { a.off = o; a.offAt = now; }
  }
  if (a.off === null || now - a.offAt > 30 * 60_000) return setStatus("ยังไม่มีส่วนต่าง GC−โบรก (Gold.F)") || dirty;
  if (!oi) return setStatus("ยังไม่มีข้อมูล OI") || dirty;
  // today's zones: fixed once per day from the price at 06:00 (GC scale)
  if (!a.dayLv || a.dayLv.day !== day) {
    const utc0 = day - 7 * 3600;
    const b0 = (gf || []).find((x) => x[0] >= utc0 && x[0] <= utc0 + 900);
    if (!b0) return setStatus("ยังไม่มีราคา 06:00 ของวันนี้") || dirty;
    const L = levels(Number(b0[1]), oiRows(oi, 0));
    a.dayLv = { day, ref: Number(b0[1]), L };
    log(a, now, `โซนวันนี้ ${L.length} เส้น (ราคาอ้างอิง ${b0[1]}) : ` + L.map((z) => `${z.k}${z.side}${z.grade}`).join(" "));
    dirty = true;
  }
  const Lb = a.dayLv.L.map((z) => ({ ...z, p: z.p - a.off }));

  // ---- reconcile existing registry with the account
  const ours = Object.entries(a.reg);
  for (const [key, r] of ours) {
    if (r.status !== "sent" && r.status !== "live" && r.status !== "cancelling") continue;
    const o = orders.find((x) => x.ticket === r.ticket) || orders.find((x) => !r.ticket && x.type === r.type && near(x.price, r.price));
    if (o) { if (!r.ticket || r.status === "sent") { r.ticket = o.ticket; if (r.status === "sent") r.status = "live"; dirty = true; } continue; }
    // order is gone: filled (position with our SL), cancelled, or never placed
    const p = positions.find((x) => x.side === r.side && near(x.sl, r.sl));
    if (p) { r.status = "filled"; r.ticket = p.ticket; log(a, now, `เข้าไม้ ${key} @ ${p.open}`, "fill"); dirty = true; }
    else if (r.status === "cancelling") { delete a.reg[key]; dirty = true; }
    else if (now - r.at > ORDER_GRACE_MS) { log(a, now, `ออเดอร์ ${key} หายไป (ไม่พบในบัญชี)`, "warn"); delete a.reg[key]; dirty = true; }
  }

  // ---- what should rest now?
  const sym = st.symbol, bal = Number(st.account.balance) || 0, todayPL = st.pl && Number(st.pl.today);
  const minDist = Math.max((Number(sym.stops_level) || 0) * (Number(sym.point) || 0) + (Number(sym.spread) || 0) * (Number(sym.point) || 0), 0.3);
  const w = wanted(bars, Lb, news ? newsTimes(news) : [], nowT, cfg, { bid: Number(sym.bid), ask: Number(sym.ask) }, minDist);
  const want = new Map(w.orders.map((o) => [day + "|" + o.key.split("|").slice(1).join("|"), o]));
  const lossStop = cfg.dailyLossPct > 0 && bal > 0 && Number.isFinite(todayPL) && todayPL <= -(bal * cfg.dailyLossPct) / 100;

  // cancel orders that are no longer wanted (condition changed, TP setting changed, loss stop)
  for (const [key, r] of Object.entries(a.reg)) {
    if (r.status !== "live" && r.status !== "sent") continue;
    const d = want.get(key);
    const stale = !d || lossStop || !near(d.tp, r.tp) || !near(d.entry, r.price) || !near(d.sl, r.sl);
    if (!stale) continue;
    if (r.status === "sent" && !r.ticket) continue; // not confirmed yet — next round
    const why = lossStop ? "ถึงเพดานขาดทุนวันนี้" : !d ? (w.skipped.find((s) => s.key && day + "|" + s.key.split("|").slice(1).join("|") === key) || {}).why || "เงื่อนไขไม่ตรงแล้ว" : "ปรับค่า/ราคาเปลี่ยน";
    if (cfg.mode === "live") io.cmd({ type: "CANCEL", ticket: r.ticket });
    r.status = cfg.mode === "live" ? "cancelling" : "dry-cancel";
    log(a, now, `ยกเลิก ${key} — ${why}`); dirty = true;
    if (cfg.mode !== "live") delete a.reg[key];
  }

  // place new ones
  const openN = positions.length, restN = Object.values(a.reg).filter((r) => r.status === "sent" || r.status === "live").length;
  let room = cfg.maxOpen - openN - restN;
  for (const [key, o] of want) {
    if (a.reg[key]) continue;
    if (lossStop) { dirty = setStatus("หยุดวันนี้ (ถึงเพดานขาดทุน)") || dirty; break; }
    if (sess === null || room <= 0) continue;
    const L = lotsFor(cfg, bal, o.R, sym);
    if (!(L.lots > 0)) { log(a, now, `ข้าม ${key}: ${L.why}`, "warn"); a.reg[key] = { status: "skipped", at: now, price: o.entry, sl: o.sl, tp: o.tp, side: o.side }; dirty = true; continue; }
    const type = o.side + " LIMIT";
    a.reg[key] = { status: cfg.mode === "live" ? "sent" : "dry", at: now, side: o.side, type, price: o.entry, sl: o.sl, tp: o.tp, lots: L.lots, risk: L.risk, ticket: 0, sess: o.sess, k: o.k, grade: o.grade };
    if (cfg.mode === "live") io.cmd({ type: "OPEN", side: o.side, kind: "LIMIT", lots: L.lots, price: o.entry, sl: o.sl, tp: o.tp });
    log(a, now, `${cfg.mode === "live" ? "วาง" : "[ซ้อม] จะวาง"} ${o.side} LIMIT ${L.lots} lot @ ${o.entry} SL ${o.sl} TP ${o.tp} (RR ${o.rr}, โซน ${o.zone}${o.grade}, แตะครั้งที่ ${o.k}, เสี่ยง ≈ ${Math.round(L.risk * 100) / 100})`, "place");
    room--; dirty = true;
  }
  const rest = Object.values(a.reg).filter((r) => r.status === "sent" || r.status === "live" || r.status === "dry").length;
  const why = !sess || sess.real <= 0 ? "นอกช่วงเข้าไม้จริง" : w.skipped.length && !w.orders.length ? w.skipped[0].why : "";
  dirty = setStatus(`${cfg.mode === "live" ? "ทำงาน" : "ซ้อม"} · รอ ${rest} ออเดอร์ · ส่วนต่าง GC−โบรก ${a.off >= 0 ? "+" : ""}${a.off}${why ? " · " + why : ""}`) || dirty;
  return dirty;
}

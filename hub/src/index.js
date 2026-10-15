// OI Gold Pro Trade — Hub (Cloudflare Worker + Durable Object)
// Relays state from the MT5 bridge EA to the app, and commands from the app to the EA.
//
// Routes
//   GET  /                 test console (phase 1)
//   POST /ea/sync          EA pushes state + results, receives commands   (header X-Key: EA_KEY)
//   GET  /app/state        app reads latest state + recent results       (header X-Key: APP_KEY)
//   POST /app/cmd          app queues a command                          (header X-Key: APP_KEY)
//   GET  /health           public, no data

import { TEST_PAGE } from "./page.js";

export const VERSION = "v0.1.00";

const ONLINE_MS = 10_000;      // EA considered offline if no sync for this long
const CMD_TTL_MS = 10_000;     // undelivered commands expire after this
const FAST_MS = 1_000;         // EA sync interval while app is active
const IDLE_MS = 5_000;         // EA sync interval while nobody is watching
const APP_ACTIVE_MS = 30_000;  // app counts as active this long after its last request
const MAX_RESULTS = 50;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type,X-Key",
  "Access-Control-Max-Age": "86400",
};

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json", ...CORS } });

// constant-time-ish compare
function sameKey(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || !b) return false;
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

    if (url.pathname === "/" && req.method === "GET")
      return new Response(TEST_PAGE, { headers: { "Content-Type": "text/html; charset=utf-8" } });
    if (url.pathname === "/health") return json({ ok: true, version: VERSION });

    const key = req.headers.get("X-Key") || "";
    if (url.pathname.startsWith("/ea/")) {
      if (!sameKey(key, env.EA_KEY)) return new Response("ERR|auth", { status: 401 });
    } else if (url.pathname.startsWith("/app/")) {
      if (!sameKey(key, env.APP_KEY)) return json({ ok: false, error: "auth" }, 401);
    } else {
      return json({ ok: false, error: "not found" }, 404);
    }

    const stub = env.HUB.get(env.HUB.idFromName("main"));
    const res = await stub.fetch(req);
    // re-wrap to add CORS on app routes
    if (url.pathname.startsWith("/app/")) {
      const body = await res.text();
      return new Response(body, { status: res.status, headers: { "Content-Type": "application/json", ...CORS } });
    }
    return res;
  },
};

// ---------------------------------------------------------------------------

const TYPES = new Set(["OPEN", "MODIFY", "CLOSE", "CANCEL", "CLOSEALL"]);
const SIDES = new Set(["BUY", "SELL"]);
const KINDS = new Set(["MARKET", "LIMIT", "STOP"]);

function num(v, def = 0) {
  if (v === undefined || v === null || v === "") return def;
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
}

// Returns [cmd, error]
export function validateCmd(b) {
  if (!b || typeof b !== "object") return [null, "bad body"];
  const type = String(b.type || "").toUpperCase();
  if (!TYPES.has(type)) return [null, "unknown type"];
  const c = {
    type,
    side: String(b.side || "").toUpperCase(),
    kind: String(b.kind || "MARKET").toUpperCase(),
    lots: num(b.lots),
    price: num(b.price),
    sl: num(b.sl),
    tp: num(b.tp),
    ticket: num(b.ticket),
  };
  for (const k of ["lots", "price", "sl", "tp", "ticket"])
    if (Number.isNaN(c[k]) || c[k] < 0) return [null, `bad ${k}`];

  if (type === "OPEN") {
    if (!SIDES.has(c.side)) return [null, "side must be BUY or SELL"];
    if (!KINDS.has(c.kind)) return [null, "kind must be MARKET, LIMIT or STOP"];
    if (!(c.lots > 0)) return [null, "lots must be > 0"];
    if (c.kind !== "MARKET" && !(c.price > 0)) return [null, "pending order needs price"];
    if (c.kind === "MARKET") c.price = 0;
    // TP/SL must be on the right side of the entry when entry is known
    const ref = c.price;
    if (ref > 0) {
      if (c.side === "BUY" && ((c.sl && c.sl >= ref) || (c.tp && c.tp <= ref))) return [null, "BUY needs SL below and TP above entry"];
      if (c.side === "SELL" && ((c.sl && c.sl <= ref) || (c.tp && c.tp >= ref))) return [null, "SELL needs SL above and TP below entry"];
    }
  } else if (type === "MODIFY" || type === "CLOSE" || type === "CANCEL") {
    if (!(c.ticket > 0)) return [null, "ticket required"];
    c.ticket = Math.trunc(c.ticket);
  }
  return [c, null];
}

export function cmdLine(c, now) {
  const f = (x) => (x ? String(x) : "0");
  return ["CMD", c.id, c.type, c.side || "-", c.kind || "-", f(c.lots), f(c.price), f(c.sl), f(c.tp), f(c.ticket), String(now - c.at)].join("|");
}

export class Hub {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.state = null;
    this.stateAt = 0;
    this.lastAppAt = 0;
    this.queue = [];
    this.results = [];
    this.seq = 0;
    ctx.blockConcurrencyWhile(async () => {
      this.queue = (await ctx.storage.get("queue")) || [];
      this.results = (await ctx.storage.get("results")) || [];
      this.seq = (await ctx.storage.get("seq")) || 0;
    });
  }

  async fetch(req) {
    const url = new URL(req.url);
    const now = Date.now();
    try {
      if (url.pathname === "/ea/sync" && req.method === "POST") return await this.eaSync(req, now);
      if (url.pathname === "/app/state" && req.method === "GET") return this.appState(now);
      if (url.pathname === "/app/cmd" && req.method === "POST") return await this.appCmd(req, now);
    } catch (e) {
      return json({ ok: false, error: String(e && e.message || e) }, 500);
    }
    return json({ ok: false, error: "not found" }, 404);
  }

  expire(now) {
    const keep = [];
    let changed = false;
    for (const c of this.queue) {
      if (now - c.at > CMD_TTL_MS) {
        this.pushResult({ id: c.id, ok: false, status: "expired", msg: "EA did not pick it up in time", at: now, type: c.type });
        changed = true;
      } else keep.push(c);
    }
    this.queue = keep;
    return changed;
  }

  pushResult(r) {
    const i = this.results.findIndex((x) => x.id === r.id);
    if (i >= 0) this.results[i] = { ...this.results[i], ...r };
    else this.results.unshift(r);
    if (this.results.length > MAX_RESULTS) this.results.length = MAX_RESULTS;
  }

  async eaSync(req, now) {
    let body;
    try { body = await req.json(); } catch { return new Response("ERR|bad json", { status: 400 }); }
    if (body.state && typeof body.state === "object") {
      this.state = body.state;
      this.stateAt = now;
    }
    let dirty = this.expire(now);

    if (Array.isArray(body.results)) {
      for (const r of body.results) {
        if (!r || !r.id) continue;
        this.pushResult({ id: String(r.id), ok: !!r.ok, status: r.ok ? "done" : "failed", retcode: r.retcode, msg: String(r.msg || ""), ticket: r.ticket || 0, at: now });
        dirty = true;
      }
    }

    const out = ["OK"];
    const appActive = now - this.lastAppAt < APP_ACTIVE_MS;
    out.push("NEXT|" + (appActive || this.queue.length ? FAST_MS : IDLE_MS));
    for (const c of this.queue) {
      out.push(cmdLine(c, now));
      this.pushResult({ id: c.id, ok: null, status: "sent", at: now, type: c.type });
    }
    if (this.queue.length) { this.queue = []; dirty = true; }
    if (dirty) await this.persist();
    return new Response(out.join("\n") + "\n", { headers: { "Content-Type": "text/plain" } });
  }

  appState(now) {
    this.lastAppAt = now;
    if (this.expire(now)) this.persist();
    const age = this.stateAt ? now - this.stateAt : null;
    return json({
      ok: true,
      version: VERSION,
      online: age !== null && age < ONLINE_MS,
      age_ms: age,
      state: this.state,
      pending: this.queue.map((c) => c.id),
      results: this.results.slice(0, 20),
    });
  }

  async appCmd(req, now) {
    this.lastAppAt = now;
    let b;
    try { b = await req.json(); } catch { return json({ ok: false, error: "bad json" }, 400); }
    if (!this.stateAt || now - this.stateAt >= ONLINE_MS) return json({ ok: false, error: "EA offline" }, 409);
    const [c, err] = validateCmd(b);
    if (err) return json({ ok: false, error: err }, 400);
    this.seq += 1;
    c.id = now.toString(36) + "-" + this.seq.toString(36);
    c.at = now;
    this.queue.push(c);
    this.pushResult({ id: c.id, ok: null, status: "queued", at: now, type: c.type });
    await this.persist();
    return json({ ok: true, id: c.id });
  }

  async persist() {
    await this.ctx.storage.put({ queue: this.queue, results: this.results, seq: this.seq });
  }
}

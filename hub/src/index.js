// OI Gold Pro Trade — Hub (Cloudflare Worker + Durable Object)
// Relays state from the MT5 bridge EA to the app, and commands from the app to the EA.
//
// Routes
//   GET  /                 test console (phase 1)
//   POST /ea/sync          EA pushes state + results, receives commands   (header X-Key: EA_KEY)
//   GET  /app/state        app reads latest state + recent results       (header X-Key: APP_KEY)
//   POST /app/cmd          app queues a command                          (header X-Key: APP_KEY)
//   GET  /app/login        check a login code → {ok, name, expire}       (header X-Key: code)
//   GET  /app/oi           OI data from the OI Gold Pro sheet (read-only proxy, cached 60s)
//   GET  /health           public, no data
//
// Login codes for the app: APP_KEY (owner) or any code in the TRADE_USERS secret:
//   [{"code":"ABC123","name":"ชื่อ","expire":"2026-12-31"}]   (expire "9999-12-31" = unlimited)
//   …and any row of the "OI Trade Users" Google Sheet, read through its Apps Script
//   (secrets USERS_URL = web app URL, USERS_SECRET = the SECRET set in that script), cached 60s.
// OI_CODE secret = a login code of OI Gold Pro, used only to READ its OI data.

import { TEST_PAGE } from "./page.js";

export const VERSION = "v0.3.01";
const OI_API = "https://script.google.com/macros/s/AKfycbwQrp29KWhUCVO0ojjS73SiLtDKe1QKx69KOOF90QQOlV3csHXqxfOGUYKYw2D6nZp0tw/exec";
const OI_CACHE_MS = 60_000;
let oiCache = null; // {at, body}
let usersCache = null; // {at, list}
const USERS_CACHE_MS = 60_000;

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

function bangkokToday() {
  return new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10);
}

// users from the Google Sheet (via its Apps Script), cached; stale list kept if the sheet is unreachable
async function sheetUsers(env) {
  if (!env.USERS_URL || !env.USERS_SECRET) return [];
  const now = Date.now();
  if (usersCache && now - usersCache.at < USERS_CACHE_MS) return usersCache.list;
  try {
    const r = await fetch(`${env.USERS_URL}?key=${encodeURIComponent(env.USERS_SECRET)}&t=${now}`, { redirect: "follow" });
    const d = await r.json();
    if (d && d.ok && Array.isArray(d.users)) { usersCache = { at: now, list: d.users }; return d.users; }
  } catch {}
  return usersCache ? usersCache.list : [];
}

export function resetUsersCache() { usersCache = null; }

// Returns {name, expire, expired} or null
export async function findUser(code, env) {
  if (!code) return null;
  if (sameKey(code, env.APP_KEY)) return { name: "Owner", expire: "9999-12-31", expired: false };
  let list = [];
  try { list = JSON.parse(env.TRADE_USERS || "[]"); } catch { list = []; }
  if (!Array.isArray(list)) list = [];
  list = list.concat(await sheetUsers(env));
  for (const u of list) {
    if (!u || typeof u.code !== "string" || !u.code) continue;
    if (sameKey(code, u.code)) {
      const expire = String(u.expire || "9999-12-31");
      return { name: String(u.name || ""), expire, expired: expire < bangkokToday() };
    }
  }
  return null;
}

async function oiProxy(env) {
  const now = Date.now();
  if (oiCache && now - oiCache.at < OI_CACHE_MS) return json(oiCache.body);
  if (!env.OI_CODE) return json({ ok: false, error: "OI_CODE not set on hub" }, 503);
  try {
    const r = await fetch(`${OI_API}?api=data&code=${encodeURIComponent(env.OI_CODE)}&t=${now}`, { redirect: "follow" });
    const d = await r.json();
    if (d.error) return json({ ok: false, error: "OI source: " + d.error }, 502);
    delete d.auth; // never pass the owner's OI Gold Pro login details through
    oiCache = { at: now, body: d };
    return json(d);
  } catch (e) {
    if (oiCache) return json(oiCache.body); // serve stale rather than nothing
    return json({ ok: false, error: "OI source unreachable" }, 502);
  }
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

    if (url.pathname === "/" && req.method === "GET")
      return new Response(TEST_PAGE, { headers: { "Content-Type": "text/html; charset=utf-8" } });
    if (url.pathname === "/health") {
      // status only — never codes or counts
      let sheet = "not set";
      if (env.USERS_URL && env.USERS_SECRET) { resetUsersCache(); await sheetUsers(env); sheet = usersCache ? "ok" : "error"; }
      return json({ ok: true, version: VERSION, users_sheet: sheet, oi_code: env.OI_CODE ? "set" : "not set" });
    }

    const key = req.headers.get("X-Key") || "";
    if (url.pathname.startsWith("/ea/")) {
      if (!sameKey(key, env.EA_KEY)) return new Response("ERR|auth", { status: 401 });
    } else if (url.pathname.startsWith("/app/")) {
      const user = await findUser(key, env);
      if (!user) return json({ ok: false, error: "auth" }, 401);
      if (user.expired) return json({ ok: false, error: "auth", reason: "expired", expire: user.expire }, 401);
      if (url.pathname === "/app/login") return json({ ok: true, name: user.name, expire: user.expire });
      if (url.pathname === "/app/oi") return oiProxy(env);
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

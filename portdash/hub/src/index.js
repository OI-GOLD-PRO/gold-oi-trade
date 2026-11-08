// MT5 Port Dashboard — Hub (Cloudflare Worker + one SQLite Durable Object)
// View-only: the PortSender EA pushes account state + deal history, the dashboard app reads it.
//
// Routes
//   GET  /health                     public, no data
//   POST /ea/push                    EA pushes state + new deals        (header X-Key: the account's connection key)
//   GET  /api/login                  check a login code → {name, admin}  (header X-Key: login code)
//   GET  /api/overview               every account the code may see, with summary numbers
//   GET  /api/account?id=…           one account: live state + history/stats
//   GET  /api/combined               all visible accounts merged (calendar + stats)
//   GET  /api/admin/list             accounts (with keys) + users            (ADMIN_KEY only)
//   POST /api/admin/account          {id?, name, start?, magic_names?, reset_login?} create / update
//   POST /api/admin/account/delete   {id}
//   POST /api/admin/user             {code?, name, accounts:[ids]|"*", expire?} create / update
//   POST /api/admin/user/delete      {code}
//
// Secret: ADMIN_KEY (owner login code; sees everything, manages accounts and customer codes).

import { SCHEMA, storeDeals, histCursor, computeHistory, periodSums, bkkDate } from "./history.js";

export const VERSION = "v1.0.00";

const ONLINE_MS = 90_000;        // account offline if no push for this long
const FAST_MS = 5_000;           // EA push interval while someone is watching that account
const IDLE_MS = 30_000;          // EA push interval otherwise
const WATCH_MS = 60_000;         // an account counts as watched this long after an app read
const SAVE_STATE_MS = 60_000;    // write the latest state to SQLite at most this often
const EQUITY_SAMPLE_MS = 300_000;
const HIST_BUCKET_MS = 60_000;   // history cache refresh (equity samples, "today")

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type,X-Key",
  "Access-Control-Max-Age": "86400",
};
const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json", ...CORS } });

export function sameKey(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || !b) return false;
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

const ALPHA = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I
export function randCode(n) {
  const b = new Uint8Array(n);
  crypto.getRandomValues(b);
  let s = "";
  for (const x of b) s += ALPHA[x % ALPHA.length];
  return s;
}

const cleanName = (s, max = 40) => String(s || "").replace(/[\u0000-\u001f<>]/g, "").trim().slice(0, max);
const isDate = s => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ""));
const dateToUtc = s => (isDate(s) ? Math.floor(Date.parse(s + "T00:00:00+07:00") / 1000) : 0); // Bangkok midnight

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
    if (url.pathname === "/" || url.pathname === "/health")
      return json({ ok: true, app: "mt5-port-hub", version: VERSION, admin_key: env.ADMIN_KEY ? "set" : "not set" });
    if (!url.pathname.startsWith("/ea/") && !url.pathname.startsWith("/api/")) return json({ ok: false, error: "not found" }, 404);
    const stub = env.PORT.get(env.PORT.idFromName("main"));
    return stub.fetch(req);
  },
};

// ---------------------------------------------------------------------------

export class Port {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.sql = ctx.storage.sql;
    for (const q of SCHEMA) this.sql.exec(q);
    this.live = new Map();      // id → {state, at, savedAt, eqAt}
    this.watched = new Map();   // id → last app read
    this.histVer = new Map();   // id → bumps when deals arrive
    this.histCache = new Map(); // id → {key, body}
    this.keyIndex = null;       // key → id
  }

  keys() {
    if (!this.keyIndex) {
      this.keyIndex = new Map();
      for (const r of this.sql.exec(`SELECT id, key FROM accounts`).toArray()) this.keyIndex.set(r.key, r.id);
    }
    return this.keyIndex;
  }

  account(id) {
    const r = this.sql.exec(`SELECT * FROM accounts WHERE id = ?`, id).toArray();
    return r.length ? r[0] : null;
  }

  async fetch(req) {
    const url = new URL(req.url);
    const now = Date.now();
    const key = req.headers.get("X-Key") || "";
    try {
      if (url.pathname === "/ea/push" && req.method === "POST") return await this.eaPush(req, key, now);

      const who = this.login(key);
      if (!who) return json({ ok: false, error: "auth" }, 401);
      if (who.expired) return json({ ok: false, error: "auth", reason: "expired", expire: who.expire }, 401);
      const p = url.pathname;
      if (p === "/api/login") return json({ ok: true, name: who.name, admin: who.admin, expire: who.expire, version: VERSION });
      if (p === "/api/overview") return json(this.overview(who, now));
      if (p === "/api/account") return json(...this.accountView(who, url.searchParams.get("id"), now));
      if (p === "/api/combined") return json(this.combined(who, now));
      if (p.startsWith("/api/admin/")) {
        if (!who.admin) return json({ ok: false, error: "admin only" }, 403);
        if (p === "/api/admin/list") return json(this.adminList());
        if (req.method !== "POST") return json({ ok: false, error: "POST only" }, 405);
        let b; try { b = await req.json(); } catch { return json({ ok: false, error: "bad json" }, 400); }
        if (p === "/api/admin/account") return json(...this.adminAccount(b, now));
        if (p === "/api/admin/account/delete") return json(...this.adminAccountDelete(b));
        if (p === "/api/admin/user") return json(...this.adminUser(b, now));
        if (p === "/api/admin/user/delete") return json(...this.adminUserDelete(b));
      }
    } catch (e) {
      return json({ ok: false, error: String((e && e.message) || e) }, 500);
    }
    return json({ ok: false, error: "not found" }, 404);
  }

  // ---- auth ---------------------------------------------------------------
  login(code) {
    if (!code) return null;
    if (sameKey(code, this.env.ADMIN_KEY)) return { name: "เจ้าของ", admin: true, all: true, ids: [], expire: "9999-12-31", expired: false };
    const r = this.sql.exec(`SELECT * FROM users WHERE code = ?`, code).toArray();
    if (!r.length) return null;
    const u = r[0];
    let acc; try { acc = JSON.parse(u.accounts || "[]"); } catch { acc = []; }
    const expire = u.expire || "9999-12-31";
    return { name: u.name, admin: false, all: acc === "*", ids: Array.isArray(acc) ? acc : [], expire, expired: expire < bkkDate(Date.now() / 1000) };
  }

  visible(who) {
    const rows = this.sql.exec(`SELECT * FROM accounts ORDER BY created`).toArray();
    return who.all ? rows : rows.filter(r => who.ids.includes(r.id));
  }

  // ---- EA -------------------------------------------------------------------
  async eaPush(req, key, now) {
    const id = key && this.keys().get(key);
    if (!id) return new Response("ERR|auth", { status: 401 });
    let body;
    try { body = await req.json(); } catch { return new Response("ERR|bad json", { status: 400 }); }
    const st = body && body.state;
    const acc = st && st.account;
    const login = acc && Number(acc.login);
    if (!login) return new Response("ERR|no account", { status: 400 });
    const row = this.account(id);
    if (row.login && row.login !== login)
      return new Response(`ERR|this key belongs to MT5 account ${row.login}`, { status: 409 });

    const L = this.live.get(id) || { state: null, at: 0, savedAt: 0, eqAt: 0 };
    L.state = st; L.at = now;
    this.live.set(id, L);

    if (!row.login || now - L.savedAt >= SAVE_STATE_MS) {
      this.sql.exec(`UPDATE accounts SET login = ?, server = ?, currency = ?, off = ?, state = ?, state_at = ? WHERE id = ?`,
        login, String(acc.server || "").slice(0, 64), String(acc.currency || "").slice(0, 8), Math.trunc(Number(st.gmt_offset) || 0),
        JSON.stringify(st), now, id);
      L.savedAt = now;
    }
    if (Array.isArray(body.deals) && body.deals.length && storeDeals(this.sql, id, body.deals))
      this.histVer.set(id, (this.histVer.get(id) || 0) + 1);
    if (now - L.eqAt >= EQUITY_SAMPLE_MS) {
      this.sql.exec(`INSERT OR REPLACE INTO equity VALUES (?,?,?,?)`, id, Math.floor(now / 1000), Number(acc.balance) || 0, Number(acc.equity) || 0);
      L.eqAt = now;
    }
    const watched = now - (this.watched.get(id) || 0) < WATCH_MS;
    const out = ["OK", "HIST|" + histCursor(this.sql, id).join("|"), "NEXT|" + (watched ? FAST_MS : IDLE_MS)];
    return new Response(out.join("\n") + "\n", { headers: { "Content-Type": "text/plain" } });
  }

  // ---- views ----------------------------------------------------------------
  liveOf(row, now) {
    const L = this.live.get(row.id);
    let state = L && L.state, at = L ? L.at : 0;
    if (!state && row.state) { try { state = JSON.parse(row.state); at = row.state_at || 0; } catch {} }
    const age = at ? now - at : null;
    return { state, age, online: age !== null && age < ONLINE_MS };
  }

  history(row, now) {
    const key = `${this.histVer.get(row.id) || 0}|${Math.floor(now / HIST_BUCKET_MS)}|${row.start || ""}`;
    const c = this.histCache.get(row.id);
    if (c && c.key === key) return c.body;
    const deals = this.sql.exec(`SELECT * FROM deals WHERE acc = ?`, row.id).toArray();
    const eq = this.sql.exec(`SELECT time, balance, equity FROM equity WHERE acc = ? ORDER BY time`, row.id).toArray();
    const body = computeHistory(deals, eq, row.off || 0, { since: dateToUtc(row.start) });
    this.histCache.set(row.id, { key, body });
    return body;
  }

  summary(row, now) {
    const lv = this.liveOf(row, now);
    const a = (lv.state && lv.state.account) || {};
    const pos = (lv.state && lv.state.positions) || [];
    const h = this.history(row, now);
    return {
      id: row.id, name: row.name, login: row.login || null, server: row.server || "", currency: row.currency || "",
      start: row.start || "", connected: !!row.login, online: lv.online, age_ms: lv.age,
      balance: a.balance ?? null, equity: a.equity ?? null, floating: a.profit ?? null, margin_level: a.margin_level ?? null,
      open: pos.length, periods: periodSums(h.daily, now / 1000),
      growth_pct: h.stats.growth_pct, max_dd_pct: h.stats.max_dd_pct, trades: h.count.trades,
    };
  }

  overview(who, now) {
    const list = this.visible(who).map(r => this.summary(r, now));
    for (const s of list) this.watched.set(s.id, now);
    const sum = k => Math.round(list.reduce((t, s) => t + (Number(s[k]) || 0), 0) * 100) / 100;
    const psum = k => Math.round(list.reduce((t, s) => t + (s.periods[k] || 0), 0) * 100) / 100;
    const cur = [...new Set(list.map(s => s.currency).filter(Boolean))];
    return {
      ok: true, version: VERSION, now,
      total: { equity: sum("equity"), balance: sum("balance"), floating: sum("floating"), open: sum("open"),
        periods: { today: psum("today"), week: psum("week"), month: psum("month") }, currency: cur.length === 1 ? cur[0] : (cur.length ? "mixed" : "") },
      accounts: list,
    };
  }

  accountView(who, id, now) {
    const row = id && this.visible(who).find(r => r.id === id);
    if (!row) return [{ ok: false, error: "account not found" }, 404];
    this.watched.set(id, now);
    const lv = this.liveOf(row, now);
    const h = this.history(row, now);
    let magicNames = {}; try { magicNames = JSON.parse(row.magic_names || "{}"); } catch {}
    return [{ ok: true, version: VERSION, now, summary: this.summary(row, now), magic_names: magicNames,
      state: lv.state ? { account: lv.state.account, positions: lv.state.positions || [], orders: lv.state.orders || [], ea: lv.state.ea } : null,
      history: h }];
  }

  combined(who, now) {
    const rows = this.visible(who);
    if (!rows.length) return { ok: true, accounts: 0, history: computeHistory([], [], 0) };
    const ids = rows.map(r => r.id);
    const ph = ids.map(() => "?").join(",");
    const deals = this.sql.exec(`SELECT * FROM deals WHERE acc IN (${ph})`, ...ids).toArray();
    const startOf = Object.fromEntries(rows.map(r => [r.id, dateToUtc(r.start)]));
    const offs = Object.fromEntries(rows.map(r => [r.id, r.off || 0]));
    // each account counts from its own start date
    const kept = deals.filter(d => d.time - offs[d.acc] >= startOf[d.acc] || !(d.type === 0 || d.type === 1));
    const h = computeHistory(kept, [], offs, {});
    const names = {}, magicNames = {};
    for (const r of rows) {
      names[r.id] = r.name;
      try { Object.assign(magicNames, JSON.parse(r.magic_names || "{}")); } catch {}
    }
    const cur = [...new Set(rows.map(r => r.currency).filter(Boolean))];
    return { ok: true, now, accounts: rows.length, names, magic_names: magicNames, currency: cur.length === 1 ? cur[0] : "mixed",
      periods: periodSums(h.daily, now / 1000), history: h };
  }

  // ---- admin ----------------------------------------------------------------
  adminList() {
    const accounts = this.sql.exec(`SELECT id, key, name, start, magic_names, created, login, server, currency, state_at FROM accounts ORDER BY created`).toArray();
    const users = this.sql.exec(`SELECT code, name, accounts, expire, created FROM users ORDER BY created`).toArray()
      .map(u => { let a; try { a = JSON.parse(u.accounts); } catch { a = []; } return { ...u, accounts: a }; });
    return { ok: true, accounts, users };
  }

  adminAccount(b, now) {
    const name = cleanName(b.name);
    if (b.start && !isDate(b.start)) return [{ ok: false, error: "start must be yyyy-mm-dd" }, 400];
    let mn = null;
    if (b.magic_names !== undefined) {
      mn = {};
      if (b.magic_names && typeof b.magic_names === "object")
        for (const [k, v] of Object.entries(b.magic_names)) if (/^\d{1,20}$/.test(k) && cleanName(v)) mn[k] = cleanName(v, 30);
    }
    if (b.id) {
      const row = this.account(String(b.id));
      if (!row) return [{ ok: false, error: "account not found" }, 404];
      this.sql.exec(`UPDATE accounts SET name = ?, start = ?, magic_names = ? WHERE id = ?`,
        name || row.name, b.start !== undefined ? (b.start || "") : row.start, mn ? JSON.stringify(mn) : row.magic_names, row.id);
      if (b.reset_login) {
        this.sql.exec(`UPDATE accounts SET login = NULL, state = NULL, state_at = NULL WHERE id = ?`, row.id);
        this.sql.exec(`DELETE FROM deals WHERE acc = ?`, row.id);
        this.sql.exec(`DELETE FROM equity WHERE acc = ?`, row.id);
        this.live.delete(row.id);
        this.histVer.set(row.id, (this.histVer.get(row.id) || 0) + 1);
      }
      this.histCache.delete(row.id);
      return [{ ok: true, account: this.account(row.id) }];
    }
    if (!name) return [{ ok: false, error: "name required" }, 400];
    const id = "a" + randCode(8).toLowerCase();
    const key = randCode(10);
    this.sql.exec(`INSERT INTO accounts (id, key, name, start, magic_names, created) VALUES (?,?,?,?,?,?)`,
      id, key, name, b.start || "", JSON.stringify(mn || {}), now);
    this.keyIndex = null;
    return [{ ok: true, account: this.account(id) }];
  }

  adminAccountDelete(b) {
    const row = b && this.account(String(b.id || ""));
    if (!row) return [{ ok: false, error: "account not found" }, 404];
    for (const t of ["deals", "equity"]) this.sql.exec(`DELETE FROM ${t} WHERE acc = ?`, row.id);
    this.sql.exec(`DELETE FROM accounts WHERE id = ?`, row.id);
    this.keyIndex = null; this.live.delete(row.id); this.histCache.delete(row.id);
    return [{ ok: true }];
  }

  adminUser(b, now) {
    const name = cleanName(b.name);
    if (b.expire && !isDate(b.expire)) return [{ ok: false, error: "expire must be yyyy-mm-dd" }, 400];
    let accounts = b.accounts === "*" ? "*" : (Array.isArray(b.accounts) ? b.accounts.map(String) : []);
    if (Array.isArray(accounts)) {
      const known = new Set(this.sql.exec(`SELECT id FROM accounts`).toArray().map(r => r.id));
      accounts = accounts.filter(a => known.has(a));
    }
    if (b.code) {
      const r = this.sql.exec(`SELECT * FROM users WHERE code = ?`, String(b.code)).toArray();
      if (!r.length) return [{ ok: false, error: "user not found" }, 404];
      this.sql.exec(`UPDATE users SET name = ?, accounts = ?, expire = ? WHERE code = ?`,
        name || r[0].name, JSON.stringify(accounts), b.expire !== undefined ? (b.expire || "") : r[0].expire, r[0].code);
      return [{ ok: true, code: r[0].code }];
    }
    if (!name) return [{ ok: false, error: "name required" }, 400];
    const code = randCode(8);
    this.sql.exec(`INSERT INTO users VALUES (?,?,?,?,?)`, code, name, JSON.stringify(accounts), b.expire || "", now);
    return [{ ok: true, code }];
  }

  adminUserDelete(b) {
    this.sql.exec(`DELETE FROM users WHERE code = ?`, String((b && b.code) || ""));
    return [{ ok: true }];
  }
}

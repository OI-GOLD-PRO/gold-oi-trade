// Offline test for the hub: fakes the Durable Object runtime, plays EA + app + admin.
// Run: node tools/test-hub.mjs
import worker, { Port } from "../hub/src/index.js";
import { computeHistory, periodSums } from "../hub/src/history.js";
import { DatabaseSync } from "node:sqlite";

const db = new DatabaseSync(":memory:");
const sql = { exec(q, ...b) { const st = db.prepare(q); const rows = /^\s*select/i.test(q) ? st.all(...b) : (st.run(...b), []); return { toArray: () => rows }; } };
const env = { ADMIN_KEY: "owner-secret-123" };
const port = new Port({ storage: { sql } }, env);
env.PORT = { idFromName: () => "main", get: () => ({ fetch: r => port.fetch(r) }) };

const B = "https://hub.test";
const call = (path, { key, body } = {}) =>
  worker.fetch(new Request(B + path, { method: body ? "POST" : "GET", headers: { "X-Key": key || "", "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined }), env);
const J = async r => r.json();

let pass = 0, fail = 0;
const ok = (c, msg) => { c ? pass++ : fail++; console.log((c ? "  ✓ " : "  ✗ ") + msg); };
const A = env.ADMIN_KEY;

console.log("auth");
ok((await call("/health")).status === 200, "health public");
ok((await call("/api/overview")).status === 401, "no key rejected");
ok((await call("/api/overview", { key: "nope" })).status === 401, "wrong key rejected");
let r = await J(await call("/api/login", { key: A }));
ok(r.ok && r.admin, "owner logs in as admin");

console.log("admin");
r = await J(await call("/api/admin/account", { key: A, body: { name: "Grid V4", start: "2026-10-20" } }));
ok(r.ok && r.account.key.length === 10, "create account → connection key");
const acc1 = r.account;
r = await J(await call("/api/admin/account", { key: A, body: { name: "H4 Wick" } }));
const acc2 = r.account;
ok((await call("/api/admin/account", { key: A, body: { name: "x", start: "20/10" } })).status === 400, "bad start date rejected");
r = await J(await call("/api/admin/user", { key: A, body: { name: "ลูกค้า A", accounts: [acc2.id, "ghost"] } }));
ok(r.ok && r.code.length === 8, "create customer code");
const cust = r.code;
r = await J(await call("/api/admin/list", { key: A }));
ok(r.accounts.length === 2 && r.users[0].accounts.length === 1, "list: ghost account id dropped");
ok((await call("/api/admin/list", { key: cust })).status === 403, "customer cannot use admin");

console.log("EA push");
const off = 2 * 3600; // broker GMT+2
const T = Math.floor(Date.UTC(2026, 10, 3, 5, 0, 0) / 1000); // 3 Nov 12:00 BKK
const st = (login, eq) => ({ ea: "v1", gmt_offset: off, account: { login, server: "Demo", currency: "USC", balance: 2600, equity: eq, profit: eq - 2600, margin_level: 1800 },
  positions: [{ ticket: 5, symbol: "XAUUSDc", side: "BUY", lots: 0.02, open: 4010, profit: -12.5, magic: 1004 }] });
const dl = (t, tm, ty, en, pf, pos, mg = 1004, v = 0.01) => ({ t, tm: tm + off, ty, en, v, p: 4000, pf, sw: 0, cm: 0, fe: 0, pos, s: "XAUUSDc", mg });
const deals = [
  dl(1, T - 30 * 86400, 2, 0, 2500, 0, 0),           // deposit before start
  dl(2, T - 20 * 86400, 0, 0, 0, 100), dl(3, T - 20 * 86400 + 60, 1, 1, -40, 100), // trade before start (Oct 14)
  dl(4, T, 0, 0, 0, 101), dl(5, T + 600, 1, 1, 50, 101),
  dl(6, T + 86400, 1, 0, 0, 102), dl(7, T + 86400 + 300, 0, 1, -20, 102, 2002),
  dl(8, T + 86400 * 2, 0, 0, 0, 103, 2002), dl(9, T + 86400 * 2 + 300, 1, 1, 110, 103, 2002),
];
ok((await call("/ea/push", { key: "BADKEY", body: { state: st(111, 2600) } })).status === 401, "unknown key rejected");
let t = await (await call("/ea/push", { key: acc1.key, body: { state: st(111, 2587.5), deals } })).text();
ok(t.startsWith("OK") && t.includes(`HIST|${T + 86400 * 2 + 300 + off}|9`), "deals stored, cursor returned");
ok(t.includes("NEXT|30000"), "idle interval when nobody watches");
ok((await call("/ea/push", { key: acc1.key, body: { state: st(222, 1) } })).status === 409, "other MT5 login on same key rejected");

console.log("views");
r = await J(await call("/api/overview", { key: A }));
const s1 = r.accounts.find(a => a.id === acc1.id);
ok(r.accounts.length === 2 && s1.online && s1.equity === 2587.5 && s1.open === 1, "overview: live numbers");
ok(s1.trades === 3, "start date drops the trade before 20 Oct");
t = await (await call("/ea/push", { key: acc1.key, body: { state: st(111, 2590) } })).text();
ok(t.includes("NEXT|5000"), "fast interval while watched");
r = await J(await call("/api/account?id=" + acc1.id, { key: A }));
const h = r.history;
ok(h.start_balance === 2460 && h.stats.net === 140, "start balance 2460, net +140 since start");
ok(h.daily["2026-11-03"][0] === 50 && h.daily["2026-11-04"][0] === -20 && h.daily["2026-11-05"][0] === 110, "daily P/L by Bangkok date");
ok(h.stats.win_rate === 66.67 && h.stats.profit_factor === 8, "win rate / profit factor");
ok(h.magics.length === 2 && h.magics[0].magic === 2002 && h.magics[0].net === 110 && h.magics[1].net === 30, "per-magic breakdown");
ok(r.state.positions.length === 1, "positions in account view");

r = await J(await call("/api/account?id=" + acc1.id, { key: cust }));
ok(r.ok === false, "customer cannot open someone else's account");
r = await J(await call("/api/overview", { key: cust }));
ok(r.accounts.length === 1 && r.accounts[0].id === acc2.id && !r.accounts[0].connected, "customer sees only own (not yet connected) account");
r = await J(await call("/api/combined", { key: A }));
ok(r.ok && r.history.stats.net === 140, "combined respects each start date");

console.log("admin edits");
r = await J(await call("/api/admin/account", { key: A, body: { id: acc1.id, magic_names: { "1004": "Grid V4", "2002": "H4 Wick", bad: "x" } } }));
ok(JSON.parse(r.account.magic_names)["2002"] === "H4 Wick" && !JSON.parse(r.account.magic_names).bad, "magic names saved");
r = await J(await call("/api/admin/account", { key: A, body: { id: acc1.id, reset_login: true } }));
ok(r.ok && !r.account.login, "reset login clears the binding");
ok((await call("/ea/push", { key: acc1.key, body: { state: st(222, 1) } })).status === 200, "new MT5 login accepted after reset");
await call("/api/admin/user", { key: A, body: { code: cust, expire: "2020-01-01" } });
r = await J(await call("/api/overview", { key: cust }));
ok(r.reason === "expired", "expired customer blocked");
await call("/api/admin/account/delete", { key: A, body: { id: acc2.id } });
r = await J(await call("/api/admin/list", { key: A }));
ok(r.accounts.length === 1, "account deleted");

console.log("periods");
const p = periodSums({ "2026-11-09": [10, 1], "2026-11-08": [5, 1], "2026-11-02": [7, 1], "2026-10-30": [3, 1] }, Date.UTC(2026, 10, 9, 5) / 1000);
ok(p.today === 10 && p.week === 10 && p.month === 22, "today / week (Mon-start) / month");
const e = computeHistory([], [], 0);
ok(e.stats.net === 0 && e.count.trades === 0, "empty history");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

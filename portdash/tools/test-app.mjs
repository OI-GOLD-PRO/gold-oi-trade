// Smoke test: runs app.js against the real hub code in-process (stub DOM), renders every screen.
// Run: node tools/test-app.mjs
import fs from "node:fs";
import vm from "node:vm";
import worker, { Port } from "../hub/src/index.js";
import { DatabaseSync } from "node:sqlite";

const db = new DatabaseSync(":memory:");
const sql = { exec(q, ...b) { const st = db.prepare(q); const rows = /^\s*select/i.test(q) ? st.all(...b) : (st.run(...b), []); return { toArray: () => rows }; } };
const env = { ADMIN_KEY: "owner-secret-123" };
const port = new Port({ storage: { sql } }, env);
env.PORT = { idFromName: () => "main", get: () => ({ fetch: r => port.fetch(r) }) };
const hubFetch = (url, o = {}) => worker.fetch(new Request(url, o), env);
const post = (p, key, body) => hubFetch("https://x" + p, { method: "POST", headers: { "X-Key": key, "Content-Type": "application/json" }, body: JSON.stringify(body) }).then(r => r.json());

// seed: one account with history, one customer
const { account } = await post("/api/admin/account", env.ADMIN_KEY, { name: "Grid <V4>", start: "2026-10-20" });
const now = Math.floor(Date.now() / 1000);
const deals = [{ t: 1, tm: now - 40 * 86400, ty: 2, en: 0, v: 0, p: 0, pf: 2500, sw: 0, cm: 0, fe: 0, pos: 0, s: "", mg: 0 }];
for (let i = 0; i < 30; i++) {
  const tm = now - (20 - i) * 86400 + 3600;
  deals.push({ t: 10 + i * 2, tm, ty: 0, en: 0, v: 0.01, p: 4000, pf: 0, sw: 0, cm: 0, fe: 0, pos: 100 + i, s: "XAUUSDc", mg: i % 2 ? 1004 : 2002 });
  deals.push({ t: 11 + i * 2, tm: tm + 900, ty: 1, en: 1, v: 0.01, p: 4005, pf: (i % 3 ? 12.5 : -9), sw: 0, cm: 0, fe: 0, pos: 100 + i, s: "XAUUSDc", mg: 0 });
}
const state = { gmt_offset: 0, account: { login: 555, server: "Demo", currency: "USC", balance: 2700, equity: 2690, profit: -10, margin_level: 1500, free_margin: 2600 },
  positions: [{ ticket: 9, symbol: "XAUUSDc", side: "SELL", lots: 0.02, open: 4011, profit: -10, magic: 1004 }] };
await hubFetch("https://x/ea/push", { method: "POST", headers: { "X-Key": account.key }, body: JSON.stringify({ state, deals }) });
await post("/api/admin/account", env.ADMIN_KEY, { id: account.id, magic_names: { "1004": "Grid V4" } });
const cust = (await post("/api/admin/user", env.ADMIN_KEY, { name: "ลูกค้า", accounts: [account.id] })).code;

// stub browser
let html = "";
const handlers = {};
const store = new Map();
const ctx = {
  console, Intl, Date, Math, JSON, Promise, setTimeout, clearInterval, URL,
  setInterval: () => 0,
  localStorage: { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: k => store.delete(k) },
  document: { hidden: false, addEventListener: (t, f) => (handlers[t] = f), querySelector: () => ({ set innerHTML(v) { html = v; }, get innerHTML() { return html; } }) },
  navigator: {}, window: { scrollTo() {} }, confirm: () => true, prompt() {},
  fetch: (u, o) => hubFetch(u, o),
};
ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(new URL("../app.js", import.meta.url), "utf8") + "\n;globalThis.__S = S; globalThis.__load = load; globalThis.__login = login;", ctx);

let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : fail++; console.log((c ? "  ✓ " : "  ✗ ") + m); };
const S = ctx.__S;
const settle = () => new Promise(r => setTimeout(r, 30));
const click = async ds => { handlers.click({ target: { closest: () => ({ dataset: ds, textContent: "" }) }, preventDefault() {} }); await settle(); };

ok(html.includes("loginForm"), "login screen first");
await ctx.__login("wrong"); ok(html.includes("รหัสไม่ถูกต้อง"), "wrong code message");
await ctx.__login(env.ADMIN_KEY); await settle(); 
ok(html.includes("พอร์ตของฉัน") && html.includes("2,690.00") && html.includes("Grid V4") && !html.includes("<V4>"), "overview renders, name sanitised");
await click({ acc: account.id });
ok(html.includes("Equity curve") && html.includes("ไม้ที่เปิดอยู่ (1)") && html.includes("Grid V4"), "account screen with positions + magic name");
ok(html.includes("ทุนเริ่ม"), "start balance shown");
await click({ tab: "cal" });
ok(html.includes("cal") && /data-day="\d{4}-\d{2}-\d{2}"/.test(html), "calendar renders days");
await click({ month: "-1" }); ok(html.includes("ปฏิทิน"), "month navigation");
await click({ tab: "stats" });
ok(html.includes("Profit factor") && html.includes("magic 2002"), "stats with magic breakdown");
await click({ tab: "acc" });
ok(html.includes(account.key) && html.includes("PortSender.mq5"), "admin accounts screen with key + EA link");
await click({ logout: "" });
ok(html.includes("loginForm"), "logout");
await ctx.__login(cust); await settle();
ok(html.includes("Grid V4"), "customer sees own account");
await click({ tab: "acc" });
ok(html.includes("บัญชีของฉัน") && !html.includes(account.key), "customer screen hides connection key");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

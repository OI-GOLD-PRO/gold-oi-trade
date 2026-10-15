// Offline test for the hub: fakes the Durable Object runtime and plays EA + app.
// Run: node tools/test-hub.mjs
import worker, { Hub, validateCmd } from "../hub/src/index.js";

class MemStorage {
  constructor() { this.m = new Map(); }
  async get(k) { return structuredClone(this.m.get(k)); }
  async put(o) { for (const [k, v] of Object.entries(o)) this.m.set(k, structuredClone(v)); }
}
const storage = new MemStorage();
let hub;
const ctx = { storage, blockConcurrencyWhile: async (f) => f() };
const env = {
  APP_KEY: "app-secret-123",
  EA_KEY: "ea-secret-456",
  OI_CODE: "oi-owner",
  TRADE_USERS: JSON.stringify([{ code: "USER1", name: "Tester", expire: "9999-12-31" }, { code: "OLD", name: "Old", expire: "2020-01-01" }]),
  HUB: { idFromName: () => "main", get: () => ({ fetch: (r) => hub.fetch(r) }) },
};
hub = new Hub(ctx, env);
await new Promise((r) => setTimeout(r, 5));

const B = "https://hub.test";
const call = (path, { key, body } = {}) =>
  worker.fetch(new Request(B + path, { method: body ? "POST" : "GET", headers: { "X-Key": key || "", "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined }), env);

let pass = 0, fail = 0;
const ok = (c, msg) => { c ? pass++ : fail++; console.log((c ? "  ✓ " : "  ✗ ") + msg); };

const state = {
  account: { login: 123456, server: "Demo", currency: "USC", balance: 10000, equity: 10012.5, profit: 12.5, margin_level: 2400 },
  symbol: { name: "XAUUSDc", bid: 2650.1, ask: 2650.3, digits: 2, contract: 100 },
  positions: [{ ticket: 77, side: "BUY", lots: 0.01, open: 2649, sl: 0, tp: 0, profit: 1.1 }],
  orders: [],
  pl: { today: 3.2 },
};

console.log("auth");
ok((await call("/app/state")).status === 401, "app without key rejected");
ok((await call("/app/state", { key: env.EA_KEY })).status === 401, "EA key cannot read app routes");
ok((await call("/ea/sync", { key: env.APP_KEY, body: {} })).status === 401, "app key cannot use EA route");
ok((await call("/health")).status === 200, "health public");
ok((await call("/")).headers.get("content-type").includes("text/html"), "test page served");

console.log("offline guard");
let r = await call("/app/cmd", { key: env.APP_KEY, body: { type: "OPEN", side: "BUY", lots: 0.01 } });
ok(r.status === 409, "command refused while EA offline");

console.log("EA sync idle");
let t = await (await call("/ea/sync", { key: env.EA_KEY, body: { state } })).text();
ok(t.startsWith("OK\nNEXT|"), "EA gets OK + NEXT");

console.log("app reads state");
let s = await (await call("/app/state", { key: env.APP_KEY })).json();
ok(s.online === true && s.state.symbol.name === "XAUUSDc", "online with EA state");

t = await (await call("/ea/sync", { key: env.EA_KEY, body: { state } })).text();
ok(t.includes("NEXT|1000"), "fast interval while app active");

console.log("validation");
const bad = [
  [{ type: "NOPE" }, "unknown type"],
  [{ type: "OPEN", side: "UP", lots: 1 }, "bad side"],
  [{ type: "OPEN", side: "BUY", lots: 0 }, "zero lots"],
  [{ type: "OPEN", side: "BUY", kind: "LIMIT", lots: 0.01 }, "limit without price"],
  [{ type: "OPEN", side: "BUY", kind: "LIMIT", lots: 0.01, price: 2640, sl: 2645 }, "BUY SL above entry"],
  [{ type: "OPEN", side: "SELL", kind: "STOP", lots: 0.01, price: 2640, tp: 2645 }, "SELL TP above entry"],
  [{ type: "CLOSE" }, "close without ticket"],
  [{ type: "OPEN", side: "BUY", lots: "abc" }, "non-numeric lots"],
];
for (const [b, why] of bad) ok(validateCmd(b)[1] !== null, "rejects " + why);
ok(validateCmd({ type: "OPEN", side: "BUY", kind: "LIMIT", lots: 0.01, price: 2640, sl: 2630, tp: 2660 })[1] === null, "accepts valid buy limit");

console.log("command round trip");
r = await (await call("/app/cmd", { key: env.APP_KEY, body: { type: "OPEN", side: "BUY", lots: "0.02", sl: 2640, tp: 2670 } })).json();
ok(r.ok && r.id, "command queued: " + r.id);
const id = r.id;
t = await (await call("/ea/sync", { key: env.EA_KEY, body: { state } })).text();
const line = t.split("\n").find((l) => l.startsWith("CMD|"));
ok(!!line, "EA receives: " + line);
const f = line.split("|");
ok(f[1] === id && f[2] === "OPEN" && f[3] === "BUY" && f[4] === "MARKET" && f[5] === "0.02" && f[7] === "2640" && f[8] === "2670", "fields correct");
t = await (await call("/ea/sync", { key: env.EA_KEY, body: { state } })).text();
ok(!t.includes("CMD|"), "command delivered only once");
await call("/ea/sync", { key: env.EA_KEY, body: { state, results: [{ id, ok: true, retcode: 10009, msg: "done", ticket: 88 }] } });
s = await (await call("/app/state", { key: env.APP_KEY })).json();
const res = s.results.find((x) => x.id === id);
ok(res && res.status === "done" && res.ticket === 88, "app sees result done #88");

console.log("expiry");
r = await (await call("/app/cmd", { key: env.APP_KEY, body: { type: "CLOSE", ticket: 77 } })).json();
hub.queue[0].at -= 11_000; // pretend it's old
s = await (await call("/app/state", { key: env.APP_KEY })).json();
ok(s.results.find((x) => x.id === r.id).status === "expired", "stale command expires instead of firing late");
t = await (await call("/ea/sync", { key: env.EA_KEY, body: { state } })).text();
ok(!t.includes("CMD|"), "expired command never reaches EA");

console.log("persistence");
r = await (await call("/app/cmd", { key: env.APP_KEY, body: { type: "CANCEL", ticket: 5 } })).json();
hub = new Hub(ctx, env); await new Promise((q) => setTimeout(q, 5));
hub.state = state; hub.stateAt = Date.now();
t = await (await call("/ea/sync", { key: env.EA_KEY, body: { state } })).text();
ok(t.includes("|CANCEL|"), "queued command survives hub restart");

console.log("offline after silence");
hub.stateAt -= 11_000;
s = await (await call("/app/state", { key: env.APP_KEY })).json();
ok(s.online === false, "marked offline after 10s without sync");

console.log("login codes");
let lj = await (await call("/app/login", { key: "USER1" })).json();
ok(lj.ok && lj.name === "Tester", "trade user code logs in");
r = await call("/app/login", { key: "OLD" }); lj = await r.json();
ok(r.status === 401 && lj.reason === "expired", "expired code rejected with reason");
ok((await call("/app/login", { key: "nope" })).status === 401, "unknown code rejected");
ok((await call("/app/state", { key: "USER1" })).status === 200, "trade user can read state");
ok((await call("/ea/sync", { key: "USER1", body: {} })).status === 401, "trade user cannot act as EA");

console.log("OI proxy");
let calls = 0;
const realFetch = globalThis.fetch;
globalThis.fetch = async (u) => { calls++; if (!String(u).includes("code=oi-owner")) throw new Error("wrong code"); return new Response(JSON.stringify({ levels: [{ strike: 4175, type: "C", oi: 900 }], cfg: { offset: 28 }, auth: { name: "owner", expire: "9999" } })); };
let oj = await (await call("/app/oi", { key: "USER1" })).json();
ok(oj.levels && oj.levels[0].strike === 4175, "OI data proxied");
ok(oj.auth === undefined, "owner auth details stripped");
await call("/app/oi", { key: "USER1" });
ok(calls === 1, "second call served from cache");
globalThis.fetch = realFetch;

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

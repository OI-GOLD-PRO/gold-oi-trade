// Local preview: serves the app + runs the hub in-process with sample data.
// Run: node tools/dev-server.mjs  → open http://localhost:8788/?hub=http://localhost:8788  (login: owner-secret-123)
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import worker, { Port } from "../hub/src/index.js";
import { DatabaseSync } from "node:sqlite";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const db = new DatabaseSync(":memory:");
const sql = { exec(q, ...b) { const st = db.prepare(q); const rows = /^\s*select/i.test(q) ? st.all(...b) : (st.run(...b), []); return { toArray: () => rows }; } };
const env = { ADMIN_KEY: "owner-secret-123" };
const port = new Port({ storage: { sql } }, env);
env.PORT = { idFromName: () => "main", get: () => ({ fetch: r => port.fetch(r) }) };
const call = (p, key, body) => worker.fetch(new Request("http://x" + p, { method: "POST", headers: { "X-Key": key, "Content-Type": "application/json" }, body: JSON.stringify(body) }), env);

// sample data (made up)
let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const now = Math.floor(Date.now() / 1000);
async function addAccount(name, start, login, bal, n, magics) {
  const { account } = await (await call("/api/admin/account", env.ADMIN_KEY, { name, start })).json();
  const deals = [{ t: 1, tm: now - 60 * 86400, ty: 2, en: 0, v: 0, p: 0, pf: bal, sw: 0, cm: 0, fe: 0, pos: 0, s: "", mg: 0 }];
  let b = bal;
  for (let i = 0; i < n; i++) {
    const tm = now - Math.floor(rnd() * 25 * 86400), pf = Math.round((rnd() - 0.36) * 40 * 100) / 100, mg = magics[i % magics.length];
    deals.push({ t: 10 + i * 2, tm, ty: rnd() > .5 ? 0 : 1, en: 0, v: 0.01, p: 4000, pf: 0, sw: 0, cm: 0, fe: 0, pos: 1000 + i, s: "XAUUSDc", mg });
    deals.push({ t: 11 + i * 2, tm: tm + 1200, ty: 1, en: 1, v: 0.01, p: 4005, pf, sw: 0, cm: 0, fe: 0, pos: 1000 + i, s: "XAUUSDc", mg });
    b += pf;
  }
  const state = { gmt_offset: 7200, account: { login, server: "Exness-MT5Real", currency: "USC", balance: Math.round(b * 100) / 100, equity: Math.round((b - 26.4) * 100) / 100, profit: -26.4, margin_level: 1842, free_margin: b - 150 },
    positions: [{ ticket: 9, symbol: "XAUUSDc", side: "BUY", lots: 0.01, open: 4012.4, profit: 8.2, magic: magics[0] }, { ticket: 10, symbol: "XAUUSDc", side: "BUY", lots: 0.03, open: 4026.1, profit: -34.6, magic: magics[0] }] };
  await worker.fetch(new Request("http://x/ea/push", { method: "POST", headers: { "X-Key": account.key }, body: JSON.stringify({ state, deals }) }), env);
  for (let k = 0; k < 30; k++) sql.exec(`INSERT OR REPLACE INTO equity VALUES (?,?,?,?)`, account.id, now - (30 - k) * 3600 * 8, bal + k * 9, bal + k * 9 - rnd() * 30);
  return account;
}
const a1 = await addAccount("Grid Dynamic V4", "2026-10-20", 1001, 2500, 120, [1004]);
await call("/api/admin/account", env.ADMIN_KEY, { id: a1.id, magic_names: { "1004": "Grid V4" } });
await addAccount("H4 Wick SMC", "", 1002, 3000, 60, [2002, 0]);
await call("/api/admin/account", env.ADMIN_KEY, { name: "ลูกค้า A" });

const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png" };
http.createServer(async (req, res) => {
  const u = new URL(req.url, "http://localhost");
  if (u.pathname.startsWith("/api/") || u.pathname.startsWith("/ea/")) {
    const body = req.method === "POST" ? await new Promise(r => { let d = ""; req.on("data", c => d += c); req.on("end", () => r(d)); }) : undefined;
    const r = await worker.fetch(new Request("http://x" + u.pathname + u.search, { method: req.method, headers: req.headers, body }), env);
    res.writeHead(r.status, Object.fromEntries(r.headers)); res.end(await r.text()); return;
  }
  const f = path.join(ROOT, u.pathname === "/" ? "index.html" : u.pathname);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { "Content-Type": TYPES[path.extname(f)] || "application/octet-stream" }); fs.createReadStream(f).pipe(res);
}).listen(8788, () => console.log("http://localhost:8788/?hub=http://localhost:8788"));

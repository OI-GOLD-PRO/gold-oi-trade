// MT5 Port Dashboard — view-only portfolio app (reads the port-hub Worker)
"use strict";
const VERSION = "v1.0.00";
const HUB = (typeof location !== "undefined" && /^(localhost|127\.0\.0\.1)$/.test(location.hostname) && new URLSearchParams(location.search).get("hub"))
  || "https://port-hub.oigoldpro.workers.dev"; // ?hub= only for local testing
const REPO_RAW = "https://raw.githubusercontent.com/OI-GOLD-PRO/gold-oi-trade/main/portdash";
const POLL_MS = 10000;

const S = {
  code: lsGet("port_code") || "", me: null,
  tab: "home", accId: null, period: "today", curve: "all",
  calAcc: "all", calMonth: null, calSel: null, statAcc: "all",
  ov: null, acc: null, comb: null, accData: {}, admin: null, err: "", busy: false,
};

function lsGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
function lsSet(k, v) { try { v === null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} }
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const $ = s => document.querySelector(s);

// ---- formatting --------------------------------------------------------
const nf = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmt = v => (v === null || v === undefined || !isFinite(v) ? "–" : nf.format(v));
const sgn = v => (v === null || v === undefined || !isFinite(v) ? "–" : (v > 0 ? "+" : v < 0 ? "−" : "") + nf.format(Math.abs(v)));
const sgnC = v => (v !== null && v !== undefined && Math.abs(v) >= 100 ? (v > 0 ? "+" : "−") + new Intl.NumberFormat("en-US", { maximumFractionDigits: Math.abs(v) >= 10000 ? 0 : 1 }).format(Math.abs(v)) : sgn(v));
const cls = v => (v > 0 ? "pos" : v < 0 ? "neg" : "");
const pct = v => (v === null || v === undefined ? "–" : nf.format(v) + "%");
const TH_MONTH = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
const TH_MONTH_FULL = ["มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน", "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม"];
const bkk = utc => new Date((utc + 7 * 3600) * 1000); // read with getUTC*
const dShort = s => { if (!s) return ""; const [y, m, d] = s.split("-").map(Number); return `${d} ${TH_MONTH[m - 1]} ${y}`; };
function tShort(utc) {
  const d = bkk(utc), now = bkk(Date.now() / 1000);
  const hm = String(d.getUTCHours()).padStart(2, "0") + ":" + String(d.getUTCMinutes()).padStart(2, "0");
  if (d.toISOString().slice(0, 10) === now.toISOString().slice(0, 10)) return "วันนี้ " + hm;
  return `${d.getUTCDate()} ${TH_MONTH[d.getUTCMonth()]} ${hm}`;
}
function ago(ms) {
  if (ms === null || ms === undefined) return "";
  const s = Math.round(ms / 1000);
  if (s < 60) return s + " วิ";
  if (s < 3600) return Math.round(s / 60) + " นาที";
  if (s < 86400) return Math.round(s / 3600) + " ชม.";
  return Math.round(s / 86400) + " วัน";
}
function status(a) {
  if (!a.connected) return `<span class="pill none"><span class="dot"></span>ยังไม่ได้ต่อ EA</span>`;
  if (a.online) return `<span class="pill on"><span class="dot"></span>สด · ${ago(a.age_ms)}</span>`;
  return `<span class="pill off"><span class="dot"></span>ออฟไลน์ ${ago(a.age_ms)}</span>`;
}

// ---- hub ----------------------------------------------------------------
async function api(path, body) {
  const r = await fetch(HUB + path, {
    method: body ? "POST" : "GET",
    headers: { "X-Key": S.code, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined, cache: "no-store",
  });
  const j = await r.json().catch(() => ({ ok: false, error: "hub " + r.status }));
  if (r.status === 401) { const e = new Error(j.reason === "expired" ? "รหัสหมดอายุแล้ว (" + j.expire + ")" : "รหัสไม่ถูกต้อง"); e.auth = true; throw e; }
  if (!j.ok) throw new Error(j.error || "error");
  return j;
}

async function load() {
  if (!S.me) return;
  try {
    if (S.tab === "home" && !S.accId) S.ov = await api("/api/overview");
    else if (S.tab === "home" && S.accId) S.acc = await api("/api/account?id=" + encodeURIComponent(S.accId));
    else if (S.tab === "cal" || S.tab === "stats") {
      const id = S.tab === "cal" ? S.calAcc : S.statAcc;
      if (!S.ov) S.ov = await api("/api/overview");
      if (id === "all") S.comb = await api("/api/combined");
      else S.accData[id] = await api("/api/account?id=" + encodeURIComponent(id));
    } else if (S.tab === "acc") {
      if (S.me.admin) S.admin = await api("/api/admin/list");
      S.ov = await api("/api/overview");
    }
    S.err = "";
  } catch (e) {
    if (e.auth) { logout(e.message); return; }
    S.err = "โหลดข้อมูลไม่ได้: " + e.message;
  }
  render();
}

let timer = null;
function startPoll() { clearInterval(timer); timer = setInterval(() => { if (!document.hidden) load(); }, POLL_MS); }
document.addEventListener("visibilitychange", () => { if (!document.hidden) load(); });

async function login(code) {
  S.code = code.trim();
  try {
    S.me = await api("/api/login");
    lsSet("port_code", S.code);
    S.err = "";
    render(); load(); startPoll();
  } catch (e) {
    S.me = null; S.err = e.auth ? e.message : "ต่อ hub ไม่ได้: " + e.message; render();
  }
}
function logout(msg) {
  lsSet("port_code", null); clearInterval(timer);
  Object.assign(S, { code: "", me: null, ov: null, acc: null, comb: null, accData: {}, admin: null, accId: null, tab: "home", err: msg || "" });
  render();
}

// ---- icons ---------------------------------------------------------------
const IC = {
  home: '<path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
  cal: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  stats: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  acc: '<circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/>',
  back: '<path d="M15 6l-6 6 6 6"/>', prev: '<path d="M15 6l-6 6 6 6"/>', next: '<path d="M9 6l6 6-6 6"/>',
};
const icon = (k, sw = 2) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${IC[k]}</svg>`;

// ---- views ----------------------------------------------------------------
function render() {
  const app = $("#app");
  if (!S.me) { app.innerHTML = viewLogin(); return; }
  let body = "";
  if (S.tab === "home") body = S.accId ? viewAccount() : viewHome();
  else if (S.tab === "cal") body = viewCalendar();
  else if (S.tab === "stats") body = viewStats();
  else body = viewAccounts();
  const tabs = [["home", "ภาพรวม"], ["cal", "ปฏิทิน"], ["stats", "สถิติ"], ["acc", "บัญชี"]];
  app.innerHTML = `<main>${S.err ? `<div class="err">${esc(S.err)}</div>` : ""}${body}</main>
  <nav class="tabs"><div>${tabs.map(([k, l]) => `<button data-tab="${k}" class="${S.tab === k ? "act" : ""}">${icon(k)}${l}</button>`).join("")}</div></nav>`;
}

function viewLogin() {
  return `<div class="login">
    <h1>แดชบอร์ดพอร์ต MT5</h1>
    <span class="sub">ดูกำไร/ขาดทุนและค่าต่างๆ ของพอร์ต (ดูอย่างเดียว)</span>
    <form id="loginForm" style="display:flex;flex-direction:column;gap:12px">
      <label class="f">รหัสเข้าใช้งาน<input class="f" name="code" autocomplete="current-password" type="password" required></label>
      <button class="btn" type="submit">เข้าสู่ระบบ</button>
    </form>
    ${S.err ? `<div class="err">${esc(S.err)}</div>` : ""}
    <span class="sub">${VERSION}</span></div>`;
}

function viewHome() {
  const ov = S.ov;
  if (!ov) return `<div class="empty">กำลังโหลด…</div>`;
  const t = ov.total, cur = t.currency === "mixed" ? "" : t.currency;
  const pv = t.periods[S.period];
  const anyOnline = ov.accounts.some(a => a.online);
  return `
  <div class="between"><div class="kpi"><span class="sub">${esc(S.me.name)}</span><h1>พอร์ตของฉัน</h1></div>
    ${anyOnline ? `<span class="pill on"><span class="dot"></span>สด</span>` : `<span class="pill off"><span class="dot"></span>ไม่มีบัญชีออนไลน์</span>`}</div>
  <div class="card" style="display:flex;flex-direction:column;gap:12px">
    <span class="sub" style="font-size:13px">Equity รวม ${ov.accounts.length} บัญชี${t.currency === "mixed" ? " (หลายสกุลเงิน)" : ""}</span>
    <span class="big">${fmt(t.equity)} <span class="unit">${esc(cur)}</span></span>
    <div class="seg">${[["today", "วันนี้"], ["week", "สัปดาห์"], ["month", "เดือน"]].map(([k, l]) => `<button data-period="${k}" class="${S.period === k ? "act" : ""}">${l}</button>`).join("")}</div>
    <div class="grid3">
      <div class="kpi sm"><span class="l">กำไร (ปิดแล้ว)</span><span class="v ${cls(pv)}">${sgn(pv)}</span></div>
      <div class="kpi sm"><span class="l">Floating</span><span class="v ${cls(t.floating)}">${sgn(t.floating)}</span></div>
      <div class="kpi sm"><span class="l">ไม้ที่เปิด</span><span class="v">${t.open}</span></div>
    </div>
  </div>
  <div class="between"><h2>บัญชี</h2>${S.me.admin ? `<a href="#" data-tab="acc" style="font-size:13px;padding:10px 0">+ เพิ่มบัญชี</a>` : ""}</div>
  ${ov.accounts.length ? ov.accounts.map(a => `
    <button class="card acc" data-acc="${esc(a.id)}">
      <div class="between" style="width:100%"><div class="kpi grow"><span class="ell" style="font-size:15px;font-weight:600">${esc(a.name)}</span>
        <span class="sub ell">${a.login ? esc(a.login + " · " + a.server) : "รอ EA ส่งข้อมูลครั้งแรก"}${a.currency ? " · " + esc(a.currency) : ""}</span></div>${status(a)}</div>
      <div class="grid3" style="width:100%">
        <div class="kpi sm"><span class="l">Equity</span><span class="v">${fmt(a.equity)}</span></div>
        <div class="kpi sm"><span class="l">${{ today: "วันนี้", week: "สัปดาห์", month: "เดือน" }[S.period]}</span><span class="v ${cls(a.periods[S.period])}">${sgn(a.periods[S.period])}</span></div>
        <div class="kpi sm"><span class="l">DD สูงสุด</span><span class="v">${pct(a.max_dd_pct)}</span></div>
      </div>
    </button>`).join("") : `<div class="card empty">ยังไม่มีบัญชี${S.me.admin ? " — ไปที่แท็บ บัญชี เพื่อเพิ่ม" : ""}</div>`}`;
}

function curveSvg(h, mode) {
  let pts = (h.equity || []).map(e => [e[0], e[1], e[2]]);
  if (pts.length < 2) pts = (h.balance || []).map(b => [b[0], b[1], b[1]]);
  if (mode === "7d") { const from = Date.now() / 1000 - 7 * 86400; pts = pts.filter(p => p[0] >= from); }
  if (pts.length < 2) return `<div class="empty">ยังมีข้อมูลไม่พอสำหรับกราฟ</div>`;
  const W = 340, H = 150, P = 6;
  const t0 = pts[0][0], t1 = pts[pts.length - 1][0];
  const base = h.start_balance || null;
  let lo = Infinity, hi = -Infinity;
  for (const p of pts) { lo = Math.min(lo, p[1], p[2]); hi = Math.max(hi, p[1], p[2]); }
  if (base) { lo = Math.min(lo, base); hi = Math.max(hi, base); }
  if (hi - lo < 1e-9) { hi += 1; lo -= 1; }
  const x = t => P + (t1 > t0 ? (t - t0) / (t1 - t0) : 0) * (W - 2 * P);
  const y = v => P + (1 - (v - lo) / (hi - lo)) * (H - 2 * P);
  const line = i => pts.map(p => x(p[0]).toFixed(1) + "," + y(p[i]).toFixed(1)).join(" ");
  const last = pts[pts.length - 1];
  return `<svg width="100%" viewBox="0 0 ${W} ${H}" role="img" aria-label="กราฟ equity ล่าสุด ${fmt(last[2])}">
    ${base ? `<line x1="0" x2="${W}" y1="${y(base)}" y2="${y(base)}" stroke="#3A414D" stroke-dasharray="4 4"/><text x="2" y="${y(base) - 4}" fill="#9AA4B2" font-size="10">${fmt(base)} ทุนเริ่ม</text>` : ""}
    <polyline fill="none" stroke="#5B6573" stroke-width="1.5" points="${line(1)}"/>
    <polyline fill="none" stroke="#E8B54A" stroke-width="2.5" points="${line(2)}"/>
  </svg>`;
}

const magicName = (m, names) => (names && names[m]) || (m ? "magic " + m : "เทรดมือ");

function viewAccount() {
  const d = S.acc;
  if (!d || d.summary.id !== S.accId) return `<div class="row"><button class="iconbtn plain" data-back aria-label="กลับ">${icon("back")}</button></div><div class="empty">กำลังโหลด…</div>`;
  const s = d.summary, h = d.history, a = (d.state && d.state.account) || {}, st = h.stats;
  const pos = (d.state && d.state.positions) || [];
  const cur = s.currency;
  return `
  <div class="row"><button class="iconbtn plain" data-back aria-label="กลับ">${icon("back")}</button>
    <div class="kpi grow"><span class="ell" style="font-size:18px;font-weight:700">${esc(s.name)}</span>
    <span class="sub ell">${s.start ? "เริ่มนับ " + dShort(s.start) + " · ทุนเริ่ม " + fmt(h.start_balance) + " " + esc(cur) : esc(s.login ? s.login + " · " + s.server : "")}</span></div>${status(s)}</div>
  ${!s.connected ? `<div class="note">บัญชีนี้ยังไม่ได้ต่อ EA — ดูวิธีต่อที่แท็บ บัญชี</div>` : ""}
  <div class="grid2">
    ${[["Balance", fmt(a.balance), ""], ["Equity", fmt(a.equity), ""], ["Floating", sgn(a.profit), cls(a.profit)],
       ["Margin level", a.margin_level ? nf.format(a.margin_level).replace(/\.00$/, "") + "%" : "–", ""], ["Free margin", fmt(a.free_margin), ""],
       ["กำไรรวม", st.growth_pct === null ? sgn(st.net) : (st.growth_pct > 0 ? "+" : "") + pct(st.growth_pct), cls(st.net)]]
      .map(([l, v, c]) => `<div class="card kpi" style="padding:12px 14px"><span class="l">${l}</span><span class="v ${c}">${v}</span></div>`).join("")}
  </div>
  <div class="card" style="display:flex;flex-direction:column;gap:10px">
    <div class="between"><h2 style="font-size:15px">Equity curve</h2>
      <div class="seg small">${[["7d", "7 วัน"], ["all", "ทั้งหมด"]].map(([k, l]) => `<button data-curve="${k}" class="${S.curve === k ? "act" : ""}">${l}</button>`).join("")}</div></div>
    ${curveSvg(h, S.curve)}
    <div class="row sub" style="gap:14px;flex-wrap:wrap"><span class="row" style="gap:6px"><span style="width:14px;height:3px;background:#E8B54A"></span>Equity</span>
      <span class="row" style="gap:6px"><span style="width:14px;height:2px;background:#5B6573"></span>Balance</span>
      <span style="margin-left:auto">DD สูงสุด ${pct(st.max_dd_pct)}</span></div>
  </div>
  <div class="grid4">
    ${[["วันนี้", s.periods.today], ["สัปดาห์", s.periods.week], ["เดือน", s.periods.month], ["ทั้งหมด", st.net]]
      .map(([l, v]) => `<div class="card kpi sm" style="padding:10px"><span class="l">${l}</span><span class="v ${cls(v)}" style="font-size:14px">${sgnC(v)}</span></div>`).join("")}
  </div>
  <div class="between"><h2>ไม้ที่เปิดอยู่ (${pos.length})</h2><span class="sub">ดูอย่างเดียว</span></div>
  <div class="card tight list">${pos.length ? pos.map(p => `<div class="it"><span class="side ${p.side}">${p.side}</span>
      <div class="grow"><div class="ell" style="font-size:14px;font-weight:600">${esc(p.symbol)} · ${p.lots}</div>
      <div class="sub ell">เปิด ${p.open} · ${esc(magicName(p.magic, d.magic_names))}</div></div>
      <span class="${cls(p.profit)}" style="font-weight:600">${sgn(p.profit)}</span></div>`).join("") : `<div class="empty">ไม่มีไม้ที่เปิด</div>`}</div>
  <h2>ปิดล่าสุด</h2>
  <div class="card tight list">${h.trades.length ? h.trades.slice(0, 15).map(t => `<div class="it">
      <div class="grow"><div class="ell" style="font-size:14px">${t.side} ${t.vol} ${esc(t.sym)} · ${esc(magicName(t.magic, d.magic_names))}</div>
      <div class="sub">${tShort(t.ct)}</div></div><span class="${cls(t.pnl)}" style="font-weight:600">${sgn(t.pnl)}</span></div>`).join("") : `<div class="empty">ยังไม่มีไม้ที่ปิด</div>`}</div>`;
}

function accSelect(name, val) {
  const list = (S.ov && S.ov.accounts) || [];
  return `<label class="f">บัญชี<select class="f" data-sel="${name}">
    <option value="all"${val === "all" ? " selected" : ""}>ทุกบัญชีรวมกัน</option>
    ${list.map(a => `<option value="${esc(a.id)}"${val === a.id ? " selected" : ""}>${esc(a.name)}</option>`).join("")}</select></label>`;
}
function histFor(id) {
  if (id === "all") return S.comb ? { h: S.comb.history, names: S.comb.magic_names, cur: S.comb.currency } : null;
  const d = S.accData[id];
  return d ? { h: d.history, names: d.magic_names, cur: d.summary.currency } : null;
}

function viewCalendar() {
  const now = bkk(Date.now() / 1000);
  if (!S.calMonth) S.calMonth = now.toISOString().slice(0, 7);
  const [Y, M] = S.calMonth.split("-").map(Number);
  const x = histFor(S.calAcc);
  const daily = (x && x.h.daily) || {};
  const first = new Date(Date.UTC(Y, M - 1, 1)), days = new Date(Date.UTC(Y, M, 0)).getUTCDate();
  const lead = (first.getUTCDay() + 6) % 7;
  const today = now.toISOString().slice(0, 10);
  let total = 0, w = 0, l = 0, best = null, worst = null;
  const cells = [];
  for (let i = 0; i < lead; i++) cells.push(`<div class="d blank"></div>`);
  for (let d = 1; d <= days; d++) {
    const key = `${Y}-${String(M).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    const v = daily[key];
    let c = "d";
    if (v) {
      total += v[0]; if (v[0] > 0) w++; else if (v[0] < 0) l++;
      if (best === null || v[0] > best) best = v[0]; if (worst === null || v[0] < worst) worst = v[0];
    }
    cells.push({ key, d, v });
  }
  const big = Math.max(1, ...cells.filter(c => c.v).map(c => Math.abs(c.v[0])));
  const html = cells.map(c => {
    if (typeof c === "string") return c;
    let k = "d";
    if (c.v && c.v[0] > 0) k += c.v[0] > big / 2 ? " w2" : " w";
    else if (c.v && c.v[0] < 0) k += -c.v[0] > big / 2 ? " l2" : " l";
    if (c.key === today) k += " today";
    if (c.key === S.calSel) k += " sel";
    const lbl = c.v ? `${c.d} ${TH_MONTH[M - 1]} ${sgn(c.v[0])}, ${c.v[1]} ไม้` : `${c.d} ${TH_MONTH[M - 1]} ไม่มีเทรด`;
    return `<button class="${k}" data-day="${c.key}" aria-label="${lbl}"><span>${c.d}</span><span class="p">${c.v ? sgn(c.v[0]).replace(/\.\d+$/, m => m.slice(0, 2)) : ""}</span></button>`;
  }).join("");
  const sel = S.calSel && S.calSel.startsWith(S.calMonth) ? S.calSel : null;
  const sv = sel && daily[sel];
  return `
  <h1>ปฏิทินกำไร/ขาดทุน</h1>
  ${accSelect("cal", S.calAcc)}
  <div class="between">
    <button class="iconbtn" data-month="-1" aria-label="เดือนก่อน">${icon("prev")}</button>
    <div style="display:flex;flex-direction:column;align-items:center"><span style="font-size:17px;font-weight:600">${TH_MONTH_FULL[M - 1]} ${Y}</span>
      <span class="${cls(total)}" style="font-size:13px;font-weight:600">รวม ${sgn(total)} ${esc(x && x.cur !== "mixed" ? x.cur : "")}</span></div>
    <button class="iconbtn" data-month="1" aria-label="เดือนถัดไป">${icon("next")}</button>
  </div>
  ${!x ? `<div class="empty">กำลังโหลด…</div>` : `<div class="cal">${["จ", "อ", "พ", "พฤ", "ศ", "ส", "อา"].map(d => `<span class="h">${d}</span>`).join("")}${html}</div>`}
  ${sel ? `<div class="card between"><span>${dShort(sel)}</span><span>${sv ? `<b class="${cls(sv[0])}">${sgn(sv[0])}</b> · ${sv[1]} ไม้` : `<span class="sub">ไม่มีเทรด</span>`}</span></div>` : ""}
  <div class="grid3">
    <div class="card kpi sm" style="padding:10px"><span class="l">วันกำไร / ขาดทุน</span><span class="v">${w} / ${l} วัน</span></div>
    <div class="card kpi sm" style="padding:10px"><span class="l">วันดีสุด</span><span class="v ${cls(best)}">${best === null ? "–" : sgn(best)}</span></div>
    <div class="card kpi sm" style="padding:10px"><span class="l">วันแย่สุด</span><span class="v ${cls(worst)}">${worst === null ? "–" : sgn(worst)}</span></div>
  </div>
  ${S.calAcc === "all" && x && x.cur === "mixed" ? `<span class="sub">หมายเหตุ: บัญชีมีหลายสกุลเงิน ตัวเลขรวมเป็นการบวกตรงๆ</span>` : ""}`;
}

function donut(v) {
  const r = 36, c = 2 * Math.PI * r, f = Math.max(0, Math.min(100, v || 0)) / 100 * c;
  return `<svg width="88" height="88" viewBox="0 0 88 88" role="img" aria-label="Win rate ${pct(v)}">
    <circle cx="44" cy="44" r="${r}" fill="none" stroke="#262C36" stroke-width="10"/>
    <circle cx="44" cy="44" r="${r}" fill="none" stroke="#E8B54A" stroke-width="10" stroke-linecap="round" stroke-dasharray="${f.toFixed(1)} ${(c - f).toFixed(1)}" transform="rotate(-90 44 44)"/>
    <text x="44" y="50" text-anchor="middle" fill="#E8ECF1" font-size="17" font-weight="700">${v === null ? "–" : Math.round(v) + "%"}</text></svg>`;
}

function viewStats() {
  const x = histFor(S.statAcc);
  let body = `<div class="empty">กำลังโหลด…</div>`;
  if (x) {
    const st = x.h.stats, mg = x.h.magics || [];
    const maxAbs = Math.max(1, ...mg.map(m => Math.abs(m.net)));
    const sinceTxt = x.h.since ? dShort(bkk(x.h.since).toISOString().slice(0, 10)) : "";
    body = `
    <span class="sub">${S.statAcc === "all" ? "ทุกบัญชีรวมกัน" : ""}${sinceTxt ? " · ตั้งแต่ " + sinceTxt : ""}</span>
    <div class="card row" style="gap:16px">${donut(st.win_rate)}
      <div class="kpi"><span class="l" style="font-size:13px">Win rate</span><span style="font-size:15px">ชนะ ${st.wins} · แพ้ ${st.losses} ไม้</span>
      <span class="sub" style="font-size:13px">ไม้ทั้งหมด ${x.h.count.trades} · lot รวม ${st.lots}</span></div></div>
    <div class="grid2">
      ${[["Profit factor", st.profit_factor === null ? "–" : st.profit_factor, ""], ["กำไรสุทธิ", sgn(st.net), cls(st.net)],
         ["กำไรเฉลี่ย/ไม้", sgn(st.avg_win), "pos"], ["ขาดทุนเฉลี่ย/ไม้", sgn(st.avg_loss), "neg"],
         ["Max drawdown", S.statAcc === "all" ? sgn(-st.max_dd) : pct(st.max_dd_pct), ""], ["แพ้ติดกันสูงสุด", st.max_consec_losses + " ไม้", ""],
         ["กำไรเฉลี่ย/วัน", sgn(st.avg_day), cls(st.avg_day)], ["Recovery factor", st.recovery === null ? "–" : st.recovery, ""],
         ["ไม้ดีสุด", sgn(st.best), cls(st.best)], ["ไม้แย่สุด", sgn(st.worst), cls(st.worst)]]
        .map(([l, v, c]) => `<div class="card kpi" style="padding:12px 14px"><span class="l">${l}</span><span class="v ${c}">${v}</span></div>`).join("")}
    </div>
    <h2>แยกตาม EA (magic number)</h2>
    <div class="card" style="display:flex;flex-direction:column;gap:14px">${mg.length ? mg.map(m => `
      <div style="display:flex;flex-direction:column;gap:6px">
        <div class="between" style="font-size:14px"><span class="ell">${esc(magicName(m.magic, x.names))}</span><span class="${cls(m.net)}" style="font-weight:600">${sgn(m.net)}</span></div>
        <div class="bar"><div style="width:${Math.max(2, Math.abs(m.net) / maxAbs * 100).toFixed(0)}%;background:${m.net >= 0 ? "#E8B54A" : "#C0505A"}"></div></div>
        <span class="sub">magic ${m.magic} · ${m.n} ไม้ · win ${pct(m.win_rate)} · ${m.lots} lot</span></div>`).join("") : `<div class="empty">ยังไม่มีไม้ที่ปิด</div>`}</div>`;
  }
  return `<h1>สถิติพอร์ต</h1>${accSelect("stats", S.statAcc)}${body}`;
}

function viewAccounts() {
  const ov = S.ov;
  const me = S.me;
  if (!me.admin) {
    return `<h1>บัญชีของฉัน</h1>
    <div class="card"><div class="kpi"><span class="l">เข้าสู่ระบบในชื่อ</span><span class="v" style="font-size:17px">${esc(me.name)}</span>
      <span class="sub">${me.expire && me.expire !== "9999-12-31" ? "ใช้ได้ถึง " + dShort(me.expire) : "ไม่มีวันหมดอายุ"}</span></div></div>
    <div class="card tight list">${ov ? ov.accounts.map(a => `<div class="it"><div class="grow"><div class="ell" style="font-weight:600">${esc(a.name)}</div>
      <div class="sub">${a.login ? esc(a.login + " · " + a.server) : "ยังไม่ได้ต่อ EA"}</div></div>${status(a)}</div>`).join("") || `<div class="empty">ยังไม่มีบัญชี</div>` : `<div class="empty">กำลังโหลด…</div>`}</div>
    <button class="btn ghost" data-logout>ออกจากระบบ</button><span class="sub">${VERSION}</span>`;
  }
  const ad = S.admin;
  if (!ad) return `<h1>จัดการบัญชี</h1><div class="empty">กำลังโหลด…</div>`;
  const live = Object.fromEntries(((ov && ov.accounts) || []).map(a => [a.id, a]));
  const name = id => (ad.accounts.find(a => a.id === id) || {}).name || id;
  return `
  <h1>จัดการบัญชี</h1>
  <form class="card" id="newAcc" style="display:flex;flex-direction:column;gap:10px">
    <h2>เพิ่มบัญชี MT5</h2>
    <label class="f">ชื่อบัญชี (ตั้งเอง)<input class="f" name="name" maxlength="40" required placeholder="เช่น Grid Dynamic V4"></label>
    <label class="f">เริ่มนับสถิติตั้งแต่ (เว้นว่าง = ทั้งประวัติ)<input class="f" name="start" type="date"></label>
    <button class="btn" type="submit">สร้างรหัสเชื่อมต่อ</button>
  </form>

  <div class="card" style="display:flex;flex-direction:column;gap:12px">
    <h2>วิธีต่อ EA (ทำครั้งเดียวต่อเครื่อง MT5)</h2>
    <div class="step"><span class="num">1</span><div class="grow" style="display:flex;flex-direction:column;gap:6px">
      <span style="font-size:14px">ดาวน์โหลด EA → วางใน MQL5/Experts → เปิดใน MetaEditor กด F7</span>
      <a class="btn sm ghost" style="align-self:flex-start;display:inline-flex;align-items:center" href="${REPO_RAW}/ea/PortSender.mq5" download>ดาวน์โหลด PortSender.mq5</a></div></div>
    <div class="step"><span class="num">2</span><div class="grow" style="display:flex;flex-direction:column;gap:6px">
      <span style="font-size:14px">Tools › Options › Expert Advisors › ติ๊ก Allow WebRequest แล้วเพิ่ม URL นี้</span>
      <div class="row"><span class="mono grow">${HUB}</span><button class="btn sm ghost" data-copy="${HUB}">คัดลอก</button></div></div></div>
    <div class="step"><span class="num">3</span><div class="grow" style="font-size:14px">ลาก EA ใส่กราฟไหนก็ได้ 1 กราฟต่อบัญชี ใส่ ConnectKey ของบัญชีนั้น (ด้านล่าง) ในช่อง Inputs</div></div>
  </div>

  <h2>บัญชีทั้งหมด (${ad.accounts.length})</h2>
  ${ad.accounts.map(a => { const lv = live[a.id] || { connected: !!a.login, online: false, age_ms: null }; let mn = {}; try { mn = JSON.parse(a.magic_names || "{}"); } catch {}
    return `<div class="card" style="display:flex;flex-direction:column;gap:10px">
      <div class="between"><div class="kpi grow"><span class="ell" style="font-weight:600;font-size:15px">${esc(a.name)}</span>
        <span class="sub">${a.login ? esc(a.login + " · " + a.server) : "ยังไม่ได้ต่อ EA"}${a.start ? " · นับจาก " + dShort(a.start) : ""}</span></div>${status(lv)}</div>
      ${a.login ? "" : `<div class="row"><span class="sub" style="flex:none">ConnectKey</span><span class="code grow">${esc(a.key)}</span><button class="btn sm ghost" data-copy="${esc(a.key)}">คัดลอก</button></div>`}
      <details><summary class="sub" style="cursor:pointer;padding:6px 0">แก้ไข / ดูรหัสเชื่อมต่อ</summary>
        <form data-edit="${esc(a.id)}" style="display:flex;flex-direction:column;gap:10px;margin-top:8px">
          ${a.login ? `<div class="row"><span class="sub" style="flex:none">ConnectKey</span><span class="code grow">${esc(a.key)}</span><button class="btn sm ghost" type="button" data-copy="${esc(a.key)}">คัดลอก</button></div>` : ""}
          <label class="f">ชื่อ<input class="f" name="name" maxlength="40" value="${esc(a.name)}"></label>
          <label class="f">เริ่มนับสถิติตั้งแต่<input class="f" name="start" type="date" value="${esc(a.start || "")}"></label>
          <label class="f">ชื่อ EA ตาม magic (บรรทัดละ 1 ตัว เช่น 1004=Grid V4)<textarea class="f" name="magic" rows="3" style="min-height:80px;padding:10px 12px;border-radius:12px;border:1px solid var(--line);background:var(--card);color:var(--text)">${esc(Object.entries(mn).map(([k, v]) => k + "=" + v).join("\n"))}</textarea></label>
          <div class="row" style="flex-wrap:wrap"><button class="btn sm" type="submit">บันทึก</button>
            <button class="btn sm ghost" type="button" data-reset="${esc(a.id)}">ย้ายไปบัญชี MT5 อื่น (ล้างข้อมูล)</button>
            <button class="btn sm danger" type="button" data-del="${esc(a.id)}">ลบบัญชี</button></div>
        </form></details>
    </div>`; }).join("")}

  <h2>รหัสลูกค้า (${ad.users.length})</h2>
  <span class="sub">ลูกค้า login ด้วยรหัสนี้ แล้วเห็นเฉพาะบัญชีที่เลือกให้</span>
  ${ad.users.map(u => `<div class="card" style="display:flex;flex-direction:column;gap:8px">
      <div class="between"><span style="font-weight:600">${esc(u.name)}</span><button class="btn sm danger" data-deluser="${esc(u.code)}">ลบ</button></div>
      <div class="row"><span class="code grow">${esc(u.code)}</span><button class="btn sm ghost" data-copy="${esc(u.code)}">คัดลอก</button></div>
      <span class="sub">เห็นบัญชี: ${u.accounts === "*" ? "ทุกบัญชี" : (u.accounts.map(name).map(esc).join(", ") || "–")}${u.expire ? " · ถึง " + dShort(u.expire) : ""}</span></div>`).join("")}
  <form class="card" id="newUser" style="display:flex;flex-direction:column;gap:10px">
    <h2>เพิ่มรหัสลูกค้า</h2>
    <label class="f">ชื่อลูกค้า<input class="f" name="name" maxlength="40" required></label>
    <fieldset style="border:0;padding:0;margin:0;display:flex;flex-direction:column;gap:6px"><legend class="sub" style="margin-bottom:6px">บัญชีที่ให้เห็น</legend>
      ${ad.accounts.map(a => `<label class="row" style="min-height:36px"><input type="checkbox" name="acc" value="${esc(a.id)}" style="width:20px;height:20px">${esc(a.name)}</label>`).join("") || `<span class="sub">สร้างบัญชีก่อน</span>`}</fieldset>
    <label class="f">ใช้ได้ถึง (เว้นว่าง = ไม่หมดอายุ)<input class="f" name="expire" type="date"></label>
    <button class="btn" type="submit">สร้างรหัส</button>
  </form>
  <button class="btn ghost" data-logout>ออกจากระบบ</button><span class="sub">${VERSION}</span>`;
}

// ---- events ---------------------------------------------------------------
document.addEventListener("click", async e => {
  const t = e.target.closest("button,a"); if (!t) return;
  const ds = t.dataset;
  if (ds.tab) { e.preventDefault(); S.tab = ds.tab; S.accId = null; window.scrollTo(0, 0); render(); load(); return; }
  if (ds.acc) { S.accId = ds.acc; window.scrollTo(0, 0); render(); load(); return; }
  if ("back" in ds) { S.accId = null; render(); load(); return; }
  if (ds.period) { S.period = ds.period; render(); return; }
  if (ds.curve) { S.curve = ds.curve; render(); return; }
  if (ds.month) {
    const [Y, M] = S.calMonth.split("-").map(Number); const d = new Date(Date.UTC(Y, M - 1 + Number(ds.month), 1));
    S.calMonth = d.toISOString().slice(0, 7); render(); return;
  }
  if (ds.day) { S.calSel = S.calSel === ds.day ? null : ds.day; render(); return; }
  if (ds.copy) { try { await navigator.clipboard.writeText(ds.copy); t.textContent = "คัดลอกแล้ว"; } catch { prompt("คัดลอก:", ds.copy); } return; }
  if ("logout" in ds) { logout(); return; }
  if (ds.del && confirm("ลบบัญชีนี้และประวัติทั้งหมด?")) return adminDo("/api/admin/account/delete", { id: ds.del });
  if (ds.reset && confirm("ล้างข้อมูลบัญชีนี้ เพื่อให้รหัสเดิมใช้กับบัญชี MT5 อื่นได้?")) return adminDo("/api/admin/account", { id: ds.reset, reset_login: true });
  if (ds.deluser && confirm("ลบรหัสลูกค้านี้?")) return adminDo("/api/admin/user/delete", { code: ds.deluser });
});
document.addEventListener("change", e => {
  const s = e.target.closest("select[data-sel]"); if (!s) return;
  if (s.dataset.sel === "cal") S.calAcc = s.value; else S.statAcc = s.value;
  render(); load();
});
document.addEventListener("submit", async e => {
  e.preventDefault();
  const f = e.target, fd = new FormData(f);
  if (f.id === "loginForm") return login(String(fd.get("code") || ""));
  if (f.id === "newAcc") return adminDo("/api/admin/account", { name: fd.get("name"), start: fd.get("start") || "" });
  if (f.id === "newUser") return adminDo("/api/admin/user", { name: fd.get("name"), accounts: fd.getAll("acc"), expire: fd.get("expire") || "" });
  if (f.dataset.edit) {
    const mn = {};
    for (const ln of String(fd.get("magic") || "").split(/\n/)) { const m = ln.match(/^\s*(\d+)\s*[=:]\s*(.+?)\s*$/); if (m) mn[m[1]] = m[2]; }
    return adminDo("/api/admin/account", { id: f.dataset.edit, name: fd.get("name"), start: fd.get("start") || "", magic_names: mn });
  }
});
async function adminDo(path, body) {
  try { await api(path, body); S.err = ""; } catch (e) { S.err = "ไม่สำเร็จ: " + e.message; }
  await load();
}

// ---- start ------------------------------------------------------------------
if ("serviceWorker" in navigator) navigator.serviceWorker.getRegistrations().then(rs => rs.forEach(r => r.unregister())).catch(() => {});
render();
if (S.code) login(S.code);

// Deal history + equity samples (Durable Object SQLite) and the dashboard statistics.
// One row set per account id ("acc"). All closed trades count (every symbol, every EA, manual too).

export const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS accounts (id TEXT PRIMARY KEY, key TEXT UNIQUE, name TEXT, start TEXT,
     magic_names TEXT, created INTEGER, login INTEGER, server TEXT, currency TEXT, off INTEGER,
     state TEXT, state_at INTEGER)`,
  `CREATE TABLE IF NOT EXISTS users (code TEXT PRIMARY KEY, name TEXT, accounts TEXT, expire TEXT, created INTEGER)`,
  `CREATE TABLE IF NOT EXISTS deals (acc TEXT, ticket INTEGER, time INTEGER, type INTEGER, entry INTEGER,
     volume REAL, price REAL, profit REAL, swap REAL, commission REAL, fee REAL, position INTEGER,
     symbol TEXT, magic INTEGER, PRIMARY KEY (acc, ticket))`,
  `CREATE INDEX IF NOT EXISTS deals_time ON deals (acc, time, ticket)`,
  `CREATE TABLE IF NOT EXISTS equity (acc TEXT, time INTEGER, balance REAL, equity REAL, PRIMARY KEY (acc, time))`,
];

const num = v => (typeof v === "number" && isFinite(v) ? v : Number(v) || 0);

export function storeDeals(sql, acc, deals) {
  let n = 0;
  for (const d of deals) {
    if (!d || !(d.t > 0)) continue;
    sql.exec(
      `INSERT OR REPLACE INTO deals VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      acc, Math.trunc(d.t), Math.trunc(num(d.tm)), Math.trunc(num(d.ty)), Math.trunc(num(d.en)),
      num(d.v), num(d.p), num(d.pf), num(d.sw), num(d.cm), num(d.fe), Math.trunc(num(d.pos)),
      String(d.s || "").slice(0, 32), Math.trunc(num(d.mg)),
    );
    n++;
  }
  return n;
}

export function histCursor(sql, acc) {
  const r = sql.exec(`SELECT time, ticket FROM deals WHERE acc = ? ORDER BY time DESC, ticket DESC LIMIT 1`, acc).toArray();
  return r.length ? [r[0].time, r[0].ticket] : [0, 0];
}

// ---------------------------------------------------------------------------
const H7 = 7 * 3600;
export const bkkDate = utc => new Date((utc + H7) * 1000).toISOString().slice(0, 10);
const r2 = v => Math.round(v * 100) / 100;

function thin(points, max) {
  if (points.length <= max) return points;
  const step = points.length / max, out = [];
  for (let i = 0; i < max; i++) out.push(points[Math.floor(i * step)]);
  out.push(points[points.length - 1]);
  return out;
}

// Monday (yyyy-mm-dd, Bangkok) of the week holding utc time `now`
export function periodKeys(nowUtc) {
  const today = bkkDate(nowUtc);
  const d = new Date(today + "T00:00:00Z");
  const dow = (d.getUTCDay() + 6) % 7;
  const monday = new Date(d.getTime() - dow * 86400e3).toISOString().slice(0, 10);
  return { today, monday, month: today.slice(0, 7) };
}

export function periodSums(daily, nowUtc) {
  const k = periodKeys(nowUtc);
  let today = 0, week = 0, month = 0;
  for (const [day, v] of Object.entries(daily)) {
    if (day === k.today) today += v[0];
    if (day >= k.monday && day <= k.today) week += v[0];
    if (day.slice(0, 7) === k.month) month += v[0];
  }
  return { today: r2(today), week: r2(week), month: r2(month) };
}

/**
 * deals: rows {acc?,ticket,time,type,entry,volume,price,profit,swap,commission,fee,position,symbol,magic} (server time)
 * equity: rows {time (unix utc), balance, equity}
 * off: broker server time − UTC (seconds); a number, or a map acc → offset for merged accounts
 * opts.since: unix utc — trades before it still move the balance but are not counted in the stats
 */
export function computeHistory(deals, equity, off, opts = {}) {
  const maxList = opts.maxList || 200;
  const since = opts.since || 0;
  const offOf = d => (typeof off === "object" && off ? num(off[d.acc]) : num(off));
  deals = deals.map(d => ({ ...d, u: d.time - offOf(d) })).sort((a, b) => a.u - b.u || a.ticket - b.ticket);

  let bal = 0, startBal = null, tradeCum = 0, peakTrade = 0, maxDD = 0, maxDDPct = 0;
  let deposits = 0, withdrawals = 0, lots = 0;
  const balance = [], daily = {}, pos = new Map();

  for (const d of deals) {
    const net = d.profit + d.swap + d.commission + d.fee;
    const t = d.u;
    if (t >= since && startBal === null) { startBal = bal; if (since) balance.push([since, r2(bal)]); }
    bal += net;
    if (t < since) continue;
    if (d.type === 0 || d.type === 1) {
      tradeCum += net;
      if (tradeCum > peakTrade) peakTrade = tradeCum;
      const base = startBal + peakTrade;
      const dd = peakTrade - tradeCum;
      if (dd > maxDD) { maxDD = dd; maxDDPct = base > 0 ? dd / base * 100 : 0; }
      const day = bkkDate(t);
      (daily[day] = daily[day] || [0, 0])[0] += net;
      const key = (d.acc || "") + ":" + d.position;
      let p = pos.get(key);
      if (!p) { p = { pos: d.position, acc: d.acc, sym: d.symbol, magic: d.magic, side: null, inVol: 0, inPx: 0, outVol: 0, outPx: 0, ot: null, ct: null, pnl: 0 }; pos.set(key, p); }
      p.pnl += net;
      if (d.entry === 0) { // IN
        if (p.side === null) p.side = d.type === 0 ? "BUY" : "SELL";
        if (p.ot === null) p.ot = t;
        p.inPx += d.price * d.volume; p.inVol += d.volume;
        if (d.magic) p.magic = d.magic;
      } else { // OUT / INOUT / OUT_BY
        p.outPx += d.price * d.volume; p.outVol += d.volume; p.ct = t; lots += d.volume;
        if (p.side === null) p.side = d.type === 0 ? "SELL" : "BUY";
      }
    } else if (d.type === 2) { // balance operation
      if (net >= 0) deposits += net; else withdrawals += -net;
    }
    balance.push([t, r2(bal)]);
  }
  if (startBal === null) startBal = bal;

  const trades = [...pos.values()].filter(p => p.outVol > 0).sort((a, b) => a.ct - b.ct);
  let wins = 0, losses = 0, gWin = 0, gLoss = 0, best = null, worst = null, cw = 0, cl = 0, mcw = 0, mcl = 0;
  const magics = {};
  for (const p of trades) {
    const v = p.pnl;
    if (v > 0) { wins++; gWin += v; cw++; cl = 0; } else { losses++; gLoss += v; cl++; cw = 0; }
    mcw = Math.max(mcw, cw); mcl = Math.max(mcl, cl);
    if (best === null || v > best) best = v;
    if (worst === null || v < worst) worst = v;
    const day = bkkDate(p.ct); if (daily[day]) daily[day][1] += 1;
    const m = magics[p.magic] || (magics[p.magic] = { magic: p.magic, n: 0, wins: 0, net: 0, lots: 0 });
    m.n++; m.net += v; m.lots += p.outVol; if (v > 0) m.wins++;
  }
  const n = trades.length;
  for (const k in daily) daily[k] = [r2(daily[k][0]), daily[k][1]];
  const net = gWin + gLoss;
  const days = Object.keys(daily).length;

  return {
    since: since || (deals.length ? deals[0].u : null),
    start_balance: r2(startBal),
    count: { deals: deals.length, trades: n },
    stats: {
      net: r2(net), gross_win: r2(gWin), gross_loss: r2(gLoss),
      growth_pct: (startBal > 0 ? startBal : deposits) > 0 ? r2(net / (startBal > 0 ? startBal : deposits) * 100) : null,
      profit_factor: gLoss < 0 ? r2(gWin / -gLoss) : null,
      win_rate: n ? r2(wins / n * 100) : null, wins, losses, lots: r2(lots),
      avg_win: wins ? r2(gWin / wins) : null, avg_loss: losses ? r2(gLoss / losses) : null,
      best: best === null ? null : r2(best), worst: worst === null ? null : r2(worst),
      max_consec_wins: mcw, max_consec_losses: mcl,
      max_dd: r2(maxDD), max_dd_pct: r2(maxDDPct),
      recovery: maxDD > 0 ? r2(net / maxDD) : null,
      avg_day: days ? r2(net / days) : null,
      deposits: r2(deposits), withdrawals: r2(withdrawals),
    },
    daily,
    balance: thin(balance, 600),
    equity: thin(equity.filter(e => e.time >= since).map(e => [e.time, r2(e.balance), r2(e.equity)]), 600),
    magics: Object.values(magics).sort((a, b) => b.net - a.net).map(m => ({ ...m, net: r2(m.net), lots: r2(m.lots), win_rate: m.n ? r2(m.wins / m.n * 100) : null })),
    trades: trades.slice(-maxList).reverse().map(p => ({
      acc: p.acc, pos: p.pos, sym: p.sym, side: p.side, vol: r2(p.outVol), magic: p.magic,
      open: p.inVol ? +(p.inPx / p.inVol).toFixed(5) : null, close: +(p.outPx / p.outVol).toFixed(5),
      ot: p.ot, ct: p.ct, pnl: r2(p.pnl),
    })),
  };
}

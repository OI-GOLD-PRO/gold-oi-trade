// Deal history + equity samples (Durable Object SQLite) and the dashboard statistics.
// All closed trades of the account are counted (every symbol, every EA, manual trades too).

export const HIST_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS deals (login INTEGER, ticket INTEGER, time INTEGER, type INTEGER, entry INTEGER,
     volume REAL, price REAL, profit REAL, swap REAL, commission REAL, fee REAL, position INTEGER,
     symbol TEXT, magic INTEGER, PRIMARY KEY (login, ticket))`,
  `CREATE INDEX IF NOT EXISTS deals_time ON deals (login, time, ticket)`,
  `CREATE TABLE IF NOT EXISTS equity (login INTEGER, time INTEGER, balance REAL, equity REAL, PRIMARY KEY (login, time))`,
];

const num = v => (typeof v === "number" && isFinite(v) ? v : Number(v) || 0);

export function storeDeals(sql, login, deals) {
  let n = 0;
  for (const d of deals) {
    if (!d || !(d.t > 0)) continue;
    sql.exec(
      `INSERT OR REPLACE INTO deals VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      login, Math.trunc(d.t), Math.trunc(num(d.tm)), Math.trunc(num(d.ty)), Math.trunc(num(d.en)),
      num(d.v), num(d.p), num(d.pf), num(d.sw), num(d.cm), num(d.fe), Math.trunc(num(d.pos)),
      String(d.s || ""), Math.trunc(num(d.mg)),
    );
    n++;
  }
  return n;
}

export function histCursor(sql, login) {
  const r = sql.exec(`SELECT time, ticket FROM deals WHERE login = ? ORDER BY time DESC, ticket DESC LIMIT 1`, login).toArray();
  return r.length ? [r[0].time, r[0].ticket] : [0, 0];
}

// ---------------------------------------------------------------------------
const DAY = 86400;
const bkkDate = utc => new Date((utc + 7 * 3600) * 1000).toISOString().slice(0, 10);
const r2 = v => Math.round(v * 100) / 100;
const SESSIONS = [ // UTC hours of the OPEN time
  { k: "asia", name: "เอเชีย", from: 0, to: 7 },
  { k: "london", name: "ลอนดอน", from: 7, to: 13 },
  { k: "ny", name: "นิวยอร์ก", from: 13, to: 21 },
  { k: "late", name: "ดึก", from: 21, to: 24 },
];

function thin(points, max) {
  if (points.length <= max) return points;
  const step = points.length / max, out = [];
  for (let i = 0; i < max; i++) out.push(points[Math.floor(i * step)]);
  out.push(points[points.length - 1]);
  return out;
}

/**
 * deals: rows {ticket,time,type,entry,volume,price,profit,swap,commission,fee,position,symbol,magic} (server time)
 * equity: rows {time (unix utc), balance, equity}
 * off: broker server time − UTC (seconds)
 */
export function computeHistory(deals, equity, off, opts = {}) {
  const maxList = opts.maxList || 300;
  deals = [...deals].sort((a, b) => a.time - b.time || a.ticket - b.ticket);
  const utc = t => t - (off || 0);

  let bal = 0, tradeCum = 0, peakTrade = 0, balAtPeak = 0, maxDD = 0, maxDDPct = 0;
  let deposits = 0, withdrawals = 0;
  const balance = [], daily = {}, pos = new Map();

  for (const d of deals) {
    const net = d.profit + d.swap + d.commission + d.fee;
    const t = utc(d.time);
    bal += net;
    if (d.type === 0 || d.type === 1) {
      tradeCum += net;
      if (tradeCum > peakTrade) { peakTrade = tradeCum; balAtPeak = bal; }
      const dd = peakTrade - tradeCum;
      if (dd > maxDD) { maxDD = dd; maxDDPct = balAtPeak > 0 ? dd / balAtPeak * 100 : 0; }
      const day = bkkDate(t);
      (daily[day] = daily[day] || [0, 0])[0] += net;
      let p = pos.get(d.position);
      if (!p) { p = { pos: d.position, sym: d.symbol, magic: d.magic, side: null, inVol: 0, inPx: 0, outVol: 0, outPx: 0, ot: null, ct: null, pnl: 0 }; pos.set(d.position, p); }
      p.pnl += net;
      if (d.entry === 0) { // IN
        if (p.side === null) p.side = d.type === 0 ? "BUY" : "SELL";
        if (p.ot === null) p.ot = t;
        p.inPx += d.price * d.volume; p.inVol += d.volume;
      } else { // OUT / INOUT / OUT_BY
        p.outPx += d.price * d.volume; p.outVol += d.volume; p.ct = t;
        if (p.side === null) p.side = d.type === 0 ? "SELL" : "BUY"; // closing deal is opposite
      }
    } else if (d.type === 2) { // balance operation
      if (net >= 0) deposits += net; else withdrawals += -net;
    }
    balance.push([t, r2(bal)]);
  }

  // closed trades (positions with at least one closing deal)
  const trades = [...pos.values()].filter(p => p.outVol > 0).sort((a, b) => a.ct - b.ct);
  let wins = 0, losses = 0, gWin = 0, gLoss = 0, best = null, worst = null, cw = 0, cl = 0, mcw = 0, mcl = 0;
  const sess = SESSIONS.map(s => ({ ...s, n: 0, wins: 0, net: 0 }));
  const sides = { BUY: { n: 0, wins: 0, net: 0 }, SELL: { n: 0, wins: 0, net: 0 } };
  for (const p of trades) {
    const v = p.pnl;
    if (v > 0) { wins++; gWin += v; cw++; cl = 0; } else { losses++; gLoss += v; cl++; cw = 0; }
    mcw = Math.max(mcw, cw); mcl = Math.max(mcl, cl);
    if (best === null || v > best) best = v;
    if (worst === null || v < worst) worst = v;
    const day = bkkDate(p.ct); if (daily[day]) daily[day][1] += 1;
    const h = new Date(((p.ot ?? p.ct)) * 1000).getUTCHours();
    const s = sess.find(x => h >= x.from && h < x.to); s.n++; s.net += v; if (v > 0) s.wins++;
    const sd = sides[p.side] || (sides[p.side] = { n: 0, wins: 0, net: 0 }); sd.n++; sd.net += v; if (v > 0) sd.wins++;
  }
  const n = trades.length;
  for (const k in daily) daily[k] = [r2(daily[k][0]), daily[k][1]];

  return {
    first_time: deals.length ? utc(deals[0].time) : null,
    count: { deals: deals.length, trades: n },
    stats: {
      net: r2(gWin + gLoss), gross_win: r2(gWin), gross_loss: r2(gLoss),
      profit_factor: gLoss < 0 ? r2(gWin / -gLoss) : null,
      win_rate: n ? r2(wins / n * 100) : null, wins, losses,
      avg_win: wins ? r2(gWin / wins) : null, avg_loss: losses ? r2(gLoss / losses) : null,
      best: best === null ? null : r2(best), worst: worst === null ? null : r2(worst),
      max_consec_wins: mcw, max_consec_losses: mcl,
      max_dd: r2(maxDD), max_dd_pct: r2(maxDDPct),
      deposits: r2(deposits), withdrawals: r2(withdrawals),
    },
    daily,
    balance: thin(balance, 800),
    equity: thin(equity.map(e => [e.time, r2(e.balance), r2(e.equity)]), 800),
    sessions: sess.map(s => ({ k: s.k, name: s.name, n: s.n, net: r2(s.net), win_rate: s.n ? r2(s.wins / s.n * 100) : null })),
    sides: Object.fromEntries(Object.entries(sides).map(([k, s]) => [k, { n: s.n, net: r2(s.net), win_rate: s.n ? r2(s.wins / s.n * 100) : null }])),
    trades: trades.slice(-maxList).reverse().map(p => ({
      pos: p.pos, sym: p.sym, side: p.side, vol: r2(p.outVol), magic: p.magic,
      open: p.inVol ? +(p.inPx / p.inVol).toFixed(5) : null, close: +(p.outPx / p.outVol).toFixed(5),
      ot: p.ot, ct: p.ct, pnl: r2(p.pnl),
    })),
  };
}

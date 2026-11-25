export const liquidityRange = 500;

export function rankBook(book) {
  const bid = Number(book.bids?.[0]?.[0]), ask = Number(book.asks?.[0]?.[0]);
  if (!(bid > 0 && ask >= bid && Number.isFinite(ask))) throw Error('Invalid book');
  const mid = (bid + ask) / 2;
  const rows = [];
  const coverage = [];
  for (const [entries, sign] of [[book.bids,1],[book.asks,-1]]) {
    const bins = new Map();
    let reach = 0;
    for (const [price,size] of entries) {
      const p = Number(price), q = Number(size);
      if (!Number.isFinite(p) || !Number.isFinite(q) || p <= 0 || q <= 0) continue;
      const distance = (mid-p)*sign;
      if (distance < 0) continue;
      reach = Math.max(reach,distance);
      if (distance > liquidityRange) continue;
      const key = Math.floor(p);
      bins.set(key,(bins.get(key) || 0) + q);
    }
    const ranked = [...bins].sort((a,b)=>b[1]-a[1] || sign*(b[0]-a[0])).slice(0,10);
    if (!ranked.length) throw Error('Incomplete book');
    rows.push(...ranked.map(([price,qty])=>[price,qty*sign]));
    coverage.push(Math.min(liquidityRange,reach));
  }
  return {rows,coverage,mid,step:1};
}

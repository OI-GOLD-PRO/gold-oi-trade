// 👥 OI Gold Pro — ตัวส่งไม้รายย่อยจากเครื่องที่บ้าน (relay)
// Binance กับ Bitget บล็อกเซิร์ฟเวอร์ Cloudflare (HTTP 403) แต่เครื่องที่บ้านดึงได้ปกติ
// สคริปต์นี้ดึงไม้ XAUUSDT perp ของทั้งสองตลาดทุก 1 นาที แล้วส่งให้เซิร์ฟเวอร์ /rtpush (เซิร์ฟเวอร์กันนับซ้ำด้วย id ของไม้)
// ใช้ Node.js 18 ขึ้นไป · ไม่ต้องติดตั้งแพ็กเกจเพิ่ม · ไม่ต้องใช้รหัส/คีย์ใด ๆ
// รัน:  node rt-relay.mjs      (ปิดหน้าต่าง = หยุดส่ง)
const SERVER = 'https://gc-yahoo.oigoldpro.workers.dev/rtpush';
const EVERY = 60e3;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const fj = async (u, ms = 8000) => { const ac = new AbortController(), t = setTimeout(() => ac.abort(), ms); try { const r = await fetch(u, { signal: ac.signal }); if (!r.ok) throw new Error('HTTP ' + r.status); return await r.json(); } finally { clearTimeout(t); } };
const st = { bn: 0, bgT: 0 };
const ts = () => new Date().toLocaleTimeString('th-TH', { hour12: false });

async function binance() {
  const out = [];
  let from = st.bn ? st.bn + 1 : null;
  for (let pg = 0; pg < 10; pg++) {
    const j = await fj('https://fapi.binance.com/fapi/v1/aggTrades?symbol=XAUUSDT&limit=1000' + (from ? '&fromId=' + from : ''));
    if (!Array.isArray(j)) throw new Error('bad');
    j.forEach(x => out.push([x.a, x.T, +x.p, +x.q, x.m ? -1 : 1]));
    if (j.length) { from = j[j.length - 1].a + 1; st.bn = from - 1; }
    if (j.length < 1000) break;
    await sleep(300);
  }
  return out;
}
async function bitget() {
  const now = Date.now(), since = st.bgT ? st.bgT - 5000 : now - 120e3;
  const j = await fj(`https://api.bitget.com/api/v2/mix/market/fills-history?symbol=XAUUSDT&productType=usdt-futures&limit=1000&startTime=${since}&endTime=${now}`);
  if (j.code !== '00000') throw new Error(j.msg || 'bad');
  const out = (j.data || []).map(x => [String(x.tradeId), +x.ts, +x.price, +x.size, x.side === 'buy' ? 1 : -1]);
  out.forEach(x => { if (x[1] > st.bgT) st.bgT = x[1]; });
  return out;
}
async function push(src, tr) {
  if (!tr.length) return 'ไม่มีไม้ใหม่';
  const r = await fetch(SERVER, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ src, via: 'relay', tr: tr.slice(-20000) }) });
  const j = await r.json().catch(() => ({}));
  return `ส่ง ${tr.length} รับ ${j.added ?? '?'}${j.error ? ' ' + j.error : ''}`;
}
async function tick() {
  for (const [name, fn] of [['binance', binance], ['bitget', bitget]]) {
    try { console.log(ts(), name.padEnd(8), await push(name, await fn())); }
    catch (e) { console.log(ts(), name.padEnd(8), 'ผิดพลาด:', e.message || e); }
  }
}
console.log('👥 OI Gold Pro relay เริ่มทำงาน — ส่งไม้ Binance + Bitget ทุก 1 นาที (กด Ctrl+C เพื่อหยุด)');
for (;;) { const t0 = Date.now(); await tick(); await sleep(Math.max(5000, EVERY - (Date.now() - t0))); }

// JBD / Xiaoxiang BMS frames — what the XiaoxiangBMS app speaks over BLE (service FF00).
//   request : DD A5 <cmd> 00 <crc16> 77          cmd 03 = basic info, 04 = cell voltages
//   response: DD <cmd> <status> <len> <data…> <crc16> 77     crc16 = 0x10000 − sum(status, len, data)
// The ESP32 only relays the raw frames (hex); everything is decoded here so it can change without re-flashing.

export const PROT_NAMES = [
  'cellOver', 'cellUnder', 'packOver', 'packUnder', 'chgOverTemp', 'chgUnderTemp',
  'disOverTemp', 'disUnderTemp', 'chgOverCurrent', 'disOverCurrent', 'shortCircuit', 'icError', 'mosLock',
];

export function hexToBytes(h) {
  h = String(h || '').replace(/[^0-9a-fA-F]/g, '');
  if (!h.length || h.length % 2) return null;
  const a = new Uint8Array(h.length / 2);
  for (let i = 0; i < a.length; i++) a[i] = parseInt(h.substr(i * 2, 2), 16);
  return a;
}

/** Validate one response frame and return its data bytes, or null. */
export function frameData(hex, cmd) {
  const b = hexToBytes(hex);
  if (!b || b.length < 7) return null;
  if (b[0] !== 0xdd || b[1] !== cmd || b[b.length - 1] !== 0x77 || b[2] !== 0x00) return null;
  const len = b[3];
  if (b.length !== len + 7) return null;
  let sum = 0;
  for (let i = 2; i < 4 + len; i++) sum += b[i];
  if (((0x10000 - sum) & 0xffff) !== ((b[4 + len] << 8) | b[5 + len])) return null;
  return b.subarray(4, 4 + len);
}

const u16 = (d, i) => (d[i] << 8) | d[i + 1];
const s16 = (d, i) => { const v = u16(d, i); return v >= 0x8000 ? v - 0x10000 : v; };
const r = (x, n) => Math.round(x * 10 ** n) / 10 ** n;

export function parseBasic(d) {
  if (!d || d.length < 23) return null;
  const date = u16(d, 10);
  const ntc = d[22];
  const temps = [];
  for (let i = 0; i < ntc && 23 + 2 * i + 1 < d.length; i++) temps.push(r((u16(d, 23 + 2 * i) - 2731) / 10, 1));
  const prot = u16(d, 16);
  return {
    v: r(u16(d, 0) / 100, 2),
    a: r(s16(d, 2) / 100, 2),                       // + charging, − discharging
    remAh: r(u16(d, 4) / 100, 2),
    nomAh: r(u16(d, 6) / 100, 2),
    cycles: u16(d, 8),
    made: { y: 2000 + (date >> 9), m: (date >> 5) & 15, d: date & 31 },
    balancing: (u16(d, 12) | (u16(d, 14) << 16)) >>> 0,
    prot,
    protNames: PROT_NAMES.filter((_, i) => prot & (1 << i)),
    sw: d[18],
    soc: d[19],
    fet: d[20],                                      // bit0 charge MOS on, bit1 discharge MOS on
    nCells: d[21],
    temps,
  };
}

export function parseCells(d) {
  if (!d || d.length < 2) return null;
  const mv = [];
  for (let i = 0; i + 1 < d.length; i += 2) mv.push(u16(d, i));
  return mv;
}

/** Decode a battery report {basic: hex, cells: hex}; null when the basic frame is missing/corrupt. */
export function parseBms(basicHex, cellsHex) {
  const p = parseBasic(frameData(basicHex, 0x03));
  if (!p) return null;
  p.w = r(p.v * p.a, 0);
  p.tMax = p.temps.length ? Math.max(...p.temps) : null;
  const mv = parseCells(frameData(cellsHex, 0x04));
  if (mv && mv.length) {
    p.cells = mv;
    const lo = Math.min(...mv), hi = Math.max(...mv);
    p.cMin = lo / 1000; p.cMax = hi / 1000; p.cDelta = (hi - lo) / 1000;
    p.cMinIdx = mv.indexOf(lo) + 1; p.cMaxIdx = mv.indexOf(hi) + 1;
  }
  return p;
}

/** "AA:BB:…=Label,CC:DD:…=Label" → ordered [{mac, label}] */
export function parseLabels(s) {
  return String(s || '').split(',').map((x) => x.trim()).filter(Boolean).map((x) => {
    const i = x.indexOf('=');
    return { mac: (i < 0 ? x : x.slice(0, i)).trim().toUpperCase(), label: i < 0 ? x : x.slice(i + 1).trim() };
  });
}

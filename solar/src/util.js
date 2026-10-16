// Small crypto + time helpers that run on Cloudflare Workers (and Node 20+).

const enc = new TextEncoder();

function hex(buf) {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function sha1(text) {
  return hex(await crypto.subtle.digest('SHA-1', enc.encode(text)));
}

export async function sha256(text) {
  return hex(await crypto.subtle.digest('SHA-256', enc.encode(text)));
}

export async function hmacSha256(key, text) {
  const k = await crypto.subtle.importKey('raw', enc.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', k, enc.encode(text)));
}

// Thailand is UTC+7 all year (no daylight saving).
export const TZ_OFFSET_MS = 7 * 3600 * 1000;
// A "solar day" runs 05:00 → 05:00 so a day's charging and that night's usage stay together.
export const DAY_START_H = 5;
const SHIFT_MS = TZ_OFFSET_MS - DAY_START_H * 3600 * 1000;

/** "YYYY-MM-DD" of the solar day a timestamp belongs to (Thai time, day starts 05:00). */
export function localDate(ts) {
  return new Date(ts + SHIFT_MS).toISOString().slice(0, 10);
}

/** [start, end) epoch ms of a solar day: 05:00 that date → 05:00 next date, Thai time. */
export function dayRange(dateStr) {
  const start = Date.parse(`${dateStr}T00:00:00Z`) - SHIFT_MS;
  return [start, start + 86400000];
}

/** Simple key/value cache stored in D1 (tokens, discovered device ids). */
export async function kvGet(db, key) {
  const row = await db.prepare('SELECT v FROM kv WHERE k = ?').bind(key).first();
  return row ? JSON.parse(row.v) : null;
}

export async function kvSet(db, key, value) {
  await db
    .prepare('INSERT INTO kv (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v')
    .bind(key, JSON.stringify(value))
    .run();
}

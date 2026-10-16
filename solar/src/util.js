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

/** "YYYY-MM-DD" of a timestamp in Thai time. */
export function localDate(ts) {
  return new Date(ts + TZ_OFFSET_MS).toISOString().slice(0, 10);
}

/** [start, end) epoch ms of a Thai calendar day. */
export function dayRange(dateStr) {
  const start = Date.parse(`${dateStr}T00:00:00Z`) - TZ_OFFSET_MS;
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

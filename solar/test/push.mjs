// Web Push: the encrypted body decrypts like a browser would (RFC 8291), VAPID JWT verifies, events fire once.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import worker from '../src/index.js';
import { batteryEvent, notifyBattery } from '../src/push.js';

const S = crypto.subtle, enc = new TextEncoder();
const b64u = (b) => Buffer.from(b).toString('base64url'), unb = (s) => new Uint8Array(Buffer.from(s, 'base64url'));
const hmac = async (k, d) => new Uint8Array(await S.sign('HMAC', await S.importKey('raw', k, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']), d));
const cat = (...p) => new Uint8Array(Buffer.concat(p.map((x) => Buffer.from(x))));

// a fake phone
const ua = await S.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
const uaPub = new Uint8Array(await S.exportKey('raw', ua.publicKey));
const auth = crypto.getRandomValues(new Uint8Array(16));
async function decrypt(body) {
  const salt = body.slice(0, 16), idlen = body[20], asPub = body.slice(21, 21 + idlen), ct = body.slice(21 + idlen);
  const shared = new Uint8Array(await S.deriveBits({ name: 'ECDH', public: await S.importKey('raw', asPub, { name: 'ECDH', namedCurve: 'P-256' }, false, []) }, ua.privateKey, 256));
  const ikm = (await hmac(await hmac(auth, shared), cat(enc.encode('WebPush: info\0'), uaPub, asPub, [1]))).slice(0, 32);
  const prk = await hmac(salt, ikm);
  const cek = (await hmac(prk, cat(enc.encode('Content-Encoding: aes128gcm\0'), [1]))).slice(0, 16);
  const nonce = (await hmac(prk, cat(enc.encode('Content-Encoding: nonce\0'), [1]))).slice(0, 12);
  const pt = new Uint8Array(await S.decrypt({ name: 'AES-GCM', iv: nonce }, await S.importKey('raw', cek, 'AES-GCM', false, ['decrypt']), ct));
  assert.equal(pt[pt.length - 1], 2);
  return JSON.parse(new TextDecoder().decode(pt.slice(0, -1)));
}

const sql = new DatabaseSync(':memory:');
sql.exec(fs.readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
const DB = { prepare(q) { let a = []; const st = { bind(...x) { a = x; return st; }, async run() { sql.prepare(q).run(...a); return { meta: {} }; }, async first() { return sql.prepare(q).get(...a) ?? null; }, async all() { return { results: sql.prepare(q).all(...a) }; } }; return st; } };
DB.batch = async (l) => { for (const x of l) await x.run(); };
const env = { DB, APP_KEY: 'demo' };
const call = (p, init = {}) => worker.fetch(new Request('https://x' + p, { ...init, headers: { 'x-key': 'demo', ...(init.headers || {}) } }), env);

assert.match(await (await worker.fetch(new Request('https://x/sw.js'), env)).text(), /showNotification/);
const { key } = await (await call('/api/push/key')).json();
assert.equal(unb(key).length, 65);
const endpoint = 'https://push.example.com/abc';
assert.equal((await (await call('/api/push/sub', { method: 'POST', body: JSON.stringify({ endpoint, keys: { p256dh: b64u(uaPub), auth: b64u(auth) } }) })).json()).devices, 1);

const sent = [];
globalThis.fetch = async (url, init) => { sent.push({ url, init }); return new Response('', { status: 201 }); };
const r = await (await call('/api/push/test')).json();
assert.equal(r.sent, 1);
const msg = await decrypt(new Uint8Array(sent[0].init.body));
assert.match(msg.title, /ทดสอบ/);
const h = sent[0].init.headers;
assert.equal(h['Content-Encoding'], 'aes128gcm');
const [, t, k] = h.Authorization.match(/^vapid t=([^,]+), k=(.+)$/);
assert.equal(k, key);
const [hd, bd, sg] = t.split('.');
assert.equal(JSON.parse(Buffer.from(bd, 'base64url')).aud, 'https://push.example.com');
const vk = await S.importKey('raw', unb(key), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
assert.ok(await S.verify({ name: 'ECDSA', hash: 'SHA-256' }, vk, unb(sg), enc.encode(hd + '.' + bd)), 'VAPID signature');

// events
const ts = Date.parse('2026-10-25T12:00:00Z');
assert.equal(batteryEvent(30, { soc: 10, src: 'empty' }, 49.9, ts).kind, 'empty');
assert.equal(batteryEvent(10, { soc: 10, src: 'empty' }, 49.9, ts), null);          // already empty → no repeat
assert.equal(batteryEvent(89.5, { soc: 90, src: 'full' }, 54.6, ts).kind, 'full');
assert.equal(batteryEvent(90, { soc: 90, src: 'ceiling' }, 54.6, ts), null);
assert.equal(batteryEvent(60, { soc: 60.2, src: 'ah' }, 52, ts), null);
sent.length = 0;
const ev = batteryEvent(89.5, { soc: 90, src: 'full' }, 54.6, ts);
assert.equal((await notifyBattery(env, ev, ts)).sent, 1);
assert.equal((await notifyBattery(env, ev, ts + 3600000)).skipped, 'cooldown');
assert.match((await decrypt(new Uint8Array(sent[0].init.body))).title, /แบตเต็ม/);

// a dead phone (410) is removed
globalThis.fetch = async () => new Response('', { status: 410 });
await call('/api/push/test');
assert.equal((await (await call('/api/push/key')).json()).devices, 0);
console.log('push OK');

// morning: night on grid (Line Mode, 800 W), switch to solar at 07:10 → one event with the time, %, and night kWh
{
  const { morningEvent } = await import('../src/push.js');
  const { gridW } = await import('../src/calc.js');
  const sw = Date.parse('2026-11-09T07:10:00+07:00');
  const mk = (t) => t < sw
    ? { ts: t, inv_mode: 'Line Mode', grid_v: 230, load_w: 800, inv_pv_w: 0, inv_chg_a: 0, inv_dis_a: 0, batt_v: 50.5, soc_calc: 12 }
    : { ts: t, inv_mode: 'Invert Mode', grid_v: 230, load_w: 700, inv_pv_w: 900, inv_chg_a: 3, inv_dis_a: 0, batt_v: 51, soc_calc: 12 };
  const night = []; for (let t = Date.parse('2026-11-08T18:00:00+07:00'); t <= sw + 4 * 60000; t += 60000) night.push(mk(t));
  const at = (t) => night.filter((s) => s.ts <= t).slice(-20);
  assert.equal(morningEvent(at(sw + 3 * 60000), night, sw + 3 * 60000, gridW), null, 'needs 5 min off grid');
  const ev = morningEvent(at(sw + 4 * 60000), night, sw + 4 * 60000, gridW);
  assert.ok(ev && ev.body.includes('07:10') && ev.pct === 3, JSON.stringify(ev));
  assert.ok(Math.abs(ev.kwh - 0.8 * (13 + 10 / 60)) < 0.1, 'night kWh ' + ev.kwh);
  console.log('morning', ev.body);
  // no grid overnight → nothing; afternoon → nothing
  const off = night.map((s) => ({ ...mk(sw + 60000), ts: s.ts }));
  assert.equal(morningEvent(off.slice(-20), off, sw + 4 * 60000, gridW), null);
  const pm = night.map((s) => ({ ...s, ts: s.ts + 8 * 3600000 }));
  assert.equal(morningEvent(pm.slice(-20), pm, sw + 8 * 3600000 + 4 * 60000, gridW), null);
  console.log('morning OK');
}

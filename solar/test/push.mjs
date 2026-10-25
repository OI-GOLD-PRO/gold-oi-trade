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

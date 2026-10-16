// Tuya Cloud (official OpenAPI) client for the HM-4096 MPPT charge controller.
import { sha256, hmacSha256, kvGet, kvSet } from './util.js';

const HOSTS = {
  sg: 'https://openapi-sg.iotbing.com', // Singapore data center (this account)
  us: 'https://openapi.tuyaus.com',
  eu: 'https://openapi.tuyaeu.com',
  in: 'https://openapi.tuyain.com',
  cn: 'https://openapi.tuyacn.com',
};

const EMPTY_BODY_HASH = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

/** Tuya "new" signature: HMAC-SHA256(clientId + [accessToken] + t + nonce + stringToSign). */
export async function tuyaSign({ clientId, secret, accessToken = '', t, nonce = '', method, path }) {
  const stringToSign = [method, EMPTY_BODY_HASH, '', path].join('\n');
  return (await hmacSha256(secret, clientId + accessToken + t + nonce + stringToSign)).toUpperCase();
}

async function call(env, path, accessToken = '') {
  const host = HOSTS[(env.TUYA_REGION || 'sg').toLowerCase()] || HOSTS.sg;
  const t = Date.now().toString();
  const sign = await tuyaSign({
    clientId: env.TUYA_CLIENT_ID,
    secret: env.TUYA_SECRET,
    accessToken,
    t,
    method: 'GET',
    path,
  });
  const headers = { client_id: env.TUYA_CLIENT_ID, sign, t, sign_method: 'HMAC-SHA256' };
  if (accessToken) headers.access_token = accessToken;
  const res = await fetch(host + path, { headers });
  const data = await res.json();
  if (!data.success) throw new Error(`Tuya ${path} code ${data.code} ${data.msg || ''}`);
  return data.result;
}

async function token(env, force = false) {
  if (!env.TUYA_CLIENT_ID || !env.TUYA_SECRET) throw new Error('ยังไม่ได้ตั้ง TUYA_CLIENT_ID / TUYA_SECRET');
  const cached = !force && (await kvGet(env.DB, 'tuya_token'));
  if (cached && Date.now() < cached.expiresAt) return cached.token;
  const r = await call(env, '/v1.0/token?grant_type=1');
  const t = { token: r.access_token, expiresAt: Date.now() + (r.expire_time - 300) * 1000 };
  await kvSet(env.DB, 'tuya_token', t);
  return t.token;
}

/** phase_a / phase_b are 6–8 byte blobs: [u16 volts×10][u16 amps×10][u16 watts×10]... */
export function decodePhase(b64) {
  if (!b64) return null;
  const bin = atob(b64);
  const u16 = (i) => (i + 1 < bin.length ? ((bin.charCodeAt(i) << 8) | bin.charCodeAt(i + 1)) : null);
  return { v: u16(0) / 10, a: u16(2) / 10, w: u16(4) / 10 };
}

/** Normalise the HM-4096 properties into the values the app uses. */
export function parseMppt(props) {
  const p = Object.fromEntries(props.map((x) => [x.code, x.value]));
  const pv = decodePhase(p.phase_a);
  const bat = decodePhase(p.phase_b);
  const battW = p.cur_power != null ? p.cur_power / 10 : null;
  const battV = bat?.v || null;
  return {
    pvV: pv?.v ?? null,
    pvA: pv?.a ?? null,
    pvW: pv?.w ?? null,
    battV,
    battW,
    // Charge current into the battery — power ÷ voltage matched the app best.
    battA: battW != null && battV ? Math.round((battW / battV) * 100) / 100 : null,
    todayKwh: p.forward_energy_total != null ? p.forward_energy_total / 100 : null,
    totalKwh: p.reverse_energy_total != null ? p.reverse_energy_total / 10 : null,
    tempC: p.temp_current ?? null,
    fault: p.fault ?? 0,
  };
}

export async function readMppt(env) {
  const path = `/v2.0/cloud/thing/${env.TUYA_DEVICE_ID}/shadow/properties`;
  let result;
  try {
    result = await call(env, path, await token(env));
  } catch (e) {
    // token invalid/expired (1010/1011) → refresh once
    if (/code 10(10|11|04)/.test(e.message)) result = await call(env, path, await token(env, true));
    else throw e;
  }
  return { values: parseMppt(result.properties || []), raw: result.properties };
}

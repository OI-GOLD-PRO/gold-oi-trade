// Read-only health check (run by .github/workflows/solar-check.yml). Lists the SmartESS devices on the account
// with their online status, so a replaced/re-paired Wi-Fi dongle shows up. Prints no secrets.
import { toQuery } from '../src/dess.js';
import { sha1 } from '../src/util.js';
const BASE = 'https://web.dessmonitor.com/public/';
const get = async (u) => (await fetch(u, { headers: { 'user-agent': 'Mozilla/5.0 solar-monitor' } })).json();
const salt = () => Date.now().toString();
let q = toQuery({ action: 'authSource', usr: process.env.DESS_USER, source: '1', 'company-key': 'bnrl_frRFjEz8Mkn' });
let s = salt();
const login = await get(`${BASE}?sign=${await sha1(`${s}${await sha1(process.env.DESS_PASSWORD)}&${q}`)}&salt=${s}&${q}`);
console.log(`::notice title=SmartESS login::err ${login.err} ${login.desc || ''}`);
if (login.err !== 0) process.exit(0);
const { token, secret } = login.dat;
q = toQuery({ action: 'webQueryDeviceEs', i18n: 'en_US', source: '1', page: '0', pagesize: '50' });
s = salt();
const list = await get(`${BASE}?sign=${await sha1(`${s}${secret}${token}&${q}`)}&salt=${s}&token=${token}&${q}`);
const devs = list.dat?.device || [];
console.log(`::notice title=SmartESS devices::err ${list.err} count ${devs.length}`);
for (const d of devs) {
  const keep = Object.fromEntries(Object.entries(d).filter(([k]) => /pn|sn|devcode|devaddr|status|alias|name|lts|time|energy|outpower/i.test(k)));
  console.log(`::notice title=device::${JSON.stringify(keep)}`);
}

// ---- Tuya: is the MPPT online, and did re-pairing create a new device id? ----
{
  const { call } = await import('../src/tuya.js');
  const env = { TUYA_CLIENT_ID: process.env.TUYA_CLIENT_ID, TUYA_SECRET: process.env.TUYA_SECRET, TUYA_REGION: 'sg' };
  const id = process.env.TUYA_DEVICE_ID;
  try {
    const tok = (await call(env, '/v1.0/token?grant_type=1')).access_token;
    let uid = null;
    try {
      const d = await call(env, `/v1.0/devices/${id}`, tok);
      uid = d.uid;
      console.log(`::notice title=tuya configured device::${JSON.stringify({ id: d.id, name: d.name, online: d.online, product: d.product_name, update_time: d.update_time })}`);
    } catch (e) { console.log(`::notice title=tuya configured device::${e.message}`); }
    if (uid) {
      const list = await call(env, `/v1.0/users/${uid}/devices`, tok);
      for (const d of list || []) console.log(`::notice title=tuya device::${JSON.stringify({ id: d.id, name: d.name, online: d.online, product: d.product_name, create_time: d.create_time, update_time: d.update_time })}`);
    }
  } catch (e) { console.log(`::notice title=tuya::${e.message}`); }
}

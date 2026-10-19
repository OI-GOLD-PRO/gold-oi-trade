// /flash — one-button installer for the ESP32 BMS relay (ESP Web Tools, Chrome/Edge on a PC).
// The firmware image is built by GitHub Actions and committed to solar/firmware/dist/factory.bin.
const REPO = 'OI-GOLD-PRO/gold-oi-trade';
const FW_VERSION = '1.0.0';

export const FLASH_MANIFEST = {
  name: 'Stamp HOME · BMS relay',
  version: FW_VERSION,
  new_install_prompt_erase: true,
  builds: [{ chipFamily: 'ESP32', parts: [{ path: `https://raw.githubusercontent.com/${REPO}/main/solar/firmware/dist/factory.bin`, offset: 0 }] }],
};

export const FLASH_PAGE = `<!doctype html>
<html lang="th"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>ติดตั้งบอร์ด BMS · Stamp HOME</title>
<style>
  :root{--bg:#0f1412;--card:#18201c;--line:#2a352f;--text:#e8efe9;--muted:#8fa196;--accent:#3fbf8a}
  @media (prefers-color-scheme:light){:root{--bg:#f4f7f5;--card:#fff;--line:#d9e2dc;--text:#14201a;--muted:#5c6e63;--accent:#16875a}}
  body{margin:0;background:var(--bg);color:var(--text);font-family:system-ui,'Noto Sans Thai',sans-serif;line-height:1.55}
  main{max-width:560px;margin:0 auto;padding:20px 16px 40px}
  h1{font-size:22px;margin:8px 0 4px} .muted{color:var(--muted)}
  .card{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:16px;margin:14px 0}
  ol{padding-left:20px;margin:8px 0} li{margin:6px 0}
  .btn{display:flex;justify-content:center;margin:16px 0}
  esp-web-install-button button{background:var(--accent);color:#06120c;border:0;border-radius:12px;padding:14px 22px;font-size:16px;font-weight:700}
  code{background:rgba(127,127,127,.18);padding:1px 6px;border-radius:6px}
</style></head><body><main>
<h1>ติดตั้งโปรแกรมลงบอร์ด ESP32</h1>
<div class="muted">อ่านค่า BMS ทั้งสองลูกผ่านบลูทูธ แล้วส่งขึ้นแอป Stamp HOME</div>

<div class="card">
  <b>ก่อนเริ่ม</b>
  <ol>
    <li>ใช้คอมวินโดวส์ และเปิดหน้านี้ด้วย <b>Chrome</b> หรือ <b>Edge</b> (มือถือและ Safari ใช้ไม่ได้)</li>
    <li>เสียบบอร์ดเข้าคอมด้วยสาย USB-C ที่ส่งข้อมูลได้</li>
    <li>ถ้ากดติดตั้งแล้วไม่เห็นพอร์ตให้เลือก ให้ลงไดรเวอร์ชิป USB ของบอร์ด (<code>CH340</code> หรือ <code>CP210x</code> ดูตัวชิปเล็กๆ ข้างช่อง USB) แล้วลองใหม่</li>
  </ol>
</div>

<div class="btn"><esp-web-install-button manifest="/flash/manifest.json">
  <button slot="activate">ติดตั้งลงบอร์ด</button>
  <span slot="unsupported">เบราว์เซอร์นี้ไม่รองรับ — ใช้ Chrome หรือ Edge บนคอม</span>
  <span slot="not-allowed">ต้องเปิดหน้านี้ผ่าน https</span>
</esp-web-install-button></div>

<div class="card">
  <b>หลังติดตั้งเสร็จ (ตั้งค่าครั้งแรก)</b>
  <ol>
    <li>บอร์ดจะปล่อยไวไฟชื่อ <code>StampHOME-BMS</code> ให้เอามือถือเชื่อมต่อ (หน้าตั้งค่าจะเด้งขึ้นเอง ถ้าไม่เด้งให้เปิด <code>192.168.4.1</code>)</li>
    <li>เลือกไวไฟบ้าน (ต้องเป็นคลื่น 2.4 GHz) แล้วใส่รหัสไวไฟ</li>
    <li>ช่อง <b>App link</b> ใส่ลิงก์แอป Stamp HOME และช่อง <b>App key</b> ใส่รหัสเข้าแอป (ตัวเดียวกับที่ใช้เปิดแอป)</li>
    <li>กดบันทึก บอร์ดจะรีสตาร์ต และภายใน 1 นาทีการ์ด "แบตรายลูก" จะขึ้นในแอป</li>
  </ol>
  <div class="muted">ถ้าต้องการตั้งค่าใหม่: กดปุ่ม <b>BOOT</b> บนบอร์ดค้างไว้ 3 วินาทีระหว่างที่บอร์ดทำงานอยู่</div>
</div>
</main>
<script type="module" src="https://unpkg.com/esp-web-tools@10.1.0/dist/web/install-button.js?module"></script>
</body></html>`;

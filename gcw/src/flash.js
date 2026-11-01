// /mini/flash — ติดตั้งเฟิร์มแวร์ OI Gold Pro Mini จากเบราว์เซอร์ (ESP Web Tools, Chrome/Edge บนคอม)
// ไฟล์ factory.bin สร้างโดย GitHub Actions (build-mini-firmware.yml) ที่ mini/dist/factory.bin
const BIN = 'https://raw.githubusercontent.com/OI-GOLD-PRO/gold-oi-trade/main/mini/dist/factory.bin';
export const MINI_MANIFEST = (ver) => ({
  name: 'OI Gold Pro Mini',
  version: ver || 'latest',
  new_install_prompt_erase: true,
  builds: [{ chipFamily: 'ESP32', parts: [{ path: BIN, offset: 0 }] }],
});
export const MINI_FLASH_PAGE = `<!doctype html>
<html lang="th"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>ติดตั้ง OI Gold Pro Mini</title>
<style>
  :root{--bg:#0b1020;--card:#121a30;--line:#1f2a46;--text:#e6e9f2;--muted:#8a93ab;--gold:#e0b44c}
  body{margin:0;background:var(--bg);color:var(--text);font-family:system-ui,'Noto Sans Thai',sans-serif;line-height:1.6}
  main{max-width:560px;margin:0 auto;padding:20px 16px 40px}
  h1{font-size:22px;margin:8px 0 4px;color:var(--gold)} .muted{color:var(--muted)}
  .card{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:16px;margin:14px 0}
  ol{padding-left:20px;margin:8px 0} li{margin:6px 0}
  .btn{display:flex;justify-content:center;margin:18px 0}
  esp-web-install-button button{background:var(--gold);color:#1a1405;border:0;border-radius:12px;padding:14px 26px;font-size:17px;font-weight:700;cursor:pointer}
  code{background:rgba(127,127,127,.18);padding:1px 6px;border-radius:6px}
</style></head><body><main>
<h1>ติดตั้ง OI Gold Pro Mini</h1>
<div class="muted">จอ ESP32 CYD 2.8" (ESP32-2432S028) · เวอร์ชันล่าสุด <b id="v">…</b></div>
<div class="card"><b>ก่อนเริ่ม</b><ol>
  <li>ใช้คอม เปิดหน้านี้ด้วย <b>Chrome</b> หรือ <b>Edge</b> (มือถือและ Safari ใช้ไม่ได้)</li>
  <li>เสียบจอเข้าคอมด้วยสาย USB ที่ส่งข้อมูลได้</li>
  <li>ไม่เห็นพอร์ตให้เลือก → ลงไดรเวอร์ <code>CH340</code> แล้วลองใหม่</li>
</ol></div>
<div class="btn"><esp-web-install-button manifest="/mini/flash/manifest.json">
  <button slot="activate">ติดตั้งลงจอ</button>
  <span slot="unsupported">เบราว์เซอร์นี้ไม่รองรับ — ใช้ Chrome หรือ Edge บนคอม</span>
  <span slot="not-allowed">ต้องเปิดหน้านี้ผ่าน https</span>
</esp-web-install-button></div>
<div class="card"><b>หลังติดตั้งเสร็จ</b><ol>
  <li>ถ้าเลือก "ลบข้อมูลเดิม" ต้องตั้ง WiFi ใหม่บนจอ (เลือกชื่อ WiFi แล้วพิมพ์รหัส)</li>
  <li>ต่อ WiFi เสร็จ จอจะให้ใส่ <b>รหัสเข้าแอป OI Gold Pro</b> (รหัสเดียวกับที่ใช้เข้าแอป)</li>
  <li>เวอร์ชันถัดไปอัปเดตผ่าน WiFi ได้เลย: MENU → CHECK UPDATE</li>
</ol></div>
</main>
<script>fetch('https://raw.githubusercontent.com/OI-GOLD-PRO/gold-oi-trade/main/mini/dist/version.json?t='+Date.now()).then(r=>r.json()).then(j=>{document.getElementById('v').textContent='v'+j.v}).catch(()=>{})</script>
<script type="module" src="https://unpkg.com/esp-web-tools@10.1.0/dist/web/install-button.js?module"></script>
</body></html>`;

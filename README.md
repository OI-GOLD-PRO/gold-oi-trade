# OI Gold Pro Trade

แอปเทรดทองที่ต่อยอดจาก OI Gold Pro: กดเทรดจากมือถือ → ส่งคำสั่งเข้า MT5 บนคอม

```
มือถือ (แอป) ⇄ Hub บน Cloudflare (ฟรี) ⇄ EA สะพานใน MT5 บนคอม
```

| โฟลเดอร์ | คืออะไร |
|---|---|
| `hub/` | ตัวกลางบน Cloudflare Worker — รับสถานะจาก EA, ส่งคำสั่งจากแอป, มีหน้าทดสอบในตัว |
| `ea/OI_Trade_Bridge.mq5` | EA สะพาน — ส่งราคา/บัญชี/ออเดอร์ขึ้น hub และทำตามคำสั่ง |
| `icon/` | ไอคอนหน้าจอโฮม (ลูกศรเขียวขึ้น–แดงลงไขว้กัน, OI สีทองตรงกลาง) |
| `tools/` | สคริปต์ทดสอบ hub และสร้างไอคอน |

เวอร์ชัน: **v0.1.00** (เฟส 1 – สะพาน)

---

## ติดตั้งเฟส 1 (ทำบนคอมที่เปิด MT5)

### 1. Hub บน Cloudflare
1. สมัคร Cloudflare ฟรีที่ dash.cloudflare.com
2. ติดตั้ง Node.js (LTS) จาก nodejs.org
3. เปิด Command Prompt ในโฟลเดอร์ `hub` แล้วพิมพ์ทีละบรรทัด:
   ```
   npm install
   npx wrangler login
   npx wrangler deploy
   ```
   จะได้ลิงก์แบบ `https://oi-trade-hub.<ชื่อคุณ>.workers.dev` — จดไว้
4. สร้างรหัสลับ 2 ชุด (รันคำสั่งนี้ 2 ครั้ง ได้รหัสคนละชุด):
   ```
   node -e "console.log(crypto.randomUUID())"
   ```
5. ใส่รหัสเข้า hub:
   ```
   npx wrangler secret put APP_KEY      ← วางรหัสชุดที่ 1 (ใช้ในแอป/หน้าทดสอบ)
   npx wrangler secret put EA_KEY       ← วางรหัสชุดที่ 2 (ใช้ใน EA)
   ```

### 2. EA ใน MT5 (ใช้บัญชีเดโมก่อน)
1. MT5 → File → Open Data Folder → `MQL5/Experts` → วาง `OI_Trade_Bridge.mq5`
2. เปิดใน MetaEditor แล้วกด **F7** (Compile)
3. MT5 → Tools → Options → Expert Advisors → ติ๊ก **Allow WebRequest for listed URL** แล้วเพิ่มลิงก์ hub
4. ลาก EA ใส่กราฟ XAUUSD ใส่ค่า:
   - `HubURL` = ลิงก์ hub (ไม่มี / ท้าย)
   - `EAKey` = รหัสชุดที่ 2
   - `MaxLots` = เพดานล็อตต่อออเดอร์ (เริ่มต้น 0.10)
5. เปิดปุ่ม **Algo Trading** — มุมซ้ายบนกราฟต้องขึ้น `online`

### 3. ทดสอบจากมือถือ
เปิดลิงก์ hub ในมือถือ → ใส่รหัสชุดที่ 1 → ต้องเห็นจุดเขียว "EA ออนไลน์" กับยอดบัญชี
ลองกด BUY 0.01 บนเดโม แล้วกดปิด

---

## ระบบกันพลาด
- คำสั่งที่ EA ไม่ได้รับภายใน 10 วิ → ยกเลิกทิ้ง ไม่ยิงย้อนหลัง
- EA ไม่ทำคำสั่งที่อายุเกิน `MaxCmdAgeMs` (8 วิ) และไม่ทำคำสั่งซ้ำ
- ล็อตเกิน `MaxLots` → ปฏิเสธ
- EA ออฟไลน์ → hub ไม่รับคำสั่ง
- รหัสแอปกับรหัส EA แยกกัน ใช้แทนกันไม่ได้
- ตั้ง `ManageAllOnSym = false` ถ้าอยากให้แอปแตะเฉพาะออเดอร์ที่เปิดจากแอป

## โควตาฟรีของ Cloudflare
ฟรี 100,000 request/วัน — EA ซิงก์ทุก 1 วิเฉพาะตอนเปิดแอปดู, ตอนไม่มีคนดูซิงก์ทุก 5 วิ
ใช้คนเดียวอยู่ราว 30–50k/วัน

## ทดสอบ hub (ไม่ต้องต่อเน็ต)
```
node tools/test-hub.mjs
```

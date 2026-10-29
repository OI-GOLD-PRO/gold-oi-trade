# บันทึกการแก้ไข (Change Log) — gold-oi-trade

repo นี้มี Worker ข้อมูล (gcw/), Trade app (hub/, ea/), OI Gold Pro Mini (mini/) และแอปโซล่า (solar/)
งานส่วนนี้ซับซ้อน ปกติ Claude เป็นคนแก้ ถ้า ChatGPT แก้ ต้องจดไว้ที่นี่ด้วย

## กติกา
1. ก่อนแก้: pull โค้ดล่าสุด แล้วอ่านไฟล์นี้ก่อน
2. หลังแก้ทุกครั้ง: เพิ่มรายการใหม่ **ไว้บนสุด** ของส่วน "รายการ" ใน commit เดียวกับโค้ด
3. รูปแบบ:
   ```
   ### ส่วนที่แก้ + เวอร์ชัน — YYYY-MM-DD — ผู้แก้ (Claude / ChatGPT)
   - ไฟล์: …
   - แก้อะไร: …
   - ระวัง: …
   ```
4. ห้ามใส่ token หรือ key ในโค้ด (TELEGRAM_BOT_TOKEN เป็น Cloudflare Secret และ wrangler.toml ต้องคง `keep_vars = true`)

## รายการ

### Mini v0.4.1 — 2026-10 — Claude
- ไฟล์: mini/
- แก้อะไร: ปิดจอ ตั้งเวลาปิดอัตโนมัติ (ตลาดปิด / กลางคืน) แจ้งเตือนปลุกจอ อัปเดตผ่าน WiFi จาก GitHub

### Worker gc-yahoo — 2026-10-27 — Claude
- ไฟล์: gcw/src/index.js, gcw/src/push.js
- แก้อะไร: เลือกสัญญาตามวันไทย (OG รายเดือนวันหมดอายุ) ยืม OI เมื่อสัญญาไม่มี OI แจ้งเตือน Telegram + Web Push เลือกประเภทได้ endpoint /mini
- ระวัง: สัญญาหมดอายุ 12:30 เวลาชิคาโก (00:30 ไทย, 01:30 ไทยหลัง 1 พ.ย.)

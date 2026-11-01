# บันทึกการแก้ไข (Change Log) — gold-oi-trade

repo นี้มี Worker ข้อมูล (gcw/), Trade app (hub/, ea/), OI Gold Pro Mini (mini/) และแอปโซล่า (solar/)
งานส่วนนี้ซับซ้อน ปกติ Claude เป็นคนแก้ ถ้า ChatGPT แก้ ต้องจดไว้ที่นี่ด้วย

งาน OI Gold Pro Mini อ่าน [`mini/HANDOFF.md`](mini/HANDOFF.md) ก่อน

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

### Mini v0.5.2 — 2026-11-01 — Claude
- ไฟล์: mini/OIGoldProMini/OIGoldProMini.ino, mini/platformio.ini (เอา WebSockets ออก), mini/HANDOFF.md
- แก้อะไร: บนบอร์ดจริง v0.5.0 กราฟไม่ขึ้น และเมนูเช็กอัปเดตขึ้น CHECK FAILED (งานเน็ตยังทำงาน แต่การเชื่อมต่อ HTTPS ใหม่ล้มเหลว — น่าจะหน่วยความจำไม่พอ) · เอา WebSocket ออก กลับไปใช้ REST Bybit ทุก 1 วินาที แต่ยังอยู่บนแกน 0 (จอไม่หน่วงเหมือนเดิม) · เอา sprite แถบหัว 16-bit ออก (วาดเฉพาะส่วนที่เปลี่ยนด้วย text padding แทน) · stack งานเน็ต 16KB → 12KB · ปิดการเชื่อมต่อราคาก่อนดึง /mini ถ้าหน่วยความจำก้อนใหญ่สุด < 45KB หรือดึงรอบก่อนล้มเหลว (ลองใหม่ทุก 5 วินาที) · ปิดก่อนเช็กอัปเดตเสมอ · หน้าวินิจฉัยเปลี่ยนจาก ws เป็น price live/stale
- ระวัง: เครื่องที่ติด v0.5.0 อาจเช็กอัปเดตผ่าน WiFi ไม่ได้ → ต้องลงผ่าน USB 1 ครั้ง · อย่าเพิ่ม WebSocket กลับจนกว่าจะวัด heap บนบอร์ดจริง (ดูบรรทัดวินิจฉัยในหัวเมนู)

### Mini v0.5.1 — 2026-11-01 — Claude
- ไฟล์: mini/OIGoldProMini/OIGoldProMini.ino
- แก้อะไร: ผู้ใช้แจ้ง v0.5.0 กราฟไม่ขึ้น (ยังไม่รู้สาเหตุแน่ชัด สงสัยหน่วยความจำไม่พอเปิด TLS 2 ทาง) · ถ้าหน่วยความจำก้อนใหญ่สุด < 40KB ตอนจะดึง /mini → ปิด WebSocket 60 วินาที (ราคาใช้ REST) · เปิด WebSocket เฉพาะเมื่อ max alloc > 45KB · หน้าวินิจฉัยบนกราฟตอนไม่มีข้อมูล (WiFi, ผล /mini `miniErr`, สถานะ WebSocket, heap) + บรรทัดวินิจฉัยในหัวเมนู
- ระวัง: miniErr: 1 ยังไม่เคยดึง, 0 สำเร็จ, รหัส HTTP, -100 เชื่อมต่อไม่ได้, -200 JSON เสีย, -300 Worker แจ้ง error · รอรูปหน้าวินิจฉัยจากผู้ใช้

### Mini v0.5.0 — 2026-11-01 — Claude
- ไฟล์: mini/OIGoldProMini/OIGoldProMini.ino, mini/platformio.ini (เพิ่ม links2004/WebSockets), mini/HANDOFF.md
- แก้อะไร: แก้จอหน่วง — ย้ายงานเน็ตทั้งหมดไป FreeRTOS task บนแกน 0 (`netTask`), จอ/สัมผัสอยู่แกน 1 ไม่ต้องรอเน็ตอีก · ราคา Bybit เปลี่ยนจาก REST ทุก 1 วินาทีเป็น WebSocket `tickers.XAUUSDT` (REST สำรองเมื่อหลุด >8 วินาที) · วาดเฉพาะเมื่อข้อมูลเปลี่ยน (≤7 ครั้ง/วินาที) · แถบหัว/แถบสถานะวาดผ่าน sprite ไม่กระพริบ · ปุ่ม Refresh และเช็กอัปเดตในเมนูไม่ค้างจอแล้ว · fetchData → fetchMini (เรียกจากงานเน็ตเท่านั้น)
- ระวัง: ห้ามวาดจอหรือแก้ `D` จาก netTask · ตั้ง WiFi/OTA ต้อง pauseNet(true) ก่อน · คอมไพล์ด้วย Arduino IDE ต้องติดตั้งไลบรารี "WebSockets" (Markus Sattler) เพิ่ม · ยังไม่ได้ทดสอบบนบอร์ดจริง — ถ้าหน่วยความจำไม่พอ (เชื่อมต่อ TLS 2 ทางพร้อมกัน) จะเห็นราคาค้าง/ข้อมูลไม่มา

### Worker OI จาก CME — 2026-11-01 — Claude
- ไฟล์: gcw/src/index.js (poll → applyCmeOI, tvTradeDate, /opt เพิ่ม oiSrc), gcw/test.mjs
- แก้อะไร: อ่าน cme_oi.json (repo gold-oi-pro, อัปเดตทุกชั่วโมงจากเว็บ CME) ทุก 10 นาที ถ้าเป็นสัญญาเดียวกันและวันเทรดใหม่กว่า OI ของ TradingView → ใช้ OI ของ CME (โซนแอป, แจ้งเตือน, Mini, gmf itd ใช้ชุดเดียวกัน)
- ระวัง: oiT ที่แทนค่าตั้งเป็น 18:30 ชิคาโกของวันเทรด CME เพื่อให้แอปแปลงวันได้ตรง

### Worker แจ้งเตือนโซน — 2026-10-30 — Claude
- ไฟล์: gcw/src/index.js (alerts, evalAlerts, alertText)
- แก้อะไร: ราคาแจ้งเตือน Telegram/Push ไม่ตรงโซน — เดิมใช้แท่ง COMEX:GC1! ซึ่งแบบไม่ล็อกอิน TradingView ช้า 10 นาที เปลี่ยนเป็น BLACKBULL:GOLD.F (เรียลไทม์ สเกลเดียวกับกราฟแอป) · ข้อความบอกราคาที่แตะโซนจริง (ไส้แท่ง) และช่วงโซน แทนราคาปิดที่อาจอยู่นอกโซน
- ระวัง: ห้ามกลับไปใช้ GC1! สำหรับแจ้งเตือน

### Mini v0.4.4 — 2026-10-29 — ChatGPT
- ไฟล์: mini/OIGoldProMini/OIGoldProMini.ino
- แก้อะไร: หลังสัมผัสเปลี่ยนหน้าจากกราฟไป Settings ให้ออกจาก loop ทันที ป้องกันราคา/กราฟวาดทับเมนูในรอบเดียวกัน
- ระวัง: รอ CI Build และทดสอบบนบอร์ดจริง; ไม่แก้ Worker


### Mini v0.4.3 — 2026-10-29 — ChatGPT
- ไฟล์: mini/OIGoldProMini/OIGoldProMini.ino
- แก้อะไร: แก้ข้อผิดพลาดคอมไพล์ drawArc ของไอคอน Refresh โดยวาดส่วนโค้งด้วย drawLine แทน
- ระวัง: รอ GitHub Actions ยืนยันผล Build และทดสอบ OTA บนเครื่องจริง; ไม่แก้ Worker


### Mini v0.4.2 — 2026-10-29 — ChatGPT
- ไฟล์: mini/OIGoldProMini/OIGoldProMini.ino
- แก้อะไร: เพิ่มปุ่ม Refresh ข้าง Settings (รูปเฟืองแทน MENU) ในแถบล่าง; Refresh เรียก /mini และราคา Bybit ทันที แล้ววาดหน้าจอใหม่
- ระวัง: รอ GitHub Actions คอมไพล์และทดสอบ OTA บนเครื่องจริง; ไม่แก้ Worker


### Mini เอกสาร — 2026-10-29 — Claude
- ไฟล์: mini/HANDOFF.md (ใหม่)
- แก้อะไร: เอกสารส่งต่องานแบบละเอียด (ฮาร์ดแวร์ พิน API /mini สถาปัตยกรรม OTA ข้อห้าม งานค้าง prompt สำหรับ ChatGPT)
- ระวัง: ผู้พัฒนาใหม่อ่าน mini/HANDOFF.md ก่อนแก้ mini/ ทุกครั้ง

### Mini v0.4.1 — 2026-10-29 — Claude
- ไฟล์: mini/OIGoldProMini/OIGoldProMini.ino, mini/README.md
- แก้อะไร: MENU → SCREEN OFF (แตะจอ = เปิด) · AUTO OFF 4 โหมด (ไม่ปิด / ตลาดปิด ส. 05:00–จ. 05:00 / +00–07 / +22–07, แตะ = เปิด 5 นาที, key `ao`) · แจ้งเตือนเปิดจอ 60 วินาที · เมนูเป็น 2 คอลัมน์
- ระวัง: เป็นเวอร์ชันแรกที่ส่งผ่าน OTA (รอผู้ใช้ยืนยัน) · ห้ามใช้ max(uint32_t, millis()) — คนละชนิดบน ESP32 คอมไพล์ไม่ผ่าน

### Mini v0.4.0 — 2026-10-29 — Claude
- ไฟล์: mini/OIGoldProMini/OIGoldProMini.ino, .github/workflows/build-mini-firmware.yml
- แก้อะไร: อัปเดตผ่าน WiFi จาก GitHub — CI สร้าง mini/dist/firmware.bin + version.json · จอเช็กตอนเปิดและทุก 6 ชม. (ลูกศรทอง) · MENU → CHECK/UPDATE
- ระวัง: ต้องเพิ่ม FW_VER ทุกครั้งที่ออกเวอร์ชัน · ต้องใช้ partition Minimal SPIFFS (1.9MB APP with OTA) · ห้ามเปลี่ยน URL/ชื่อไฟล์ใน dist

### Mini v0.3.0 + Worker /mini — 2026-10-28 — Claude
- ไฟล์: mini/OIGoldProMini/OIGoldProMini.ino, mini/OIGoldProMini/logo.h (ใหม่), gcw/src/index.js, gcw/test.mjs
- แก้อะไร: ราคาสด Bybit XAUUSDT ทุก 1 วินาที + `off` จาก Worker (liveOffset) · ลากกราฟเลื่อน/แตะแกนราคา = กลับ · เว้นขวา 22% · โลโก้ + GC1 · ไอคอนเวลา/WiFi/แบตแบบ iPhone · พื้นหลังเข้ม #04060a · โซนเข้มขึ้น · /mini เพิ่ม `off`, `lt`
- ระวัง: แบตยังไม่มีวงจรวัด (IO35)

### Mini v0.2.0 + Worker /mini v2 — 2026-10-28 — Claude
- ไฟล์: mini/OIGoldProMini/OIGoldProMini.ino, gcw/src/index.js
- แก้อะไร: แท่งเทียน 1m/5m/15m/1h (`/mini?tf=`) · ซูม · OI/Volume ราย strike แบบแอป (`s`) · สีชุดแอป · เมนู · /mini เพิ่ม `b`, `bs`, `bt`, `s`, `v: 2`
- ระวัง: แก้สีให้ Call = เขียว / Put = แดง ตามแอป (v0.1 สลับกัน)

### Mini v0.1.0 + Worker /mini — 2026-10-28 — Claude
- ไฟล์: mini/ (ใหม่), gcw/src/index.js (/mini, maxPain, miniPayload), .github/workflows/build-mini-firmware.yml (ใหม่)
- แก้อะไร: เริ่มโปรเจกต์ OI Gold Pro Mini บน ESP32-2432S028 (ILI9341) — ตั้ง WiFi จากจอ, ราคา, เส้นระดับ, โซน, แจ้งเตือน LED/เสียง
- ระวัง: บอร์ดนี้เป็น ILI9341 ไม่ใช่ ST7789 · ค่าคาลิเบรตสัมผัส {291,3625,281,205,3806,3629,3834,192}

### Worker gc-yahoo — 2026-10-27 — Claude
- ไฟล์: gcw/src/index.js, gcw/src/push.js
- แก้อะไร: เลือกสัญญาตามวันไทย (OG รายเดือนวันหมดอายุ) ยืม OI เมื่อสัญญาไม่มี OI แจ้งเตือน Telegram + Web Push เลือกประเภทได้ endpoint /mini
- ระวัง: สัญญาหมดอายุ 12:30 เวลาชิคาโก (00:30 ไทย, 01:30 ไทยหลัง 1 พ.ย.)

# Stamp HOME (โซลาร์บ้าน): Hand off

อัปเดตล่าสุด: 2026-11-09 · เวอร์ชันแอป **v2.17** · เฟิร์มแวร์ ESP32 **1.0.1**

เอกสารนี้มีไว้ให้เซสชันใหม่ (หรือคนใหม่) ทำงานต่อได้ทันทีโดยไม่ต้องย้อนอ่านแชทเก่า
อ่านส่วนที่ 1 และ 2 ก่อนแก้อะไร

---

## 1. กติกาการทำงานกับเจ้าของ (สำคัญที่สุด)

- **ต้องถามก่อนสร้างหรืออัปเดตทุกครั้ง** เมื่อเจ้าของเสนอหรือถามเรื่องงาน ให้ตอบหรือเสนอแผนสั้นๆ แล้วรอคำว่า "ได้" หรือ "ทำเลย" ก่อนแก้โค้ดหรือ deploy
- **ห้ามใส่ secret ใดๆ ในแชท** (รหัสแอป, รหัส SmartESS, Tuya secret, Cloudflare token)
- เจ้าของสื่อสารเป็นภาษาไทย ใช้มือถือ (iPhone) ดูแอปเป็นหลัก และมักส่งภาพหน้าจอมา
- **ห้ามใช้ค่ากระแสหรือ % จาก BMS ในการคำนวณ % แบต** เจ้าของยืนยันชัดว่าค่า BMS ไม่ตรง (v2.7 เคยใช้ แล้วต้องย้อนกลับใน v2.8) % แบตต้องนับจากแอมป์ที่ชาร์จเข้า/จ่ายออกของอินเวอร์เตอร์ + MPPT เท่านั้น ค่า BMS ใช้แสดงผลอย่างเดียว
- ทุกครั้งที่ปล่อยเวอร์ชันใหม่ ให้เพิ่ม `APP_VERSION` ใน `src/page.js` (ป้ายเวอร์ชันมุมบนของแอป)
- ข้อความ commit ต้องลงท้ายด้วยบรรทัด attribution ตามที่ระบบกำหนด

## 2. ภาพรวมระบบ

### ฮาร์ดแวร์ที่บ้าน
| อุปกรณ์ | รายละเอียด | อ่านค่าทาง |
|---|---|---|
| อินเวอร์เตอร์ไฮบริด | HANDURO 6.2 kW 48 V, โหมด SBU, แผงชุด 1 = 8 แผง | คลาวด์ SmartESS / DessMonitor (API ที่ถอดมาเอง ไม่เป็นทางการ) |
| MPPT | HM-4096, แผงชุด 2 = 4 แผง | Tuya Cloud OpenAPI (data center สิงคโปร์) |
| แบตลูก 1 | LiFePO4 200 Ah **มือสอง ใช้ได้จริงประมาณ 120 Ah** · BMS MAC `A5:C2:39:41:66:FA` | ESP32 → BLE (JBD/Xiaoxiang) |
| แบตลูก 2 | LiFePO4 314 Ah ใหม่ ใช้ช่วง 10%→90% = **251.2 Ah** · BMS MAC `A4:C1:37:25:E5:E2` | ESP32 → BLE |
| ESP32-WROOM-32 | ตัวรีเลย์ BMS อยู่ห่างแบตประมาณ 4 m ไฟแดง = ไฟเลี้ยง, ไฟสีฟ้า (GPIO2) ติดค้าง = เซิร์ฟเวอร์รับรายงานล่าสุดแล้ว | Wi-Fi → Worker |

- อินเวอร์เตอร์โหมด SBU: แบตลงถึง 50 V จะสลับบ้านไปใช้ไฟการไฟฟ้า และกลับมาใช้แบต/โซล่าเมื่อแบตกลับขึ้นถึงประมาณ 53 V
- ลูก 200 Ah รับกระแสน้อยกว่าสัดส่วน เคยแนะนำให้ตรวจสายและขั้ว (ยังไม่ได้รับคำตอบ)

### ซอฟต์แวร์
- **Repo:** `OI-GOLD-PRO/gold-oi-trade` โฟลเดอร์ `solar/` (repo เดียวกับงาน OI/เทรดของเจ้าของ แต่ **คนละ Worker คนละฐานข้อมูล** ห้ามแตะโฟลเดอร์อื่นโดยไม่ถาม)
- **แอป:** https://solar-monitor.oigoldpro.workers.dev (ต้องใส่รหัส `SOLAR_APP_KEY` ครั้งแรก เก็บใน localStorage ชื่อ `solar_key`)
- **Cloudflare Worker** `solar-monitor` + **D1** `solar-monitor-db` · cron ทุก 1 นาที
- **Deploy อัตโนมัติ** ผ่าน GitHub Actions `.github/workflows/deploy-solar.yml` ทุกครั้งที่ push ไฟล์ใน `solar/**` (ยกเว้น `solar/firmware/**`) เข้า `main`
  - ขั้นตอน: unit test (`test/run.mjs`) → สร้าง D1 ถ้ายังไม่มี → `schema.sql` → migrate คอลัมน์ (ลูป `ALTER TABLE ... ADD COLUMN`) → `wrangler deploy` → อัปโหลด secrets
  - **เพิ่มคอลัมน์ใหม่ใน `samples`** ต้องแก้ทั้ง `schema.sql` และรายการในขั้น "Migrate columns" ของ workflow
- **เฟิร์มแวร์ ESP32** build ด้วย `.github/workflows/build-bms-firmware.yml` (PlatformIO espressif32@6.9.0, NimBLE-Arduino 1.4.3, WiFiManager 2.0.17) แล้วบอตจะ commit `solar/firmware/dist/factory.bin` กลับเข้า main เอง (commit "Firmware build [skip ci]") **ก่อน push ให้ `git pull --rebase origin main` ทุกครั้ง** เพราะ remote มักนำหน้าจาก commit ของบอต
- ติดตั้งเฟิร์มแวร์ผ่านเว็บ: `<แอป>/flash` (ESP Web Tools, ใช้ Chrome/Edge บน PC)

### Secrets (อยู่ใน GitHub repo secrets, workflow ส่งขึ้น Cloudflare ให้)
`DESS_USER`, `DESS_PASSWORD`, `TUYA_CLIENT_ID`, `TUYA_SECRET`, `SOLAR_APP_KEY` (ใน Worker ชื่อ `APP_KEY`), `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`
ส่วน VAPID key ของ Web Push ไม่ใช่ secret ใน GitHub: Worker สร้างเองครั้งแรกแล้วเก็บใน kv `vapid`
> ⚠️ รหัสแอปเคยหลุดในภาพหน้าจอ แนะนำเจ้าของให้เปลี่ยน `SOLAR_APP_KEY` แล้ว (ยังไม่ยืนยันว่าเปลี่ยนแล้ว) ถ้าเปลี่ยน ESP32 ต้องตั้งค่ารหัสใหม่ในพอร์ทัลด้วย

### ค่าใน `wrangler.toml` [vars]
| ตัวแปร | ค่า | ความหมาย |
|---|---|---|
| `USABLE_AH` | 371.2 | 120 + 314×80% |
| `FULL_SOC` | 90 | % ภายในที่ถือว่าเต็ม (~54.5 V) |
| `CUTOFF_V` / `CUTOFF_SOC` | 50 / 10 | แรงดันตัด = % ภายใน 10 |
| `NOMINAL_V` | 51.2 | ใช้แทนเมื่อไม่มีค่าแรงดัน |
| `TUYA_REGION` / `TUYA_DEVICE_ID` | sg / `a388c65aef93d7a41bfjah` | |
| `MPPT_EVERY_MIN` | 2 | อ่าน Tuya ทุก 2 นาที (โควตาฟรีประมาณ 26k call/เดือน) และหยุดอ่านกลางคืนจนถึง 05:00 |
| `BMS_LABELS` | `MAC=ชื่อ,...` | ชื่อและลำดับการ์ดแบต |

## 3. โครงสร้างไฟล์ (`solar/`)

| ไฟล์ | หน้าที่ |
|---|---|
| `src/index.js` | Worker หลัก: `poll()` (cron), API ทั้งหมด, งานซ่อมข้อมูลแบบครั้งเดียว, `rebaseSoc`, `saveDay`, `remainBreakdown`, BMS endpoints |
| `src/dess.js` | ไคลเอนต์ SmartESS (ลายเซ็น SHA1) → `battV, chgA, disA, pvW, loadW, gridV, mode, soc, pvTodayKwh` |
| `src/tuya.js` | ไคลเอนต์ Tuya (ลายเซ็น HMAC-SHA256) → `battA, pvW, battV, todayKwh, tempC` |
| `src/calc.js` | `netBatteryA`, `gridW` (ประมาณไฟการไฟฟ้า), `summarizeDay`, `timeToCutoff` |
| `src/soc.js` | ตัวนับ % แบต (`stepSoc`, `SOC_SCALE`) |
| `src/clean.js` | กรองค่าขยะ/สไปค์จากอินเวอร์เตอร์ (`sanitizeLive`, `despike`, `cleanHistory`, `LIMITS`) |
| `src/bms.js` | ถอดเฟรม JBD (เซลล์ mV, balancing bitmask, อุณหภูมิ, FET, protection bits) |
| `src/push.js` | Web Push ด้วย WebCrypto ล้วน (VAPID ES256 + aes128gcm), `batteryEvent`, `morningEvent`, `notifyBattery`, `SW_JS` |
| `src/util.js` | `localDate`/`dayRange` (วันโซล่า 05:00→05:00), `kvGet`/`kvSet` (JSON), `validBattV` (40–62 V) |
| `src/page.js` | หน้าเว็บทั้งหมด (HTML+CSS+JS ใน template string เดียว) |
| `src/flash.js` | หน้า `/flash` + manifest ของ ESP Web Tools (`FW_VERSION`) |
| `src/icon.js` | ไอคอน PNG base64 |
| `schema.sql` | ตาราง `samples`, `kv`, `daily`, `bms` |
| `firmware/src/main.cpp` | ESP32 รีเลย์ BMS |
| `test/*.mjs` | เทสต์ทั้งหมด (ดูส่วนที่ 7) |

> ⚠️ **กับดักใน `page.js`:** JS ของหน้าอยู่ใน template literal ถ้าต้องการ `\'` ในผลลัพธ์ต้องเขียน `\\'` ในซอร์ส เช่น `onclick="openPack(\\'MAC\\')"` หลังแก้ ให้ตรวจว่าสคริปต์ยัง parse ได้ (ดูส่วนที่ 7)

## 4. ตรรกะสำคัญ

### 4.1 วันโซล่า
1 วัน = 05:00 ถึง 05:00 (Asia/Bangkok) ใช้ทั้งในตาราง `daily` และกราฟ `localDate()` คืนค่าวันโซล่า ไม่ใช่วันปฏิทิน

### 4.2 % แบต (การนับ Ah ล้วน ตั้งแต่ v2.12)
- สเกลภายใน: **10 = หมด (50 V)**, **90 = เต็ม (~54.5 V)**
- % ที่แสดงบนแอป = `(soc − 10) / 80 × 100`
- ความจุของตัวนับ = `USABLE_AH / 0.8` = **464** (ทำให้ 80 จุดของสเกล = 371.2 Ah)
- กระแสสุทธิ = `mppt_a + inv_chg_a − inv_dis_a` (**ไม่ใช้ BMS**)
- รีเซ็ตเป็น **10** เมื่อแรงดัน ≤ 50 V (src `empty`) · ยึดเป็น **90** เมื่อ ≥ 54.5 V ค้าง 5 นาทีระหว่างชาร์จ (src `full`) · เพดาน 90, พื้น 10 · ไม่มีการปรับตามแรงดันตอนพัก
- Ah ที่เหลือข้ามวัน (carry-over) ถูกยกไปวันถัดไป · การ์ดหลักแสดงที่มา: ยกมา + ชาร์จเข้า − ใช้ไป (`remainBreakdown`, `#remainbox`)
- `rebaseSoc(env, ts)` = เล่นตัวนับใหม่ตั้งแต่ครั้งล่าสุดที่แบตแตะจุดตัดใน 24 ชม. (ถ้าไม่มี เริ่มจาก 05:00) ใช้หลังซ่อมข้อมูลทุกครั้ง
- ⚠️ การนับ Ah ล้วนสะสมความคลาดเคลื่อนได้ เจ้าของรับทราบแล้วและจะแจ้งถ้าเห็นเพี้ยน

### 4.3 ไฟการไฟฟ้า (ค่าประมาณ)
SmartESS ไม่มีค่าวัตต์ของกริด จึงคำนวณจาก `gridW = load_w + (inv_chg_a − inv_dis_a)·V − inv_pv_w` (ถ้า `inv_mode` เป็น Invert/Battery → 0, ต่ำกว่า 50 W → 0)
`inv_mode` "Line Mode" = ใช้ไฟการไฟฟ้า (คาดว่าเป็นแบบนี้ แต่ยังไม่ยืนยันกับข้อมูลจริง), "Invert Mode" = แบต/โซล่า

### 4.4 กรองค่าขยะ (v2.10, v2.13)
- แรงดันแบตนอกช่วง 40–62 V → ทิ้ง (เคยได้ 1.4 V แล้วตัวนับรีเซ็ตเป็นหมด)
- `LIMITS`: กระแส inv 0–130 A, MPPT −2–90 A, PV inv 0–7000 W, PV MPPT 0–5000 W, load 0–8000 W ค่าที่เกินช่วงถูกแทนด้วยค่านาทีก่อนหน้า (เคยได้ 1,900 A ทำให้ไฟกริดพุ่งเป็น 101 kW)
- ทุกค่าเป็นศูนย์พร้อมกันหลังนาทีที่ยังใช้งานอยู่ → ถือค่าเดิมไว้ 1 นาที (kv `zero_pending`) ถ้านาทีถัดไปยังศูนย์อีก ถือว่าเป็นของจริง
- หลัง insert แล้ว `despike` 6 แถวล่าสุด: สไปค์ 1–3 นาทีถูกแก้ด้วยค่าเฉลี่ยของนาทีข้างเคียง ถ้ามีการแก้ จะเรียก `rebaseSoc`
- ค่าดิบที่ถูกกรองถูกเขียนทับ ไม่ได้เก็บไว้ · โหลดที่ขึ้นลงจริงแค่ 1–3 นาทีอาจโดนกรองไปด้วย

### 4.5 ลำดับใน `poll()` (ทุก 1 นาที)
1. ดึง SmartESS + Tuya (Tuya ทุก 2 นาที, หยุดกลางคืน)
2. สร้าง `row` (แรงดันผ่าน `validBattV`)
3. งานซ่อมแบบครั้งเดียว (ถ้ายังไม่เคยทำ) — ดูส่วนที่ 6
4. `sanitizeLive`
5. `bms_a` = กระแส BMS ปัจจุบัน (เก็บไว้ดูเฉยๆ)
6. `stepSoc` → `soc_calc` และตรวจเหตุการณ์ แบตหมด/เต็ม → Web Push
7. INSERT แล้ว despike แถวล่าสุด
8. ตรวจแจ้งเตือนเช้า (`morningEvent`)
9. เก็บ `last_raw` · `saveDay` ทุก 10 นาที, ปิดวันเมื่อวานตอน 05:05 · ลบ samples/bms ที่เก่ากว่า 120 วัน ตอน 03:00 (ตาราง `daily` เก็บถาวร)

### 4.6 BMS ผ่าน ESP32 (v2.6+)
- ESP32 ต่อ BLE กับ BMS ทั้งสองตัว แล้วส่งเฟรมดิบเป็น hex ไป `POST /api/bms` (header `x-key`) Worker เป็นฝ่ายถอดรหัส
- ตอบกลับมีฟิลด์ `pause` (วินาที) เพื่อสั่งพัก BLE (`/api/bms/pause?min=` ใช้ตอนเจ้าของอยากเปิดแอป Xiaoxiang ในมือถือ)
- การ์ดแบตแต่ละลูก แตะแล้วเปิดหน้ารายละเอียด (v2.9): แรงดันทุกเซลล์พร้อมแถบ 2.80–3.65 V, สี ≥3.60 / ≤3.00 V, ป้าย balancing, อุณหภูมิ, MOS, protection · ปัดขวาหรือใช้ท่าย้อนกลับเพื่อปิด (v2.14)
- **บั๊กเฟิร์มแวร์ที่แก้แล้ว (1.0.1):** `WiFi.setSleep(false)` ก่อนเริ่ม NimBLE ทำให้ abort ใน `coex_core_enable` (บูตวนไม่จบ) ต้องเปิด modem sleep ไว้เสมอ
- **พอร์ทัลตั้งค่า (WiFiManager):** hotspot `StampHOME-BMS` ต้องใช้เมนู "Configure WiFi" แล้วกด Save (หน้า "Setup" ไม่บันทึก) ใส่ลิงก์แอป + รหัสแอป · กดปุ่ม BOOT ค้าง 3 วินาทีเพื่อล้างค่า

### 4.7 Web Push (v2.15, v2.16)
- การ์ด "แจ้งเตือน" ในหน้า "วันนี้": เปิด/ปิด และส่งทดสอบ · iPhone ต้อง "เพิ่มไปยังหน้าจอโฮม" ก่อน (iOS 16.4+) · Android ใช้ Chrome
- เหตุการณ์:
  - 🪫 **แบตหมด** — ตัวนับรีเซ็ตเป็น 10 เพราะแตะ 50 V
  - 🔋 **แบตเต็ม** — % แอปถึง 100
  - แต่ละแบบห่างกันอย่างน้อย 3 ชม. (kv `push_last`)
  - ☀️ **เช้าเลิกใช้ไฟการไฟฟ้า** — ช่วง 05:00–13:00 ปิดกริดติดกัน 5 นาที หลังจากเปิดอย่างน้อย 3 ใน 15 นาทีก่อนหน้า · ข้อความมีเวลาที่สลับ, % แบต, kWh ไฟการไฟฟ้าตั้งแต่ 18:00 เมื่อวาน · วันละครั้ง (kv `push_morning`)
- รายชื่อเครื่องที่สมัครเก็บใน kv `push_subs` (สูงสุด 10 เครื่อง, ตอบ 404/410 ถูกลบอัตโนมัติ)
- ⚠️ ยังไม่เคยเห็นแจ้งเตือนเด้งบนมือถือจริงจากฝั่งนี้ ต้องให้เจ้าของกด "ส่งทดสอบ" ยืนยัน และแจ้งเตือนเช้ายังไม่เคยทำงานกับข้อมูลจริง (เพิ่งปล่อย 2026-11-09)

## 5. API (ต้องมี `x-key` หรือ `?key=` ยกเว้นหน้าเว็บ/ไอคอน/manifest/sw.js)
| Path | ใช้ทำอะไร |
|---|---|
| `GET /api/now` | ค่าล่าสุด + สรุปวันนี้ + `remain` + BMS + config |
| `GET /api/day?date=YYYY-MM-DD` | ข้อมูลรายนาทีของวันโซล่า |
| `GET /api/history?days=` / `/api/month?m=YYYY-MM` / `/api/range?from=&to=` | ประวัติ (ช่วงไม่เกิน 366 วัน) |
| `GET /api/poll` | บังคับดึงค่าทันที (ปุ่ม ↻) |
| `GET /api/debug` | ค่าดิบล่าสุดจาก SmartESS/Tuya (`last_raw`) ใช้ตรวจปัญหา |
| `POST /api/bms`, `GET /api/bms/pause?min=` | ESP32 รายงาน / สั่งพัก BLE |
| `GET /api/push/key`, `POST /api/push/sub`, `POST /api/push/unsub`, `GET /api/push/test` | Web Push |
| `/sw.js`, `/manifest.json`, `/icon.png`, `/icon-512.png`, `/flash`, `/flash/manifest.json` | PWA / ติดตั้งเฟิร์มแวร์ |

## 6. kv keys (ตาราง `kv`, ค่าเป็น JSON)
- **สถานะ:** `soc_state` (ตัวนับ %), `zero_pending`, `clean_last`, `last_raw`, `mppt_last`, `bms_last`, `bms_device`, `bms_pause_until`, `soc_rebase_info`
- **การเชื่อมต่อ:** `dess_auth`, `dess_device`, `tuya_token`
- **Push:** `vapid`, `push_subs`, `push_last`, `push_morning`
- **ธงงานซ่อมครั้งเดียว** (ลบ key เพื่อให้รันซ้ำในรอบ cron ถัดไป): `soc_rebase_v1`, `bad_v_repair_v1`, `soc_pure_v1`, `daily_recalc_grid_v1`, `spike_repair_v1`, `dess_stale_repair_v1`
- `dess_stale_at` = เวลาที่ตรวจพบค่าอินเวอร์เตอร์ค้างล่าสุด
- ถ้าต้องการซ่อมข้อมูลแบบใหม่ ให้เพิ่มบล็อกครั้งเดียวพร้อม key ใหม่ (เช่น `xxx_v1`) ตามแบบเดิมใน `poll()`

## 7. การทดสอบก่อน push
```bash
cd solar
for t in run e2e bms-e2e glitch spike spike-worker push stale; do node test/$t.mjs >/dev/null 2>&1 && echo "$t ok" || echo "$t FAIL"; done
# ตรวจว่า JS ในหน้าเว็บ parse ได้ (กันพลาดเรื่อง escape ใน template)
node -e "import('./src/page.js').then(m=>{const h=Object.values(m).find(x=>typeof x==='string'&&x.includes('<script'));new Function(h.match(/<script>([\s\S]*?)<\/script>/)[1]);console.log('page ok')})"
```
- เทสต์ใช้ `node:sqlite` จำลอง D1 (Node 22+, จะมี ExperimentalWarning ซึ่งไม่เป็นไร)
- CI รันแค่ `test/run.mjs` ส่วนที่เหลือต้องรันเองก่อน push
- เครื่องในเซสชัน cloud **เข้าโดเมนแอป (workers.dev) ไม่ได้** (proxy บล็อก) ตรวจผลจริงได้จากภาพหน้าจอของเจ้าของ หรือจาก `gh run list --workflow deploy-solar.yml`

### ตรวจระบบจากฝั่ง cloud
Actions → **Solar check** (`.github/workflows/solar-check.yml`, อ่านอย่างเดียว) แสดงแถวล่าสุดใน D1, error 24 ชม., `dess_device`, `bms_last` และรายชื่ออุปกรณ์ใน SmartESS อ่านผลผ่าน annotations:
`gh workflow run solar-check.yml --ref main` แล้ว `gh api repos/OI-GOLD-PRO/gold-oi-trade/check-runs/<job id>/annotations`
(ดาวน์โหลด job log ตรงๆ จะได้ 403)

## 8. ขั้นตอนปล่อยเวอร์ชัน
1. ได้รับอนุมัติจากเจ้าของ
2. แก้โค้ด → เพิ่ม `APP_VERSION` → รันเทสต์ทั้งหมด
3. `git add solar && git commit` (ลงท้ายด้วย attribution) → `git pull --rebase origin main` → `git push origin HEAD:main`
4. รอประมาณ 40 วินาที → `gh run list --workflow deploy-solar.yml --limit 1` ต้องได้ `success`
5. สรุปให้เจ้าของเป็นภาษาไทยแบบสั้นๆ: เปลี่ยนอะไร, ตรวจอะไรแล้ว/ยังไม่ได้ตรวจ, ข้อควรรู้

## 9. ประวัติเวอร์ชัน (ย่อ)
| เวอร์ชัน | สิ่งที่เปลี่ยน |
|---|---|
| ≤v1.9 | แอปพื้นฐาน, แผนภาพการไหลของพลังงาน, DC bus, หยุดอ่าน MPPT ตอนกลางคืน |
| v2.0–2.3 | % แบตเริ่มนับจากจุดตัด, % ใช้งานจริง, ปุ่มรีเฟรช |
| v2.4–2.5 | ประมาณไฟการไฟฟ้า (กราฟ/kWh/ช่วงเวลา/ปฏิทิน), เลือกช่วงวันในประวัติ |
| v2.6 | ESP32 รีเลย์ BMS, การ์ดแบตแยกลูก, `/flash` · เฟิร์มแวร์ 1.0.1 แก้บูตวน |
| v2.7 → v2.8 | ลองใช้กระแส BMS แล้ว **ย้อนกลับ** ตามที่เจ้าของสั่ง |
| v2.9 | หน้ารายละเอียดแบต (เซลล์ทุกตัว + แถบ) |
| v2.10 | ทิ้งแรงดันที่เป็นไปไม่ได้ + ซ่อมย้อนหลัง |
| v2.11 | ความจุใช้งานจริง 371.2 Ah, 0%=50 V / 100%=เต็ม |
| v2.12 | นับ Ah ล้วน + ยก Ah ข้ามวัน + แสดงที่มา |
| v2.13 | กรองสไปค์/ค่าศูนย์ + ซ่อมย้อนหลัง 3 วัน |
| v2.14 | ปัดขวาเพื่อปิดหน้ารายละเอียด |
| v2.15 | Web Push แบตหมด/เต็ม |
| v2.16 | แจ้งเตือนเช้าเมื่อเลิกใช้ไฟการไฟฟ้า |
| v2.17 | เปลี่ยนดองเกิล Wi-Fi อินเวอร์เตอร์ → SmartESS ได้ sn ใหม่ แอปหาเครื่องใหม่เอง, ตรวจค่าค้าง 20 นาที, ล้างช่วงค่าค้างย้อนหลัง (`dess_stale_repair_v1`) |

## 10. เรื่องค้าง / ไอเดีย (**ห้ามเริ่มโดยไม่ถามเจ้าของ**)
- ยืนยันว่า Web Push เด้งจริงบน iPhone/Android และแจ้งเตือนเช้าทำงานจริง
- ยืนยันว่า `inv_mode` ตอนใช้ไฟการไฟฟ้าเป็น "Line Mode" จริง (ดู `/api/debug` ตอนกลางคืน) ถ้าข้อความไม่ตรง ต้องแก้ regex ใน `gridW` และ `morningEvent`
- ติดตามว่าตัวนับ Ah ล้วนเพี้ยนสะสมหรือไม่ (ตอนนี้ยึดกลับเฉพาะที่จุดหมด/เต็มเท่านั้น)
- ทำให้พอร์ทัลเฟิร์มแวร์บันทึกได้ในขั้นตอนเดียว
- การ์ด BMS แบบ placeholder ตอนที่ ESP32 ออฟไลน์
- เปลี่ยน `SOLAR_APP_KEY` (เคยหลุดในภาพหน้าจอ)
- ตรวจสาย/ขั้วลูก 200 Ah (รับกระแสน้อย)
- `README.md` ยังเขียนว่า "ทุก 5 นาที" ซึ่งล้าสมัยแล้ว (จริงคือทุก 1 นาที)

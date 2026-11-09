# 🌏 OI Session Fade (oi ss) — HANDOFF

อัปเดต 2026-11-09 · ผู้เขียน Claude · อ่านไฟล์นี้ก่อนแก้ส่วนใดก็ตามของ oi ss (แอป / Worker / EA)

ระบบนี้มี 3 ส่วนที่ต้องตรงกันเสมอ:

| ส่วน | repo / ไฟล์ | เวอร์ชันล่าสุด | หน้าที่ |
|---|---|---|---|
| แอป OI Gold Pro | `gold-oi-pro` → `osf.js`, `siglog.js`, `index.html` | V4.9.100 | วาดโซน/ไม้/สถิติ, แบ็กเทสย้อนหลัง, NY เบรก (คิดเอง), บันทึก signal_log |
| Worker กลาง | `gold-oi-trade` → `gcw/src/osf.js`, `gcw/src/index.js` (`/osf/v1`) | deploy 2026-11-09 (commit 686461b) | คิดไม้ **สวนกำแพง (AM/London)** ทุกนาทีจากแท่ง M1 ที่ปิดแล้ว → ส่ง plans ให้ EA และแอป |
| EA MT5 | `gold-oi-trade` → `ea/OI_Session_Fade.mq5` | v1.55 (ยังไม่ได้ compile ใน sandbox) | วาง LIMIT ตาม plans ของ Worker, เทรด NY เบรกเอง |

กฎทำงานร่วม: แก้แล้วจด CHANGELOG ของ repo นั้น (บนสุด) · แก้กติกาเทรดต้องแก้ครบทั้ง 3 ส่วนและเทียบผลกับแบ็กเทส · ผู้ใช้ต้องการให้ **ถามก่อนสร้าง/อัปเดต**

---

## 1. กติกาเทรด (สเปกหลัก — ทุกส่วนต้องตรงกับนี้)

### 1.1 เวลาและเส้นของวัน
- เวลาไทย UTC+7 ตายตัว · **วันเทรดเริ่ม 06:00 ไทย** (= 23:00 UTC วันก่อน) `osfDay(t) = floor((t+3600)/86400)*86400 − 3600`
- OI = สัญญาออปชันทองที่หมดอายุวันนั้น (Worker `/opt` / DO `main`)
- ราคาอ้างอิง = open ของแท่ง M1 แรก ≥ 06:00 ในสเกล GC
- เอา strike ภายใน **±60$** → **Call OI top 3 + Put OI top 3** (ซ้ำนับครั้งเดียว, ≤ 6 เส้น) **ล็อกทั้งวัน**
- เกรด A = strike อยู่ใน top 3 volume Call หรือ top 3 volume Put (สด) · ย้อนหลังไม่มี volume = B ทั้งหมด
- side ของเส้น = 'C' ถ้าอยู่ใน top Call ไม่งั้น 'P'
- ราคาโบรก = strike − offset (offset = Gold.F − ราคาโบรก, มัธยฐาน 5 นาทีล่าสุด)

### 1.2 ช่วงตลาด (`SESS`)
| id | เวลาไทย | half (โซน ±) | ไม้จริง |
|---|---|---|---|
| AM Asia เช้า | 06:00–10:00 | 2.0 | แตะครั้งที่ 1–2 · เกรด A ถึงครั้งที่ 3 · กรองพุ่ง 3×ATR |
| AL Asia สาย | 10:00–14:00 | 1.0 | ไม่มี (บันทึกเท่านั้น) |
| LDN London | 14:00–19:30 | 1.5 | แตะครั้งที่ 1 เท่านั้น |
| NY | 19:30–01:30 | 1.5 | ไม่มีสวนกำแพง (ใช้ NY เบรก ข้อ 1.5) |

### 1.3 สวนกำแพง — ตั้งรอ / แตะ (ต่อเส้น, ทุกแท่ง M1 ที่ปิด)
- เริ่มช่วงใหม่ → รีเซ็ต counter ทุกเส้น `{arm:0, k:0}`
- ถ้า `arm != 0` และแท่งแตะโซน (`low ≤ hi && high ≥ lo`) → `k++`, `arm = 0`, สร้าง event (ถ้า `k ≤ 4` และไม่ติดข่าว)
- ไม่งั้น `close > hi+3` → `arm = +1` (รอ BUY) · `close < lo−3` → `arm = −1` (รอ SELL)
- counter นับรวมทุกทิศต่อเส้นต่อช่วง (เช่น BUY โดน SL ทะลุลง แล้วเด้งกลับมาแตะจากล่าง = SELL ครั้งที่ 2 → AM เป็นไม้จริง, LDN ไม่)
- ไม้จริง = `k ≤ 4 && eligible && !fast && !blocked` · eligible: AM `k ≤ 2 || (A && k ≤ 3)` · LDN `k == 1`
- ข่าว: เวลาแตะอยู่ใน [ข่าว −30 นาที, ข่าว +90 นาที] (USD impact H) → ข้าม แต่ยังนับ k

### 1.4 กรองพุ่ง (AM เท่านั้น)
- `ATR[i]` = ค่าเฉลี่ย True Range (ใช้ prev close) ของแท่ง i−60 … i−1
- `mv = (close[i−1] − close[i−6]) × (−dir) / ATR[i]` (i = แท่งที่แตะ) · `mv > 3` → ไม่ใช่ไม้จริง (fast)
- ATR ต้องใช้ **60 แท่งที่ตลาดเปิดจริงล่าสุด ข้ามช่วงพัก 05:00–06:00 และเสาร์-อาทิตย์** (วันจันทร์ย้อนไปแท่งวันศุกร์) — ดูข้อ 4.1

### 1.5 สวนกำแพง — จุดเข้า / SL / TP
- BUY: entry = `hi` (ขอบบน) · SL = `lo − 3` → R = 2·half + 3 (AM 7$, LDN 6$)
- SELL: entry = `lo` · SL = `hi + 3`
- TP = entry ± RR × R · ถือจน SL หรือ TP (ไม่มีปิดตามเวลา/ก่อนข่าว) · แท่งเข้าเช็ก SL อย่างเดียว · SL+TP แท่งเดียวกัน = SL
- คำสั่งจริง = **LIMIT รอที่ขอบใกล้** ตั้งแต่เส้นอยู่ในสถานะรอ · BUY LIMIT = `hi + spread` (fill ตอน Bid แตะ hi)

### 1.6 NY เบรก (ไม้จริง)
- M5 (นาฬิกา) ที่ปิดในช่วง 19:30–23:00 · แท่ง M5 แรกของช่วงใช้แค่เก็บ prev · ต้องเข้าก่อน 23:00
- โซน ±1.5 ของเส้นชุดเดียวกับข้อ 1.1
- BUY: `closeM5 > hi + 2 && prevM5 ≤ hi` · SELL: `closeM5 < lo − 2 && prevM5 ≥ lo`
- 1 ครั้ง/เส้น/วัน (ติดข่าวก็นับว่าใช้แล้ว) · ข่าว −30/+90 ข้าม
- เข้า market ทันทีแท่งถัดไป · SL = ขอบอีกฝั่ง (BUY `lo` / SELL `hi`) ขั้นต่ำ 1$ · **TP RR 1 ตายตัว** · TP นับตั้งแต่แท่งแรกหลังเข้า
- ตัวแปร SL กลาง (SL = เส้น) บันทึกไว้เทียบเท่านั้น

### 1.7 ซ้อนไม้
- แบ็กเทส/แอป เปิดซ้อนได้ไม่จำกัด (EA `MaxSameDir = 0`)

---

## 2. แบ็กเทสอ้างอิง (20 วันทำการ 12 ต.ค.–6 พ.ย. 2026, M1 โบรก, หักสเปรด 0.3$/ไม้, 1 oz)

| ส่วน | ไม้ | RR1 | RR1.6 | RR5 |
|---|---|---|---|---|
| สวนกำแพง AM | 32 | +88$ | +112$ | +186$ |
| สวนกำแพง LDN | 19 | +48$ | +52$ | +132$ |
| รวมสวนกำแพง | 51 | +137$ ชนะ 73% PF 2.41 DD 23$ | +164$ PF 2.13 DD 32$ | +319$ PF 2.35 DD 69$ |
| NY เบรก (SL ขอบ) | 18 | +62$ ชนะ 72% PF 2.50 DD 14$ | +44$ | −16$ |
| **รวม (NY ใช้ RR1)** | 69 | +198$ | +226$ | **+380$** |

- NY เบรก: เส้นหลอกได้ใกล้เคียง (RR1 +47$) → กำไรส่วนใหญ่มาจากเทรนด์ช่วง NY · ระยะ SL NY ค่ากลาง 7.4$ (5.3–14.5)
- ทดสอบแล้วไม่ดี: OI อันดับ 4–10, หยุดเทรดรายวัน, รอ 30 นาทีหลัง NY เปิด
- น่าสนใจ (ตัวอย่างน้อย): ราคาเข้าใต้ gmf flip RR1 ชนะ 94% (16 ไม้), ใช้ EM < 0.5 ดีกว่า
- Node harness ใน sandbox: `/home/claude/work` (osf_test*.cjs, bo_test.cjs, iv/gx/fp_test.cjs, xau_m1_th.csv, oi_daily.csv) — ไม่อยู่ใน repo · ผล JS ตรงกับ Python (สวนกำแพง 51 ไม้ RR1 +136.7$, NY 18 ไม้ RR1 +61.5$)

**ที่ผู้ใช้ตกลงใช้จริง:** AM และ London = ไม้เดียว **RR 5** · NY เบรก = **RR 1** SL ขอบอีกฝั่ง · ข่าว −30/+90 · ซ้อนไม้ไม่จำกัด

---

## 3. Worker `/osf/v1` (gcw)

- เขียนโดย Codex (2026-11-09 commit 36ef0f4) · Claude แก้ ATR warm-up (686461b) · deploy อัตโนมัติด้วย `.github/workflows/deploy-gcw.yml` เมื่อ push `gcw/**` (รัน `node gcw/test.mjs` ก่อน)
- DO `OptState` ชื่อ `osf-v1` · cron ทุกนาทีเรียก `/osf/v1?view=ea` ให้ state เดินหน้า
- แท่ง = M1 XAUUSDT perp รวม 3 แหล่ง (Bybit/Bitget/Binance median, ใช้แท่งที่มี ≥ 2 แหล่ง) + `basis` (Gold.F − mix, คิดครั้งเดียวตอนสร้าง book) → สเกล GC · ใช้เฉพาะเวลาที่ `osfOpen` (ตลาด CME เปิด: ปิดศุกร์ 17:00 ET–อาทิตย์ 18:00 ET และทุกวัน 17:00–18:00 ET)
- `book` ต่อวัน: `{day, basis, root, expiry, levels, last, session, counters, bars, events, next}` · ถ้าแท่งขาดช่วง → ไม่เดินต่อ (รอบหน้าลองใหม่)
- ข่าว: `news.json` จาก gold-oi-pro (USD, i = H) รีเฟรชทุก 10 นาที · ข่าวเก่ากว่า 1 ชม. → `ready = 0`
- `prepareOsf` คำนวณ `next.plans` สำหรับแท่งถัดไป (เส้นที่ armed) — event ที่เกิดจริงใช้ plan ที่ประกาศไว้ (ไม่เปลี่ยนย้อนหลัง)
- Endpoint:
  - `GET /osf/v1?view=ea` (compact): `{version:1, ready, bar, until(=bar+60), day, root, expiry, session, zones:[[k,side,grade]], plans:[[k,side,grade,dir,touch,real(0/1),entry,sl,key]]}` (ราคาเป็นสเกล GC)
  - `GET /osf/v1` (เต็ม): + `levels, events, bars` (แอปใช้)
  - `GET /osf/v1?view=history` → `{days:[...]}` (≤ 20 วัน) · `GET /osf/v1?day=<unix day>` → book วันนั้น
  - `key` = `day|expiry|sid|strike|touch` (ใช้ร่วมแอป/EA/siglog SFC)
- ส่งเฉพาะ **สวนกำแพง AM/LDN** — NY เบรกไม่อยู่ใน Worker

---

## 4. EA `ea/OI_Session_Fade.mq5` v1.55

### 4.1 โครงสร้าง
- `OnTimer` ทุก 5 วิ: `RefreshAll` (โหลด `/opt` ทุก 60 วิ, offset `/gf` ทุก 60 วิ, ข่าวทุก 10 นาที, `BuildLevels`) → `LoadFade` (`/osf/v1?view=ea`) → `SyncOrders` → `Panel`
- `OnTick`: `SyncOrders` + `CheckNYBreak`
- **สวนกำแพง**: ใช้ plans ของ Worker เท่านั้น (ต้อง `ready=1`, day ตรง, session ตรง, `now ∈ [bar, until)`, offset สดไม่เกิน 120 วิ) · ตรวจรูปทรง plan (entry = strike ± half, entry−sl = 2·half+3) · real = 0 → ไม่วาง
  - LIMIT มี expiry = `until` (สิ้นนาที) แล้ว re-price/ต่ออายุทุกนาที → **โบรกต้องรองรับ `SYMBOL_EXPIRATION_SPECIFIED`** ไม่งั้นสวนกำแพงไม่ทำงาน (แผงขึ้นเตือน)
  - วาง LIMIT เฉพาะเมื่อราคาใกล้ขอบ ≤ `LimitNearUSD` (4$) และคงไว้จนห่างเกิน +`LimitKeepUSD` (2$)
  - แท่ง M1 ปัจจุบันแตะโซนแล้ว → ไม่วางเพิ่มในแท่งนั้น
  - กันเข้าซ้ำ: อ่านประวัติ deal ตั้งแต่ต้นช่วง (comment `OSS B|S AM|LDN <strike> k<n> R<rr>`)
- **NY เบรก**: EA คิดเองจาก M5 ของโบรก + เส้นจาก `/opt` + offset (`BuildLevels` ล็อกเส้นครั้งแรกหลัง 06:00) · กันซ้ำด้วย GlobalVariable `OSB<magic>|<date>|<strike>` · เข้าไม่เกิน `NYBreakMaxDelay` วิหลัง M5 ปิด
- lot: `LOT_FIXED` / `LOT_RISK` (% balance) / **`LOT_MONEY` (v1.55, เสียเท่า `RiskMoney` ทุกไม้เมื่อโดน SL)** · แบ่ง 3 ไม้ = แบ่งเงินเสี่ยงเท่ากัน · lot ขั้นต่ำเกินที่ต้องการ → Print เตือน `OSS lot warning`
- ไม่ทำงานใน Strategy Tester (WebRequest) · ต้องเพิ่ม URL `https://gc-yahoo.oigoldpro.workers.dev` และ `https://raw.githubusercontent.com` ใน WebRequest

### 4.2 ค่าที่ตกลงใช้ (ค่าเริ่มต้นตรงแล้ว ยกเว้น 3 ค่าแรก)
- `TradeEnabled = true` · `LotMode = LOT_MONEY` · `RiskMoney` = ตามทุน (แนะนำ ≈ 0.5% ของพอร์ต) · `MaxLotPerOrder` ตามบัญชี
- AM/LDN: `TP_SINGLE`, `SingleRR = 5` · NY: `UseNYBreak = true`, `NYBreakRR = 1`, `NYBreakSLMid = false`, `NYBreakMaxDelay = 60`
- `MaxSameDir = 0`, `BuyAddSpread = true`, `NewsFilter = true` 30/90, `OffsetMode = OFF_AUTO`

---

## 5. แอป `gold-oi-pro/osf.js` (สรุปสถานะ V4.9.100)

- ไม้สวนกำแพง **วันนี้** และย้อนหลังที่ Worker เก็บไว้ → อ่านจาก `/osf/v1` (central, `s.central = true`) · วันที่ Worker ไม่มี → `scan()` ในแอปจาก M1 Bybit/Binance + OI ย้อนหลังจากชีต (fallback M5 = วาดจาง ไม่คิดผล)
- NY เบรกคิดในแอป `scan(..., {fade:false})` (แท่ง perp ของแอป + `levels()` ของแอป)
- V4.9.97 แตะไม้บนกราฟ → dialog เหตุผล · V4.9.99 แสดงเฉพาะไม้จริง (ไม้บันทึก/กรองพุ่งยังเก็บใน log) · V4.9.100 ป้าย ⚡ ATR เขียวขึ้น/ส้มลง/แดงกะพริบเกิน 3×ATR
- `window.OI_sfade` = { RRS, view, stats, scan, levels, sessOf, dayStart, run, setups, today, days, bars, cfg, isOn, … }

### signal_log (forward test) — ชุดที่บันทึก
| id prefix | เนื้อหา |
|---|---|
| `SF|` | ไม้ oi ss (คำนวณในแอป) × RR 1/1.6/5, evidence ไม้จริง/บันทึก |
| `SFC|` | ไม้สวนกำแพงจาก Worker กลาง (ตรงกับ EA) |
| `SFB|` | NY เบรก SL ขอบ/SL กลาง × RR |
| `SFD|` | สวนกำแพง + footprint Δ5 (Binance aggTrades) |
| `SFI|` | สวนกำแพง + ATM IV ตอนเข้า |
| `SFG|` | สวนกำแพง + gmf flip / EM ที่ใช้ไป |

---

## 6. ปัญหาที่รู้ / ข้อระวัง

1. **ATR warm-up (แก้แล้ว 2026-11-09)**: Worker เดิมเริ่มเก็บแท่ง 04:59 และตัดช่วงพัก → ATR null ช่วง 06:00–07:00 ทุกวัน (กรองพุ่งไม่ทำงาน) · แก้ด้วย `osfWarm` (70 แท่งตลาดเปิดก่อน 06:00, ดึง 3600 แท่งตอนสร้าง book) · **มีผลตั้งแต่ book ของ 10 พ.ย.** — ควรตรวจไม้ AM ชั่วโมงแรกว่ามีค่า mv
2. แหล่งแท่งต่างกัน: Worker = perp mix + basis, แอป = perp ของแอป, EA NY = M5 โบรก, แบ็กเทส = M1 โบรก → ไม้ใกล้เส้นแบ่งอาจต่างกันเล็กน้อย
3. เส้นของ EA (NY) สร้างเองจาก `/opt` + ราคาโบรก 06:00 + offset — อาจต่างจาก `zones` ของ Worker ถ้า OI/ราคาอ้างอิงต่างกัน (ควรพิจารณาให้ EA ใช้ `zones` จาก Worker สำหรับ NY ด้วย)
4. Worker ไม่มี NY เบรก → ถ้าอยากให้แอป/EA ตรงกัน 100% ต้องย้าย BO เข้า Worker
5. EA v1.55 ยังไม่ได้ compile (sandbox ไม่มี MetaEditor) — ตรวจ error หลัง compile
6. LIMIT ต่ออายุทุกนาที → ถ้า Worker/เน็ตหลุด order หมดอายุเอง (ตั้งใจ, ปลอดภัย)
7. RR 5 ชนะ ~1/3 · DD แบ็กเทส ≈ 10R → เผื่อของจริง ~20R

## 7. งานค้าง
- [ ] หลังเดินจริง 2–3 สัปดาห์ (≈ ปลาย พ.ย.) วิเคราะห์ signal_log ทุกชุด (SF/SFC/SFB/SFD/SFI/SFG) เทียบแบ็กเทส
- [ ] ตรวจ book 10 พ.ย. ว่า ATR/mv ช่วง 06:00–07:00 มีค่า
- [ ] เทียบไม้ EA จริง (deal history) กับ `events` ของ Worker รายวัน
- [ ] พิจารณาย้าย NY เบรกเข้า Worker / ให้ EA ใช้ zones ของ Worker

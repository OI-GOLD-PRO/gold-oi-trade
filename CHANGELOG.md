# บันทึกการแก้ไข (Change Log) — gold-oi-trade

repo นี้มี Worker ข้อมูล (gcw/), Trade app (hub/, ea/), OI Gold Pro Mini (mini/) และแอปโซล่า (solar/)
งานส่วนนี้ซับซ้อน ปกติ Claude เป็นคนแก้ ถ้า ChatGPT แก้ ต้องจดไว้ที่นี่ด้วย

งาน OI Gold Pro Mini อ่าน [`mini/HANDOFF.md`](mini/HANDOFF.md) ก่อน

## กติกา
1. ก่อนแก้: pull โค้ดล่าสุด แล้วอ่านไฟล์นี้ก่อน
2. หลังแก้ทุกครั้ง: เพิ่มรายการใหม่ **ไว้บนสุด** ของส่วน "รายการ" ใน commit เดียวกับโค้ด
3. รูปแบบ:
   ```
   ### gcw — 2026-11-03 — Claude (คู่กับ OI Gold Pro V4.9.15)
- ไฟล์: gcw/src/mix.js (ใหม่), gcw/src/index.js, gcw/test.mjs
- แก้อะไร: `/mix?tf=&n=` แท่ง XAUUSDT perp รวม Bybit+Bitget+Binance (median) จาก TradingView แคช 2 วิ · `/retail` โซนรายย่อยคำนวณใน DO 'retail' จากไม้จริง 3 ตลาด ดึงทุกนาทีด้วย cron (49–51% = สองฝั่ง) · `/trapfz` เก็บแผน 💀 กลาง (GET/POST, ไม่ทับของเดิม, เก็บ 3 วัน)

### ส่วนที่แก้ + เวอร์ชัน — YYYY-MM-DD — ผู้แก้ (Claude / ChatGPT)
   - ไฟล์: …
   - แก้อะไร: …
   - ระวัง: …
   ```
4. ห้ามใส่ token หรือ key ในโค้ด (TELEGRAM_BOT_TOKEN เป็น Cloudflare Secret และ wrangler.toml ต้องคง `keep_vars = true`)

## รายการ

### Trade V0.10.02 — 2026-11-04 — ChatGPT (ฐาน OI Gold Pro V4.9.28)
- ไฟล์: index.html, live.js, bigtrade.js, ivbadge.js, dash.js, tools/port.py, tools/test-port.mjs; เพิ่ม retail.js, trap.js, dealerbox.js, volreg.js, oidiv.js, crowd.js, oistat.js
- แก้อะไร: ย้ายกราฟ/โซน/แหล่งแท่งรวมจาก V4.9.28; เพิ่มโปรไฟล์รายย่อย (ความละเอียด/ช่วงย้อนหลัง), กับดัก, กรอบดีลเลอร์, HV/IV/SD, OI Divergence และการ์ด OI/COT/ความผันผวนในแดชเทรด; ใส่ cache version ให้ทุก script/style
- แก้ adapter: คง GC_WORKER ที่ port เดิมลบทิ้ง; แปลง historical perp–GC basis เป็น perp–broker; แผนกับดักเก็บสเกล GC แล้วแปลงราคาเข้า/SL/TP ตอนใช้; อ่าน shared frozen plans อย่างเดียว ไม่ส่งแผนจากโบรกไปทับตัวหลัก; เอา history API ที่ไม่มี backend ใน Trade ออก
- ทดสอบ: node tools/test-port.mjs ผ่าน; เบราว์เซอร์ข้อมูลจำลอง login/กราฟ/เมนูใหม่/BUY+SELL พร้อม SL/TP/รายการออเดอร์ ผ่าน, runtime errors=[]; ราคาโบรกและ OI offset ตรง; ไม่ส่งคำสั่งจริง
- ขอบเขต: คง Trade ticket/Hub/EA และแดชกำไรขาดทุนเดิม; AI tray/Quant, signal_log ลงชีต, historical OI และ Web Push ยังเป็นของแอปหลักตาม port เดิม; ไม่ได้ทดสอบตลาดจริงหรือ iPhone จริง

### gcw — 2026-11-04 — Claude (คู่กับ OI Gold Pro V4.9.33)
- ไฟล์: gcw/src/index.js
- แก้อะไร: เรียลไทม์ 👥 — alarm เก็บไม้สดทุก 2 วิ (เดิม 5) · แคชแถวโหมด rt 1.8 วิ (เดิม 4.5)

### gcw — 2026-11-04 — Claude (คู่กับ OI Gold Pro V4.9.32) — ใช้ Workers Paid แล้ว
- ไฟล์: gcw/src/index.js, gcw/src/mix.js
- แก้อะไร: 👥 โหมดเรียลไทม์ `/retail?win=…&rt=1` — DO `retail` เปิดสาย WebSocket Bybit `publicTrade.XAUUSDT` (ได้ทุกไม้ ไม่หลุดตอนตลาดแรง) + alarm ทุก 5 วิ เก็บไม้ลงถัง · คำนวณแถวใหม่ได้ทุก ≥ 4.5 วิ · ไม่มีคนขอ rt 2 นาที → ปิดสาย กลับไปดึง REST ทุก 1 นาที · ระหว่างสายสดทำงาน cron ข้าม Bybit REST (กันนับซ้ำ, ใช้ watermark `st.by` ร่วมกัน) · ตอบ `rt: {ws, at, err}`

### gcw — 2026-11-04 — Claude (คู่กับ OI Gold Pro V4.9.31)
- ไฟล์: gcw/src/mix.js, gcw/src/index.js
- แก้อะไร: `/retail?win=` รับชั่วโมงอะไรก็ได้ 0.1–24 (ต่ำกว่า 1 ทีละ 0.1, ตั้งแต่ 1 ปัดเป็นชั่วโมงเต็ม) · ค่าที่ไม่ได้คำนวณไว้ล่วงหน้าคำนวณตอนขอแล้วจำ 55 วิ · ถังไม้ละเอียดขึ้นเป็น 3 นาที (เดิม 15)

### gcw — 2026-11-04 — Claude (คู่กับ OI Gold Pro V4.9.29)
- ไฟล์: gcw/src/index.js
- แก้อะไร: `/mix` แหล่งไหนดึงไม่ได้ (TradingView ตอบ 4xx เป็นพัก ๆ ~12k ครั้ง/วัน) → ใช้แท่งล่าสุดที่เคยได้ของแหล่งนั้น (≤ 3 นาที) แทน ค่ากลางไม่กระโดด · ตอบ `stale` = แหล่งที่ใช้ของเก่า

### gcw — 2026-11-04 — Claude (คู่กับ OI Gold Pro V4.9.25)
- ไฟล์: gcw/src/index.js
- แก้อะไร: `/retail?win=1|2|4|8|12|24` ส่งแถว (`rows`/`fine`) ตามช่วงย้อนหลังที่เลือก (ครึ่งชีวิต = ¼ ช่วง) · คำนวณไว้ทุกนาทีใน `rt:z.win` · ไม่ใส่ `win` = แถวชุดหลัก 8 ชม. เหมือนเดิม · `zones`/`trap` ไม่เปลี่ยน

### gcw + relay — 2026-11-04 — Claude (คู่กับ OI Gold Pro V4.9.24)
- ไฟล์: gcw/src/index.js, relay/ (ใหม่: rt-relay.mjs, start-relay.bat, README.md)
- แก้อะไร: Binance/Bitget บล็อก Cloudflare (403) → เพิ่ม `POST /rtpush` รับไม้จากมือถือ (🐋 เปิดอยู่) และเครื่องที่บ้าน (relay) · body `{src, via, tr:[[id,t,p,q,s]]}` · กันนับซ้ำด้วย id (เก็บ watermark ที่ `rt:push`) · กันข้อมูลปลอม: เวลา ≤ 15 นาที, ราคาห่างราคา Bybit ล่าสุด < 1.5%, 0<q<500, ≤ 20,000 ไม้/ครั้ง · `/retail` → `src` แสดงจำนวนไม้ที่ส่งมาใน 1 นาทีล่าสุด + `<src>_via`

### gcw — 2026-11-04 — Claude (คู่กับ OI Gold Pro V4.9.22)
- ไฟล์: gcw/src/mix.js, gcw/src/index.js, gcw/test.mjs
- แก้อะไร: `/retail` เก็บไม้รายย่อยละเอียด $0.1 (เดิม $1 · ถังเก่าเลขเต็มอ่านร่วมได้) + ส่ง `fine` / `freshFine` = แถว $0.1 [ราคา, ซื้อ, ขาย] ให้แอปรวมตามความละเอียดที่ตั้ง (0.1–2$) · โซน (`zones`, `trap`) ยังคิดทีละ $1 เหมือนเดิม

### gcw — 2026-11-04 — Claude (คู่กับ OI Gold Pro V4.9.19)
- ไฟล์: gcw/src/mix.js, gcw/src/index.js
- แก้อะไร: `/retail` ส่งแถวละเอียดทีละ $1 เพิ่ม — `rows` (ชุด FAST 8 ชม.) และ `freshRows` (1 ชม.) รูปแบบ [ราคา, ซื้อ, ขาย] ให้แอปวาดโปรไฟล์ 👥 แทนโซนรวม · `trap` ไม่เปลี่ยน

### gcw — 2026-11-03 — Claude (คู่กับ OI Gold Pro V4.9.18)
- ไฟล์: gcw/src/mix.js, gcw/src/index.js, gcw/test.mjs
- แก้อะไร: `retailZones(buckets, now, opt)` รับชุดพารามิเตอร์ · `RT_FAST` (โซนที่แสดง: ย้อน 8 ชม. ครึ่งชีวิต 2 ชม. z 1.5 หนา 1.15× 6 โซน ขั้นต่ำ 300 ไม้) · `RT_FRESH` (ไม้ 1 ชม. 3 โซน) · `RT_TRAP` (ชุดเดิม 24 ชม./8 ชม./z 2/1.3×/4 โซน) · `/retail` ส่ง `zones` (FAST) + `fresh` + `trap`
- ระวัง: 💀 ในแอปต้องอ่าน `trap` ไม่ใช่ `zones` ถ้าจะคงกติกาเดิม

### Mini v0.7.7 — 2026-11-03 — Claude
- ไฟล์: `mini/OIGoldProMini/OIGoldProMini.ino`
- แก้อะไร: เพิ่มกริดเส้นทองจางทุก $25 (xx00/25/50/75) แบบ `refreshQuarterPriceGrid` ในแอป (สี `C_QGRID` 0x4a3e22 ≈ ทอง 30% บนพื้นหลัง) · วาดหลังโซน OI ก่อนเส้น EM/MP/Gamma/CW/PW และแท่งเทียน
- ระวัง: ถ้าจางหรือเข้มไป ปรับค่า `C_QGRID`

### Mini v0.7.6 — 2026-11-03 — Claude
- ไฟล์: `mini/OIGoldProMini/OIGoldProMini.ino`
- แก้อะไร: เส้นเล็งย้ายไปเป็นไอคอน ⊕ บนแถบล่าง (ถัดจาก +, index 8 ใน `tbX/tbW[9]`) · กดไอคอน = เปิด/ปิด (เปิด = ไอคอนพื้นทอง, วางกลางกราฟ) · เปิดอยู่: แตะ/ลากบนกราฟ = ย้ายเส้นเล็ง · ปิดอยู่: แตะกราฟไม่แสดงเส้นเล็ง ลากกราฟได้ตามปกติ · แนวตั้ง ปุ่มไอคอน/ซูมแคบลงเหลือ 22px
- ระวัง: ลำดับ index ปุ่มไม่ตรงลำดับบนจอ (8 อยู่ระหว่าง 5 กับ 6)

### Mini v0.7.5 — 2026-11-02 — Claude
- ไฟล์: `mini/OIGoldProMini/OIGoldProMini.ino`
- แก้อะไร: โหมด AUTO (เปิดมา/แตะ AUTO/เปลี่ยน TF) เว้นที่ว่างขวา ~15% ของจำนวนแท่งที่เห็น (ขั้นต่ำ 2 แท่ง) ผ่านตัวแปร `panAuto` · ลากกราฟแล้ว `panAuto=false` เลื่อนได้อิสระ ชิดขอบขวาได้ / ดูย้อนหลังได้ / เว้นซ้ายสูงสุด 80% เหมือนเดิม · ป้าย AUTO แสดงเมื่อ `!panAuto` หรือเลื่อนขึ้นลง
- ระวัง: ซูม +/− ในโหมด AUTO จะคำนวณช่องว่างใหม่ตามจำนวนแท่ง

### Worker cron ทุก 1 นาที — 2026-11-02 — Claude
- ไฟล์: gcw/wrangler.toml (crons "* * * * *"), gcw/src/index.js (คอมเมนต์)
- แก้อะไร: ดึงข้อมูลออปชัน (IV/bid/ask/volume) และตรวจแจ้งเตือนโซนทุก 1 นาที (เดิม 2 นาที) ให้ IV บนกราฟแอปอัปเดตทุก ~1 นาที
- ระวัง: ข้อมูล TradingView แบบไม่ล็อกอินยังช้า 10 นาทีเหมือนเดิม · แจ้งเตือนกันซ้ำด้วย lastT อยู่แล้ว

### Mini v0.7.4 — 2026-11-02 — Claude
- ไฟล์: `mini/OIGoldProMini/OIGoldProMini.ino`
- แก้อะไร: ลดกำลังส่ง WiFi เป็น 11dBm เป็นค่าเริ่ม (pref `wlow`, ค่าเริ่ม true) แก้จอหรี่เป็นจังหวะตอนตลาดเปิด (ดึงราคาทุก 1 วิ → ไฟกระชาก) เมื่อใช้แบตผ่านโมดูลชาร์จที่ไม่มีบูสต์ 5V · ปุ่ม `TX: LOW / TX: NORMAL` อยู่หน้า WIFI SETUP (ปุ่มกลางล่าง) · `applyTx()` เรียกหลัง `WiFi.begin` ทุกจุด
- ระวัง: ถ้าเปลี่ยนเป็นโมดูลชาร์จ+บูสต์ 5V แล้ว กด TX: NORMAL ได้ (19.5dBm) · TX LOW สัญญาณอาจอ่อนลงถ้าเราเตอร์ไกล

### Mini v0.7.3 — 2026-11-02 — Claude
- ไฟล์: mini/OIGoldProMini/OIGoldProMini.ino
- แก้อะไร (ผู้ใช้ขอ): เปิดเครื่องช่วงตลาดปิด (AUTO OFF) จอดับทันที → ตั้ง `wakeUntil = millis() + 60000` ท้าย setup ให้จอติด 1 นาทีก่อนดับ
- ระวัง: -

### Mini v0.7.2 + Worker — 2026-11-02 — Claude
- ไฟล์: mini/OIGoldProMini/OIGoldProMini.ino, gcw/src/index.js, gcw/test.mjs, mini/HANDOFF.md
- แก้อะไร (ผู้ใช้แจ้ง): (1) IV ไม่ตรง — เดิมใช้ IV ของ TradingView (ข้อมูลเพี้ยนกับสัญญารายวัน) → คำนวณเองด้วย Black-76 แบบ live.js ของแอป (`smileIV`: mid bid/ask ถ้า spread แคบ ไม่งั้นราคาล่าสุด, F จาก put-call parity, IV ฝั่ง OTM, T ณ เวลาที่ poll) (2) **SD = ส่วนเบี่ยงเบนมาตรฐานของ OI** (ผู้ใช้กำหนด) → `distSD` ค่ากลางถ่วงน้ำหนัก OI ± SD (`os`), ของ Volume (`vs`), `sd` = SD ของ OI · หน้า 1 เปลี่ยนป้ายเป็น "OI 1SD" (3) หน้า 2 เส้น IV โค้งแบบ CME — fit กำลังสองรอบ F (±4%) ส่ง `sm` = [F, a, b, c] จอวาดโค้ง + จุด IV จริง (4) หน้า 2/3 กราฟเต็มจอ (แกนนอน = strike ทั้งหมดที่ส่งมา)
- ระวัง: `s[i][8]` เปลี่ยนเป็น IV ที่คำนวณเอง (0 = คำนวณไม่ได้) · `iv` = ATM IV จาก smile (ไม่มี smile ใช้ค่า TradingView) · ยังไม่ได้ทดสอบบนบอร์ดจริง

### Mini v0.7.1 + Worker — 2026-11-02 — Claude
- ไฟล์: mini/OIGoldProMini/OIGoldProMini.ino, gcw/src/index.js, gcw/test.mjs, mini/HANDOFF.md
- แก้อะไร (ผู้ใช้ขอ): Dashboard หน้า 1 เพิ่ม **Dealer** (รับ/ไล่ แบบ dealer.js แต่ไม่รวม Big Traders) + **ATM IV** + **1SD** · ปุ่มล่าง CLOSE / < PREV / NEXT > · **หน้า 2** = แท่ง OI ราย strike (Call/Put) + เส้น IV (smile ฝั่ง OTM) + แถบ ±1/±2 SD แบบ CME QuikStrike · **หน้า 3** = แท่ง Volume วันนี้ราย strike + แถบ SD · Worker /mini เพิ่ม `iv` (ATM IV %), `sd` (1SD $ = F × IV × √T ถึงหมดอายุ), `dl` ([คะแนน −100..100, 'A'|'C'|'N']) และ `s[i][8]` = IV % × 10
- ระวัง: Dealer บนจอใช้ราคา Gold.F จาก Worker (ทุก 15 วิ) · flip = gmf itd (ถ้าไม่มีใช้ gmf M) · ยังไม่ได้ทดสอบบนบอร์ดจริง

### Worker /mini/dash — 2026-11-02 (2) — Claude
- ไฟล์: gcw/src/index.js
- แก้อะไร: จอขึ้น "sheet auth" → ลองรหัสของจอก่อน แล้วค่อย DASH_CODE (เดิมใช้ DASH_CODE ก่อน ถ้าตั้งผิดจะไม่ผ่าน) · ข้อความ error บอกว่าตัวไหนไม่ผ่าน "(code)" / "(DASH_CODE)"
- ระวัง: ถ้ายังขึ้น "sheet auth (code)" = Apps Script api=data ไม่รับรหัสที่ api=login รับ → ต้องดูโค้ด doGet ใน Apps Script (ไม่ได้อยู่ใน repo)

### Worker /mini/dash — 2026-11-02 — Claude
- ไฟล์: gcw/src/index.js
- แก้อะไร: ผู้ใช้แจ้ง Dashboard บนจอไม่ขึ้น (ยังไม่ได้ตั้ง secret DASH_CODE) → /mini/dash อ่านชีตด้วยรหัสแอปที่จอส่งมา (ผ่าน checkCode แล้ว) · DASH_CODE ไม่จำเป็นแล้ว (ถ้าตั้งไว้ใช้ก่อน) · คำตอบ Apps Script ที่ไม่ใช่ JSON → error "sheet HTTP xxx"
- ระวัง: ผลแคชร่วมกัน 5 นาที (ข้อมูลเหมือนกันทุกรหัส)

### Mini v0.7.0 + Worker — 2026-11-01 — Claude
- ไฟล์: mini/OIGoldProMini/OIGoldProMini.ino, gcw/src/index.js, gcw/src/flash.js, gcw/test.mjs, mini/HANDOFF.md
- แก้อะไร (ผู้ใช้ขอ): เข้าใช้จอด้วย **รหัสเดียวกับแอป OI Gold Pro** และบังคับทุกจอ · เอาระบบรหัส GX + /mini/act + /mini/admin + MINI_ADMIN/MINI_AUTH ออก · Worker: `checkCode` (Apps Script `?api=login`, แคช 10 นาที/ไม่ผ่าน 2 นาที, Apps Script ล่ม = 503 ไม่แคช), `/mini/login` (ลองตัวพิมพ์ใหญ่/เล็ก), `/mini` และ `/mini/dash` ต้องมี `code=` · จอ: ไม่มีรหัส → หน้าใส่รหัสหลังต่อ WiFi · 401 → กลับหน้าใส่รหัสเอง · MENU → APP CODE (แสดงวันหมดอายุ) เปลี่ยนรหัส · Preferences `code`, `cexp`
- ระวัง: จอ v0.6.x หลัง Worker นี้ deploy จะได้ 401 (ไม่มี code) แต่ยังอัปเดต OTA ได้ (version.json อยู่บน GitHub) · ยังไม่ได้ทดสอบบนบอร์ดจริง

### Mini v0.6.1 — 2026-11-01 — Claude
- ไฟล์: mini/OIGoldProMini/OIGoldProMini.ino, mini/HANDOFF.md
- แก้อะไร (ผู้ใช้ขอ): (1) เส้นเล็งเปลี่ยนจาก "แตะค้าง" เป็น **แตะ 1 ครั้ง = แสดง / แตะอีกครั้ง = ซ่อน** แบบแอป · ตอนแสดงอยู่ ลาก = เลื่อนเส้นเล็ง · เส้นเล็งค้างอยู่แม้ข้อมูลอัปเดต (`overlayCross()` วาดใน drawChart) (2) แตะค้างแล้วลากใน v0.6.0 กลายเป็นเส้นเล็ง ลากกราฟไม่ได้ → เอาแตะค้างออก · **ลากกราฟไปซ้ายได้** (panBars ติดลบ = ช่องว่างด้านขวา สูงสุด 80% ของจำนวนแท่งบนจอ) (3) แตะป้าย **AUTO** บนกราฟ (มุมขวาบน ขยายพื้นที่แตะ 62×24 px) = กลับอัตโนมัติ (เดิมต้องแตะแกนราคา)
- ระวัง: panBars < 0 → แท่งที่ index ≥ D.nb ไม่วาด · tickCandle ยัง panBars++ เมื่อ ≠ 0 (แท่งใหม่เติมช่องว่าง)

### Mini v0.6.0 + Worker — 2026-11-01 — Claude
- ไฟล์: mini/OIGoldProMini/OIGoldProMini.ino, gcw/src/index.js, gcw/src/flash.js (ใหม่), gcw/test.mjs, mini/HANDOFF.md
- แก้อะไร (ผู้ใช้เลือกข้อ 1–5, 8, 9, 10):
  1. แจ้งเตือนข่าวแดง USD ก่อน 10 นาที + นับถอยหลังบนแถบสถานะ (/mini เพิ่ม `nx`)
  2. ทะลุโซนยืนยันด้วยราคาปิด M5 ให้ตรงแอป/Telegram
  3. หน้า Dashboard (แตะแถบหัว หรือเมนู) — คะแนนเทรนด์ ทิศ เข็มวัด แนวสำคัญของ ds + Max Pain/gmf/EM/CW/PW · Worker `/mini/dash` อ่านชีตด้วย secret `DASH_CODE`
  4. เส้น Call Wall / Put Wall + ป้ายบนแกนราคา
  5. แตะค้างบนกราฟ = เส้นเล็ง (ราคา, OHLC/เวลาแท่ง, OI strike ใกล้สุด)
  8. หน้า ALERT SOUNDS: ระดับเสียง 4 ระดับ + เลือกเสียงต่อชนิด (OFF/BEEP/CHIME/ALARM) ด้วย LEDC (เลิกใช้ tone())
  9. เปิดใช้งานต่อเครื่อง: `/mini/act` ให้รหัส GX-xxxx ต่อ MAC · หน้าแอดมิน `/mini/admin` (secret `MINI_ADMIN`) · บังคับเมื่อตั้ง `MINI_AUTH=1` · จอแสดงรหัสในเมนู และหน้าขออนุมัติเมื่อโดน 401
  10. หน้าเว็บติดตั้งเฟิร์มแวร์ `/mini/flash` (ESP Web Tools + mini/dist/factory.bin)
- ระวัง: ยังไม่ได้ทดสอบบนบอร์ดจริง · เมนูเปลี่ยนเป็น 2 คอลัมน์ทุกแถว · LEDC ต้องรองรับทั้ง core 2 (CI) และ core 3 (Arduino IDE ผู้ใช้ 3.3.x) ด้วย `#if ESP_ARDUINO_VERSION_MAJOR >= 3` · ยังไม่ได้ตั้ง secrets ใน Cloudflare (Dashboard จะขึ้น "DASH_CODE not set" จนกว่าจะตั้ง)

### Mini v0.5.5 — 2026-11-01 — Claude
- ไฟล์: mini/OIGoldProMini/OIGoldProMini.ino
- แก้อะไร: เอาที่ว่างด้านขวา 22% ของกราฟออก (ผู้ใช้ขอ — เดิมใส่ไว้ตอนยังลากเลื่อนกราฟไม่ได้) แท่งเทียนใช้ความกว้างเต็ม PW − 4
- ระวัง: ผู้ใช้ทดลอง SPEED 40MHz อยู่ (ค่าเริ่มยังเป็น 27MHz)

### Mini v0.5.4 — 2026-11-01 — Claude
- ไฟล์: mini/OIGoldProMini/OIGoldProMini.ino
- แก้อะไร: (1) หน้าเลือก WiFi/คีย์บอร์ดบังคับ rotation 1 เสมอ → ผู้ใช้ตั้ง ROT LAND 180 ภาพกลับหัวและแตะไม่ตรง (ดูเหมือนค้าง) · เปลี่ยนเป็น rotation 3 เมื่อ rotIdx ≥ 2 (2) เปิดเครื่องแล้ว WiFi เชื่อมไม่ทัน (เดิมรอ 15 วิ แล้วเด้งไปหน้าเลือก WiFi) → รอ 10 วิ แล้วเข้าหน้ากราฟเลย ไปหน้าเลือก WiFi เฉพาะเมื่อผู้ใช้แตะจอระหว่างรอ หรือยังไม่เคยตั้ง WiFi (3) loop ลอง WiFi.begin ใหม่ทุก 20 วิ เมื่อหลุดเกิน 15 วิ
- ระวัง: หน้า WiFi/คีย์บอร์ดใช้พิกัดแนวนอน 320×240 เท่านั้น

### Mini v0.5.3 — 2026-11-01 — Claude
- ไฟล์: mini/OIGoldProMini/OIGoldProMini.ino, mini/HANDOFF.md
- แก้อะไร: (1) บรรทัดวินิจฉัยในหัวเมนูย่อเป็น `d<miniErr> <px|--|cls> <free>/<maxk>` ไม่ทับเลขเวอร์ชัน (2) ตลาด GC ปิด (`mkt` false) → ไม่ใช้/ไม่ดึงราคา Bybit (offset ค้าง) แสดงราคาปิด Gold.F จาก /mini แทน (3) เมนู SPEED 27/40MHz (key `spi40`, เปลี่ยนแล้วรีสตาร์ท) · แตะจอค้างช่วงหน้าโลโก้ตอนเปิดเครื่อง = กลับ 27MHz · ปุ่ม AUTO OFF ย่อชื่อเป็น OFF: … และแบ่งแถวกับ SPEED
- ระวัง: v0.5.2 บนบอร์ดจริงวัดได้ heap ว่าง 113KB ก้อนใหญ่สุด 71KB (TLS ~40KB/ทาง) · 40MHz ยังไม่ได้ทดสอบบนบอร์ด ค่าเริ่มยังเป็น 27MHz

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

# OI Gold Pro Mini

จอ ESP32 CYD 2.8" (ESP32-2432S028 รุ่น 2 USB, ชิปจอ ILI9341) แสดงราคาทอง Gold.F สด + ระดับ OI ของแอป OI Gold Pro

- ข้อมูล: `GET https://gc-yahoo.oigoldpro.workers.dev/mini` (Worker `gcw/`, แคช 15 วินาที)
- ราคา = Gold.F (BlackBull, เรียลไทม์) · ระดับ = ออปชันสัญญาวันนี้จาก TradingView (ช้า ~10 นาที)
- เส้นบนกราฟ: CW/PW (Call/Put Wall), itd (gmf itd), gmM (gmf M), MP (Max Pain), EM± (Expected Move จากราคาเปิดวัน), แถบโซน OI/Vol
- แจ้งเตือน (LED + เสียง + แถบสี): ราคาเข้าโซน → พัก 1 ชม./โซน · ทะลุขอบโซน $2 → พัก 30 นาที (เทียบราคาสด ไม่ใช่ปิด M5 แบบในแอป)
- ปุ่ม: ROTATE (หมุนจอ 4 ทิศ), SOUND/MUTED, WIFI (สแกน เลือก พิมพ์รหัสจากจอ) · แตะราคา = ความสว่าง 3 ระดับ · แตะแถบแจ้งเตือน = ปิด

## ติดตั้งด้วย Arduino IDE
1. Board: **ESP32 Dev Module** · Partition Scheme: **Minimal SPIFFS (1.9MB APP with OTA)**
2. Library Manager: **LovyanGFX**, **ArduinoJson** (v7)
3. เปิด `OIGoldProMini/OIGoldProMini.ino` แล้ว Upload

GitHub Actions คอมไพล์ด้วย PlatformIO ทุกครั้งที่แก้ `mini/` และเก็บไฟล์ `dist/factory.bin`

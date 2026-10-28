# OI Gold Pro Mini

จอ ESP32 CYD 2.8" (ESP32-2432S028 รุ่น 2 USB, ชิปจอ ILI9341) แสดงราคาทอง Gold.F สด + ระดับ OI ของแอป OI Gold Pro

- ข้อมูล: `GET https://gc-yahoo.oigoldpro.workers.dev/mini` (Worker `gcw/`, แคช 15 วินาที)
- ราคา = Gold.F (BlackBull, เรียลไทม์) · ระดับ = ออปชันสัญญาวันนี้จาก TradingView (ช้า ~10 นาที)
- กราฟแท่งเทียน Gold.F + OI ราย strike แบบแอป (Call เขียวจากขอบขวา/Put แดง, Volume ฟ้า/ส้มจากซ้าย, โซน 10 อันดับ, Vol 5 อันดับเส้นทอง) + เส้น gmf itd (ฟ้า), gmf M (ส้ม), Max Pain (บานเย็น), EM±
- แจ้งเตือน (LED + เสียง + แถบสี): ราคาเข้าโซน → พัก 1 ชม./โซน · ทะลุขอบโซน $2 → พัก 30 นาที (เทียบราคาสด ไม่ใช่ปิด M5 แบบในแอป)
- แถบล่าง: ไทม์เฟรม 1m/5m/15m/1h · ซูม −/+ (แตะกราฟซ้าย = ซูมออก, ขวา = ซูมเข้า) · MENU (หมุนจอ 4 ทิศ, เสียง, ความสว่าง, WiFi) · แตะแถบแจ้งเตือน = ปิด

## ติดตั้งด้วย Arduino IDE
1. Board: **ESP32 Dev Module** · Partition Scheme: **Minimal SPIFFS (1.9MB APP with OTA)**
2. Library Manager: **LovyanGFX**, **ArduinoJson** (v7)
3. เปิด `OIGoldProMini/OIGoldProMini.ino` แล้ว Upload

GitHub Actions คอมไพล์ด้วย PlatformIO ทุกครั้งที่แก้ `mini/` และเก็บไฟล์ `dist/factory.bin`

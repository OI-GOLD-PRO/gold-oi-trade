# โซลาร์บ้าน (solar-monitor)

Cloudflare Worker ที่ดึงค่าอินเวอร์เตอร์ (SmartESS) และ MPPT HM-4096 (Tuya) ทุก 5 นาที
เก็บใน D1 `solar-monitor-db` และแสดงเป็นเว็บแอปในมือถือ แยกจาก hub ของแอป OI ทั้งหมด

ขึ้นระบบอัตโนมัติผ่าน `.github/workflows/deploy-solar.yml` ทุกครั้งที่ไฟล์ใน `solar/` เปลี่ยน

## Secret ที่ต้องมีใน GitHub (Settings → Secrets and variables → Actions)
| ชื่อ | ค่า |
|---|---|
| DESS_USER / DESS_PASSWORD | บัญชีแอป SmartESS |
| TUYA_CLIENT_ID / TUYA_SECRET | Access ID / Secret จาก Tuya Developer (โปรเจกต์ solar-monitor) |
| SOLAR_APP_KEY | รหัสเข้าแอป |

เพิ่มหรือแก้ secret แล้ว ไปที่ Actions → Deploy solar → Run workflow เพื่อส่งค่าขึ้น Cloudflare

## ตรวจปัญหา
`https://solar-monitor.<subdomain>.workers.dev/api/debug?key=<SOLAR_APP_KEY>` แสดงค่าดิบล่าสุดจากทั้งสองแหล่ง

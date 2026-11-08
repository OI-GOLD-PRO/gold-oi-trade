# แดชบอร์ดพอร์ต MT5

แอปดูพอร์ต MT5 (ดูอย่างเดียว ไม่มีปุ่มเทรด): กำไร/ขาดทุนรายวัน ปฏิทิน สถิติ แยกตาม EA และรองรับบัญชีลูกค้า

```
MT5 (EA PortSender, ดูอย่างเดียว) → Hub บน Cloudflare (ฟรี) → แอปบนมือถือ (GitHub Pages)
```

| ไฟล์ | คืออะไร |
|---|---|
| `index.html`, `app.js`, `app.css` | แอป: ภาพรวม · รายละเอียดบัญชี · ปฏิทิน · สถิติ · จัดการบัญชี/รหัสลูกค้า |
| `hub/` | Worker `port-hub` แยกจาก `oi-trade-hub` เก็บข้อมูลใน Durable Object (SQLite) |
| `ea/PortSender.mq5` | EA ส่งยอดบัญชี ไม้ที่เปิด และประวัติการเทรดทั้งบัญชี ไม่เปิดหรือปิดไม้เลย |
| `tools/` | เทสต์ (`node portdash/tools/test-hub.mjs`, `node portdash/tools/test-app.mjs`) และ `dev-server.mjs` สำหรับเปิดดูในเครื่อง |

เวอร์ชัน: **v1.0.00**

## ตั้งค่าครั้งแรก
1. เพิ่ม repo secret `PORT_ADMIN_KEY` ใน gold-oi-trade (Settings › Secrets and variables › Actions) เป็นรหัสเข้าแอปของเจ้าของ ใช้ข้อความสุ่มยาวๆ ส่วน `CLOUDFLARE_API_TOKEN` กับ `CLOUDFLARE_ACCOUNT_ID` ใช้ตัวเดิมที่มีอยู่แล้ว
2. Actions › **Deploy portdash hub** › Run workflow จะได้ hub ที่ `https://port-hub.oigoldpro.workers.dev`
3. แอปอยู่ที่ **https://oi-gold-pro.github.io/gold-oi-trade/portdash/** (ใช้ GitHub Pages เดิมของ repo)

## เพิ่มบัญชี
1. เปิดแอป แล้ว login ด้วย `PORT_ADMIN_KEY` › แท็บ **บัญชี** › เพิ่มบัญชี MT5 (ใส่วันเริ่มนับได้)
2. ใน MT5: วาง `PortSender.mq5` ใน `MQL5/Experts` แล้วกด F7 › Tools › Options › Expert Advisors › Allow WebRequest แล้วเพิ่ม URL ของ hub
3. ลาก EA ใส่กราฟ 1 กราฟต่อบัญชี แล้วใส่ `ConnectKey` ที่ได้จากแอป ไม่ต้องเปิด Algo Trading เพราะ EA นี้ไม่เทรด
4. ลูกค้า: แท็บ **บัญชี** › เพิ่มรหัสลูกค้า › เลือกบัญชีที่ให้เห็น › ส่งรหัสให้ลูกค้า

## ข้อควรรู้
- `ConnectKey` 1 รหัสผูกกับบัญชี MT5 1 บัญชี ถ้าจะย้ายไปบัญชีอื่นให้กด "ย้ายไปบัญชี MT5 อื่น" (ประวัติเก่าจะถูกล้าง)
- EA ส่งข้อมูลทุก 30 วินาทีตอนไม่มีคนดู และทุก 5 วินาทีตอนเปิดแอปดูบัญชีนั้นอยู่ ถ้าไม่ได้รับข้อมูลเกิน 90 วินาทีจะขึ้นว่า "ออฟไลน์"
- กำไร/ขาดทุนรายวันนับตามวันเวลาไทย และนับทุกไม้ในบัญชี (ทุกคู่เงิน ทุก EA รวมไม้เทรดมือ)
- โควตาฟรีของ Cloudflare คือ 100,000 request ต่อวัน ถ้า 1 บัญชีส่งทุก 30 วินาที จะใช้ประมาณ 2,900 ครั้งต่อวัน ประมาณ 20 บัญชีก็ยังอยู่ในโควตาสบายๆ

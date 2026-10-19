# Stamp HOME · BMS relay (ESP32-WROOM-32)

Holds Bluetooth links to the two JBD/Xiaoxiang BMS at once and relays their raw frames to the Worker
(`POST /api/bms`, header `x-key`). The Worker decodes them (`src/bms.js`) — nothing is parsed on the board.

- Build: GitHub Actions `Build BMS firmware` → `dist/factory.bin` (merged image, flash at 0x0).
- Install: open `<app link>/flash` in Chrome/Edge on a PC and press the button.
- First boot: join hotspot `StampHOME-BMS`, choose Wi-Fi, paste app link + app key.
- Reset settings: hold BOOT for 3 s while running.
- BMS MAC addresses default to the two batteries (see `platformio.ini`) and can be changed in the portal.

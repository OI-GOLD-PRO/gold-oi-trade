// OI Gold Pro Mini — จอ ESP32 CYD 2.8" (ESP32-2432S028 รุ่น 2 USB, ชิปจอ ILI9341)
// กราฟแท่งเทียน GC1 (Gold.F, ราคาสดจาก Bybit XAUUSDT + offset ทุก 1 วินาทีจากงานเน็ตแกน 0) + OI/Volume ราย strike แบบแอป OI Gold Pro (Call เขียว แนวต้าน · Put แดง แนวรับ)
// เส้น gmf itd / gmf M / Max Pain / Expected Move / Call-Put Wall · โซน OI 10 อันดับ · แจ้งเตือนเข้าโซน/ทะลุโซน (ปิด M5)/ข่าวแดง
// v0.6: หน้า Dashboard (แตะแถบหัว), เส้นเล็ง (แตะบนกราฟ), เสียงแจ้งเตือนแยกชนิด + ระดับเสียง
// v0.7: เข้าใช้ด้วยรหัสเดียวกับแอป OI Gold Pro (ตรวจกับชีตผ่าน Worker /mini/login) แทนรหัส GX
// ข้อมูลจาก Worker: https://gc-yahoo.oigoldpro.workers.dev/mini?tf=1|5|15|60 (อัปเดตทุก 15 วินาที)
//
// Arduino IDE:  Board = ESP32 Dev Module
//               Partition Scheme = Minimal SPIFFS (1.9MB APP with OTA)
// Libraries:    LovyanGFX, ArduinoJson (v7)
// v0.5: งานเน็ตทั้งหมดอยู่บนแกน 0 (netTask) · จอ/สัมผัส/แจ้งเตือนอยู่บนแกน 1 (loop) · ส่งข้อมูลผ่าน ND + mutex

#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <HTTPUpdate.h>
#include <Preferences.h>
#include <ArduinoJson.h>
#include <LovyanGFX.hpp>
#include <math.h>
#include "logo.h"

#define FW_VER "0.7.9"
// อัปเดตผ่าน WiFi: GitHub Actions คอมไพล์แล้ววางไฟล์ไว้ที่ mini/dist/ (version.json + firmware.bin)
static const char *OTA_BASE = "https://raw.githubusercontent.com/OI-GOLD-PRO/gold-oi-trade/main/mini/dist/";
char newVer[16] = "";  // เวอร์ชันใหม่ที่พบ ("" = ล่าสุดแล้ว)
WiFiClientSecure perpCli;  // REST สำรองของ Bybit (ใช้เมื่อ WebSocket หลุด)
static const char *WORKER = "https://gc-yahoo.oigoldpro.workers.dev";
static const char *DATA_URL = "https://gc-yahoo.oigoldpro.workers.dev/mini?tf=";
// รหัสเข้าใช้ = รหัสเข้าแอป OI Gold Pro (Preferences "code") · หมดอายุ/ถูกลบในชีต → /mini ตอบ 401 → จอขึ้นหน้าใส่รหัส
char loginCode[64] = "", tryCode[64] = "", okCode[64] = "", loginExp[24] = "";
volatile bool reqLogin = false; volatile int loginRes = 0;  // 0 รอ, 1 ใช้ได้, 2 รหัสผิด, 3 หมดอายุ, 4 เซิร์ฟเวอร์/เน็ตมีปัญหา
String urlEnc(const char *p) { String o; char b[4]; for (; *p; p++) { char c = *p; if (isalnum((unsigned char)c) || c == '-' || c == '_' || c == '.' || c == '~') o += c; else { snprintf(b, sizeof(b), "%%%02X", (uint8_t)c); o += b; } } return o; }

static const uint32_t FETCH_MS = 15000;

// ---------------- จอ + ระบบสัมผัส ----------------
class LGFX : public lgfx::LGFX_Device {
  lgfx::Panel_ILI9341 _panel;
  lgfx::Bus_SPI _bus;
  lgfx::Light_PWM _light;
  lgfx::Touch_XPT2046 _touch;
public:
  LGFX() {
    { auto c = _bus.config();
      c.spi_host = SPI2_HOST; c.spi_mode = 0; c.freq_write = 27000000; c.freq_read = 16000000;
      c.pin_sclk = 14; c.pin_mosi = 13; c.pin_miso = 12; c.pin_dc = 2;
      _bus.config(c); _panel.setBus(&_bus); }
    { auto c = _panel.config();
      c.pin_cs = 15; c.pin_rst = -1; c.pin_busy = -1;
      c.panel_width = 240; c.panel_height = 320;
      c.invert = false; c.rgb_order = false; c.readable = true; c.bus_shared = false;
      _panel.config(c); }
    { auto c = _light.config();
      c.pin_bl = 21; c.invert = false; c.freq = 44100; c.pwm_channel = 7;
      _light.config(c); _panel.setLight(&_light); }
    { auto c = _touch.config();
      c.x_min = 300; c.x_max = 3900; c.y_min = 200; c.y_max = 3700;
      c.pin_int = 36; c.bus_shared = false; c.offset_rotation = 0;
      c.spi_host = SPI3_HOST; c.freq = 1000000;
      c.pin_sclk = 25; c.pin_mosi = 32; c.pin_miso = 39; c.pin_cs = 33;
      _touch.config(c); _panel.setTouch(&_touch); }
    setPanel(&_panel);
  }
  void setWriteFreq(uint32_t f) { auto c = _bus.config(); c.freq_write = f; _bus.config(c); }  // เรียกก่อน init()
};

LGFX lcd;
LGFX_Sprite spr(&lcd);   // กราฟ (8-bit)
LGFX_Sprite sspr(&lcd);  // แถบสถานะ (8-bit)
bool sOk = false;
Preferences prefs;

const int LED_R = 4, LED_G = 16, LED_B = 17;  // LED RGB หลังบอร์ด (LOW = ติด)
const int SPK = 26;                           // ช่องลำโพง SPEAK
const int BATT_PIN = 35;                      // วัดแบต (ผ่านตัวแบ่งแรงดัน 1:2) ช่อง P3
int battPct = -1;
uint16_t calData[8] = {291, 3625, 281, 205, 3806, 3629, 3834, 192};  // วัดจากบอร์ดนี้ 2026-10-28

// ---------------- สี (ชุดเดียวกับแอป) ----------------
uint16_t C_BG, C_PANEL, C_LINE, C_TEXT, C_DIM, C_GOLD, C_UP, C_DN, C_CALL, C_PUT, C_GMI, C_GMM, C_MP, C_VOLC, C_VOLP, C_EM;
uint16_t C_ZC, C_ZP, C_ZV, C_GRID, C_QGRID;
uint16_t rgb(uint8_t r, uint8_t g, uint8_t b) { return lcd.color565(r, g, b); }
uint16_t hex(uint32_t h) { return lcd.color565(h >> 16, (h >> 8) & 255, h & 255); }
uint16_t blend(uint32_t a, uint32_t b, float t) {  // ผสมสี a ทับพื้น b ความเข้ม t
  return rgb(((a >> 16) & 255) * t + ((b >> 16) & 255) * (1 - t), ((a >> 8) & 255) * t + ((b >> 8) & 255) * (1 - t), (a & 255) * t + (b & 255) * (1 - t));
}
void initColors() {
  C_BG = hex(0x04060a); C_PANEL = hex(0x0b0e16); C_LINE = hex(0x262c3c); C_GRID = hex(0x11151f); C_QGRID = hex(0x4a3e22); C_TEXT = hex(0xe6e9f2); C_DIM = hex(0x8a93ab);
  C_GOLD = hex(0xe0b44c); C_UP = hex(0x26a69a); C_DN = hex(0xef5350);
  C_CALL = hex(0x2fbf8f); C_PUT = hex(0xe5576b); C_GMI = hex(0x22d3ee); C_GMM = hex(0xf59e0b); C_MP = hex(0xff3fb4);
  C_VOLC = hex(0x8ccaff); C_VOLP = hex(0xffb98a); C_EM = hex(0x8a93ab);
  C_ZC = blend(0x2fbf8f, 0x04060a, 0.40); C_ZP = blend(0xe5576b, 0x04060a, 0.40); C_ZV = blend(0xe0b44c, 0x04060a, 0.40);
}

// ---------------- ข้อมูล ----------------
struct Zone { float k, lo, hi; char t; long c, p; };
struct Strike { float k; long c, p, vc, vp; uint8_t rc, rp, tv; int16_t iv; };  // iv = IV % × 10 (ฝั่ง OTM)
#define MAXB 120
#define MAXS 40
struct Data {
  int tf; float p; float b[MAXB][4]; int nb; int bs; uint32_t lt; float off;
  float F, open, em, itd, gm, mp;
  char exp[16]; bool mkt;
  Zone z[12]; int nz;
  Strike s[MAXS]; int ns;
  float cw, pw;                       // Call Wall / Put Wall
  float ivA, sd; int dlS; char dlM;   // ATM IV %, 1SD ของ OI ($), Dealer คะแนน −100..100 + โหมด A รับ / C ไล่ / N กลาง
  bool smOk; float smF, smA, smB, smC; // เส้นโค้ง IV: iv% = A + B·(k−F) + C·(k−F)²
  float osM, osS, vsM, vsS;           // ค่ากลาง/SD ของ OI และ Volume ราย strike
  uint32_t nxT[3]; char nxS[3][30]; int nn;  // ข่าวแดง USD ถัดไป (เวลา UTC วินาที, ชื่อ)
};
Data D;                  // ของจอ (แกน 1) เท่านั้น
Data ND;                 // งานเน็ตเขียนเสร็จแล้ววางไว้ที่นี่ (ล็อก mx)
SemaphoreHandle_t mx;
volatile bool ndReady = false, reqFetch = false, reqUpd = false, netPause = false, netIdle = false;
volatile int updRes = 0;
volatile int miniErr = 1;           // ผลดึง /mini ล่าสุด: 1 ยังไม่เคย, 0 สำเร็จ, รหัส HTTP หรือ -100 เชื่อมต่อไม่ได้ / -200 JSON เสีย / -300 Worker แจ้ง error
volatile uint32_t miniOkAt = 0;
volatile bool mktOpen = true;  // จาก /mini (งานเน็ตใช้ตัดสินว่าจะดึงราคา Bybit ไหม)
volatile float perp = NAN; volatile uint32_t perpAt = 0, perpSeq = 0;
  // ผลเช็กอัปเดต: 0 รอ, 1 สำเร็จ, 2 ล้มเหลว
bool haveData = false;
uint32_t lastOk = 0;

// สถานะแจ้งเตือนต่อโซน (กติกาเดียวกับแอป: ถึงโซน → พัก 1 ชม. · ทะลุขอบ $2 → พัก 30 นาที)
struct ZState { float k; bool inside, reached, hasReach, hasBreak; uint32_t lastReach, lastBreak; };
ZState zst[16]; int nzst = 0;
uint32_t alertUntil = 0, ledUntil = 0; char alertTxt[40] = ""; uint16_t alertCol = 0; uint8_t ledMask = 0;

// การตั้งค่า
// ปิดจอ: manualOff = กดปิดจากเมนู · autoOff = 0 ไม่ปิดเอง, 1 ตลาดปิด, 2 ตลาดปิด+กลางคืน 00-07, 3 ตลาดปิด+กลางคืน 22-07
bool manualOff = false, scrOff = false; int autoOff = 1; uint32_t wakeUntil = 0;
const char *AUTO_N[4] = {"OFF: NEVER", "OFF: MKT", "OFF: MKT+0-7", "OFF: MKT+22-7"};
bool wlow = true;  // ลดกำลังส่ง WiFi (11dBm) ลดไฟกระชาก — ใช้กับแบต/ไฟเลี้ยงอ่อน · ปรับที่หน้า WiFi ปุ่ม TX
void applyTx() { WiFi.setTxPower(wlow ? WIFI_POWER_11dBm : WIFI_POWER_19_5dBm); }
bool spi40 = false;  // ส่งภาพไปจอ 40MHz (ค่าเริ่ม 27MHz) · แตะจอค้างตอนเปิดเครื่อง = กลับ 27MHz
int rotIdx = 1; bool muted = false; int brightIdx = 0; int tfIdx = 0; int zoomIdx = 2;
const uint8_t BRIGHT[3] = {220, 110, 35};
const char *TF_Q[4] = {"1", "5", "15", "60"};
const char *TF_N[4] = {"1m", "5m", "15m", "1h"};
const int ZOOM[6] = {20, 30, 45, 60, 90, 120};

enum Screen { SC_MAIN, SC_MENU, SC_WIFI, SC_KB, SC_DASH, SC_SND };
Screen sc = SC_MAIN;

// layout
int W, H; bool LS;
const int HDR = 26, STAT = 16, TB = 24;
int yChart, hChart, yTool;

void fireAlert(const char *txt, uint16_t col, uint8_t led, int kind); void drawChart(); void drawDash(); void drawSnd(); void openDash();
void tickCandle(); void evalAlerts(); bool checkUpdate(); void pauseNet(bool p);
void doUpdate(); void drawStatus(); void drawWifi(); void drawKb(); void drawMain(); void drawHeader(bool full = false); void drawMenu(); void openWifi();
float livePrice(); bool perpFresh();
void openCode(const char *msg); void finishCode(); void submitCode();

// ---------------- เครื่องมือทั่วไป ----------------
float jf(JsonVariant v) { return v.isNull() ? NAN : v.as<float>(); }
bool okf(float v) { return !isnan(v); }

void setLed(uint8_t m) {  // bit0 R, bit1 G, bit2 B
  digitalWrite(LED_R, (m & 1) ? LOW : HIGH);
  digitalWrite(LED_G, (m & 2) ? LOW : HIGH);
  digitalWrite(LED_B, (m & 4) ? LOW : HIGH);
}

bool wasDown = false;
bool tapped(int32_t &x, int32_t &y) {
  int32_t tx, ty;
  bool d = lcd.getTouch(&tx, &ty) > 0;
  if (d && !wasDown) { wasDown = true; x = tx; y = ty; return true; }
  if (!d) wasDown = false;
  return false;
}

void button(int x, int y, int w, int h, const char *t, uint16_t bg, uint16_t fg, uint16_t border = 0) {
  lcd.fillRoundRect(x, y, w, h, 5, bg);
  if (border) lcd.drawRoundRect(x, y, w, h, 5, border);
  lcd.setFont(&fonts::Font2); lcd.setTextColor(fg, bg);
  lcd.setTextDatum(middle_center); lcd.drawString(t, x + w / 2, y + h / 2 + 1);
  lcd.setTextDatum(top_left);
}

void applyRotation(int r) {
  lcd.setRotation(r);
  W = lcd.width(); H = lcd.height(); LS = W > H;
  yChart = HDR + STAT;
  yTool = H - TB;
  hChart = yTool - yChart;
  spr.deleteSprite(); sspr.deleteSprite();
  spr.setColorDepth(8);
  spr.createSprite(W, hChart);
  sspr.setColorDepth(8);  sOk = sspr.createSprite(W, STAT) != nullptr;
}

// ---------------- ดึงข้อมูล (เรียกจากงานเน็ตเท่านั้น) ----------------
Data NT;  // ที่พักระหว่างแปลง JSON (งานเน็ตใช้คนเดียว)
bool fetchMini(int tf) {
  WiFiClientSecure cli; cli.setInsecure();
  HTTPClient http; http.setTimeout(9000);
  String url = String(DATA_URL) + TF_Q[tf] + "&code=" + urlEnc(loginCode);
  if (!http.begin(cli, url)) { miniErr = -100; return false; }
  int code = http.GET();
  if (code != 200) { http.end(); miniErr = code; return false; }
  String body = http.getString();
  http.end();
  JsonDocument doc;
  if (deserializeJson(doc, body)) { miniErr = -200; return false; }
  if (!doc["error"].isNull()) { miniErr = -300; return false; }

  NT.tf = tf;
  NT.p = jf(doc["p"]); NT.bs = doc["bs"] | 60; NT.lt = doc["lt"] | 0; NT.off = jf(doc["off"]);
  NT.nb = 0;
  for (JsonVariant v : doc["b"].as<JsonArray>()) {
    if (NT.nb >= MAXB) break;
    JsonArray a = v.as<JsonArray>();
    for (int i = 0; i < 4; i++) NT.b[NT.nb][i] = jf(a[i]);
    if (okf(NT.b[NT.nb][3])) NT.nb++;
  }
  NT.F = jf(doc["F"]); NT.open = jf(doc["open"]); NT.em = jf(doc["em"]);
  NT.itd = jf(doc["itd"]); NT.gm = jf(doc["gm"]); NT.mp = jf(doc["mp"]);
  strlcpy(NT.exp, doc["exp"] | "", sizeof(NT.exp));
  NT.mkt = doc["mkt"] | true; mktOpen = NT.mkt;
  NT.cw = jf(doc["cw"]); NT.pw = jf(doc["pw"]);
  NT.ivA = jf(doc["iv"]); NT.sd = jf(doc["sd"]);
  NT.smOk = doc["sm"].is<JsonArray>();
  if (NT.smOk) { NT.smF = doc["sm"][0] | 0.0f; NT.smA = doc["sm"][1] | 0.0f; NT.smB = doc["sm"][2] | 0.0f; NT.smC = doc["sm"][3] | 0.0f; }
  NT.osM = jf(doc["os"][0]); NT.osS = jf(doc["os"][1]); NT.vsM = jf(doc["vs"][0]); NT.vsS = jf(doc["vs"][1]);
  if (doc["dl"].is<JsonArray>()) { NT.dlS = doc["dl"][0] | 0; const char *dm = doc["dl"][1] | "N"; NT.dlM = dm[0]; } else NT.dlM = 0;
  NT.nn = 0;
  for (JsonVariant v : doc["nx"].as<JsonArray>()) {
    if (NT.nn >= 3) break;
    JsonArray a = v.as<JsonArray>();
    NT.nxT[NT.nn] = a[0] | 0UL; strlcpy(NT.nxS[NT.nn], a[1] | "", sizeof(NT.nxS[0])); NT.nn++;
  }
  NT.nz = 0;
  for (JsonVariant v : doc["z"].as<JsonArray>()) {
    if (NT.nz >= 12) break;
    JsonArray a = v.as<JsonArray>();
    Zone &q = NT.z[NT.nz++];
    q.k = a[0] | 0.0f; q.lo = a[1] | 0.0f; q.hi = a[2] | 0.0f;
    const char *t = a[3] | "V"; q.t = t[0];
    q.c = a[4] | 0L; q.p = a[5] | 0L;
  }
  NT.ns = 0;
  for (JsonVariant v : doc["s"].as<JsonArray>()) {
    if (NT.ns >= MAXS) break;
    JsonArray a = v.as<JsonArray>();
    Strike &q = NT.s[NT.ns++];
    q.k = a[0] | 0.0f; q.c = a[1] | 0L; q.p = a[2] | 0L; q.vc = a[3] | 0L; q.vp = a[4] | 0L;
    q.rc = a[5] | 0; q.rp = a[6] | 0; q.tv = a[7] | 0; q.iv = a[8] | 0;
  }
  xSemaphoreTake(mx, portMAX_DELAY);
  memcpy(&ND, &NT, sizeof(Data)); ndReady = true;
  xSemaphoreGive(mx);
  return true;
}

// ---------------- เสียง (LEDC, ปรับระดับเสียงด้วย duty) ----------------
// ชนิดแจ้งเตือน: 0 เข้าโซน, 1 ทะลุโซน, 2 ข่าวแดง · เสียง: 0 ปิด, 1 BEEP, 2 CHIME, 3 ALARM
const char *SND_N[4] = {"OFF", "BEEP", "CHIME", "ALARM"};
const char *VOL_N[4] = {"LOW", "MID", "HIGH", "MAX"};
const uint16_t VOLD[4] = {10, 40, 140, 512};  // duty 10-bit (512 = 50% ดังสุด)
int sndVol = 2; int sndType[3] = {1, 3, 2};
struct Note { uint16_t f, ms; };
Note pq[16]; int pqn = 0, pqi = 0; uint32_t pqAt = 0; bool pqOn = false;
#define SPK_CH 4
void spkInit() {
#if ESP_ARDUINO_VERSION_MAJOR >= 3
  ledcAttach(SPK, 2000, 10); ledcWrite(SPK, 0);
#else
  ledcSetup(SPK_CH, 2000, 10); ledcAttachPin(SPK, SPK_CH); ledcWrite(SPK_CH, 0);
#endif
}
void spkOut(uint16_t f) {
#if ESP_ARDUINO_VERSION_MAJOR >= 3
  if (!f) { ledcWrite(SPK, 0); return; }
  ledcWriteTone(SPK, f); ledcWrite(SPK, VOLD[sndVol]);
#else
  if (!f) { ledcWrite(SPK_CH, 0); return; }
  ledcWriteTone(SPK_CH, f); ledcWrite(SPK_CH, VOLD[sndVol]);
#endif
}
void playPattern(int t) {
  static const Note P1[] = {{2200, 120}, {0, 100}, {2200, 120}};
  static const Note P2[] = {{1568, 140}, {0, 30}, {2093, 140}, {0, 30}, {2637, 260}};
  static const Note P3[] = {{2600, 150}, {1800, 150}, {2600, 150}, {1800, 150}, {2600, 150}, {1800, 150}, {2600, 150}, {1800, 150}};
  const Note *p = t == 1 ? P1 : t == 2 ? P2 : t == 3 ? P3 : nullptr;
  int n = t == 1 ? 3 : t == 2 ? 5 : t == 3 ? 8 : 0;
  if (!p) return;
  memcpy(pq, p, sizeof(Note) * n); pqn = n; pqi = 0; pqAt = 0; pqOn = true;
}
void playKind(int kind) { if (!muted) playPattern(sndType[kind]); }
void servicePlayer() {
  if (!pqOn) return;
  uint32_t ms = millis();
  if (ms < pqAt) return;
  if (pqi >= pqn) { spkOut(0); pqOn = false; return; }
  spkOut(pq[pqi].f); pqAt = ms + pq[pqi].ms; pqi++;
}
void stopSound() { pqOn = false; spkOut(0); }

// ---------------- แจ้งเตือน ----------------
void fireAlert(const char *txt, uint16_t col, uint8_t led, int kind) {  // kind: 0 โซน, 1 ทะลุ, 2 ข่าว
  strlcpy(alertTxt, txt, sizeof(alertTxt));
  alertCol = col; alertUntil = millis() + 60000; ledUntil = millis() + 15000; ledMask = led;
  playKind(kind);
  if (scrOff) { uint32_t w = millis() + 60000; if (w > wakeUntil) wakeUntil = w; }  // จอดับอยู่: เปิดให้เห็นแจ้งเตือน 60 วินาที
}

uint16_t zoneCol(char t) { return t == 'C' ? C_CALL : t == 'P' ? C_PUT : C_GOLD; }

void evalAlerts() {
  float P = livePrice();
  if (!haveData || !okf(P) || !D.mkt) return;
  uint32_t now = millis() / 1000;
  // แท่ง M5 (ตามเวลา NTP): เมื่อขึ้นช่วง 5 นาทีใหม่ ราคาสุดท้ายของช่วงก่อน = ราคาปิด M5 · ใช้ยืนยันการทะลุ (แบบเดียวกับแอป/Telegram)
  static uint32_t m5b = 0; static float m5c = NAN;
  time_t tn = time(nullptr);
  uint32_t bucket = tn > 1700000000 ? (uint32_t)(tn / 300) : now / 300;
  float m5 = NAN;
  if (m5b && bucket != m5b && okf(m5c)) m5 = m5c;
  m5b = bucket; m5c = P;
  ZState nw[16]; int n = 0;
  for (int i = 0; i < D.nz && n < 16; i++) {
    Zone &z = D.z[i];
    ZState s; bool found = false;
    for (int j = 0; j < nzst; j++) if (zst[j].k == z.k) { s = zst[j]; found = true; break; }
    bool in = P >= z.lo && P <= z.hi;
    if (!found) { s = {z.k, in, in, in, false, now, 0}; nw[n++] = s; continue; }  // เพิ่งเห็นโซนนี้: จำไว้ก่อน ไม่เตือน
    char buf[40];
    const char *nm = z.t == 'C' ? "CALL" : z.t == 'P' ? "PUT" : "VOL";
    if (in && !s.inside && (!s.hasReach || now - s.lastReach >= 3600)) {
      s.hasReach = true; s.lastReach = now; s.reached = true;
      snprintf(buf, sizeof(buf), "ZONE %s %.0f", nm, z.k);
      fireAlert(buf, zoneCol(z.t), z.t == 'C' ? 2 : z.t == 'P' ? 1 : 3, 0);
    }
    s.inside = in;
    bool up = okf(m5) && m5 > z.hi + 2, dn = okf(m5) && m5 < z.lo - 2;  // ปิด M5 เลยขอบโซน $2
    if (s.reached && (up || dn) && (!s.hasBreak || now - s.lastBreak >= 1800)) {
      s.hasBreak = true; s.lastBreak = now; s.reached = false;
      snprintf(buf, sizeof(buf), "M5 BREAK %s %s %.0f", up ? "UP" : "DOWN", nm, z.k);
      fireAlert(buf, up ? C_UP : C_DN, up ? 2 : 1, 1);
    }
    nw[n++] = s;
  }
  memcpy(zst, nw, sizeof(ZState) * n); nzst = n;
}

void serviceAlerts() {
  uint32_t ms = millis();
  if (ledUntil && ms < ledUntil) setLed(((ms / 300) & 1) ? ledMask : 0);
  else if (ledUntil) { ledUntil = 0; setLed(0); }
  servicePlayer();
  if (alertUntil && ms >= alertUntil) { alertUntil = 0; if (sc == SC_MAIN) drawStatus(); }
}

// ---------------- หน้าหลัก ----------------
// ---- ไอคอนแถบหัวแบบ iPhone ----
void drawWifiIcon(LovyanGFX &g, int cx, int by, uint16_t bg) {  // cx = กึ่งกลาง, by = ฐาน
  int bars = 0;
  if (WiFi.status() == WL_CONNECTED) { int r = WiFi.RSSI(); bars = r > -60 ? 3 : r > -72 ? 2 : 1; }
  g.fillRect(cx - 9, by - 12, 19, 13, bg);
  for (int i = 0; i < 3; i++) {
    int r1 = 4 + i * 4;
    g.fillArc(cx, by, r1 - 2, r1, 225, 315, i < bars ? C_TEXT : C_LINE);
  }
  g.fillCircle(cx, by - 1, 1, bars ? C_TEXT : C_LINE);
}
void drawBattIcon(LovyanGFX &g, int x, int y, uint16_t bg) {  // กรอบ 22x11
  g.fillRect(x, y, 26, 11, bg);
  g.drawRoundRect(x, y, 22, 11, 3, C_DIM);
  g.fillRect(x + 22, y + 3, 2, 5, C_DIM);
  if (battPct < 0) {  // ไม่มีแบต/วัดไม่ได้ = ใช้ไฟ USB → รูปสายฟ้า
    g.fillRoundRect(x + 2, y + 2, 18, 7, 2, C_UP);
    g.fillTriangle(x + 12, y + 1, x + 8, y + 6, x + 12, y + 6, C_PANEL);
    g.fillTriangle(x + 10, y + 5, x + 14, y + 5, x + 10, y + 10, C_PANEL);
  } else {
    int w = max(1, 18 * battPct / 100);
    g.fillRoundRect(x + 2, y + 2, w, 7, 2, battPct <= 20 ? C_DN : C_TEXT);
  }
}

// แถบหัว: full = วาดพื้น/โลโก้ใหม่ทั้งแถบ · ปกติวาดเฉพาะส่วนที่เปลี่ยน (ตัวหนังสือมี padding ทับของเดิม → ไม่กระพริบ ไม่ต้องใช้ sprite)
// แถบสถานะวาดลง sprite 8-bit (ถ้าหน่วยความจำไม่พอ วาดลงจอตรง)
void drawHeader(bool full) {
  LovyanGFX &g = lcd;
  char buf[24];
  int x = LOGO_W + 5;
  if (full) {
    g.fillRect(0, 0, W, HDR, C_PANEL);
    g.drawFastHLine(0, HDR - 1, W, C_LINE);
    g.pushImage(2, 2, LOGO_W, LOGO_H, (const lgfx::rgb565_t *)LOGO);
  }
  g.setFont(&fonts::Font2); g.setTextColor(C_DIM, C_PANEL); g.setTextPadding(0);
  g.drawString("GC1", x, 6); x += g.textWidth("GC1") + 4;
  g.setFont(&fonts::Font4); g.setTextColor(C_GOLD, C_PANEL);
  int pw = g.textWidth("0000.0");
  float P = livePrice();
  if (okf(P)) snprintf(buf, sizeof(buf), "%.1f", P); else strcpy(buf, "----.-");
  g.setTextPadding(pw); g.drawString(buf, x, 1); x += pw + 4;
  // จุดสถานะสด (เขียว = ราคาสด, ทอง = ข้อมูลช้า, แดง = ไม่มีข้อมูล)
  bool fresh = perpFresh();
  uint16_t dc = !haveData ? C_DN : fresh ? C_CALL : (millis() - lastOk > 60000 ? C_DN : C_GOLD);
  g.fillCircle(x + 2, 13, 3, dc); x += 9;
  g.setFont(&fonts::Font2); g.setTextPadding(g.textWidth("+000.0"));
  if (LS && haveData && okf(P) && okf(D.open)) {
    float ch = P - D.open; snprintf(buf, sizeof(buf), "%+.1f", ch);
    g.setTextColor(ch >= 0 ? C_UP : C_DN, C_PANEL); g.drawString(buf, x, 6);
  } else if (LS) { g.setTextColor(C_DIM, C_PANEL); g.drawString(" ", x, 6); }
  g.setTextPadding(0);
  // ขวา: เวลา · WiFi · แบต
  int bx = W - 27; drawBattIcon(g, bx, 8, C_PANEL);
  drawWifiIcon(g, bx - 13, 19, C_PANEL);
  struct tm t;
  if (getLocalTime(&t, 0)) strftime(buf, sizeof(buf), "%H:%M", &t); else strcpy(buf, "--:--");
  g.setFont(&fonts::Font2); g.setTextColor(C_TEXT, C_PANEL); g.setTextDatum(top_right);
  g.setTextPadding(g.textWidth("00:00")); g.drawString(buf, bx - 25, 6); g.setTextPadding(0); g.setTextDatum(top_left);
  if (newVer[0]) {  // มีเวอร์ชันใหม่: ลูกศรทองหน้าเวลา (MENU → UPDATE)
    int ax = bx - 25 - g.textWidth("00:00") - 10;
    g.fillTriangle(ax, 6, ax - 5, 12, ax + 5, 12, C_GOLD); g.fillRect(ax - 2, 12, 5, 6, C_GOLD);
  }
}

void drawStatus() {
  LovyanGFX &g = sOk ? (LovyanGFX &)sspr : (LovyanGFX &)lcd;
  int y = sOk ? 0 : HDR;
  if (alertUntil) {
    g.fillRect(0, y, W, STAT, alertCol);
    g.setFont(&fonts::Font2); g.setTextColor(C_BG, alertCol);
    g.setTextDatum(middle_center); g.drawString(alertTxt, W / 2, y + STAT / 2); g.setTextDatum(top_left);
    if (sOk) sspr.pushSprite(0, HDR);
    return;
  }
  g.fillRect(0, y, W, STAT, C_BG);
  g.setFont(&fonts::Font0);
  char buf[48];
  float P = livePrice();
  time_t tnow = time(nullptr); int ni = -1;
  if (haveData && tnow > 1700000000) for (int i = 0; i < D.nn; i++) if (D.nxT[i] > (uint32_t)tnow && D.nxT[i] - tnow <= 3600) { ni = i; break; }
  if (ni >= 0) {  // ข่าวแดงภายใน 1 ชม.: แสดงแทน EM
    uint32_t lt = D.nxT[ni] + 7 * 3600;
    snprintf(buf, sizeof(buf), "NEWS %02lu:%02lu %lum", (unsigned long)((lt / 3600) % 24), (unsigned long)((lt / 60) % 60), (unsigned long)((D.nxT[ni] - tnow + 59) / 60));
    g.setTextColor(C_GOLD, C_BG); g.setTextDatum(middle_right); g.drawString(buf, W - 4, y + STAT / 2);
  } else if (haveData) {
    if (LS) { if (okf(D.em)) snprintf(buf, sizeof(buf), "EM %.1f  exp %s", D.em, D.exp); else snprintf(buf, sizeof(buf), "exp %s", D.exp); }
    else if (okf(P) && okf(D.open)) snprintf(buf, sizeof(buf), "%+.1f  EM %.1f", P - D.open, okf(D.em) ? D.em : 0.0f);
    else buf[0] = 0;
    g.setTextColor(C_DIM, C_BG); g.setTextDatum(middle_right); g.drawString(buf, W - 4, y + STAT / 2);
  }
  g.setTextDatum(middle_left);
  if (!haveData) { g.setTextColor(C_DIM, C_BG); g.drawString("waiting for data...", 4, y + STAT / 2); }
  else if (!D.mkt) { g.setTextColor(C_DIM, C_BG); g.drawString("MARKET CLOSED", 4, y + STAT / 2); }
  else {
    int in = -1;
    for (int i = 0; i < D.nz; i++) if (P >= D.z[i].lo && P <= D.z[i].hi) { in = i; break; }
    if (in >= 0) {
      Zone &z = D.z[in];
      snprintf(buf, sizeof(buf), "IN %s ZONE %.0f", z.t == 'C' ? "CALL" : z.t == 'P' ? "PUT" : "VOL", z.k);
      g.setTextColor(zoneCol(z.t), C_BG); g.drawString(buf, 4, y + STAT / 2);
    } else {
      int bi = -1, ai = -1;
      for (int i = 0; i < D.nz; i++) {
        if (D.z[i].hi < P && (bi < 0 || D.z[i].hi > D.z[bi].hi)) bi = i;
        if (D.z[i].lo > P && (ai < 0 || D.z[i].lo < D.z[ai].lo)) ai = i;
      }
      int x = 4;
      if (ai >= 0) {
        snprintf(buf, sizeof(buf), "R %.0f +%.1f", D.z[ai].k, D.z[ai].lo - P);
        g.setTextColor(zoneCol(D.z[ai].t), C_BG); g.drawString(buf, x, y + STAT / 2); x += g.textWidth(buf) + 10;
      }
      if (bi >= 0) {
        snprintf(buf, sizeof(buf), "S %.0f -%.1f", D.z[bi].k, P - D.z[bi].hi);
        g.setTextColor(zoneCol(D.z[bi].t), C_BG); g.drawString(buf, x, y + STAT / 2);
      }
    }
  }
  g.setTextDatum(top_left);
  if (sOk) sspr.pushSprite(0, HDR);
}

// ---- กราฟ ----
void hDash(int x0, int x1, int y, uint16_t c, int on = 4, int off = 3) { for (int x = x0; x < x1; x += on + off) spr.drawFastHLine(x, y, min(on, x1 - x), c); }

struct Tag { int y; float v; uint16_t c; };
Tag tags[12]; int nTags;
void addTag(int y, float v, uint16_t c) { if (y >= 0 && y < hChart && nTags < 12) tags[nTags++] = {y, v, c}; }

const int AX = 38;               // แกนราคาขวา
int panBars = 0; float yShift = 0; bool panAuto = true;  // panAuto: โหมด AUTO = เว้นที่ว่างขวา ~15% ของแท่งที่เห็น (ลากแล้วชิดขวาได้)  // เลื่อนกราฟ: ย้อนหลังกี่แท่ง / เลื่อนราคาขึ้นลง
float lastPPP = 0.1f, lastCW = 6;   // ราคาต่อพิกเซล / ความกว้างแท่ง (ใช้ตอนลาก)

float chLo = 0, chHi = 1, chCW = 6; int chFirst = 0, chN = 1;  // สเกลกราฟล่าสุด (ใช้กับเส้นเล็ง)
bool crossOn = false; int crossX = 0, crossY = 0;              // เส้นเล็ง: ไอคอน + บนแถบล่าง = เปิด/ปิด · เปิดอยู่: แตะ/ลากบนกราฟ = ย้ายเส้นเล็ง
void overlayCross();
// หน้าวินิจฉัยตอนยังไม่มีข้อมูลกราฟ (บอกว่าติดตรงไหน)
void drawDiag() {
  char b[48]; int y = 8;
  if (miniErr == 401) {  // รหัสเข้าใช้ไม่ถูก/หมดอายุ (ปกติจอจะไปหน้าใส่รหัสเอง)
    spr.setFont(&fonts::Font2); spr.setTextDatum(top_left); spr.setTextColor(C_GOLD); spr.drawString("APP CODE NEEDED", 8, y); y += 22;
    spr.setFont(&fonts::Font0); spr.setTextColor(C_DIM); spr.drawString("MENU > APP CODE  (same code as the app)", 8, y);
    return;
  }
  spr.setFont(&fonts::Font2); spr.setTextDatum(top_left);
  spr.setTextColor(C_GOLD); spr.drawString(haveData ? "no candles" : "loading data...", 8, y); y += 20;
  spr.setFont(&fonts::Font0); spr.setTextColor(C_DIM);
  if (WiFi.status() == WL_CONNECTED) snprintf(b, sizeof(b), "WiFi OK  %d dBm", WiFi.RSSI()); else strcpy(b, "WiFi: not connected");
  spr.drawString(b, 8, y); y += 12;
  snprintf(b, sizeof(b), "data: %s %d", miniErr == 0 ? "OK" : miniErr == 1 ? "waiting" : "ERROR", miniErr);
  spr.setTextColor(miniErr > 1 || miniErr < 0 ? C_DN : C_DIM); spr.drawString(b, 8, y); y += 12;
  spr.setTextColor(C_DIM);
  snprintf(b, sizeof(b), "price: %s", !okf(perp) ? "no price" : millis() - perpAt < 6000 ? "live" : "stale");
  spr.drawString(b, 8, y); y += 12;
  snprintf(b, sizeof(b), "heap %uk  max %uk", (unsigned)(ESP.getFreeHeap() / 1024), (unsigned)(ESP.getMaxAllocHeap() / 1024));
  spr.drawString(b, 8, y); y += 12;
  spr.drawString("v" FW_VER "  (photo this & send)", 8, y);
}

void drawChart() {
  spr.fillScreen(C_BG);
  if (!haveData || !D.nb) { drawDiag(); spr.pushSprite(0, yChart); return; }
  const int PW = W - AX;
  float P = livePrice();
  int n = min(ZOOM[zoomIdx], D.nb);
  // panBars > 0 = ดูย้อนหลัง · < 0 = ลากกราฟไปซ้าย เว้นที่ว่างด้านขวา (สูงสุด 80% ของจอ)
  if (panAuto) panBars = -max(2, n * 15 / 100);
  panBars = max(-(n * 4 / 5), min(panBars, D.nb - n));
  int last = D.nb - 1 - panBars, first = last - n + 1;
  // ช่วงราคาจากแท่งที่มองเห็น (แบบแอป) + การเลื่อนขึ้นลงด้วยนิ้ว
  float lo = 1e9, hi = -1e9;
  for (int i = max(0, first); i <= min(last, D.nb - 1); i++) { lo = min(lo, D.b[i][2]); hi = max(hi, D.b[i][1]); }
  if (panBars <= 0 && okf(P)) { lo = min(lo, P); hi = max(hi, P); }
  float span = max(hi - lo, 6.0f), mid = (lo + hi) / 2;
  lo = mid - span * 0.6f + yShift; hi = mid + span * 0.6f + yShift;
  lastPPP = (hi - lo) / (hChart - 1);
  chLo = lo; chHi = hi; chFirst = first; chN = n;
  auto Y = [&](float v) { return (int)roundf((hi - v) / (hi - lo) * (hChart - 1)); };
  nTags = 0;

  float rng = hi - lo, steps[] = {0.5, 1, 2, 2.5, 5, 10, 20, 25, 50, 100}, st = 100;
  for (float s : steps) if (rng / s <= 6) { st = s; break; }
  for (float v = ceilf(lo / st) * st; v <= hi; v += st) spr.drawFastHLine(0, Y(v), PW, C_GRID);

  // ---- โซน OI / Volume ราย strike (เหมือน drawOIBars ในแอป) ----
  long maxOI = 1, maxV = 1;
  for (int i = 0; i < D.ns; i++) { maxOI = max(maxOI, max(D.s[i].c, D.s[i].p)); maxV = max(maxV, max(D.s[i].vc, D.s[i].vp)); }
  int gap = 999; { int py = -999; for (int i = 0; i < D.ns; i++) { int y = Y(D.s[i].k); if (py != -999) gap = min(gap, abs(y - py)); py = y; } }
  int thick = max(1, min(4, gap / 2 - 1));
  int barMax = min((int)(PW * 0.30f), 100), volMax = min((int)(PW * 0.14f), 45), padL = 1;
  // ครึ่งความกว้างโซนตามช่วงเวลาไทย: Asia เช้า 06–10 ±2 · Asia สาย 10–14 ±1 · London/NY/กลางคืน ±1.5
  float zHalf = 1.5f; { struct tm t; if (getLocalTime(&t, 0)) { int m = t.tm_hour * 60 + t.tm_min; zHalf = m >= 360 && m < 600 ? 2.0f : m >= 600 && m < 840 ? 1.0f : 1.5f; } }
  for (int i = 0; i < D.ns; i++) {
    Strike &s = D.s[i];
    int y = Y(s.k); if (y < -10 || y > hChart + 10) continue;
    // v0.7.9 โซนแบบแอป V4.9.86–91 (ตาม 🌏 OI Session Fade): ทุกอันดับกว้างเท่ากันตามช่วงเวลา · อันดับ 1–3 เข้ม + เส้นทึบ · 4–10 จาง
    bool in5C = s.rc && s.rc <= 5, in5P = s.rp && s.rp <= 5;
    bool top3 = (s.rc && s.rc <= 3) || (s.rp && s.rp <= 3);
    if (in5C || in5P) hDash(0, PW, y, blend(in5C && (!in5P || s.c >= s.p) ? 0x2fbf8f : 0xe5576b, 0x04060a, top3 ? 0.75f : 0.3f), 4, 3);
    if (s.rc || s.rp) {
      bool useC = s.rc && (!s.rp || s.c >= s.p);
      int rk = useC ? s.rc : s.rp;
      float rt = max(0.0f, min(1.0f, (rk - 1) / 9.0f));
      static const uint8_t WF[2][2][3] = {{{185, 28, 28}, {253, 186, 116}}, {{4, 120, 87}, {134, 239, 172}}};  // [put/call][จาก อันดับ1 / ถึง อันดับ10]
      const uint8_t *f0 = WF[useC][0], *f1 = WF[useC][1];
      uint32_t wc = 0; for (int j = 0; j < 3; j++) wc = (wc << 8) | (uint8_t)roundf(f0[j] + (f1[j] - f0[j]) * rt);
      int y1 = Y(s.k + zHalf), y2 = Y(s.k - zHalf);
      spr.fillRect(0, y1, PW, max(1, y2 - y1), blend(wc, 0x04060a, top3 ? 0.34f : 0.07f));
      if (top3) { uint16_t lc = blend(wc, 0x04060a, 0.95f - 0.28f * rt); spr.drawFastHLine(0, y, PW, lc); spr.drawFastHLine(0, y + 1, PW, lc); }
    }
    if (s.tv) spr.drawFastHLine(0, y, PW, C_GOLD);
  }
  // กริดทองทุก $25 (xx00 / 25 / 50 / 75) แบบ quarterGrid ในแอป · ทับโซนแต่อยู่ใต้เส้นระดับและแท่งเทียน
  for (float v = ceilf(lo / 25) * 25; v <= hi; v += 25) spr.drawFastHLine(0, Y(v), PW, C_QGRID);
  if (okf(D.open) && okf(D.em)) { hDash(0, PW, Y(D.open + D.em), C_EM, 2, 3); hDash(0, PW, Y(D.open - D.em), C_EM, 2, 3); }
  if (okf(D.mp)) { int y = Y(D.mp); hDash(0, PW, y, C_MP); addTag(y, D.mp, C_MP); }
  if (okf(D.gm)) { int y = Y(D.gm); hDash(0, PW, y, C_GMM, 6, 2); addTag(y, D.gm, C_GMM); }
  if (okf(D.itd)) { int y = Y(D.itd); hDash(0, PW, y, C_GMI, 6, 2); addTag(y, D.itd, C_GMI); }
  // Call Wall / Put Wall: เส้นประยาวหนา 2px + ป้ายบนแกนราคา
  if (okf(D.cw)) { int y = Y(D.cw); hDash(0, PW, y, C_CALL, 10, 3); hDash(0, PW, y + 1, C_CALL, 10, 3); addTag(y, D.cw, C_CALL); }
  if (okf(D.pw)) { int y = Y(D.pw); hDash(0, PW, y, C_PUT, 10, 3); hDash(0, PW, y + 1, C_PUT, 10, 3); addTag(y, D.pw, C_PUT); }

  // แท่งเทียนเต็มความกว้าง (v0.5.5 ผู้ใช้ขอเอาที่เว้นขวา 22% ออก เพราะลากเลื่อนกราฟได้แล้ว)
  float cw = (float)(PW - 4) / n; lastCW = cw; chCW = cw;
  int bw = max(1, (int)(cw * 0.7f));
  for (int i = 0; i < n; i++) {
    if (first + i < 0 || first + i >= D.nb) continue;  // ช่องว่างด้านขวา (ลากไปซ้าย)
    float *b = D.b[first + i];
    int x = (int)(i * cw + cw / 2);
    uint16_t c = b[3] >= b[0] ? C_UP : C_DN;
    spr.drawFastVLine(x, Y(b[1]), max(1, Y(b[2]) - Y(b[1]) + 1), c);
    int yo = Y(b[0]), yc = Y(b[3]);
    spr.fillRect(x - bw / 2, min(yo, yc), bw, max(1, abs(yc - yo)), c);
  }

  // แท่ง OI จากขอบขวา + Volume จากซ้าย
  for (int i = 0; i < D.ns; i++) {
    Strike &s = D.s[i];
    int y = Y(s.k); if (y < 2 || y > hChart - 3) continue;
    if (s.c > 0) { int L = max(2L, barMax * s.c / maxOI); spr.fillRect(PW - L, y - thick, L, thick, C_CALL); }
    if (s.p > 0) { int L = max(2L, barMax * s.p / maxOI); spr.fillRect(PW - L, y, L, thick, C_PUT); }
    if (s.vc > 0) { int L = max(2L, volMax * s.vc / maxV); spr.fillRect(padL, y - thick, L, thick, C_VOLC); }
    if (s.vp > 0) { int L = max(2L, volMax * s.vp / maxV); spr.fillRect(padL, y, L, thick, C_VOLP); }
  }

  int yp = Y(P);
  if (okf(P)) hDash(0, PW, yp, C_GOLD, 2, 2);

  // แกนราคาขวา
  spr.fillRect(PW, 0, AX, hChart, C_BG);
  spr.drawFastVLine(PW, 0, hChart, C_LINE);
  char buf[12];
  spr.setFont(&fonts::Font0); spr.setTextDatum(middle_left); spr.setTextColor(C_DIM);
  for (float v = ceilf(lo / st) * st; v <= hi; v += st) {
    int y = Y(v); if (y < 5 || y > hChart - 5 || abs(y - yp) < 10) continue;
    bool clash = false; for (int t = 0; t < nTags; t++) if (abs(tags[t].y - y) < 9) clash = true;
    if (clash) continue;
    snprintf(buf, sizeof(buf), st < 1 ? "%.1f" : "%.0f", v); spr.drawString(buf, PW + 3, y);
  }
  for (int t = 0; t < nTags; t++) {
    if (abs(tags[t].y - yp) < 10) continue;
    int y = max(5, min(hChart - 6, tags[t].y));
    spr.fillRect(PW + 1, y - 5, AX - 1, 11, tags[t].c);
    snprintf(buf, sizeof(buf), "%.1f", tags[t].v);
    spr.setTextColor(C_BG); spr.drawString(buf, PW + 3, y);
  }
  if (okf(P) && yp >= 0 && yp < hChart) {
    spr.fillRect(PW + 1, max(0, yp - 6), AX - 1, 13, C_GOLD);
    snprintf(buf, sizeof(buf), "%.1f", P);
    spr.setTextColor(C_BG); spr.drawString(buf, PW + 3, max(6, yp));
  }
  if (crossOn) overlayCross();
  // เลื่อนกราฟอยู่: ปุ่ม AUTO (แตะป้ายนี้หรือแกนราคา = กลับอัตโนมัติ)
  if (!panAuto || fabsf(yShift) > 0.01f) {
    spr.fillRoundRect(PW - 50, 2, 48, 12, 3, C_PANEL);
    spr.setTextColor(C_GOLD); spr.setTextDatum(middle_center); spr.drawString("AUTO >", PW - 26, 8);
  }
  spr.setTextDatum(top_left);
  spr.pushSprite(0, yChart);
}
// ---------------- เส้นเล็ง (แตะ 1 ครั้งบนกราฟ แบบแอป) ----------------
// วาดทับ sprite กราฟก่อน push (drawChart เรียก) · ข้อมูลอัปเดตแล้วเส้นเล็งยังอยู่ที่เดิม
void overlayCross() {
  if (!haveData || !D.nb) return;
  const int PW = W - AX;
  int x = max(0, min(PW - 1, crossX)), y = crossY;
  int yy = max(0, min(hChart - 1, y - yChart));
  float price = chHi - yy * (chHi - chLo) / (hChart - 1);
  int i = max(0, min(chN - 1, (int)(x / chCW)));
  int bi = chFirst + i; bool hasBar = bi >= 0 && bi < D.nb; float *b = hasBar ? D.b[bi] : nullptr;
  int bx = (int)(i * chCW + chCW / 2);
  for (int yv = 0; yv < hChart; yv += 4) spr.drawFastVLine(bx, yv, 2, C_TEXT);
  for (int xv = 0; xv < PW; xv += 4) spr.drawFastHLine(xv, yy, 2, C_TEXT);
  char s[48];
  spr.setFont(&fonts::Font0); spr.setTextDatum(middle_left);
  spr.fillRect(PW + 1, max(0, yy - 6), AX - 1, 13, C_TEXT);
  snprintf(s, sizeof(s), "%.1f", price); spr.setTextColor(C_BG); spr.drawString(s, PW + 3, max(6, yy));
  // กล่องข้อมูล: เวลาแท่ง OHLC + OI strike ใกล้สุด
  uint32_t bt = (D.lt && hasBar) ? D.lt - (uint32_t)(D.nb - 1 - bi) * D.bs + 7 * 3600 : 0;
  int ks = -1; for (int j = 0; j < D.ns; j++) if (ks < 0 || fabsf(D.s[j].k - price) < fabsf(D.s[ks].k - price)) ks = j;
  int bw = 150, bh = (hasBar ? 34 : 4) + (ks >= 0 ? 12 : 0), boxX = x < PW / 2 ? PW - bw - 4 : 4, boxY = 4;
  spr.fillRoundRect(boxX, boxY, bw, bh, 4, C_PANEL); spr.drawRoundRect(boxX, boxY, bw, bh, 4, C_LINE);
  spr.setTextDatum(top_left);
  int ly = boxY + 4;
  if (hasBar) {
  snprintf(s, sizeof(s), "%02lu:%02lu  O %.1f", (unsigned long)((bt / 3600) % 24), (unsigned long)((bt / 60) % 60), b[0]);
  spr.setTextColor(C_TEXT); spr.drawString(s, boxX + 5, boxY + 4);
  snprintf(s, sizeof(s), "H %.1f  L %.1f", b[1], b[2]); spr.setTextColor(C_DIM); spr.drawString(s, boxX + 5, boxY + 15);
  snprintf(s, sizeof(s), "C %.1f", b[3]); spr.setTextColor(b[3] >= b[0] ? C_UP : C_DN); spr.drawString(s, boxX + 5, boxY + 26);
  ly = boxY + 36;
  }
  if (ks >= 0) {
    Strike &k = D.s[ks];
    snprintf(s, sizeof(s), "%.0f Call %ld Put %ld", k.k, k.c, k.p); spr.setTextColor(C_GOLD); spr.drawString(s, boxX + 5, ly);
  }
  spr.setTextDatum(top_left);
}

// แถบล่าง: ไทม์เฟรม · ซูม · รีเฟรช · ตั้งค่า
// ปุ่ม: 0-3 ไทม์เฟรม · 4 − · 5 + · 8 เส้นเล็ง (อยู่ถัดจาก +) · 6 รีเฟรช · 7 ตั้งค่า
int tbX[9], tbW[9];
void layoutToolbar() {
  int g = 3, iconW = LS ? 28 : 22, zw = LS ? 30 : 22;
  int tw = (W - 10 * g - 3 * iconW - 2 * zw) / 4, x = g;
  for (int i = 0; i < 4; i++) { tbX[i] = x; tbW[i] = tw; x += tw + g; }
  for (int i = 4; i < 6; i++) { tbX[i] = x; tbW[i] = zw; x += zw + g; }
  tbX[8] = x; tbW[8] = iconW; x += iconW + g;
  for (int i = 6; i < 8; i++) { tbX[i] = x; tbW[i] = iconW; x += iconW + g; }
}
void drawCrossIcon() {
  int x = tbX[8], y = yTool + 3, w = tbW[8], h = TB - 5, cx = x + w / 2, cy = y + h / 2;
  uint16_t bg = crossOn ? C_GOLD : C_PANEL, fg = crossOn ? hex(0x1a1405) : C_GOLD;
  lcd.fillRoundRect(x, y, w, h, 3, bg);
  if (!crossOn) lcd.drawRoundRect(x, y, w, h, 3, C_LINE);
  lcd.drawFastHLine(cx - 8, cy, 17, fg); lcd.drawFastVLine(cx, cy - 8, 17, fg);
  lcd.drawCircle(cx, cy, 4, fg);
}
void drawToolbarIcon(int idx, bool gear) {
  int x = tbX[idx], y = yTool + 3, w = tbW[idx], h = TB - 5;
  lcd.fillRoundRect(x, y, w, h, 3, C_PANEL);
  lcd.drawRoundRect(x, y, w, h, 3, C_LINE);
  int cx = x + w / 2, cy = y + h / 2;
  if (gear) {
    lcd.drawCircle(cx, cy, 5, C_GOLD);
    lcd.drawCircle(cx, cy, 2, C_GOLD);
    for (int i = 0; i < 8; i++) {
      float a = i * 0.785398f;
      lcd.drawLine(cx + (int)(6 * cosf(a)), cy + (int)(6 * sinf(a)),
                   cx + (int)(8 * cosf(a)), cy + (int)(8 * sinf(a)), C_GOLD);
    }
  } else {
    // Draw refresh arc with portable line primitives (LovyanGFX drawArc signatures vary).
    for (int deg = 35; deg < 310; deg += 15) {
      float a = deg * 0.017453293f, b = (deg + 15) * 0.017453293f;
      lcd.drawLine(cx + (int)(7 * cosf(a)), cy + (int)(7 * sinf(a)),
                   cx + (int)(7 * cosf(b)), cy + (int)(7 * sinf(b)), C_GOLD);
    }
    lcd.fillTriangle(cx + 6, cy - 5, cx + 9, cy - 1, cx + 4, cy - 1, C_GOLD);
  }
}
void drawToolbar() {
  layoutToolbar();
  lcd.fillRect(0, yTool, W, TB, C_BG);
  lcd.drawFastHLine(0, yTool, W, C_LINE);
  for (int i = 0; i < 4; i++) button(tbX[i], yTool + 3, tbW[i], TB - 5, TF_N[i], i == tfIdx ? C_GOLD : C_BG, i == tfIdx ? hex(0x1a1405) : C_DIM, i == tfIdx ? 0 : C_LINE);
  button(tbX[4], yTool + 3, tbW[4], TB - 5, "-", C_PANEL, zoomIdx < 5 ? C_TEXT : C_LINE, C_LINE);
  button(tbX[5], yTool + 3, tbW[5], TB - 5, "+", C_PANEL, zoomIdx > 0 ? C_TEXT : C_LINE, C_LINE);
  drawCrossIcon();
  drawToolbarIcon(6, false);
  drawToolbarIcon(7, true);
}

void drawMain() {
  lcd.fillScreen(C_BG);
  drawHeader(true); drawStatus(); drawChart(); drawToolbar();
}

// ---------------- เปิด/ปิดจอ ----------------
// ตลาดทองปิด: เสาร์ 05:00 – จันทร์ 05:00 เวลาไทย
bool schedOff() {
  if (!autoOff) return false;
  struct tm t;
  if (!getLocalTime(&t, 0)) return haveData && !D.mkt;
  int wd = t.tm_wday, h = t.tm_hour;
  bool closed = (wd == 6 && h >= 5) || wd == 0 || (wd == 1 && h < 5);
  if (closed) return true;
  if (autoOff == 2) return h < 7;
  if (autoOff == 3) return h >= 22 || h < 7;
  return false;
}
void setScreen(bool off) {
  if (off == scrOff) return;
  scrOff = off;
  if (off) { lcd.setBrightness(0); }
  else {
    lcd.setBrightness(BRIGHT[brightIdx]);
    if (sc == SC_MAIN) drawMain(); else if (sc == SC_MENU) drawMenu(); else if (sc == SC_DASH) drawDash(); else if (sc == SC_SND) drawSnd();
  }
}
void updateScreenPower() {
  if (sc == SC_WIFI || sc == SC_KB) { setScreen(false); return; }
  setScreen((manualOff || schedOff()) && millis() >= wakeUntil);
}

// ---------------- เมนูตั้งค่า ----------------
// ---------------- หน้า Dashboard (ผลวิเคราะห์ ds แบบตัวเลข) ----------------
// แตะแถบหัวในหน้ากราฟ = เปิด · แตะที่ไหนก็ได้ = ปิด · ข้อมูลจาก /mini/dash (Worker อ่านชีตผ่าน DASH_CODE)
struct Dash { bool ok; char err[32]; char u[24]; char tr; int sc, g, n; float lp[8]; char lk[8]; uint8_t ls[8]; };
Dash DSX, DU;               // DSX = งานเน็ตเขียน (ล็อก mx) · DU = สำเนาของจอ
volatile uint32_t dashSeq = 0; uint32_t seenDash = 0; volatile bool reqDash = false; uint32_t dashAt = 0;

bool fetchDash() {  // งานเน็ต
  static Dash X;
  WiFiClientSecure cli; cli.setInsecure();
  HTTPClient http; http.setTimeout(15000);
  String url = String(WORKER) + "/mini/dash?code=" + urlEnc(loginCode);
  memset(&X, 0, sizeof(X));
  bool ok = false;
  if (http.begin(cli, url)) {
    int code = http.GET();
    String body = code > 0 ? http.getString() : String();
    http.end();
    JsonDocument doc;
    if (code <= 0) snprintf(X.err, sizeof(X.err), "connect %d", code);
    else if (deserializeJson(doc, body)) snprintf(X.err, sizeof(X.err), "HTTP %d", code);
    else if (!doc["error"].isNull()) strlcpy(X.err, doc["error"] | "error", sizeof(X.err));
    else {
      X.ok = true; ok = true;
      strlcpy(X.u, doc["u"] | "", sizeof(X.u));
      const char *tr = doc["tr"] | "side"; X.tr = tr[0];
      X.sc = doc["sc"] | 0; X.g = doc["g"] | 50;
      for (JsonVariant v : doc["lv"].as<JsonArray>()) {
        if (X.n >= 8) break;
        JsonArray a = v.as<JsonArray>();
        X.lp[X.n] = a[0] | 0.0f; const char *k = a[1] | "P"; X.lk[X.n] = k[0]; X.ls[X.n] = a[2] | 1; X.n++;
      }
    }
  } else strcpy(X.err, "connect");
  xSemaphoreTake(mx, portMAX_DELAY); memcpy(&DSX, &X, sizeof(Dash)); dashSeq++; xSemaphoreGive(mx);
  return ok;
}

int dashPage = 0;  // 0 = สรุป ds, 1 = OI ราย strike + IV + SD, 2 = Volume วันนี้
const int DFT = 24;  // ความสูงแถบปุ่มล่าง
void drawDashP1();
void drawStrikeBars(bool vol);
void drawDashFooter() {
  int y = H - DFT, bw = (W - 16) / 3;
  lcd.fillRect(0, y, W, DFT, C_BG); lcd.drawFastHLine(0, y, W, C_LINE);
  button(4, y + 3, bw, DFT - 5, "CLOSE", C_PANEL, C_TEXT, C_LINE);
  button(8 + bw, y + 3, bw, DFT - 5, "< PREV", C_PANEL, C_TEXT, C_LINE);
  button(12 + 2 * bw, y + 3, bw, DFT - 5, "NEXT >", C_GOLD, hex(0x1a1405));
}
void drawDash() {
  if (dashPage == 0) drawDashP1(); else drawStrikeBars(dashPage == 2);
  char pg[8]; snprintf(pg, sizeof(pg), "%d/3", dashPage + 1);
  lcd.setFont(&fonts::Font0); lcd.setTextColor(C_GOLD, C_PANEL); lcd.setTextDatum(top_right); lcd.drawString(pg, W - 6, 7); lcd.setTextDatum(top_left);
  drawDashFooter();
}
void handleDashTap(int x, int y) {
  if (y < H - DFT) return;
  int bw = (W - 16) / 3;
  if (x < 6 + bw) { sc = SC_MAIN; drawMain(); return; }
  dashPage = x < 10 + 2 * bw ? (dashPage + 2) % 3 : (dashPage + 1) % 3;
  drawDash();
}
void drawDashP1() {
  if (dashSeq != seenDash) { xSemaphoreTake(mx, portMAX_DELAY); memcpy(&DU, &DSX, sizeof(Dash)); seenDash = dashSeq; xSemaphoreGive(mx); }
  lcd.fillScreen(C_BG);
  lcd.fillRect(0, 0, W, 22, C_PANEL);
  lcd.setFont(&fonts::Font2); lcd.setTextColor(C_GOLD, C_PANEL); lcd.drawString("DASHBOARD  ds", 6, 3);
  lcd.setFont(&fonts::Font0); lcd.setTextColor(C_DIM, C_PANEL); lcd.setTextDatum(top_right);
  if (DU.ok && DU.u[0]) lcd.drawString(DU.u, W - 30, 7);
  lcd.setTextDatum(top_left);
  if (!seenDash) { lcd.setFont(&fonts::Font2); lcd.setTextColor(C_DIM, C_BG); lcd.drawString("loading...", 10, 40); return; }
  if (!DU.ok) {
    lcd.setFont(&fonts::Font2); lcd.setTextColor(C_DN, C_BG); lcd.drawString("no dashboard data", 10, 40);
    lcd.setTextColor(C_DIM, C_BG); lcd.drawString(DU.err, 10, 60);
    if (strstr(DU.err, "DASH_CODE")) { lcd.drawString("owner: set DASH_CODE secret", 10, 80); lcd.drawString("in Cloudflare (gc-yahoo)", 10, 96); }
    return;
  }
  char b[40];
  int colW = LS ? W / 2 : W, x0 = 8, y = 30;
  // 1) ทิศ + คะแนน
  uint16_t tc = DU.tr == 'u' ? C_UP : DU.tr == 'd' ? C_DN : C_GOLD;
  int ax = x0 + 12, ay = y + 14;
  if (DU.tr == 'u') lcd.fillTriangle(ax, ay - 12, ax - 11, ay + 8, ax + 11, ay + 8, tc);
  else if (DU.tr == 'd') lcd.fillTriangle(ax, ay + 12, ax - 11, ay - 8, ax + 11, ay - 8, tc);
  else lcd.fillTriangle(ax + 12, ay, ax - 8, ay - 11, ax - 8, ay + 11, tc);
  lcd.setFont(&fonts::Font4); lcd.setTextColor(tc, C_BG);
  snprintf(b, sizeof(b), "%s %+d", DU.tr == 'u' ? "UP" : DU.tr == 'd' ? "DOWN" : "SIDE", DU.sc);
  lcd.drawString(b, x0 + 30, y + 2);
  y += 34;
  // แถบคะแนน −100..+100
  int bw = colW - 2 * x0, bx = x0;
  lcd.fillRect(bx, y, bw / 3, 6, C_DN); lcd.fillRect(bx + bw / 3, y, bw / 3, 6, C_LINE); lcd.fillRect(bx + 2 * bw / 3, y, bw - 2 * bw / 3, 6, C_UP);
  int mx_ = bx + (DU.sc + 100) * bw / 200; lcd.fillTriangle(mx_, y + 8, mx_ - 5, y + 15, mx_ + 5, y + 15, C_TEXT);
  lcd.setFont(&fonts::Font0); lcd.setTextColor(C_DIM, C_BG);
  lcd.drawString("-100", bx, y + 17); lcd.setTextDatum(top_right); lcd.drawString("+100", bx + bw, y + 17); lcd.setTextDatum(top_center); lcd.drawString("TREND SCORE", bx + bw / 2, y + 17); lcd.setTextDatum(top_left);
  y += 32;
  // 2) เข็มวัดแรงกดดัน ขาย ↔ ซื้อ
  int r = min(colW / 2 - 14, LS ? 62 : 56), cx = x0 + (colW - 2 * x0) / 2, cy = y + r + 4;
  lcd.fillArc(cx, cy, r - 12, r, 180, 239, C_DN);
  lcd.fillArc(cx, cy, r - 12, r, 241, 299, C_LINE);
  lcd.fillArc(cx, cy, r - 12, r, 301, 360, C_UP);
  float a = (180 + DU.g * 1.8f) * 0.0174533f;
  lcd.drawWideLine(cx, cy, cx + cosf(a) * (r - 16), cy + sinf(a) * (r - 16), 3, C_TEXT);
  lcd.fillCircle(cx, cy, 5, C_GOLD);
  lcd.setFont(&fonts::Font2); lcd.setTextColor(C_TEXT, C_BG); lcd.setTextDatum(bottom_center);
  snprintf(b, sizeof(b), "%d", DU.g); lcd.drawString(b, cx, cy - 10);
  lcd.setFont(&fonts::Font0); lcd.setTextColor(C_DIM, C_BG); lcd.setTextDatum(top_center);
  lcd.drawString(DU.g < 40 ? "SELL SIDE" : DU.g > 60 ? "BUY SIDE" : "BALANCED", cx, cy + 6);
  lcd.setTextDatum(top_left);
  lcd.drawString("SELL", cx - r, cy + 6); lcd.setTextDatum(top_right); lcd.drawString("BUY", cx + r, cy + 6); lcd.setTextDatum(top_left);
  // Dealer รับ/ไล่ (แบบ dealer.js ในแอป ไม่รวม Big Traders)
  if (D.dlM) {
    uint16_t dc = D.dlM == 'A' ? hex(0x22e39a) : D.dlM == 'C' ? hex(0xff8a3d) : C_DIM;
    if (D.dlM == 'N') snprintf(b, sizeof(b), "DEALER NEUTRAL %+d", D.dlS); else snprintf(b, sizeof(b), "DEALER %s %d%%", D.dlM == 'A' ? "ABSORB" : "CHASE", abs(D.dlS));
    lcd.setFont(&fonts::Font2); lcd.setTextColor(dc, C_BG); lcd.setTextDatum(top_center); lcd.drawString(b, cx, cy + 18); lcd.setTextDatum(top_left); lcd.setFont(&fonts::Font0);
  }
  // 3) แนวสำคัญ + ราคาปัจจุบัน
  int lx = LS ? W / 2 + 6 : x0, ly = LS ? 30 : cy + 38, lw = (LS ? W / 2 : W) - 14;
  int ny = H - DFT - 50;  // ตารางตัวเลข 4 แถวเหนือแถบปุ่ม
  float P = livePrice();
  lcd.setFont(&fonts::Font0);
  lcd.setTextColor(C_DIM, C_BG); lcd.drawString("KEY LEVELS (ds)", lx, ly); ly += 12;
  bool placed = false;
  for (int i = 0; i <= DU.n && ly < ny - 12; i++) {
    if (!placed && okf(P) && (i == DU.n || DU.lp[i] < P)) {
      lcd.fillRect(lx, ly - 1, lw, 11, C_GOLD); lcd.setTextColor(C_BG, C_GOLD);
      snprintf(b, sizeof(b), "NOW %.1f", P); lcd.drawString(b, lx + 3, ly); ly += 12; placed = true;
    }
    if (i == DU.n) break;
    uint16_t c = DU.lk[i] == 'R' ? C_CALL : DU.lk[i] == 'S' ? C_PUT : C_GOLD;
    lcd.setTextColor(c, C_BG);
    snprintf(b, sizeof(b), "%c %.0f %s", DU.lk[i], DU.lp[i], DU.ls[i] >= 3 ? "***" : DU.ls[i] == 2 ? "**" : "*");
    lcd.drawString(b, lx + 3, ly);
    if (okf(P)) { snprintf(b, sizeof(b), "%+.1f", DU.lp[i] - P); lcd.setTextColor(C_DIM, C_BG); lcd.setTextDatum(top_right); lcd.drawString(b, lx + lw - 2, ly); lcd.setTextDatum(top_left); }
    ly += 12;
  }
  // 4) ตัวเลขจากออปชัน
  int cw2 = (LS ? W / 2 : W) / 2 - 6, nx0 = LS ? W / 2 + 6 : x0;
  struct NV { const char *n; float v; uint16_t c; } nv[8] = {{"MaxPain", D.mp, C_MP}, {"gmf itd", D.itd, C_GMI}, {"gmf M", D.gm, C_GMM}, {"EM +-", D.em, C_EM}, {"CallWall", D.cw, C_CALL}, {"PutWall", D.pw, C_PUT}, {"ATM IV%", D.ivA, C_TEXT}, {"OI 1SD", D.sd, C_GOLD}};
  for (int i = 0; i < 8; i++) {
    int xx = nx0 + (i % 2) * cw2, yy = ny + (i / 2) * 12;
    lcd.setTextColor(C_DIM, C_BG); lcd.drawString(nv[i].n, xx, yy);
    if (okf(nv[i].v)) { snprintf(b, sizeof(b), "%.1f", nv[i].v); lcd.setTextColor(nv[i].c, C_BG); lcd.setTextDatum(top_right); lcd.drawString(b, xx + cw2 - 4, yy); lcd.setTextDatum(top_left); }
  }
}

// หน้า 2/3: กราฟแท่งราย strike เต็มจอ แบบ CME QuikStrike — OI (Call/Put) + เส้นโค้ง IV + แถบ ±1/±2 SD ของ OI · หรือ Volume วันนี้ + SD ของ Volume
void drawStrikeBars(bool vol) {
  lcd.fillScreen(C_BG);
  lcd.fillRect(0, 0, W, 22, C_PANEL);
  lcd.setFont(&fonts::Font2); lcd.setTextColor(C_GOLD, C_PANEL); lcd.drawString(vol ? "VOLUME TODAY" : "OPEN INTEREST + IV", 6, 3);
  lcd.setFont(&fonts::Font0); lcd.setTextColor(C_DIM, C_PANEL); lcd.setTextDatum(top_right);
  if (D.exp[0]) { char e[24]; snprintf(e, sizeof(e), "exp %s", D.exp); lcd.drawString(e, W - 30, 7); }
  lcd.setTextDatum(top_left);
  float P = livePrice(); if (!okf(P)) P = D.F;
  if (!haveData || D.ns < 2 || !okf(P)) { lcd.setFont(&fonts::Font2); lcd.setTextColor(C_DIM, C_BG); lcd.drawString("no data", 10, 40); return; }
  // ช่วงแกนนอน = strike ทั้งหมดที่ได้มา (±$80 จากราคา) → เต็มจอ
  float k0 = D.s[0].k, k1 = D.s[D.ns - 1].k; if (k1 - k0 < 10) { k0 -= 5; k1 += 5; }
  float pad = (k1 - k0) * 0.02f; k0 -= pad; k1 += pad;
  const int px0 = 2, px1 = W - (vol ? 2 : 26), py0 = 34, py1 = H - DFT - 12;
  auto X = [&](float k) { return px0 + (int)((k - k0) / (k1 - k0) * (px1 - px0)); };
  // แถบ SD ของการกระจาย OI / Volume (ค่ากลางถ่วงน้ำหนัก ± SD)
  float mu = vol ? D.vsM : D.osM, sd = vol ? D.vsS : D.osS;
  char t[32];
  if (okf(mu) && okf(sd) && sd > 0) {
    int a2 = max(px0, X(mu - 2 * sd)), b2 = min(px1, X(mu + 2 * sd)), a1 = max(px0, X(mu - sd)), b1 = min(px1, X(mu + sd));
    if (b2 > a2) lcd.fillRect(a2, py0, b2 - a2, py1 - py0, blend(0xe0b44c, 0x04060a, 0.07f));
    if (b1 > a1) lcd.fillRect(a1, py0, b1 - a1, py1 - py0, blend(0xe0b44c, 0x04060a, 0.16f));
    int xm = X(mu); if (xm > px0 && xm < px1) for (int y = py0; y < py1; y += 6) lcd.drawFastVLine(xm, y, 3, blend(0xe0b44c, 0x04060a, 0.5f));
    lcd.setTextColor(C_GOLD, C_BG); lcd.setTextDatum(top_center);
    if (a1 > px0 + 12) lcd.drawString("-1SD", a1, py0 + 12);
    if (b1 < px1 - 12) lcd.drawString("+1SD", b1, py0 + 12);
    if (a2 > px0 + 12 && a1 - a2 > 28) lcd.drawString("-2SD", a2, py0 + 12);
    if (b2 < px1 - 12 && b2 - b1 > 28) lcd.drawString("+2SD", b2, py0 + 12);
    lcd.setTextDatum(top_left);
  }
  // แท่ง Call (ซ้ายของ strike) / Put (ขวา)
  long mx = 1; for (int j = 0; j < D.ns; j++) { Strike &q = D.s[j]; mx = max(mx, vol ? max(q.vc, q.vp) : max(q.c, q.p)); }
  int gap = px1 - px0; for (int j = 1; j < D.ns; j++) gap = min(gap, X(D.s[j].k) - X(D.s[j - 1].k));
  int bw = max(1, min(10, gap / 2 - 1)), hh = py1 - py0 - 4;
  uint16_t cc = vol ? C_VOLC : C_CALL, pc = vol ? C_VOLP : C_PUT;
  for (int j = 0; j < D.ns; j++) {
    Strike &q = D.s[j]; int x = X(q.k);
    long cv = vol ? q.vc : q.c, pv = vol ? q.vp : q.p;
    if (cv > 0) { int h = max(1L, hh * cv / mx); lcd.fillRect(x - bw, py1 - h, bw, h, cc); }
    if (pv > 0) { int h = max(1L, hh * pv / mx); lcd.fillRect(x, py1 - h, bw, h, pc); }
  }
  lcd.drawFastHLine(px0, py1, px1 - px0, C_LINE);
  lcd.setTextColor(C_DIM, C_BG); lcd.setTextDatum(top_center);
  int lastLx = -100;
  for (int j = 0; j < D.ns; j++) { int x = X(D.s[j].k); if (x - lastLx < 32 || x < px0 + 12 || x > px1 - 12) continue; snprintf(t, sizeof(t), "%.0f", D.s[j].k); lcd.drawString(t, x, py1 + 2); lastLx = x; }
  lcd.setTextDatum(top_left);
  // เส้นโค้ง IV (หน้า OI) แบบ CME: โค้งจากการ fit + จุด IV จริงราย strike · สเกลขวา
  if (!vol) {
    float lo = 1e9, hi = -1e9;
    auto ivc = [&](float k) { float d = k - D.smF; return D.smA + D.smB * d + D.smC * d * d; };
    if (D.smOk) for (int x = px0; x <= px1; x += 2) { float v = ivc(k0 + (float)(x - px0) / (px1 - px0) * (k1 - k0)); lo = min(lo, v); hi = max(hi, v); }
    for (int j = 0; j < D.ns; j++) if (D.s[j].iv > 0) { float v = D.s[j].iv / 10.0f; lo = min(lo, v); hi = max(hi, v); }
    if (hi > lo - 1e8 && hi > 0) {
      if (hi - lo < 2) { lo -= 1; hi += 1; }
      float pd = (hi - lo) * 0.08f; lo -= pd; hi += pd;
      auto Yv = [&](float v) { return py1 - 2 - (int)((v - lo) / (hi - lo) * (hh - 4)); };
      for (int j = 0; j < D.ns; j++) if (D.s[j].iv > 0) lcd.fillCircle(X(D.s[j].k), Yv(D.s[j].iv / 10.0f), 1, C_DIM);
      if (D.smOk) { int ppx = -1, ppy = 0; for (int x = px0; x <= px1; x += 2) { int y = Yv(ivc(k0 + (float)(x - px0) / (px1 - px0) * (k1 - k0))); if (y >= py0 && y <= py1 && ppx >= 0) lcd.drawWideLine(ppx, ppy, x, y, 1.0f, C_TEXT); ppx = x; ppy = max(py0, min(py1, y)); } }
      lcd.setTextColor(C_TEXT, C_BG);
      snprintf(t, sizeof(t), "%.1f", hi); lcd.drawString(t, px1 + 2, py0);
      snprintf(t, sizeof(t), "%.1f", lo); lcd.drawString(t, px1 + 2, py1 - 9);
      lcd.drawString("IV%", px1 + 2, (py0 + py1) / 2 - 4);
    }
  }
  // ราคาปัจจุบัน
  int xp = X(P); if (xp >= px0 && xp <= px1) { for (int y = py0; y < py1; y += 4) lcd.drawFastVLine(xp, y, 2, C_GOLD);
    snprintf(t, sizeof(t), "%.1f", P); lcd.setTextColor(C_BG, C_GOLD);
    int tw = lcd.textWidth(t) + 4, tx = max(px0, min(px1 - tw, xp - tw / 2)); lcd.fillRect(tx, py0, tw, 10, C_GOLD); lcd.drawString(t, tx + 2, py0 + 1); }
  // คำอธิบายบนแถบหัว (ใต้ชื่อ)
  int lx = 6; lcd.fillRect(lx, 25, 8, 6, cc); lcd.setTextColor(C_DIM, C_BG); lcd.drawString("C", lx + 10, 24);
  lcd.fillRect(lx + 20, 25, 8, 6, pc); lcd.drawString("P", lx + 30, 24);
  if (okf(sd)) { snprintf(t, sizeof(t), "%s SD %.1f", vol ? "VOL" : "OI", sd); lcd.setTextColor(C_GOLD, C_BG); lcd.setTextDatum(top_right); lcd.drawString(t, px1, 24); lcd.setTextDatum(top_left); }
  if (!vol && okf(D.ivA)) { snprintf(t, sizeof(t), "ATM IV %.1f%%", D.ivA); lcd.setTextColor(C_TEXT, C_BG); lcd.drawString(t, lx + 44, 24); }
}
void openDash() { sc = SC_DASH; dashPage = 0; reqDash = true; dashAt = millis(); drawDash(); }

// ---------------- หน้าตั้งค่าเสียงแจ้งเตือน ----------------
const int SND_ROWS = 6;  // ระดับเสียง · เข้าโซน · ทะลุโซน · ข่าวแดง · ทดสอบ · กลับ
void drawSnd() {
  lcd.fillScreen(C_BG);
  lcd.setFont(&fonts::Font2); lcd.setTextColor(C_GOLD, C_BG); lcd.drawString("ALERT SOUNDS", 8, 6);
  int bw = W - 16, bh = (H - 36) / SND_ROWS - 5, y = 28; char b[32];
  snprintf(b, sizeof(b), "VOLUME: %s", VOL_N[sndVol]); button(8, y, bw, bh, b, C_PANEL, C_TEXT, C_LINE); y += bh + 5;
  const char *kn[3] = {"ZONE", "BREAK", "NEWS"};
  for (int k = 0; k < 3; k++) { snprintf(b, sizeof(b), "%s: %s", kn[k], SND_N[sndType[k]]); button(8, y, bw, bh, b, C_PANEL, sndType[k] ? C_TEXT : C_DIM, C_LINE); y += bh + 5; }
  button(8, y, bw, bh, muted ? "TEST (SOUND IS OFF)" : "TEST", C_PANEL, muted ? C_DN : C_GOLD, C_LINE); y += bh + 5;
  button(8, y, bw, bh, "BACK", C_GOLD, hex(0x1a1405));
}
void handleSndTap(int x, int y) {
  int bh = (H - 36) / SND_ROWS - 5, i = (y - 28) / (bh + 5);
  if (y < 28 || i >= SND_ROWS) return;
  if (i == 0) { sndVol = (sndVol + 1) & 3; prefs.putInt("vol", sndVol); drawSnd(); playPattern(1); }
  else if (i <= 3) { int k = i - 1; sndType[k] = (sndType[k] + 1) & 3; const char *key[3] = {"sz", "sb", "sn"}; prefs.putInt(key[k], sndType[k]); drawSnd(); playPattern(sndType[k]); }
  else if (i == 4) playPattern(3);
  else { stopSound(); sc = SC_MENU; drawMenu(); }
}

// ---------------- อัปเดตผ่าน WiFi (OTA จาก GitHub) ----------------
long verNum(const char *v) { int a = 0, b = 0, c = 0; sscanf(v, "%d.%d.%d", &a, &b, &c); return a * 10000L + b * 100 + c; }

bool checkUpdate() {
  WiFiClientSecure cli; cli.setInsecure();
  HTTPClient http; http.setTimeout(8000);
  String url = String(OTA_BASE) + "version.json?t=" + String(millis());
  if (!http.begin(cli, url)) return false;
  int code = http.GET();
  if (code != 200) { http.end(); return false; }
  String body = http.getString(); http.end();
  JsonDocument doc;
  if (deserializeJson(doc, body)) return false;
  const char *v = doc["v"] | "";
  if (verNum(v) > verNum(FW_VER)) strlcpy(newVer, v, sizeof(newVer)); else newVer[0] = 0;
  return true;
}

void otaBar(int done, int total) {
  int bw = W - 40, x = 20, y = H / 2;
  int w = total > 0 ? (int)((long)bw * done / total) : 0;
  lcd.fillRect(x, y, w, 12, C_GOLD);
  lcd.fillRect(x + w, y, bw - w, 12, C_PANEL);
  char b[16]; snprintf(b, sizeof(b), "%d%%", total > 0 ? (int)(100L * done / total) : 0);
  lcd.setFont(&fonts::Font2); lcd.setTextColor(C_TEXT, C_BG); lcd.setTextDatum(top_center);
  lcd.fillRect(0, y + 18, W, 18, C_BG); lcd.drawString(b, W / 2, y + 18); lcd.setTextDatum(top_left);
}

void doUpdate() {
  lcd.fillScreen(C_BG);
  lcd.setFont(&fonts::Font2); lcd.setTextColor(C_GOLD, C_BG); lcd.setTextDatum(top_center);
  char t[40]; snprintf(t, sizeof(t), "Updating v" FW_VER " -> v%s", newVer);
  lcd.drawString(t, W / 2, H / 2 - 40);
  lcd.setTextColor(C_DIM, C_BG); lcd.drawString("do not unplug", W / 2, H / 2 - 20);
  lcd.setTextDatum(top_left);
  otaBar(0, 1);
  pauseNet(true);       // หยุดงานเน็ต + ปิด WebSocket ก่อน
  spr.deleteSprite(); sspr.deleteSprite(); sOk = false;  // คืนหน่วยความจำให้การดาวน์โหลด
  perpCli.stop();
  WiFiClientSecure cli; cli.setInsecure();
  httpUpdate.setFollowRedirects(HTTPC_STRICT_FOLLOW_REDIRECTS);
  httpUpdate.rebootOnUpdate(true);
  httpUpdate.setLedPin(-1);
  httpUpdate.onProgress([](int d, int tot) { otaBar(d, tot); });
  t_httpUpdate_return r = httpUpdate.update(cli, String(OTA_BASE) + "firmware.bin");
  // มาถึงตรงนี้ = ไม่สำเร็จ (สำเร็จจะรีสตาร์ทเอง) · เครื่องยังใช้เวอร์ชันเดิมได้ตามปกติ
  lcd.fillScreen(C_BG); lcd.setTextColor(C_DN, C_BG);
  lcd.drawString(r == HTTP_UPDATE_NO_UPDATES ? "No update" : "Update failed", 8, 8);
  lcd.setTextColor(C_DIM, C_BG); lcd.drawString(httpUpdate.getLastErrorString().substring(0, 40), 8, 30);
  delay(3000);
  applyRotation(rotIdx);
  pauseNet(false);
  sc = SC_MENU; drawMenu();
}

// ---------------- เมนูตั้งค่า ----------------
bool menuWaitUpd = false;
const int MENU_N = 6;  // แถว: [หมุน|เสียง] [ความสว่าง|ปิดจอ] [ปิดจอเอง|ความเร็ว] [WiFi|เสียงแจ้งเตือน] [อัปเดต|เครื่อง] [Dashboard|กลับ]
void drawMenu() {
  lcd.fillScreen(C_BG);
  lcd.setFont(&fonts::Font2); lcd.setTextColor(C_GOLD, C_BG);
  lcd.drawString("OI GOLD PRO MINI  v" FW_VER, 8, 6);
  { char b[48]; snprintf(b, sizeof(b), "d%d %s %u/%uk", miniErr, !mktOpen ? "cls" : okf(perp) && millis() - perpAt < 6000 ? "px" : "--", (unsigned)(ESP.getFreeHeap() / 1024), (unsigned)(ESP.getMaxAllocHeap() / 1024));
    lcd.setFont(&fonts::Font0); lcd.setTextColor(C_DIM, C_BG); lcd.setTextDatum(top_right); lcd.drawString(b, W - 6, 10); lcd.setTextDatum(top_left); }
  int bw = W - 16, hw = (bw - 6) / 2, bh = (H - 36) / MENU_N - 5, y = 28;
  const char *rot[4] = {"ROT: PORT", "ROT: LAND", "ROT: PORT 180", "ROT: LAND 180"};
  const char *br[3] = {"BRIGHT: HIGH", "BRIGHT: MID", "BRIGHT: LOW"};
  button(8, y, hw, bh, rot[rotIdx], C_PANEL, C_TEXT, C_LINE);
  button(14 + hw, y, hw, bh, muted ? "SOUND: OFF" : "SOUND: ON", C_PANEL, muted ? C_DN : C_UP, C_LINE); y += bh + 5;
  button(8, y, hw, bh, br[brightIdx], C_PANEL, C_TEXT, C_LINE);
  button(14 + hw, y, hw, bh, "SCREEN OFF", C_PANEL, C_GOLD, C_LINE); y += bh + 5;
  button(8, y, hw, bh, AUTO_N[autoOff], C_PANEL, autoOff ? C_TEXT : C_DIM, C_LINE);
  button(14 + hw, y, hw, bh, spi40 ? "SPEED: 40MHz" : "SPEED: 27MHz", C_PANEL, spi40 ? C_GOLD : C_TEXT, C_LINE); y += bh + 5;
  button(8, y, hw, bh, "WIFI SETUP", C_PANEL, C_TEXT, C_LINE);
  button(14 + hw, y, hw, bh, "ALERT SOUNDS", C_PANEL, C_TEXT, C_LINE); y += bh + 5;
  char u[32];
  if (newVer[0]) snprintf(u, sizeof(u), "UPDATE v%s", newVer); else strcpy(u, "CHECK UPDATE");
  button(8, y, hw, bh, u, newVer[0] ? C_CALL : C_PANEL, newVer[0] ? C_BG : C_TEXT, C_LINE);
  if (loginExp[0]) snprintf(u, sizeof(u), "CODE %.10s", loginExp); else strcpy(u, "APP CODE");
  button(14 + hw, y, hw, bh, u, C_PANEL, miniErr == 401 ? C_DN : C_TEXT, C_LINE); y += bh + 5;
  button(8, y, hw, bh, "DASHBOARD", C_PANEL, C_GOLD, C_LINE);
  button(14 + hw, y, hw, bh, "BACK", C_GOLD, hex(0x1a1405));
}

void handleMenuTap(int x, int y) {
  int bh = (H - 36) / MENU_N - 5, i = (y - 28) / (bh + 5);
  bool right = x > W / 2;
  if (y < 28 || i >= MENU_N) return;
  if (i == 0 && !right) { rotIdx = (rotIdx + 1) & 3; prefs.putInt("rot", rotIdx); applyRotation(rotIdx); drawMenu(); }
  else if (i == 0) { muted = !muted; prefs.putBool("mute", muted); if (muted) stopSound(); else playPattern(1); drawMenu(); }
  else if (i == 1 && !right) { brightIdx = (brightIdx + 1) % 3; prefs.putInt("br", brightIdx); lcd.setBrightness(BRIGHT[brightIdx]); drawMenu(); }
  else if (i == 1) { manualOff = true; wakeUntil = 0; sc = SC_MAIN; setScreen(true); }  // แตะจอเพื่อเปิด
  else if (i == 2 && right) {  // เปลี่ยนความเร็วส่งภาพ → รีสตาร์ท (ภาพเพี้ยน: แตะจอค้างตอนเปิดเครื่องเพื่อกลับ 27MHz)
    spi40 = !spi40; prefs.putBool("spi40", spi40);
    lcd.fillScreen(C_BG); lcd.setFont(&fonts::Font2); lcd.setTextColor(C_GOLD, C_BG); lcd.drawString("restarting...", 8, 8);
    delay(400); ESP.restart();
  }
  else if (i == 2) { autoOff = (autoOff + 1) & 3; prefs.putInt("ao", autoOff); wakeUntil = millis() + 5000; drawMenu(); }
  else if (i == 3 && !right) openWifi();
  else if (i == 3) { sc = SC_SND; drawSnd(); }
  else if (i == 4 && right) openCode(nullptr);  // เปลี่ยนรหัสเข้าใช้
  else if (i == 4) {
    int hw = (W - 16 - 6) / 2;
    if (newVer[0]) { doUpdate(); return; }
    if (WiFi.status() != WL_CONNECTED) { button(8, 28 + 4 * (bh + 5), hw, bh, "CHECK FAILED", C_PANEL, C_DN, C_LINE); return; }
    button(8, 28 + 4 * (bh + 5), hw, bh, "CHECKING...", C_PANEL, C_DIM, C_LINE);
    updRes = 0; reqUpd = true; menuWaitUpd = true;  // งานเน็ตเช็กให้ ผลแสดงใน loop
  }
  else if (i == 5 && !right) openDash();
  else { sc = SC_MAIN; drawMain(); }
}

// ---------------- ตั้งค่า WiFi จากจอ ----------------
struct Net { char ssid[33]; int rssi; bool open; };
Net nets[7]; int nNets = 0;
char selSsid[33] = ""; char pass[64] = ""; int passLen = 0;
bool kbShift = false, kbSym = false;
int kbFor = 0;  // 0 = รหัส WiFi, 1 = รหัสเข้าใช้ (รหัสแอป)
char kbMsg[40] = ""; uint16_t kbMsgCol = 0;

void openWifi() {
  sc = SC_WIFI;
  pauseNet(true);  // สแกน/เชื่อม WiFi ใหม่ระหว่างงานเน็ตทำงานไม่ได้
  // ตั้งค่า WiFi ใช้แนวนอนเสมอ · หันด้านเดียวกับที่ผู้ใช้ตั้งไว้ (ROT 180 → แนวนอนกลับหัว) ไม่งั้นภาพกลับหัวและแตะไม่ตรง
  lcd.setRotation(rotIdx >= 2 ? 3 : 1); W = lcd.width(); H = lcd.height();
  lcd.fillScreen(C_BG);
  lcd.setFont(&fonts::Font2); lcd.setTextColor(C_GOLD, C_BG);
  lcd.drawString("Scanning WiFi...", 8, 8);
  WiFi.mode(WIFI_STA);
  int n = WiFi.scanNetworks();
  nNets = 0;
  for (int i = 0; i < n && nNets < 7; i++) {
    String s = WiFi.SSID(i); if (!s.length()) continue;
    bool dup = false; for (int j = 0; j < nNets; j++) if (s == nets[j].ssid) dup = true;
    if (dup) continue;
    strlcpy(nets[nNets].ssid, s.c_str(), 33); nets[nNets].rssi = WiFi.RSSI(i);
    nets[nNets].open = WiFi.encryptionType(i) == WIFI_AUTH_OPEN; nNets++;
  }
  WiFi.scanDelete();
  drawWifi();
}

void drawWifi() {
  lcd.fillScreen(C_BG);
  lcd.setFont(&fonts::Font2); lcd.setTextColor(C_GOLD, C_BG);
  lcd.drawString("Select WiFi", 8, 6);
  for (int i = 0; i < nNets; i++) {
    int y = 26 + i * 25;
    lcd.fillRoundRect(4, y, W - 8, 22, 4, C_PANEL);
    lcd.setTextColor(C_TEXT, C_PANEL); lcd.drawString(nets[i].ssid, 10, y + 3);
    char b[12]; snprintf(b, sizeof(b), "%s%d", nets[i].open ? "" : "* ", nets[i].rssi);
    lcd.setTextColor(C_DIM, C_PANEL); lcd.setTextDatum(top_right); lcd.drawString(b, W - 10, y + 3); lcd.setTextDatum(top_left);
  }
  if (!nNets) { lcd.setTextColor(C_DIM, C_BG); lcd.drawString("No networks found", 10, 40); }
  int bw3 = (W - 16) / 3;
  button(4, H - 32, bw3, 28, "RESCAN", C_PANEL, C_TEXT, C_LINE);
  button(8 + bw3, H - 32, bw3, 28, wlow ? "TX: LOW" : "TX: NORMAL", C_PANEL, wlow ? C_GOLD : C_TEXT, C_LINE);
  button(12 + 2 * bw3, H - 32, bw3, 28, "BACK", C_PANEL, C_TEXT, C_LINE);
}

const char *KB_ROWS[2][4] = {
  {"1234567890", "qwertyuiop", "asdfghjkl", "zxcvbnm"},
  {"1234567890", "!@#$%^&*()", "-_=+[]{}:;", "'\",.<>/?\\|"}};

void drawKbText() {
  lcd.fillRoundRect(4, 20, W - 8, 24, 4, C_PANEL);
  lcd.setFont(&fonts::Font2); lcd.setTextColor(C_TEXT, C_PANEL);
  const char *s = pass; int len = passLen;
  while (len > 34) { s++; len--; }
  lcd.drawString(s, 10, 24);
}

void drawKb() {
  lcd.fillScreen(C_BG);
  lcd.setFont(&fonts::Font2); lcd.setTextColor(C_GOLD, C_BG);
  char t[48];
  if (kbFor == 1) snprintf(t, sizeof(t), "%s", kbMsg[0] ? kbMsg : "APP CODE (same as OI Gold Pro app)");
  else snprintf(t, sizeof(t), "Password: %s", selSsid);
  if (kbFor == 1 && kbMsg[0]) lcd.setTextColor(kbMsgCol, C_BG);
  lcd.drawString(t, 6, 2);
  drawKbText();
  for (int r = 0; r < 4; r++) {
    const char *row = KB_ROWS[kbSym][r]; int n = strlen(row), off = (W - n * 32) / 2;
    for (int i = 0; i < n; i++) {
      char k[2] = {row[i], 0};
      if (!kbSym && kbShift && k[0] >= 'a' && k[0] <= 'z') k[0] -= 32;
      lcd.fillRoundRect(off + i * 32 + 1, 50 + r * 36, 30, 33, 4, C_PANEL);
      lcd.setTextColor(C_TEXT, C_PANEL); lcd.setTextDatum(middle_center);
      lcd.drawString(k, off + i * 32 + 16, 50 + r * 36 + 17); lcd.setTextDatum(top_left);
    }
  }
  int y = 50 + 4 * 36;
  button(1, y, 50, 40, kbShift ? "ABC" : "abc", kbShift ? C_GOLD : C_PANEL, kbShift ? C_BG : C_TEXT);
  button(53, y, 50, 40, kbSym ? "abc" : "#+=", C_PANEL, C_TEXT);
  button(105, y, 90, 40, "space", C_PANEL, C_TEXT);
  button(197, y, 56, 40, "DEL", C_PANEL, C_TEXT);
  button(255, y, 64, 40, "OK", C_UP, C_BG);
}

void kbAdd(char c) { if (passLen < 63) { pass[passLen++] = c; pass[passLen] = 0; drawKbText(); } }

bool wifiUserTap = false;  // ผู้ใช้แตะจอระหว่างรอเชื่อม WiFi = อยากเปลี่ยน WiFi
bool connectWifi(const char *ssid, const char *pw, uint32_t ms, bool showUi) {
  wifiUserTap = false;
  if (showUi) {
    lcd.fillScreen(C_BG); lcd.setFont(&fonts::Font2); lcd.setTextColor(C_GOLD, C_BG);
    char t[56]; snprintf(t, sizeof(t), "Connecting %s", ssid); lcd.drawString(t, 8, 8);
    lcd.setTextColor(C_DIM, C_BG); lcd.drawString("tap screen to change WiFi", 8, 30);
  }
  WiFi.mode(WIFI_STA); WiFi.disconnect(); delay(100);
  WiFi.begin(ssid, pw); applyTx();
  uint32_t t0 = millis(); int32_t x, y;
  while (WiFi.status() != WL_CONNECTED && millis() - t0 < ms) {
    if (showUi) {
      lcd.fillCircle(12 + ((millis() - t0) / 500 % 20) * 14, 60, 4, C_GOLD);
      if (tapped(x, y)) { wifiUserTap = true; return false; }
    }
    delay(50);
  }
  return WiFi.status() == WL_CONNECTED;
}

void finishWifi() {
  sc = SC_MAIN;
  applyRotation(rotIdx);
  pauseNet(false); reqFetch = true;
  if (!loginCode[0]) { openCode(nullptr); return; }  // ยังไม่เคยใส่รหัสเข้าใช้
  drawMain();
}

void tryConnectSelected() {
  if (connectWifi(selSsid, pass, 15000, true)) {
    prefs.putString("ssid", selSsid); prefs.putString("pass", pass);
    finishWifi();
  } else {
    lcd.fillScreen(C_BG); lcd.setTextColor(C_DN, C_BG); lcd.drawString("Connect failed - check password", 8, 8);
    delay(1800);
    sc = SC_KB; drawKb();
  }
}

// ---------------- หน้าใส่รหัสเข้าใช้ (ใช้คีย์บอร์ดเดียวกับ WiFi) ----------------
void openCode(const char *msg) {
  sc = SC_KB; kbFor = 1; kbShift = false; kbSym = false;
  lcd.setRotation(rotIdx >= 2 ? 3 : 1); W = lcd.width(); H = lcd.height();
  pass[0] = 0; passLen = 0;
  if (msg) { strlcpy(kbMsg, msg, sizeof(kbMsg)); kbMsgCol = C_DN; } else kbMsg[0] = 0;
  drawKb();
}
void finishCode() { kbFor = 0; kbMsg[0] = 0; sc = SC_MAIN; applyRotation(rotIdx); drawMain(); }
void submitCode() {
  if (!passLen || reqLogin) return;
  if (WiFi.status() != WL_CONNECTED) { strcpy(kbMsg, "NO WIFI - try again"); kbMsgCol = C_DN; drawKb(); return; }
  strlcpy(tryCode, pass, sizeof(tryCode)); loginRes = 0; reqLogin = true;  // งานเน็ตตรวจกับ /mini/login
  strcpy(kbMsg, "checking..."); kbMsgCol = C_GOLD; drawKb();
}
void loginResult() {  // loop เรียกเมื่องานเน็ตตรวจเสร็จ
  int r = loginRes; loginRes = 0;
  if (r == 1) {
    strlcpy(loginCode, okCode, sizeof(loginCode)); prefs.putString("code", loginCode); prefs.putString("cexp", loginExp);
    miniErr = 1; haveData = false; reqFetch = true; finishCode();
    return;
  }
  strcpy(kbMsg, r == 2 ? "WRONG CODE" : r == 3 ? "CODE EXPIRED" : "SERVER ERROR - try again"); kbMsgCol = C_DN; drawKb();
}

void handleWifiTap(int x, int y) {
  if (y >= H - 32) {
    int bw3 = (W - 16) / 3;
    if (x < 6 + bw3) openWifi();
    else if (x < 10 + 2 * bw3) { wlow = !wlow; prefs.putBool("wlow", wlow); applyTx(); drawWifi(); }
    else finishWifi();
    return;
  }
  int i = (y - 26) / 25;
  if (y >= 26 && i >= 0 && i < nNets) {
    strlcpy(selSsid, nets[i].ssid, 33);
    pass[0] = 0; passLen = 0;
    if (nets[i].open) { tryConnectSelected(); return; }
    if (prefs.getString("ssid", "") == selSsid) { strlcpy(pass, prefs.getString("pass", "").c_str(), 64); passLen = strlen(pass); }
    kbFor = 0; kbShift = false; kbSym = false; sc = SC_KB; drawKb();
  }
}

void handleKbTap(int x, int y) {
  if (y >= 194) {
    if (x < 52) { kbShift = !kbShift; drawKb(); }
    else if (x < 104) { kbSym = !kbSym; drawKb(); }
    else if (x < 196) kbAdd(' ');
    else if (x < 254) { if (passLen) { pass[--passLen] = 0; drawKbText(); } }
    else if (kbFor == 1) submitCode();
    else tryConnectSelected();
    return;
  }
  if (y < 50) {  // แตะหัวข้อ = กลับรายการ WiFi / ยกเลิกเปลี่ยนรหัส (ถ้ามีรหัสที่ใช้ได้อยู่แล้ว)
    if (y < 20) { if (kbFor == 0) { sc = SC_WIFI; drawWifi(); } else if (loginCode[0] && miniErr != 401) finishCode(); }
    return;
  }
  int r = (y - 50) / 36; if (r < 0 || r > 3) return;
  const char *row = KB_ROWS[kbSym][r]; int n = strlen(row), off = (W - n * 32) / 2;
  int i = (x - off) / 32; if (x < off || i >= n) return;
  char c = row[i];
  if (!kbSym && kbShift && c >= 'a' && c <= 'z') c -= 32;
  kbAdd(c);
}

// ---------------- ตรวจรหัสเข้าใช้ (งานเน็ต) ----------------
int doLogin() {
  WiFiClientSecure cli; cli.setInsecure();
  HTTPClient http; http.setTimeout(20000);  // Apps Script อาจช้า
  if (!http.begin(cli, String(WORKER) + "/mini/login?code=" + urlEnc(tryCode))) return 4;
  int code = http.GET();
  if (code != 200) { http.end(); return 4; }
  String body = http.getString(); http.end();
  JsonDocument doc;
  if (deserializeJson(doc, body)) return 4;
  if (doc["ok"] | false) { strlcpy(okCode, doc["code"] | tryCode, sizeof(okCode)); strlcpy(loginExp, doc["exp"] | "", sizeof(loginExp)); return 1; }
  const char *r = doc["reason"] | "";
  return !strcmp(r, "expired") ? 3 : !strcmp(r, "server") ? 4 : 2;
}

// ---------------- ข่าวแดง (ฝั่งจอ) ----------------
uint32_t newsWarned[4] = {0, 0, 0, 0}; int nwI = 0;
void checkNews() {
  time_t tn = time(nullptr);
  if (tn < 1700000000 || !haveData) return;
  for (int i = 0; i < D.nn; i++) {
    uint32_t t = D.nxT[i];
    if ((uint32_t)tn + 600 < t || (uint32_t)tn >= t) continue;
    bool w = false; for (int j = 0; j < 4; j++) if (newsWarned[j] == t) w = true;
    if (w) continue;
    newsWarned[nwI] = t; nwI = (nwI + 1) & 3;
    char b[40]; snprintf(b, sizeof(b), "NEWS %lum %s", (unsigned long)((t - tn + 59) / 60), D.nxS[i]);
    fireAlert(b, C_GOLD, 5, 2);
  }
}

// ---------------- งานเน็ต (แกน 0) ----------------
// v0.5: ดึงข้อมูลทั้งหมดในงานแยกบนแกน 0 → จอ/สัมผัสบนแกน 1 ไม่ต้องรอเน็ต
// ราคาสด: REST ของ Bybit ทุก 1 วินาที (เชื่อมต่อค้างไว้) · v0.5.0 ลอง WebSocket แล้วกราฟไม่ขึ้น/เช็กอัปเดตไม่ได้บนบอร์ดจริง จึงเอาออก
static const char *PERP_URL = "https://api.bybit.com/v5/market/tickers?category=linear&symbol=XAUUSDT";
// ตลาด GC ปิด: Bybit ยังซื้อขายแต่ offset ค้างจากก่อนปิด → ไม่ใช้ แสดงราคาปิด Gold.F จาก /mini แทน
bool perpFresh() { return haveData && D.mkt && okf(perp) && okf(D.off) && millis() - perpAt < 6000; }
float livePrice() { return perpFresh() ? perp + D.off : (haveData ? D.p : NAN); }

void setPerp(float v) { if (v > 0) { if (v != perp) { perp = v; perpSeq++; } perpAt = millis(); } }

bool pollPerpRest() {
  HTTPClient http; http.setReuse(true); http.setTimeout(2500);
  if (!http.begin(perpCli, PERP_URL)) return false;
  int code = http.GET();
  if (code != 200) { http.end(); perpCli.stop(); return false; }
  String s = http.getString(); http.end();
  int i = s.indexOf("\"lastPrice\":\""); if (i < 0) return false;
  setPerp(s.substring(i + 13).toFloat());
  return true;
}

// ก่อนเปิดการเชื่อมต่อเข้ารหัสใหม่: ถ้าหน่วยความจำก้อนใหญ่สุดเหลือน้อย ปิดการเชื่อมต่อราคาที่ค้างไว้ก่อน
void freeTlsIfLow() { if (ESP.getMaxAllocHeap() < 45000) perpCli.stop(); }

void netTask(void *) {
  uint32_t lastF = 0, lastRest = 0, lastUpd = 0; int failF = 0;
  for (;;) {
    if (netPause || WiFi.status() != WL_CONNECTED) {
      perpCli.stop();
      netIdle = netPause;
      vTaskDelay(pdMS_TO_TICKS(50));
      continue;
    }
    netIdle = false;
    uint32_t ms = millis();
    if (reqLogin) { reqLogin = false; perpCli.stop(); loginRes = doLogin(); }
    if (reqDash) { reqDash = false; perpCli.stop(); fetchDash(); }
    // ไม่มีรหัส หรือรหัสใช้ไม่ได้ (401) = ไม่ดึง จนกว่าจะใส่รหัสใหม่ (reqFetch)
    if (loginCode[0] && (miniErr != 401 || reqFetch) && (reqFetch || !lastF || ms - lastF >= (failF ? 5000 : FETCH_MS))) {
      reqFetch = false; lastF = ms;
      if (failF) perpCli.stop(); else freeTlsIfLow();  // ดึงไม่ได้รอบก่อน → ปิดการเชื่อมต่อราคาให้หน่วยความจำว่างก่อน
      if (fetchMini(tfIdx)) { miniErr = 0; miniOkAt = millis(); failF = 0; } else failF++;
    }
    if (mktOpen && millis() - lastRest >= 1000) { lastRest = millis(); pollPerpRest(); }
    else if (!mktOpen) perpCli.stop();
    if (reqUpd || (!lastUpd && ms > 20000) || (lastUpd && ms - lastUpd >= 6UL * 3600 * 1000)) {
      reqUpd = false; lastUpd = ms;
      perpCli.stop();
      updRes = checkUpdate() ? 1 : 2;
    }
    vTaskDelay(pdMS_TO_TICKS(20));
  }
}

// หยุด/เริ่มงานเน็ต (ใช้ตอนตั้ง WiFi และตอน OTA) · รอให้งานเน็ตวางมือจริงก่อนกลับ
void pauseNet(bool p) {
  netPause = p;
  if (p) { uint32_t t = millis(); while (!netIdle && millis() - t < 12000) delay(20); }
}

// ---------------- ฝั่งจอ: รับข้อมูลจากงานเน็ต ----------------
uint32_t seenSeq = 0, lastTick = 0;
bool dirtyChart = false, dirtyStatus = false, dirtyHdr = false;
void applyNet() {
  bool got = false;
  if (ndReady && xSemaphoreTake(mx, 0) == pdTRUE) {
    if (ND.tf == tfIdx) {
      // Worker ส่งแท่งว่างมา (แหล่งแท่งเทียนสะดุดชั่วคราว) → เก็บแท่งเดิมไว้ ไม่ขึ้น "no candles"
      if (!ND.nb && haveData && D.tf == ND.tf && D.nb) { memcpy(ND.b, D.b, sizeof(D.b[0]) * D.nb); ND.nb = D.nb; ND.bs = D.bs; ND.lt = D.lt; }
      memcpy(&D, &ND, sizeof(Data)); got = true;
    }
    ndReady = false;
    xSemaphoreGive(mx);
  }
  uint32_t ms = millis();
  if (got) { haveData = true; lastOk = ms; }
  bool moved = perpSeq != seenSeq;
  if (moved) seenSeq = perpSeq;
  if (got || moved || ms - lastTick >= 1000) {  // ทุกครั้งที่ราคาเปลี่ยน + ทุกวินาที (ขึ้นแท่งใหม่ตามเวลา)
    lastTick = ms;
    if (haveData) { tickCandle(); evalAlerts(); checkNews(); }
    static uint32_t lastSt = 0; if (ms - lastSt >= 10000) { lastSt = ms; dirtyStatus = true; }  // นับถอยหลังข่าว/ระยะโซน
    if (got || moved) { dirtyChart = dirtyStatus = dirtyHdr = true; }
  }
}

// อัปเดตแท่งปัจจุบันด้วยราคาสด และเปิดแท่งใหม่เมื่อครบเวลา
void tickCandle() {
  float P = livePrice();
  if (!haveData || !D.nb || !okf(P) || !perpFresh()) return;
  time_t now = time(nullptr);
  if (now > 1700000000 && D.lt && D.bs) {
    while ((uint32_t)now >= D.lt + D.bs) {
      if (D.nb >= MAXB) { memmove(D.b[0], D.b[1], sizeof(D.b[0]) * (MAXB - 1)); D.nb--; }
      float *b = D.b[D.nb++];
      b[0] = b[1] = b[2] = b[3] = P;
      D.lt += D.bs;
      if (!panAuto && panBars) panBars++;  // เลื่อนดูย้อนหลังอยู่: คงตำแหน่งเดิมไว้
    }
  }
  float *b = D.b[D.nb - 1];
  b[3] = P; b[1] = max(b[1], P); b[2] = min(b[2], P);
}

// ---------------- หน้าหลัก: แตะ / ลาก ----------------
void handleMainTap(int x, int y) {
  if (y >= yTool) {
    for (int i = 0; i < 9; i++) if (x >= tbX[i] - 1 && x <= tbX[i] + tbW[i] + 1) {
      if (i < 4) { if (tfIdx != i) { tfIdx = i; prefs.putInt("tf", tfIdx); haveData = false; nzst = 0; panAuto = true; yShift = 0; reqFetch = true; drawToolbar(); drawChart(); } }
      else if (i == 4) { if (zoomIdx < 5) { zoomIdx++; prefs.putInt("zm", zoomIdx); drawToolbar(); drawChart(); } }  // − = เห็นแท่งมากขึ้น
      else if (i == 5) { if (zoomIdx > 0) { zoomIdx--; prefs.putInt("zm", zoomIdx); drawToolbar(); drawChart(); } }  // + = ขยาย
      else if (i == 8) {  // เปิด/ปิดเส้นเล็ง · เปิด = วางกลางกราฟ
        crossOn = !crossOn;
        if (crossOn) { crossX = (W - AX) / 2; crossY = (yChart + yTool) / 2; }
        drawCrossIcon(); drawChart();
      }
      else if (i == 6) {
        reqFetch = true;  // งานเน็ตดึงให้ทันที (ไม่ค้างจอ)
        drawMain();
      }
      else { sc = SC_MENU; drawMenu(); }
      return;
    }
    return;
  }
  if (y >= HDR && y < HDR + STAT && alertUntil) {  // แตะแถบแจ้งเตือน = ปิด
    alertUntil = 0; ledUntil = 0; stopSound(); setLed(0); drawStatus(); return;
  }
  if (y < HDR) { openDash(); return; }  // แตะแถบหัว = หน้า Dashboard
  if (y >= yChart && y < yTool) {
    const int PW = W - AX;
    bool autoOn = !panAuto || fabsf(yShift) > 0.01f;
    // แตะแกนราคา หรือแตะป้าย AUTO (มุมขวาบนของกราฟ, เผื่อขอบให้แตะง่าย) = กลับอัตโนมัติ
    if (x >= PW || (autoOn && x >= PW - 62 && y - yChart <= 24)) { panAuto = true; yShift = 0; drawChart(); return; }
    // เส้นเล็งเปิดอยู่ (ไอคอน +): แตะ = ย้ายเส้นเล็งไปจุดที่แตะ · ปิดอยู่: แตะกราฟไม่มีอะไร
    if (crossOn) { crossX = x; crossY = y; drawChart(); }
  }
}

bool tDown = false, tDrag = false; int32_t tx0, ty0; int panBars0; float yShift0; uint32_t lastDragDraw = 0;
void handleTouchMain() {
  int32_t x, y;
  bool d = lcd.getTouch(&x, &y) > 0;
  if (d) {
    if (!tDown) { tDown = true; tDrag = false; tx0 = x; ty0 = y; panBars0 = panBars; yShift0 = yShift; return; }
    if (ty0 >= yChart && ty0 < yTool && tx0 < W - AX) {  // ลากบนกราฟ = เลื่อน (ซ้าย-ขวา = เวลา, ขึ้น-ลง = ราคา) · ถ้าเส้นเล็งแสดงอยู่ = ลากเส้นเล็ง
      int dx = x - tx0, dy = y - ty0;
      if (!tDrag && (abs(dx) > 6 || abs(dy) > 6)) tDrag = true;
      if (tDrag && crossOn && millis() - lastDragDraw > 50) { lastDragDraw = millis(); crossX = x; crossY = y; drawChart(); }
      else if (tDrag && !crossOn && millis() - lastDragDraw > 60) {
        // ลากขวา = ดูย้อนหลัง · ลากซ้าย = เว้นที่ว่างด้านขวา (drawChart จำกัดช่วงเอง)
        panAuto = false; panBars = panBars0 + (int)roundf(dx / max(1.0f, lastCW));
        yShift = yShift0 + dy * lastPPP;
        lastDragDraw = millis();
        drawChart();
      }
    }
  } else if (tDown) {
    tDown = false;
    if (!tDrag) handleMainTap(tx0, ty0);
  }
}

// แบต: ต่อวงจรแบ่งแรงดัน 1:2 จากขั้วแบตเข้า IO35 (ช่อง P3) ถ้าไม่ได้ต่อ = แสดงเป็นไฟ USB
int readBatt() {
  uint32_t mv = analogReadMilliVolts(BATT_PIN) * 2;
  if (mv < 2500) return -1;
  return max(0, min(100, (int)((mv - 3300) * 100 / 900)));
}

// ---------------- setup / loop ----------------
void setup() {
  Serial.begin(115200);
  pinMode(LED_R, OUTPUT); pinMode(LED_G, OUTPUT); pinMode(LED_B, OUTPUT); setLed(0);
  prefs.begin("oimini", false);
  rotIdx = prefs.getInt("rot", 1) & 3;
  muted = prefs.getBool("mute", false);
  brightIdx = prefs.getInt("br", 0) % 3;
  tfIdx = prefs.getInt("tf", 0) & 3;
  autoOff = prefs.getInt("ao", 1) & 3;
  sndVol = prefs.getInt("vol", 2) & 3; sndType[0] = prefs.getInt("sz", 1) & 3; sndType[1] = prefs.getInt("sb", 3) & 3; sndType[2] = prefs.getInt("sn", 2) & 3;
  strlcpy(loginCode, prefs.getString("code", "").c_str(), sizeof(loginCode));
  strlcpy(loginExp, prefs.getString("cexp", "").c_str(), sizeof(loginExp));
  spkInit();
  zoomIdx = prefs.getInt("zm", 2); if (zoomIdx < 0 || zoomIdx > 5) zoomIdx = 2;
  D.off = NAN;

  wlow = prefs.getBool("wlow", true);
  spi40 = prefs.getBool("spi40", false);
  lcd.setWriteFreq(spi40 ? 40000000 : 27000000);
  lcd.init();
  lcd.setTouchCalibrate(calData);
  lcd.setBrightness(BRIGHT[brightIdx]);
  initColors();
  applyRotation(rotIdx);

  lcd.fillScreen(C_BG);
  lcd.pushImage(W / 2 - LOGO_W / 2, H / 2 - 50, LOGO_W, LOGO_H, (const lgfx::rgb565_t *)LOGO);
  lcd.setFont(&fonts::Font4); lcd.setTextColor(C_GOLD, C_BG);
  lcd.setTextDatum(middle_center); lcd.drawString("OI GOLD PRO", W / 2, H / 2 - 4);
  lcd.setFont(&fonts::Font2); lcd.setTextColor(C_TEXT, C_BG);
  lcd.drawString("MINI  v" FW_VER, W / 2, H / 2 + 20);
  lcd.setTextDatum(top_left);
  // แตะจอค้างตอนเปิดเครื่อง = กลับไปใช้ 27MHz (เผื่อ 40MHz แล้วภาพเพี้ยน)
  { uint32_t t0 = millis(); int32_t tx, ty; bool hit = false;
    while (millis() - t0 < 900) { if (lcd.getTouch(&tx, &ty)) hit = true; delay(20); }
    if (hit && spi40) {
      spi40 = false; prefs.putBool("spi40", false);
      lcd.fillScreen(C_BG); lcd.setFont(&fonts::Font2); lcd.setTextColor(C_GOLD, C_BG); lcd.drawString("SPEED reset to 27MHz", 8, 8);
      delay(800); ESP.restart();
    }
  }

  perpCli.setInsecure();
  mx = xSemaphoreCreateMutex();
  xTaskCreatePinnedToCore(netTask, "net", 12288, nullptr, 1, nullptr, 0);  // งานเน็ตบนแกน 0
  configTime(7 * 3600, 0, "pool.ntp.org", "time.google.com");  // เวลาไทย
  battPct = readBatt();
  WiFi.setAutoReconnect(true);
  String ss = prefs.getString("ssid", ""), pw = prefs.getString("pass", "");
  // มี WiFi ที่บันทึกไว้: เชื่อมไม่ทันก็เข้าหน้ากราฟเลย (loop ลองเชื่อมใหม่ให้เอง) · ไปหน้าเลือก WiFi เฉพาะตอนผู้ใช้แตะจอ หรือยังไม่เคยตั้ง
  if (!ss.length()) openWifi();
  else if (connectWifi(ss.c_str(), pw.c_str(), 10000, true) || !wifiUserTap) finishWifi();
  else openWifi();
  wakeUntil = millis() + 60000;  // เปิดเครื่องตอนตลาดปิด/ตั้งเวลาปิดจอ: ให้จอติดก่อน 1 นาทีแล้วค่อยดับ
}

uint32_t lastHdr = 0, lastDraw = 0;
void loop() {
  int32_t x, y;
  serviceAlerts();
  applyNet();
  { // WiFi หลุด/เชื่อมไม่ติดตอนเปิดเครื่อง: ลองเชื่อมใหม่ทุก 20 วินาที (ไม่ค้างจอ)
    static uint32_t offSince = 0, lastRe = 0;
    if (sc == SC_WIFI || sc == SC_KB || WiFi.status() == WL_CONNECTED) offSince = 0;
    else {
      if (!offSince) offSince = millis();
      if (millis() - offSince > 15000 && millis() - lastRe > 20000) {
        lastRe = millis();
        String ss = prefs.getString("ssid", ""), pw = prefs.getString("pass", "");
        if (ss.length()) { WiFi.disconnect(); WiFi.begin(ss.c_str(), pw.c_str()); applyTx(); }
      }
    }
  }
  static uint32_t lastPow = 0;
  if (millis() - lastPow >= 500) { lastPow = millis(); updateScreenPower(); }
  if (scrOff) {
    // จอดับ: แตะที่ไหนก็ได้ = เปิด (ปิดเอง → เปิดถาวร, ปิดตามเวลา → เปิด 5 นาที) · งานเน็ตยังดึงราคา แจ้งเตือนยังทำงาน
    if (tapped(x, y)) { if (manualOff) manualOff = false; else wakeUntil = millis() + 5UL * 60 * 1000; while (lcd.getTouch(&x, &y)) delay(20); wasDown = false; updateScreenPower(); return; }  // รอปล่อยนิ้ว ไม่ให้แตะนี้ไปกดปุ่ม
    delay(10);
    return;
  }
  if (sc == SC_KB && kbFor == 1 && loginRes) loginResult();
  if (miniErr == 401 && sc == SC_MAIN) openCode("CODE NOT VALID - enter again");  // รหัสหมดอายุ/ถูกลบในชีต
  if (sc == SC_WIFI) { if (tapped(x, y)) handleWifiTap(x, y); delay(10); return; }
  if (sc == SC_KB) { if (tapped(x, y)) handleKbTap(x, y); delay(10); return; }
  if (sc == SC_SND) { if (tapped(x, y)) handleSndTap(x, y); delay(10); return; }
  if (sc == SC_DASH) {
    if (tapped(x, y)) { handleDashTap(x, y); return; }
    static uint32_t seenOk = 0;
    if (dashSeq != seenDash || (dashPage > 0 && lastOk != seenOk)) { seenOk = lastOk; drawDash(); }  // หน้า 2/3 วาดใหม่เมื่อข้อมูลอัปเดต
    if (millis() - dashAt > 300000) { dashAt = millis(); reqDash = true; }  // เปิดค้างไว้: ดึงใหม่ทุก 5 นาที
    delay(10); return;
  }
  if (sc == SC_MENU) {
    if (tapped(x, y)) handleMenuTap(x, y);
    if (sc == SC_MENU && menuWaitUpd && updRes) {  // ผลเช็กอัปเดตจากงานเน็ต
      menuWaitUpd = false; drawMenu();
      if (updRes == 2 || !newVer[0]) {
        int bh = (H - 36) / MENU_N - 5;
        button(8, 28 + 4 * (bh + 5), (W - 16 - 6) / 2, bh, updRes == 1 ? "UP TO DATE" : "CHECK FAILED", C_PANEL, updRes == 1 ? C_UP : C_DN, C_LINE);
      }
    }
    delay(10);
    return;
  }

  handleTouchMain();
  // Touch can switch SC_MAIN to SC_MENU; never redraw chart over the menu in this loop.
  if (sc != SC_MAIN) { delay(5); return; }
  if (tDown) { delay(2); return; }  // กำลังลาก: handleTouchMain วาดเอง
  uint32_t ms = millis();
  // วาดเฉพาะเมื่อข้อมูลเปลี่ยน · สูงสุด ~7 ครั้ง/วินาที
  if ((dirtyChart || dirtyStatus) && ms - lastDraw >= 150) {
    lastDraw = ms;
    if (dirtyChart) drawChart();
    if (dirtyStatus) drawStatus();
    dirtyChart = dirtyStatus = false;
  }
  if ((dirtyHdr && ms - lastHdr >= 150) || ms - lastHdr >= 1000) {
    if (ms - lastHdr >= 1000) battPct = readBatt();
    lastHdr = ms; dirtyHdr = false; drawHeader();
  }
  delay(2);
}

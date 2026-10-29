// OI Gold Pro Mini — จอ ESP32 CYD 2.8" (ESP32-2432S028 รุ่น 2 USB, ชิปจอ ILI9341)
// กราฟแท่งเทียน GC1 (Gold.F, ราคาสดจาก Bybit XAUUSDT + offset ทุก 1 วินาที) + OI/Volume ราย strike แบบแอป OI Gold Pro (Call เขียว แนวต้าน · Put แดง แนวรับ)
// เส้น gmf itd / gmf M / Max Pain / Expected Move · โซน OI 10 อันดับ · แจ้งเตือนเข้าโซน/ทะลุโซน
// ข้อมูลจาก Worker: https://gc-yahoo.oigoldpro.workers.dev/mini?tf=1|5|15|60 (อัปเดตทุก 15 วินาที)
//
// Arduino IDE:  Board = ESP32 Dev Module
//               Partition Scheme = Minimal SPIFFS (1.9MB APP with OTA)
// Libraries:    LovyanGFX, ArduinoJson (v7)

#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <HTTPUpdate.h>
#include <Preferences.h>
#include <ArduinoJson.h>
#include <LovyanGFX.hpp>
#include <math.h>
#include "logo.h"

#define FW_VER "0.4.2"
// อัปเดตผ่าน WiFi: GitHub Actions คอมไพล์แล้ววางไฟล์ไว้ที่ mini/dist/ (version.json + firmware.bin)
static const char *OTA_BASE = "https://raw.githubusercontent.com/OI-GOLD-PRO/gold-oi-trade/main/mini/dist/";
char newVer[16] = "";  // เวอร์ชันใหม่ที่พบ ("" = ล่าสุดแล้ว)
uint32_t lastUpdCheck = 0;
WiFiClientSecure perpCli;  // การเชื่อมต่อค้างไว้กับ Bybit (ราคาสด)
static const char *DATA_URL = "https://gc-yahoo.oigoldpro.workers.dev/mini?tf=";
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
};

LGFX lcd;
LGFX_Sprite spr(&lcd);
Preferences prefs;

const int LED_R = 4, LED_G = 16, LED_B = 17;  // LED RGB หลังบอร์ด (LOW = ติด)
const int SPK = 26;                           // ช่องลำโพง SPEAK
const int BATT_PIN = 35;                      // วัดแบต (ผ่านตัวแบ่งแรงดัน 1:2) ช่อง P3
int battPct = -1;
uint16_t calData[8] = {291, 3625, 281, 205, 3806, 3629, 3834, 192};  // วัดจากบอร์ดนี้ 2026-10-28

// ---------------- สี (ชุดเดียวกับแอป) ----------------
uint16_t C_BG, C_PANEL, C_LINE, C_TEXT, C_DIM, C_GOLD, C_UP, C_DN, C_CALL, C_PUT, C_GMI, C_GMM, C_MP, C_VOLC, C_VOLP, C_EM;
uint16_t C_ZC, C_ZP, C_ZV, C_GRID;
uint16_t rgb(uint8_t r, uint8_t g, uint8_t b) { return lcd.color565(r, g, b); }
uint16_t hex(uint32_t h) { return lcd.color565(h >> 16, (h >> 8) & 255, h & 255); }
uint16_t blend(uint32_t a, uint32_t b, float t) {  // ผสมสี a ทับพื้น b ความเข้ม t
  return rgb(((a >> 16) & 255) * t + ((b >> 16) & 255) * (1 - t), ((a >> 8) & 255) * t + ((b >> 8) & 255) * (1 - t), (a & 255) * t + (b & 255) * (1 - t));
}
void initColors() {
  C_BG = hex(0x04060a); C_PANEL = hex(0x0b0e16); C_LINE = hex(0x262c3c); C_GRID = hex(0x11151f); C_TEXT = hex(0xe6e9f2); C_DIM = hex(0x8a93ab);
  C_GOLD = hex(0xe0b44c); C_UP = hex(0x26a69a); C_DN = hex(0xef5350);
  C_CALL = hex(0x2fbf8f); C_PUT = hex(0xe5576b); C_GMI = hex(0x22d3ee); C_GMM = hex(0xf59e0b); C_MP = hex(0xff3fb4);
  C_VOLC = hex(0x8ccaff); C_VOLP = hex(0xffb98a); C_EM = hex(0x8a93ab);
  C_ZC = blend(0x2fbf8f, 0x04060a, 0.40); C_ZP = blend(0xe5576b, 0x04060a, 0.40); C_ZV = blend(0xe0b44c, 0x04060a, 0.40);
}

// ---------------- ข้อมูล ----------------
struct Zone { float k, lo, hi; char t; long c, p; };
struct Strike { float k; long c, p, vc, vp; uint8_t rc, rp, tv; };
#define MAXB 120
#define MAXS 40
struct Data {
  float p; float b[MAXB][4]; int nb; int bs; uint32_t lt; float off;
  float F, open, em, itd, gm, mp;
  char exp[16]; bool mkt;
  Zone z[12]; int nz;
  Strike s[MAXS]; int ns;
};
Data D;
bool haveData = false;
uint32_t lastFetch = 0, lastOk = 0;

// สถานะแจ้งเตือนต่อโซน (กติกาเดียวกับแอป: ถึงโซน → พัก 1 ชม. · ทะลุขอบ $2 → พัก 30 นาที)
struct ZState { float k; bool inside, reached, hasReach, hasBreak; uint32_t lastReach, lastBreak; };
ZState zst[16]; int nzst = 0;
uint32_t alertUntil = 0, ledUntil = 0; char alertTxt[40] = ""; uint16_t alertCol = 0; uint8_t ledMask = 0;
int beepLeft = 0; uint32_t nextBeep = 0; int beepFreq = 2000;

// การตั้งค่า
// ปิดจอ: manualOff = กดปิดจากเมนู · autoOff = 0 ไม่ปิดเอง, 1 ตลาดปิด, 2 ตลาดปิด+กลางคืน 00-07, 3 ตลาดปิด+กลางคืน 22-07
bool manualOff = false, scrOff = false; int autoOff = 1; uint32_t wakeUntil = 0;
const char *AUTO_N[4] = {"AUTO OFF: NEVER", "AUTO OFF: MKT CLOSED", "AUTO OFF: MKT+00-07", "AUTO OFF: MKT+22-07"};
int rotIdx = 1; bool muted = false; int brightIdx = 0; int tfIdx = 0; int zoomIdx = 2;
const uint8_t BRIGHT[3] = {220, 110, 35};
const char *TF_Q[4] = {"1", "5", "15", "60"};
const char *TF_N[4] = {"1m", "5m", "15m", "1h"};
const int ZOOM[6] = {20, 30, 45, 60, 90, 120};

enum Screen { SC_MAIN, SC_MENU, SC_WIFI, SC_KB };
Screen sc = SC_MAIN;

// layout
int W, H; bool LS;
const int HDR = 26, STAT = 16, TB = 24;
int yChart, hChart, yTool;

void doUpdate(); void drawStatus(); void drawWifi(); void drawKb(); void drawMain(); void drawHeader(); void drawMenu(); void openWifi();
float livePrice(); bool perpFresh();

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
  spr.deleteSprite();
  spr.setColorDepth(8);
  spr.createSprite(W, hChart);
}

// ---------------- ดึงข้อมูล ----------------
bool fetchData() {
  WiFiClientSecure cli; cli.setInsecure();
  HTTPClient http; http.setTimeout(9000);
  String url = String(DATA_URL) + TF_Q[tfIdx];
  if (!http.begin(cli, url)) return false;
  int code = http.GET();
  if (code != 200) { http.end(); return false; }
  String body = http.getString();
  http.end();
  JsonDocument doc;
  if (deserializeJson(doc, body)) return false;
  if (!doc["error"].isNull()) return false;

  D.p = jf(doc["p"]); D.bs = doc["bs"] | 60; D.lt = doc["lt"] | 0; D.off = jf(doc["off"]);
  D.nb = 0;
  for (JsonVariant v : doc["b"].as<JsonArray>()) {
    if (D.nb >= MAXB) break;
    JsonArray a = v.as<JsonArray>();
    for (int i = 0; i < 4; i++) D.b[D.nb][i] = jf(a[i]);
    if (okf(D.b[D.nb][3])) D.nb++;
  }
  D.F = jf(doc["F"]); D.open = jf(doc["open"]); D.em = jf(doc["em"]);
  D.itd = jf(doc["itd"]); D.gm = jf(doc["gm"]); D.mp = jf(doc["mp"]);
  strlcpy(D.exp, doc["exp"] | "", sizeof(D.exp));
  D.mkt = doc["mkt"] | true;
  D.nz = 0;
  for (JsonVariant v : doc["z"].as<JsonArray>()) {
    if (D.nz >= 12) break;
    JsonArray a = v.as<JsonArray>();
    Zone &q = D.z[D.nz++];
    q.k = a[0] | 0.0f; q.lo = a[1] | 0.0f; q.hi = a[2] | 0.0f;
    const char *t = a[3] | "V"; q.t = t[0];
    q.c = a[4] | 0L; q.p = a[5] | 0L;
  }
  D.ns = 0;
  for (JsonVariant v : doc["s"].as<JsonArray>()) {
    if (D.ns >= MAXS) break;
    JsonArray a = v.as<JsonArray>();
    Strike &q = D.s[D.ns++];
    q.k = a[0] | 0.0f; q.c = a[1] | 0L; q.p = a[2] | 0L; q.vc = a[3] | 0L; q.vp = a[4] | 0L;
    q.rc = a[5] | 0; q.rp = a[6] | 0; q.tv = a[7] | 0;
  }
  haveData = true;
  return true;
}

// ---------------- แจ้งเตือน ----------------
void fireAlert(const char *txt, uint16_t col, uint8_t led, int beeps, int freq) {
  strlcpy(alertTxt, txt, sizeof(alertTxt));
  alertCol = col; alertUntil = millis() + 60000; ledUntil = millis() + 15000; ledMask = led;
  if (!muted) { beepLeft = beeps; beepFreq = freq; nextBeep = 0; }
  if (scrOff) { uint32_t w = millis() + 60000; if (w > wakeUntil) wakeUntil = w; }  // จอดับอยู่: เปิดให้เห็นแจ้งเตือน 60 วินาที
}

uint16_t zoneCol(char t) { return t == 'C' ? C_CALL : t == 'P' ? C_PUT : C_GOLD; }

void evalAlerts() {
  float P = livePrice();
  if (!haveData || !okf(P) || !D.mkt) return;
  uint32_t now = millis() / 1000;
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
      fireAlert(buf, zoneCol(z.t), z.t == 'C' ? 2 : z.t == 'P' ? 1 : 3, 2, 2200);
    }
    s.inside = in;
    bool up = P > z.hi + 2, dn = P < z.lo - 2;
    if (s.reached && (up || dn) && (!s.hasBreak || now - s.lastBreak >= 1800)) {
      s.hasBreak = true; s.lastBreak = now; s.reached = false;
      snprintf(buf, sizeof(buf), "BREAK %s %s %.0f", up ? "UP" : "DOWN", nm, z.k);
      fireAlert(buf, up ? C_UP : C_DN, up ? 2 : 1, 4, up ? 2600 : 1500);
    }
    nw[n++] = s;
  }
  memcpy(zst, nw, sizeof(ZState) * n); nzst = n;
}

void serviceAlerts() {
  uint32_t ms = millis();
  if (ledUntil && ms < ledUntil) setLed(((ms / 300) & 1) ? ledMask : 0);
  else if (ledUntil) { ledUntil = 0; setLed(0); }
  if (beepLeft > 0 && ms >= nextBeep) { tone(SPK, beepFreq, 120); beepLeft--; nextBeep = ms + 260; }
  if (alertUntil && ms >= alertUntil) { alertUntil = 0; if (sc == SC_MAIN) drawStatus(); }
}

// ---------------- หน้าหลัก ----------------
// ---- ไอคอนแถบหัวแบบ iPhone ----
void drawWifiIcon(int cx, int by, uint16_t bg) {  // cx = กึ่งกลาง, by = ฐาน
  int bars = 0;
  if (WiFi.status() == WL_CONNECTED) { int r = WiFi.RSSI(); bars = r > -60 ? 3 : r > -72 ? 2 : 1; }
  lcd.fillRect(cx - 9, by - 12, 19, 13, bg);
  for (int i = 0; i < 3; i++) {
    int r1 = 4 + i * 4;
    lcd.fillArc(cx, by, r1 - 2, r1, 225, 315, i < bars ? C_TEXT : C_LINE);
  }
  lcd.fillCircle(cx, by - 1, 1, bars ? C_TEXT : C_LINE);
}
void drawBattIcon(int x, int y, uint16_t bg) {  // กรอบ 22x11
  lcd.fillRect(x, y, 26, 11, bg);
  lcd.drawRoundRect(x, y, 22, 11, 3, C_DIM);
  lcd.fillRect(x + 22, y + 3, 2, 5, C_DIM);
  if (battPct < 0) {  // ไม่มีแบต/วัดไม่ได้ = ใช้ไฟ USB → รูปสายฟ้า
    lcd.fillRoundRect(x + 2, y + 2, 18, 7, 2, C_UP);
    lcd.fillTriangle(x + 12, y + 1, x + 8, y + 6, x + 12, y + 6, C_PANEL);
    lcd.fillTriangle(x + 10, y + 5, x + 14, y + 5, x + 10, y + 10, C_PANEL);
  } else {
    int w = max(1, 18 * battPct / 100);
    lcd.fillRoundRect(x + 2, y + 2, w, 7, 2, battPct <= 20 ? C_DN : C_TEXT);
  }
}

void drawHeader() {
  lcd.fillRect(0, 0, W, HDR, C_PANEL);
  lcd.drawFastHLine(0, HDR - 1, W, C_LINE);
  lcd.pushImage(2, 2, LOGO_W, LOGO_H, (const lgfx::rgb565_t *)LOGO);
  char buf[24];
  int x = LOGO_W + 5;
  lcd.setFont(&fonts::Font2); lcd.setTextColor(C_DIM, C_PANEL);
  lcd.drawString("GC1", x, 6); x += lcd.textWidth("GC1") + 4;
  lcd.setFont(&fonts::Font4); lcd.setTextColor(C_GOLD, C_PANEL);
  float P = livePrice();
  if (okf(P)) snprintf(buf, sizeof(buf), "%.1f", P); else strcpy(buf, "----.-");
  lcd.drawString(buf, x, 1); x += lcd.textWidth(buf) + 4;
  // จุดสถานะสด (เขียว = ราคาสด, เหลือง = ข้อมูลช้า, แดง = ไม่มีข้อมูล)
  bool fresh = perpFresh();
  uint16_t dc = !haveData ? C_DN : fresh ? C_CALL : (millis() - lastOk > 60000 ? C_DN : C_GOLD);
  lcd.fillCircle(x + 2, 13, 3, dc); x += 9;
  if (LS && haveData && okf(P) && okf(D.open)) {
    float ch = P - D.open; snprintf(buf, sizeof(buf), "%+.1f", ch);
    lcd.setFont(&fonts::Font2); lcd.setTextColor(ch >= 0 ? C_UP : C_DN, C_PANEL); lcd.drawString(buf, x, 6);
  }
  // ขวา: เวลา · WiFi · แบต
  int bx = W - 27; drawBattIcon(bx, 8, C_PANEL);
  drawWifiIcon(bx - 13, 19, C_PANEL);
  struct tm t;
  if (getLocalTime(&t, 0)) strftime(buf, sizeof(buf), "%H:%M", &t); else strcpy(buf, "--:--");
  lcd.setFont(&fonts::Font2); lcd.setTextColor(C_TEXT, C_PANEL); lcd.setTextDatum(top_right);
  lcd.drawString(buf, bx - 25, 6); lcd.setTextDatum(top_left);
  if (newVer[0]) {  // มีเวอร์ชันใหม่: ลูกศรทองหน้าเวลา (MENU → UPDATE)
    int ax = bx - 25 - lcd.textWidth(buf) - 10;
    lcd.fillTriangle(ax, 6, ax - 5, 12, ax + 5, 12, C_GOLD); lcd.fillRect(ax - 2, 12, 5, 6, C_GOLD);
  }
}

void drawStatus() {
  int y = HDR;
  if (alertUntil) {
    lcd.fillRect(0, y, W, STAT, alertCol);
    lcd.setFont(&fonts::Font2); lcd.setTextColor(C_BG, alertCol);
    lcd.setTextDatum(middle_center); lcd.drawString(alertTxt, W / 2, y + STAT / 2); lcd.setTextDatum(top_left);
    return;
  }
  lcd.fillRect(0, y, W, STAT, C_BG);
  lcd.setFont(&fonts::Font0);
  char buf[48];
  float P = livePrice();
  if (haveData) {
    if (LS) { if (okf(D.em)) snprintf(buf, sizeof(buf), "EM %.1f  exp %s", D.em, D.exp); else snprintf(buf, sizeof(buf), "exp %s", D.exp); }
    else if (okf(P) && okf(D.open)) snprintf(buf, sizeof(buf), "%+.1f  EM %.1f", P - D.open, okf(D.em) ? D.em : 0.0f);
    else buf[0] = 0;
    lcd.setTextColor(C_DIM, C_BG); lcd.setTextDatum(middle_right); lcd.drawString(buf, W - 4, y + STAT / 2);
  }
  lcd.setTextDatum(middle_left);
  if (!haveData) { lcd.setTextColor(C_DIM, C_BG); lcd.drawString("waiting for data...", 4, y + STAT / 2); lcd.setTextDatum(top_left); return; }
  if (!D.mkt) { lcd.setTextColor(C_DIM, C_BG); lcd.drawString("MARKET CLOSED", 4, y + STAT / 2); lcd.setTextDatum(top_left); return; }
  for (int i = 0; i < D.nz; i++) {
    Zone &z = D.z[i];
    if (P >= z.lo && P <= z.hi) {
      snprintf(buf, sizeof(buf), "IN %s ZONE %.0f", z.t == 'C' ? "CALL" : z.t == 'P' ? "PUT" : "VOL", z.k);
      lcd.setTextColor(zoneCol(z.t), C_BG); lcd.drawString(buf, 4, y + STAT / 2); lcd.setTextDatum(top_left);
      return;
    }
  }
  int bi = -1, ai = -1;
  for (int i = 0; i < D.nz; i++) {
    if (D.z[i].hi < P && (bi < 0 || D.z[i].hi > D.z[bi].hi)) bi = i;
    if (D.z[i].lo > P && (ai < 0 || D.z[i].lo < D.z[ai].lo)) ai = i;
  }
  int x = 4;
  if (ai >= 0) {
    snprintf(buf, sizeof(buf), "R %.0f +%.1f", D.z[ai].k, D.z[ai].lo - P);
    lcd.setTextColor(zoneCol(D.z[ai].t), C_BG); lcd.drawString(buf, x, y + STAT / 2); x += lcd.textWidth(buf) + 10;
  }
  if (bi >= 0) {
    snprintf(buf, sizeof(buf), "S %.0f -%.1f", D.z[bi].k, P - D.z[bi].hi);
    lcd.setTextColor(zoneCol(D.z[bi].t), C_BG); lcd.drawString(buf, x, y + STAT / 2);
  }
  lcd.setTextDatum(top_left);
}

// ---- กราฟ ----
void hDash(int x0, int x1, int y, uint16_t c, int on = 4, int off = 3) { for (int x = x0; x < x1; x += on + off) spr.drawFastHLine(x, y, min(on, x1 - x), c); }

struct Tag { int y; float v; uint16_t c; };
Tag tags[12]; int nTags;
void addTag(int y, float v, uint16_t c) { if (y >= 0 && y < hChart && nTags < 12) tags[nTags++] = {y, v, c}; }

const int AX = 38;               // แกนราคาขวา
int panBars = 0; float yShift = 0;  // เลื่อนกราฟ: ย้อนหลังกี่แท่ง / เลื่อนราคาขึ้นลง
float lastPPP = 0.1f, lastCW = 6;   // ราคาต่อพิกเซล / ความกว้างแท่ง (ใช้ตอนลาก)

void drawChart() {
  spr.fillScreen(C_BG);
  if (!haveData || !D.nb) { spr.pushSprite(0, yChart); return; }
  const int PW = W - AX;
  float P = livePrice();
  int n = min(ZOOM[zoomIdx], D.nb);
  panBars = max(0, min(panBars, D.nb - n));
  int last = D.nb - 1 - panBars, first = last - n + 1;
  // ช่วงราคาจากแท่งที่มองเห็น (แบบแอป) + การเลื่อนขึ้นลงด้วยนิ้ว
  float lo = 1e9, hi = -1e9;
  for (int i = first; i <= last; i++) { lo = min(lo, D.b[i][2]); hi = max(hi, D.b[i][1]); }
  if (!panBars && okf(P)) { lo = min(lo, P); hi = max(hi, P); }
  float span = max(hi - lo, 6.0f), mid = (lo + hi) / 2;
  lo = mid - span * 0.6f + yShift; hi = mid + span * 0.6f + yShift;
  lastPPP = (hi - lo) / (hChart - 1);
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
  for (int i = 0; i < D.ns; i++) {
    Strike &s = D.s[i];
    int y = Y(s.k); if (y < -10 || y > hChart + 10) continue;
    if (s.rc || s.rp) {
      bool useC = s.rc && (!s.rp || s.c >= s.p);
      int rk = useC ? s.rc : s.rp;
      float half = rk <= 5 ? 2.5f : 1.25f;
      int y1 = Y(s.k + half), y2 = Y(s.k - half);
      spr.fillRect(0, y1, PW, max(1, y2 - y1), useC ? C_ZC : C_ZP);
      if (rk <= 5) spr.drawFastHLine(0, y, PW, useC ? C_CALL : C_PUT);
    }
    if (s.tv) spr.drawFastHLine(0, y, PW, C_GOLD);
  }
  if (okf(D.open) && okf(D.em)) { hDash(0, PW, Y(D.open + D.em), C_EM, 2, 3); hDash(0, PW, Y(D.open - D.em), C_EM, 2, 3); }
  if (okf(D.mp)) { int y = Y(D.mp); hDash(0, PW, y, C_MP); addTag(y, D.mp, C_MP); }
  if (okf(D.gm)) { int y = Y(D.gm); hDash(0, PW, y, C_GMM, 6, 2); addTag(y, D.gm, C_GMM); }
  if (okf(D.itd)) { int y = Y(D.itd); hDash(0, PW, y, C_GMI, 6, 2); addTag(y, D.itd, C_GMI); }

  // แท่งเทียน · เว้นที่ว่างด้านขวา 22% ให้แท่งปัจจุบันไม่ชิดขอบ (แบบแอป)
  float cw = (PW * 0.78f) / n; lastCW = cw;
  int bw = max(1, (int)(cw * 0.7f));
  for (int i = 0; i < n; i++) {
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
  // เลื่อนกราฟอยู่: ป้ายบอกวิธีกลับ (แตะแกนราคา)
  if (panBars || fabsf(yShift) > 0.01f) {
    spr.fillRoundRect(PW - 50, 2, 48, 12, 3, C_PANEL);
    spr.setTextColor(C_GOLD); spr.setTextDatum(middle_center); spr.drawString("AUTO >", PW - 26, 8);
  }
  spr.setTextDatum(top_left);
  spr.pushSprite(0, yChart);
}
// แถบล่าง: ไทม์เฟรม · ซูม · รีเฟรช · ตั้งค่า
int tbX[8], tbW[8];
void layoutToolbar() {
  int g = 3, iconW = LS ? 28 : 24, zw = LS ? 30 : 25;
  int tw = (W - 9 * g - 2 * iconW - 2 * zw) / 4, x = g;
  for (int i = 0; i < 4; i++) { tbX[i] = x; tbW[i] = tw; x += tw + g; }
  for (int i = 4; i < 6; i++) { tbX[i] = x; tbW[i] = zw; x += zw + g; }
  for (int i = 6; i < 8; i++) { tbX[i] = x; tbW[i] = iconW; x += iconW + g; }
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
    lcd.drawArc(cx, cy, 7, 6, 35, 310, C_GOLD, C_PANEL);
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
  drawToolbarIcon(6, false);
  drawToolbarIcon(7, true);
}

void drawMain() {
  lcd.fillScreen(C_BG);
  drawHeader(); drawStatus(); drawChart(); drawToolbar();
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
    if (sc == SC_MAIN) drawMain(); else if (sc == SC_MENU) drawMenu();
  }
}
void updateScreenPower() {
  if (sc == SC_WIFI || sc == SC_KB) { setScreen(false); return; }
  setScreen((manualOff || schedOff()) && millis() >= wakeUntil);
}

// ---------------- เมนูตั้งค่า ----------------
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
  spr.deleteSprite();   // คืนหน่วยความจำให้การดาวน์โหลด
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
  sc = SC_MENU; drawMenu();
}

// ---------------- เมนูตั้งค่า ----------------
const int MENU_N = 6;  // แถว: [หมุน|เสียง] [ความสว่าง|ปิดจอ] [ปิดจอเอง] [WiFi] [อัปเดต] [กลับ]
void drawMenu() {
  lcd.fillScreen(C_BG);
  lcd.setFont(&fonts::Font2); lcd.setTextColor(C_GOLD, C_BG);
  lcd.drawString("OI GOLD PRO MINI  v" FW_VER, 8, 6);
  int bw = W - 16, hw = (bw - 6) / 2, bh = (H - 36) / MENU_N - 5, y = 28;
  const char *rot[4] = {"ROT: PORT", "ROT: LAND", "ROT: PORT 180", "ROT: LAND 180"};
  const char *br[3] = {"BRIGHT: HIGH", "BRIGHT: MID", "BRIGHT: LOW"};
  button(8, y, hw, bh, rot[rotIdx], C_PANEL, C_TEXT, C_LINE);
  button(14 + hw, y, hw, bh, muted ? "SOUND: OFF" : "SOUND: ON", C_PANEL, muted ? C_DN : C_UP, C_LINE); y += bh + 5;
  button(8, y, hw, bh, br[brightIdx], C_PANEL, C_TEXT, C_LINE);
  button(14 + hw, y, hw, bh, "SCREEN OFF", C_PANEL, C_GOLD, C_LINE); y += bh + 5;
  button(8, y, bw, bh, AUTO_N[autoOff], C_PANEL, autoOff ? C_TEXT : C_DIM, C_LINE); y += bh + 5;
  button(8, y, bw, bh, "WIFI SETUP", C_PANEL, C_TEXT, C_LINE); y += bh + 5;
  char u[32];
  if (newVer[0]) snprintf(u, sizeof(u), "UPDATE TO v%s", newVer); else strcpy(u, "CHECK FOR UPDATE");
  button(8, y, bw, bh, u, newVer[0] ? C_CALL : C_PANEL, newVer[0] ? C_BG : C_TEXT, C_LINE); y += bh + 5;
  button(8, y, bw, bh, "BACK", C_GOLD, hex(0x1a1405));
}

void handleMenuTap(int x, int y) {
  int bh = (H - 36) / MENU_N - 5, i = (y - 28) / (bh + 5);
  bool right = x > W / 2;
  if (y < 28 || i >= MENU_N) return;
  if (i == 0 && !right) { rotIdx = (rotIdx + 1) & 3; prefs.putInt("rot", rotIdx); applyRotation(rotIdx); drawMenu(); }
  else if (i == 0) { muted = !muted; prefs.putBool("mute", muted); if (muted) beepLeft = 0; else tone(SPK, 2000, 80); drawMenu(); }
  else if (i == 1 && !right) { brightIdx = (brightIdx + 1) % 3; prefs.putInt("br", brightIdx); lcd.setBrightness(BRIGHT[brightIdx]); drawMenu(); }
  else if (i == 1) { manualOff = true; wakeUntil = 0; sc = SC_MAIN; setScreen(true); }  // แตะจอเพื่อเปิด
  else if (i == 2) { autoOff = (autoOff + 1) & 3; prefs.putInt("ao", autoOff); wakeUntil = millis() + 5000; drawMenu(); }
  else if (i == 3) openWifi();
  else if (i == 4) {
    if (newVer[0]) { doUpdate(); return; }
    button(8, 28 + 4 * (bh + 5), W - 16, bh, "CHECKING...", C_PANEL, C_DIM, C_LINE);
    bool ok = WiFi.status() == WL_CONNECTED && checkUpdate();
    lastUpdCheck = millis();
    drawMenu();
    if (!ok || !newVer[0]) button(8, 28 + 4 * (bh + 5), W - 16, bh, ok ? "UP TO DATE" : "CHECK FAILED", C_PANEL, ok ? C_UP : C_DN, C_LINE);
  }
  else { sc = SC_MAIN; drawMain(); }
}

// ---------------- ตั้งค่า WiFi จากจอ ----------------
struct Net { char ssid[33]; int rssi; bool open; };
Net nets[7]; int nNets = 0;
char selSsid[33] = ""; char pass[64] = ""; int passLen = 0;
bool kbShift = false, kbSym = false;

void openWifi() {
  sc = SC_WIFI;
  lcd.setRotation(1); W = lcd.width(); H = lcd.height();  // ตั้งค่า WiFi ใช้แนวนอนเสมอ
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
  button(4, H - 32, 150, 28, "RESCAN", C_PANEL, C_TEXT, C_LINE);
  button(W - 154, H - 32, 150, 28, "BACK", C_PANEL, C_TEXT, C_LINE);
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
  char t[48]; snprintf(t, sizeof(t), "Password: %s", selSsid);
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

bool connectWifi(const char *ssid, const char *pw, uint32_t ms, bool showUi) {
  if (showUi) {
    lcd.fillScreen(C_BG); lcd.setFont(&fonts::Font2); lcd.setTextColor(C_GOLD, C_BG);
    char t[56]; snprintf(t, sizeof(t), "Connecting %s", ssid); lcd.drawString(t, 8, 8);
    lcd.setTextColor(C_DIM, C_BG); lcd.drawString("tap screen to change WiFi", 8, 30);
  }
  WiFi.mode(WIFI_STA); WiFi.disconnect(); delay(100);
  WiFi.begin(ssid, pw);
  uint32_t t0 = millis(); int32_t x, y;
  while (WiFi.status() != WL_CONNECTED && millis() - t0 < ms) {
    if (showUi) {
      lcd.fillCircle(12 + ((millis() - t0) / 500 % 20) * 14, 60, 4, C_GOLD);
      if (tapped(x, y)) return false;
    }
    delay(50);
  }
  return WiFi.status() == WL_CONNECTED;
}

void finishWifi() {
  sc = SC_MAIN;
  applyRotation(rotIdx);
  lastFetch = 0;
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

void handleWifiTap(int x, int y) {
  if (y >= H - 32) { if (x < 160) openWifi(); else finishWifi(); return; }
  int i = (y - 26) / 25;
  if (y >= 26 && i >= 0 && i < nNets) {
    strlcpy(selSsid, nets[i].ssid, 33);
    pass[0] = 0; passLen = 0;
    if (nets[i].open) { tryConnectSelected(); return; }
    if (prefs.getString("ssid", "") == selSsid) { strlcpy(pass, prefs.getString("pass", "").c_str(), 64); passLen = strlen(pass); }
    kbShift = false; kbSym = false; sc = SC_KB; drawKb();
  }
}

void handleKbTap(int x, int y) {
  if (y >= 194) {
    if (x < 52) { kbShift = !kbShift; drawKb(); }
    else if (x < 104) { kbSym = !kbSym; drawKb(); }
    else if (x < 196) kbAdd(' ');
    else if (x < 254) { if (passLen) { pass[--passLen] = 0; drawKbText(); } }
    else tryConnectSelected();
    return;
  }
  if (y < 50) { if (y < 20) { sc = SC_WIFI; drawWifi(); } return; }  // แตะหัวข้อ = กลับรายการ WiFi
  int r = (y - 50) / 36; if (r < 0 || r > 3) return;
  const char *row = KB_ROWS[kbSym][r]; int n = strlen(row), off = (W - n * 32) / 2;
  int i = (x - off) / 32; if (x < off || i >= n) return;
  char c = row[i];
  if (!kbSym && kbShift && c >= 'a' && c <= 'z') c -= 32;
  kbAdd(c);
}

// ---------------- ราคาสด: Bybit XAUUSDT + offset (แบบแอป) ----------------
static const char *PERP_URL = "https://api.bybit.com/v5/market/tickers?category=linear&symbol=XAUUSDT";
float perp = NAN; uint32_t perpAt = 0;
bool perpFresh() { return okf(perp) && okf(D.off) && millis() - perpAt < 6000; }
float livePrice() { return perpFresh() ? perp + D.off : (haveData ? D.p : NAN); }

bool pollPerp() {
  HTTPClient http; http.setReuse(true); http.setTimeout(2500);
  if (!http.begin(perpCli, PERP_URL)) return false;
  int code = http.GET();
  if (code != 200) { http.end(); return false; }
  String s = http.getString(); http.end();
  int i = s.indexOf("\"lastPrice\":\""); if (i < 0) return false;
  float v = s.substring(i + 13).toFloat(); if (v <= 0) return false;
  perp = v; perpAt = millis();
  return true;
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
      if (panBars) panBars++;  // เลื่อนดูย้อนหลังอยู่: คงตำแหน่งเดิมไว้
    }
  }
  float *b = D.b[D.nb - 1];
  b[3] = P; b[1] = max(b[1], P); b[2] = min(b[2], P);
}

// ---------------- หน้าหลัก: แตะ / ลาก ----------------
void handleMainTap(int x, int y) {
  if (y >= yTool) {
    for (int i = 0; i < 8; i++) if (x >= tbX[i] - 1 && x <= tbX[i] + tbW[i] + 1) {
      if (i < 4) { if (tfIdx != i) { tfIdx = i; prefs.putInt("tf", tfIdx); haveData = false; nzst = 0; panBars = 0; yShift = 0; lastFetch = 0; drawToolbar(); drawChart(); } }
      else if (i == 4) { if (zoomIdx < 5) { zoomIdx++; prefs.putInt("zm", zoomIdx); drawToolbar(); drawChart(); } }  // − = เห็นแท่งมากขึ้น
      else if (i == 5) { if (zoomIdx > 0) { zoomIdx--; prefs.putInt("zm", zoomIdx); drawToolbar(); drawChart(); } }  // + = ขยาย
      else if (i == 6) {
        if (WiFi.status() == WL_CONNECTED) {
          lastFetch = millis();
          bool ok = fetchData();
          if (ok) { lastOk = millis(); tickCandle(); evalAlerts(); }
          if (haveData && pollPerp()) { tickCandle(); evalAlerts(); }
          drawMain();
        } else {
          drawStatus();
        }
      }
      else { sc = SC_MENU; drawMenu(); }
      return;
    }
    return;
  }
  if (y >= HDR && y < HDR + STAT && alertUntil) {  // แตะแถบแจ้งเตือน = ปิด
    alertUntil = 0; ledUntil = 0; beepLeft = 0; setLed(0); drawStatus(); return;
  }
  if (y >= yChart && x >= W - AX) { panBars = 0; yShift = 0; drawChart(); }  // แตะแกนราคา = กลับอัตโนมัติ
}

bool tDown = false, tDrag = false; int32_t tx0, ty0; int panBars0; float yShift0; uint32_t lastDragDraw = 0;
void handleTouchMain() {
  int32_t x, y;
  bool d = lcd.getTouch(&x, &y) > 0;
  if (d) {
    if (!tDown) { tDown = true; tDrag = false; tx0 = x; ty0 = y; panBars0 = panBars; yShift0 = yShift; return; }
    if (ty0 >= yChart && ty0 < yTool && tx0 < W - AX) {  // ลากบนกราฟ = เลื่อน (ซ้าย-ขวา = เวลา, ขึ้น-ลง = ราคา)
      int dx = x - tx0, dy = y - ty0;
      if (!tDrag && (abs(dx) > 6 || abs(dy) > 6)) tDrag = true;
      if (tDrag && millis() - lastDragDraw > 60) {
        panBars = max(0, panBars0 + (int)roundf(dx / max(1.0f, lastCW)));
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
  zoomIdx = prefs.getInt("zm", 2); if (zoomIdx < 0 || zoomIdx > 5) zoomIdx = 2;
  D.off = NAN;

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
  delay(900);

  perpCli.setInsecure();
  configTime(7 * 3600, 0, "pool.ntp.org", "time.google.com");  // เวลาไทย
  battPct = readBatt();
  WiFi.setAutoReconnect(true);
  String ss = prefs.getString("ssid", ""), pw = prefs.getString("pass", "");
  if (ss.length() && connectWifi(ss.c_str(), pw.c_str(), 15000, true)) finishWifi();
  else openWifi();
}

uint32_t lastHdr = 0, lastPerp = 0;
void loop() {
  int32_t x, y;
  serviceAlerts();
  static uint32_t lastPow = 0;
  if (millis() - lastPow >= 500) { lastPow = millis(); updateScreenPower(); }
  if (scrOff) {
    // จอดับ: แตะที่ไหนก็ได้ = เปิด (ปิดเอง → เปิดถาวร, ปิดตามเวลา → เปิด 5 นาที) · ยังดึงราคาและแจ้งเตือนต่อ
    if (tapped(x, y)) { if (manualOff) manualOff = false; else wakeUntil = millis() + 5UL * 60 * 1000; while (lcd.getTouch(&x, &y)) delay(20); wasDown = false; updateScreenPower(); return; }  // รอปล่อยนิ้ว ไม่ให้แตะนี้ไปกดปุ่ม
    uint32_t ms = millis();
    bool online = WiFi.status() == WL_CONNECTED;
    if (online && (lastFetch == 0 || ms - lastFetch >= FETCH_MS)) { lastFetch = ms; if (fetchData()) { lastOk = millis(); tickCandle(); evalAlerts(); } }
    if (online && haveData && ms - lastPerp >= 1000) { lastPerp = ms; if (pollPerp()) { tickCandle(); evalAlerts(); } }
    delay(10);
    return;
  }
  if (sc == SC_WIFI) { if (tapped(x, y)) handleWifiTap(x, y); delay(10); return; }
  if (sc == SC_KB) { if (tapped(x, y)) handleKbTap(x, y); delay(10); return; }
  if (sc == SC_MENU) { if (tapped(x, y)) handleMenuTap(x, y); delay(10); return; }

  handleTouchMain();
  if (tDown) { delay(5); return; }  // กำลังลาก: ไม่ดึงข้อมูลแทรก
  uint32_t ms = millis();
  bool online = WiFi.status() == WL_CONNECTED;
  if (online && (lastFetch == 0 || ms - lastFetch >= FETCH_MS)) {
    lastFetch = ms;
    if (fetchData()) { lastOk = millis(); tickCandle(); evalAlerts(); drawStatus(); drawChart(); }
    drawHeader();
  }
  if (online && haveData && ms - lastPerp >= 1000) {  // ราคาสดทุก 1 วินาที
    lastPerp = ms;
    if (pollPerp()) { tickCandle(); evalAlerts(); drawChart(); drawHeader(); lastHdr = ms; }
  }
  if (online && (lastUpdCheck == 0 || ms - lastUpdCheck >= 6UL * 3600 * 1000) && ms > 20000) {  // เช็กเวอร์ชันใหม่ตอนเปิดเครื่องและทุก 6 ชม.
    lastUpdCheck = ms; checkUpdate(); drawHeader();
  }
  if (ms - lastHdr >= 1000) { lastHdr = ms; battPct = readBatt(); drawHeader(); }
  delay(5);
}

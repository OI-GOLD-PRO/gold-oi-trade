// OI Gold Pro Mini — จอ ESP32 CYD 2.8" (ESP32-2432S028 รุ่น 2 USB, ชิปจอ ILI9341)
// กราฟแท่งเทียน Gold.F + OI/Volume ราย strike แบบแอป OI Gold Pro (Call เขียว แนวต้าน · Put แดง แนวรับ)
// เส้น gmf itd / gmf M / Max Pain / Expected Move · โซน OI 10 อันดับ · แจ้งเตือนเข้าโซน/ทะลุโซน
// ข้อมูลจาก Worker: https://gc-yahoo.oigoldpro.workers.dev/mini?tf=1|5|15|60 (อัปเดตทุก 15 วินาที)
//
// Arduino IDE:  Board = ESP32 Dev Module
//               Partition Scheme = Minimal SPIFFS (1.9MB APP with OTA)
// Libraries:    LovyanGFX, ArduinoJson (v7)

#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <Preferences.h>
#include <ArduinoJson.h>
#include <LovyanGFX.hpp>
#include <math.h>

#define FW_VER "0.2.0"
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
uint16_t calData[8] = {291, 3625, 281, 205, 3806, 3629, 3834, 192};  // วัดจากบอร์ดนี้ 2026-10-28

// ---------------- สี (ชุดเดียวกับแอป) ----------------
uint16_t C_BG, C_PANEL, C_LINE, C_TEXT, C_DIM, C_GOLD, C_UP, C_DN, C_CALL, C_PUT, C_GMI, C_GMM, C_MP, C_VOLC, C_VOLP, C_EM;
uint16_t C_ZC, C_ZP, C_ZV;
uint16_t rgb(uint8_t r, uint8_t g, uint8_t b) { return lcd.color565(r, g, b); }
uint16_t hex(uint32_t h) { return lcd.color565(h >> 16, (h >> 8) & 255, h & 255); }
uint16_t blend(uint32_t a, uint32_t b, float t) {  // ผสมสี a ทับพื้น b ความเข้ม t
  return rgb(((a >> 16) & 255) * t + ((b >> 16) & 255) * (1 - t), ((a >> 8) & 255) * t + ((b >> 8) & 255) * (1 - t), (a & 255) * t + (b & 255) * (1 - t));
}
void initColors() {
  C_BG = hex(0x0b1020); C_PANEL = hex(0x121a30); C_LINE = hex(0x1f2a46); C_TEXT = hex(0xe6e9f2); C_DIM = hex(0x8a93ab);
  C_GOLD = hex(0xe0b44c); C_UP = hex(0x26a69a); C_DN = hex(0xef5350);
  C_CALL = hex(0x2fbf8f); C_PUT = hex(0xe5576b); C_GMI = hex(0x22d3ee); C_GMM = hex(0xf59e0b); C_MP = hex(0xff3fb4);
  C_VOLC = hex(0x8ccaff); C_VOLP = hex(0xffb98a); C_EM = hex(0x8a93ab);
  C_ZC = blend(0x2fbf8f, 0x0b1020, 0.18); C_ZP = blend(0xe5576b, 0x0b1020, 0.18); C_ZV = blend(0xe0b44c, 0x0b1020, 0.18);
}

// ---------------- ข้อมูล ----------------
struct Zone { float k, lo, hi; char t; long c, p; };
struct Strike { float k; long c, p, vc, vp; uint8_t rc, rp, tv; };
#define MAXB 120
#define MAXS 40
struct Data {
  float p; float b[MAXB][4]; int nb; int bs;
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

void drawStatus(); void drawWifi(); void drawKb(); void drawMain(); void drawHeader(); void drawMenu(); void openWifi();

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

  D.p = jf(doc["p"]); D.bs = doc["bs"] | 60;
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
}

uint16_t zoneCol(char t) { return t == 'C' ? C_CALL : t == 'P' ? C_PUT : C_GOLD; }

void evalAlerts() {
  if (!haveData || !okf(D.p) || !D.mkt) return;
  uint32_t now = millis() / 1000;
  ZState nw[16]; int n = 0;
  for (int i = 0; i < D.nz && n < 16; i++) {
    Zone &z = D.z[i];
    ZState s; bool found = false;
    for (int j = 0; j < nzst; j++) if (zst[j].k == z.k) { s = zst[j]; found = true; break; }
    bool in = D.p >= z.lo && D.p <= z.hi;
    if (!found) { s = {z.k, in, in, in, false, now, 0}; nw[n++] = s; continue; }  // เพิ่งเห็นโซนนี้: จำไว้ก่อน ไม่เตือน
    char buf[40];
    const char *nm = z.t == 'C' ? "CALL" : z.t == 'P' ? "PUT" : "VOL";
    if (in && !s.inside && (!s.hasReach || now - s.lastReach >= 3600)) {
      s.hasReach = true; s.lastReach = now; s.reached = true;
      snprintf(buf, sizeof(buf), "ZONE %s %.0f", nm, z.k);
      fireAlert(buf, zoneCol(z.t), z.t == 'C' ? 2 : z.t == 'P' ? 1 : 3, 2, 2200);
    }
    s.inside = in;
    bool up = D.p > z.hi + 2, dn = D.p < z.lo - 2;
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
void drawHeader() {
  lcd.fillRect(0, 0, W, HDR, C_PANEL);
  lcd.drawFastHLine(0, HDR - 1, W, C_LINE);
  char buf[24];
  // ราคา (สีทองแบบแอป) + เปลี่ยนจากราคาเปิดวัน
  lcd.setFont(&fonts::Font4); lcd.setTextColor(C_GOLD, C_PANEL);
  if (haveData && okf(D.p)) snprintf(buf, sizeof(buf), "%.1f", D.p); else strcpy(buf, "----.-");
  lcd.drawString(buf, 4, 1);
  int x = 4 + lcd.textWidth(buf) + 6;
  lcd.setFont(&fonts::Font2);
  if (haveData && okf(D.p) && okf(D.open)) {
    float ch = D.p - D.open;
    snprintf(buf, sizeof(buf), "%+.1f", ch);
    lcd.setTextColor(ch >= 0 ? C_UP : C_DN, C_PANEL); lcd.drawString(buf, x, 6);
  }
  // อายุข้อมูล + สัญญาณ WiFi
  uint16_t col = C_DIM;
  if (WiFi.status() != WL_CONNECTED) { strcpy(buf, "NO WIFI"); col = C_DN; }
  else if (!haveData) strcpy(buf, "LOAD");
  else { uint32_t age = (millis() - lastOk) / 1000; snprintf(buf, sizeof(buf), "%lus", (unsigned long)age); col = age > 60 ? C_DN : C_DIM; }
  lcd.setTextColor(col, C_PANEL); lcd.setTextDatum(top_right); lcd.drawString(buf, W - 26, 6); lcd.setTextDatum(top_left);
  int bars = 0;
  if (WiFi.status() == WL_CONNECTED) { int r = WiFi.RSSI(); bars = r > -55 ? 4 : r > -65 ? 3 : r > -75 ? 2 : 1; }
  for (int i = 0; i < 4; i++) { int h = 3 + i * 3; lcd.fillRect(W - 22 + i * 5, 19 - h, 3, h, i < bars ? C_TEXT : C_LINE); }
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
  // ขวา: Expected Move + เวลาหมดอายุ
  if (haveData) {
    if (okf(D.em)) snprintf(buf, sizeof(buf), LS ? "EM %.1f  exp %s" : "EM %.1f", D.em, D.exp); else snprintf(buf, sizeof(buf), "exp %s", D.exp);
    lcd.setTextColor(C_DIM, C_BG); lcd.setTextDatum(middle_right); lcd.drawString(buf, W - 4, y + STAT / 2); lcd.setTextDatum(top_left);
  }
  lcd.setTextDatum(middle_left);
  if (!haveData) { lcd.setTextColor(C_DIM, C_BG); lcd.drawString("waiting for data...", 4, y + STAT / 2); lcd.setTextDatum(top_left); return; }
  if (!D.mkt) { lcd.setTextColor(C_DIM, C_BG); lcd.drawString("MARKET CLOSED", 4, y + STAT / 2); lcd.setTextDatum(top_left); return; }
  for (int i = 0; i < D.nz; i++) {
    Zone &z = D.z[i];
    if (D.p >= z.lo && D.p <= z.hi) {
      snprintf(buf, sizeof(buf), "IN %s ZONE %.0f", z.t == 'C' ? "CALL" : z.t == 'P' ? "PUT" : "VOL", z.k);
      lcd.setTextColor(zoneCol(z.t), C_BG); lcd.drawString(buf, 4, y + STAT / 2); lcd.setTextDatum(top_left);
      return;
    }
  }
  int bi = -1, ai = -1;
  for (int i = 0; i < D.nz; i++) {
    if (D.z[i].hi < D.p && (bi < 0 || D.z[i].hi > D.z[bi].hi)) bi = i;
    if (D.z[i].lo > D.p && (ai < 0 || D.z[i].lo < D.z[ai].lo)) ai = i;
  }
  int x = 4;
  if (ai >= 0) {
    snprintf(buf, sizeof(buf), "R %.0f +%.1f", D.z[ai].k, D.z[ai].lo - D.p);
    lcd.setTextColor(zoneCol(D.z[ai].t), C_BG); lcd.drawString(buf, x, y + STAT / 2); x += lcd.textWidth(buf) + 10;
  }
  if (bi >= 0) {
    snprintf(buf, sizeof(buf), "S %.0f -%.1f", D.z[bi].k, D.p - D.z[bi].hi);
    lcd.setTextColor(zoneCol(D.z[bi].t), C_BG); lcd.drawString(buf, x, y + STAT / 2);
  }
  lcd.setTextDatum(top_left);
}

// ---- กราฟ ----
void hDash(int x0, int x1, int y, uint16_t c, int on = 4, int off = 3) { for (int x = x0; x < x1; x += on + off) spr.drawFastHLine(x, y, min(on, x1 - x), c); }

struct Tag { int y; float v; uint16_t c; };
Tag tags[12]; int nTags;
void addTag(int y, float v, uint16_t c) { if (y >= 0 && y < hChart && nTags < 12) tags[nTags++] = {y, v, c}; }

void drawChart() {
  spr.fillScreen(C_BG);
  if (!haveData || !D.nb) { spr.pushSprite(0, yChart); return; }
  const int AX = 38, PW = W - AX;  // แกนราคาขวา
  int n = min(ZOOM[zoomIdx], D.nb), first = D.nb - n;
  // ช่วงราคาจากแท่งที่มองเห็น (แบบแอป: ปรับสเกลตามแท่งเทียน)
  float lo = 1e9, hi = -1e9;
  for (int i = first; i < D.nb; i++) { lo = min(lo, D.b[i][2]); hi = max(hi, D.b[i][1]); }
  float span = max(hi - lo, 6.0f), mid = (lo + hi) / 2;
  lo = mid - span * 0.6f; hi = mid + span * 0.6f;
  auto Y = [&](float v) { return (int)roundf((hi - v) / (hi - lo) * (hChart - 1)); };
  nTags = 0;

  // เส้นตารางราคา
  float rng = hi - lo, steps[] = {0.5, 1, 2, 2.5, 5, 10, 20, 25, 50, 100}, st = 100;
  for (float s : steps) if (rng / s <= 6) { st = s; break; }
  for (float v = ceilf(lo / st) * st; v <= hi; v += st) spr.drawFastHLine(0, Y(v), PW, C_LINE);

  // ---- OI / Volume ราย strike (เหมือน drawOIBars ในแอป) ----
  long maxOI = 1, maxV = 1;
  for (int i = 0; i < D.ns; i++) { maxOI = max(maxOI, max(D.s[i].c, D.s[i].p)); maxV = max(maxV, max(D.s[i].vc, D.s[i].vp)); }
  int gap = 999; { int py = -999; for (int i = 0; i < D.ns; i++) { int y = Y(D.s[i].k); if (py != -999) gap = min(gap, abs(y - py)); py = y; } }
  int thick = max(1, min(4, gap / 2 - 1));
  int barMax = min((int)(PW * 0.32f), 110), volMax = min((int)(PW * 0.14f), 45), padL = 28;
  for (int i = 0; i < D.ns; i++) {
    Strike &s = D.s[i];
    int y = Y(s.k); if (y < -10 || y > hChart + 10) continue;
    // โซนกำแพง OI 10 อันดับต่อฝั่ง: 1-5 กว้าง ±2.5 + เส้นทึบ · 6-10 กว้าง ±1.25
    if (s.rc || s.rp) {
      bool useC = s.rc && (!s.rp || s.c >= s.p);
      int rk = useC ? s.rc : s.rp;
      float half = rk <= 5 ? 2.5f : 1.25f;
      int y1 = Y(s.k + half), y2 = Y(s.k - half);
      spr.fillRect(0, y1, PW, max(1, y2 - y1), useC ? C_ZC : C_ZP);
      if (rk <= 5) { spr.drawFastHLine(0, y, PW, useC ? C_CALL : C_PUT); }
    }
    if (s.tv) spr.drawFastHLine(0, y, PW, C_GOLD);  // Volume วันนี้ 5 อันดับ
  }
  // เส้นระดับ (เส้นประแบบแอป)
  if (okf(D.open) && okf(D.em)) { hDash(0, PW, Y(D.open + D.em), C_EM, 2, 3); hDash(0, PW, Y(D.open - D.em), C_EM, 2, 3); }
  if (okf(D.mp)) { int y = Y(D.mp); hDash(0, PW, y, C_MP); addTag(y, D.mp, C_MP); }
  if (okf(D.gm)) { int y = Y(D.gm); hDash(0, PW, y, C_GMM, 6, 2); addTag(y, D.gm, C_GMM); }
  if (okf(D.itd)) { int y = Y(D.itd); hDash(0, PW, y, C_GMI, 6, 2); addTag(y, D.itd, C_GMI); }

  // แท่งเทียน
  float cw = (float)(PW - 4) / n;
  int bw = max(1, (int)(cw * 0.7f));
  for (int i = 0; i < n; i++) {
    float *b = D.b[first + i];
    int x = (int)(i * cw + cw / 2);
    bool up = b[3] >= b[0];
    uint16_t c = up ? C_UP : C_DN;
    spr.drawFastVLine(x, Y(b[1]), max(1, Y(b[2]) - Y(b[1]) + 1), c);
    int yo = Y(b[0]), yc = Y(b[3]);
    spr.fillRect(x - bw / 2, min(yo, yc), bw, max(1, abs(yc - yo)), c);
  }

  // แท่ง OI จากขอบขวา (Call บนเส้น เขียว / Put ใต้เส้น แดง) + Volume จากซ้าย + เลข strike
  spr.setFont(&fonts::Font0); spr.setTextDatum(middle_left);
  for (int i = 0; i < D.ns; i++) {
    Strike &s = D.s[i];
    int y = Y(s.k); if (y < 2 || y > hChart - 3) continue;
    if (s.c > 0) { int L = max(2L, barMax * s.c / maxOI); spr.fillRect(PW - L, y - thick, L, thick, C_CALL); }
    if (s.p > 0) { int L = max(2L, barMax * s.p / maxOI); spr.fillRect(PW - L, y, L, thick, C_PUT); }
    if (s.vc > 0) { int L = max(2L, volMax * s.vc / maxV); spr.fillRect(padL, y - thick, L, thick, C_VOLC); }
    if (s.vp > 0) { int L = max(2L, volMax * s.vp / maxV); spr.fillRect(padL, y, L, thick, C_VOLP); }
    bool big = (s.rc && s.rc <= 5) || (s.rp && s.rp <= 5);
    if (gap >= 9 || big) {
      char buf[8]; snprintf(buf, sizeof(buf), "%.0f", s.k);
      spr.setTextColor(big ? C_TEXT : C_DIM); spr.drawString(buf, 1, y);
    }
  }

  // ราคาล่าสุด
  int yp = Y(D.p);
  hDash(0, PW, yp, C_GOLD, 2, 2);

  // แกนราคาขวา
  spr.fillRect(PW, 0, AX, hChart, C_BG);
  spr.drawFastVLine(PW, 0, hChart, C_LINE);
  char buf[12];
  spr.setTextColor(C_DIM);
  for (float v = ceilf(lo / st) * st; v <= hi; v += st) {
    int y = Y(v); if (y < 5 || y > hChart - 5 || abs(y - yp) < 10) continue;
    bool clash = false; for (int t = 0; t < nTags; t++) if (abs(tags[t].y - y) < 9) clash = true;
    if (clash) continue;
    snprintf(buf, sizeof(buf), st < 1 ? "%.1f" : "%.0f", v); spr.drawString(buf, PW + 3, y);
  }
  // ป้ายระดับสีตามเส้น (gmf itd / gmf M / Max Pain)
  for (int t = 0; t < nTags; t++) {
    if (abs(tags[t].y - yp) < 10) continue;
    int y = max(5, min(hChart - 6, tags[t].y));
    spr.fillRect(PW + 1, y - 5, AX - 1, 11, tags[t].c);
    snprintf(buf, sizeof(buf), "%.1f", tags[t].v);
    spr.setTextColor(C_BG); spr.drawString(buf, PW + 3, y);
  }
  // ป้ายราคาปัจจุบัน
  int yy = max(6, min(hChart - 7, yp));
  spr.fillRect(PW + 1, yy - 6, AX - 1, 13, C_GOLD);
  snprintf(buf, sizeof(buf), "%.1f", D.p);
  spr.setTextColor(C_BG); spr.drawString(buf, PW + 3, yy);
  spr.setTextDatum(top_left);
  spr.pushSprite(0, yChart);
}

// แถบล่าง: ไทม์เฟรม · ซูม −/+ · เมนู
int tbX[7], tbW[7];
void layoutToolbar() {
  int g = 3, mw = LS ? 44 : 34, zw = LS ? 34 : 28;
  int tw = (W - g * 8 - mw - 2 * zw) / 4, x = g;
  for (int i = 0; i < 4; i++) { tbX[i] = x; tbW[i] = tw; x += tw + g; }
  tbX[4] = x + g; tbW[4] = zw; x += zw + 2 * g;
  tbX[5] = x; tbW[5] = zw; x += zw + g + g;
  tbX[6] = W - g - mw; tbW[6] = mw;
}
void drawToolbar() {
  layoutToolbar();
  lcd.fillRect(0, yTool, W, TB, C_BG);
  lcd.drawFastHLine(0, yTool, W, C_LINE);
  for (int i = 0; i < 4; i++) button(tbX[i], yTool + 3, tbW[i], TB - 5, TF_N[i], i == tfIdx ? C_GOLD : C_BG, i == tfIdx ? hex(0x1a1405) : C_DIM, i == tfIdx ? 0 : C_LINE);
  button(tbX[4], yTool + 3, tbW[4], TB - 5, "-", C_PANEL, zoomIdx < 5 ? C_TEXT : C_LINE, C_LINE);
  button(tbX[5], yTool + 3, tbW[5], TB - 5, "+", C_PANEL, zoomIdx > 0 ? C_TEXT : C_LINE, C_LINE);
  button(tbX[6], yTool + 3, tbW[6], TB - 5, "MENU", C_PANEL, C_TEXT, C_LINE);
}

void drawMain() {
  lcd.fillScreen(C_BG);
  drawHeader(); drawStatus(); drawChart(); drawToolbar();
}

// ---------------- เมนูตั้งค่า ----------------
void drawMenu() {
  lcd.fillScreen(C_BG);
  lcd.setFont(&fonts::Font2); lcd.setTextColor(C_GOLD, C_BG);
  lcd.drawString("OI GOLD PRO MINI  v" FW_VER, 8, 6);
  int bw = W - 16, bh = (H - 40) / 5 - 6, y = 30;
  const char *rot[4] = {"ROTATE: PORTRAIT", "ROTATE: LANDSCAPE", "ROTATE: PORTRAIT 180", "ROTATE: LANDSCAPE 180"};
  const char *br[3] = {"BRIGHTNESS: HIGH", "BRIGHTNESS: MID", "BRIGHTNESS: LOW"};
  button(8, y, bw, bh, rot[rotIdx], C_PANEL, C_TEXT, C_LINE); y += bh + 6;
  button(8, y, bw, bh, muted ? "SOUND: OFF" : "SOUND: ON", C_PANEL, muted ? C_DN : C_UP, C_LINE); y += bh + 6;
  button(8, y, bw, bh, br[brightIdx], C_PANEL, C_TEXT, C_LINE); y += bh + 6;
  button(8, y, bw, bh, "WIFI SETUP", C_PANEL, C_TEXT, C_LINE); y += bh + 6;
  button(8, y, bw, bh, "BACK", C_GOLD, hex(0x1a1405));
}

void handleMenuTap(int x, int y) {
  int bh = (H - 40) / 5 - 6, i = (y - 30) / (bh + 6);
  if (y < 30 || i > 4) return;
  if (i == 0) { rotIdx = (rotIdx + 1) & 3; prefs.putInt("rot", rotIdx); applyRotation(rotIdx); drawMenu(); }
  else if (i == 1) { muted = !muted; prefs.putBool("mute", muted); if (muted) beepLeft = 0; else tone(SPK, 2000, 80); drawMenu(); }
  else if (i == 2) { brightIdx = (brightIdx + 1) % 3; prefs.putInt("br", brightIdx); lcd.setBrightness(BRIGHT[brightIdx]); drawMenu(); }
  else if (i == 3) openWifi();
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

// ---------------- หน้าหลัก: แตะ ----------------
void handleMainTap(int x, int y) {
  if (y >= yTool) {
    for (int i = 0; i < 7; i++) if (x >= tbX[i] - 2 && x <= tbX[i] + tbW[i] + 2) {
      if (i < 4) { if (tfIdx != i) { tfIdx = i; prefs.putInt("tf", tfIdx); haveData = false; nzst = 0; lastFetch = 0; drawToolbar(); drawChart(); } }
      else if (i == 4) { if (zoomIdx < 5) { zoomIdx++; prefs.putInt("zm", zoomIdx); drawToolbar(); drawChart(); } }  // − = เห็นแท่งมากขึ้น
      else if (i == 5) { if (zoomIdx > 0) { zoomIdx--; prefs.putInt("zm", zoomIdx); drawToolbar(); drawChart(); } }  // + = ขยาย
      else { sc = SC_MENU; drawMenu(); }
      return;
    }
    return;
  }
  if (y >= HDR && y < HDR + STAT && alertUntil) {  // แตะแถบแจ้งเตือน = ปิด
    alertUntil = 0; ledUntil = 0; beepLeft = 0; setLed(0); drawStatus(); return;
  }
  if (y >= yChart) {  // แตะครึ่งซ้ายของกราฟ = ซูมออก, ครึ่งขวา = ซูมเข้า
    if (x < W / 2 && zoomIdx < 5) zoomIdx++; else if (x >= W / 2 && zoomIdx > 0) zoomIdx--; else return;
    prefs.putInt("zm", zoomIdx); drawToolbar(); drawChart();
  }
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
  zoomIdx = prefs.getInt("zm", 2); if (zoomIdx < 0 || zoomIdx > 5) zoomIdx = 2;

  lcd.init();
  lcd.setTouchCalibrate(calData);
  lcd.setBrightness(BRIGHT[brightIdx]);
  initColors();
  applyRotation(rotIdx);

  lcd.fillScreen(C_BG);
  lcd.setFont(&fonts::Font4); lcd.setTextColor(C_GOLD, C_BG);
  lcd.setTextDatum(middle_center); lcd.drawString("OI GOLD PRO", W / 2, H / 2 - 16);
  lcd.setFont(&fonts::Font2); lcd.setTextColor(C_TEXT, C_BG);
  lcd.drawString("MINI  v" FW_VER, W / 2, H / 2 + 10);
  lcd.setTextDatum(top_left);
  delay(900);

  WiFi.setAutoReconnect(true);
  String ss = prefs.getString("ssid", ""), pw = prefs.getString("pass", "");
  if (ss.length() && connectWifi(ss.c_str(), pw.c_str(), 15000, true)) finishWifi();
  else openWifi();
}

uint32_t lastHdr = 0;
void loop() {
  int32_t x, y;
  serviceAlerts();
  if (sc == SC_WIFI) { if (tapped(x, y)) handleWifiTap(x, y); delay(10); return; }
  if (sc == SC_KB) { if (tapped(x, y)) handleKbTap(x, y); delay(10); return; }
  if (sc == SC_MENU) { if (tapped(x, y)) handleMenuTap(x, y); delay(10); return; }

  if (tapped(x, y)) handleMainTap(x, y);
  uint32_t ms = millis();
  if (WiFi.status() == WL_CONNECTED && (lastFetch == 0 || ms - lastFetch >= FETCH_MS)) {
    lastFetch = ms;
    if (fetchData()) {
      lastOk = millis();
      evalAlerts();
      drawStatus(); drawChart();
    }
    drawHeader();
  }
  if (ms - lastHdr >= 1000) { lastHdr = ms; drawHeader(); }
  delay(10);
}

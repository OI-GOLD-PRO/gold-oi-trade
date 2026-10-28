// OI Gold Pro Mini — จอ ESP32 CYD 2.8" (ESP32-2432S028 รุ่น 2 USB, ชิปจอ ILI9341)
// ราคาทอง Gold.F สด + ระดับ OI ประจำวัน (gmf itd / gmf M / Max Pain / Call-Put Wall / Expected Move / โซน OI)
// ข้อมูลจาก Worker: https://gc-yahoo.oigoldpro.workers.dev/mini (อัปเดตทุก 15 วินาที)
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

#define FW_VER "0.1.0"
static const char *DATA_URL = "https://gc-yahoo.oigoldpro.workers.dev/mini";
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

// ---------------- สี ----------------
uint16_t C_BG, C_PANEL, C_TEXT, C_DIM, C_GOLD, C_UP, C_DN, C_CALL, C_PUT, C_VOL, C_ITD, C_GM, C_MP, C_EM;
uint16_t C_ZC, C_ZP, C_ZV;
uint16_t rgb(uint8_t r, uint8_t g, uint8_t b) { return lcd.color565(r, g, b); }
void initColors() {
  C_BG = rgb(8, 10, 16);     C_PANEL = rgb(24, 28, 40);  C_TEXT = rgb(235, 235, 240); C_DIM = rgb(130, 135, 150);
  C_GOLD = rgb(255, 196, 40); C_UP = rgb(40, 210, 110);  C_DN = rgb(240, 70, 70);
  C_CALL = rgb(240, 70, 70); C_PUT = rgb(40, 200, 110);  C_VOL = rgb(240, 210, 60);
  C_ITD = rgb(255, 140, 0);  C_GM = rgb(190, 110, 255);  C_MP = rgb(80, 200, 255);   C_EM = rgb(150, 150, 165);
  C_ZC = rgb(70, 22, 26);    C_ZP = rgb(18, 60, 34);     C_ZV = rgb(60, 54, 14);
}

// ---------------- ข้อมูล ----------------
struct Zone { float k, lo, hi; char t; long c, p; };
struct Data {
  float p; uint32_t pt; float c[40]; int nc; uint32_t ct;
  float F, open, em, itd, gm, mp, cw, pw;
  char exp[16]; char root[8]; uint32_t upd, now; bool mkt;
  Zone z[12]; int nz;
};
Data D;
bool haveData = false;
uint32_t lastFetch = 0, lastOk = 0;
int dir = 0;  // ทิศราคาเทียบรอบก่อน

// สถานะแจ้งเตือนต่อโซน (กติกาเดียวกับแอป: ถึงโซน → พัก 1 ชม. · ทะลุขอบ $2 → พัก 30 นาที)
struct ZState { float k; bool inside, reached, hasReach, hasBreak; uint32_t lastReach, lastBreak; };
ZState zst[16]; int nzst = 0;
uint32_t alertUntil = 0, ledUntil = 0; char alertTxt[40] = ""; uint16_t alertCol = 0; uint8_t ledMask = 0;
int beepLeft = 0; uint32_t nextBeep = 0; int beepFreq = 2000;

// การตั้งค่า
int rotIdx = 0; bool muted = false; int brightIdx = 0;
const uint8_t BRIGHT[3] = {220, 110, 35};

enum Screen { SC_MAIN, SC_WIFI, SC_KB };
Screen sc = SC_MAIN;

// layout
int W, H; bool LS;
int yStatus, yChart, hChart, yFoot;

void drawStatus(); void drawWifi(); void drawKb(); void drawMain(); void drawHeader();

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

void button(int x, int y, int w, int h, const char *t, uint16_t bg, uint16_t fg) {
  lcd.fillRoundRect(x, y, w, h, 6, bg);
  lcd.setFont(&fonts::Font2); lcd.setTextColor(fg, bg);
  lcd.setTextDatum(middle_center); lcd.drawString(t, x + w / 2, y + h / 2 + 1);
  lcd.setTextDatum(top_left);
}

void applyRotation(int r) {
  lcd.setRotation(r);
  W = lcd.width(); H = lcd.height(); LS = W > H;
  yFoot = H - 28;
  yStatus = LS ? 76 : 94;
  yChart = yStatus + 20;
  hChart = yFoot - 3 - yChart;
  spr.deleteSprite();
  spr.setColorDepth(8);
  spr.createSprite(W, hChart);
}

// ---------------- ดึงข้อมูล ----------------
bool fetchData() {
  WiFiClientSecure cli; cli.setInsecure();
  HTTPClient http; http.setTimeout(8000);
  if (!http.begin(cli, DATA_URL)) return false;
  int code = http.GET();
  if (code != 200) { http.end(); return false; }
  String body = http.getString();
  http.end();
  JsonDocument doc;
  if (deserializeJson(doc, body)) return false;
  if (!doc["error"].isNull()) return false;

  float prevP = haveData ? D.p : NAN;
  D.p = jf(doc["p"]); D.pt = doc["pt"] | 0;
  D.nc = 0;
  for (JsonVariant v : doc["c"].as<JsonArray>()) if (D.nc < 40) D.c[D.nc++] = jf(v);
  D.ct = doc["ct"] | 0;
  D.F = jf(doc["F"]); D.open = jf(doc["open"]); D.em = jf(doc["em"]);
  D.itd = jf(doc["itd"]); D.gm = jf(doc["gm"]); D.mp = jf(doc["mp"]);
  D.cw = jf(doc["cw"]); D.pw = jf(doc["pw"]);
  strlcpy(D.exp, doc["exp"] | "", sizeof(D.exp));
  strlcpy(D.root, doc["root"] | "", sizeof(D.root));
  D.upd = doc["upd"] | 0; D.now = doc["now"] | 0; D.mkt = doc["mkt"] | true;
  D.nz = 0;
  for (JsonVariant v : doc["z"].as<JsonArray>()) {
    if (D.nz >= 12) break;
    JsonArray a = v.as<JsonArray>();
    Zone &q = D.z[D.nz++];
    q.k = a[0] | 0.0f; q.lo = a[1] | 0.0f; q.hi = a[2] | 0.0f;
    const char *t = a[3] | "V"; q.t = t[0];
    q.c = a[4] | 0L; q.p = a[5] | 0L;
  }
  dir = (okf(prevP) && okf(D.p)) ? (D.p > prevP ? 1 : D.p < prevP ? -1 : dir) : 0;
  haveData = true;
  return true;
}

// ---------------- แจ้งเตือน ----------------
void fireAlert(const char *txt, uint16_t col, uint8_t led, int beeps, int freq) {
  strlcpy(alertTxt, txt, sizeof(alertTxt));
  alertCol = col; alertUntil = millis() + 60000; ledUntil = millis() + 15000; ledMask = led;
  if (!muted) { beepLeft = beeps; beepFreq = freq; nextBeep = 0; }
}

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
      fireAlert(buf, z.t == 'C' ? C_CALL : z.t == 'P' ? C_PUT : C_VOL, z.t == 'C' ? 1 : z.t == 'P' ? 2 : 3, 2, 2200);
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
  lcd.fillRect(0, 0, W, 18, C_PANEL);
  lcd.setFont(&fonts::Font2); lcd.setTextColor(C_GOLD, C_PANEL);
  lcd.drawString(LS ? "OI GOLD PRO MINI" : "OI GOLD MINI", 4, 1);
  char buf[24];
  uint16_t col = C_DIM;
  if (WiFi.status() != WL_CONNECTED) { strcpy(buf, "NO WIFI"); col = C_DN; }
  else if (!haveData) { strcpy(buf, "LOADING"); }
  else {
    uint32_t age = (millis() - lastOk) / 1000;
    snprintf(buf, sizeof(buf), "%lus", (unsigned long)age);
    col = age > 60 ? C_DN : C_DIM;
  }
  lcd.setTextColor(col, C_PANEL); lcd.setTextDatum(top_right);
  lcd.drawString(buf, W - 28, 1);
  lcd.setTextDatum(top_left);
  // สัญญาณ WiFi 4 ขีด
  int bars = 0;
  if (WiFi.status() == WL_CONNECTED) { int r = WiFi.RSSI(); bars = r > -55 ? 4 : r > -65 ? 3 : r > -75 ? 2 : 1; }
  for (int i = 0; i < 4; i++) {
    int h = 3 + i * 3;
    lcd.fillRect(W - 22 + i * 5, 15 - h, 3, h, i < bars ? C_TEXT : C_DIM);
  }
}

void drawPrice() {
  int y0 = 19, h = yStatus - y0 - 1;
  lcd.fillRect(0, y0, W, h, C_BG);
  char buf[24];
  uint16_t pc = dir > 0 ? C_UP : dir < 0 ? C_DN : C_TEXT;
  lcd.setFont(&fonts::Font7); lcd.setTextColor(pc, C_BG);
  if (haveData && okf(D.p)) snprintf(buf, sizeof(buf), "%.1f", D.p); else strcpy(buf, "----.-");
  lcd.drawString(buf, 4, y0 + 4);
  // ข้อมูลรอง: เปลี่ยนจากราคาเปิดวัน + Expected Move + วันหมดอายุ
  int sx = LS ? 206 : 4, sy = LS ? y0 + 4 : y0 + 56;
  lcd.setFont(&fonts::Font2);
  if (haveData && okf(D.p) && okf(D.open)) {
    float ch = D.p - D.open;
    snprintf(buf, sizeof(buf), "%+.1f open", ch);
    lcd.setTextColor(ch >= 0 ? C_UP : C_DN, C_BG); lcd.drawString(buf, sx, sy);
  }
  if (haveData && okf(D.em)) {
    snprintf(buf, sizeof(buf), "EM +-%.1f", D.em);
    lcd.setTextColor(C_EM, C_BG);
    if (LS) lcd.drawString(buf, sx, sy + 17); else { lcd.setTextDatum(top_right); lcd.drawString(buf, W - 4, sy); lcd.setTextDatum(top_left); }
  }
  if (LS && haveData && D.exp[0]) {
    snprintf(buf, sizeof(buf), "exp %s", D.exp);
    lcd.setTextColor(C_DIM, C_BG); lcd.drawString(buf, sx, sy + 34);
  }
}

void drawStatus() {
  int y = yStatus;
  if (alertUntil) {
    lcd.fillRect(0, y, W, 18, alertCol);
    lcd.setFont(&fonts::Font2); lcd.setTextColor(C_BG, alertCol);
    lcd.setTextDatum(middle_center); lcd.drawString(alertTxt, W / 2, y + 9); lcd.setTextDatum(top_left);
    return;
  }
  lcd.fillRect(0, y, W, 18, C_PANEL);
  lcd.setFont(&fonts::Font2);
  char buf[48];
  if (!haveData) { lcd.setTextColor(C_DIM, C_PANEL); lcd.drawString("waiting for data...", 4, y + 1); return; }
  if (!D.mkt) { lcd.setTextColor(C_DIM, C_PANEL); lcd.drawString("MARKET CLOSED", 4, y + 1); return; }
  // อยู่ในโซน?
  for (int i = 0; i < D.nz; i++) {
    Zone &z = D.z[i];
    if (D.p >= z.lo && D.p <= z.hi) {
      uint16_t c = z.t == 'C' ? C_CALL : z.t == 'P' ? C_PUT : C_VOL;
      snprintf(buf, sizeof(buf), "IN %s ZONE %.0f", z.t == 'C' ? "CALL" : z.t == 'P' ? "PUT" : "VOL", z.k);
      lcd.setTextColor(c, C_PANEL); lcd.drawString(buf, 4, y + 1);
      return;
    }
  }
  // โซนใกล้สุดด้านล่าง (S) และด้านบน (R)
  int bi = -1, ai = -1;
  for (int i = 0; i < D.nz; i++) {
    if (D.z[i].hi < D.p && (bi < 0 || D.z[i].hi > D.z[bi].hi)) bi = i;
    if (D.z[i].lo > D.p && (ai < 0 || D.z[i].lo < D.z[ai].lo)) ai = i;
  }
  if (bi >= 0) {
    Zone &z = D.z[bi];
    snprintf(buf, sizeof(buf), "S %.0f %.1f", z.k, z.hi - D.p);
    lcd.setTextColor(z.t == 'C' ? C_CALL : z.t == 'P' ? C_PUT : C_VOL, C_PANEL); lcd.drawString(buf, 4, y + 1);
  }
  if (ai >= 0) {
    Zone &z = D.z[ai];
    snprintf(buf, sizeof(buf), "R %.0f +%.1f", z.k, z.lo - D.p);
    lcd.setTextColor(z.t == 'C' ? C_CALL : z.t == 'P' ? C_PUT : C_VOL, C_PANEL);
    lcd.setTextDatum(top_right); lcd.drawString(buf, W - 4, y + 1); lcd.setTextDatum(top_left);
  }
}

// เส้นประบน sprite
void hDash(int x0, int x1, int y, uint16_t c) { for (int x = x0; x < x1; x += 6) spr.drawFastHLine(x, y, 3, c); }

int usedY[16]; int nUsed;
bool labelFree(int y) { for (int i = 0; i < nUsed; i++) if (abs(usedY[i] - y) < 9) return false; return true; }
void label(int x, int y, const char *t, uint16_t c) {
  if (y < 4 || y > hChart - 5 || !labelFree(y) || nUsed >= 16) return;
  usedY[nUsed++] = y;
  spr.setFont(&fonts::Font0); spr.setTextColor(c); spr.setTextDatum(middle_left); spr.drawString(t, x, y);
}

void drawChart() {
  spr.fillScreen(C_BG);
  if (!haveData || !okf(D.p)) { spr.pushSprite(0, yChart); return; }
  const int LW = 40, PW = W - LW;  // คอลัมน์ป้ายด้านขวา
  // ช่วงราคา: แท่งล่าสุด + ระดับที่อยู่ห่างไม่เกิน $30
  float lo = D.p, hi = D.p;
  for (int i = 0; i < D.nc; i++) if (okf(D.c[i])) { lo = min(lo, D.c[i]); hi = max(hi, D.c[i]); }
  float mid = (lo + hi) / 2, span = max(hi - lo, 16.0f);
  lo = min(lo, mid - span / 2); hi = max(hi, mid + span / 2);
  auto incl = [&](float v) { if (okf(v) && fabsf(v - D.p) <= 30) { lo = min(lo, v); hi = max(hi, v); } };
  incl(D.itd); incl(D.gm); incl(D.mp); incl(D.cw); incl(D.pw);
  if (okf(D.open) && okf(D.em)) { incl(D.open + D.em); incl(D.open - D.em); }
  for (int i = 0; i < D.nz; i++) incl(D.z[i].k);
  float pad = (hi - lo) * 0.06f; lo -= pad; hi += pad;
  auto Y = [&](float v) { return (int)roundf((hi - v) / (hi - lo) * (hChart - 1)); };
  nUsed = 0;
  char buf[16];

  // ราคาปัจจุบันจองป้ายก่อน
  int yp = Y(D.p);
  usedY[nUsed++] = yp;

  // โซน OI / Volume
  for (int i = 0; i < D.nz; i++) {
    Zone &z = D.z[i];
    int y1 = Y(z.hi), y2 = Y(z.lo);
    if (y2 < 0 || y1 >= hChart) continue;
    uint16_t bc = z.t == 'C' ? C_ZC : z.t == 'P' ? C_ZP : C_ZV;
    spr.fillRect(0, max(0, y1), PW, max(1, min(hChart - 1, y2) - max(0, y1) + 1), bc);
    snprintf(buf, sizeof(buf), "%.0f", z.k);
    label(PW + 3, Y(z.k), buf, z.t == 'C' ? C_CALL : z.t == 'P' ? C_PUT : C_VOL);
  }
  // Expected Move
  if (okf(D.open) && okf(D.em)) {
    int a = Y(D.open + D.em), b = Y(D.open - D.em);
    if (a >= 0 && a < hChart) { hDash(0, PW, a, C_EM); label(PW + 3, a, "EM+", C_EM); }
    if (b >= 0 && b < hChart) { hDash(0, PW, b, C_EM); label(PW + 3, b, "EM-", C_EM); }
  }
  // เส้นระดับ
  struct L { float v; uint16_t c; const char *n; bool dash; } lv[] = {
    {D.cw, C_CALL, "CW", false}, {D.pw, C_PUT, "PW", false}, {D.itd, C_ITD, "itd", false},
    {D.gm, C_GM, "gmM", true}, {D.mp, C_MP, "MP", true}};
  for (auto &l : lv) {
    if (!okf(l.v)) continue;
    int y = Y(l.v); if (y < 0 || y >= hChart) continue;
    if (l.dash) hDash(0, PW, y, l.c); else spr.drawFastHLine(0, y, PW, l.c);
    snprintf(buf, sizeof(buf), "%s%.0f", l.n, l.v);
    if (strlen(buf) > 6) snprintf(buf, sizeof(buf), "%s", l.n);
    label(PW + 3, y, buf, l.c);
  }
  // เส้นราคา (แท่ง 1 นาทีล่าสุด)
  if (D.nc > 1) {
    int px = -1, py = -1;
    for (int i = 0; i < D.nc; i++) {
      if (!okf(D.c[i])) continue;
      int x = (int)((long)i * (PW - 6) / (D.nc - 1)), y = Y(D.c[i]);
      if (px >= 0) { spr.drawLine(px, py, x, y, C_GOLD); spr.drawLine(px, py + 1, x, y + 1, C_GOLD); }
      px = x; py = y;
    }
  }
  // ราคาล่าสุด
  hDash(0, PW, yp, C_TEXT);
  spr.fillCircle(PW - 6, yp, 3, C_GOLD);
  spr.fillRect(PW, yp - 6, LW, 12, C_GOLD);
  spr.setFont(&fonts::Font0); spr.setTextColor(C_BG); spr.setTextDatum(middle_left);
  snprintf(buf, sizeof(buf), "%.1f", D.p); spr.drawString(buf, PW + 2, yp);
  spr.setTextDatum(top_left);
  spr.pushSprite(0, yChart);
}

void drawFooter() {
  int bw = (W - 16) / 3;
  lcd.fillRect(0, yFoot - 2, W, H - yFoot + 2, C_BG);
  button(4, yFoot, bw, 25, "ROTATE", C_PANEL, C_TEXT);
  button(8 + bw, yFoot, bw, 25, muted ? "MUTED" : "SOUND", muted ? C_DN : C_PANEL, C_TEXT);
  button(12 + 2 * bw, yFoot, bw, 25, "WIFI", C_PANEL, C_TEXT);
}

void drawMain() {
  lcd.fillScreen(C_BG);
  drawHeader(); drawPrice(); drawStatus(); drawChart(); drawFooter();
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
  button(4, H - 32, 150, 28, "RESCAN", C_PANEL, C_TEXT);
  button(W - 154, H - 32, 150, 28, "BACK", C_PANEL, C_TEXT);
}

const char *KB_ROWS[2][4] = {
  {"1234567890", "qwertyuiop", "asdfghjkl", "zxcvbnm"},
  {"1234567890", "!@#$%^&*()", "-_=+[]{}:;", "'\",.<>/?\\|"}};

void drawKbText() {
  lcd.fillRoundRect(4, 20, W - 8, 24, 4, C_PANEL);
  lcd.setFont(&fonts::Font2); lcd.setTextColor(C_TEXT, C_PANEL);
  const char *s = pass; int len = passLen;
  while (len > 34) { s++; len--; }  // แสดงเฉพาะท้ายข้อความถ้ายาวเกิน
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
  int y = 50 + 4 * 36;  // 194
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

void finishWifi() {  // กลับหน้าหลัก
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
  if (y >= H - 32) {
    if (x < 160) openWifi(); else finishWifi();
    return;
  }
  int i = (y - 26) / 25;
  if (y >= 26 && i >= 0 && i < nNets) {
    strlcpy(selSsid, nets[i].ssid, 33);
    pass[0] = 0; passLen = 0;
    if (nets[i].open) { tryConnectSelected(); return; }
    // ถ้าเคยบันทึกรหัสของ WiFi นี้ไว้ ใส่ให้ก่อน
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
  if (y < 6 + 44) { if (y < 20) { sc = SC_WIFI; drawWifi(); } return; }  // แตะหัวข้อ = กลับรายการ WiFi
  int r = (y - 50) / 36; if (r < 0 || r > 3) return;
  const char *row = KB_ROWS[kbSym][r]; int n = strlen(row), off = (W - n * 32) / 2;
  int i = (x - off) / 32; if (x < off || i >= n) return;
  char c = row[i];
  if (!kbSym && kbShift && c >= 'a' && c <= 'z') c -= 32;
  kbAdd(c);
}

// ---------------- หน้าหลัก: แตะปุ่ม ----------------
void handleMainTap(int x, int y) {
  if (y >= yFoot - 2) {
    int bw = (W - 16) / 3;
    if (x < 4 + bw + 2) {  // หมุนจอ 4 ทิศ
      rotIdx = (rotIdx + 1) & 3; prefs.putInt("rot", rotIdx);
      applyRotation(rotIdx); drawMain();
    } else if (x < 8 + 2 * bw + 2) {
      muted = !muted; prefs.putBool("mute", muted);
      if (muted) beepLeft = 0; else tone(SPK, 2000, 80);
      drawFooter();
    } else openWifi();
    return;
  }
  if (y < yStatus && y > 18) {  // แตะราคา = ปรับความสว่าง 3 ระดับ
    brightIdx = (brightIdx + 1) % 3; prefs.putInt("br", brightIdx);
    lcd.setBrightness(BRIGHT[brightIdx]);
    return;
  }
  if (y >= yStatus && y < yStatus + 18 && alertUntil) {  // แตะแถบแจ้งเตือน = ปิด
    alertUntil = 0; ledUntil = 0; beepLeft = 0; setLed(0); drawStatus();
  }
}

// ---------------- setup / loop ----------------
void setup() {
  Serial.begin(115200);
  pinMode(LED_R, OUTPUT); pinMode(LED_G, OUTPUT); pinMode(LED_B, OUTPUT); setLed(0);
  prefs.begin("oimini", false);
  rotIdx = prefs.getInt("rot", 0) & 3;
  muted = prefs.getBool("mute", false);
  brightIdx = prefs.getInt("br", 0) % 3;

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

  if (tapped(x, y)) handleMainTap(x, y);
  uint32_t ms = millis();
  if (WiFi.status() == WL_CONNECTED && (lastFetch == 0 || ms - lastFetch >= FETCH_MS)) {
    lastFetch = ms;
    if (fetchData()) {
      lastOk = millis();
      evalAlerts();
      drawPrice(); drawStatus(); drawChart();
    }
    drawHeader();
  }
  if (ms - lastHdr >= 1000) { lastHdr = ms; drawHeader(); }
  delay(10);
}

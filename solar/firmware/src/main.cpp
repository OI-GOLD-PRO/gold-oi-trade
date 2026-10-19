// Stamp HOME · BMS relay (ESP32-WROOM-32)
//
// Holds Bluetooth (BLE) links to two JBD / Xiaoxiang BMS at the same time and relays their raw frames
// to the Stamp HOME Worker over HTTPS. The Worker decodes and stores them — nothing is parsed here,
// so the decoding can change without re-flashing.
//
// First boot: the board opens a Wi-Fi hotspot "StampHOME-BMS". Join it with a phone, pick the house
// Wi-Fi (2.4 GHz), paste the app link and the app key, save. Hold the BOOT button for 3 s while the
// board is running to forget Wi-Fi + settings and start over.
//
// LED (GPIO2): solid = the server accepted our last report, off = it did not (yet).

#include <Arduino.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <WiFiManager.h>
#include <Preferences.h>
#include <NimBLEDevice.h>

#define FW_VERSION "1.0.1"
#ifndef DEFAULT_MAC1
#define DEFAULT_MAC1 "A5:C2:39:41:66:FA"
#endif
#ifndef DEFAULT_MAC2
#define DEFAULT_MAC2 "A4:C1:37:25:E5:E2"
#endif
#ifndef DEFAULT_URL
#define DEFAULT_URL ""
#endif

static const int LED_PIN = 2, BOOT_PIN = 0;
static const uint32_t POLL_MS = 15000;    // ask each BMS for fresh data this often
static const uint32_t POST_MS = 20000;    // report to the Worker this often
static const uint32_t FRESH_MS = 120000;  // frames older than this are not reported

// JBD request frames: DD A5 <cmd> 00 <crc16> 77
static const uint8_t CMD_BASIC[] = {0xDD, 0xA5, 0x03, 0x00, 0xFF, 0xFD, 0x77};
static const uint8_t CMD_CELLS[] = {0xDD, 0xA5, 0x04, 0x00, 0xFF, 0xFC, 0x77};

// ---- settings --------------------------------------------------------------
static String cfgUrl, cfgKey, cfgMac[2];
static bool saveRequested = false;

static void loadCfg() {
  Preferences p;
  p.begin("bms", true);
  cfgUrl = p.getString("url", DEFAULT_URL);
  cfgKey = p.getString("key", "");
  cfgMac[0] = p.getString("mac1", DEFAULT_MAC1);
  cfgMac[1] = p.getString("mac2", DEFAULT_MAC2);
  p.end();
}

static String clean(String s) { s.trim(); return s; }

static void saveCfg() {
  Preferences p;
  p.begin("bms", false);
  p.putString("url", cfgUrl);
  p.putString("key", cfgKey);
  p.putString("mac1", cfgMac[0]);
  p.putString("mac2", cfgMac[1]);
  p.end();
}

static void resetAll() {
  Serial.println("[cfg] reset requested");
  WiFiManager wm;
  wm.resetSettings();
  Preferences p;
  p.begin("bms", false);
  p.clear();
  p.end();
  delay(300);
  ESP.restart();
}

// ---- BLE -------------------------------------------------------------------
static SemaphoreHandle_t gLock;
struct Guard {
  Guard() { xSemaphoreTake(gLock, portMAX_DELAY); }
  ~Guard() { xSemaphoreGive(gLock); }
};

struct Bat {
  String mac;
  NimBLEClient* cli = nullptr;
  NimBLERemoteCharacteristic* tx = nullptr;
  bool ready = false;
  uint8_t fails = 0;
  uint32_t lastTry = 0, lastPoll = 0, cellsDue = 0;
  std::string rx;  // frame being assembled from notification fragments
  String basic, cells;
  uint32_t basicAt = 0, cellsAt = 0;
};
static Bat bats[2];

static String toHex(const std::string& s) {
  static const char* H = "0123456789abcdef";
  String o;
  o.reserve(s.size() * 2);
  for (uint8_t c : s) { o += H[c >> 4]; o += H[c & 15]; }
  return o;
}

// Notifications arrive in 20-byte pieces. Glue them into DD <cmd> <status> <len> <data> <crc16> 77 frames.
static void onData(Bat* b, const uint8_t* d, size_t n) {
  Guard g;
  for (size_t i = 0; i < n; i++) {
    if (b->rx.empty() && d[i] != 0xDD) continue;  // wait for a frame start
    b->rx.push_back((char)d[i]);
  }
  if (b->rx.size() < 4) return;
  size_t total = (uint8_t)b->rx[3] + 7;
  if (total > 80) { b->rx.clear(); return; }
  if (b->rx.size() < total) return;
  if ((uint8_t)b->rx[total - 1] == 0x77) {
    uint8_t cmd = (uint8_t)b->rx[1];
    String hex = toHex(b->rx.substr(0, total));
    if (cmd == 0x03) { b->basic = hex; b->basicAt = millis(); }
    else if (cmd == 0x04) { b->cells = hex; b->cellsAt = millis(); }
  }
  b->rx.clear();
}

static bool connectBat(Bat& b) {
  if (!b.cli) {
    b.cli = NimBLEDevice::createClient();
    b.cli->setConnectTimeout(6);
  }
  if (b.cli->isConnected()) b.cli->disconnect();
  Serial.printf("[ble] connecting %s\n", b.mac.c_str());
  NimBLEAddress addr(std::string(b.mac.c_str()));
  if (!b.cli->connect(addr)) { Serial.println("[ble] connect failed"); return false; }
  NimBLERemoteService* svc = b.cli->getService(NimBLEUUID((uint16_t)0xFF00));
  NimBLERemoteCharacteristic* rxc = svc ? svc->getCharacteristic(NimBLEUUID((uint16_t)0xFF01)) : nullptr;
  b.tx = svc ? svc->getCharacteristic(NimBLEUUID((uint16_t)0xFF02)) : nullptr;
  if (!rxc || !b.tx || !rxc->canNotify()) { Serial.println("[ble] FF00 service not found"); b.cli->disconnect(); return false; }
  Bat* bp = &b;
  if (!rxc->subscribe(true, [bp](NimBLERemoteCharacteristic*, uint8_t* d, size_t n, bool) { onData(bp, d, n); })) {
    Serial.println("[ble] subscribe failed");
    b.cli->disconnect();
    return false;
  }
  { Guard g; b.rx.clear(); }
  b.ready = true;
  b.lastPoll = millis() - POLL_MS;  // ask right away
  b.cellsDue = 0;
  Serial.printf("[ble] %s ready\n", b.mac.c_str());
  return true;
}

static void sendCmd(Bat& b, const uint8_t* c, size_t n) {
  if (!b.tx) return;
  b.tx->writeValue(c, n, !b.tx->canWriteNoResponse());
}

static void serviceBle(bool paused) {
  for (auto& b : bats) {
    if (b.mac.length() < 17) continue;
    bool up = b.cli && b.cli->isConnected();
    if (paused && up) b.cli->disconnect();
    if (paused || !up) b.ready = false;
  }
  if (paused) return;

  // One connection attempt per pass (they block for a few seconds), with back-off after failures.
  for (auto& b : bats) {
    if (b.mac.length() < 17 || b.ready) continue;
    uint32_t wait = 4000UL * (1 + (b.fails > 8 ? 8 : b.fails));
    if (b.lastTry && millis() - b.lastTry < wait) continue;
    b.lastTry = millis();
    if (connectBat(b)) b.fails = 0; else if (b.fails < 250) b.fails++;
    break;
  }

  uint32_t now = millis();
  for (auto& b : bats) {
    if (!b.ready) continue;
    if (now - b.lastPoll >= POLL_MS) {
      b.lastPoll = now;
      sendCmd(b, CMD_BASIC, sizeof(CMD_BASIC));
      b.cellsDue = now + 400;
    } else if (b.cellsDue && (int32_t)(now - b.cellsDue) >= 0) {
      b.cellsDue = 0;
      sendCmd(b, CMD_CELLS, sizeof(CMD_CELLS));
    }
  }
}

// ---- report to the Worker --------------------------------------------------
static uint32_t lastOk = 0, pauseUntil = 0;

static void postState() {
  uint32_t now = millis();
  String j = "{\"fw\":\"" FW_VERSION "\",\"up\":" + String(now / 1000) + ",\"wifi\":" + String(WiFi.RSSI()) + ",\"b\":[";
  bool first = true;
  {
    Guard g;
    for (auto& b : bats) {
      if (b.basic.length() == 0 || now - b.basicAt > FRESH_MS) continue;
      if (!first) j += ",";
      first = false;
      j += "{\"mac\":\"" + b.mac + "\",\"age\":" + String((now - b.basicAt) / 1000) + ",\"basic\":\"" + b.basic + "\"";
      if (b.cells.length() && now - b.cellsAt <= FRESH_MS) j += ",\"cells\":\"" + b.cells + "\"";
      j += "}";
    }
  }
  j += "]}";

  WiFiClientSecure client;
  client.setInsecure();  // home-network relay; the app key is the access control
  HTTPClient http;
  http.setConnectTimeout(6000);
  http.setTimeout(8000);
  http.setReuse(false);
  if (!http.begin(client, cfgUrl + "/api/bms")) { Serial.println("[http] begin failed"); return; }
  http.addHeader("Content-Type", "application/json");
  http.addHeader("x-key", cfgKey);
  int code = http.POST(j);
  if (code == 200) {
    String r = http.getString();
    int i = r.indexOf("\"pause\":");
    long secs = i >= 0 ? r.substring(i + 8).toInt() : 0;
    pauseUntil = secs > 0 ? millis() + (uint32_t)secs * 1000UL : 0;
    lastOk = millis();
    if (lastOk == 0) lastOk = 1;
    Serial.printf("[http] ok, %d battery report(s), pause %lds\n", first ? 0 : 1, secs);
  } else {
    Serial.printf("[http] failed: %d\n", code);
  }
  http.end();
}

// ---- setup / loop ----------------------------------------------------------
void setup() {
  Serial.begin(115200);
  delay(200);
  Serial.println("\nStamp HOME BMS relay " FW_VERSION);
  gLock = xSemaphoreCreateMutex();
  pinMode(LED_PIN, OUTPUT);
  pinMode(BOOT_PIN, INPUT_PULLUP);
  loadCfg();

  WiFiManager wm;
  WiFiManagerParameter pUrl("url", "App link (https://....workers.dev)", cfgUrl.c_str(), 120);
  WiFiManagerParameter pKey("key", "App key (SOLAR_APP_KEY)", cfgKey.c_str(), 80);
  WiFiManagerParameter pM1("mac1", "BMS 1 MAC", cfgMac[0].c_str(), 17);
  WiFiManagerParameter pM2("mac2", "BMS 2 MAC", cfgMac[1].c_str(), 17);
  wm.addParameter(&pUrl);
  wm.addParameter(&pKey);
  wm.addParameter(&pM1);
  wm.addParameter(&pM2);
  wm.setSaveConfigCallback([]() { saveRequested = true; });
  wm.setConfigPortalTimeout(240);
  wm.setConnectTimeout(20);
  if (!wm.autoConnect("StampHOME-BMS")) {
    Serial.println("[wifi] no connection, restarting");
    ESP.restart();
  }
  if (cfgKey.length() == 0 || String(pKey.getValue()).length() == 0) {
    // Wi-Fi works but the key was never entered: show the form again.
    wm.setConfigPortalTimeout(600);
    wm.startConfigPortal("StampHOME-BMS");
  }
  cfgUrl = clean(pUrl.getValue());
  cfgKey = clean(pKey.getValue());
  cfgMac[0] = clean(pM1.getValue());
  cfgMac[1] = clean(pM2.getValue());
  cfgMac[0].toUpperCase();
  cfgMac[1].toUpperCase();
  while (cfgUrl.endsWith("/")) cfgUrl.remove(cfgUrl.length() - 1);
  if (cfgUrl.length() && !cfgUrl.startsWith("http")) cfgUrl = "https://" + cfgUrl;
  saveCfg();
  saveRequested = false;
  Serial.printf("[cfg] server %s, BMS %s / %s\n", cfgUrl.c_str(), cfgMac[0].c_str(), cfgMac[1].c_str());

  // Wi-Fi modem sleep must stay ON: the radio is shared with Bluetooth and the
  // ESP32 coexistence layer aborts at Bluetooth start if sleep is turned off.
  WiFi.setAutoReconnect(true);

  NimBLEDevice::init("StampHOME");
  NimBLEDevice::setPower(ESP_PWR_LVL_P9);
  bats[0].mac = cfgMac[0];
  bats[1].mac = cfgMac[1];
}

void loop() {
  static uint32_t lastPost = 0, lastWifiTry = 0, btnDown = 0;
  uint32_t now = millis();

  if (digitalRead(BOOT_PIN) == LOW) {
    if (!btnDown) btnDown = now;
    else if (now - btnDown > 3000) resetAll();
  } else {
    btnDown = 0;
  }

  if (WiFi.status() != WL_CONNECTED && now - lastWifiTry > 10000) {
    lastWifiTry = now;
    WiFi.reconnect();
  }

  bool paused = (int32_t)(pauseUntil - now) > 0;
  serviceBle(paused);

  if (WiFi.status() == WL_CONNECTED && now - lastPost >= POST_MS) {
    lastPost = now;
    postState();
  }

  digitalWrite(LED_PIN, (lastOk && millis() - lastOk < 60000UL) ? HIGH : LOW);

  // Self-healing: no accepted report for 15 min, or a tidy restart every 3 days.
  if (now > 15UL * 60000UL && (!lastOk || now - lastOk > 15UL * 60000UL)) ESP.restart();
  if (now > 3UL * 24 * 3600 * 1000) ESP.restart();

  delay(50);
}

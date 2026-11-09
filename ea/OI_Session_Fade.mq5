//+------------------------------------------------------------------+
//|                                           OI_Session_Fade.mq5    |
//|  OI Gold Pro — "OI Session Fade" (oi ss v0.6) as an MT5 EA       |
//|                                                                  |
//|  Shared Fade plans from Worker /osf/v1 (same as the app):                    |
//|  - Levels: top 3 Call OI + top 3 Put OI of the contract that     |
//|    expires today, within +/-$60 of the 06:00 (Thai) open.        |
//|    Grade A = strike is in the top 3 Call or Put option volume.   |
//|  - Arm: an M1 bar closes >= $3 beyond the zone (above = wait     |
//|    BUY, below = wait SELL). LIMIT order waits at the near edge.  |
//|    Touch count restarts every session.                           |
//|  - SL = far edge -/+ $3 · TP = RR 1 / 1.6 / 5 (split) or one RR  |
//|  - Real trades only:                                             |
//|      Asia AM 06:00-10:00 zone +/-2, touch 1-2 (grade A up to 3), |
//|              skip if price ran in > 3xATR(60) in 5 M1 bars       |
//|      London 14:00-19:30 zone +/-1.5, touch 1                     |
//|  - NY break 19:30-23:00 (app V4.9.94/95): an M5 bar closes >= $2 |
//|    beyond the +/-1.5 zone while the previous M5 close was not    |
//|    beyond that edge -> market order at the next bar, SL = other  |
//|    edge of the zone, TP RR 1 · first break per line per day      |
//|  - No entries from 30 min before to 90 min after red USD news    |
//|                                                                  |
//|  Data: /osf/v1 for Fade plans, /opt for NY breakout,          |
//|        /gf (Gold.F M1 for the GC -> broker offset),              |
//|        news.json from the gold-oi-pro repo.                      |
//|                                                                  |
//|  Setup: Tools > Options > Expert Advisors >                      |
//|   "Allow WebRequest for listed URL" add:                         |
//|     https://gc-yahoo.oigoldpro.workers.dev                       |
//|     https://raw.githubusercontent.com                            |
//|  Live/demo only — WebRequest does not run in the Strategy Tester.|
//+------------------------------------------------------------------+
#property copyright "OI Gold Pro"
#property version   "1.55"
#property description "OI Session Fade (oi ss v0.6) — fade the OI walls, Asia AM + London"

#include <Trade\Trade.mqh>

#define EA_VERSION "OSS EA v1.55 (shared Fade)"

enum ENUM_TP_MODE
{
   TP_SPLIT3 = 0,   // Split 3 orders: RR1 / RR2 / RR3
   TP_SINGLE = 1    // 1 order with SingleRR
};
enum ENUM_LOT_MODE
{
   LOT_FIXED = 0,   // Fixed lot per order
   LOT_RISK  = 1,   // Risk % of balance per signal
   LOT_MONEY = 2    // Fixed money at SL per signal (account currency)
};
enum ENUM_OFF_MODE
{
   OFF_AUTO   = 0,  // Auto: Gold.F (Worker) minus broker price
   OFF_MANUAL = 1   // Manual: ManualOffset
};

input group "=== Data ==="
input string        WorkerURL      = "https://gc-yahoo.oigoldpro.workers.dev"; // Worker URL (no trailing /)
input string        NewsURL        = "https://raw.githubusercontent.com/OI-GOLD-PRO/gold-oi-pro/main/news.json"; // News feed
input ENUM_OFF_MODE OffsetMode     = OFF_AUTO;  // GC -> broker offset
input double        ManualOffset   = 0.0;       // Manual offset ($, GC minus broker XAUUSD)

input group "=== Trade ==="
input bool          TradeEnabled   = false;      // Place real orders (false = alerts only)
input string        TradeSymbol    = "";        // Symbol (empty = this chart)
input long          Magic          = 260611;    // Magic number
input ENUM_LOT_MODE LotMode        = LOT_FIXED; // Lot mode
input double        FixedLot       = 0.01;      // Fixed lot per order
input double        RiskPercent    = 1.0;       // Risk % of balance per signal (all legs together)
input double        RiskMoney      = 10.0;      // LOT_MONEY: loss at SL per signal, account currency (all legs together)
input double        MaxLotPerOrder = 1.00;      // Hard cap per order
input int           MaxSameDir     = 0;         // Max open signals in the same direction, fade + NY (0 = no limit, like the app)
input bool          BuyAddSpread   = true;      // BUY LIMIT = top edge + spread (fills when Bid touches, like the app)
input double        ModifyTolUSD   = 0.10;      // Re-price a pending order when it is off by more than $
input double        LimitNearUSD   = 4.0;       // Place the limit only when price is within $ of the entry edge (0 = always)
input double        LimitKeepUSD   = 2.0;       // Keep it until price moves this much further away (no flip-flop)

input group "=== TP Asia AM 06:00-10:00 (SL $7) ==="
input ENUM_TP_MODE  AM_TPMode      = TP_SINGLE; // AM: TP mode
input double        AM_RR1         = 1.0;       // AM: split RR 1
input double        AM_RR2         = 1.6;       // AM: split RR 2
input double        AM_RR3         = 5.0;       // AM: split RR 3
input double        AM_SingleRR    = 5.0;       // AM: single-order RR

input group "=== TP London 14:00-19:30 (SL $6) ==="
input ENUM_TP_MODE  LDN_TPMode     = TP_SINGLE; // London: TP mode
input double        LDN_RR1        = 1.0;       // London: split RR 1
input double        LDN_RR2        = 1.6;       // London: split RR 2
input double        LDN_RR3        = 5.0;       // London: split RR 3
input double        LDN_SingleRR   = 5.0;       // London: single-order RR

input group "=== Rules (same as the app) ==="
input bool          UseAsiaAM      = true;      // Trade Asia AM 06:00-10:00 (Thai)
input bool          UseLondon      = true;      // Trade London 14:00-19:30 (Thai)
input bool          NewsFilter     = true;      // No entries around red USD news
input int           NewsBeforeMin  = 30;        // Minutes before news
input int           NewsAfterMin   = 90;        // Minutes after news

input group "=== NY break (19:30-23:00 Thai) ==="
input bool          UseNYBreak     = true;      // Trade NY breakouts (false = off)
input double        NYBreakRR      = 1.0;       // NY break TP RR (app: always 1)
input bool          NYBreakSLMid   = false;     // SL at the level (zone middle) instead of the far edge
input int           NYBreakMaxDelay= 60;        // Enter only within x sec after the M5 close

input group "=== Display / alerts ==="
input bool          DrawZones      = true;      // Draw zones on the chart
input bool          PopupAlerts    = true;      // Alert() on fills / signals
input bool          PushAlerts     = false;     // Push notification on fills / signals

//--- fixed rules (osf.js)
#define SL_BUF    3.0
#define RANGE_USD 60.0
#define MAX_TOUCH 4
#define BO_A      1170       // NY break window, Thai minutes (19:30)
#define BO_B      1380       // 23:00
#define BO_HALF   1.5
#define BO_BUF    2.0

struct SessDef { string id; string lab; int a; int b; double half; };
SessDef SESS[2];

struct Level { double strike; double price; int side; bool gradeA; };   // side 1 = Call, -1 = Put
struct JRow { string v[12]; int n; };
struct Want { double strike; double edge; double sl; int dir; int k; string key; };

CTrade   trade;
string   g_sym;
Level    g_lv[];             // today's levels (broker prices)
Level    g_fadeLv[];        // canonical Fade zones, in GC prices
Want     g_want[];          // eligible plans for a single UTC minute
int      g_sessIdx = -1;
datetime g_fadeDay = 0, g_fadeBar = 0, g_fadeUntil = 0;
string   g_fadeStatus = "waiting for shared plans";
datetime g_boBarT    = 0;    // last M5 bar processed for the NY break
string   g_boInfo    = "";   // NY break status for the panel

// lines locked once per trading day (first build after 06:00 Thai)
datetime g_lockDs = 0;  double g_lockK[];  int g_lockSide[];

// OI data
double   g_k[];  double g_c[];  double g_p[];  double g_vc[];  double g_vp[];
string   g_root = "";  long g_expTs = 0;  long g_optUpd = 0;  string g_oiSrc = "";
datetime g_optAt = 0;  string g_optErr = "";

// offset
double   g_off = EMPTY_VALUE;  datetime g_offAt = 0;  string g_offErr = "";
long     g_srvOff = 0;         // server time - UTC (seconds)

// news (UTC)
datetime g_news[];  datetime g_newsAt = 0;
string   g_last = "";          // last action line for the panel

//+------------------------------------------------------------------+
int OnInit()
{
   g_sym = (TradeSymbol == "" ? _Symbol : TradeSymbol);
   if(!SymbolSelect(g_sym, true)) { Print("Symbol not found: ", g_sym); return INIT_PARAMETERS_INCORRECT; }
   if(StringFind(WorkerURL, "https://") != 0) { Alert("OSS: WorkerURL must start with https://"); return INIT_PARAMETERS_INCORRECT; }
   if(MQLInfoInteger(MQL_TESTER) != 0) Print("OSS: WebRequest does not work in the Strategy Tester — run on a live/demo chart.");

   SESS[0].id = "AM";  SESS[0].lab = "Asia AM"; SESS[0].a = 360; SESS[0].b = 600;  SESS[0].half = 2.0;
   SESS[1].id = "LDN"; SESS[1].lab = "London";  SESS[1].a = 840; SESS[1].b = 1170; SESS[1].half = 1.5;

   trade.SetExpertMagicNumber(Magic);
   trade.SetDeviationInPoints(50);
   trade.SetTypeFillingBySymbol(g_sym);

   CleanOldKeys();
   EventSetTimer(5);
   RefreshAll(true);
   LoadFade();
   return INIT_SUCCEEDED;
}

void OnDeinit(const int reason)
{
   EventKillTimer();
   ObjectsDeleteAll(0, "OSS_");
   Comment("");
}

void OnTimer()
{
   RefreshAll(false);
   LoadFade();
   SyncOrders();
   Panel();
}

//+------------------------------------------------------------------+
//| time helpers (everything internal is UTC)                        |
//+------------------------------------------------------------------+
void   UpdSrvOff()          { long d = (long)(TimeTradeServer() - TimeGMT()); g_srvOff = (long)MathRound(d / 900.0) * 900; }
datetime SrvToUtc(datetime t) { return (datetime)((long)t - g_srvOff); }
datetime UtcToSrv(datetime t) { return (datetime)((long)t + g_srvOff); }
int    ThaiMin(datetime utc)  { long x = ((long)utc + 7 * 3600) % 86400; if(x < 0) x += 86400; return (int)(x / 60); }
// trading day starts 06:00 Thai = 23:00 UTC of the previous day
datetime DayStart(datetime utc) { return (datetime)(((long)utc + 3600) / 86400 * 86400 - 3600); }
datetime SessStart(datetime utc, int s) { return DayStart(utc) + (SESS[s].a - 360) * 60; }
int SessOf(datetime utc)
{
   int m = ThaiMin(utc);
   for(int s = 0; s < 2; s++) if(m >= SESS[s].a && m < SESS[s].b) return s;
   return -1;
}
bool SessEnabled(int s) { return (s == 0 && UseAsiaAM) || (s == 1 && UseLondon); }

bool InNews(datetime utc)
{
   if(!NewsFilter) return false;
   for(int i = 0; i < ArraySize(g_news); i++)
      if(utc >= g_news[i] - NewsBeforeMin * 60 && utc <= g_news[i] + NewsAfterMin * 60) return true;
   return false;
}

//+------------------------------------------------------------------+
//| HTTP + tiny JSON helpers                                         |
//+------------------------------------------------------------------+
bool HttpGet(const string url, string &body, string &err)
{
   char post[], res[]; string hdr;
   ResetLastError();
   int code = WebRequest("GET", url, "User-Agent: OISessionFadeEA/1.0\r\nAccept: application/json\r\n", 8000, post, res, hdr);
   if(code == -1)
   {
      int e = GetLastError();
      err = (e == 4014 ? "add URL to WebRequest list" : "WebRequest error " + IntegerToString(e));
      return false;
   }
   body = CharArrayToString(res, 0, WHOLE_ARRAY, CP_UTF8);
   if(code != 200) { err = "HTTP " + IntegerToString(code); return false; }
   return true;
}

// value of "key": number / string (no nested objects)
string JStr(const string &js, const string key, int from = 0)
{
   int p = StringFind(js, "\"" + key + "\"", from); if(p < 0) return "";
   p = StringFind(js, ":", p); if(p < 0) return "";
   int len = StringLen(js); p++;
   while(p < len && StringGetCharacter(js, p) == ' ') p++;
   if(p < len && StringGetCharacter(js, p) == '"')
   {
      int q = StringFind(js, "\"", p + 1); if(q < 0) return "";
      return StringSubstr(js, p + 1, q - p - 1);
   }
   int q = p;
   while(q < len) { ushort ch = StringGetCharacter(js, q); if(ch == ',' || ch == '}' || ch == ']') break; q++; }
   string s = StringSubstr(js, p, q - p); StringTrimLeft(s); StringTrimRight(s);
   return s;
}

// "key": [[a,b,...],[...]]  ->  rows[] (strings, quotes removed, max 12 cells)
int JRows(const string &js, const string key, JRow &rows[])
{
   ArrayResize(rows, 0);
   int p = StringFind(js, "\"" + key + "\""); if(p < 0) return 0;
   p = StringFind(js, "[", p); if(p < 0) return 0;
   int len = StringLen(js), cnt = 0; p++;
   while(p < len)
   {
      ushort ch = StringGetCharacter(js, p);
      if(ch == ']') break;
      if(ch != '[') { p++; continue; }
      ArrayResize(rows, cnt + 1, 256); rows[cnt].n = 0;
      p++;
      int ts = p; bool inStr = false;
      while(p < len)
      {
         ch = StringGetCharacter(js, p);
         if(ch == '"') inStr = !inStr;
         else if(!inStr && (ch == ',' || ch == ']'))
         {
            string tok = StringSubstr(js, ts, p - ts);
            StringReplace(tok, "\"", ""); StringTrimLeft(tok); StringTrimRight(tok);
            if(rows[cnt].n < 12) { rows[cnt].v[rows[cnt].n] = tok; rows[cnt].n++; }
            ts = p + 1;
            if(ch == ']') { p++; break; }
         }
         p++;
      }
      cnt++;
   }
   return cnt;
}

// "2026-11-10T08:30:00-05:00" -> UTC
datetime IsoToUtc(const string s)
{
   if(StringLen(s) < 19) return 0;
   string d = StringSubstr(s, 0, 10); StringReplace(d, "-", ".");
   datetime t = StringToTime(d + " " + StringSubstr(s, 11, 8));
   if(t <= 0) return 0;
   string z = StringSubstr(s, 19);
   if(StringLen(z) >= 6 && (StringGetCharacter(z, 0) == '+' || StringGetCharacter(z, 0) == '-'))
   {
      int sg = (StringGetCharacter(z, 0) == '-') ? -1 : 1;
      int off = (int)StringToInteger(StringSubstr(z, 1, 2)) * 3600 + (int)StringToInteger(StringSubstr(z, 4, 2)) * 60;
      t -= sg * off;
   }
   return t;
}

//+------------------------------------------------------------------+
//| data refresh                                                     |
//+------------------------------------------------------------------+
void RefreshAll(bool force)
{
   UpdSrvOff();
   datetime now = TimeGMT();
   if(force || now - g_optAt >= 60) LoadOpt();
   if(force || now - g_offAt >= 60) LoadOffset();
   if(force || now - g_newsAt >= 600) LoadNews();
   BuildLevels();
}

void LoadOpt()
{
   g_optAt = TimeGMT();
   string js, err;
   if(!HttpGet(WorkerURL + "/opt", js, err)) { g_optErr = "/opt: " + err; return; }
   JRow r[]; int n = JRows(js, "rows", r);
   if(n <= 0) { g_optErr = "/opt: no rows"; return; }
   // aggregate per strike: [k, t, iv, d, g, bid, ask, lp, vol, buy, sell, oi]
   ArrayResize(g_k, 0); ArrayResize(g_c, 0); ArrayResize(g_p, 0); ArrayResize(g_vc, 0); ArrayResize(g_vp, 0);
   for(int i = 0; i < n; i++)
   {
      if(r[i].n < 12) continue;
      double k = StringToDouble(r[i].v[0]); if(k <= 0) continue;
      bool call = (r[i].v[1] == "C");
      double vol = StringToDouble(r[i].v[8]), oi = StringToDouble(r[i].v[11]);
      int j = -1;
      for(int q = 0; q < ArraySize(g_k); q++) if(MathAbs(g_k[q] - k) < 1e-6) { j = q; break; }
      if(j < 0)
      {
         j = ArraySize(g_k);
         ArrayResize(g_k, j + 1); ArrayResize(g_c, j + 1); ArrayResize(g_p, j + 1); ArrayResize(g_vc, j + 1); ArrayResize(g_vp, j + 1);
         g_k[j] = k; g_c[j] = 0; g_p[j] = 0; g_vc[j] = 0; g_vp[j] = 0;
      }
      if(call) { g_c[j] += oi; g_vc[j] += vol; } else { g_p[j] += oi; g_vp[j] += vol; }
   }
   g_root   = JStr(js, "root");
   g_expTs  = (long)StringToInteger(JStr(js, "expTs"));
   g_optUpd = (long)StringToInteger(JStr(js, "updated"));
   g_oiSrc  = JStr(js, "oiSrc");
   g_optErr = (ArraySize(g_k) > 0 ? "" : "/opt: no OI");
}

// offset = Gold.F (GC) - broker bid, median of the last 5 closed minutes
void LoadOffset()
{
   g_offAt = TimeGMT();
   if(OffsetMode == OFF_MANUAL) { g_off = ManualOffset; g_offErr = ""; return; }
   string js, err;
   if(!HttpGet(WorkerURL + "/gf", js, err)) { g_offErr = "/gf: " + err; return; }
   JRow r[]; int n = JRows(js, "bars", r);
   if(n < 3) { g_offErr = "/gf: no bars"; return; }
   MqlRates m[]; ArraySetAsSeries(m, false);
   int got = CopyRates(g_sym, PERIOD_M1, 0, 60, m);
   if(got < 3) { g_offErr = "no broker M1"; return; }
   double d[]; int nd = 0;
   for(int i = n - 2; i >= 0 && nd < 5; i--)            // skip the forming Gold.F bar
   {
      if(r[i].n < 5) continue;
      datetime t = (datetime)StringToInteger(r[i].v[0]);
      double gc = StringToDouble(r[i].v[4]);
      for(int j = got - 2; j >= 0; j--)                  // skip the forming broker bar
      {
         datetime bt = SrvToUtc(m[j].time);
         if(bt == t) { ArrayResize(d, nd + 1); d[nd++] = gc - m[j].close; break; }
         if(bt < t) break;
      }
   }
   if(nd == 0) { g_offErr = "/gf: no matching minutes (market closed?)"; return; }
   ArraySort(d);
   g_off = ((nd % 2) == 1 ? d[nd / 2] : (d[nd / 2 - 1] + d[nd / 2]) / 2);
   g_offErr = "";
}

void LoadNews()
{
   g_newsAt = TimeGMT();
   if(!NewsFilter) return;
   string js, err;
   if(!HttpGet(NewsURL + "?t=" + IntegerToString((long)TimeGMT() / 300), js, err)) { Print("OSS news: ", err); return; }
   ArrayResize(g_news, 0);
   int p = 0, n = 0;
   while(true)
   {
      p = StringFind(js, "\"date\"", p); if(p < 0) break;
      int e = StringFind(js, "}", p); if(e < 0) e = StringLen(js);
      string obj = StringSubstr(js, p, e - p);
      string c = JStr(obj, "c"), im = JStr(obj, "i");
      if(c == "USD" && (im == "" || im == "H"))
      {
         datetime t = IsoToUtc(JStr(obj, "date"));
         if(t > 0) { ArrayResize(g_news, n + 1); g_news[n++] = t; }
      }
      p = e;
   }
}

//+------------------------------------------------------------------+
//| levels of the day                                                |
//+------------------------------------------------------------------+
void TopN(const double &v[], const bool &msk[], int nTop, int &out[])
{
   ArrayResize(out, 0);
   int n = ArraySize(v); bool used[]; ArrayResize(used, n); ArrayInitialize(used, false);
   for(int t = 0; t < nTop; t++)
   {
      int b = -1;
      for(int i = 0; i < n; i++) if(msk[i] && !used[i] && v[i] > 0 && (b < 0 || v[i] > v[b])) b = i;
      if(b < 0) break;
      used[b] = true; int m = ArraySize(out); ArrayResize(out, m + 1); out[m] = b;
   }
}

bool InList(const int &a[], int x) { for(int i = 0; i < ArraySize(a); i++) if(a[i] == x) return true; return false; }

void BuildLevels()
{
   ArrayResize(g_lv, 0);
   if(g_off == EMPTY_VALUE || ArraySize(g_k) == 0) return;
   datetime now = TimeGMT(), ds = DayStart(now);
   // reference = open of the first M1 bar at/after 06:00 Thai, in GC terms
   MqlRates m[]; ArraySetAsSeries(m, false);
   if(CopyRates(g_sym, PERIOD_M1, UtcToSrv(ds), UtcToSrv(ds) + 3 * 3600, m) < 1) return;
   double ref = m[0].open + g_off;
   int n = ArraySize(g_k); bool msk[]; ArrayResize(msk, n);
   for(int i = 0; i < n; i++) msk[i] = MathAbs(g_k[i] - ref) <= RANGE_USD;
   int C[], P[], VC[], VP[];
   TopN(g_c, msk, 3, C); TopN(g_p, msk, 3, P); TopN(g_vc, msk, 3, VC); TopN(g_vp, msk, 3, VP);
   // lock the strikes (top 3 Call + top 3 Put) once per day; grade A (volume) stays live
   if(g_lockDs != ds)
   {
      int all[]; ArrayResize(all, 0);
      for(int i = 0; i < ArraySize(C); i++) { int q = ArraySize(all); ArrayResize(all, q + 1); all[q] = C[i]; }
      for(int i = 0; i < ArraySize(P); i++) if(!InList(all, P[i])) { int q = ArraySize(all); ArrayResize(all, q + 1); all[q] = P[i]; }
      if(ArraySize(all) == 0) return;
      for(int i = 0; i < ArraySize(all); i++) for(int j = i + 1; j < ArraySize(all); j++) if(g_k[all[j]] < g_k[all[i]]) { int t = all[i]; all[i] = all[j]; all[j] = t; }
      ArrayResize(g_lockK, ArraySize(all)); ArrayResize(g_lockSide, ArraySize(all));
      for(int i = 0; i < ArraySize(all); i++) { g_lockK[i] = g_k[all[i]]; g_lockSide[i] = InList(C, all[i]) ? 1 : -1; }
      g_lockDs = ds;
      string t = ""; for(int i = 0; i < ArraySize(g_lockK); i++) t += StringFormat(" %s%.0f", g_lockSide[i] > 0 ? "C" : "P", g_lockK[i]);
      Print("OSS lines locked for ", TimeToString(ds + 7200, TIME_DATE), " (", g_root, "):", t);
   }
   ArrayResize(g_lv, ArraySize(g_lockK));
   for(int i = 0; i < ArraySize(g_lockK); i++)
   {
      g_lv[i].strike = g_lockK[i];
      g_lv[i].price  = g_lockK[i] - g_off;      // broker price (offset stays live)
      g_lv[i].side   = g_lockSide[i];
      int x = -1; for(int j = 0; j < n; j++) if(MathAbs(g_k[j] - g_lockK[i]) < 1e-6) { x = j; break; }
      g_lv[i].gradeA = (x >= 0) && (InList(VC, x) || InList(VP, x));
   }
}

//+------------------------------------------------------------------+
//| Fade plans are read from the same source as the app.             |
//+------------------------------------------------------------------+
bool FadeReady()
{
   datetime now = TimeGMT();
   return g_sessIdx >= 0 && now >= g_fadeBar && now < g_fadeUntil &&
          g_off != EMPTY_VALUE && g_offErr == "" && now - g_offAt < 120;
}

void LoadFade()
{
   datetime now = TimeGMT();
   int s = SessOf(now);
   if(s < 0 || !SessEnabled(s)) { g_sessIdx = -1; return; }

   string js, err;
   if(!HttpGet(WorkerURL + "/osf/v1?view=ea", js, err))
   {
      g_fadeStatus = "shared feed: " + err;
      return;
   }
   ArrayResize(g_want, 0);
   g_sessIdx = -1;
   datetime bar = (datetime)StringToInteger(JStr(js, "bar"));
   datetime until = (datetime)StringToInteger(JStr(js, "until"));
   datetime day = (datetime)StringToInteger(JStr(js, "day"));
   now = TimeGMT();
   if(JStr(js, "version") != "1" || JStr(js, "ready") != "1" || day != DayStart(now) ||
      now < bar || now >= until || until != bar + 60 || JStr(js, "session") != SESS[s].id)
   {
      g_fadeStatus = "waiting for fresh shared plans";
      return;
   }

   g_sessIdx = s; g_fadeBar = bar; g_fadeUntil = until; g_fadeDay = day;
   g_fadeStatus = "shared plans: waiting";
   JRow rows[];
   int n = JRows(js, "zones", rows);
   ArrayResize(g_fadeLv, 0);
   for(int i = 0; i < n && i < 6; i++)
   {
      if(rows[i].n != 3) continue;
      double strike = StringToDouble(rows[i].v[0]); if(strike <= 0) continue;
      int z = ArraySize(g_fadeLv); ArrayResize(g_fadeLv, z + 1);
      g_fadeLv[z].strike = strike; g_fadeLv[z].price = strike;
      g_fadeLv[z].side = rows[i].v[1] == "C" ? 1 : -1; g_fadeLv[z].gradeA = rows[i].v[2] == "A";
   }

   n = JRows(js, "plans", rows);
   for(int i = 0; i < n && i < 6; i++)
   {
      if(rows[i].n != 9) continue;
      double strike = StringToDouble(rows[i].v[0]), edge = StringToDouble(rows[i].v[6]), sl = StringToDouble(rows[i].v[7]);
      int dir = (int)StringToInteger(rows[i].v[3]), k = (int)StringToInteger(rows[i].v[4]);
      string key = rows[i].v[8];
      if(strike <= 0 || MathAbs(dir) != 1 || k < 1 || k > MAX_TOUCH || key == "" ||
         MathAbs(edge - strike - dir * SESS[s].half) > 0.001 || MathAbs(edge - sl - dir * (2 * SESS[s].half + SL_BUF)) > 0.001) continue;
      string label = StringFormat("%s%s %s #%d", rows[i].v[1], rows[i].v[0], dir > 0 ? "BUY" : "SELL", k);
      if(g_fadeStatus == "shared plans: waiting") g_fadeStatus = "shared plans:";
      g_fadeStatus += " " + label + (rows[i].v[5] == "1" ? ";" : " paper;");
      if(rows[i].v[5] != "1") continue;
      int j = ArraySize(g_want); ArrayResize(g_want, j + 1);
      g_want[j].strike = strike; g_want[j].edge = edge; g_want[j].sl = sl;
      g_want[j].dir = dir; g_want[j].k = k; g_want[j].key = key;
   }
}

void OnTick()
{
   SyncOrders();
   CheckNYBreak();
}

void Note(const string s) { g_last = TimeToString(TimeCurrent(), TIME_MINUTES) + " " + s; Print("OSS ", s); Panel(); }

// TP per session: s = 0 Asia AM, 1 London
int Legs(int s, double &rr[])
{
   if(s == 0)
   {
      if(AM_TPMode == TP_SPLIT3) { ArrayResize(rr, 3); rr[0] = AM_RR1; rr[1] = AM_RR2; rr[2] = AM_RR3; return 3; }
      ArrayResize(rr, 1); rr[0] = AM_SingleRR; return 1;
   }
   if(LDN_TPMode == TP_SPLIT3) { ArrayResize(rr, 3); rr[0] = LDN_RR1; rr[1] = LDN_RR2; rr[2] = LDN_RR3; return 3; }
   ArrayResize(rr, 1); rr[0] = LDN_SingleRR; return 1;
}

// comment = id of the order: "OSS B AM 4050 k1 R1.6" (fits the 31-char limit)
string OrdId(int s, double strike, int dir, int k) { return StringFormat("OSS %s %s %.0f k%d", dir > 0 ? "B" : "S", SESS[s].id, strike, k); }

// Recover filled signals, including orders placed by v1.53, from broker history.
bool FadeHistory(int s, string &filled[])
{
   datetime from = UtcToSrv(SessStart(g_fadeBar, s));
   if(!HistorySelect(from, TimeTradeServer())) return false;
   string am = "OSS B " + SESS[s].id + " ", pm = "OSS S " + SESS[s].id + " ";
   for(int i = HistoryDealsTotal() - 1; i >= 0; i--)
   {
      ulong d = HistoryDealGetTicket(i);
      if(d == 0 || HistoryDealGetInteger(d, DEAL_MAGIC) != Magic || HistoryDealGetString(d, DEAL_SYMBOL) != g_sym ||
         HistoryDealGetInteger(d, DEAL_ENTRY) != DEAL_ENTRY_IN) continue;
      string cm = HistoryDealGetString(d, DEAL_COMMENT);
      if(StringFind(cm, am) != 0 && StringFind(cm, pm) != 0)
         cm = HistoryOrderGetString((ulong)HistoryDealGetInteger(d, DEAL_ORDER), ORDER_COMMENT);
      if(StringFind(cm, am) != 0 && StringFind(cm, pm) != 0) continue;
      int end = StringFind(cm, " R");
      if(end < 0) continue;
      int n = ArraySize(filled); ArrayResize(filled, n + 1);
      filled[n] = StringSubstr(cm, 0, end);
   }
   return true;
}

bool FadeAlreadyFilled(int s, const Want &want, const string &filled[])
{
   string buy = OrdId(s, want.strike, 1, want.k), sell = OrdId(s, want.strike, -1, want.k);
   for(int i = 0; i < ArraySize(filled); i++) if(filled[i] == buy || filled[i] == sell) return true;
   return false;
}

double NormLot(double lot)
{
   double st = SymbolInfoDouble(g_sym, SYMBOL_VOLUME_STEP), mn = SymbolInfoDouble(g_sym, SYMBOL_VOLUME_MIN), mx = SymbolInfoDouble(g_sym, SYMBOL_VOLUME_MAX);
   if(st <= 0) st = 0.01;
   lot = MathFloor(lot / st + 1e-9) * st;
   lot = MathMax(mn, MathMin(lot, MathMin(mx, MaxLotPerOrder)));
   return NormalizeDouble(lot, 2);
}

double LotFor(int dir, double entry, double sl, int legs)
{
   if(LotMode == LOT_FIXED) return NormLot(FixedLot);
   double loss = 0;
   if(!OrderCalcProfit(dir > 0 ? ORDER_TYPE_BUY : ORDER_TYPE_SELL, g_sym, 1.0, entry, sl, loss) || loss >= 0) return 0;
   // money at risk for the whole signal: % of balance (shrinks after a loss) or a fixed amount (same every trade)
   double money = (LotMode == LOT_MONEY ? RiskMoney : AccountInfoDouble(ACCOUNT_BALANCE) * RiskPercent / 100.0);
   if(money <= 0) return 0;
   double raw = money / -loss / legs, lot = NormLot(raw);
   if(lot > raw + 1e-9)   // broker minimum lot is above the wanted size -> real loss at SL is bigger than set
      Print(StringFormat("OSS lot warning: wanted %.3f lot for %.2f at SL, using broker minimum %.2f (loss at SL ~%.2f)",
                         raw * legs, money, lot, lot * legs * -loss));
   return lot;
}

string g_alerted[];   // alerts-only mode: touches already reported
bool Alerted(const string id) { for(int i = 0; i < ArraySize(g_alerted); i++) if(g_alerted[i] == id) return true; int n = ArraySize(g_alerted); ArrayResize(g_alerted, n + 1); g_alerted[n] = id; return false; }

void SyncOrders()
{
   int s = FadeReady() ? g_sessIdx : -1;
   datetime expiry = UtcToSrv(g_fadeUntil);
   bool expiryAllowed = (SymbolInfoInteger(g_sym, SYMBOL_EXPIRATION_MODE) & SYMBOL_EXPIRATION_SPECIFIED) != 0;
   double hi0 = iHigh(g_sym, PERIOD_M1, 0), lo0 = iLow(g_sym, PERIOD_M1, 0);
   double bid = SymbolInfoDouble(g_sym, SYMBOL_BID), ask = SymbolInfoDouble(g_sym, SYMBOL_ASK);
   int dg = (int)SymbolInfoInteger(g_sym, SYMBOL_DIGITS);
   double pt = SymbolInfoDouble(g_sym, SYMBOL_POINT), minStop = (double)SymbolInfoInteger(g_sym, SYMBOL_TRADE_STOPS_LEVEL) * pt;
   double rr[]; int legs = Legs(s < 0 ? 0 : s, rr);

   // wanted orders on this bar (id -> price/sl/tp), dropping zones already touched this bar
   string wid[]; double wpx[], wsl[], wedge[], wR[]; int wdir[], widx[]; int nw = 0;
   for(int i = 0; i < ArraySize(g_want) && s >= 0; i++)
   {
      int dir = g_want[i].dir;
      double edge = g_want[i].edge - g_off, sl = g_want[i].sl - g_off, half = SESS[s].half;
      double lo = dir > 0 ? edge - 2 * half : edge, hi = lo + 2 * half;
      bool touched = (lo0 <= hi && hi0 >= lo);
      string id = OrdId(s, g_want[i].strike, dir, g_want[i].k);
      if(!TradeEnabled)
      {
         if(touched && !Alerted(g_want[i].key))
         {
            double R = MathAbs(edge - sl);
            string m = StringFormat("SIGNAL %s %.2f SL %.2f TP", dir > 0 ? "BUY" : "SELL", edge, sl);
            for(int j = 0; j < legs; j++) m += StringFormat(" %.2f(RR%g)", edge + dir * rr[j] * R, rr[j]);
            Note(m + " | " + id); Notify("OSS " + m + " | " + id);
         }
         continue;
      }
      if(touched || !expiryAllowed || expiry - TimeTradeServer() < 4) continue;                                   // touch used up this bar (filled or not)
      if(MaxSameDir > 0 && SignalsOpen(dir) >= MaxSameDir) continue; // direction full -> no limit order (removed below)
      if(LimitNearUSD > 0)                                     // only near the zone, so offset changes do not re-price it all the time
      {
         double dist = (dir > 0 ? bid - hi : lo - bid);
         if(dist > LimitNearUSD + LimitKeepUSD || (dist > LimitNearUSD && !HasPending(id))) continue;
      }
      ArrayResize(wid, nw + 1); ArrayResize(wpx, nw + 1); ArrayResize(wsl, nw + 1); ArrayResize(wedge, nw + 1); ArrayResize(wR, nw + 1); ArrayResize(wdir, nw + 1); ArrayResize(widx, nw + 1);
      wid[nw] = id; wdir[nw] = dir; widx[nw] = i;
      wedge[nw] = edge;
      wsl[nw] = sl;
      wR[nw] = MathAbs(wedge[nw] - wsl[nw]);
      wpx[nw] = (dir > 0 && BuyAddSpread ? hi + (ask - bid) : wedge[nw]);
      nw++;
   }
   if(!TradeEnabled) return;

   // existing pending orders: keep / re-price / delete
   bool cancelFailed = false;
   bool have[]; ArrayResize(have, nw * 3 + 1); ArrayInitialize(have, false);
   for(int i = OrdersTotal() - 1; i >= 0; i--)
   {
      ulong t = OrderGetTicket(i); if(t == 0) continue;
      if(OrderGetInteger(ORDER_MAGIC) != Magic || OrderGetString(ORDER_SYMBOL) != g_sym) continue;
      string cm = OrderGetString(ORDER_COMMENT);
      if(StringFind(cm, "OSS B AM ") != 0 && StringFind(cm, "OSS S AM ") != 0 &&
         StringFind(cm, "OSS B LDN ") != 0 && StringFind(cm, "OSS S LDN ") != 0) continue;
      int w = -1, leg = -1;
      for(int j = 0; j < nw && w < 0; j++)
         for(int l = 0; l < legs; l++)
            if(cm == wid[j] + StringFormat(" R%g", rr[l])) { w = j; leg = l; break; }
      if(w < 0 || have[w * 3 + leg] || OrderGetInteger(ORDER_TYPE_TIME) != ORDER_TIME_SPECIFIED)
      {
         if(trade.OrderDelete(t) && trade.ResultRetcode() == TRADE_RETCODE_DONE) Print("OSS removed ", cm);
         else cancelFailed = true;
         continue;
      }
      have[w * 3 + leg] = true;
      double px = NormalizeDouble(wpx[w], dg), sl = NormalizeDouble(wsl[w], dg), tp = NormalizeDouble(wedge[w] + wdir[w] * rr[leg] * wR[w], dg);
      if(MathAbs(OrderGetDouble(ORDER_PRICE_OPEN) - px) > ModifyTolUSD || MathAbs(OrderGetDouble(ORDER_SL) - sl) > ModifyTolUSD || MathAbs(OrderGetDouble(ORDER_TP) - tp) > ModifyTolUSD || OrderGetInteger(ORDER_TIME_EXPIRATION) != expiry)
         trade.OrderModify(t, px, sl, tp, ORDER_TIME_SPECIFIED, expiry);
   }
   if(cancelFailed) return;
   // One broker-history read when new legs are possible. Existing split legs keep their original lifecycle.
   bool historyChecked = false, historyOk = false;
   string filled[];
   // place missing legs
   for(int j = 0; j < nw; j++)
   {
      double px = NormalizeDouble(wpx[j], dg), sl = NormalizeDouble(wsl[j], dg);
      bool valid = (wdir[j] > 0 ? px < ask - minStop : px > bid + minStop);
      double lot = 0;
      for(int l = 0; l < legs; l++)
      {
         if(have[j * 3 + l]) continue;
         if(!valid || !FadeReady()) continue;
         if(!historyChecked) { historyOk = FadeHistory(s, filled); historyChecked = true; }
         if(!historyOk || FadeAlreadyFilled(s, g_want[widx[j]], filled)) break;
         if(lot <= 0) lot = LotFor(wdir[j], wedge[j], wsl[j], legs);
         if(lot <= 0) { Print("OSS lot calc failed ", wid[j]); break; }
         double tp = NormalizeDouble(wedge[j] + wdir[j] * rr[l] * wR[j], dg);
         string cm = wid[j] + StringFormat(" R%g", rr[l]);
         bool ok = (wdir[j] > 0) ? trade.BuyLimit(lot, px, g_sym, sl, tp, ORDER_TIME_SPECIFIED, expiry, cm)
                                 : trade.SellLimit(lot, px, g_sym, sl, tp, ORDER_TIME_SPECIFIED, expiry, cm);
         if(ok && (trade.ResultRetcode() == TRADE_RETCODE_PLACED || trade.ResultRetcode() == TRADE_RETCODE_DONE))
            Note(StringFormat("wait %s %.2f x %.2f lot SL %.2f TP %.2f | %s", cm, px, lot, sl, tp, g_want[widx[j]].key));
         else   Print("OSS place failed ", cm, ": ", trade.ResultRetcode(), " ", trade.ResultRetcodeDescription());
      }
   }
}

//+------------------------------------------------------------------+
//| NY break (same as the bo part of scan())                         |
//|  M5 closes in 19:30-23:00 (last M1 of the M5 inside the window,  |
//|  and the entry bar too). First M5 of the window only sets prev.  |
//|  dir = close > hi+2 && prev <= hi  -> BUY                        |
//|        close < lo-2 && prev >= lo  -> SELL                       |
//|  first break per line per day (news window = skipped but used)   |
//+------------------------------------------------------------------+
void CheckNYBreak()
{
   if(!UseNYBreak) { g_boInfo = ""; return; }
   datetime m5 = iTime(g_sym, PERIOD_M5, 0);
   if(m5 <= 0 || m5 == g_boBarT) return;
   g_boBarT = m5;
   int nl = ArraySize(g_lv); if(nl == 0) { g_boInfo = "NY break: no levels"; return; }
   datetime u5 = SrvToUtc(m5), ds = DayStart(u5 - 300), wa = ds + (BO_A - 360) * 60;
   int mLast = ThaiMin(u5 - 60), mNext = ThaiMin(u5);       // last M1 of the closed M5 / entry bar
   if(mLast < BO_A || mLast >= BO_B || mNext < BO_A || mNext >= BO_B) { if(mNext < BO_A || mNext > BO_B + 5) g_boInfo = ""; return; }

   MqlRates r[]; ArraySetAsSeries(r, false);
   int n = CopyRates(g_sym, PERIOD_M5, UtcToSrv(wa) - 300, m5, r);
   if(n < 2 || r[n - 1].time != m5) return;
   double prev[]; bool has[], done[]; ArrayResize(prev, nl); ArrayResize(has, nl); ArrayResize(done, nl);
   ArrayInitialize(has, false); ArrayInitialize(done, false);
   int trig = -1, tdir = 0; string skipped = "";
   for(int i = 0; i < n - 1; i++)                         // closed M5 bars
   {
      datetime last1 = SrvToUtc(r[i].time) + 240, next1 = SrvToUtc(r[i].time) + 300;
      if(SrvToUtc(r[i].time) < wa - 300) continue;
      int m = ThaiMin(last1); if(m < BO_A || m >= BO_B || DayStart(last1) != ds) continue;
      int mk = ThaiMin(next1);
      if(mk >= BO_B || mk < BO_A) { for(int z = 0; z < nl; z++) { prev[z] = r[i].close; has[z] = true; } continue; }
      for(int z = 0; z < nl; z++)
      {
         double lo = g_lv[z].price - BO_HALF, hi = g_lv[z].price + BO_HALF, pv = prev[z]; bool hv = has[z];
         prev[z] = r[i].close; has[z] = true;
         if(!hv || done[z]) continue;
         int dir = (r[i].close > hi + BO_BUF && pv <= hi) ? 1 : (r[i].close < lo - BO_BUF && pv >= lo) ? -1 : 0;
         if(dir == 0) continue;
         done[z] = true;
         if(i == n - 2) { trig = z; tdir = dir; }           // the M5 that just closed
      }
   }
   int used = 0; for(int z = 0; z < nl; z++) if(done[z]) used++;
   g_boInfo = StringFormat("NY break: %d/%d lines used today", used, nl);
   if(trig < 0) return;

   int z = trig, dir = tdir;
   double lo = g_lv[z].price - BO_HALF, hi = g_lv[z].price + BO_HALF;
   double entry = r[n - 2].close, sl = NYBreakSLMid ? g_lv[z].price : (dir > 0 ? lo : hi);
   if(MathAbs(entry - sl) < 1) sl = entry - dir * 1;
   double R = MathAbs(entry - sl), tp = entry + dir * NYBreakRR * R;
   string id = StringFormat("OSS %s NYB %.0f", dir > 0 ? "B" : "S", g_lv[z].strike);
   string key = StringFormat("OSB%d|%s|%.0f", (int)(Magic % 100000), TimeToString(ds + 7200, TIME_DATE), g_lv[z].strike);
   if(GlobalVariableCheck(key)) return;
   GlobalVariableSet(key, (double)TimeGMT());
   string tag = StringFormat("%s %s%.0f break %+.2f$ | BUY/SELL %s %.2f SL %.2f TP %.2f (RR%g)", "NY", g_lv[z].side > 0 ? "C" : "P", g_lv[z].strike,
                             (entry - (dir > 0 ? hi : lo)) * dir, dir > 0 ? "BUY" : "SELL", entry, sl, tp, NYBreakRR);
   if(InNews(SrvToUtc(m5)))                    { Note("NY break skipped (red news): " + tag); return; }
   if(TimeCurrent() - m5 > NYBreakMaxDelay)    { Note("NY break skipped (late start): " + tag); return; }
   if(!TradeEnabled) { Note("SIGNAL " + tag); Notify("OSS " + tag); return; }
   if(MaxSameDir > 0 && SignalsOpen(dir) >= MaxSameDir) { Note(StringFormat("NY break skipped (already %d open %s): ", MaxSameDir, dir > 0 ? "BUY" : "SELL") + tag); return; }

   int dg = (int)SymbolInfoInteger(g_sym, SYMBOL_DIGITS);
   double px = (dir > 0 ? SymbolInfoDouble(g_sym, SYMBOL_ASK) : SymbolInfoDouble(g_sym, SYMBOL_BID));
   if(dir > 0 ? px <= sl || px >= tp : px >= sl || px <= tp) { Note("NY break skipped (price already past SL/TP): " + tag); return; }
   double lot = LotFor(dir, entry, sl, 1);
   if(lot <= 0) { Note("NY break skipped (lot calc failed): " + tag); return; }
   bool ok = (dir > 0) ? trade.Buy(lot, g_sym, 0, NormalizeDouble(sl, dg), NormalizeDouble(tp, dg), id)
                       : trade.Sell(lot, g_sym, 0, NormalizeDouble(sl, dg), NormalizeDouble(tp, dg), id);
   if(ok && (trade.ResultRetcode() == TRADE_RETCODE_DONE || trade.ResultRetcode() == TRADE_RETCODE_PLACED)) Note(StringFormat("OPEN %.2f lot: %s", lot, tag));
   else Note(StringFormat("NY break order failed %d %s: %s", trade.ResultRetcode(), trade.ResultRetcodeDescription(), tag));
}

// fill alerts
void OnTradeTransaction(const MqlTradeTransaction &tr, const MqlTradeRequest &rq, const MqlTradeResult &rs)
{
   if(tr.type != TRADE_TRANSACTION_DEAL_ADD || tr.symbol != g_sym) return;
   if(!HistoryDealSelect(tr.deal)) return;
   if(HistoryDealGetInteger(tr.deal, DEAL_MAGIC) != Magic) return;
   long en = HistoryDealGetInteger(tr.deal, DEAL_ENTRY);
   string cm = HistoryDealGetString(tr.deal, DEAL_COMMENT);
   double px = HistoryDealGetDouble(tr.deal, DEAL_PRICE), pr = HistoryDealGetDouble(tr.deal, DEAL_PROFIT);
   if(en == DEAL_ENTRY_IN) { Note(StringFormat("FILLED %s @ %.2f", cm, px)); Notify(StringFormat("OSS filled %s @ %.2f", cm, px)); }
   else if(en == DEAL_ENTRY_OUT) { Note(StringFormat("CLOSED %s @ %.2f  %+.2f", cm, px, pr)); Notify(StringFormat("OSS closed %s @ %.2f %+.2f", cm, px, pr)); }
}

int OpenOrders()
{
   int c = 0;
   for(int i = PositionsTotal() - 1; i >= 0; i--)
   {
      ulong t = PositionGetTicket(i);
      if(t > 0 && PositionGetInteger(POSITION_MAGIC) == Magic && PositionGetString(POSITION_SYMBOL) == g_sym) c++;
   }
   return c;
}

// open signals of this EA in one direction (the 3 legs of a split signal count as 1)
int SignalsOpen(int dir)
{
   string seen[]; int c = 0;
   for(int i = PositionsTotal() - 1; i >= 0; i--)
   {
      ulong t = PositionGetTicket(i);
      if(t == 0 || PositionGetInteger(POSITION_MAGIC) != Magic || PositionGetString(POSITION_SYMBOL) != g_sym) continue;
      long ty = PositionGetInteger(POSITION_TYPE);
      if(!((dir > 0 && ty == POSITION_TYPE_BUY) || (dir < 0 && ty == POSITION_TYPE_SELL))) continue;
      string cm = PositionGetString(POSITION_COMMENT);
      int r = StringFind(cm, " R"); string base = (r > 0 ? StringSubstr(cm, 0, r) : cm);
      if(base == "") base = IntegerToString((long)t);
      bool dup = false; for(int j = 0; j < ArraySize(seen); j++) if(seen[j] == base) { dup = true; break; }
      if(dup) continue;
      ArrayResize(seen, c + 1); seen[c++] = base;
   }
   return c;
}

bool HasPending(const string id)
{
   for(int i = OrdersTotal() - 1; i >= 0; i--)
   {
      ulong t = OrderGetTicket(i);
      if(t > 0 && OrderGetInteger(ORDER_MAGIC) == Magic && OrderGetString(ORDER_SYMBOL) == g_sym && StringFind(OrderGetString(ORDER_COMMENT), id) == 0) return true;
   }
   return false;
}

int PendingOrders()
{
   int c = 0;
   for(int i = OrdersTotal() - 1; i >= 0; i--)
   {
      ulong t = OrderGetTicket(i);
      if(t > 0 && OrderGetInteger(ORDER_MAGIC) == Magic && OrderGetString(ORDER_SYMBOL) == g_sym) c++;
   }
   return c;
}

void Notify(const string s)
{
   if(PopupAlerts) Alert(s);
   if(PushAlerts) SendNotification(StringSubstr(s, 0, 255));
}

void CleanOldKeys()
{
   for(int i = GlobalVariablesTotal() - 1; i >= 0; i--)
   {
      string nm = GlobalVariableName(i);
      if(StringFind(nm, "OSS") == 0 && TimeGMT() - (datetime)GlobalVariableGet(nm) > 3 * 86400) GlobalVariableDel(nm);
   }
}

//+------------------------------------------------------------------+
//| chart                                                            |
//+------------------------------------------------------------------+
void Panel()
{
   string t = EA_VERSION + "  " + g_sym + (TradeEnabled ? "" : "  [ALERTS ONLY]") + "\n";
   t += (LotMode == LOT_FIXED ? StringFormat("Lot: fixed %.2f", FixedLot) : LotMode == LOT_RISK ? StringFormat("Lot: risk %.2f%% of balance per signal", RiskPercent)
         : StringFormat("Lot: %.2f %s at SL per signal", RiskMoney, AccountInfoString(ACCOUNT_CURRENCY))) + "\n";
   t += "Contract " + g_root + "  OI " + g_oiSrc + (g_optErr != "" ? "  ! " + g_optErr : "") + "\n";
   t += (g_off == EMPTY_VALUE ? "Offset: -" : StringFormat("Offset GC-broker: %.2f", g_off)) + (g_offErr != "" ? "  ! " + g_offErr : "") + "\n";
   datetime u = TimeGMT(); int s = SessOf(u);
   int tm = ThaiMin(u); bool nyb = UseNYBreak && tm >= BO_A && tm < BO_B;
   t += "Thai time " + TimeToString(u + 7 * 3600, TIME_MINUTES) + "  Session: " + (s >= 0 ? SESS[s].lab + (SessEnabled(s) ? " fade" : " (off)") : nyb ? "NY break" : "none (no entries)");
   if(s >= 0)
   {
      t += "\n" + (FadeReady() ? g_fadeStatus : "Fade paused: " + g_fadeStatus);
      if(TradeEnabled && (SymbolInfoInteger(g_sym, SYMBOL_EXPIRATION_MODE) & SYMBOL_EXPIRATION_SPECIFIED) == 0)
         t += "\nBroker does not support timed Fade limits";
   }
   if(InNews(u)) t += "  NEWS BLOCK";
   t += "\nPositions: " + IntegerToString(OpenOrders()) + "   Limit orders waiting: " + IntegerToString(PendingOrders()) + "\n";
   if(g_boInfo != "") t += g_boInfo + "\n";
   if(g_last != "") t += "Last: " + g_last;
   Comment(t);
   if(DrawZones) Draw();
}

void Draw()
{
   ObjectsDeleteAll(0, "OSS_");
   if(_Symbol != g_sym) return;
   datetime u = TimeGMT(), ds = DayStart(u);
   for(int s = 0; s < 2; s++)
   {
      if(!SessEnabled(s) || g_fadeDay != ds || g_off == EMPTY_VALUE) continue;
      datetime a = UtcToSrv(ds + (SESS[s].a - 360) * 60), b = UtcToSrv(ds + (SESS[s].b - 360) * 60);
      for(int i = 0; i < ArraySize(g_fadeLv); i++)
      {
         string nm = StringFormat("OSS_%d_%d", s, i);
         ObjectCreate(0, nm, OBJ_RECTANGLE, 0, a, g_fadeLv[i].price - g_off + SESS[s].half, b, g_fadeLv[i].price - g_off - SESS[s].half);
         ObjectSetInteger(0, nm, OBJPROP_COLOR, g_fadeLv[i].gradeA ? C'40,110,160' : C'30,70,100');
         ObjectSetInteger(0, nm, OBJPROP_FILL, true);
         ObjectSetInteger(0, nm, OBJPROP_BACK, true);
         ObjectSetInteger(0, nm, OBJPROP_SELECTABLE, false);
         ObjectSetString(0, nm, OBJPROP_TOOLTIP, StringFormat("%s %s%.0f%s", SESS[s].lab, g_fadeLv[i].side > 0 ? "C" : "P", g_fadeLv[i].strike, g_fadeLv[i].gradeA ? " A" : ""));
         if(s == 0 || !SessEnabled(0))
         {
            string tx = StringFormat("OSS_t%d", i);
            ObjectCreate(0, tx, OBJ_TEXT, 0, a, g_fadeLv[i].price - g_off + SESS[s].half);
            ObjectSetString(0, tx, OBJPROP_TEXT, StringFormat("%s%.0f%s", g_fadeLv[i].side > 0 ? "C" : "P", g_fadeLv[i].strike, g_fadeLv[i].gradeA ? " A" : ""));
            ObjectSetInteger(0, tx, OBJPROP_COLOR, C'127,208,255');
            ObjectSetInteger(0, tx, OBJPROP_FONTSIZE, 8);
            ObjectSetInteger(0, tx, OBJPROP_ANCHOR, ANCHOR_LEFT_LOWER);
            ObjectSetInteger(0, tx, OBJPROP_SELECTABLE, false);
         }
      }
   }
   if(UseNYBreak)
      for(int i = 0; i < ArraySize(g_lv); i++)
      {
         string nm = StringFormat("OSS_ny_%d", i);
         ObjectCreate(0, nm, OBJ_RECTANGLE, 0, UtcToSrv(ds + (BO_A - 360) * 60), g_lv[i].price + BO_HALF, UtcToSrv(ds + (BO_B - 360) * 60), g_lv[i].price - BO_HALF);
         ObjectSetInteger(0, nm, OBJPROP_COLOR, C'90,60,110');
         ObjectSetInteger(0, nm, OBJPROP_FILL, true);
         ObjectSetInteger(0, nm, OBJPROP_BACK, true);
         ObjectSetInteger(0, nm, OBJPROP_SELECTABLE, false);
         ObjectSetString(0, nm, OBJPROP_TOOLTIP, StringFormat("NY break %s%.0f (break >= $2 beyond)", g_lv[i].side > 0 ? "C" : "P", g_lv[i].strike));
      }
   ChartRedraw();
}
//+------------------------------------------------------------------+

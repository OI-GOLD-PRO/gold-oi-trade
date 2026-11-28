//+------------------------------------------------------------------+
//|                                               OI_SF_Bridge.mq5   |
//|  OI Gold Pro — Session Fade Bridge (v2.00, 2026-11-28)           |
//|                                                                  |
//|  ไม้สวนกำแพง (AM/London): ไม่คิดเองอีกแล้ว — hub เป็นผู้สั่ง     |
//|    - EA ส่งสถานะบัญชี/ราคา/ไม้ทุกไม่กี่วินาทีไป hub            |
//|    - hub auto-trader คิดโซน/จุดเข้า (ตรงกับแอป V4.9.166)          |
//|      แล้วส่งคำสั่ง OPEN/MODIFY/CLOSE/CANCEL กลับมา               |
//|    - EA แค่ execute ตามคำสั่ง → ไม่มี limit ฝั่ง EA ให้หาย/เพี้ยน |
//|                                                                  |
//|  ไม้ NY เบรก (19:30–23:00 ไทย): EA คิดเองจากโซนของ Worker        |
//|    (/osf/v1 zones — ชุดเดียวกับแอป) + cap ระยะไล่ $5             |
//|    (V4.9.166: เบรกที่ปิดห่างขอบเกิน $5 = ข้าม ไม่ถือว่าใช้เส้น)  |
//|                                                                  |
//|  Setup: Tools > Options > Expert Advisors >                       |
//|    "Allow WebRequest for listed URL" → เพิ่ม 3 URL:              |
//|      https://oi-trade-hub.oigoldpro.workers.dev                   |
//|      https://gc-yahoo.oigoldpro.workers.dev                       |
//|      https://raw.githubusercontent.com                            |
//|  Live/demo only — WebRequest does not run in the Strategy Tester. |
//+------------------------------------------------------------------+
#property copyright "OI Gold Pro"
#property version   "2.00"

#include <Trade\Trade.mqh>

#define EA_VERSION "v2.00"

// ---- hub (ไม้สวนกำแพง) ----
input string HubURL          = "https://oi-trade-hub.oigoldpro.workers.dev"; // Hub URL (no trailing /)
input string EAKey           = "";        // EA key (EA_KEY secret on the hub)
input string TradeSymbol     = "";        // Symbol to trade (empty = this chart)
input long   Magic          = 171300;    // Magic number for orders from the hub
input double MaxLots        = 0.10;      // Hard cap on lots per order
input int    MaxCmdAgeMs    = 8000;       // Ignore commands older than this (ms)
input int    SlippagePoints = 50;        // Max slippage for market orders (points)
input bool   ManageAllOnSym = true;       // true = hub can see/close every position on the symbol

// ---- NY เบรก ----
input group "=== NY break (19:30-23:00 Thai) ==="
input bool          UseNYBreak     = true;   // Trade NY breakouts (false = off)
input double        NYBreakLots    = 0.01;   // Lots per NY break order
input double        NYBreakRR      = 1.0;    // NY break TP RR (app: always 1)
input bool          NYBreakSLMid   = false;  // SL at the zone middle instead of the far edge
input double        NYBreakMaxDist = 5.0;    // Skip if the M5 close is beyond $ from the zone edge (0 = off) — V4.9.166 cap
input int           NYBreakMaxDelay= 60;     // Enter only within x sec after the M5 close
input string        WorkerURL      = "https://gc-yahoo.oigoldpro.workers.dev"; // Worker URL (zones + Gold.F offset)
input bool          NewsFilter     = true;   // No NY entries around red USD news
input int           NewsBeforeMin  = 30;
input int           NewsAfterMin   = 90;
input string        NewsURL        = "https://raw.githubusercontent.com/OI-GOLD-PRO/gold-oi-pro/main/news.json"; // News feed

#define BO_A 1170
#define BO_B 1380
#define BO_HALF 1.5
#define BO_BUF 2.0

CTrade  trade;
string  g_sym;
ulong   g_lastSync   = 0;
int     g_nextMs     = 1000;
string  g_results[];             // results waiting to be sent
string  g_done[64];              // recently executed command ids
int     g_donePos    = 0;
bool    g_warnedUrl  = false;
datetime g_plAt      = 0;
string  g_plJson     = "{}";
string  g_status     = "starting";
bool    g_histKnown  = false;        // hub told us how far its deal history goes
long    g_histTime   = 0;
ulong   g_histTicket = 0;
#define HIST_BATCH 500

// ---- NY module state ----
long     g_srvOff   = 0;
double   g_off      = EMPTY_VALUE;   // GC - broker
datetime g_offAt    = 0;
string   g_offErr   = "";
datetime g_newsAt   = 0;
datetime g_news[];
datetime g_zoneAt   = 0;
long     g_zoneDay  = 0;
datetime g_boBarT   = 0;
string   g_boInfo   = "";
struct Lv { double strike; double price; int side; };   // strike = GC scale, price = broker scale
Lv       g_lv[];

//+------------------------------------------------------------------+
int OnInit()
{
   g_sym = (TradeSymbol == "" ? _Symbol : TradeSymbol);
   if(!SymbolSelect(g_sym, true))
   {
      Print("Symbol not found: ", g_sym);
      return INIT_PARAMETERS_INCORRECT;
   }
   if(EAKey == "" || StringFind(HubURL, "https://") != 0)
   {
      Alert("OI SF Bridge: set HubURL (https://...) and EAKey in the inputs");
      return INIT_PARAMETERS_INCORRECT;
   }
   trade.SetExpertMagicNumber(Magic);
   trade.SetDeviationInPoints(SlippagePoints);
   trade.SetTypeFillingBySymbol(g_sym);
   trade.SetAsyncMode(false);
   EventSetMillisecondTimer(200);
   Print("OI SF Bridge ", EA_VERSION, " started on ", g_sym);
   return INIT_SUCCEEDED;
}

void OnDeinit(const int reason)
{
   EventKillTimer();
   Comment("");
}

void OnTick()
{
   CheckNYBreak();
}

void OnTimer()
{
   ulong now = GetTickCount64();
   if(now - g_lastSync >= (ulong)g_nextMs)
   {
      g_lastSync = now;
      Sync();
   }
   // NY module data refresh (offset/news/zones) — ทำเบา ๆ ทุก 60 วิ
   long g = (long)TimeGMT();
   if(g - (long)g_offAt >= 60) LoadOffset();
   if(g - (long)g_newsAt >= 600) LoadNews();
   if(g - (long)g_zoneAt >= 60) LoadZones();
   CheckNYBreak();
   Comment("OI SF Bridge ", EA_VERSION, "  |  ", g_sym, "  |  ", g_status,
           "  |  sync ", g_nextMs / 1000.0, "s",
           "  |  NY: ", g_boInfo == "" ? (UseNYBreak ? "รอช่วงเวลา" : "ปิด") : g_boInfo,
           "  |  offset ", g_off == EMPTY_VALUE ? "…" : DoubleToString(g_off, 2), g_offErr == "" ? "" : " (" + g_offErr + ")");
}

//+------------------------------------------------------------------+
//| time helpers (NY module — everything internal is UTC)            |
//+------------------------------------------------------------------+
void   UpdSrvOff()          { long d = (long)(TimeTradeServer() - TimeGMT()); g_srvOff = (long)MathRound(d / 900.0) * 900; }
datetime SrvToUtc(datetime t) { UpdSrvOff(); return (datetime)((long)t - g_srvOff); }
datetime UtcToSrv(datetime t) { UpdSrvOff(); return (datetime)((long)t + g_srvOff); }
int    ThaiMin(datetime utc)  { long x = ((long)utc + 7 * 3600) % 86400; if(x < 0) x += 86400; return (int)(x / 60); }
datetime DayStart(datetime utc) { return (datetime)(((long)utc + 3600) / 86400 * 86400 - 3600); }   // 06:00 Thai

bool InNews(datetime utc)
{
   if(!NewsFilter) return false;
   for(int i = 0; i < ArraySize(g_news); i++)
      if(utc >= g_news[i] - NewsBeforeMin * 60 && utc <= g_news[i] + NewsAfterMin * 60) return true;
   return false;
}

//+------------------------------------------------------------------+
//| HTTP + tiny JSON helpers (NY module)                             |
//+------------------------------------------------------------------+
bool HttpGet(const string url, string &body, string &err)
{
   char post[], res[]; string hdr;
   ResetLastError();
   int code = WebRequest("GET", url, "User-Agent: OISFBridge/2.0\r\nAccept: application/json\r\n", 8000, post, res, hdr);
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

struct JRow { string v[12]; int n; };

// value of "key": number / string (no nested objects)
string JGet(const string &js, const string key, int from = 0)
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
//| JSON builder + state (hub sync)                                  |
//+------------------------------------------------------------------+
string JStr(string s)
{
   StringReplace(s, "\\", "\\\\");
   StringReplace(s, "\"", "\\\"");
   StringReplace(s, "\n", " ");
   StringReplace(s, "\r", " ");
   return "\"" + s + "\"";
}
string JNum(double v, int d) { return DoubleToString(v, d); }

bool OwnedOrVisible(long magic, string sym)
{
   if(sym != g_sym) return false;
   return ManageAllOnSym || magic == Magic;
}

string BuildState()
{
   int dg = (int)SymbolInfoInteger(g_sym, SYMBOL_DIGITS);
   bool tradeOk = TerminalInfoInteger(TERMINAL_TRADE_ALLOWED) && MQLInfoInteger(MQL_TRADE_ALLOWED)
                  && AccountInfoInteger(ACCOUNT_TRADE_EXPERT);

   string acc = "{\"login\":" + IntegerToString(AccountInfoInteger(ACCOUNT_LOGIN)) +
      ",\"server\":" + JStr(AccountInfoString(ACCOUNT_SERVER)) +
      ",\"currency\":" + JStr(AccountInfoString(ACCOUNT_CURRENCY)) +
      ",\"balance\":" + JNum(AccountInfoDouble(ACCOUNT_BALANCE), 2) +
      ",\"equity\":" + JNum(AccountInfoDouble(ACCOUNT_EQUITY), 2) +
      ",\"margin\":" + JNum(AccountInfoDouble(ACCOUNT_MARGIN), 2) +
      ",\"free_margin\":" + JNum(AccountInfoDouble(ACCOUNT_MARGIN_FREE), 2) +
      ",\"margin_level\":" + JNum(AccountInfoDouble(ACCOUNT_MARGIN_LEVEL), 2) +
      ",\"leverage\":" + IntegerToString(AccountInfoInteger(ACCOUNT_LEVERAGE)) +
      ",\"profit\":" + JNum(AccountInfoDouble(ACCOUNT_PROFIT), 2) +
      ",\"trade_allowed\":" + (tradeOk ? "true" : "false") +
      ",\"hedging\":" + (AccountInfoInteger(ACCOUNT_MARGIN_MODE) == ACCOUNT_MARGIN_MODE_RETAIL_HEDGING ? "true" : "false") +
      "}";

   string sym = "{\"name\":" + JStr(g_sym) +
      ",\"bid\":" + JNum(SymbolInfoDouble(g_sym, SYMBOL_BID), dg) +
      ",\"ask\":" + JNum(SymbolInfoDouble(g_sym, SYMBOL_ASK), dg) +
      ",\"digits\":" + IntegerToString(dg) +
      ",\"point\":" + JNum(SymbolInfoDouble(g_sym, SYMBOL_POINT), 8) +
      ",\"contract\":" + JNum(SymbolInfoDouble(g_sym, SYMBOL_TRADE_CONTRACT_SIZE), 4) +
      ",\"tick_value\":" + JNum(SymbolInfoDouble(g_sym, SYMBOL_TRADE_TICK_VALUE), 8) +
      ",\"tick_size\":" + JNum(SymbolInfoDouble(g_sym, SYMBOL_TRADE_TICK_SIZE), 8) +
      ",\"vol_min\":" + JNum(SymbolInfoDouble(g_sym, SYMBOL_VOLUME_MIN), 4) +
      ",\"vol_max\":" + JNum(MathMin(SymbolInfoDouble(g_sym, SYMBOL_VOLUME_MAX), MaxLots), 4) +
      ",\"vol_step\":" + JNum(SymbolInfoDouble(g_sym, SYMBOL_VOLUME_STEP), 4) +
      ",\"stops_level\":" + IntegerToString(SymbolInfoInteger(g_sym, SYMBOL_TRADE_STOPS_LEVEL)) +
      ",\"spread\":" + IntegerToString(SymbolInfoInteger(g_sym, SYMBOL_SPREAD)) +
      "}";

   string pos = "";
   for(int i = PositionsTotal() - 1; i >= 0; i--)
   {
      ulong tk = PositionGetTicket(i);
      if(tk == 0) continue;
      if(!OwnedOrVisible(PositionGetInteger(POSITION_MAGIC), PositionGetString(POSITION_SYMBOL))) continue;
      if(pos != "") pos += ",";
      pos += "{\"ticket\":" + IntegerToString((long)tk) +
             ",\"side\":" + (PositionGetInteger(POSITION_TYPE) == POSITION_TYPE_BUY ? "\"BUY\"" : "\"SELL\"") +
             ",\"lots\":" + JNum(PositionGetDouble(POSITION_VOLUME), 2) +
             ",\"open\":" + JNum(PositionGetDouble(POSITION_PRICE_OPEN), dg) +
             ",\"sl\":" + JNum(PositionGetDouble(POSITION_SL), dg) +
             ",\"tp\":" + JNum(PositionGetDouble(POSITION_TP), dg) +
             ",\"profit\":" + JNum(PositionGetDouble(POSITION_PROFIT) + PositionGetDouble(POSITION_SWAP), 2) +
             ",\"swap\":" + JNum(PositionGetDouble(POSITION_SWAP), 2) +
             ",\"time\":" + IntegerToString((long)PositionGetInteger(POSITION_TIME)) +
             ",\"magic\":" + IntegerToString(PositionGetInteger(POSITION_MAGIC)) +
             ",\"comment\":" + JStr(PositionGetString(POSITION_COMMENT)) + "}";
   }

   string ord = "";
   for(int i = OrdersTotal() - 1; i >= 0; i--)
   {
      ulong tk = OrderGetTicket(i);
      if(tk == 0) continue;
      if(!OwnedOrVisible(OrderGetInteger(ORDER_MAGIC), OrderGetString(ORDER_SYMBOL))) continue;
      if(ord != "") ord += ",";
      ord += "{\"ticket\":" + IntegerToString((long)tk) +
             ",\"type\":" + JStr(OrderTypeName((ENUM_ORDER_TYPE)OrderGetInteger(ORDER_TYPE))) +
             ",\"lots\":" + JNum(OrderGetDouble(ORDER_VOLUME_CURRENT), 2) +
             ",\"price\":" + JNum(OrderGetDouble(ORDER_PRICE_OPEN), dg) +
             ",\"sl\":" + JNum(OrderGetDouble(ORDER_SL), dg) +
             ",\"tp\":" + JNum(OrderGetDouble(ORDER_TP), dg) +
             ",\"time\":" + IntegerToString((long)OrderGetInteger(ORDER_TIME_SETUP)) + "}";
   }

   if(TimeCurrent() - g_plAt >= 30) { g_plJson = BuildPL(); g_plAt = TimeCurrent(); }

   return "{\"ea\":" + JStr(EA_VERSION) +
          ",\"server_time\":" + IntegerToString((long)TimeTradeServer()) +
          ",\"gmt_offset\":" + IntegerToString((long)(TimeTradeServer() - TimeGMT())) +
          ",\"account\":" + acc + ",\"symbol\":" + sym +
          ",\"positions\":[" + pos + "],\"orders\":[" + ord + "]" +
          ",\"pl\":" + g_plJson + "}";
}

string OrderTypeName(ENUM_ORDER_TYPE t)
{
   switch(t)
   {
      case ORDER_TYPE_BUY_LIMIT:  return "BUY LIMIT";
      case ORDER_TYPE_SELL_LIMIT: return "SELL LIMIT";
      case ORDER_TYPE_BUY_STOP:   return "BUY STOP";
      case ORDER_TYPE_SELL_STOP:  return "SELL STOP";
      case ORDER_TYPE_BUY_STOP_LIMIT:  return "BUY STOP LIMIT";
      case ORDER_TYPE_SELL_STOP_LIMIT: return "SELL STOP LIMIT";
      default: return "OTHER";
   }
}

// Closed-trade P&L for today / this week / this month (server time, whole account, trades only)
string BuildPL()
{
   datetime now = TimeTradeServer();
   MqlDateTime d; TimeToStruct(now, d);
   datetime dayStart = now - (d.hour * 3600 + d.min * 60 + d.sec);
   int dow = (d.day_of_week + 6) % 7;                 // Monday = 0
   datetime weekStart = dayStart - dow * 86400;
   MqlDateTime m = d; m.day = 1; m.hour = 0; m.min = 0; m.sec = 0;
   datetime monthStart = StructToTime(m);
   datetime from = (weekStart < monthStart ? weekStart : monthStart);

   double pDay = 0, pWeek = 0, pMonth = 0;
   int tDay = 0, tMonth = 0, wMonth = 0;
   if(HistorySelect(from, now + 60))
   {
      int n = HistoryDealsTotal();
      for(int i = 0; i < n; i++)
      {
         ulong tk = HistoryDealGetTicket(i);
         long type = HistoryDealGetInteger(tk, DEAL_TYPE);
         if(type != DEAL_TYPE_BUY && type != DEAL_TYPE_SELL) continue;   // skip deposits etc.
         datetime t = (datetime)HistoryDealGetInteger(tk, DEAL_TIME);
         long entry = HistoryDealGetInteger(tk, DEAL_ENTRY);
         double v = HistoryDealGetDouble(tk, DEAL_PROFIT) + HistoryDealGetDouble(tk, DEAL_SWAP)
                  + HistoryDealGetDouble(tk, DEAL_COMMISSION) + HistoryDealGetDouble(tk, DEAL_FEE);
         bool closing = (entry == DEAL_ENTRY_OUT || entry == DEAL_ENTRY_INOUT || entry == DEAL_ENTRY_OUT_BY);
         if(t >= dayStart)   pDay += v;
         if(t >= weekStart)  pWeek += v;
         if(t >= monthStart)
         {
            pMonth += v;
            if(closing) { tMonth++; if(HistoryDealGetDouble(tk, DEAL_PROFIT) > 0) wMonth++; }
         }
         if(closing && t >= dayStart) tDay++;
      }
   }
   return "{\"today\":" + JNum(pDay, 2) + ",\"week\":" + JNum(pWeek, 2) + ",\"month\":" + JNum(pMonth, 2) +
          ",\"trades_today\":" + IntegerToString(tDay) + ",\"trades_month\":" + IntegerToString(tMonth) +
          ",\"wins_month\":" + IntegerToString(wMonth) + "}";
}

//+------------------------------------------------------------------+
//| Deal history upload (all symbols, all magics) — incremental      |
//+------------------------------------------------------------------+
string BuildDeals(int &count)
{
   count = 0;
   if(!g_histKnown) return "";
   if(!HistorySelect((datetime)g_histTime, TimeCurrent() + 86400)) return "";
   int n = HistoryDealsTotal();
   string out = "";
   for(int i = 0; i < n && count < HIST_BATCH; i++)
   {
      ulong tk = HistoryDealGetTicket(i);
      if(tk == 0) continue;
      long tm = HistoryDealGetInteger(tk, DEAL_TIME);
      if(tm < g_histTime || (tm == g_histTime && tk <= g_histTicket)) continue;
      if(out != "") out += ",";
      out += "{\"t\":" + IntegerToString((long)tk) +
             ",\"tm\":" + IntegerToString(tm) +
             ",\"ty\":" + IntegerToString(HistoryDealGetInteger(tk, DEAL_TYPE)) +
             ",\"en\":" + IntegerToString(HistoryDealGetInteger(tk, DEAL_ENTRY)) +
             ",\"v\":" + JNum(HistoryDealGetDouble(tk, DEAL_VOLUME), 2) +
             ",\"p\":" + JNum(HistoryDealGetDouble(tk, DEAL_PRICE), 5) +
             ",\"pf\":" + JNum(HistoryDealGetDouble(tk, DEAL_PROFIT), 2) +
             ",\"sw\":" + JNum(HistoryDealGetDouble(tk, DEAL_SWAP), 2) +
             ",\"cm\":" + JNum(HistoryDealGetDouble(tk, DEAL_COMMISSION), 2) +
             ",\"fe\":" + JNum(HistoryDealGetDouble(tk, DEAL_FEE), 2) +
             ",\"pos\":" + IntegerToString(HistoryDealGetInteger(tk, DEAL_POSITION_ID)) +
             ",\"s\":" + JStr(HistoryDealGetString(tk, DEAL_SYMBOL)) +
             ",\"mg\":" + IntegerToString(HistoryDealGetInteger(tk, DEAL_MAGIC)) + "}";
      count++;
   }
   return out;
}

//+------------------------------------------------------------------+
//| Closed M1 bars (for the hub auto-trader) — sent once per new bar  |
//+------------------------------------------------------------------+
datetime g_barsT = 0;
string BuildBars()
{
   MqlRates r[];
   ArraySetAsSeries(r, false);
   int n = CopyRates(g_sym, PERIOD_M1, 1, 130, r);   // shift 1 = last CLOSED bar
   if(n < 2) return "";
   if(r[n - 1].time == g_barsT) return "";
   g_barsT = r[n - 1].time;
   int dg = (int)SymbolInfoInteger(g_sym, SYMBOL_DIGITS);
   string o = "";
   for(int i = 0; i < n; i++)
      o += (i ? "," : "") + "[" + IntegerToString((long)r[i].time) + "," + JNum(r[i].open, dg) + "," + JNum(r[i].high, dg) + "," + JNum(r[i].low, dg) + "," + JNum(r[i].close, dg) + "]";
   return o;
}

//+------------------------------------------------------------------+
//| Hub sync                                                          |
//+------------------------------------------------------------------+
void Sync()
{
   string res = "";
   for(int i = 0; i < ArraySize(g_results); i++) res += (i ? "," : "") + g_results[i];
   int nDeals = 0;
   string deals = BuildDeals(nDeals);
   string bars = BuildBars();
   string body = "{\"state\":" + BuildState() + ",\"results\":[" + res + "],\"deals\":[" + deals + "]" + (bars != "" ? ",\"bars\":[" + bars + "]" : "") + "}";
   int sent = ArraySize(g_results);

   char data[], reply[];
   string replyHeaders;
   int len = StringToCharArray(body, data, 0, WHOLE_ARRAY, CP_UTF8) - 1;
   ArrayResize(data, len);
   string headers = "Content-Type: application/json\r\nX-Key: " + EAKey + "\r\n";

   ResetLastError();
   int code = WebRequest("POST", HubURL + "/ea/sync", headers, 5000, data, reply, replyHeaders);
   if(code == -1)
   {
      int err = GetLastError();
      if(err == 4014 && !g_warnedUrl)
      {
         Alert("OI SF Bridge: add ", HubURL, " to Tools > Options > Expert Advisors > Allow WebRequest");
         g_warnedUrl = true;
      }
      g_status = "hub unreachable (" + IntegerToString(err) + ")";
      g_nextMs = 3000;
      return;
   }
   if(code == 401) { g_status = "EA key rejected"; g_nextMs = 10000; return; }
   if(code != 200) { g_status = "hub error " + IntegerToString(code); g_nextMs = 3000; return; }

   // results delivered → drop the ones we just sent
   if(sent > 0) ArrayRemove(g_results, 0, sent);
   g_status = "online";

   string text = CharArrayToString(reply, 0, WHOLE_ARRAY, CP_UTF8);
   string lines[];
   int n = StringSplit(text, '\n', lines);
   for(int i = 0; i < n; i++)
   {
      string ln = lines[i];
      StringTrimRight(ln); StringTrimLeft(ln);
      if(StringFind(ln, "NEXT|") == 0)
      {
         int ms = (int)StringToInteger(StringSubstr(ln, 5));
         g_nextMs = (int)MathMax(500, MathMin(30000, ms));
      }
      else if(StringFind(ln, "HIST|") == 0)
      {
         string h[];
         if(StringSplit(ln, '|', h) >= 3) { g_histTime = StringToInteger(h[1]); g_histTicket = (ulong)StringToInteger(h[2]); g_histKnown = true; }
      }
      else if(StringFind(ln, "CMD|") == 0)
         Execute(ln);
   }
   if(nDeals >= HIST_BATCH) g_nextMs = (int)MathMin(g_nextMs, 500);   // still back-filling history
}

//+------------------------------------------------------------------+
//| Command execution (hub → EA)                                     |
//+------------------------------------------------------------------+
void AddResult(string id, bool ok, uint retcode, string msg, ulong ticket)
{
   string r = "{\"id\":" + JStr(id) + ",\"ok\":" + (ok ? "true" : "false") +
              ",\"retcode\":" + IntegerToString(retcode) + ",\"msg\":" + JStr(msg) +
              ",\"ticket\":" + IntegerToString((long)ticket) + "}";
   int k = ArraySize(g_results);
   ArrayResize(g_results, k + 1);
   g_results[k] = r;
   g_nextMs = 300;   // report back quickly
   PrintFormat("OI SF Bridge cmd %s → %s (%u) %s", id, ok ? "OK" : "FAIL", retcode, msg);
}

bool AlreadyDone(string id)
{
   for(int i = 0; i < 64; i++) if(g_done[i] == id) return true;
   g_done[g_donePos] = id;
   g_donePos = (g_donePos + 1) % 64;
   return false;
}

double NormLots(double lots)
{
   double step = SymbolInfoDouble(g_sym, SYMBOL_VOLUME_STEP);
   if(step <= 0) step = 0.01;
   return NormalizeDouble(MathFloor(lots / step + 1e-9) * step, 2);
}

double NormPrice(double p)
{
   if(p <= 0) return 0;
   double ts = SymbolInfoDouble(g_sym, SYMBOL_TRADE_TICK_SIZE);
   int dg = (int)SymbolInfoInteger(g_sym, SYMBOL_DIGITS);
   if(ts > 0) p = MathRound(p / ts) * ts;
   return NormalizeDouble(p, dg);
}

bool TradeOk(uint rc) { return rc == TRADE_RETCODE_DONE || rc == TRADE_RETCODE_PLACED || rc == TRADE_RETCODE_DONE_PARTIAL; }

void Execute(string line)
{
   string f[];
   if(StringSplit(line, '|', f) < 11) return;
   string id = f[1], type = f[2], side = f[3], kind = f[4];
   double lots = StringToDouble(f[5]);
   double price = NormPrice(StringToDouble(f[6]));
   double sl = NormPrice(StringToDouble(f[7]));
   double tp = NormPrice(StringToDouble(f[8]));
   ulong  ticket = (ulong)StringToInteger(f[9]);
   long   age = StringToInteger(f[10]);

   if(AlreadyDone(id)) return;
   if(age > MaxCmdAgeMs) { AddResult(id, false, 0, "command too old (" + IntegerToString(age) + " ms)", 0); return; }
   if(!TerminalInfoInteger(TERMINAL_TRADE_ALLOWED) || !MQLInfoInteger(MQL_TRADE_ALLOWED))
   { AddResult(id, false, 0, "Algo Trading is off in MT5", 0); return; }

   bool ok = false;
   ulong outTicket = 0;

   if(type == "OPEN")
   {
      lots = NormLots(lots);
      double vmin = SymbolInfoDouble(g_sym, SYMBOL_VOLUME_MIN);
      if(lots < vmin) { AddResult(id, false, 0, "lots below broker minimum " + DoubleToString(vmin, 2), 0); return; }
      if(lots > MaxLots + 1e-9) { AddResult(id, false, 0, "lots above MaxLots " + DoubleToString(MaxLots, 2), 0); return; }
      string cm = "OIT";
      if(kind == "MARKET")
         ok = (side == "BUY") ? trade.Buy(lots, g_sym, 0, sl, tp, cm) : trade.Sell(lots, g_sym, 0, sl, tp, cm);
      else if(kind == "LIMIT")
         ok = (side == "BUY") ? trade.BuyLimit(lots, price, g_sym, sl, tp, ORDER_TIME_GTC, 0, cm)
                              : trade.SellLimit(lots, price, g_sym, sl, tp, ORDER_TIME_GTC, 0, cm);
      else if(kind == "STOP")
         ok = (side == "BUY") ? trade.BuyStop(lots, price, g_sym, sl, tp, ORDER_TIME_GTC, 0, cm)
                              : trade.SellStop(lots, price, g_sym, sl, tp, ORDER_TIME_GTC, 0, cm);
      else { AddResult(id, false, 0, "unknown kind " + kind, 0); return; }
      outTicket = trade.ResultOrder();
   }
   else if(type == "MODIFY")
   {
      if(PositionSelectByTicket(ticket))
      {
         if(!OwnedOrVisible(PositionGetInteger(POSITION_MAGIC), PositionGetString(POSITION_SYMBOL)))
         { AddResult(id, false, 0, "position not managed by this bridge", ticket); return; }
         ok = trade.PositionModify(ticket, sl, tp);
      }
      else if(OrderSelect(ticket))
      {
         if(!OwnedOrVisible(OrderGetInteger(ORDER_MAGIC), OrderGetString(ORDER_SYMBOL)))
         { AddResult(id, false, 0, "order not managed by this bridge", ticket); return; }
         double p = (price > 0 ? price : OrderGetDouble(ORDER_PRICE_OPEN));
         ok = trade.OrderModify(ticket, p, sl, tp, ORDER_TIME_GTC, 0);
      }
      else { AddResult(id, false, 0, "ticket not found", ticket); return; }
      outTicket = ticket;
   }
   else if(type == "CLOSE")
   {
      if(!PositionSelectByTicket(ticket)) { AddResult(id, false, 0, "position not found", ticket); return; }
      if(!OwnedOrVisible(PositionGetInteger(POSITION_MAGIC), PositionGetString(POSITION_SYMBOL)))
      { AddResult(id, false, 0, "position not managed by this bridge", ticket); return; }
      double vol = PositionGetDouble(POSITION_VOLUME);
      lots = NormLots(lots);
      if(lots > 0 && lots < vol) ok = trade.PositionClosePartial(ticket, lots);
      else ok = trade.PositionClose(ticket);
      outTicket = ticket;
   }
   else if(type == "CANCEL")
   {
      if(!OrderSelect(ticket)) { AddResult(id, false, 0, "order not found", ticket); return; }
      if(!OwnedOrVisible(OrderGetInteger(ORDER_MAGIC), OrderGetString(ORDER_SYMBOL)))
      { AddResult(id, false, 0, "order not managed by this bridge", ticket); return; }
      ok = trade.OrderDelete(ticket);
      outTicket = ticket;
   }
   else if(type == "CLOSEALL")
   {
      int closed = 0, failed = 0;
      for(int i = PositionsTotal() - 1; i >= 0; i--)
      {
         ulong tk = PositionGetTicket(i);
         if(tk == 0) continue;
         if(!OwnedOrVisible(PositionGetInteger(POSITION_MAGIC), PositionGetString(POSITION_SYMBOL))) continue;
         if(trade.PositionClose(tk) && TradeOk(trade.ResultRetcode())) closed++; else failed++;
      }
      AddResult(id, failed == 0, 0, "closed " + IntegerToString(closed) + (failed ? ", failed " + IntegerToString(failed) : ""), 0);
      return;
   }
   else { AddResult(id, false, 0, "unknown type " + type, 0); return; }

   uint rc = trade.ResultRetcode();
   AddResult(id, ok && TradeOk(rc), rc, trade.ResultRetcodeDescription(), outTicket);
}

//+------------------------------------------------------------------+
//| NY module: offset / news / zones (โซนจาก Worker ชุดเดียวกับแอป)   |
//+------------------------------------------------------------------+
// offset = Gold.F (GC) - broker close, median of the last 5 closed minutes
void LoadOffset()
{
   g_offAt = TimeGMT();
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
   if(!HttpGet(NewsURL + "?t=" + IntegerToString((long)TimeGMT() / 300), js, err)) { Print("OI SF Bridge news: ", err); return; }
   ArrayResize(g_news, 0);
   int p = 0, n = 0;
   while(true)
   {
      p = StringFind(js, "\"date\"", p); if(p < 0) break;
      int e = StringFind(js, "}", p); if(e < 0) e = StringLen(js);
      string obj = StringSubstr(js, p, e - p);
      string c = JGet(obj, "c"), im = JGet(obj, "i");
      if(c == "USD" && (im == "" || im == "H"))
      {
         datetime t = IsoToUtc(JGet(obj, "date"));
         if(t > 0) { ArrayResize(g_news, n + 1); g_news[n++] = t; }
      }
      p = e;
   }
}

// โซนของวันจาก Worker (/osf/v1?view=ea → zones) — ชุดเดียวกับที่แอป/EA สวนกำแพงใช้
// แปลงเป็นสเกลโบรกด้วย offset ทันทีที่โหลด
void LoadZones()
{
   g_zoneAt = TimeGMT();
   if(g_off == EMPTY_VALUE) return;                     // ต้องมี offset ก่อน
   string js, err;
   if(!HttpGet(WorkerURL + "/osf/v1?view=ea", js, err)) { g_boInfo = "zones: " + err; return; }
   long day = StringToInteger(JGet(js, "day"));
   if(day == 0) { g_boInfo = "zones: no day"; return; }
   if(day == g_zoneDay && ArraySize(g_lv) > 0) return;  // ล็อกโซนทั้งวันแล้ว
   JRow z[]; int n = JRows(js, "zones", z);
   if(n < 1) { g_boInfo = "zones: empty"; return; }
   ArrayResize(g_lv, n);
   for(int i = 0; i < n; i++)
   {
      g_lv[i].strike = StringToDouble(z[i].v[0]);
      g_lv[i].price  = g_lv[i].strike - g_off;          // GC → broker
      g_lv[i].side   = (z[i].v[1] == "C" ? 1 : -1);
   }
   g_zoneDay = day;
   g_boInfo = StringFormat("NY: %d เส้น (โซน Worker ล็อกแล้ว)", n);
}

//+------------------------------------------------------------------+
//| NY break — M5 ปิดทะลุขอบโซน ≥ $2 → เข้า market · SL ขอบอีกฝั่ง/กลาง |
//| TP RR1 · 1 ครั้ง/เส้น/วัน · cap ระยะไล่ NYBreakMaxDist (V4.9.166)  |
//+------------------------------------------------------------------+
void CheckNYBreak()
{
   if(!UseNYBreak) { return; }
   datetime m5 = iTime(g_sym, PERIOD_M5, 0);
   if(m5 <= 0 || m5 == g_boBarT) return;
   g_boBarT = m5;
   int nl = ArraySize(g_lv); if(nl == 0) return;
   datetime u5 = SrvToUtc(m5), ds = DayStart(u5 - 300), wa = ds + (BO_A - 360) * 60;
   int mLast = ThaiMin(u5 - 60), mNext = ThaiMin(u5);       // last M1 of the closed M5 / entry bar
   if(mLast < BO_A || mLast >= BO_B || mNext < BO_A || mNext >= BO_B) return;

   MqlRates r[]; ArraySetAsSeries(r, false);
   int n = CopyRates(g_sym, PERIOD_M5, UtcToSrv(wa) - 300, m5, r);
   if(n < 2 || r[n - 1].time != m5) return;
   double prev[]; bool has[], done[]; ArrayResize(prev, nl); ArrayResize(has, nl); ArrayResize(done, nl);
   ArrayInitialize(has, false); ArrayInitialize(done, false);
   int trig = -1, tdir = 0;
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
         double bdist = (r[i].close - (dir > 0 ? hi : lo)) * dir;   // V4.9.166: ปิดเลยขอบไปแค่ไหน
         if(NYBreakMaxDist > 0 && bdist > NYBreakMaxDist) continue; // ไล่ไกล = ข้าม และยังไม่ถือว่าใช้เส้น
         done[z] = true;
         if(i == n - 2) { trig = z; tdir = dir; }           // the M5 that just closed
      }
   }
   int used = 0; for(int z = 0; z < nl; z++) if(done[z]) used++;
   g_boInfo = StringFormat("NY: %d/%d เส้นใช้แล้ววันนี้", used, nl);
   if(trig < 0) return;

   int z = trig, dir = tdir;
   double lo = g_lv[z].price - BO_HALF, hi = g_lv[z].price + BO_HALF;
   double entry = r[n - 2].close, sl = NYBreakSLMid ? g_lv[z].price : (dir > 0 ? lo : hi);
   if(MathAbs(entry - sl) < 1) sl = entry - dir * 1;
   double R = MathAbs(entry - sl), tp = entry + dir * NYBreakRR * R;
   string id = StringFormat("OSF2 %s NYB %.0f", dir > 0 ? "B" : "S", g_lv[z].strike);
   string key = StringFormat("OSB2%d|%s|%.0f", (int)(Magic % 100000), TimeToString(ds + 7200, TIME_DATE), g_lv[z].strike);
   if(GlobalVariableCheck(key)) return;
   GlobalVariableSet(key, (double)TimeGMT());
   string tag = StringFormat("%s %s%.0f break %+.2f$ | %s %.2f SL %.2f TP %.2f (RR%g)", "NY", g_lv[z].side > 0 ? "C" : "P", g_lv[z].strike,
                             (entry - (dir > 0 ? hi : lo)) * dir, dir > 0 ? "BUY" : "SELL", entry, sl, tp, NYBreakRR);
   if(InNews(SrvToUtc(m5)))                    { Print("OI SF Bridge: NY break skipped (red news): ", tag); return; }
   if(TimeCurrent() - m5 > NYBreakMaxDelay)    { Print("OI SF Bridge: NY break skipped (late start): ", tag); return; }
   if(!TerminalInfoInteger(TERMINAL_TRADE_ALLOWED) || !MQLInfoInteger(MQL_TRADE_ALLOWED))
   { Print("OI SF Bridge: NY break skipped (Algo Trading off): ", tag); return; }

   int dg = (int)SymbolInfoInteger(g_sym, SYMBOL_DIGITS);
   double px = (dir > 0 ? SymbolInfoDouble(g_sym, SYMBOL_ASK) : SymbolInfoDouble(g_sym, SYMBOL_BID));
   if(dir > 0 ? px <= sl || px >= tp : px >= sl || px <= tp) { Print("OI SF Bridge: NY break skipped (price past SL/TP): ", tag); return; }
   double lot = NormLots(NYBreakLots);
   double vmin = SymbolInfoDouble(g_sym, SYMBOL_VOLUME_MIN);
   if(lot < vmin) { Print("OI SF Bridge: NY break skipped (lot < min ", DoubleToString(vmin, 2), "): ", tag); return; }
   if(lot > MaxLots + 1e-9) lot = NormLots(MaxLots);
   bool ok = (dir > 0) ? trade.Buy(lot, g_sym, 0, NormalizeDouble(sl, dg), NormalizeDouble(tp, dg), id)
                       : trade.Sell(lot, g_sym, 0, NormalizeDouble(sl, dg), NormalizeDouble(tp, dg), id);
   if(ok && TradeOk(trade.ResultRetcode())) PrintFormat("OI SF Bridge OPEN %.2f lot: %s", lot, tag);
   else PrintFormat("OI SF Bridge NY break order failed %d %s: %s", trade.ResultRetcode(), trade.ResultRetcodeDescription(), tag);
}
//+------------------------------------------------------------------+

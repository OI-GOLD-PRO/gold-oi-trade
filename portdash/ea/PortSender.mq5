//+------------------------------------------------------------------+
//|                                                  PortSender.mq5  |
//|  MT5 Port Dashboard — sends account data to the hub. VIEW ONLY:  |
//|  this EA never opens, modifies or closes anything.               |
//|                                                                  |
//|  Setup: Tools > Options > Expert Advisors >                      |
//|         tick "Allow WebRequest for listed URL" → add the HubURL  |
//|  Attach to ONE chart (any symbol) per MT5 account.               |
//+------------------------------------------------------------------+
#property copyright "OI Gold Pro"
#property version   "1.00"
#property description "ส่งยอดบัญชี ไม้ที่เปิด และประวัติการเทรด ขึ้นแดชบอร์ดพอร์ต (ไม่เทรด)"

#define EA_VERSION "v1.0.00"
#define HIST_BATCH 500

input string HubURL     = "https://port-hub.oigoldpro.workers.dev"; // Hub URL (no trailing /)
input string ConnectKey = "";                                        // รหัสเชื่อมต่อ (10 ตัว จากแอป)

ulong    g_lastSync   = 0;
int      g_nextMs     = 1000;
bool     g_warnedUrl  = false;
string   g_status     = "starting";
bool     g_histKnown  = false;   // hub told us how far its deal history goes
long     g_histTime   = 0;
ulong    g_histTicket = 0;

//+------------------------------------------------------------------+
int OnInit()
{
   if(StringLen(ConnectKey) < 8 || StringFind(HubURL, "https://") != 0)
   {
      Alert("PortSender: ใส่ HubURL (https://...) และ ConnectKey ใน Inputs");
      return INIT_PARAMETERS_INCORRECT;
   }
   EventSetMillisecondTimer(500);
   Print("PortSender ", EA_VERSION, " started, account ", AccountInfoInteger(ACCOUNT_LOGIN));
   return INIT_SUCCEEDED;
}

void OnDeinit(const int reason)
{
   EventKillTimer();
   Comment("");
}

void OnTimer()
{
   ulong now = GetTickCount64();
   if(now - g_lastSync < (ulong)g_nextMs) return;
   g_lastSync = now;
   Sync();
   Comment("PortSender ", EA_VERSION, "  |  ", g_status, "  |  ทุก ", g_nextMs / 1000.0, " วิ  |  ดูอย่างเดียว ไม่เทรด");
}

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

string BuildState()
{
   string acc = "{\"login\":" + IntegerToString(AccountInfoInteger(ACCOUNT_LOGIN)) +
      ",\"name\":" + JStr(AccountInfoString(ACCOUNT_NAME)) +
      ",\"server\":" + JStr(AccountInfoString(ACCOUNT_SERVER)) +
      ",\"company\":" + JStr(AccountInfoString(ACCOUNT_COMPANY)) +
      ",\"currency\":" + JStr(AccountInfoString(ACCOUNT_CURRENCY)) +
      ",\"balance\":" + JNum(AccountInfoDouble(ACCOUNT_BALANCE), 2) +
      ",\"equity\":" + JNum(AccountInfoDouble(ACCOUNT_EQUITY), 2) +
      ",\"margin\":" + JNum(AccountInfoDouble(ACCOUNT_MARGIN), 2) +
      ",\"free_margin\":" + JNum(AccountInfoDouble(ACCOUNT_MARGIN_FREE), 2) +
      ",\"margin_level\":" + JNum(AccountInfoDouble(ACCOUNT_MARGIN_LEVEL), 2) +
      ",\"leverage\":" + IntegerToString(AccountInfoInteger(ACCOUNT_LEVERAGE)) +
      ",\"profit\":" + JNum(AccountInfoDouble(ACCOUNT_PROFIT), 2) + "}";

   string pos = "";
   for(int i = PositionsTotal() - 1; i >= 0; i--)
   {
      ulong tk = PositionGetTicket(i);
      if(tk == 0) continue;
      string sym = PositionGetString(POSITION_SYMBOL);
      int dg = (int)SymbolInfoInteger(sym, SYMBOL_DIGITS);
      if(pos != "") pos += ",";
      pos += "{\"ticket\":" + IntegerToString((long)tk) +
             ",\"symbol\":" + JStr(sym) +
             ",\"side\":" + (PositionGetInteger(POSITION_TYPE) == POSITION_TYPE_BUY ? "\"BUY\"" : "\"SELL\"") +
             ",\"lots\":" + JNum(PositionGetDouble(POSITION_VOLUME), 2) +
             ",\"open\":" + JNum(PositionGetDouble(POSITION_PRICE_OPEN), dg) +
             ",\"current\":" + JNum(PositionGetDouble(POSITION_PRICE_CURRENT), dg) +
             ",\"sl\":" + JNum(PositionGetDouble(POSITION_SL), dg) +
             ",\"tp\":" + JNum(PositionGetDouble(POSITION_TP), dg) +
             ",\"profit\":" + JNum(PositionGetDouble(POSITION_PROFIT) + PositionGetDouble(POSITION_SWAP), 2) +
             ",\"time\":" + IntegerToString((long)PositionGetInteger(POSITION_TIME)) +
             ",\"magic\":" + IntegerToString(PositionGetInteger(POSITION_MAGIC)) +
             ",\"comment\":" + JStr(PositionGetString(POSITION_COMMENT)) + "}";
   }

   return "{\"ea\":" + JStr(EA_VERSION) +
          ",\"server_time\":" + IntegerToString((long)TimeTradeServer()) +
          ",\"gmt_offset\":" + IntegerToString((long)(TimeTradeServer() - TimeGMT())) +
          ",\"orders\":" + IntegerToString(OrdersTotal()) +
          ",\"account\":" + acc + ",\"positions\":[" + pos + "]}";
}

// Deals the hub does not have yet (all symbols, all magics, deposits too) — incremental
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
void Sync()
{
   int nDeals = 0;
   string deals = BuildDeals(nDeals);
   string body = "{\"state\":" + BuildState() + ",\"deals\":[" + deals + "]}";

   char data[], reply[];
   string replyHeaders;
   int len = StringToCharArray(body, data, 0, WHOLE_ARRAY, CP_UTF8) - 1;
   ArrayResize(data, len);
   string headers = "Content-Type: application/json\r\nX-Key: " + ConnectKey + "\r\n";

   ResetLastError();
   int code = WebRequest("POST", HubURL + "/ea/push", headers, 8000, data, reply, replyHeaders);
   string text = (code > 0 ? CharArrayToString(reply, 0, WHOLE_ARRAY, CP_UTF8) : "");
   if(code == -1)
   {
      int err = GetLastError();
      if(err == 4014 && !g_warnedUrl)
      {
         Alert("PortSender: เพิ่ม ", HubURL, " ใน Tools > Options > Expert Advisors > Allow WebRequest");
         g_warnedUrl = true;
      }
      g_status = "ต่อ hub ไม่ได้ (" + IntegerToString(err) + ")";
      g_nextMs = 10000;
      return;
   }
   if(code == 401) { g_status = "รหัสเชื่อมต่อไม่ถูกต้อง"; g_nextMs = 60000; return; }
   if(code == 409) { g_status = "รหัสนี้ผูกกับบัญชีอื่นแล้ว: " + StringSubstr(text, 4); g_nextMs = 60000; return; }
   if(code != 200) { g_status = "hub error " + IntegerToString(code); g_nextMs = 10000; return; }

   g_status = "ออนไลน์";
   bool wasKnown = g_histKnown;
   string lines[];
   int n = StringSplit(text, '\n', lines);
   for(int i = 0; i < n; i++)
   {
      string ln = lines[i];
      StringTrimRight(ln); StringTrimLeft(ln);
      if(StringFind(ln, "NEXT|") == 0)
      {
         int ms = (int)StringToInteger(StringSubstr(ln, 5));
         g_nextMs = (int)MathMax(2000, MathMin(60000, ms));
      }
      else if(StringFind(ln, "HIST|") == 0)
      {
         string h[];
         if(StringSplit(ln, '|', h) >= 3) { g_histTime = StringToInteger(h[1]); g_histTicket = (ulong)StringToInteger(h[2]); g_histKnown = true; }
      }
   }
   if(!wasKnown && g_histKnown) g_nextMs = 1000;   // first contact: send history right away
   if(nDeals >= HIST_BATCH) { g_nextMs = 1000; g_status = "กำลังส่งประวัติย้อนหลัง…"; }
}
//+------------------------------------------------------------------+

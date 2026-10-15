//+------------------------------------------------------------------+
//|                                            OI_Trade_Bridge.mq5   |
//|  OI Gold Pro Trade — bridge between MT5 and the hub              |
//|  - pushes account / price / positions / P&L to the hub           |
//|  - pulls commands from the app and executes them                 |
//|                                                                  |
//|  Setup: Tools > Options > Expert Advisors >                      |
//|         "Allow WebRequest for listed URL" → add the HubURL        |
//+------------------------------------------------------------------+
#property copyright "OI Gold Pro"
#property version   "0.100"

#include <Trade\Trade.mqh>

#define EA_VERSION "v0.1.00"

input string HubURL          = "https://oi-trade-hub.YOURNAME.workers.dev"; // Hub URL (no trailing /)
input string EAKey           = "";        // EA key (same as EA_KEY on the hub)
input string TradeSymbol     = "";        // Symbol to trade (empty = this chart)
input long   Magic           = 171300;    // Magic number for orders from the app
input double MaxLots         = 0.10;      // Hard cap on lots per order
input int    MaxCmdAgeMs     = 8000;      // Ignore commands older than this (ms)
input int    SlippagePoints  = 50;        // Max slippage for market orders (points)
input bool   ManageAllOnSym  = true;      // true = app can see/close every position on the symbol, false = only this Magic

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
      Alert("OI Trade Bridge: set HubURL (https://...) and EAKey in the inputs");
      return INIT_PARAMETERS_INCORRECT;
   }
   trade.SetExpertMagicNumber(Magic);
   trade.SetDeviationInPoints(SlippagePoints);
   trade.SetTypeFillingBySymbol(g_sym);
   trade.SetAsyncMode(false);
   EventSetMillisecondTimer(200);
   Print("OI Trade Bridge ", EA_VERSION, " started on ", g_sym);
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
   Comment("OI Trade Bridge ", EA_VERSION, "  |  ", g_sym, "  |  ", g_status,
           "  |  sync every ", g_nextMs / 1000.0, "s");
}

//+------------------------------------------------------------------+
//| JSON helpers                                                     |
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

//+------------------------------------------------------------------+
//| State                                                            |
//+------------------------------------------------------------------+
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
//| Hub sync                                                         |
//+------------------------------------------------------------------+
void Sync()
{
   string res = "";
   for(int i = 0; i < ArraySize(g_results); i++) res += (i ? "," : "") + g_results[i];
   string body = "{\"state\":" + BuildState() + ",\"results\":[" + res + "]}";
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
         Alert("OI Trade Bridge: add ", HubURL, " to Tools > Options > Expert Advisors > Allow WebRequest");
         g_warnedUrl = true;
      }
      g_status = "hub unreachable (" + IntegerToString(err) + ")";
      g_nextMs = 3000;
      return;
   }
   if(code == 401) { g_status = "EA key rejected"; g_nextMs = 10000; return; }
   if(code != 200) { g_status = "hub error " + IntegerToString(code); g_nextMs = 3000; return; }

   // results delivered → drop the ones we just sent (new ones may have been added meanwhile: none, single-threaded)
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
      else if(StringFind(ln, "CMD|") == 0)
         Execute(ln);
   }
}

//+------------------------------------------------------------------+
//| Command execution                                                |
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
   PrintFormat("OI Trade cmd %s → %s (%u) %s", id, ok ? "OK" : "FAIL", retcode, msg);
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

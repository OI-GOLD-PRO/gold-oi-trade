CREATE TABLE IF NOT EXISTS samples (
  ts INTEGER PRIMARY KEY,      -- epoch ms
  batt_v REAL,                 -- battery voltage (inverter, else MPPT)
  soc REAL,                    -- battery % (inverter)
  inv_chg_a REAL,              -- inverter charging current into battery
  inv_dis_a REAL,              -- inverter discharge current from battery
  mppt_a REAL,                 -- MPPT charging current into battery
  inv_pv_w REAL,               -- PV power, inverter string (8 panels)
  mppt_pv_w REAL,              -- PV power, MPPT string (4 panels)
  load_w REAL,                 -- house load
  grid_v REAL,                 -- grid voltage
  mppt_today_kwh REAL,         -- MPPT's own day counter
  inv_today_kwh REAL,          -- inverter's own day counter (SmartESS)
  mppt_temp REAL,
  err TEXT                     -- fetch errors, if any
);

CREATE TABLE IF NOT EXISTS kv (
  k TEXT PRIMARY KEY,
  v TEXT
);

-- One summary row per Thai calendar day, kept forever (JSON from summarizeDay).
CREATE TABLE IF NOT EXISTS daily (
  date TEXT PRIMARY KEY,       -- YYYY-MM-DD (Asia/Bangkok)
  data TEXT
);

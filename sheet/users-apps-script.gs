/**
 * OI Gold Pro Trade — login codes sheet ("OI Trade Users")
 * Paste into Extensions → Apps Script of a NEW Google Sheet (not the OI Gold Pro sheet).
 * The hub reads the codes through this web app; the sheet itself stays private.
 *
 * 1) Put a long random secret below (same value goes into the hub secret USERS_SECRET).
 * 2) Run setup once (creates tab "trade_users" and asks for permission).
 * 3) Deploy → New deployment → Web app → Execute as: Me, Who has access: Anyone → copy the URL
 *    (that URL goes into the hub secret USERS_URL).
 *
 * Columns: code | name | expire (yyyy-mm-dd, empty = unlimited)
 */
const SECRET = 'PUT-A-LONG-RANDOM-SECRET-HERE';
const TAB = 'trade_users';

function doGet(e) {
  const key = e && e.parameter ? e.parameter.key : '';
  if (SECRET.length < 16 || SECRET.indexOf('PUT-A-LONG') === 0 || key !== SECRET) return out_({ ok: false, error: 'auth' });
  const rows = sheet_().getDataRange().getValues().slice(1);
  const users = rows
    .filter(r => String(r[0]).trim() !== '')
    .map(r => ({ code: String(r[0]).trim(), name: String(r[1] || '').trim(), expire: fmtDate_(r[2]) }));
  return out_({ ok: true, users: users });
}

function setup() {
  sheet_();
}

function sheet_() {
  const ss = SpreadsheetApp.getActive();
  let sh = ss.getSheetByName(TAB);
  if (!sh) {
    sh = ss.insertSheet(TAB);
    sh.getRange(1, 1, 1, 3).setValues([['code', 'name', 'expire']]).setFontWeight('bold');
    sh.setFrozenRows(1);
    sh.getRange('A:A').setNumberFormat('@'); // keep codes as text (leading zeros etc.)
    sh.getRange('C2:C').setNumberFormat('yyyy-mm-dd');
    sh.getRange(2, 1, 1, 3).setValues([['ตัวอย่าง123', 'ตัวอย่าง (หมดอายุแล้ว ใช้เข้าไม่ได้)', '2000-01-01']]);
  }
  return sh;
}

function fmtDate_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, 'Asia/Bangkok', 'yyyy-MM-dd');
  const s = String(v || '').trim();
  return s || '9999-12-31';
}

function out_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

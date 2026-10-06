/**
 * RICHMAX Gravure Studio — Quote Log (Google Apps Script web app)
 * Bound to the Google Sheet "RICHMAX Gravure Studio - Quote Log".
 * Self-contained: paste this whole file into Extensions > Apps Script of that sheet.
 *
 * doPost : appends one row per saved quote (LockService + shared token, formula-escaped text),
 *          writes the header row itself if the sheet is empty, then sends a throttled email.
 * doGet  : health check (open the Web App URL in a browser -> {"ok":true,...}).
 *
 * NOTE: SHARED_TOKEN is also in the PUBLIC web page, so it is a demo-level filter
 *       against random traffic, not a real secret. Real cost data lives only in this private sheet.
 */

// ===== Settings (edit here) =====
var SHARED_TOKEN = 'richmax-gs-2026';     // must match SHEETS_TOKEN in index.html
var SHEET_NAME = '';                      // '' = first tab of this spreadsheet
var TZ = 'Asia/Bangkok';

var EMAIL_ENABLED = true;                 // master switch for notifications
var NOTIFY_EMAIL = '';                    // '' = the Google account that deployed the script (Session.getEffectiveUser())
var EMAIL_ON_AUTO = true;                 // also email for rows that came from "Auto-send"
var EMAIL_MIN_INTERVAL_SEC = 60;          // at most 1 email per 60 s (rows are always logged)
var EMAIL_DAILY_CAP = 50;                 // at most 50 emails per Bangkok day (Gmail quota is ~100/day)

// Column layout: [payload key, header, type, max length for text]
// type: 't' = text (formula-escaped), 'n' = number (else blank)
var FIELDS = [
  ['job', 'Job / Customer', 't', 120],
  ['note', 'Note', 't', 300],
  ['user', 'User', 't', 60],
  ['widthMm', 'Width W (mm)', 'n'],
  ['heightMm', 'Height H (mm)', 'n'],
  ['gussetMm', 'Gusset G (mm)', 'n'],
  ['zipper', 'Zipper', 't', 10],
  ['material', 'Film structure', 't', 80],
  ['colors', 'Colors', 'n'],
  ['lot', 'Lot (pcs)', 'n'],
  ['orientation', 'Across web', 't', 40],
  ['lanes', 'Lanes', 'n'],
  ['maxLanes', 'Max lanes', 'n'],
  ['maxWebMm', 'Max web (mm)', 'n'],
  ['edgeTrimMm', 'Edge trim (mm/side)', 'n'],
  ['gapMm', 'Gap (mm)', 'n'],
  ['speedMpm', 'Speed (m/min)', 'n'],
  ['sealMm', 'Seal (mm/side)', 'n'],
  ['adhesiveThbM2', 'Adhesive (THB/m2)', 'n'],
  ['inkThbM2Color', 'Ink (THB/m2/color)', 'n'],
  ['cylinderThbColor', 'Cylinder (THB/color)', 'n'],
  ['setupThbJob', 'Setup (THB/job)', 'n'],
  ['printThbHr', 'Printing (THB/h)', 'n'],
  ['laminationThbHr', 'Lamination (THB/h)', 'n'],
  ['bagMakingThbPc', 'Bag making (THB/pc)', 'n'],
  ['zipperThbPc', 'Zipper (THB/pc)', 'n'],
  ['electricityThbHr', 'Electricity (THB/h)', 'n'],
  ['laborThbHr', 'Labor (THB/h)', 'n'],
  ['shippingThbTrip', 'Shipping (THB/trip)', 'n'],
  ['wastePct', 'Waste %', 'n'],
  ['marginPct', 'Margin %', 'n'],
  ['blankLMm', 'Blank L (mm)', 'n'],
  ['blankWMm', 'Blank W (mm)', 'n'],
  ['areaM2', 'Area per pouch (m2)', 'n'],
  ['webWidthMm', 'Web width (mm)', 'n'],
  ['repeatMm', 'Repeat (mm)', 'n'],
  ['pcsPerMin', 'Output (pcs/min)', 'n'],
  ['pcsPerHr', 'Output (pcs/h)', 'n'],
  ['filmThbM2', 'Film cost (THB/m2)', 'n'],
  ['costPerPc', 'Cost per pouch (THB)', 'n'],
  ['pricePerPc', 'Price per pouch (THB)', 'n'],
  ['costLot', 'Total cost for lot (THB)', 'n'],
  ['priceLot', 'Total price for lot (THB)', 'n'],
  ['checks', 'Checks', 't', 300],
  ['breakdown', 'Cost breakdown (THB/pc)', 't', 1500],
  ['appVersion', 'App version', 't', 40]
];
var HEADERS = ['Timestamp (Asia/Bangkok)'].concat(FIELDS.map(function (f) { return f[1]; })).concat(['Send mode']);

// ===== Web app entry points =====
function doGet(e) {
  return json_({ ok: true, service: 'RICHMAX Gravure Studio - Quote Log', time: nowText_() });
}

function doPost(e) {
  var data;
  try {
    data = JSON.parse((e && e.postData && e.postData.contents) || '');
  } catch (err) {
    return json_({ ok: false, error: 'bad_json' });
  }
  if (!data || typeof data !== 'object' || data.token !== SHARED_TOKEN) return json_({ ok: false, error: 'bad_token' });

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return json_({ ok: false, error: 'busy' });

  var sheet, ts, rowNumber, mailDecision;
  try {
    sheet = getSheet_();
    if (sheet.getLastRow() === 0) sheet.appendRow(HEADERS);   // creates the header row on an empty sheet
    ts = nowText_();
    sheet.appendRow(buildRow_(data, ts));
    rowNumber = sheet.getLastRow();
    mailDecision = decideEmail_(data);          // throttle state is updated inside the lock
  } finally {
    lock.releaseLock();
  }

  var email = mailDecision;
  if (mailDecision === 'send') {
    try {
      sendEmail_(data, ts, sheet);
      email = 'sent';
    } catch (err) {
      email = 'error';
    }
  }
  return json_({ ok: true, row: rowNumber, email: email });
}

// ===== Helpers =====
function getSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  return (SHEET_NAME && ss.getSheetByName(SHEET_NAME)) || ss.getSheets()[0];
}

function nowText_() {
  return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm:ss');
}

// Text cells: trim, cap length, and stop spreadsheet formulas (=, +, -, @) being injected.
function txt_(v, max) {
  var s = String(v == null ? '' : v).trim().slice(0, max || 200);
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}
// Number cells: numbers only, otherwise blank.
function num_(v) {
  if (v === '' || v == null || typeof v === 'boolean') return '';
  var n = Number(v);
  return isFinite(n) ? n : '';
}

function buildRow_(d, ts) {
  var row = [ts];
  for (var i = 0; i < FIELDS.length; i++) {
    var f = FIELDS[i];
    row.push(f[2] === 'n' ? num_(d[f[0]]) : txt_(d[f[0]], f[3]));
  }
  row.push(d.mode === 'auto' ? 'auto' : 'manual');
  return row;
}

// Returns 'send' or a reason it was skipped. Rows are logged either way.
function decideEmail_(d) {
  if (!EMAIL_ENABLED) return 'disabled';
  if (d.mode === 'auto' && !EMAIL_ON_AUTO) return 'skipped_auto';
  var props = PropertiesService.getScriptProperties();
  var nowMs = new Date().getTime();
  var today = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd');
  var last = Number(props.getProperty('email_last_ms') || 0);
  var day = props.getProperty('email_day') || '';
  var count = day === today ? Number(props.getProperty('email_count') || 0) : 0;
  if (nowMs - last < EMAIL_MIN_INTERVAL_SEC * 1000) return 'throttled';
  if (count >= EMAIL_DAILY_CAP) return 'daily_cap';
  if (MailApp.getRemainingDailyQuota() < 1) return 'quota';
  props.setProperties({ email_last_ms: String(nowMs), email_day: today, email_count: String(count + 1) });
  return 'send';
}

function fmtN_(v, dp) {
  if (v === '' || v == null || !isFinite(Number(v))) return '-';
  var p = Math.pow(10, dp == null ? 3 : dp);
  var s = String(Math.round(Number(v) * p) / p).split('.');
  return s[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (s[1] ? '.' + s[1] : '');
}

function sendEmail_(d, ts, sheet) {
  var to = NOTIFY_EMAIL || Session.getEffectiveUser().getEmail();
  if (!to) throw new Error('no recipient');
  var job = txt_(d.job, 120) || 'ไม่ระบุชื่องาน';
  var size = fmtN_(d.widthMm, 1) + 'x' + fmtN_(d.heightMm, 1) + ' G' + fmtN_(d.gussetMm, 1);
  var subject = '[RICHMAX Gravure Studio] ' + job + ' - ' + size + ' ' + fmtN_(d.colors, 0) + ' สี ล็อต ' +
    fmtN_(d.lot, 0) + ': ฿' + fmtN_(d.pricePerPc) + '/ซอง - ' + ts;
  var lines = [
    'RICHMAX Gravure Studio - บันทึกใบเสนอราคาใหม่ / new quote saved',
    '',
    'เวลา / Time (Bangkok): ' + ts,
    'ชื่องาน / Job: ' + job,
    'ผู้บันทึก / User: ' + (txt_(d.user, 60) || '-'),
    'หมายเหตุ / Note: ' + (txt_(d.note, 300) || '-'),
    'วิธีส่ง / Mode: ' + (d.mode === 'auto' ? 'อัตโนมัติ / Auto-send' : 'กดบันทึกเอง / Manual'),
    '',
    '--- ค่าที่กรอก / Inputs ---',
    'ขนาดซอง: ' + size + ' มม. · ซิป: ' + (txt_(d.zipper, 10) || '-'),
    'ฟิล์ม: ' + (txt_(d.material, 80) || '-') + ' · ' + fmtN_(d.colors, 0) + ' สี',
    'ล็อต: ' + fmtN_(d.lot, 0) + ' ซอง · ' + fmtN_(d.lanes, 0) + ' เลน · ' + (txt_(d.orientation, 40) || '-'),
    'Waste ' + fmtN_(d.wastePct, 2) + '% · Margin ' + fmtN_(d.marginPct, 2) + '%',
    '',
    '--- ผลการคำนวณ / Results ---',
    'แผ่นคลี่: ' + fmtN_(d.blankLMm, 1) + ' x ' + fmtN_(d.blankWMm, 1) + ' มม. · พื้นที่ ' + fmtN_(d.areaM2, 4) + ' m2',
    'หน้ากว้างม้วน: ' + fmtN_(d.webWidthMm, 1) + ' มม. · repeat ' + fmtN_(d.repeatMm, 1) + ' มม.',
    'กำลังผลิต: ' + fmtN_(d.pcsPerMin, 0) + ' ซอง/นาที',
    'ต้นทุน/ซอง: ฿' + fmtN_(d.costPerPc) + ' · ราคาขาย/ซอง: ฿' + fmtN_(d.pricePerPc),
    'ต้นทุนทั้งล็อต: ฿' + fmtN_(d.costLot, 2) + ' · ราคาขายทั้งล็อต: ฿' + fmtN_(d.priceLot, 2),
    'เช็คงาน: ' + (txt_(d.checks, 300) || '-'),
    '',
    'ราคาประมาณการ ไม่ใช่ใบเสนอราคาผูกมัด / Estimate only.',
    '',
    'เปิดชีต / Open the Sheet: ' + sheet.getParent().getUrl()
  ];
  MailApp.sendEmail({ to: to, subject: subject, body: lines.join('\n'), name: 'RICHMAX Gravure Studio' });
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

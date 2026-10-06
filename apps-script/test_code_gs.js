// Offline harness for Code.gs: mocks SpreadsheetApp, LockService, MailApp, Session,
// PropertiesService, Utilities, ContentService and a controllable clock.
const fs = require("fs"), vm = require("vm");
const src = fs.readFileSync(__dirname + "/Code.gs", "utf8");
let pass = 0, fail = 0;
function ok(name, cond, extra){ cond ? pass++ : fail++; console.log(`${cond ? "PASS" : "FAIL"}  ${name}${extra !== undefined ? "  -> " + extra : ""}`); }

function makeEnv(opts = {}){
  let nowMs = Date.parse("2026-10-06T15:30:00Z"); // 22:30 Bangkok
  const RealDate = Date;
  class FakeDate extends RealDate { constructor(...a){ a.length ? super(...a) : super(nowMs); } static now(){ return nowMs; } }
  const rows = (opts.preRows || []).slice(), mails = [], props = {}, lockLog = [];
  const sheet = { appendRow: r => rows.push(r), getLastRow: () => rows.length, getParent: () => ({ getUrl: () => "https://docs.google.com/spreadsheets/d/TEST/edit" }) };
  const ctx = {
    Date: FakeDate, JSON, Math, String, Number, isFinite, Error,
    SpreadsheetApp: { getActiveSpreadsheet: () => ({ getSheets: () => [sheet], getSheetByName: () => null }) },
    LockService: { getScriptLock: () => ({ tryLock: ms => { lockLog.push("lock"); return !opts.lockFails; }, releaseLock: () => lockLog.push("release") }) },
    MailApp: { sendEmail: m => { if (opts.mailThrows) throw new Error("x"); mails.push(m); }, getRemainingDailyQuota: () => opts.quota ?? 100 },
    Session: { getEffectiveUser: () => ({ getEmail: () => "phiistphisit@gmail.com" }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => (k in props ? props[k] : null), setProperties: o => Object.assign(props, o) }) },
    Utilities: { formatDate: (d, tz, f) => {
      const p = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: tz, year:"numeric", month:"2-digit", day:"2-digit", hour:"2-digit", minute:"2-digit", second:"2-digit", hour12:false }).formatToParts(d).map(x => [x.type, x.value]));
      return f.replace("yyyy", p.year).replace("MM", p.month).replace("dd", p.day).replace("HH", p.hour).replace("mm", p.minute).replace("ss", p.second); } },
    ContentService: { MimeType: { JSON: "json" }, createTextOutput: t => ({ text: t, setMimeType(){ return this; } }) }
  };
  vm.createContext(ctx); vm.runInContext(src, ctx);
  if (opts.setup) opts.setup(ctx);
  return { ctx, rows, mails, props, lockLog, tick: s => { nowMs += s * 1000; },
    post: body => JSON.parse(ctx.doPost({ postData: { contents: typeof body === "string" ? body : JSON.stringify(body) } }).text) };
}
// Payload shaped exactly like the page sends for the default job (values from the live app defaults).
const quote = { token: "richmax-gs-2026", clientTs: "2026-10-06 22:29:58", job: "ซองกาแฟ ABC", note: "รอบ 2", user: "นิด", mode: "manual",
  widthMm: 160, heightMm: 240, gussetMm: 40, zipper: "มี", material: "PET12 / LLDPE90", colors: 5, lot: 10000,
  orientation: "กว้างซองขวาง (Width across)", lanes: 7, maxLanes: 7, maxWebMm: 1200, edgeTrimMm: 5, gapMm: 3, speedMpm: 140, sealMm: 10,
  adhesiveThbM2: 0.336, inkThbM2Color: 0.59, cylinderThbColor: 3500, setupThbJob: 2500, printThbHr: 1200, laminationThbHr: 900,
  bagMakingThbPc: 0.12, zipperThbPc: 0.15, electricityThbHr: 85, laborThbHr: 180, shippingThbTrip: 2000, wastePct: 5, marginPct: 25,
  blankLMm: 560, blankWMm: 160, areaM2: 0.0896, webWidthMm: 1148, repeatMm: 560, pcsPerMin: 1750, pcsPerHr: 105000,
  filmThbM2: 7.0584, costPerPc: 3.7062, pricePerPc: 4.6328, costLot: 37062.4, priceLot: 46328, checks: "ผ่าน",
  breakdown: "ฟิล์ม PET 12µm: 0.1344; หมึกพิมพ์ × 5 สี: 0.2775", appVersion: "test" };

// 1. health check
let E = makeEnv();
let g = JSON.parse(E.ctx.doGet({}).text);
ok("doGet health check", g.ok === true && g.service === "RICHMAX Gravure Studio - Quote Log" && g.time === "2026-10-06 22:30:00", JSON.stringify(g));
// 2. bad token / bad json / converter token
ok("bad token rejected, no row", E.post({ ...quote, token: "nope" }).error === "bad_token" && E.rows.length === 0);
ok("converter token (richmax-demo-2026) rejected", E.post({ ...quote, token: "richmax-demo-2026" }).error === "bad_token" && E.rows.length === 0);
ok("bad JSON rejected, no row", E.post("{not json").error === "bad_json" && E.rows.length === 0);
ok("JSON null rejected", E.post("null").error === "bad_token" && E.rows.length === 0);
ok("missing postData rejected", JSON.parse(E.ctx.doPost({}).text).error === "bad_json");
ok("no lock taken for rejected posts", E.lockLog.length === 0);
// 3. first valid row on EMPTY sheet: header created + row
let res = E.post(quote);
const H = E.ctx.HEADERS, R = E.rows[1] || [];
const col = name => R[H.indexOf(name)];
ok("valid post ok, row 2", res.ok === true && res.row === 2, JSON.stringify(res));
ok("header row auto-created on empty sheet", JSON.stringify(E.rows[0]) === JSON.stringify(H));
ok("header = Timestamp + 46 fields + Send mode (48 cols)", H.length === 48 && H[0] === "Timestamp (Asia/Bangkok)" && H[47] === "Send mode", H.length);
ok("row length matches header", R.length === H.length, R.length);
ok("row timestamp is server Bangkok time", R[0] === "2026-10-06 22:30:00", R[0]);
ok("text columns", col("Job / Customer") === "ซองกาแฟ ABC" && col("Note") === "รอบ 2" && col("User") === "นิด" && col("Film structure") === "PET12 / LLDPE90" && col("Zipper") === "มี");
ok("input columns", col("Width W (mm)") === 160 && col("Height H (mm)") === 240 && col("Gusset G (mm)") === 40 && col("Colors") === 5 && col("Lot (pcs)") === 10000 && col("Lanes") === 7 && col("Margin %") === 25 && col("Cylinder (THB/color)") === 3500);
ok("output columns", col("Blank L (mm)") === 560 && col("Area per pouch (m2)") === 0.0896 && col("Web width (mm)") === 1148 && col("Cost per pouch (THB)") === 3.7062 && col("Price per pouch (THB)") === 4.6328 && col("Total price for lot (THB)") === 46328);
ok("send mode manual", R[47] === "manual");
ok("every payload key in FIELDS lands in its column", E.ctx.FIELDS.every((f, i) => f[0] in quote && R[i + 1] !== ""), E.ctx.FIELDS.filter((f, i) => R[i + 1] === "").map(f => f[0]).join(","));
ok("lock acquired and released", E.lockLog.join(",") === "lock,release", E.lockLog.join(","));
// 4. email
ok("email sent to deployer", res.email === "sent" && E.mails.length === 1 && E.mails[0].to === "phiistphisit@gmail.com");
ok("email subject format", E.mails[0].subject === "[RICHMAX Gravure Studio] ซองกาแฟ ABC - 160x240 G40 5 สี ล็อต 10,000: ฿4.633/ซอง - 2026-10-06 22:30:00", E.mails[0].subject);
ok("email body has job/user/note/price/link", ["ชื่องาน / Job: ซองกาแฟ ABC", "ผู้บันทึก / User: นิด", "หมายเหตุ / Note: รอบ 2", "ราคาขาย/ซอง: ฿4.633", "ราคาขายทั้งล็อต: ฿46,328", "https://docs.google.com/spreadsheets/d/TEST/edit"].every(s => E.mails[0].body.includes(s)), E.mails[0].body);
// 5. throttle
E.tick(10); res = E.post({ ...quote, mode: "auto" });
ok("2nd post within 60 s: row logged (auto), email throttled", res.ok && E.rows.length === 3 && E.rows[2][47] === "auto" && res.email === "throttled" && E.mails.length === 1, JSON.stringify(res));
ok("header not duplicated on later posts", E.rows.filter(r => r[0] === "Timestamp (Asia/Bangkok)").length === 1);
E.tick(55); res = E.post(quote);
ok("post after 65 s: email sent again", res.email === "sent" && E.mails.length === 2, JSON.stringify(res));
// 6. formula injection + bad types + caps
E = makeEnv();
res = E.post({ ...quote, job: "=HYPERLINK(\"http://x\")", note: "+1+1", user: "@me", checks: "-cmd", widthMm: "abc", lot: true, colors: "7", breakdown: "x".repeat(5000), mode: "weird" });
let r = E.rows[1], h = E.ctx.HEADERS;
ok("formula-like text escaped with leading '", r[h.indexOf("Job / Customer")] === "'=HYPERLINK(\"http://x\")" && r[h.indexOf("Note")] === "'+1+1" && r[h.indexOf("User")] === "'@me" && r[h.indexOf("Checks")] === "'-cmd");
ok("non-numeric number -> blank; boolean -> blank; numeric string -> number", r[h.indexOf("Width W (mm)")] === "" && r[h.indexOf("Lot (pcs)")] === "" && r[h.indexOf("Colors")] === 7);
ok("long text capped (breakdown 1500)", r[h.indexOf("Cost breakdown (THB/pc)")].length === 1500);
ok("unknown mode -> manual", r[47] === "manual");
ok("missing fields -> blank cells, still ok", (() => { const E2 = makeEnv(); const x = E2.post({ token: "richmax-gs-2026" }); return x.ok && E2.rows[1].length === 48 && E2.rows[1].slice(1, 47).every(v => v === ""); })());
// 7. existing header row (sheet created from CSV) -> no second header
E = makeEnv({ preRows: [ makeEnv().ctx.HEADERS ] });
res = E.post(quote);
ok("sheet that already has header: row appended at 2, no extra header", res.row === 2 && E.rows.length === 2);
// 8. lock busy
E = makeEnv({ lockFails: true });
ok("lock busy -> error busy, no row", E.post(quote).error === "busy" && E.rows.length === 0);
// 9. mail failure / quota / daily cap / disabled / auto off / NOTIFY_EMAIL
E = makeEnv({ mailThrows: true }); res = E.post(quote);
ok("mail throws -> row still logged, email:error", res.ok && E.rows.length === 2 && res.email === "error", JSON.stringify(res));
E = makeEnv({ quota: 0 }); res = E.post(quote);
ok("no MailApp quota -> email:quota, row logged", res.ok && res.email === "quota" && E.rows.length === 2);
E = makeEnv(); E.props.email_day = "2026-10-06"; E.props.email_count = "50"; res = E.post(quote);
ok("daily cap 50 reached -> email:daily_cap", res.email === "daily_cap");
E = makeEnv(); E.props.email_day = "2026-10-05"; E.props.email_count = "50"; res = E.post(quote);
ok("cap resets on a new Bangkok day", res.email === "sent" && E.props.email_count === "1");
E = makeEnv({ setup: c => vm.runInContext("EMAIL_ENABLED = false", c) }); res = E.post(quote);
ok("EMAIL_ENABLED=false -> disabled, row logged", res.email === "disabled" && E.rows.length === 2);
E = makeEnv({ setup: c => vm.runInContext("EMAIL_ON_AUTO = false", c) }); res = E.post({ ...quote, mode: "auto" });
ok("EMAIL_ON_AUTO=false + auto row -> skipped_auto", res.email === "skipped_auto");
E = makeEnv({ setup: c => vm.runInContext("NOTIFY_EMAIL = 'boss@example.com'", c) }); res = E.post(quote);
ok("NOTIFY_EMAIL overrides recipient", E.mails[0].to === "boss@example.com");
E = makeEnv(); res = E.post({ ...quote, job: "" });
ok("empty job -> subject says ไม่ระบุชื่องาน", E.mails[0].subject.startsWith("[RICHMAX Gravure Studio] ไม่ระบุชื่องาน - "), E.mails[0].subject);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

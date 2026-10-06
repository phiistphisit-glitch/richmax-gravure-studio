// Headless UI test of the "บันทึกลง Google Sheet" section against tests/mock_server.py (records POSTs).
// Usage: python3 tests/mock_server.py <dir containing gravure-studio-repo> 8766 &  node tests/ui_test.js [pageUrl]
const { chromium } = require("/tmp/pwtest/node_modules/playwright-core");
const fs = require("fs"), vm = require("vm"), path = require("path");
const SRV = "http://127.0.0.1:8766";
const BASE = process.argv[2] || SRV + "/gravure-studio-repo/index.html";
const SHOTS = "/workspace/richmax/gravure-studio-shots";
const MOCK = SRV + "/exec";
let pass = 0, fail = 0;
const ok = (n, c, x) => { c ? pass++ : fail++; console.log(`${c ? "PASS" : "FAIL"}  ${n}${x !== undefined ? "  -> " + x : ""}`); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
// Load Code.gs FIELDS to check the page payload matches the sheet columns.
const gsCtx = {}; vm.createContext(gsCtx); vm.runInContext(fs.readFileSync(path.join(__dirname, "../apps-script/Code.gs"), "utf8"), gsCtx);
const FIELD_KEYS = gsCtx.FIELDS.map(f => f[0]);
(async () => {
  const browser = await chromium.launch({ executablePath: "/usr/bin/google-chrome", args: ["--no-sandbox", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = []; page.on("pageerror", e => errors.push(String(e))); page.on("console", m => { if (m.type() === "error") errors.push(m.text()); });
  const posts = async () => (await (await fetch(SRV + "/__posts")).json()).map(p => ({ ...p, json: JSON.parse(p.body) }));
  await fetch(SRV + "/__reset");
  const status = () => page.textContent("#gsStatus");
  const setVal = (id, v) => page.evaluate(([id, v]) => { const el = document.getElementById(id); el.value = v; el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true })); }, [id, v]);
  const state = () => page.evaluate(() => { const s = window.__richmax.snapshot().state; return { W: s.W, price: s.pricePerPc, cost: s.costPerPc }; });

  // ---- A: not connected ----
  await page.goto(BASE); await page.evaluate(() => localStorage.clear()); await page.reload(); await page.waitForFunction(() => window.__rgsSheets);
  ok("A1 app still computes default price ฿4.633", (await page.textContent("#rPrice")) === "฿4.633", await page.textContent("#rPrice"));
  ok("A2 status 'ยังไม่ได้เชื่อมต่อ'", (await status()).includes("ยังไม่ได้เชื่อมต่อ"), await status());
  ok("A3 preview shows the job and price", (await page.textContent("#gsPreview")).includes("160×240 G40") && (await page.textContent("#gsPreview")).includes("฿4.633"), await page.textContent("#gsPreview"));
  ok("A4 settings text says no link yet", (await page.textContent("#gsUrlSrc")).includes("ยังไม่มีลิงก์"));
  await page.evaluate(() => document.getElementById("gsSave").scrollIntoView());
  await page.screenshot({ path: SHOTS + "/desktop_not_connected.png" });
  await page.click("#gsSaveBtn"); await page.check("#gsAuto"); await setVal("w", 200); await sleep(2600);
  ok("A5 Save + auto with no URL: no POSTs", (await posts()).length === 0, (await posts()).length);
  ok("A6 calculation still updates (W=200 -> price changes, matches state)", (await page.textContent("#rPrice")) !== "฿4.633" && (await state()).W === 200, await page.textContent("#rPrice"));
  await page.uncheck("#gsAuto"); await setVal("w", 160); await setVal("lanes", 7); // W=200 clamps lanes to 5 (original app behaviour), so restore 7

  // ---- B: manual save to mock ----
  await page.click("#gsSettings summary"); await page.fill("#gsUrl", MOCK);
  ok("B1 status 'พร้อมส่ง' after URL set", (await status()).includes("พร้อมส่ง"), await status());
  ok("B2 settings text says device URL", (await page.textContent("#gsUrlSrc")).includes("เครื่องนี้"));
  await page.fill("#gsJob", "ซองกาแฟ ABC"); await page.fill("#gsNote", "เสนอรอบ 2"); await page.fill("#gsUser", "นิด");
  await page.click("#gsSaveBtn"); await sleep(700);
  let P = await posts();
  ok("B3 manual Save -> exactly 1 POST to /exec", P.length === 1 && P[0].path === "/exec", P.length);
  const b = P[0]?.json || {};
  ok("B4 text/plain body with token richmax-gs-2026", (P[0]?.ctype || "").startsWith("text/plain") && b.token === "richmax-gs-2026", P[0]?.ctype);
  ok("B5 job/note/user/mode/clientTs", b.job === "ซองกาแฟ ABC" && b.note === "เสนอรอบ 2" && b.user === "นิด" && b.mode === "manual" && /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(b.clientTs), JSON.stringify([b.job, b.note, b.user, b.mode, b.clientTs]));
  const s0 = await state();
  ok("B6 inputs", b.widthMm === 160 && b.heightMm === 240 && b.gussetMm === 40 && b.zipper === "มี" && b.material === "PET12 / LLDPE90" && b.colors === 5 && b.lot === 10000 && b.lanes === 7 && b.maxWebMm === 1200 && b.edgeTrimMm === 5 && b.gapMm === 3 && b.speedMpm === 140 && b.sealMm === 10 && b.cylinderThbColor === 3500 && b.marginPct === 25 && b.wastePct === 5 && b.orientation === "กว้างซองขวาง (Width across)", JSON.stringify(b));
  ok("B7 outputs equal the app's own numbers", b.blankLMm === 560 && b.blankWMm === 160 && b.areaM2 === 0.0896 && b.webWidthMm === 1148 && b.repeatMm === 560 && b.pricePerPc === +s0.price.toFixed(4) && b.costPerPc === +s0.cost.toFixed(4) && b.priceLot === +(s0.price * 10000).toFixed(2) && b.checks === "ผ่าน", `${b.pricePerPc} vs ${s0.price}`);
  ok("B8 breakdown lists every cost line", (b.breakdown.match(/;/g) || []).length === (await page.$$eval("#costLines .cost-line", x => x.length)) - 1 && b.breakdown.includes("ฟิล์ม PET 12µm"), b.breakdown.slice(0, 80));
  const keys = Object.keys(b).filter(k => !["token", "clientTs", "mode"].includes(k));
  ok("B9 payload keys == Code.gs FIELDS keys (no missing, no extra)", keys.length === FIELD_KEYS.length && FIELD_KEYS.every(k => k in b), JSON.stringify(FIELD_KEYS.filter(k => !(k in b)).concat(keys.filter(k => !FIELD_KEYS.includes(k)))));
  // Feed the real captured payload through Code.gs (mocked Sheets) to prove the row lines up.
  const rows = []; const sh = { appendRow: r => rows.push(r), getLastRow: () => rows.length, getParent: () => ({ getUrl: () => "x" }) };
  Object.assign(gsCtx, { SpreadsheetApp: { getActiveSpreadsheet: () => ({ getSheets: () => [sh] }) }, LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }) },
    Utilities: { formatDate: () => "2026-10-06 23:00:00" }, ContentService: { MimeType: {}, createTextOutput: t => ({ text: t, setMimeType() { return this; } }) } });
  vm.runInContext("EMAIL_ENABLED = false", gsCtx);
  const gsRes = JSON.parse(gsCtx.doPost({ postData: { contents: P[0].body } }).text);
  const H = gsCtx.HEADERS, R = rows[1] || [];
  ok("B10 Code.gs accepts the page payload and fills all 48 columns", gsRes.ok && R.length === 48 && R.every((v, i) => v !== "" || H[i] === "Note") && R[H.indexOf("Price per pouch (THB)")] === b.pricePerPc && R[H.indexOf("Job / Customer")] === "ซองกาแฟ ABC", JSON.stringify(gsRes));
  ok("B11 status 'ส่งแล้ว'", (await status()).includes("ส่งแล้ว"), await status());
  ok("B12 name remembered in localStorage", (await page.evaluate(() => localStorage.getItem("rgs.user"))) === "นิด");
  await page.evaluate(() => document.getElementById("gsSave").scrollIntoView());
  await page.screenshot({ path: SHOTS + "/desktop_sent.png" });
  await page.screenshot({ path: SHOTS + "/desktop_full_app.png" });

  // ---- C: auto-send ----
  await page.check("#gsAuto"); await sleep(2500);
  ok("C1 enabling auto on already-sent values sends nothing (dedupe)", (await posts()).length === 1, (await posts()).length);
  await setVal("w", 165); await sleep(300); await setVal("w", 170); await sleep(700);
  ok("C2 1 s after edits: nothing sent yet, status waiting", (await posts()).length === 1 && (await status()).includes("จะส่งใน"), await status());
  await page.evaluate(() => document.getElementById("gsSave").scrollIntoView());
  await page.screenshot({ path: SHOTS + "/desktop_auto_waiting.png" });
  await sleep(1700); P = await posts();
  ok("C3 ~2 s stable -> exactly 1 auto POST with final W=170", P.length === 2 && P[1].json.widthMm === 170 && P[1].json.mode === "auto", JSON.stringify(P.slice(1).map(p => [p.json.widthMm, p.json.mode])));
  for (const w of [175, 180, 185, 190, 195, 200, 205, 210]) { await setVal("w", w); await sleep(450); }
  ok("C4 continuous edits for 3.6 s -> no intermediate sends", (await posts()).length === 2, (await posts()).length);
  await sleep(2500); P = await posts();
  ok("C5 then one send with final W=210", P.length === 3 && P[2].json.widthMm === 210, P.length);
  await setVal("w", 215); await sleep(500); await setVal("w", 210); await sleep(2700);
  ok("C6 change+revert within 2 s -> no duplicate send", (await posts()).length === 3, (await posts()).length);
  await page.fill("#gsJob", "งานใหม่"); await page.fill("#gsNote", "x"); await sleep(2500);
  ok("C7 editing job/note alone does not auto-send", (await posts()).length === 3);
  await page.click("#orientL"); await sleep(2700); P = await posts();
  ok("C8 orientation toggle -> auto send with new orientation", P.length === 4 && P[3].json.orientation === "ยาวแผ่นคลี่ขวาง (Blank L across)" && P[3].json.job === "งานใหม่", P.length);
  await setVal("costCyl", 4200); await sleep(2700); P = await posts();
  ok("C9 cost edit -> auto send with new cylinder cost and higher price", P.length === 5 && P[4].json.cylinderThbColor === 4200 && P[4].json.pricePerPc > P[3].json.pricePerPc, P.length);
  await page.evaluate(() => { const z = document.getElementById("zipper"); z.click(); }); await sleep(2700); P = await posts();
  ok("C10 zipper off -> auto send zipper 'ไม่มี'", P.length === 6 && P[5].json.zipper === "ไม่มี", P.length);
  await page.click("#btnNew"); await sleep(2700); P = await posts();
  ok("C11 '+ งานใหม่' -> auto send of reset job (W=160, width across)", P.length === 7 && P[6].json.widthMm === 160 && P[6].json.orientation.startsWith("กว้างซองขวาง"), P.length);
  await page.uncheck("#gsAuto"); await setVal("w", 220); await sleep(2700);
  ok("C12 auto off -> edits send nothing", (await posts()).length === 7);
  ok("C13 auto toggle remembered", (await page.evaluate(() => localStorage.getItem("rgs.autoSend"))) === null);

  // ---- D: failure + clear ----
  await page.fill("#gsUrl", "https://127.0.0.1:9/exec"); await page.click("#gsSaveBtn"); await sleep(1500);
  ok("D1 unreachable endpoint -> 'ส่งไม่สำเร็จ'", (await status()).includes("ส่งไม่สำเร็จ"), await status());
  await page.evaluate(() => document.getElementById("gsSave").scrollIntoView());
  await page.screenshot({ path: SHOTS + "/desktop_failed.png" });
  await page.click("#gsUrlClear");
  ok("D2 clear -> back to not connected, localStorage cleared", (await status()).includes("ยังไม่ได้เชื่อมต่อ") && (await page.evaluate(() => localStorage.getItem("rgs.webAppUrl"))) === null);
  await page.fill("#gsUrl", "javascript:alert(1)");
  ok("D3 non-http(s) URL is not saved", (await page.evaluate(() => localStorage.getItem("rgs.webAppUrl"))) === null && (await status()).includes("ยังไม่ได้เชื่อมต่อ"));

  // ---- E: mobile ----
  const m = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  m.on("pageerror", e => errors.push("mobile: " + e));
  await m.goto(BASE); await m.waitForFunction(() => window.__rgsSheets); await sleep(800);
  ok("E1 mobile: floating 'บันทึกลง Sheet' button visible", await m.isVisible("#gsFab"));
  await m.screenshot({ path: SHOTS + "/mobile_fab.png" });
  await m.click("#gsFab"); await sleep(300);
  const box = await m.$eval("#gsSaveBtn", e => e.getBoundingClientRect().toJSON());
  ok("E2 mobile: tapping it opens the save panel, Save button on screen", box.top >= 0 && box.bottom <= 844 && box.left >= 0 && box.right <= 390, JSON.stringify(box));
  await m.screenshot({ path: SHOTS + "/mobile_panel_open.png" });
  await m.click("#gsClose"); await sleep(200);
  ok("E3 mobile: close button hides the panel", !(await m.$eval("#gsSave", e => e.classList.contains("gs-open"))));
  const d = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await d.goto(BASE); await d.waitForFunction(() => window.__rgsSheets);
  ok("E4 desktop: no floating button (section is in the right panel)", !(await d.isVisible("#gsFab")) && (await d.isVisible("#gsSaveBtn")));

  const ignorable = errors.filter(e => !/ERR_CONNECTION_REFUSED|ERR_SSL|Failed to load resource|Failed to fetch/i.test(e));
  ok("F no page/console errors (excluding the intentional refused connection)", ignorable.length === 0, JSON.stringify(ignorable));
  console.log(`\n${pass} passed, ${fail} failed`);
  await browser.close(); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });

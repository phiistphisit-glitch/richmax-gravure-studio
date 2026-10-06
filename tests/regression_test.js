// Compares every visible calculation output of the ORIGINAL app (baseline file) vs the CURRENT index.html
// across many input scenarios. Usage: node tests/regression_test.js <baselineUrl> <currentUrl>
const { chromium } = require("/tmp/pwtest/node_modules/playwright-core");
const [BASE, CUR] = process.argv.slice(2);
const SCEN = [
  {},
  { w: 200, h: 300, g: 60 },
  { w: 80, h: 100, g: 20, colors: 1, lot: 1000 },
  { w: 300, h: 400, g: 100, colors: 8, lot: 500000 },
  { material: "pet_cpp", zipper: false },
  { material: "ny_lldpe", colors: 3, lot: 25000 },
  { orient: "L" },
  { orient: "L", w: 120, h: 180, g: 30, maxWeb: 1600 },
  { lanes: 20 },                      // clamped to max lanes
  { lanes: 3, edgeTrim: 15, speed: 200, seal: 14 },
  { maxWeb: 600, lanes: 7 },
  { costAdh: 0.5, costInk: 0.8, costCyl: 5000, costSetup: 3000, costPrintHr: 1500, costLamHr: 1000, costBag: 0.2, costZip: 0.3, costElec: 100, costLabor: 220, costShip: 3500, waste: 8, margin: 35 },
  { costInk: "", margin: "", waste: "" }, // empty boxes -> app fallbacks
  { margin: 0, waste: 0 },
  { lot: 1 },
  { newJob: true, w: 250 },           // edit then press "+ งานใหม่"
];
const OUT = ["hdrSub","rBlank","rArea","rLay","rWeb","rOut","rPrice","rCostHint","rCostTotal","rSellTotal","laneHint","checkBadge","checkList","costLines","lanes","costFilm","thumbSvg","layoutSvg"];
async function run(browser, url, sc) {
  const p = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errs = []; p.on("pageerror", e => errs.push(String(e)));
  await p.goto(url); await p.waitForFunction(() => window.__richmax);
  await p.evaluate(async (sc) => {
    const $ = id => document.getElementById(id);
    const fire = el => { el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true })); };
    if (sc.orient === "L") $("orientL").click();
    for (const [k, v] of Object.entries(sc)) {
      if (k === "orient" || k === "newJob") continue;
      const el = $(k);
      if (el.type === "checkbox") el.checked = v; else el.value = v;
      fire(el);
    }
    if (sc.newJob) $("btnNew").click();
    await new Promise(r => setTimeout(r, 50));
  }, sc);
  const out = await p.evaluate((ids) => Object.fromEntries(ids.map(id => {
    const el = document.getElementById(id);
    return [id, el.tagName === "INPUT" ? el.value : (el.tagName.toLowerCase() === "svg" ? el.innerHTML : el.textContent + "|" + el.className)];
  })), OUT);
  const st = await p.evaluate(() => { const s = window.__richmax.getState(); return JSON.stringify({ ...s, mat: s.mat.label }); });
  await p.close();
  return { out, st, errs };
}
(async () => {
  const b = await chromium.launch({ executablePath: "/usr/bin/google-chrome", args: ["--no-sandbox", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
  let pass = 0, fail = 0;
  for (const [i, sc] of SCEN.entries()) {
    const A = await run(b, BASE, sc), B = await run(b, CUR, sc);
    const diffs = Object.keys(A.out).filter(k => A.out[k] !== B.out[k]);
    const same = diffs.length === 0 && A.st === B.st && !A.errs.length && !B.errs.length;
    same ? pass++ : fail++;
    console.log(`${same ? "PASS" : "FAIL"}  scenario ${i + 1} ${JSON.stringify(sc)}  price ${B.out.rPrice.split("|")[0]}${same ? "" : "  diffs=" + diffs.join(",") + (A.st !== B.st ? " state" : "") + JSON.stringify(A.errs.concat(B.errs))}`);
  }
  console.log(`\n${pass} passed, ${fail} failed (each scenario compares ${OUT.length} outputs incl. SVG layouts + full computed state)`);
  await b.close(); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });

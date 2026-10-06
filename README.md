# RICHMAX Gravure Studio

3D pricing prototype for RICHMAX INTERPRINT stand-up pouches (single-page web app).

Open `index.html` in a browser to use it.

## Google Sheet quote log
- Right panel → **บันทึกลง Google Sheet** (on phones: red floating button "บันทึกลง Sheet"): job/customer, note, user (remembered), **บันทึกลง Sheet** button, optional auto-send (after inputs are stable 2 s, never repeats the last row sent), status pill.
- Each row: Bangkok timestamp, job, note, user, all inputs (size, film, colors, lot, layout, every cost rate, waste, margin) and outputs (blank, area, web width, repeat, output, cost/price per pouch and per lot, checks, cost breakdown), send mode.
- Backend: [`apps-script/Code.gs`](apps-script/Code.gs) bound to the private sheet (doPost + LockService + shared token + formula escaping, creates the header row if empty, throttled email; doGet health check). Setup guide (Thai): [`SETUP_GOOGLE_SHEET_TH.md`](SETUP_GOOGLE_SHEET_TH.md).
- Web App URL = `SHEETS_WEBAPP_URL` near the top of `index.html` (empty = not connected); in-app settings override it per device (localStorage).
- This repo is public: real cost data goes only to the private Google Sheet, never into the repo. `SHEETS_TOKEN` is a demo-level filter, not a secret.
- Tests: `node apps-script/test_code_gs.js`; `python3 tests/mock_server.py <dir> 8766 &` then `node tests/ui_test.js` and `node tests/regression_test.js <baseline url> <current url>` (headless Chrome).

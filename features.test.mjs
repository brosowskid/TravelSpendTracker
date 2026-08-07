/* Feature regression test (v26+): refunds, move-to-trip, undo delete,
   merge import, backup reminder, per-expense country + filter. */
import { chromium } from "playwright";
import { spawn } from "child_process";
import { existsSync } from "fs";

const server = spawn("python", ["-m", "http.server", "8140"], { stdio: "ignore" });
await new Promise(r => setTimeout(r, 900));
const opts = {};
const cloudChrome = "/opt/pw-browsers/chromium-1140/chrome-linux/chrome";
if (existsSync(cloudChrome)) opts.executablePath = cloudChrome;
const browser = await chromium.launch(opts);
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
/* deterministic: no live rates — a late-arriving rate refresh would fire the
   one-time upgrade toast and wipe the undo toast under test */
await page.route("**/open.er-api.com/**", r => r.abort());
let errors = [];
page.on("pageerror", e => errors.push(e.message));
await page.goto("http://localhost:8140/index.html");
await page.waitForTimeout(500);

let pass = 0, fail = 0;
const check = (name, ok, extra) => {
  if (ok) { pass++; console.log("  ok  " + name); }
  else { fail++; console.log("  FAIL " + name + (extra ? " — " + JSON.stringify(extra) : "")); }
};

/* 0. fresh install: welcome screen must reach the settings (backup restore) */
check("Welcome hat ⚙️", (await page.locator('.topbar [aria-label="Einstellungen"]').count()) === 1);
const freshMore = await page.evaluate(() => { openSettings(); return { view: state.ui.view, hasRestore: document.body.innerHTML.includes("Backup wiederherstellen") }; });
check("Einstellungen ohne Reisen erreichbar", freshMore.view === "more" && freshMore.hasRestore, freshMore);
await page.evaluate(() => goBack());

/* seed: multi-country trip + second trip */
await page.evaluate(() => {
  const now = new Date().toISOString();
  const old = new Date(Date.now() - 20 * 864e5).toISOString();
  state.trips = [
    { id: "tA", name: "Mexiko–Guatemala", budget: 2000, startDate: "2026-07-20", endDate: null,
      country: "Mexiko", currency: "MXN",
      countries: [{ name: "Mexiko", cur: "MXN" }, { name: "Guatemala", cur: "GTQ" }],
      travelers: ["Ich"], createdAt: old, expenses: [
        { id: "e1", ts: old, date: "2026-07-21", amount: 450, currency: "MXN", amountHome: 22.5, rate: 0.05, rateSource: "live", category: "essen", note: "Tacos", payer: "Ich", country: "Mexiko" },
        { id: "e2", ts: now, date: "2026-08-01", amount: 80, currency: "GTQ", amountHome: 9.6, rate: 0.12, rateSource: "live", category: "supermarkt", note: "Wasser", payer: "Ich", country: "Guatemala" },
      ] },
    { id: "tB", name: "Malta 2025", budget: 0, startDate: "2025-05-23", endDate: "2025-05-26",
      country: "Malta", currency: "EUR", countries: [{ name: "Malta", cur: "EUR" }],
      travelers: ["Ich"], createdAt: old, expenses: [] },
  ];
  state.activeTripId = "tA";
  state.lastBackupAt = null; state.backupSnoozedUntil = null;
  saveState(); go("home");
});
await page.waitForTimeout(200);

/* 1. backup reminder: no backup ever + oldest entry 20 days old -> due */
check("Backup-Erinnerung sichtbar", await page.evaluate(() => backupDue()) === true);
check("Backup-Karte im DOM", (await page.locator("text=Noch kein Backup erstellt.").count()) === 1);
await page.evaluate(() => snoozeBackup());
check("Später = 7 Tage Ruhe", await page.evaluate(() => backupDue()) === false);
await page.evaluate(() => { state.backupSnoozedUntil = null; state.lastBackupAt = new Date().toISOString(); saveState(); render(); });
check("frisches Backup = keine Erinnerung", await page.evaluate(() => backupDue()) === false);

/* 2. Nach-Land card on home */
check("Nach-Land-Karte", (await page.locator("text=Nach Land").count()) >= 1);

/* 3. refund entry via UI */
await page.evaluate(() => startAdd());
await page.waitForTimeout(150);
check("Erstattung-Chip da", (await page.locator("text=Erstattung").count()) === 1);
check("Land-Chips im Add-Flow", await page.evaluate(() => !!draft.country));
await page.click("text=Erstattung");
await page.evaluate(() => { key("5"); key("0"); setCat("mietwagen"); });
const disp = await page.locator(".amount-display .val").innerText();
check("Anzeige zeigt Minus", disp.includes("−"), disp);
await page.evaluate(() => saveExpense());
const refund = await page.evaluate(() => state.trips[0].expenses.find(e => e.category === "mietwagen"));
check("Erstattung negativ gespeichert", refund && refund.amount === -50 && refund.amountHome < 0, refund);

/* 4. currency chip auto-selects country */
await page.evaluate(() => { startAdd(); setCur("GTQ"); });
check("GTQ-Chip wählt Guatemala", await page.evaluate(() => draft.country) === "Guatemala");
await page.evaluate(() => { setCur("MXN"); });
check("MXN-Chip wählt Mexiko", await page.evaluate(() => draft.country) === "Mexiko");
await page.evaluate(() => cancelAdd());

/* 5. move expense to another trip */
await page.evaluate(() => { editExpense("e1"); });
await page.waitForTimeout(150);
check("Reise-Select im Edit", (await page.locator("select").count()) >= 1);
await page.evaluate(() => { draft.tripId = "tB"; saveExpense(); });
const moved = await page.evaluate(() => ({
  inA: state.trips[0].expenses.some(e => e.id === "e1"),
  inB: state.trips[1].expenses.some(e => e.id === "e1"),
}));
check("Ausgabe verschoben", !moved.inA && moved.inB, moved);
await page.evaluate(() => { /* move back for later checks */
  const e = state.trips[1].expenses.find(x => x.id === "e1");
  state.trips[1].expenses = state.trips[1].expenses.filter(x => x.id !== "e1");
  state.trips[0].expenses.push(e); saveState(); render();
});

/* 6. delete + undo via the toast button */
await page.evaluate(() => { editExpense("e2"); deleteExpense(); });
check("gelöscht", await page.evaluate(() => !state.trips[0].expenses.some(e => e.id === "e2")));
await page.waitForTimeout(100);
await page.click("#toastBtn");
await page.waitForTimeout(100);
check("Rückgängig stellt wieder her", await page.evaluate(() => state.trips[0].expenses.some(e => e.id === "e2")));

/* 7. country filter in expenses view */
await page.evaluate(() => go("expenses"));
await page.waitForTimeout(150);
check("Länder-Filterchips", (await page.locator("text=🌍 Alle Länder").count()) === 1);
await page.evaluate(() => setExpCountry("Guatemala"));
await page.waitForTimeout(150);
const listTxt = await page.locator("#expList").innerText();
check("Filter Guatemala zeigt nur Wasser", listTxt.includes("Wasser") && !listTxt.includes("Tacos"), listTxt.slice(0, 80));

/* 8. merge import: one known id, one new trip */
const mergeRes = await page.evaluate(() => {
  const backup = { version: 3, homeCurrency: "EUR", trips: [
    JSON.parse(JSON.stringify(state.trips[1])),                    /* existing id tB -> skip */
    { id: "tC", name: "Island 2023", budget: 0, startDate: "2023-06-01", endDate: "2023-06-10",
      country: "Island", currency: "ISK", countries: [{ name: "Island", cur: "ISK" }],
      travelers: ["Ich"], createdAt: new Date().toISOString(), expenses: [
        { id: "x1", ts: new Date().toISOString(), date: "2023-06-02", amount: 5000, currency: "ISK", amountHome: 33.4, rate: 0.00668, rateSource: "live", category: "essen", note: "Fisch", payer: "Ich" },
      ] },
  ] };
  applyImport(backup, "merge");
  return { n: state.trips.length, hasC: state.trips.some(t => t.id === "tC"), active: state.activeTripId };
});
check("Merge: +1 Reise, Duplikat übersprungen", mergeRes.n === 3 && mergeRes.hasC && mergeRes.active === "tA", mergeRes);

/* 9. replace import still works */
const replRes = await page.evaluate(() => {
  applyImport({ version: 3, homeCurrency: "EUR", trips: [JSON.parse(JSON.stringify(state.trips[0]))], activeTripId: "tA" }, "replace");
  return state.trips.length;
});
check("Replace-Import", replRes === 1);

/* 10b. cloud backup: URL stays out of state/backup, upload stamps both dates */
await page.route("**/script.google.com/**", r => r.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true}' }));
const cloud = await page.evaluate(async () => {
  setCloudUrl("https://script.google.com/macros/s/TESTID/exec");
  await cloudUpload(true);
  return {
    cfg: JSON.parse(localStorage.getItem("urlaubskasse_cloud")),
    urlInState: JSON.stringify(state).includes("TESTID"),
    urlInStorageState: (localStorage.getItem("urlaubskasse_v1") || "").includes("TESTID"),
    reminderStamp: !!state.lastBackupAt,
  };
});
check("Cloud-URL gespeichert + Upload stempelt", cloud.cfg && cloud.cfg.url && !!cloud.cfg.lastAt && cloud.reminderStamp, cloud);
check("Cloud-URL NICHT im Backup/State", !cloud.urlInState && !cloud.urlInStorageState, cloud);
const cloudFail = await page.evaluate(async () => {
  localStorage.setItem("urlaubskasse_cloud", JSON.stringify({ url: "https://script.google.com/macros/s/TESTID/exec" }));
  return typeof autoCloudBackup === "function";
});
check("autoCloudBackup vorhanden", cloudFail === true);

/* 10c. back button on cross-view jumps */
const back = await page.evaluate(() => {
  go("stats");
  switchTrip(state.trips[0].id, "stats");          /* stats -> trip dashboard */
  const onHome = !!document.querySelector('[aria-label="Zurück"]');
  goBack();
  const returned = state.ui.view;
  go("home");                                       /* plain nav tap */
  const cleared = !document.querySelector('[aria-label="Zurück"]');
  goFiltered("essen", null);                        /* home -> filtered list */
  const onExp = !!document.querySelector('[aria-label="Zurück"]') && state.ui.view === "expenses";
  goBack();
  return { onHome, returned, cleared, onExp, backOnHome: state.ui.view };
});
check("Zurück nach Statistik-Sprung", back.onHome && back.returned === "stats", back);
check("Nav-Tipp löscht Zurück", back.cleared);
check("Zurück aus gefilterter Liste", back.onExp && back.backOnHome === "home", back);
const setBack = await page.evaluate(() => {
  go("stats"); openSettings();
  const inMore = state.ui.view === "more";
  goBack();
  return { inMore, returned: state.ui.view };
});
check("Einstellungen-Zurück zur Herkunft", setBack.inMore && setBack.returned === "stats", setBack);

/* 10d. location capture: GPS stored offline, resolves later; CSV Ort column */
await page.context().grantPermissions(["geolocation"], { origin: "http://localhost:8140" });
await page.context().setGeolocation({ latitude: 30.42018, longitude: -9.59815 });
await page.route("**/nominatim.openstreetmap.org/**", r => r.abort()); /* offline case */
const loc = await page.evaluate(async () => {
  startAdd();
  captureLocation();
  await new Promise(r => setTimeout(r, 800));
  const captured = draft.location && typeof draft.location.lat === "number";
  key("9"); setCat("essen"); saveExpense();
  const e = state.trips[0].expenses[state.trips[0].expenses.length - 1];
  return { captured, saved: e.location, csvHead: buildCSV(state.trips, true).split("\r\n")[0] };
});
check("GPS offline erfasst + gespeichert", loc.captured && loc.saved && Math.abs(loc.saved.lat - 30.42018) < 0.001, loc.saved);
check("CSV-Spalte Ort", loc.csvHead.includes(";Ort;"), loc.csvHead);

/* 10e. after-the-fact geocoding via the search button */
await page.route("**/nominatim.openstreetmap.org/search**", r => r.fulfill({ status: 200, contentType: "application/json", body: '[{"lat":"30.4278","lon":"-9.5981","name":"Danialand","display_name":"Danialand, Agadir"}]' }));
const geo = await page.evaluate(async () => {
  startAdd();
  locInputChanged("Danialand Agadir");
  await geocodeLocation();
  return draft.location;
});
check("Ortssuche liefert Koordinaten + echten Namen", geo && Math.abs(geo.lat - 30.4278) < 0.001 && geo.label === "Danialand", geo);

/* 10. CSV has Land column */
const csv = await page.evaluate(() => buildCSV(state.trips, true).split("\r\n")[0]);
check("CSV-Spalte Land", csv.includes(";Land;"), csv);

await page.evaluate(() => go("home"));
await page.waitForTimeout(200);
await page.screenshot({ path: "shot-v26-home.png" });
check("keine JS-Fehler", errors.length === 0, errors);

console.log(`\n${pass} ok, ${fail} fail`);
await browser.close(); server.kill();
process.exit(fail ? 1 : 0);

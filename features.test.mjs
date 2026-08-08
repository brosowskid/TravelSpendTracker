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
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, locale: "de-DE" });
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

/* 3. refund entry via the ± toggle in the amount field (UX 2.0) */
await page.evaluate(() => startAdd());
await page.waitForTimeout(150);
check("±-Toggle im Betragsfeld", (await page.locator('.amount-display button[aria-label="↩ Erstattung"]').count()) === 1);
check("Land-Chips im Add-Flow", await page.evaluate(() => !!draft.country));
await page.click('.amount-display button[aria-label="↩ Erstattung"]');
await page.waitForTimeout(150);
check("Erstattung-Hinweis unter dem Betrag", (await page.locator("#convLine").innerText()).includes("Erstattung"));
await page.evaluate(() => { amountTyped("50"); setCat("mietwagen"); });
const disp = await page.locator(".amount-display").innerText();
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
await page.click("text=Mehr Details"); /* trip-move select lives in the details section */
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
  amountTyped("9"); setCat("essen"); saveExpense();
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

/* 11. custom categories */
await page.evaluate(() => startAdd());
await page.waitForTimeout(150);
await page.click("text=Alle Kategorien");
await page.waitForTimeout(150);
check("+Eigene-Kachel im erweiterten Grid", (await page.locator('.cat-cell:has-text("Eigene")').count()) === 1);
await page.click('.cat-cell:has-text("Eigene")');
await page.waitForTimeout(200);
await page.fill("#newCatName", "Tauchen");
await page.click('#newCatEmojis [data-emoji="🎣"]');
await page.click("text=Kategorie anlegen");
await page.waitForTimeout(200);
const custState = await page.evaluate(() => ({
  cats: state.customCategories, drafted: draft.category,
  inGrid: !!document.querySelector(".cat-cell.on") && document.querySelector(".cat-cell.on").innerText.includes("Tauchen"),
}));
check("Kategorie gespeichert + vorausgewählt", custState.cats.length === 1 && custState.cats[0].name === "Tauchen"
  && custState.cats[0].icon === "🎣" && custState.drafted === custState.cats[0].id && custState.inGrid, custState);
await page.evaluate(() => { amountTyped("30"); saveExpense(); });
await page.waitForTimeout(150);
const custCsv = await page.evaluate(() => buildCSV(state.trips, true));
check("Eigene Kategorie im CSV", custCsv.includes("Tauchen"));
const custId = await page.evaluate(() => state.customCategories[0].id);
check("Duplikat-Name abgelehnt", await page.evaluate(() => {
  const before = state.customCategories.length;
  /* simulate: same name typed again */
  openNewCatSheet(); document.getElementById("newCatName").value = "tauchen"; createCustomCategory();
  const rejected = state.customCategories.length === before;
  closeSheet(); return rejected;
}));
page.once("dialog", d => d.accept());
await page.evaluate((id) => deleteCustomCategory(id), custId);
await page.waitForTimeout(150);
const afterDel = await page.evaluate((id) => ({
  gone: !state.customCategories.some(c => c.id === id),
  fallback: catById(id).name,
  expenseKeepsId: state.trips.some(t => (t.expenses || []).some(e => e.category === id)),
}), custId);
check("Löschen: weg, Ausgabe behält id, Fallback Sonstiges", afterDel.gone && afterDel.fallback === "Sonstiges" && afterDel.expenseKeepsId, afterDel);
/* merge import brings custom categories along */
await page.evaluate(() => applyImport({ version: 3, homeCurrency: "EUR", trips: [], customCategories: [{ id: "cust_x1", name: "Golf", icon: "⚽" }] }, "merge"));
check("Merge-Import übernimmt eigene Kategorien", await page.evaluate(() => state.customCategories.some(c => c.id === "cust_x1")));

/* 12. trips tab redesign (hero cards, grouping, budget bar) + trip summary */
await page.evaluate(() => {
  const today = todayISO();
  const iso = (off) => { const d = new Date(); d.setDate(d.getDate() + off); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); };
  state.trips = [
    { id: "tRun", name: "Laufende Reise", budget: 1000, startDate: iso(-2), endDate: iso(3),
      country: "Mexiko", currency: "MXN", countries: [{ name: "Mexiko", cur: "MXN" }, { name: "Guatemala", cur: "GTQ" }],
      travelers: ["Ich", "Partnerin"], createdAt: new Date().toISOString(), expenses: [
        { id: "r1", ts: new Date().toISOString(), date: iso(-30), amount: 200, currency: "EUR", amountHome: 200, rate: 1, rateSource: "live", category: "flug", note: "Flug", payer: "Ich", country: "Mexiko" },
        { id: "r2", ts: new Date().toISOString(), date: iso(-1), amount: 300, currency: "EUR", amountHome: 300, rate: 1, rateSource: "live", category: "essen", note: "Tacos", payer: "Partnerin", country: "Mexiko" },
        { id: "r3", ts: new Date().toISOString(), date: today, amount: 100, currency: "EUR", amountHome: 100, rate: 1, rateSource: "live", category: "hotel", note: "", payer: "Ich", country: "Guatemala" },
      ] },
    { id: "tPlan", name: "Geplante Reise", budget: 0, startDate: iso(10), endDate: iso(15),
      country: "Island", currency: "ISK", countries: [{ name: "Island", cur: "ISK" }],
      travelers: ["Ich"], createdAt: new Date().toISOString(), expenses: [] },
    { id: "tDone", name: "Alte Reise", budget: 0, startDate: "2024-03-08", endDate: "2024-03-13",
      country: "Malta", currency: "EUR", countries: [{ name: "Malta", cur: "EUR" }],
      travelers: ["Ich"], createdAt: "2024-03-08T12:00:00Z", expenses: [
        { id: "d1", ts: "2024-03-09T12:00:00Z", date: "2024-03-09", amount: 30, currency: "EUR", amountHome: 30, rate: 1, rateSource: "live", category: "hotel", note: "Inn", payer: "Ich" },
      ] },
  ];
  state.activeTripId = "tRun";
  saveState(); go("trips");
});
await page.waitForTimeout(250);
check("Hero-Karten mit Verlauf", (await page.locator(".trip-hero").count()) === 3);
const heads = await page.evaluate(() => [...document.querySelectorAll(".day-head")].map(h => h.innerText.trim()));
check("Gruppen Aktuell-und-geplant + Jahr", heads[0].toLowerCase().startsWith("aktuell") && heads.includes("2024"), heads); /* day-head uppercases via CSS */
const pills = await page.evaluate(() => [...document.querySelectorAll(".trip-hero .st")].map(p => p.innerText));
check("Status-Pills läuft + in N Tagen", pills.some(p => p === "läuft") && pills.some(p => p.startsWith("in ")), pills);
check("Budget-Balken auf Karte", (await page.locator(".trip-card .tbar").count()) === 1);
const bodyTxt = await page.locator('.trip-card:has-text("Laufende Reise") .trip-body').innerText();
check("Budget-Zeile 600/1000 · 60 %", bodyTxt.includes("60 %"), bodyTxt);
/* summary */
await page.evaluate(() => go("home"));
await page.waitForTimeout(200);
await page.click("text=Reise-Zusammenfassung");
await page.waitForTimeout(250);
check("Zusammenfassung öffnet", (await page.locator('.title:has-text("Zusammenfassung")').count()) === 1);
const sumTxt = await page.locator("#app").innerText();
check("Gesamt + Budget-Pille", sumTxt.includes("Gesamt ausgegeben") && sumTxt.includes("im Budget"), null);
check("Kennzahlen-KPIs", sumTxt.includes("Tage mit Ausgaben") && sumTxt.includes("Ø pro Ausgabe") && sumTxt.includes("vorab gebucht"), null);
check("Nach Kategorie + Land + Bezahlt", sumTxt.includes("Nach Kategorie") && sumTxt.includes("Nach Land") && sumTxt.includes("Wer hat bezahlt?"), null);
await page.evaluate(() => goBack());
await page.waitForTimeout(200);
check("Zurück zur Übersicht", await page.evaluate(() => state.ui.view) === "home");

/* 13. payment method (card/cash) */
await page.evaluate(() => startAdd());
await page.waitForTimeout(150);
check("Zahlung-Chips 💳/💵", (await page.locator('.chip:has-text("💳")').count()) === 1 && (await page.locator('.chip:has-text("💵")').count()) === 1);
await page.click('.chip:has-text("💵")');
await page.waitForTimeout(150);
check("Bar ausgewählt", await page.evaluate(() => draft.payMethod) === "cash");
await page.evaluate(() => { amountTyped("25"); setCat("essen"); saveExpense(); });
await page.waitForTimeout(150);
const payE = await page.evaluate(() => state.trips.find(t => t.id === "tRun").expenses.at(-1));
check("payMethod gespeichert", payE.payMethod === "cash", payE.payMethod);
await page.evaluate(() => startAdd());
await page.waitForTimeout(150);
check("Kontinuität: nächster Eintrag startet mit Bar", await page.evaluate(() => draft.payMethod) === "cash");
await page.evaluate(() => { setPayMethod("cash"); }); /* toggle off */
await page.waitForTimeout(100);
check("Nochmal tippen wählt ab", await page.evaluate(() => draft.payMethod) === null);
await page.evaluate(() => cancelAdd());
const payCsv = await page.evaluate(() => buildCSV(state.trips.filter(t => t.id === "tRun"), true));
check("CSV-Spalte Zahlung + Wert Bar", payCsv.split("\r\n")[0].includes(";Zahlung;") && payCsv.includes(";Bar;"), payCsv.split("\r\n")[0]);
await page.evaluate(() => go("expenses"));
await page.waitForTimeout(150);
check("💵-Icon in der Liste", (await page.locator("#expList").innerText()).includes("💵"));

/* 14. data-integrity fixes (GPT review round) */
await page.evaluate(() => { editTrip("tRun"); });
await page.waitForTimeout(150);
check("Reiseziel-Button hat Text", (await page.locator('button:has-text("+ Reiseziel hinzufügen")').count()) >= 1);
const orphan = await page.evaluate(() => {
  /* two orphaned custom-category ids must merge into ONE Sonstiges row */
  const t = state.trips.find(x => x.id === "tRun");
  t.expenses.push(
    { id: "or1", ts: new Date().toISOString(), date: todayISO(), amount: 5, currency: "EUR", amountHome: 5, rate: 1, rateSource: "live", category: "cust_gone1", note: "", payer: "Ich" },
    { id: "or2", ts: new Date().toISOString(), date: todayISO(), amount: 7, currency: "EUR", amountHome: 7, rate: 1, rateSource: "live", category: "cust_gone2", note: "", payer: "Ich" });
  const rows = byCategory(t).filter(([cid]) => cid === "sonstiges");
  return { rows: rows.length, sum: rows.length ? rows[0][1] : 0 };
});
check("Verwaiste Kategorien → EINE Sonstiges-Zeile", orphan.rows === 1 && orphan.sum === 12, orphan);
const orphanPayer = await page.evaluate(() => {
  const t = state.trips.find(x => x.id === "tRun");
  t.expenses.push({ id: "op1", ts: new Date().toISOString(), date: todayISO(), amount: 40, currency: "EUR", amountHome: 40, rate: 1, rateSource: "live", category: "essen", note: "", payer: "Entfernte Anna" });
  state.activeTripId = "tRun"; saveState(); go("home");
  return document.getElementById("app").innerText.includes("Entfernte Anna");
});
check("Entfernte Zahlerin bleibt in Wer-hat-bezahlt sichtbar", orphanPayer === true);
check("Suche findet Ortslabel", await page.evaluate(() => {
  const t = state.trips.find(x => x.id === "tRun");
  t.expenses.push({ id: "loc1", ts: new Date().toISOString(), date: todayISO(), amount: 3, currency: "EUR", amountHome: 3, rate: 1, rateSource: "live", category: "essen", note: "", payer: "Ich", location: { lat: 1, lon: 2, label: "Strandbar Xyz" } });
  expFilter = { q: "strandbar", cat: null, country: null };
  const hit = t.expenses.filter(expenseMatches).length === 1;
  expFilter = { q: "", cat: null, country: null };
  return hit;
}));

await page.evaluate(() => go("home"));
await page.waitForTimeout(200);
await page.screenshot({ path: "shot-v26-home.png" });
check("keine JS-Fehler", errors.length === 0, errors);

console.log(`\n${pass} ok, ${fail} fail`);
await browser.close(); server.kill();
process.exit(fail ? 1 : 0);

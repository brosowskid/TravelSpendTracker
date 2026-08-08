/* Regression: i18n layer (DE/EN, English default on non-German devices) and
   the UX-2.0 add screen ("Mehr Details" section). */
import { chromium } from "playwright";
import { spawn } from "child_process";
import { existsSync } from "fs";

const py = process.platform === "win32" ? "python" : "python3";
const server = spawn(py, ["-m", "http.server", "8127"], { stdio: "ignore" });
await new Promise(r => setTimeout(r, 800));

const cloudChrome = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const opts = existsSync(cloudChrome) ? { executablePath: cloudChrome } : {};
const browser = await chromium.launch(opts);

let okCount = 0, failCount = 0;
function check(name, cond, extra) {
  console.log((cond ? "  ok  " : "  FAIL ") + name + (cond || extra === undefined ? "" : "  -> " + JSON.stringify(extra)));
  cond ? okCount++ : failCount++;
}

async function freshPage(locale) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, locale });
  const errors = [];
  page.on("pageerror", e => errors.push("PAGEERROR: " + e.message));
  page.on("console", m => { if (m.type() === "error" && !m.text().includes("ERR_FAILED")) errors.push("CONSOLE: " + m.text()); }); /* rates fetch is deliberately aborted */
  await page.route("https://open.er-api.com/**", r => r.abort()); // keep rates deterministic
  await page.goto("http://localhost:8127/index.html");
  await page.waitForTimeout(400);
  return { page, errors };
}

/* seed: one trip with two destinations + a couple of expenses */
async function seed(page) {
  await page.evaluate(() => {
    const today = todayISO();
    state.trips = [{
      id: "tI18n", name: "Mexiko 2026", budget: 1000, startDate: today, endDate: null,
      country: "Mexiko", currency: "MXN",
      countries: [{ name: "Mexiko", cur: "MXN" }, { name: "Guatemala", cur: "GTQ" }],
      travelers: ["Ich"], createdAt: new Date().toISOString(),
      expenses: [
        { id: "i1", ts: new Date().toISOString(), date: today, amount: 200, currency: "MXN",
          amountHome: 10, rate: 0.05, rateSource: "live", category: "essen", note: "Tacos", payer: "Ich", country: "Mexiko" },
        { id: "i2", ts: new Date().toISOString(), date: today, amount: 20, currency: "EUR",
          amountHome: 20, rate: 1, rateSource: "live", category: "hotel", note: "Hostel", payer: "Ich", country: "Guatemala" },
      ],
    }];
    state.activeTripId = "tI18n";
    saveState(); render();
  });
  await page.waitForTimeout(200);
}

/* ---------- 1. auto-detect: German device -> German UI ---------- */
{
  const { page, errors } = await freshPage("de-DE");
  check("appLang() auto = de auf de-DE-Gerät", await page.evaluate(() => appLang()) === "de");
  check("Welcome auf Deutsch", (await page.locator("text=Erste Reise anlegen").count()) === 1);
  await seed(page);
  check("Nav auf Deutsch", (await page.locator('.nav-btn:has-text("Übersicht")').count()) === 1);
  check("LOCALE() = de-DE", await page.evaluate(() => LOCALE()) === "de-DE");
  check("fmt nutzt Dezimalkomma", (await page.evaluate(() => fmt(1234.56))).includes("1.234,56"));
  check("keine JS-Fehler (de)", errors.length === 0, errors);
  await page.close();
}

/* ---------- 2. auto-detect: non-German device -> ENGLISH default ---------- */
{
  const { page, errors } = await freshPage("en-US");
  check("appLang() auto = en auf en-US-Gerät", await page.evaluate(() => appLang()) === "en");
  check("Welcome auf Englisch", (await page.locator("text=Create your first trip").count()) === 1);
  await seed(page);
  check("Nav auf Englisch", (await page.locator('.nav-btn:has-text("Overview")').count()) === 1);
  check("Kein deutscher Nav-Rest", (await page.locator('.nav-btn:has-text("Reisen")').count()) === 0);
  check("fmt nutzt Dezimalpunkt", (await page.evaluate(() => fmt(1234.56))).includes("1,234.56"));

  /* home view content */
  check("Nach Kategorie -> By category", (await page.locator("text=By category").count()) >= 1);
  check("Nach Land -> By country", (await page.locator("text=By country").count()) >= 1);
  check("Kategoriename übersetzt (Supermarkt -> Groceries)",
    await page.evaluate(() => tr("Supermarkt & Snacks")) === "Groceries & Snacks");
  check("Kategoriename identisch erlaubt (Restaurant & Café)",
    await page.evaluate(() => tr("Restaurant & Café")) === "Restaurant & Café");
  check("countryDisplay Mexiko -> Mexico", await page.evaluate(() => countryDisplay("Mexiko")) === "Mexico");
  check("countryDisplay Großbritannien -> United Kingdom",
    await page.evaluate(() => countryDisplay("Großbritannien")) === "United Kingdom");
  check("countryDisplay unbekannt fällt auf Eingabe zurück",
    await page.evaluate(() => countryDisplay("Fantasieland")) === "Fantasieland");
  check("tr-Fallback: fehlender Key bleibt deutsch",
    await page.evaluate(() => tr("Dieser Key existiert nicht 12345")) === "Dieser Key existiert nicht 12345");
  check("tr mit Platzhalter", await page.evaluate(() => tr("Gesamt ({n} Reisen)", { n: 7 })) === "Total (7 trips)");

  /* add screen (UX 2.0) in English */
  await page.evaluate(() => startAdd());
  await page.waitForTimeout(200);
  check("Add-Titel: New expense", (await page.locator("text=New expense").count()) === 1);
  check("Buttons Cancel/Add", (await page.locator('button:has-text("Cancel")').count()) === 1
    && (await page.locator('button:has-text("Add")').count()) >= 1);
  check("Details zu: kein Refund-Chip sichtbar", (await page.locator("text=Refund").count()) === 0);
  const addBody = await page.locator("#app").innerText();
  const order = ["Category", "Note", "Date", "More details"].map(s => addBody.indexOf(s));
  check("Reihenfolge Kategorie -> Notiz -> Datum -> More details", order.every((v, i) => v >= 0 && (i === 0 || v > order[i - 1])), order);
  await page.click("text=More details");
  await page.waitForTimeout(150);
  check("Details offen: Refund-Chip + Ort", (await page.locator("text=Refund").count()) === 1
    && (await page.locator("text=Location (optional)").count()) === 1);
  check("Land-Chips zeigen englische Namen", (await page.locator('.chip:has-text("Mexico")').count()) >= 1);
  await page.click("text=Refund");
  await page.waitForTimeout(150);
  check("Refund-Zustand überlebt Re-Render (Details bleiben offen)", (await page.locator("text=Refund").count()) === 1);
  /* save a refund and read the toast */
  await page.evaluate(() => { amountTyped("50"); setCat("mietwagen"); });
  await page.evaluate(() => saveExpense());
  await page.waitForTimeout(150);
  const toastTxt = await page.locator("#toast").innerText();
  check("Toast auf Englisch (added ✓)", toastTxt.includes("added ✓"), toastTxt);

  /* date chips */
  await page.evaluate(() => startAdd());
  await page.waitForTimeout(150);
  check("Datum-Chips Today/Yesterday", (await page.locator('button:has-text("Today")').count()) === 1
    && (await page.locator('button:has-text("Yesterday")').count()) === 1);
  await page.evaluate(() => cancelAdd());
  await page.waitForTimeout(150);

  /* expenses list */
  await page.evaluate(() => go("expenses"));
  await page.waitForTimeout(150);
  check("Suchfeld englisch", await page.getAttribute("#expSearch", "placeholder") !== null
    && !(await page.getAttribute("#expSearch", "placeholder")).includes("durchsuchen"));
  check("Tagesüberschrift Today", (await page.locator("text=Today").count()) >= 1);
  check("Länderfilter englisch (All countries)", (await page.locator("text=All countries").count()) === 1);

  /* stats */
  await page.evaluate(() => go("stats"));
  await page.waitForTimeout(150);
  check("Stats-Titel Statistics", (await page.locator('.title:has-text("Statistics")').count()) === 1);
  check("KPI Total (1 trip)", (await page.locator("text=Total (1 trip)").count()) === 1);
  check("Per trip Sektion", (await page.locator("text=Per trip").count()) >= 1);
  check("Pro Jahr Übersetzung vorhanden", await page.evaluate(() => tr("Pro Jahr")) === "Per year");

  /* trips view */
  await page.evaluate(() => go("trips"));
  await page.waitForTimeout(150);
  check("Trips: selected-Pill", (await page.locator(".pill").innerText()) !== "ausgewählt");
  const tripLine = await page.locator(".card .muted").first().innerText();
  check("Trips: /day statt /Tag", tripLine.includes("/day"), tripLine);

  /* settings incl. the new language chips */
  await page.evaluate(() => openSettings());
  await page.waitForTimeout(150);
  check("Settings-Titel Settings", (await page.locator('.title:has-text("Settings")').count()) === 1);
  check("Sprache-Chips Auto/Deutsch/English", (await page.locator('.chip:has-text("Deutsch")').count()) === 1
    && (await page.locator('.chip:has-text("English")').count()) === 1);

  /* CSV in English */
  const csv = await page.evaluate(() => buildCSV([activeTrip()], false));
  check("CSV-Header englisch", csv.split("\r\n")[0].startsWith("Date,Timestamp,Trip,Country,Location,Description,Category,Amount,Currency"), csv.split("\r\n")[0]);
  check("CSV-Land englisch (Mexico)", csv.includes("Mexico"), null);
  check("CSV-Kategorie englisch (Accommodation statt Unterkunft)", csv.includes("Accommodation") && !csv.includes("Unterkunft"), null);
  const summary = await page.evaluate(() => buildSummaryCSV(activeTrip(), false));
  check("Summary-CSV englisch", summary.split("\r\n")[0].startsWith("Trip,"), summary.split("\r\n")[0]);
  check("Summary-Reiseziel englisch", summary.includes("Mexico, Guatemala"), null);

  check("keine JS-Fehler (en)", errors.length === 0, errors);
  await page.close();
}

/* ---------- 3. manual override + persistence ---------- */
{
  const { page, errors } = await freshPage("de-DE");
  await seed(page);
  await page.evaluate(() => openSettings());
  await page.waitForTimeout(150);
  await page.click('.chip:has-text("English")');
  await page.waitForTimeout(200);
  check("Umschalten DE-Gerät -> Englisch sofort", (await page.locator('.title:has-text("Settings")').count()) === 1);
  check("setLang gespeichert", await page.evaluate(() => JSON.parse(localStorage.getItem("urlaubskasse_v1")).settings.lang) === "en");
  await page.reload();
  await page.waitForTimeout(500);
  check("Englisch überlebt Reload", (await page.locator('.nav-btn:has-text("Overview")').count()) === 1);
  /* and back to German via the chips */
  await page.evaluate(() => openSettings());
  await page.waitForTimeout(150);
  await page.click('.chip:has-text("Deutsch")');
  await page.waitForTimeout(200);
  check("Zurück zu Deutsch", (await page.locator('.title:has-text("Einstellungen")').count()) === 1);
  await page.click('.chip:has-text("Automatisch")');
  await page.waitForTimeout(200);
  check("Auto auf de-Gerät = Deutsch", (await page.locator('.title:has-text("Einstellungen")').count()) === 1);
  check("Sprachwechsel ändert KEINE Daten", await page.evaluate(() => {
    const t = state.trips[0];
    return t.country === "Mexiko" && t.expenses.every(e => ["Mexiko", "Guatemala"].includes(e.country));
  }));
  check("keine JS-Fehler (toggle)", errors.length === 0, errors);
  await page.close();
}

console.log(okCount + " ok, " + failCount + " fail");
await browser.close();
server.kill();
process.exit(failCount ? 1 : 0);

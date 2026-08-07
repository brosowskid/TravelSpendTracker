/* Smoke test: drives the app through the core flow and screenshots each screen. */
import { chromium } from "playwright";
import { spawn } from "child_process";
import { existsSync } from "fs";

const py = process.platform === "win32" ? "python" : "python3";
const server = spawn(py, ["-m", "http.server", "8123"], { stdio: "ignore" });
await new Promise(r => setTimeout(r, 800));

/* cloud environments have a preinstalled Chromium; elsewhere use the one from `npx playwright install chromium` */
const cloudChrome = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const browser = await chromium.launch(existsSync(cloudChrome) ? { executablePath: cloudChrome } : {});
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
const errors = [];
page.on("pageerror", e => errors.push("PAGEERROR: " + e.message));
page.on("console", m => { if (m.type() === "error") errors.push("CONSOLE: " + m.text()); });

await page.goto("http://localhost:8123/index.html");
await page.waitForTimeout(600);
await page.screenshot({ path: "shot-1-welcome.png" });

// Create trip with destination country (→ auto currency) and end date
await page.click("text=Erste Reise anlegen");
await page.fill("#tripName", "Mexiko 2026");
// add destinations via the searchable country sheet (multi-destination)
await page.click('button:has-text("+ Reiseziel hinzufügen")');
await page.fill("#countrySearch", "mexi");
await page.waitForTimeout(150);
await page.click('.cur-item:has-text("Mexiko")');
await page.waitForTimeout(150);
await page.click('button:has-text("+ Reiseziel hinzufügen")');
await page.fill("#countrySearch", "guatem");
await page.waitForTimeout(150);
await page.click('.cur-item:has-text("Guatemala")');
await page.waitForTimeout(150);
const countryList = await page.locator("#tripCountryList").innerText();
console.log("COUNTRIES PICKED:", countryList.includes("Mexiko (MXN)") && countryList.includes("Guatemala") ? "OK" : "FAIL(" + countryList.replace(/\n/g, " ") + ")");
// removing the second one must keep name/budget/date inputs intact
await page.click('#tripCountryList .list-item:has-text("Guatemala") button');
await page.waitForTimeout(150);
console.log("REMOVE DESTINATION:", (await page.locator("#tripCountryList").innerText()).includes("Guatemala") ? "FAIL" : "OK");
console.log("FORM INTACT:", (await page.inputValue("#tripName")) === "Mexiko 2026" ? "OK" : "FAIL");
await page.fill("#tripBudget", "3500");
await page.fill("#tripEnd", "2026-08-19");
await page.click("text=Reise anlegen");
await page.waitForTimeout(300);
const daysLeftKpi = await page.locator("text=noch 14 Tage").count();
console.log("END-DATE KPI:", daysLeftKpi === 1 ? "OK" : "MISSING");

// Add expense 1: 450 MXN Essen — MXN must already be preselected from the trip country
await page.click(".fab");
await page.waitForTimeout(200);
const preselected = await page.locator(".amount-display .val").innerText();
console.log("AUTO CURRENCY:", preselected.includes("MXN") ? "OK" : "FAIL(" + preselected + ")");
await page.click(".amount-display"); // keypad opens on tapping the amount
for (const k of ["4", "5", "0"]) await page.click(`.key:has-text("${k}")`);
const dateVal = await page.locator('input[type="date"]').inputValue();
const todayIso = await page.evaluate(() => todayISO());
console.log("DATE ROW DEFAULTS TO TODAY:", dateVal === todayIso ? "OK" : "FAIL(" + dateVal + ")");
await page.click('.cat-cell:has-text("Restaurant")');
await page.fill("#noteInput", "Tacos am Strand");
await page.screenshot({ path: "shot-2-add.png" });
await page.click('button:has-text("Hinzufügen")');
await page.waitForTimeout(300);

// Add expense 2: 53,74 EUR Hotel
await page.click(".fab");
await page.waitForTimeout(200);
await page.click(".amount-display");
for (const k of ["5", "3"]) await page.click(`.key:has-text("${k}")`);
await page.click('.key:has-text(",")');
for (const k of ["7", "4"]) await page.click(`.key:has-text("${k}")`);
await page.click('.chip:has-text("EUR")');
await page.click('.cat-cell:has-text("Unterkunft")');
await page.click('button:has-text("Hinzufügen")');
await page.waitForTimeout(300);

// Add expense 3: 1200 MXN Ausflug — pick MXN via the searchable all-currencies sheet
await page.click(".fab");
await page.waitForTimeout(200);
await page.click(".amount-display");
for (const k of ["1", "2", "0", "0"]) await page.click(`.key:has-text("${k}")`);
await page.click('.chip:has-text("Alle")');
await page.fill("#curSearch", "peso");
await page.waitForTimeout(150);
const hits = await page.locator(".cur-item").count();
console.log("CURRENCY SEARCH 'peso' hits:", hits);
await page.click('.cur-item:has-text("MXN")');
await page.waitForTimeout(150);
await page.click('text=Alle Kategorien'); // Ausflüge liegt außerhalb der Top-8
await page.click('.cat-cell:has-text("Ausflüge")');
await page.click('button:has-text("Hinzufügen")');
await page.waitForTimeout(400);
await page.screenshot({ path: "shot-3-home.png" });

// Verify totals from state
const check = await page.evaluate(() => {
  const s = JSON.parse(localStorage.getItem("urlaubskasse_v1"));
  const t = s.trips[0];
  const sum = t.expenses.reduce((a, e) => a + e.amountHome, 0);
  const mxnRate = s.rates.map.MXN;
  const expected = 450 / mxnRate + 53.74 + 1200 / mxnRate;
  return { n: t.expenses.length, sum: sum.toFixed(2), expected: expected.toFixed(2), rateSource: s.rates.source, mxnRate,
           diff: Math.abs(sum - expected) < 0.02 };
});
console.log("STATE CHECK:", JSON.stringify(check));

// Expenses list
await page.click('.nav-btn:has-text("Ausgaben")');
await page.waitForTimeout(300);
await page.screenshot({ path: "shot-4-expenses.png" });

// Search + category filter
await page.fill("#expSearch", "Tacos");
await page.waitForTimeout(150);
console.log("SEARCH 'Tacos':", (await page.locator(".exp").count()) === 1 ? "OK" : "FAIL");
await page.fill("#expSearch", "");
await page.waitForTimeout(150);
await page.click('.chip:has-text("Unterkunft")');
await page.waitForTimeout(200);
console.log("CATEGORY FILTER:", (await page.locator(".exp").count()) === 1 ? "OK" : "FAIL");
await page.click('.chip:has-text("Alle")');
await page.waitForTimeout(200);
console.log("FILTER RESET:", (await page.locator(".exp").count()) === 3 ? "OK" : "FAIL");

// Summary CSV
const summary = await page.evaluate(() => buildSummaryCSV(activeTrip(), true));
console.log("SUMMARY HEAD:", summary.split("\r\n")[0]);
console.log("SUMMARY HAS CATEGORIES:", summary.includes("Kategorie;Betrag") ? "OK" : "FAIL");

// Add second traveler via the per-trip settings + check split card renders
await page.click('.nav-btn:has-text("Reisen")');
await page.waitForTimeout(200);
await page.click('button:has-text("✎")');
await page.waitForTimeout(200);
page.once("dialog", d => d.accept("Partnerin"));
await page.click('button:has-text("+ Person hinzufügen")');
await page.waitForTimeout(200);
await page.screenshot({ path: "shot-5-trip-edit.png" });
await page.click('.nav-btn:has-text("Übersicht")');
await page.waitForTimeout(300);
const splitVisible = await page.locator("text=Wer hat bezahlt?").count();
console.log("SPLIT CARD:", splitVisible === 1 ? "OK" : "MISSING");
await page.screenshot({ path: "shot-6-home-split.png" });

// CSV content check (build in page, don't download)
const csv = await page.evaluate(() => buildCSV([activeTrip()], true));
console.log("CSV HEAD:", csv.split("\r\n")[0]);
console.log("CSV ROW1:", csv.split("\r\n")[1]);
console.log("CSV rows:", csv.split("\r\n").length - 1);

// Dark mode
await page.click('.icon-btn[aria-label="Einstellungen"]');
await page.waitForTimeout(200);
await page.click('.chip:has-text("Dunkel")');
await page.waitForTimeout(200);
const theme = await page.evaluate(() => document.documentElement.dataset.theme);
console.log("DARK MODE:", theme === "dark" ? "OK" : "FAIL");
await page.click('.nav-btn:has-text("Übersicht")');
await page.waitForTimeout(300);
await page.screenshot({ path: "shot-7-dark.png" });

// Reload persistence check
await page.reload();
await page.waitForTimeout(500);
const persisted = await page.evaluate(() => JSON.parse(localStorage.getItem("urlaubskasse_v1")).trips[0].expenses.length);
console.log("PERSISTED EXPENSES AFTER RELOAD:", persisted);

console.log("JS ERRORS:", errors.length ? errors.join("\n") : "none");
await browser.close();
server.kill();

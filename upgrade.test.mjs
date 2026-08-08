import { chromium } from "playwright";
import { spawn } from "child_process";
import { existsSync } from "fs";
const py = process.platform === "win32" ? "python" : "python3";
const server = spawn(py, ["-m", "http.server", "8124"], { stdio: "ignore" });
await new Promise(r => setTimeout(r, 1000));
const cloudChrome = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const browser = await chromium.launch(existsSync(cloudChrome) ? { executablePath: cloudChrome } : {});
const page = await browser.newPage({ locale: "de-DE" });
await page.goto("http://localhost:8124/index.html");
await page.waitForTimeout(400);
const result = await page.evaluate(() => {
  // seed: trip with a 400 MXN expense converted at fallback rate 21.5
  state.trips = [{ id: "t1", name: "Test", budget: 0, startDate: todayISO(), expenses: [] }];
  state.activeTripId = "t1";
  state.trips[0].expenses.push({ id: "e1", ts: new Date().toISOString(), date: todayISO(),
    amount: 400, currency: "MXN", amountHome: Math.round(400/21.5*100)/100, rate: 0.0465,
    category: "essen", note: "", payer: "Ich", rateSource: "fallback" });
  state.trips[0].expenses.push({ id: "e2", ts: new Date().toISOString(), date: todayISO(),
    amount: 100, currency: "MXN", amountHome: Math.round(100/21.5*100)/100, rate: 0.0465,
    category: "essen", note: "", payer: "Ich", rateSource: "live" }); // entered with cached live rate -> must stay frozen
  const before = state.trips[0].expenses.map(e => e.amountHome);
  // simulate live rates arriving: MXN now 20.0 per EUR
  state.rates = { base: "EUR", date: "now", map: { ...state.rates.map, MXN: 20.0 }, source: "live" };
  upgradeFallbackExpenses();
  const after = state.trips[0].expenses.map(e => ({ amountHome: e.amountHome, rateSource: e.rateSource }));
  return { before, after };
});
console.log(JSON.stringify(result, null, 1));
// expectations: e1: 400/21.5=18.60 -> 400/20=20.00, rateSource live; e2 stays 4.65
const ok = result.after[0].amountHome === 20 && result.after[1].amountHome === 4.65 && result.after[0].rateSource === "live";
console.log(ok ? "UPGRADE LOGIC: OK" : "UPGRADE LOGIC: FAIL");
await browser.close();
server.kill();
process.exit(ok ? 0 : 1);

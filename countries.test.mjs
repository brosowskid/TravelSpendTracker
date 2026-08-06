/* Unit test: every COUNTRIES currency must have a FALLBACK_RATES entry,
   no duplicate country names, and the list stays complete (>= 198). */
import { readFileSync } from "fs";

const html = readFileSync(new URL("./index.html", import.meta.url), "utf8");
const start = html.indexOf("const FALLBACK_RATES");
const end = html.indexOf("/* ---------------- State");
const { FALLBACK_RATES, COUNTRIES } = new Function(
  html.slice(start, end) + "; return { FALLBACK_RATES, COUNTRIES };"
)();

let fail = 0;
const check = (ok, msg) => { console.log((ok ? "OK  " : "FAIL") + " " + msg); if (!ok) fail++; };

check(COUNTRIES.length >= 198, `country count ${COUNTRIES.length} >= 198`);
const missing = COUNTRIES.filter(([, c]) => !(c in FALLBACK_RATES));
check(missing.length === 0, "all country currencies have fallback rates" + (missing.length ? ": " + JSON.stringify(missing) : ""));
const names = COUNTRIES.map(([n]) => n);
const dupes = names.filter((n, i) => names.indexOf(n) !== i);
check(dupes.length === 0, "no duplicate countries" + (dupes.length ? ": " + dupes : ""));
for (const [name, cur] of [["Vatikanstadt", "EUR"], ["Russland", "RUB"], ["Mexiko", "MXN"], ["Japan", "JPY"], ["China", "CNY"]]) {
  const hit = COUNTRIES.find(([n]) => n === name);
  check(!!hit && hit[1] === cur, `${name} → ${cur}`);
}
check(Object.values(FALLBACK_RATES).every(v => typeof v === "number" && v > 0), "all fallback rates positive numbers");

process.exit(fail ? 1 : 0);

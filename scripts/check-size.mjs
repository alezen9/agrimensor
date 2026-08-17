import { readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";

// a budget that fails the build rather than a number someone reads and forgets.
// raise it deliberately when the library genuinely grows, never to make CI pass.
const BUDGETS = { rawKb: 60, gzipKb: 15 };

const bytes = readFileSync("dist/index.js");
const rawKb = bytes.length / 1000;
const gzipKb = gzipSync(bytes).length / 1000;

const report = `raw ${rawKb.toFixed(1)} kB (budget ${BUDGETS.rawKb}), gzip ${gzipKb.toFixed(1)} kB (budget ${BUDGETS.gzipKb})`;

if (rawKb > BUDGETS.rawKb || gzipKb > BUDGETS.gzipKb) {
  console.error(`bundle over budget: ${report}`);
  process.exit(1);
}

console.log(`bundle within budget: ${report}`);

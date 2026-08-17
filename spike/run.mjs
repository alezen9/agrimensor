import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, extname } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const TYPES = { ".html": "text/html", ".js": "text/javascript" };

// served over localhost rather than file://, so module imports are not blocked by
// CORS and the page still counts as a secure context for WebGPU
const server = createServer(async (request, response) => {
  const path = request.url === "/" ? "/index.html" : (request.url ?? "/");
  try {
    const body = await readFile(join(here, path));
    response.writeHead(200, {
      "content-type": TYPES[extname(path)] ?? "application/octet-stream",
    });
    response.end(body);
  } catch {
    response.writeHead(404).end();
  }
});

await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const { port } = server.address();

const browser = await chromium.launch({
  // the default headless shell is a stripped build; WebGPU needs the full browser
  channel: "chromium",
  // QUANTIZED=1 drops the developer flag to see what a real user's Chrome reports
  args: process.env.QUANTIZED
    ? []
    : [
        "--enable-dawn-features=allow_unsafe_apis",
        // without this Chrome rounds every timestamp, which would hide the
        // ordering question behind quantisation noise
        "--enable-webgpu-developer-features",
      ],
});

const page = await browser.newPage();
page.on("console", (m) => {
  if (m.type() === "error") console.error("[page]", m.text());
});
page.on("pageerror", (e) => console.error("[page error]", e.message));

await page.goto(`http://127.0.0.1:${port}/index.html`);
await page.waitForFunction(() => window.__spike !== undefined, null, {
  timeout: 120000,
});

const result = await page.evaluate(() => window.__spike);
await browser.close();
server.close();

if (!result.ok) {
  console.error("spike failed:", result.error);
  process.exit(1);
}

const { adapter, summary, followUps } = result.report;
console.log("\nadapter:", JSON.stringify(adapter));
console.log("\nsummary:", JSON.stringify(summary, null, 2));
console.log("\nfollow-ups:", JSON.stringify(followUps, null, 2));

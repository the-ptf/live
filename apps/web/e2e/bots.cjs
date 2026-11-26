const fs = require("node:fs");
const puppeteer = require("puppeteer-core");
const CHROME =
  process.env.CHROME_PATH ??
  `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
const BASE = process.env.LIVE_URL ?? "http://localhost:8799";
const OUT = process.env.E2E_OUT ?? "/tmp/live-e2e";
fs.mkdirSync(OUT, { recursive: true });

const ready = (p) =>
  p.waitForFunction(
    () => document.getElementById("people").textContent.includes("here") && !/Connecting|Reconnecting/.test(document.getElementById("status").textContent),
    {
      timeout: 20000,
    },
  );
// How many of 6 snapshots, 250 ms apart, differ from the one before: 0 means the bot holds still.
const moves = (p, selector) =>
  p.evaluate(async (target) => {
    const canvas = document.querySelector(`${target} canvas`);
    let last = canvas.toDataURL();
    let changes = 0;
    for (let i = 0; i < 6; i++) {
      await new Promise((r) => setTimeout(r, 250));
      const next = canvas.toDataURL();
      if (next !== last) changes += 1;
      last = next;
    }
    return changes;
  }, selector);

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    defaultViewport: { width: 1200, height: 800 },
    args: ["--enable-unsafe-swiftshader"],
  });
  const page = await (await browser.createBrowserContext()).newPage();
  page.on("pageerror", (e) => console.log("pageerror", e.message));
  await page.goto(BASE + "/start");
  await page.type("#name", "Ana");
  await page.click("#join-button");
  await ready(page);
  const bot = "#gallery figure.mine .avatar";
  await page.waitForSelector(`${bot} canvas`);
  await new Promise((r) => setTimeout(r, 800));
  console.log("frames that changed, resting:", await moves(page, bot));
  await page.click(bot);
  console.log("frames that changed, after a click:", await moves(page, bot));
  await new Promise((r) => setTimeout(r, 1500));
  console.log("frames that changed, settled again:", await moves(page, bot));
  await browser.close();
  console.log("done");
})().catch((e) => {
  console.error("ERROR", e.message);
  process.exit(1);
});

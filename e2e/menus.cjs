const fs = require("node:fs");
const puppeteer = require("puppeteer-core");
const CHROME =
  process.env.CHROME_PATH ??
  `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
const BASE = process.env.LIVE_URL ?? "http://localhost:8799";
const OUT = process.env.E2E_OUT ?? "/tmp/live-e2e";
fs.mkdirSync(OUT, { recursive: true });
(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    defaultViewport: { width: 1200, height: 800 },
    args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--enable-unsafe-swiftshader"],
  });
  const p = await browser.newPage();
  p.on("pageerror", (e) => console.log("pageerror", e.message));
  await p.goto(BASE + "/");
  await p.type("#name", "Ana");
  await p.click("#join-button");
  await p.waitForFunction(
    () => document.getElementById("people").textContent.includes("here") && !/Connecting/.test(document.getElementById("status").textContent),
    { timeout: 20000 },
  );
  await p.click("#camera");
  await new Promise((r) => setTimeout(r, 1000));
  await p.click("#camera-menu-button");
  await new Promise((r) => setTimeout(r, 500));
  await p.screenshot({ path: `${OUT}/camera-menu.png` });
  console.log("camera items:", await p.$$eval("#camera-menu [data-device]", (els) => els.map((e) => e.textContent)));
  await p.click("#more-button");
  await new Promise((r) => setTimeout(r, 300));
  await p.screenshot({ path: `${OUT}/more-menu.png` });
  console.log("status:", await p.$eval("#status", (e) => e.textContent), "| camera menu hidden:", await p.$eval("#camera-menu", (e) => e.hidden));
  await browser.close();
})().catch((e) => {
  console.error("ERROR", e.message);
  process.exit(1);
});

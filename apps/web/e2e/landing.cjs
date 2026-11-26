const fs = require("node:fs");
const puppeteer = require("puppeteer-core");
const CHROME =
  process.env.CHROME_PATH ??
  `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
const BASE = process.env.LIVE_URL ?? "http://localhost:8799";
const OUT = process.env.E2E_OUT ?? "/tmp/live-e2e";
fs.mkdirSync(OUT, { recursive: true });

// From the landing page, a name and Start room open a new room with you in it as host.
(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"],
  });
  for (const [label, width, height] of [
    ["desktop", 1280, 800],
    ["phone", 390, 844],
  ]) {
    const page = await (await browser.createBrowserContext()).newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => m.type() === "error" && !/cloudflareinsights|404/.test(m.text()) && errors.push(m.text()));
    await page.setViewport({ width, height, isMobile: label === "phone", hasTouch: label === "phone" });
    await page.goto(BASE + "/", { waitUntil: "networkidle0" });
    await page.screenshot({ path: `${OUT}/landing-${label}.png` });
    await page.click("#start button");
    await new Promise((r) => setTimeout(r, 400));
    console.log(label, "empty name stays:", new URL(page.url()).pathname, "| focused:", await page.evaluate(() => document.activeElement?.id));
    await page.type("#name", "Ana");
    await Promise.all([page.waitForNavigation(), page.keyboard.press("Enter")]);
    await page.waitForFunction(
      () => document.getElementById("people").textContent.includes("here") && !/Connecting|Reconnecting/.test(document.getElementById("status").textContent),
      { timeout: 20000 },
    );
    console.log(
      label,
      "landed:",
      new URL(page.url()).pathname,
      "|",
      await page.$eval("figure.mine figcaption", (e) => e.textContent),
      "| join screen hidden:",
      await page.$eval("#join", (e) => e.hidden),
      errors.length ? "| errors: " + errors.join(" ; ") : "| no errors",
    );
  }
  await browser.close();
  console.log("done");
})().catch((e) => {
  console.error("ERROR", e.message);
  process.exit(1);
});

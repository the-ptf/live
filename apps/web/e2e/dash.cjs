const fs = require("node:fs");
const puppeteer = require("puppeteer-core");
const CHROME =
  process.env.CHROME_PATH ??
  `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
const BASE = process.env.LIVE_URL ?? "http://localhost:8799";
const OUT = process.env.E2E_OUT ?? "/tmp/live-e2e";
fs.mkdirSync(OUT, { recursive: true });
const PASSWORD = process.env.DASH_PASSWORD ?? "local-test-pass";
const ready = (p) =>
  p.waitForFunction(
    () => document.getElementById("people").textContent.includes("here") && !/Connecting|Reconnecting/.test(document.getElementById("status").textContent),
    { timeout: 20000 },
  );
(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    defaultViewport: { width: 1200, height: 800 },
    args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--enable-unsafe-swiftshader"],
  });
  const join = async (name, url) => {
    const p = await (await browser.createBrowserContext()).newPage();
    await p.goto(url);
    await p.type("#name", name);
    await p.$eval("#preview-mic", (button) => button.getAttribute("aria-pressed") === "true" && button.click());
    await p.click("#join-button");
    await ready(p);
    return p;
  };
  const ana = await join("Ana", BASE + "/start");
  await ana.click("#camera");
  const bia = await join("Bia", ana.url());
  await bia.evaluate(() => document.getElementById("screen").click());
  await new Promise((r) => setTimeout(r, 3000));
  const d = await (await browser.createBrowserContext()).newPage();
  await d.goto(BASE + "/dash");
  console.log("login page:", await d.$eval("h1", (e) => e.textContent));
  await d.type('input[name="password"]', "wrong");
  await Promise.all([d.waitForNavigation(), d.click('button[type="submit"]')]);
  console.log("wrong password:", await d.$eval(".error", (e) => e.textContent));
  await d.type('input[name="password"]', PASSWORD);
  await Promise.all([d.waitForNavigation(), d.click('button[type="submit"]')]);
  console.log("cards:", await d.$$eval(".card", (els) => els.map((e) => e.innerText.replace(/\n/g, " ")).join(" | ")));
  console.log("rooms:", await d.$$eval("tbody tr", (els) => els.map((e) => e.innerText.replace(/\s+/g, " ")).join(" || ")));
  await d.screenshot({ path: `${OUT}/dash.png`, fullPage: true });
  await d.setViewport({ width: 390, height: 844 });
  await d.screenshot({ path: `${OUT}/dash-phone.png`, fullPage: true });
  await browser.close();
})().catch((e) => {
  console.error("ERROR", e.message);
  process.exit(1);
});

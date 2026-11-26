const fs = require("node:fs");
const puppeteer = require("puppeteer-core");
const CHROME =
  process.env.CHROME_PATH ??
  `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
const BASE = process.env.LIVE_URL ?? "http://localhost:8799";
const OUT = process.env.E2E_OUT ?? "/tmp/live-e2e";
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ready = (p) =>
  p.waitForFunction(
    () => document.getElementById("people").textContent.includes("here") && !/Connecting|Reconnecting/.test(document.getElementById("status").textContent),
    { timeout: 20000 },
  );
(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    defaultViewport: { width: 1200, height: 760 },
    args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--enable-unsafe-swiftshader"],
  });
  const page = async (ctx, name) => {
    const p = await ctx.newPage();
    p.on("pageerror", (e) => console.log("pageerror", name, e.message));
    return p;
  };
  const anaCtx = await browser.createBrowserContext();
  const biaCtx = await browser.createBrowserContext();
  const ana = await page(anaCtx, "Ana");
  await ana.goto(BASE + "/start");
  await ana.type("#name", "Ana");
  await ana.click("#join-button");
  await ready(ana);
  const room = ana.url();
  const bia = await page(biaCtx, "Bia");
  await bia.goto(room);
  await bia.type("#name", "Bia");
  await bia.click("#join-button");
  await ready(bia);
  await ana.waitForFunction(() => document.getElementById("people").textContent === "2 people here");
  console.log("Ana tile caption:", await ana.$eval("figure.mine figcaption", (e) => e.textContent));
  console.log("Bia sees remove buttons:", await bia.$$eval(".tile .remove", (els) => els.filter((e) => !e.hidden).length));
  const removeSel = "#gallery figure:not(.mine) .remove";
  console.log("Ana sees remove on Bia:", await ana.$eval(removeSel, (e) => !e.hidden));
  await ana.hover("#gallery figure:not(.mine)");
  await ana.click(removeSel);
  await sleep(300);
  await ana.screenshot({ path: `${OUT}/kick-armed.png` });
  console.log("armed label:", await ana.$eval(removeSel, (e) => e.textContent));
  await ana.click(removeSel);
  await bia.waitForFunction(() => !document.getElementById("join").hidden, { timeout: 10000 });
  console.log("Bia sees:", await bia.$eval("#join-error", (e) => e.textContent));
  await ana.waitForFunction(() => document.getElementById("people").textContent === "1 person here", { timeout: 10000 });
  console.log("Ana roster after:", await ana.$eval("#people", (e) => e.textContent));
  await bia.click("#join-button");
  await sleep(2500);
  console.log("Bia rejoin blocked:", await bia.$eval("#join-error", (e) => e.textContent), "| join visible:", await bia.$eval("#join", (e) => !e.hidden));
  const cris = await page(await browser.createBrowserContext(), "Cris");
  await cris.goto(room);
  await cris.type("#name", "Cris");
  await cris.click("#join-button");
  await ready(cris);
  console.log(
    "Cris (new browser) joined:",
    await cris.$eval("#people", (e) => e.textContent),
    "| Cris can remove:",
    await cris.$$eval(".tile .remove", (els) => els.filter((e) => !e.hidden).length),
  );
  const ana2 = await page(anaCtx, "Ana again");
  await ana.close();
  await ana2.goto(room);
  await ana2.click("#join-button");
  await ready(ana2);
  console.log("Ana back as host:", await ana2.$eval("figure.mine figcaption", (e) => e.textContent));
  await ana2.click("#more-button");
  await sleep(300);
  await ana2.screenshot({ path: `${OUT}/kick-menu.png` });
  await browser.close();
  console.log("done");
})().catch((e) => {
  console.error("ERROR", e.message);
  process.exit(1);
});

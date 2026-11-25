const fs = require("node:fs");
const puppeteer = require("puppeteer-core");
const CHROME =
  process.env.CHROME_PATH ??
  `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
const BASE = process.env.LIVE_URL ?? "http://localhost:8799";
const OUT = process.env.E2E_OUT ?? "/tmp/live-e2e";
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    defaultViewport: { width: 1400, height: 900 },
    args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
  });
  const open = async (name) => {
    const p = await (await browser.createBrowserContext()).newPage();
    p.on("pageerror", (e) => console.log("pageerror", name, e.message));
    p.on("console", (m) => m.type() === "error" && console.log("console", name, m.text()));
    return p;
  };
  const a = await open("Ana");
  await a.goto(BASE + "/");
  await a.click("#join-avatar-button");
  await a.waitForSelector("#picker[open]");
  await a.click('[data-material="fluffy"]');
  await a.click('[data-color="#ec4899"]');
  await a.click('[data-shape="ghost"]');
  await sleep(1200);
  await a.screenshot({ path: `${OUT}/picker.png` });
  await a.click("#picker-done");
  await a.type("#name", "Ana");
  await a.click("#join-button");
  await a.waitForFunction(
    () => !/Connecting|Reconnecting/.test(document.getElementById("status").textContent) && document.getElementById("people").textContent.includes("here"),
    { timeout: 20000 },
  );
  const b = await open("Bia");
  await b.goto(a.url());
  await b.type("#name", "Bia");
  await b.click("#join-button");
  await b.waitForFunction(
    () => !/Connecting|Reconnecting/.test(document.getElementById("status").textContent) && document.getElementById("people").textContent.includes("here"),
    { timeout: 20000 },
  );
  const anaLook = await b.evaluate(
    () =>
      new Promise((resolve) =>
        setTimeout(
          () => resolve(document.querySelector("#gallery figure:not(.mine) .avatar canvas, #gallery figure:not(.mine) .avatar svg") ? "bot shown" : "no bot"),
          1500,
        ),
      ),
  );
  console.log("Bia sees Ana's", anaLook);
  await b.click("#effects");
  await b.waitForSelector("#effects-sheet[open]");
  await b.click('[data-effect="big-head"]');
  await b.click("#effects-done");
  await b.click("#camera");
  await a.waitForFunction(
    () =>
      [...document.querySelectorAll("#gallery figure")].some(
        (f) => f.querySelector("figcaption").textContent.startsWith("Bia") && !f.querySelector("video").hidden && f.querySelector("video").videoWidth > 0,
      ),
    { timeout: 20000 },
  );
  console.log("Ana receives Bia's big-head camera");
  await sleep(1500);
  await a.screenshot({ path: `${OUT}/effect-bighead.png` });
  await b.click("#effects");
  await b.click('[data-effect="swirl"]');
  await b.click("#effects-done");
  await sleep(1500);
  await a.screenshot({ path: `${OUT}/effect-swirl.png` });
  await b.click("#effects");
  await b.click('[data-effect="none"]');
  await b.click("#effects-done");
  await sleep(1500);
  const still = await a.evaluate(
    () =>
      [...document.querySelectorAll("#gallery figure")].find((f) => f.querySelector("figcaption").textContent.startsWith("Bia"))?.querySelector("video")
        .videoWidth,
  );
  console.log("after None, Bia video width at Ana:", still);
  await a.screenshot({ path: `${OUT}/effect-none.png` });
  await browser.close();
  console.log("done");
})().catch((e) => {
  console.error("ERROR", e.message);
  process.exit(1);
});

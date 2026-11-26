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
const setSlider = (p, selector, value) =>
  p.$eval(
    selector,
    (input, next) => {
      input.focus();
      input.value = String(next);
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.blur();
    },
    value,
  );
const volumes = (p) => p.$$eval("#voices audio", (audios) => audios.map((audio) => `${audio.dataset.group}=${audio.volume.toFixed(2)}`).sort());

// Bia turns Ana's voice down and Ana's shared tab off; the levels stay Bia's own and survive Bia rejoining.
(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    defaultViewport: { width: 1200, height: 800 },
    args: [
      "--use-fake-ui-for-media-stream",
      "--use-fake-device-for-media-stream",
      "--auto-select-tab-capture-source-by-title=Tone",
      "--autoplay-policy=no-user-gesture-required",
      "--enable-unsafe-swiftshader",
    ],
  });
  const anaContext = await browser.createBrowserContext();
  const tone = await anaContext.newPage();
  await tone.goto("data:text/html,<title>Tone</title><body>tone</body>");
  const ana = await anaContext.newPage();
  await ana.goto(BASE + "/start");
  await ana.type("#name", "Ana");
  await ana.click("#join-button");
  await ready(ana);
  await ana.click("#mic");
  await ana.evaluate(() => document.getElementById("screen").click());
  const biaContext = await browser.createBrowserContext();
  const join = async () => {
    const bia = await biaContext.newPage();
    bia.on("pageerror", (e) => console.log("pageerror Bia", e.message));
    await bia.goto(ana.url());
    await bia.type("#name", "Bia");
    await bia.click("#join-button");
    await ready(bia);
    await bia.waitForFunction(() => document.querySelectorAll("#voices audio").length === 2, { timeout: 20000 });
    return bia;
  };
  let bia = await join();
  console.log(
    "sliders Bia sees:",
    await bia.$$eval(".tile .volume:not([hidden]) input", (inputs) => inputs.map((input) => `${input.getAttribute("aria-label")} ${input.value}%`)),
  );
  console.log("Ana sees no slider on her own tiles:", await ana.$$eval(".tile .volume:not([hidden])", (items) => items.length === 0));
  await setSlider(bia, "#gallery .volume:not([hidden]) input", 30);
  await setSlider(bia, "#screens .volume:not([hidden]) input", 0);
  console.log("Bia's levels:", await volumes(bia));
  await bia.screenshot({ path: `${OUT}/volume.png` });
  await bia.close();
  bia = await join();
  console.log("after Bia rejoins:", await volumes(bia), await bia.$eval("#gallery .volume:not([hidden]) input", (input) => input.value));
  await browser.close();
  console.log("done");
})().catch((e) => {
  console.error("ERROR", e.message);
  process.exit(1);
});

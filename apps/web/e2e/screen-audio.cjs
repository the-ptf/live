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

// Ana shares a tab titled "Tone" that plays a steady tone; Bia should get and play its sound track. Headless capture with
// fake devices hands back silent audio, so this checks the track's path, not that it's loud: listen in a real browser.
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
  await tone.evaluate(() => {
    const context = new AudioContext();
    const oscillator = context.createOscillator();
    oscillator.frequency.value = 440;
    oscillator.connect(context.destination);
    oscillator.start();
    return context.resume();
  });
  const ana = await anaContext.newPage();
  ana.on("pageerror", (e) => console.log("pageerror Ana", e.message));
  await ana.goto(BASE + "/");
  await ana.type("#name", "Ana");
  await ana.click("#join-button");
  await ready(ana);
  await ana.evaluate(() => document.getElementById("screen").click());
  await ana.waitForFunction(() => document.querySelector("#screens figcaption"), { timeout: 15000 });
  console.log("Ana's tile:", await ana.$eval("#screens figcaption", (e) => e.textContent));

  const bia = await (await browser.createBrowserContext()).newPage();
  bia.on("pageerror", (e) => console.log("pageerror Bia", e.message));
  await bia.goto(ana.url());
  await bia.type("#name", "Bia");
  await bia.click("#join-button");
  await ready(bia);
  await bia.waitForFunction(
    () => [...document.querySelectorAll("#voices audio")].some((audio) => audio.srcObject?.getAudioTracks()[0]?.readyState === "live" && !audio.paused),
    {
      timeout: 20000,
    },
  );
  console.log("ok: Bia plays the shared tab's sound");
  await bia.waitForSelector("#screens figcaption", { timeout: 15000 });
  console.log("Bia's tile:", await bia.$eval("#screens figcaption", (e) => e.textContent));
  await ana.evaluate(() => document.getElementById("screen").click());
  await bia.waitForFunction(() => document.querySelectorAll("#voices audio").length === 0, { timeout: 15000 });
  console.log("ok: stopping the share stops its sound at Bia");
  await browser.close();
  console.log("done");
})().catch((e) => {
  console.error("ERROR", e.message);
  process.exit(1);
});

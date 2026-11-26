const fs = require("node:fs");
const puppeteer = require("puppeteer-core");
const CHROME =
  process.env.CHROME_PATH ??
  `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
const BASE = process.env.LIVE_URL ?? "http://localhost:8799";
const OUT = process.env.E2E_OUT ?? "/tmp/live-e2e";
fs.mkdirSync(OUT, { recursive: true });
const live = (p) =>
  p.waitForFunction(
    () => !/Connecting|Reconnecting/.test(document.getElementById("status").textContent) && document.getElementById("people").textContent.includes("here"),
    { timeout: 20000 },
  );
(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    defaultViewport: { width: 1600, height: 1000 },
    args: [
      "--use-fake-ui-for-media-stream",
      "--use-fake-device-for-media-stream",
      "--auto-select-desktop-capture-source=Entire screen",
      "--enable-unsafe-swiftshader",
    ],
  });
  const page = async (name, url) => {
    const p = await (await browser.createBrowserContext()).newPage();
    p.on("pageerror", (e) => console.log("pageerror", name, e.message));
    await p.goto(url);
    await p.type("#name", name);
    await p.click("#join-button");
    await live(p);
    return p;
  };
  const host = await page("tianxu", BASE + "/start");
  const room = host.url();
  await host.click("#camera");
  const names = ["Teysão", "Naná", "Tião", "eimarquin", "Natan"];
  const others = [];
  for (const n of names) others.push(await page(n, room));
  await others[3].click("#camera");
  await host.waitForFunction(() => [...document.querySelectorAll("#gallery video")].filter((v) => !v.hidden && v.videoWidth > 0).length === 2, {
    timeout: 20000,
  });
  await new Promise((r) => setTimeout(r, 1500));
  console.log(
    await host.evaluate(() => ({
      tiles: document.querySelectorAll("#gallery figure").length,
      size: getComputedStyle(document.getElementById("gallery")).gridTemplateColumns,
      canvases: document.querySelectorAll("#gallery canvas, #gallery svg").length,
    })),
  );
  await host.screenshot({ path: `${OUT}/gallery.png` });
  await others[0].evaluate(() => document.getElementById("screen").click());
  await host.waitForFunction(() => [...document.querySelectorAll("#screens video")].some((v) => v.videoWidth > 0), { timeout: 20000 });
  await new Promise((r) => setTimeout(r, 1500));
  await host.screenshot({ path: `${OUT}/presenting.png` });
  await host.setViewport({ width: 390, height: 844 });
  await new Promise((r) => setTimeout(r, 800));
  await host.screenshot({ path: `${OUT}/phone.png` });
  await browser.close();
  console.log("done");
})().catch((e) => {
  console.error("ERROR", e.message);
  process.exit(1);
});

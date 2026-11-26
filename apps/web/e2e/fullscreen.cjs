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
const ANA = "#gallery figure:not(.mine) video:not([hidden])";
// Frames Bia's view of Ana's camera draws in one second; 0 means the picture is frozen.
const framesPerSecond = (p) =>
  p.evaluate(
    (selector) =>
      new Promise((resolve) => {
        const video = [...document.querySelectorAll(selector)].find((item) => item.closest("figure").querySelector("figcaption").textContent.startsWith("Ana"));
        let frames = 0;
        const count = () => {
          frames += 1;
          video.requestVideoFrameCallback(count);
        };
        video.requestVideoFrameCallback(count);
        setTimeout(() => resolve({ frames, paused: video.paused }), 1000);
      }),
    ANA,
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
    p.on("pageerror", (e) => console.log("pageerror", name, e.message));
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
  await bia.waitForFunction((selector) => [...document.querySelectorAll(selector)].some((video) => video.videoWidth > 0), { timeout: 20000 }, ANA);
  console.log("before full view:", await framesPerSecond(bia));
  await bia.evaluate(() => {
    [...document.querySelectorAll("#gallery figure")].find((figure) => figure.querySelector("figcaption").textContent.startsWith("Ana")).id = "ana-tile";
  });
  const anaTile = "#ana-tile";
  await bia.hover(anaTile);
  await new Promise((r) => setTimeout(r, 300));
  const shown = await bia.$eval(`${anaTile} .expand`, (button) => getComputedStyle(button).opacity);
  console.log("ok: hovering Ana's tile shows the full view button, opacity", shown);
  await bia.click(`${anaTile} .expand`);
  await bia.waitForFunction((tile) => document.querySelector(tile).classList.contains("focused"), { timeout: 5000 }, anaTile);
  const box = await bia.$eval(anaTile, (tile) => {
    const rect = tile.getBoundingClientRect();
    return { width: Math.round(rect.width), height: Math.round(rect.height), browserFullscreen: Boolean(document.fullscreenElement) };
  });
  console.log("ok: Ana's tile fills the page, not the browser's fullscreen:", JSON.stringify(box));
  if (box.width < 1100 || box.height < 650 || box.browserFullscreen) throw new Error("full view did not fill the page");
  await bia.screenshot({ path: `${OUT}/full-view.png` });
  await join("Cris", ana.url());
  await bia.waitForFunction(() => document.getElementById("people").textContent === "3 people here", { timeout: 15000 });
  console.log("still in full view after someone joins:", await bia.$eval(anaTile, (tile) => tile.classList.contains("focused")));
  console.log("in full view:", await framesPerSecond(bia));
  await bia.keyboard.press("Escape");
  await bia.waitForFunction(() => !document.querySelector(".tile.focused") && !document.getElementById("room").classList.contains("focusing"), {
    timeout: 5000,
  });
  console.log("ok: Escape leaves full view");
  console.log("after leaving full view:", await framesPerSecond(bia));
  await bia.evaluate((selector) => document.querySelector(selector).pause(), ANA);
  await new Promise((r) => setTimeout(r, 300));
  console.log("after something pauses it:", await framesPerSecond(bia));
  await bia.click(`${anaTile} .expand`);
  await bia.waitForFunction(() => document.getElementById("room").classList.contains("focusing"), { timeout: 5000 });
  await ana.click("#leave");
  await bia.waitForFunction(() => !document.getElementById("room").classList.contains("focusing"), { timeout: 15000 });
  console.log("ok: full view ends when Ana leaves");
  await browser.close();
  console.log("done");
})().catch((e) => {
  console.error("ERROR", e.message);
  process.exit(1);
});

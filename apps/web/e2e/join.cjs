const fs = require("node:fs");
const assert = require("node:assert/strict");
const puppeteer = require("puppeteer-core");
const CHROME =
  process.env.CHROME_PATH ??
  `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
const BASE = process.env.LIVE_URL ?? "http://localhost:8799";
const OUT = process.env.E2E_OUT ?? "/tmp/live-e2e";
fs.mkdirSync(OUT, { recursive: true });
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const pressed = (page, id) => page.$eval(id, (element) => element.getAttribute("aria-pressed"));

// The join screen: who's here, the host's name, the camera preview, the mic level, and both carried into the room.
(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    defaultViewport: { width: 1280, height: 800 },
    args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--autoplay-policy=no-user-gesture-required", "--enable-unsafe-swiftshader"],
  });
  const open = async (url) => {
    const page = await (await browser.createBrowserContext()).newPage();
    page.on("pageerror", (error) => console.log("pageerror", error.message));
    await page.goto(url);
    return page;
  };

  const rafa = await open(`${BASE}/start`);
  assert.equal(await rafa.$eval("#join-title", (element) => element.textContent), "Start a room");
  await rafa.type("#name", "Rafa");
  await rafa.click("#join-button");
  await rafa.waitForFunction(() => document.getElementById("join").hidden && location.pathname.startsWith("/r/"), { timeout: 20000 });
  await rafa.waitForFunction(() => document.getElementById("mic").getAttribute("aria-pressed") === "true", { timeout: 15000 });
  console.log("ok: Rafa starts a room with the mic on and the camera off:", await pressed(rafa, "#camera"));

  const bia = await open(rafa.url());
  await bia.waitForFunction(() => document.getElementById("here-text").textContent === "Rafa is here", { timeout: 15000 });
  assert.equal(await bia.$eval("#join-title", (element) => element.textContent), "Join Rafa's room");
  console.log("ok: Bia sees who's here and whose room it is");
  const levels = new Set();
  for (let i = 0; i < 30; i++) {
    levels.add(await bia.$eval("#preview-meter i", (bar) => bar.style.height));
    await wait(100);
  }
  assert.ok(levels.size > 2, `the mic meter moves (${[...levels].join(" ")})`);
  console.log("ok: the mic meter moves with the fake mic");
  await bia.type("#name", "Bia");
  assert.equal(await bia.$eval("#preview-name", (element) => element.textContent), "Bia");
  await bia.click("#preview-camera");
  await bia.waitForFunction(() => document.getElementById("preview-video").videoWidth > 0, { timeout: 15000 });
  console.log("ok: the camera preview plays before joining");
  await bia.screenshot({ path: `${OUT}/join.png` });
  const previewTrack = await bia.$eval("#preview-video", (video) => video.srcObject.getVideoTracks()[0].id);
  await bia.click("#join-button");
  await bia.waitForFunction(() => ["camera", "mic"].every((id) => document.getElementById(id).getAttribute("aria-pressed") === "true"), { timeout: 15000 });
  await rafa.waitForFunction(() => [...document.querySelectorAll("#gallery figure video")].some((video) => video.videoWidth > 0), { timeout: 20000 });
  console.log("ok: Bia joins with the mic and camera she picked, and Rafa sees her camera");
  assert.equal(await bia.$eval("#preview-video", (video) => video.srcObject), null);
  console.log("ok: the preview hands its camera over (preview track was", previewTrack.slice(0, 8), ")");

  await bia.click("#leave");
  await bia.waitForFunction(() => !document.getElementById("join").hidden, { timeout: 10000 });
  assert.equal(await bia.$eval("#join-label", (element) => element.textContent), "Join again");
  await bia.waitForFunction(() => document.getElementById("preview-video").videoWidth > 0, { timeout: 15000 });
  console.log("ok: leaving shows the join screen again with the camera preview back on");
  await browser.close();
  console.log("done");
})().catch((error) => {
  console.error("ERROR", error.message);
  process.exit(1);
});

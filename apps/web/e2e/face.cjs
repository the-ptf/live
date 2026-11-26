const assert = require("node:assert/strict");
const puppeteer = require("puppeteer-core");
const CHROME =
  process.env.CHROME_PATH ??
  `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
const BASE = process.env.LIVE_URL ?? "http://localhost:8799";
// FACE_VIDEO: a .y4m of a real face for --use-file-for-fake-video-capture; without one the fake camera has no face and
// the effect stays centered, which is what this checks by default.
const FACE_VIDEO = process.env.FACE_VIDEO;

// Camera effects follow the face: the detector loads only when an effect is turned on, and the camera keeps playing.
(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    defaultViewport: { width: 1280, height: 800 },
    args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", ...(FACE_VIDEO ? [`--use-file-for-fake-video-capture=${FACE_VIDEO}`] : [])],
  });
  const p = await browser.newPage();
  const errors = [];
  p.on("pageerror", (error) => errors.push(error.message));
  await p.goto(`${BASE}/start`);
  await p.type("#name", "Ana");
  await p.$eval("#preview-mic", (button) => button.getAttribute("aria-pressed") === "true" && button.click());
  await p.click("#join-button");
  await p.waitForFunction(() => /^1 person here/.test(document.getElementById("people").textContent), { timeout: 20000 });
  await p.click("#camera");
  await p.waitForFunction(() => [...document.querySelectorAll("#gallery video")].some((video) => video.videoWidth > 0), { timeout: 15000 });
  const before = await p.evaluate(() => performance.getEntriesByType("resource").some((entry) => entry.name.includes("/face/")));
  assert.equal(before, false, "the detector does not load until an effect is on");
  await p.click("#effects");
  await p.click('[data-effect="big-head"]');
  await p.click("#effects-done");
  await p.waitForFunction(() => performance.getEntriesByType("resource").some((entry) => entry.name.endsWith("/face/blaze_face_short_range.tflite")), {
    timeout: 30000,
  });
  const loaded = await p.evaluate(() =>
    performance
      .getEntriesByType("resource")
      .filter((entry) => entry.name.includes("/face/"))
      .map((entry) => entry.name.split("/").pop()),
  );
  for (const file of ["vision_bundle.mjs", "vision_wasm_internal.js", "vision_wasm_internal.wasm", "blaze_face_short_range.tflite"])
    assert.ok(loaded.includes(file), file);
  console.log("ok: turning an effect on loads the face detector:", loaded.join(", "));
  await new Promise((r) => setTimeout(r, 2500));
  const playing = await p.$eval("#gallery figure.mine video", (video) => video.videoWidth > 0 && !video.paused);
  assert.ok(playing, "the camera keeps playing with the effect on");
  assert.deepEqual(errors, []);
  console.log("ok: the camera keeps playing with the effect on, no page errors");
  await browser.close();
  console.log("done");
})().catch((error) => {
  console.error("ERROR", error.message);
  process.exit(1);
});

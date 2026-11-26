const fs = require("node:fs");
const puppeteer = require("puppeteer-core");
const CHROME =
  process.env.CHROME_PATH ??
  `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
const BASE = process.env.LIVE_URL ?? "http://localhost:8799";
const OUT = process.env.E2E_OUT ?? "/tmp/live-e2e";
fs.mkdirSync(OUT, { recursive: true });
async function until(page, fn, arg, label, timeout = 20000) {
  try {
    await page.waitForFunction(fn, { timeout, polling: 250 }, arg);
    console.log("ok:", label);
  } catch {
    console.log(
      "FAIL:",
      label,
      await page.evaluate(() => ({
        status: document.getElementById("status").textContent,
        people: document.getElementById("people").textContent,
        toast: document.getElementById("toast").textContent,
      })),
    );
    throw new Error(label);
  }
}
const videos = () =>
  [...document.querySelectorAll("figure.tile")].map((f) => ({
    label: f.querySelector("figcaption").textContent,
    w: f.querySelector("video").videoWidth,
  }));
(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: [
      "--use-fake-ui-for-media-stream",
      "--use-fake-device-for-media-stream",
      "--auto-select-desktop-capture-source=Entire screen",
      "--auto-accept-this-tab-capture",
      "--enable-usermedia-screen-capturing",
      "--allow-http-screen-capture",
    ],
  });
  const a = await (await browser.createBrowserContext()).newPage();
  const b = await (await browser.createBrowserContext()).newPage();
  await a.goto(BASE + "/start");
  await a.type("#name", "Ana");
  await a.$eval("#preview-mic", (button) => button.getAttribute("aria-pressed") === "true" && button.click());
  await a.click("#join-button");
  await until(
    a,
    () => !/Connecting|Reconnecting/.test(document.getElementById("status").textContent) && document.getElementById("people").textContent.includes("here"),
    null,
    "Ana live",
  );
  const room = a.url();
  console.log("room", room);
  await a.click("#camera");
  await until(a, () => document.querySelector("figure.tile video")?.videoWidth > 0, null, "Ana sees own camera");
  await b.goto(room);
  await b.type("#name", "Bia");
  await b.$eval("#preview-mic", (button) => button.getAttribute("aria-pressed") === "true" && button.click());
  await b.click("#join-button");
  await until(
    b,
    () => !/Connecting|Reconnecting/.test(document.getElementById("status").textContent) && document.getElementById("people").textContent.includes("here"),
    null,
    "Bia live",
  );
  await until(
    b,
    () =>
      [...document.querySelectorAll("figure.tile")].some(
        (f) => f.querySelector("figcaption").textContent.startsWith("Ana") && f.querySelector("video").videoWidth > 0,
      ),
    null,
    "Bia receives Ana's camera",
  );
  await b.click("#camera");
  await until(
    a,
    () =>
      [...document.querySelectorAll("figure.tile")].some(
        (f) => f.querySelector("figcaption").textContent.startsWith("Bia") && f.querySelector("video").videoWidth > 0,
      ),
    null,
    "Ana receives Bia's camera",
  );
  await a.evaluate(() => document.getElementById("screen").click());
  await until(
    b,
    () => [...document.querySelectorAll("#screens figure.tile")].some((f) => f.querySelector("video").videoWidth > 0),
    null,
    "Bia receives Ana's screen",
  );
  console.log("Bia tiles", await b.evaluate(videos));
  await b.screenshot({ path: `${OUT}/bia.png` });
  await a.click("#camera");
  await until(
    b,
    () =>
      [...document.querySelectorAll("#gallery figure.tile")].some(
        (f) => f.querySelector("figcaption").textContent.startsWith("Ana") && f.querySelector("video").hidden && f.querySelector(".avatar canvas, .avatar svg"),
      ),
    null,
    "Ana's camera turns into her bot",
  );
  await a.click("#leave");
  await until(b, () => document.getElementById("people").textContent === "1 person here", null, "Ana leaves roster");
  await until(b, () => document.querySelectorAll("#screens figure.tile").length === 0, null, "Ana's screen gone");
  await browser.close();
  console.log("ALL OK");
})().catch(async (e) => {
  console.error("ERROR", e.message);
  process.exit(1);
});

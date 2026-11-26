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
const capturePeerConnections = () => {
  const Original = window.RTCPeerConnection;
  window.__pcs = [];
  window.RTCPeerConnection = function (...args) {
    const pc = new Original(...args);
    window.__pcs.push(pc);
    return pc;
  };
  window.RTCPeerConnection.prototype = Original.prototype;
};
const sending = (p) =>
  p.evaluate(() => {
    const sender = window.__pcs
      .at(-1)
      .getSenders()
      .find((item) => item.track?.kind === "video");
    const parameters = sender.getParameters();
    const [encoding] = parameters.encodings;
    return `${encoding.maxBitrate / 1e6} Mbps, ${encoding.maxFramerate} fps max, ${parameters.degradationPreference}, hint ${sender.track.contentHint}`;
  });
// What Bia actually gets, from WebRTC stats. Headless Chrome's fake screen draws about 20 frames a second whatever it
// claims, so this shows the path works, not the quality a real screen reaches.
const receiving = (p) =>
  p.evaluate(async () => {
    await new Promise((r) => setTimeout(r, 4000));
    const stats = await window.__pcs.at(-1).getStats();
    const video = [...stats.values()]
      .filter((report) => report.type === "inbound-rtp" && report.kind === "video")
      .sort((a, b) => b.bytesReceived - a.bytesReceived)[0];
    return `${video.framesPerSecond ?? "?"} fps at ${video.frameWidth}x${video.frameHeight}`;
  });
const pick = async (p, selector) => {
  await p.click("#screen-menu-button");
  await p.waitForSelector(selector, { visible: true });
  await p.click(selector);
};

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    defaultViewport: { width: 1200, height: 800 },
    args: [
      "--use-fake-ui-for-media-stream",
      "--use-fake-device-for-media-stream",
      "--auto-select-desktop-capture-source=Entire screen",
      "--enable-unsafe-swiftshader",
    ],
  });
  const join = async (name, url) => {
    const p = await (await browser.createBrowserContext()).newPage();
    p.on("pageerror", (e) => console.log("pageerror", name, e.message));
    await p.evaluateOnNewDocument(capturePeerConnections);
    await p.goto(url);
    await p.type("#name", name);
    await p.$eval("#preview-mic", (button) => button.getAttribute("aria-pressed") === "true" && button.click());
    await p.click("#join-button");
    await ready(p);
    return p;
  };
  const ana = await join("Ana", BASE + "/start");
  await ana.evaluate(() => document.getElementById("screen").click());
  await ana.waitForFunction(
    () =>
      window.__pcs
        .at(-1)
        ?.getSenders()
        .some((sender) => sender.track?.kind === "video"),
    { timeout: 15000 },
  );
  const bia = await join("Bia", ana.url());
  await bia.waitForFunction(() => [...document.querySelectorAll("#screens video")].some((video) => video.videoWidth > 0), { timeout: 20000 });
  console.log("default, Ana sends:", await sending(ana));
  console.log("default, Bia gets:", await receiving(bia));
  await pick(ana, '[data-quality="1080p60"]');
  await new Promise((r) => setTimeout(r, 500));
  console.log("1080p 60, Ana sends:", await sending(ana));
  console.log("1080p 60, Bia gets:", await receiving(bia));
  await pick(ana, '[data-best="text"]');
  await new Promise((r) => setTimeout(r, 500));
  console.log("sharp text, Ana sends:", await sending(ana));
  await ana.click("#screen-menu-button");
  await ana.waitForSelector("#screen-menu:not([hidden])");
  await ana.screenshot({ path: `${OUT}/screen-menu.png` });
  await browser.close();
  console.log("done");
})().catch((e) => {
  console.error("ERROR", e.message);
  process.exit(1);
});

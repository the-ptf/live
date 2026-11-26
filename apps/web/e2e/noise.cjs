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
// What Ana's mic sender carries: RNNoise's output comes from a Web Audio destination, the plain mic from the device.
const sentMic = (p) =>
  p.evaluate(
    () =>
      window.__pcs
        .at(-1)
        ?.getSenders()
        .find((sender) => sender.track?.kind === "audio")?.track?.label ?? "nothing",
  );

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    defaultViewport: { width: 1200, height: 800 },
    args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--autoplay-policy=no-user-gesture-required"],
  });
  const join = async (name, url) => {
    const p = await (await browser.createBrowserContext()).newPage();
    p.on("pageerror", (e) => console.log("pageerror", name, e.message));
    p.on("console", (m) => m.type() === "error" && !/404|cloudflareinsights/.test(m.text()) && console.log("console", name, m.text().slice(0, 200)));
    await p.evaluateOnNewDocument(capturePeerConnections);
    await p.goto(url);
    await p.type("#name", name);
    await p.$eval("#preview-mic", (button) => button.getAttribute("aria-pressed") === "true" && button.click());
    await p.click("#join-button");
    await ready(p);
    return p;
  };
  const ana = await join("Ana", BASE + "/start");
  await ana.click("#mic");
  await ana.waitForFunction(
    () =>
      window.__pcs
        .at(-1)
        ?.getSenders()
        .some((sender) => sender.track?.kind === "audio"),
    { timeout: 15000 },
  );
  console.log("noise suppression on, Ana sends:", await sentMic(ana));
  const bia = await join("Bia", ana.url());
  await bia.waitForFunction(
    () => [...document.querySelectorAll("#voices audio")].some((audio) => audio.srcObject?.getAudioTracks()[0]?.readyState === "live"),
    { timeout: 20000 },
  );
  console.log("ok: Bia gets Ana's cleaned voice");
  await ana.click("#mic-menu-button");
  await ana.waitForSelector("#noise-toggle", { visible: true, timeout: 5000 });
  console.log("menu item:", await ana.$eval("#noise-toggle", (item) => `${item.textContent} ${item.getAttribute("aria-checked")}`));
  await ana.click("#noise-toggle");
  await ana.waitForFunction(
    () =>
      window.__pcs
        .at(-1)
        ?.getSenders()
        .some((sender) => sender.track?.kind === "audio" && sender.track.readyState === "live"),
    { timeout: 15000 },
  );
  await new Promise((r) => setTimeout(r, 1500));
  console.log("noise suppression off, Ana sends:", await sentMic(ana));
  await browser.close();
  console.log("done");
})().catch((e) => {
  console.error("ERROR", e.message);
  process.exit(1);
});

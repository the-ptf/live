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
// Test-only: keep every RTCPeerConnection the page makes, to read what the camera sends.
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
const cameraEncoding = (p) =>
  p.evaluate(() => {
    const sender = window.__pcs
      .at(-1)
      ?.getSenders()
      .find((item) => item.track?.kind === "video");
    const [encoding] = sender?.getParameters().encodings ?? [];
    return encoding ? `${encoding.maxBitrate} bps, scale ${encoding.scaleResolutionDownBy ?? 1}` : "none";
  });

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    defaultViewport: { width: 1200, height: 800 },
    args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--autoplay-policy=no-user-gesture-required", "--enable-unsafe-swiftshader"],
  });
  const join = async (name, url) => {
    const p = await (await browser.createBrowserContext()).newPage();
    p.on("pageerror", (e) => console.log("pageerror", name, e.message));
    await p.evaluateOnNewDocument(capturePeerConnections);
    await p.goto(url);
    await p.type("#name", name);
    await p.click("#join-button");
    await ready(p);
    return p;
  };
  const ana = await join("Ana", BASE + "/");
  await ana.click("#mic");
  await ana.click("#camera");
  const bia = await join("Bia", ana.url());
  await bia.waitForFunction(
    () => [...document.querySelectorAll("#voices audio")].some((audio) => audio.srcObject?.getAudioTracks()[0]?.readyState === "live" && !audio.paused),
    {
      timeout: 20000,
    },
  );
  console.log("ok: Bia plays Ana's voice");
  await bia.waitForFunction(
    () =>
      [...document.querySelectorAll("#gallery figure")].some(
        (f) => f.querySelector("figcaption").textContent.startsWith("Ana") && f.classList.contains("speaking"),
      ),
    {
      timeout: 15000,
    },
  );
  console.log("ok: Ana's tile rings green while the fake mic beeps");
  console.log("Ana mic icon at Bia:", await bia.$eval("#gallery figure:not(.mine) .mic-state", (e) => e.getAttribute("aria-label")));
  console.log("Bia's own mic icon:", await bia.$eval("#gallery figure.mine .mic-state", (e) => e.getAttribute("aria-label")));
  console.log("Ana camera with 2 people:", await cameraEncoding(ana));
  await bia.screenshot({ path: `${OUT}/voice.png` });
  await ana.click("#mic");
  await bia.waitForFunction(() => document.querySelectorAll("#voices audio").length === 0, { timeout: 15000 });
  console.log("ok: muting removes Ana's voice at Bia");
  const others = [];
  for (const name of ["Cris", "Davi", "Eva", "Fábio"]) others.push(await join(name, ana.url()));
  await ana.waitForFunction(() => document.getElementById("people").textContent === "6 people here", { timeout: 20000 });
  await new Promise((r) => setTimeout(r, 1000));
  console.log("Ana camera with 6 people:", await cameraEncoding(ana));
  await others.at(-1).close();
  await ana.waitForFunction(() => document.getElementById("people").textContent === "5 people here", { timeout: 20000 });
  await new Promise((r) => setTimeout(r, 1000));
  console.log("Ana camera back at 5 people:", await cameraEncoding(ana));
  await browser.close();
  console.log("done");
})().catch((e) => {
  console.error("ERROR", e.message);
  process.exit(1);
});

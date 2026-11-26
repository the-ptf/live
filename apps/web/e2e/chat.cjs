const fs = require("node:fs");
const assert = require("node:assert/strict");
const puppeteer = require("puppeteer-core");
const CHROME =
  process.env.CHROME_PATH ??
  `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
const BASE = process.env.LIVE_URL ?? "http://localhost:8799";
const OUT = process.env.E2E_OUT ?? "/tmp/live-e2e";
fs.mkdirSync(OUT, { recursive: true });
const PICTURE = process.env.CHAT_PICTURE ?? "/tmp/live-chat-fixture/pic.png";

// The room chat: text with a link and code, the unread badge, a picture, and history for whoever joins later.
(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    defaultViewport: { width: 1280, height: 800 },
    args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"],
  });
  const join = async (name, url) => {
    const p = await (await browser.createBrowserContext()).newPage();
    p.on("pageerror", (e) => console.log("pageerror", name, e.message));
    await p.goto(url);
    await p.type("#name", name);
    await p.$eval("#preview-mic", (button) => button.getAttribute("aria-pressed") === "true" && button.click());
    await p.click("#join-button");
    await p.waitForFunction(() => document.getElementById("join").hidden && /here/.test(document.getElementById("people").textContent), { timeout: 20000 });
    return p;
  };
  const ana = await join("Ana", `${BASE}/start`);
  const bia = await join("Bia", ana.url());

  await ana.click("#chat-button");
  await ana.waitForSelector("#chat-input", { visible: true });
  await ana.type("#chat-input", "olha o PR https://github.com/the-ptf/live/pull/12");
  await ana.keyboard.press("Enter");
  await ana.$eval("#chat-input", (input) => (input.value = '```\nsimulcast: { preferredRid: "f" }\n```'));
  await ana.keyboard.press("Enter");
  await bia.waitForFunction(() => document.getElementById("chat-badge").textContent === "2", { timeout: 10000 });
  console.log("ok: Bia's chat button shows 2 unread while closed");

  await bia.click("#chat-button");
  await bia.waitForFunction(() => document.querySelectorAll("#chat-list .chat-msg").length === 2, { timeout: 10000 });
  assert.equal(await bia.$eval("#chat-badge", (badge) => badge.hidden), true);
  assert.equal(await bia.$eval("#chat-list .chat-text a", (a) => a.href), "https://github.com/the-ptf/live/pull/12");
  assert.equal(await bia.$eval("#chat-list .chat-link b", (b) => b.textContent), "github.com");
  assert.equal(await bia.$eval("#chat-list .chat-code pre", (pre) => pre.textContent), 'simulcast: { preferredRid: "f" }');
  console.log("ok: Bia sees the link, its card and the code block");

  const [chooser] = await Promise.all([bia.waitForFileChooser(), bia.click("#chat-attach")]);
  await chooser.accept([PICTURE]);
  await bia.waitForSelector("#chat-attachment img", { visible: true });
  await bia.type("#chat-input", "<img src=x onerror=alert(1)> print do jogo");
  await bia.keyboard.press("Enter");
  await ana.waitForFunction(() => document.querySelector("#chat-list .chat-image")?.complete, { timeout: 10000 });
  const lastText = await ana.$$eval("#chat-list .chat-text", (nodes) => nodes.at(-1).textContent);
  assert.equal(lastText, "<img src=x onerror=alert(1)> print do jogo");
  assert.equal(await ana.$$eval("#chat-list .chat-text img", (imgs) => imgs.length), 0);
  console.log("ok: a picture arrives, and HTML in a message stays text");
  await ana.screenshot({ path: `${OUT}/chat.png` });

  const cris = await join("Cris", ana.url());
  await cris.waitForFunction(() => document.querySelectorAll("#chat-list .chat-msg").length === 3, { timeout: 10000 });
  assert.equal(await cris.$eval("#chat-badge", (badge) => badge.hidden), true);
  console.log("ok: Cris joins late and gets the 3 messages, without an unread count");

  const phone = await (await browser.createBrowserContext()).newPage();
  await phone.emulate(puppeteer.KnownDevices["iPhone 15 Pro"]);
  await phone.goto(ana.url());
  await phone.type("#name", "Duda");
  await phone.$eval("#preview-mic", (button) => button.getAttribute("aria-pressed") === "true" && button.click());
  await phone.click("#join-button");
  await phone.waitForFunction(() => document.getElementById("chat-badge").hidden && document.querySelectorAll("#chat-list .chat-msg").length === 3, {
    timeout: 15000,
  });
  await phone.click("#chat-button");
  await new Promise((r) => setTimeout(r, 400));
  const sheet = await phone.$eval("#chat", (chat) => {
    const box = chat.getBoundingClientRect();
    return box.width === innerWidth && box.height === innerHeight;
  });
  assert.ok(sheet, "on a phone the chat fills the screen");
  await phone.screenshot({ path: `${OUT}/chat-phone.png` });
  await phone.click("#chat-close");
  assert.equal(await phone.$eval("#room", (room) => room.classList.contains("chat-closed")), true);
  console.log("ok: on a phone the chat opens full screen and closes back to the call");
  await browser.close();
  console.log("done");
})().catch((error) => {
  console.error("ERROR", error.message);
  process.exit(1);
});

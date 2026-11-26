// Renders the icon and the link preview to PNGs in src/brand: `node scripts/brand.cjs` from apps/web, after changing
// src/brand/icon.svg or the preview below. Needs the Chrome puppeteer-core drives (CHROME_PATH, default Playwright's).
const fs = require("node:fs");
const path = require("node:path");
const puppeteer = require("puppeteer-core");

const CHROME =
  process.env.CHROME_PATH ??
  `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
const brand = path.join(__dirname, "../src/brand");
const svg = fs.readFileSync(path.join(brand, "icon.svg"), "utf8");
const data = (text) => `data:image/svg+xml;base64,${Buffer.from(text).toString("base64")}`;
const font = (file) => fs.readFileSync(require.resolve(file)).toString("base64");
const geist = font("@fontsource-variable/geist/files/geist-latin-wght-normal.woff2");
const serif = font("@fontsource/instrument-serif/files/instrument-serif-latin-400-italic.woff2");

// The home-screen icon is square: iOS rounds it itself, and corners left transparent would show black.
const square = svg.replace('rx="114"', 'rx="0"');

const preview = `<!doctype html><html><head><style>
html,body{margin:0;width:1200px;height:630px}
body{position:relative;overflow:hidden;font-family:Geist,sans-serif;text-align:center;color:#f7f1ea;
background:linear-gradient(180deg,#141a3d 0%,#2a2a63 26%,#5a3f84 50%,#a8566f 70%,#e3826a 86%,#f6b47e 100%)}
.glow{position:absolute;left:50%;top:-60px;width:620px;height:620px;transform:translateX(-50%);background:radial-gradient(circle,rgba(255,120,110,.5),rgba(255,120,110,.12) 38%,transparent 64%)}
.mark{position:relative;margin-top:96px;width:96px;height:96px;filter:drop-shadow(0 0 30px rgba(255,110,110,.9)) drop-shadow(0 0 70px rgba(255,90,95,.6))}
h1{position:relative;margin:30px 0 0;font-weight:600;font-size:76px;letter-spacing:-.03em;line-height:1}
h1 span{display:block;font-family:Serif,serif;font-style:italic;font-weight:400;font-size:82px;color:#f3c98b;margin-top:10px}
.url{position:absolute;left:0;right:0;bottom:34px;font-size:24px;font-weight:500;color:rgba(255,255,255,.85)}
</style></head><body><div class="glow"></div>
<svg class="mark" viewBox="0 0 146 145" fill="#fff5f0">${svg.match(/<path[^]*?\/>/g).join("")}</svg>
<h1>Your squad is watching.<span>Play it live.</span></h1><div class="url">live.milagre.cloud</div></body></html>`;

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true });
  const page = await browser.newPage();
  for (const [name, size, source] of [
    ["icon-512.png", 512, svg],
    ["icon-192.png", 192, svg],
    ["apple-touch-icon.png", 180, square],
  ]) {
    await page.setViewport({ width: size, height: size });
    await page.setContent(`<body style="margin:0;background:transparent"><img src="${data(source)}" width="${size}" height="${size}"></body>`);
    await page.screenshot({ path: path.join(brand, name), omitBackground: true });
  }
  await page.setViewport({ width: 1200, height: 630 });
  await page.setContent(preview, { waitUntil: "load" });
  // Fonts go in through the FontFace API: a large data: URL in an @font-face rule never registered here.
  await page.evaluate(
    async (sans, italic) => {
      const bytes = (base64) => Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
      for (const face of [new FontFace("Geist", bytes(sans), { weight: "100 900" }), new FontFace("Serif", bytes(italic), { style: "italic" })])
        document.fonts.add(await face.load());
    },
    geist,
    serif,
  );
  await page.screenshot({ path: path.join(brand, "og.png") });
  await browser.close();
  console.log("wrote icon-512.png, icon-192.png, apple-touch-icon.png, og.png");
})();

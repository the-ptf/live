import { build } from "esbuild";
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { createRequire } from "node:module";

// RNNoise's worklet and wasm (an AudioWorklet loads by URL) and the landing page's fonts are served as files, so they are
// copied next to the bundle.
const require = createRequire(import.meta.url);
const dist = new URL("./dist/", import.meta.url).pathname;
mkdirSync(dist, { recursive: true });
for (const [from, to] of [
  ["@sapphi-red/web-noise-suppressor/rnnoiseWorklet.js", "rnnoise-worklet.txt"],
  ["@sapphi-red/web-noise-suppressor/rnnoise.wasm", "rnnoise.bin"],
  ["@sapphi-red/web-noise-suppressor/rnnoise_simd.wasm", "rnnoise_simd.bin"],
  ["@fontsource-variable/geist/files/geist-latin-wght-normal.woff2", "geist.bin"],
])
  copyFileSync(require.resolve(from), dist + to);

// The face detector for camera effects is a few MB of wasm, too big to bundle into the Worker: it goes out as static
// assets under /face/, loaded only when someone turns an effect on.
const face = new URL("./dist/assets/face/", import.meta.url).pathname;
mkdirSync(face, { recursive: true });
const vision = dirname(require.resolve("@mediapipe/tasks-vision"));
for (const [from, to] of [
  [`${vision}/vision_bundle.mjs`, "vision_bundle.mjs"],
  [`${vision}/wasm/vision_wasm_internal.js`, "vision_wasm_internal.js"],
  [`${vision}/wasm/vision_wasm_internal.wasm`, "vision_wasm_internal.wasm"],
  [new URL("./face/blaze_face_short_range.tflite", import.meta.url).pathname, "blaze_face_short_range.tflite"],
  [new URL("./face/selfie_segmenter.tflite", import.meta.url).pathname, "selfie_segmenter.tflite"],
])
  copyFileSync(from, face + to);

await build({
  entryPoints: [new URL("./src/landing.js", import.meta.url).pathname],
  outfile: new URL("./dist/landing.txt", import.meta.url).pathname,
  bundle: true,
  format: "esm",
  minify: true,
  target: "es2022",
});

await build({
  entryPoints: [new URL("./src/client.js", import.meta.url).pathname],
  outfile: new URL("./dist/app.txt", import.meta.url).pathname,
  bundle: true,
  format: "esm",
  minify: true,
  target: "es2022",
  legalComments: "eof",
  banner: {
    js: "/*! open-bot-avatar | MIT License | Copyright (c) 2026 Dominik Scholz | https://github.com/dominikscholz/open-bot-avatar */\n/*! @sapphi-red/web-noise-suppressor | MIT License | https://github.com/sapphi-red/web-noise-suppressor */",
  },
  loader: { ".txt": "js" },
});

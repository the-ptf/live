import { build } from "esbuild";
import { copyFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";

// RNNoise's worklet and wasm are served as files (an AudioWorklet loads by URL), so they are copied next to the bundle.
const require = createRequire(import.meta.url);
const dist = new URL("./dist/", import.meta.url).pathname;
mkdirSync(dist, { recursive: true });
for (const [from, to] of [
  ["@sapphi-red/web-noise-suppressor/rnnoiseWorklet.js", "rnnoise-worklet.txt"],
  ["@sapphi-red/web-noise-suppressor/rnnoise.wasm", "rnnoise.bin"],
  ["@sapphi-red/web-noise-suppressor/rnnoise_simd.wasm", "rnnoise_simd.bin"],
])
  copyFileSync(require.resolve(from), dist + to);

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

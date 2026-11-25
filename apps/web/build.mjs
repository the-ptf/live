import { build } from "esbuild";

await build({
  entryPoints: [new URL("./src/client.js", import.meta.url).pathname],
  outfile: new URL("./dist/app.txt", import.meta.url).pathname,
  bundle: true,
  format: "esm",
  minify: true,
  target: "es2022",
  legalComments: "eof",
  banner: {
    js: "/*! open-bot-avatar | MIT License | Copyright (c) 2026 Dominik Scholz | https://github.com/dominikscholz/open-bot-avatar */",
  },
  loader: { ".txt": "js" },
});

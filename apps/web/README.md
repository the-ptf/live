# Milagre Live: web

`live.milagre.cloud`: talk, share your screen or turn on your camera with anyone who has the link. Joining is typing a
name; there are no accounts. A room lives while someone is in it. It keeps no video and no messages: only the hash of its host key and the browsers the host removed.

## How it works

- `GET /` is the landing page (`src/landing.html`): a dawn sky with twinkling stars, a name and Start room. Its
  script (`src/landing.js`, bundled to `dist/landing.txt`) creates the room and its host key, keeps the name, and opens
  `/r/<room>?join=1`, where the call joins at once. It is the only page `robots.txt` lets search engines list. `GET
  /start` and `GET /r/<room>` serve the call (`src/page.html`, plus `src/client.js` bundled into `dist/app.txt`);
  `build.mjs` builds both, and wrangler runs it before `dev` and `deploy`. Room ids and host keys come from
  `src/ids.js`.
- The icon is `src/brand/icon.svg`; `node scripts/brand.cjs` renders `icon-192.png`, `icon-512.png`,
  `apple-touch-icon.png` and the link preview `og.png` from it. The Worker serves them with `/manifest.webmanifest`.
- Everyone gets a tile, laid out at the largest 16:9 size where all of them fit; a shared screen takes the stage and the
  people move to a column. Controls sit in one floating dock: camera (and which camera), screen, effects, avatar, a menu
  with the link and who's here, and leave.
- Someone without a camera shows an [Open Bot Avatar](https://github.com/dominikscholz/open-bot-avatar) (MIT): the
  package's starters plus its gallery, copied into `src/bots.json` (license in `src/bots.LICENSE`). Each person picks a
  shape, a color and Flat or Fluffy (`src/avatars.js`); the choice is kept in the browser and sent as an `avatar`
  message, so everyone sees it. Fluffy bots share one WebGL context. Someone who hasn't sent one gets a bot from their
  peer id. Bots rest in a calm pose (`reducedMotion`, eyes still following the pointer) and hop for a moment when
  clicked.
- Voice (`src/voice.js`): the mic starts off; turning it on the first time publishes an Opus track. Muting after that
  keeps the mic open and sends silence (`track.enabled = false`), like Discord, and the room shares who is muted:
  stopping and reopening it on every click made other sound dip, from Bluetooth headsets changing mode and from
  renegotiating. Every voice in the room plays through a hidden `<audio>`; a browser that
  blocks sound before a click shows a notice and starts them on the next click. One `AudioContext` measures each voice
  ten times a second for the green speaking ring, without routing it to the speakers.
- A screen share carries its sound as a separate `screen-audio` track (128 kbps): the shared tab's sound, or the whole
  computer's where the browser offers it. Chrome and Edge ask with a "Share audio" switch in the picker; Safari and
  Firefox share no sound. Viewers play it like a voice, and deafen silences it too. A whole screen's sound would carry
  the call playing on the sharer's computer back to everyone, so the page asks Chrome to leave its own sound out
  (`restrictOwnAudio`), hides the Live tab from the picker, and drops the sound where the browser can't leave the call
  out.
- Volume is each listener's own: hovering a person's tile shows a slider for their voice, and a shared screen with
  sound gets one for the stream, from 0 to 100%. Levels are kept in the browser by the person's name (`voice:<name>`,
  `stream:<name>`), so they survive rejoining. Going past 100% would mean playing voices through Web Audio, which can
  defeat echo cancellation for people on speakers.
- Noise suppression (`src/noise.js`, on by default, switched in the mic menu): the mic runs through RNNoise from
  `@sapphi-red/web-noise-suppressor` (MIT) in an AudioWorklet, on top of the browser's own. The Worker serves the
  worklet and both wasm builds from `/noise/`, copied into `dist/` by `build.mjs`; the page's CSP allows
  `wasm-unsafe-eval` for them.
- Screen quality (`SCREEN_PRESETS` in `src/media.mjs`, the chevron next to Share screen): 720p 30, 1080p 30 (the
  default), 1080p 60 or the screen's own size at 60 fps, at 2.5, 4, 6 or 8 Mbps, and best for smooth motion or sharp
  text (`contentHint` and `degradationPreference`). A running share changes in place, and its bitrate rides along with
  its track so the stats count it.
- Deafen works like Discord's: every voice keeps arriving but none plays, your mic goes off, and undeafening turns it
  back on if it was on. The room shares each person's deafened state so their tile shows it.
- Camera bitrate (`src/media.mjs`): 0.9 Mbps at full resolution, 0.3 Mbps at half resolution once the room has six
  people, changed in place with `setParameters` as people come and go. The stats use the same numbers.
- Camera effects (`src/effects.js`) run the camera through a WebGL distortion shader into a canvas and send the canvas's
  track, swapped in with `replaceTrack`, so changing effect never renegotiates. A browser tab in the background may draw
  them at a lower frame rate.
- Whoever starts a room is its host: their browser keeps a random key for it (`milagre-live:host:<room>`), the room keeps
  the key's SHA-256 from the first join that brings one, and the same browser is host again when it comes back. The
  host removes people (two clicks, on the tile or in the ··· list); the room closes their socket with 4403 and turns
  away that browser's client id from then on. A new private window has a new id, so removal is a door, not a lock.
- `/dash` is the owner's stats: rooms open, people live, cameras, screens, an upper bound on video GB/hour, and the
  day's joins, rooms started and peak. Each room reports its roster on every change to one `LiveStats` Durable Object;
  a room silent for 12 hours drops off. The page signs in with the `DASH_PASSWORD` secret and keeps a 30-day HttpOnly
  cookie signed with it, so changing the password signs everyone out.
- The Cost section and the video chart read what Cloudflare billed, not the estimate: `LiveStats` asks the GraphQL
  Analytics API for Realtime SFU and TURN egress per day (`callsUsageAdaptiveGroups`, `callsTurnUsageAdaptiveGroups`)
  at most every 5 minutes and keeps each month's total, since the API only reaches back about 90 days. Cost is the
  egress past 1,000 GB a month at $0.05/GB (`usage.mjs`); TURN is free next to the SFU. Without `CF_ANALYTICS_TOKEN`
  the page falls back to the estimate. The forecast chart holds the average of the last complete days (up to a week)
  to the end of the month (`forecastOf`) and says when the free 1,000 GB would run out.
- The browser opens its Realtime session with a data channel and waits until it's connected before pushing or pulling:
  Realtime refuses either on a session that isn't connected, and Chrome rejects the answer to an idle audio or video
  line. A dropped connection rejoins quietly.
- Each room is a `LiveRoom` Durable Object on the WebSocket Hibernation API. A peer's name, session and published tracks
  are the attachment on its socket, so an idle room costs no duration. Pings get `pong` without waking it.
- Video goes through the Cloudflare Realtime SFU: every browser holds one `RTCPeerConnection` and one Realtime session,
  pushes its own tracks and pulls everyone else's. The Worker calls Realtime on the browser's behalf, so the app token
  never reaches a browser. The room only forwards a call on the caller's own session, for tracks named after the caller
  or published by someone in the room.
- TURN credentials come from a Realtime TURN key when one is set, else the page uses `stun:stun.cloudflare.com:3478`.

WebSocket messages: the room sends `welcome` (`id`, `token`, `iceServers`) and `peers` (everyone's `id`, `name`,
`sessionId`, `tracks`); a browser sends `publish` with its current `tracks` (`{name, source: "screen" | "camera"}`,
named `<peer id>-<source>-<n>`) and `avatar` with `{shape, color, material: "flat" | "fluffy"}`. Calls to Realtime go to `/api/rooms/<room>/sfu/<path>` with `Authorization: Bearer
<token>`. API requests must come from `PUBLIC_ORIGIN`.

## Credentials

The Worker's secrets are `REALTIME_APP_ID`, `REALTIME_APP_TOKEN` (a Realtime SFU app) and `TURN_KEY_ID`,
`TURN_KEY_TOKEN` (a Realtime TURN key), both named `milagre-live` in the account. Their only copy is
`~/.private_keys/live.env` on the maintainer's Mac; Cloudflare shows a secret once, at creation. Creating them needs the account
token in `~/.private_keys/cloudflare.env` to hold **Realtime: Edit** and **Cloudflare Realtime: Edit**.

```sh
set -a; . ~/.private_keys/cloudflare.env; . ~/.private_keys/live.env; set +a
python3 -c 'import json,os; print(json.dumps({k: os.environ[k] for k in ("REALTIME_APP_ID","REALTIME_APP_TOKEN","TURN_KEY_ID","TURN_KEY_TOKEN")}))' \
  | npx wrangler@4.147.0 secret bulk
```

`npm run dev` reads them with `--env-file ~/.private_keys/live.env`.

`DASH_PASSWORD` lives on its own in `~/.private_keys/live-dash-password` (raw, mode 600): it has characters a shell or
`.env` parser would mangle, so set it with Python piping into `wrangler secret bulk`, never by sourcing it. Locally,
pass a throwaway one: `--var DASH_PASSWORD:local-test-pass`.

`CF_ANALYTICS_TOKEN` is a token named `milagre-live-analytics` with only **Account Analytics: Read**, and
`CF_ACCOUNT_ID` the account it reads. The token lives raw in `~/.private_keys/live-analytics-token`; set both the
same way as `DASH_PASSWORD`. Never give the Worker the broader account token.

## Run and deploy

Run these from the repo root (they target this app) or from `apps/web`. `npm run build` bundles the page script; `dev` and
`deploy` run it for you.

```sh
npm install
npm run dev          # http://localhost:8799, with the secrets from ~/.private_keys/live.env
npm test             # room and stats logic
npm run typecheck
npm run lint
npm run deploy       # needs CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID in the environment
```

### End-to-end checks

`e2e/` drives real headless Chromium peers with a fake camera and screen through the real Realtime SFU:

- `landing.cjs`: a name and Start room on the landing page land you in a new room as its host, on desktop and phone.
- `two-peers.cjs`: camera both ways, a screen share, a camera turning back into the bot, leaving.
- `custom.cjs`: a fluffy avatar choice reaching the other person, and camera effects on and off.
- `kick.cjs`: the host removes someone, who can't rejoin from that browser; the host comes back as host.
- `dash.cjs`: the stats login and the numbers for a live room.
- `noise.cjs`: the mic going out through RNNoise and reaching the other person, and switching it off.
- `screen-quality.cjs`: what a share may send at each quality and focus, changed while sharing.
- `bots.cjs`: a bot holds still, hops after a click, and settles again.
- `volume.cjs`: a person's voice and a shared screen's sound turned down on one side only, kept after rejoining.
- `fullscreen.cjs`: a tile going fullscreen and back keeps drawing frames, stays fullscreen when someone joins, and a
  paused live video starts again.
- `screen-audio.cjs`: a shared tab's sound reaching and playing at the other person, and stopping with the share.
- `voice.cjs`: a voice reaching the other person, the speaking ring, mute, deafen, and the camera rate at six people.
- `gallery.cjs`, `menus.cjs`: screenshots of a six-person room, a shared screen, a phone and the dock menus.

They need puppeteer-core's Chrome: `CHROME_PATH` (default: Playwright's Chromium 1243). `LIVE_URL` picks the target
(default `http://localhost:8799`), `E2E_OUT` the screenshot folder (default `/tmp/live-e2e`), `DASH_PASSWORD` the stats
password. `npm run e2e` runs `two-peers`, `custom`, `kick` and `voice`.

`wrangler dev` rewrites `Origin` to the route's host unless `--local-upstream` points back at the dev server; the `dev`
script does that. Camera and screen capture need HTTPS or `localhost`. iOS Safari can't capture the screen, so the page
hides Share screen there.

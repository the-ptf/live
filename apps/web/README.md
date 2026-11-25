# Milagre Live: web

`live.milagre.cloud`: talk, share your screen or turn on your camera with anyone who has the link. Joining is typing a
name; there are no accounts. A room lives while someone is in it. It keeps no video and no messages: only the hash of its host key and the browsers the host removed.

## How it works

- `GET /` and `GET /r/<room>` serve one page (`src/page.html`, plus `src/client.js` bundled by `build.mjs` into
  `dist/app.txt`, which wrangler runs before `dev` and `deploy`). Starting a room makes a random `xxxx-xxxx-xxxx` id in
  the browser.
- Everyone gets a tile, laid out at the largest 16:9 size where all of them fit; a shared screen takes the stage and the
  people move to a column. Controls sit in one floating dock: camera (and which camera), screen, effects, avatar, a menu
  with the link and who's here, and leave.
- Someone without a camera shows an [Open Bot Avatar](https://github.com/dominikscholz/open-bot-avatar) (MIT): the
  package's starters plus its gallery, copied into `src/bots.json` (license in `src/bots.LICENSE`). Each person picks a
  shape, a color and Flat or Fluffy (`src/avatars.js`); the choice is kept in the browser and sent as an `avatar`
  message, so everyone sees it. Fluffy bots share one WebGL context. Someone who hasn't sent one gets a bot from their
  peer id.
- Voice (`src/voice.js`): the mic starts off; turning it on publishes an Opus track like any other, and turning it off
  unpublishes it, so a muted mic sends nothing. Every voice in the room plays through a hidden `<audio>`; a browser that
  blocks sound before a click shows a notice and starts them on the next click. One `AudioContext` measures each voice
  ten times a second for the green speaking ring, without routing it to the speakers.
- A screen share carries its sound as a separate `screen-audio` track (128 kbps): the shared tab's sound, or the whole
  computer's where the browser offers it. Chrome and Edge ask with a "Share audio" switch in the picker; Safari and
  Firefox share no sound. Viewers play it like a voice, and deafen silences it too.
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

- `two-peers.cjs`: camera both ways, a screen share, a camera turning back into the bot, leaving.
- `custom.cjs`: a fluffy avatar choice reaching the other person, and camera effects on and off.
- `kick.cjs`: the host removes someone, who can't rejoin from that browser; the host comes back as host.
- `dash.cjs`: the stats login and the numbers for a live room.
- `screen-audio.cjs`: a shared tab's sound reaching and playing at the other person, and stopping with the share.
- `voice.cjs`: a voice reaching the other person, the speaking ring, mute, deafen, and the camera rate at six people.
- `gallery.cjs`, `menus.cjs`: screenshots of a six-person room, a shared screen, a phone and the dock menus.

They need puppeteer-core's Chrome: `CHROME_PATH` (default: Playwright's Chromium 1243). `LIVE_URL` picks the target
(default `http://localhost:8799`), `E2E_OUT` the screenshot folder (default `/tmp/live-e2e`), `DASH_PASSWORD` the stats
password. `npm run e2e` runs `two-peers`, `custom`, `kick` and `voice`.

`wrangler dev` rewrites `Origin` to the route's host unless `--local-upstream` points back at the dev server; the `dev`
script does that. Camera and screen capture need HTTPS or `localhost`. iOS Safari can't capture the screen, so the page
hides Share screen there.

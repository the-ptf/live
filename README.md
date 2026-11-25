# Milagre Live

Talk, share your screen or turn on your camera with anyone who has a link, on Cloudflare Realtime. Live at
[live.milagre.cloud](https://live.milagre.cloud).

| Path           | What                                                                                                                           |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `apps/web`     | The Cloudflare Worker behind live.milagre.cloud: the page, rooms, the Realtime proxy and `/dash`. [README](apps/web/README.md) |
| `apps/discord` | Next: the same rooms as a Discord Activity in voice channels.                                                                  |
| `packages/`    | Code shared between apps, once there are two.                                                                                  |

```sh
npm install
npm run dev        # apps/web at http://localhost:8799
npm test
npm run typecheck
npm run lint
npm run format:check
npm run deploy     # apps/web, with CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID in the environment
npm run e2e        # real headless browsers against LIVE_URL (default http://localhost:8799)
```

Node 22 or later. MIT licensed; `apps/web/src/bots.json` holds Open Bot Avatar's gallery under its own MIT notice.

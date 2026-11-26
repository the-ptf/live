import page from "./page.html";
import landing from "./landing.html";
import iconSvg from "./brand/icon.svg";
import icon192 from "./brand/icon-192.png";
import icon512 from "./brand/icon-512.png";
import appleTouchIcon from "./brand/apple-touch-icon.png";
import ogImage from "./brand/og.png";
import geist from "../dist/geist.bin";
import script from "../dist/app.txt";
import landingScript from "../dist/landing.txt";
import rnnoiseWorklet from "../dist/rnnoise-worklet.txt";
import rnnoise from "../dist/rnnoise.bin";
import rnnoiseSimd from "../dist/rnnoise_simd.bin";
import { createRoom, FALLBACK_ICE, ROOM_ID, type Answer, type IceServer, type Peer, type Room } from "./room.mjs";
import { createStats, type Report } from "./stats.mjs";
import { costOf, daysFrom, USAGE_QUERY, type UsageDay } from "./usage.mjs";
import { passwordMatches, renderDash, renderLogin, sessionCookie, signedIn, signOutCookie } from "./dash.mjs";

interface Env {
  ROOMS: DurableObjectNamespace;
  STATS: DurableObjectNamespace;
  DASH_PASSWORD?: string;
  PUBLIC_ORIGIN: string;
  ALLOW_LOCALHOST?: string;
  REALTIME_APP_ID?: string;
  REALTIME_APP_TOKEN?: string;
  TURN_KEY_ID?: string;
  TURN_KEY_TOKEN?: string;
  CF_ACCOUNT_ID?: string;
  CF_ANALYTICS_TOKEN?: string;
  ASSETS: Fetcher;
}

const REALTIME = "https://rtc.live.cloudflare.com/v1";
const INTERNAL = "https://room.internal";
const API = /^\/api\/rooms\/([a-z]{4}-[a-z]{4}-[a-z]{4})\/(ws|ice|who|sfu\/.+)$/;

const SECURITY_HEADERS = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "permissions-policy": "camera=(self), display-capture=(self), microphone=(self)",
};
const CSP =
  "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; style-src 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; manifest-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

const MANIFEST = JSON.stringify({
  name: "Milagre Live",
  short_name: "Live",
  description: "Share your game or your code, live, with one link.",
  start_url: "/start",
  display: "standalone",
  background_color: "#141a3d",
  theme_color: "#141a3d",
  icons: [
    { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
    { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
    { src: "/icon.svg", sizes: "any", type: "image/svg+xml" },
  ],
});

/**
 * Files served as they are: RNNoise for the mic's noise suppression (an AudioWorklet loads by URL, with its wasm), the
 * icons and link preview, the landing page's script and its font.
 */
const STATIC_FILES: Record<string, { body: string | ArrayBuffer; type: string }> = {
  "/noise/rnnoise-worklet.js": { body: rnnoiseWorklet, type: "text/javascript; charset=utf-8" },
  "/noise/rnnoise.wasm": { body: rnnoise, type: "application/wasm" },
  "/noise/rnnoise_simd.wasm": { body: rnnoiseSimd, type: "application/wasm" },
  "/icon.svg": { body: iconSvg, type: "image/svg+xml" },
  "/icon-192.png": { body: icon192, type: "image/png" },
  "/icon-512.png": { body: icon512, type: "image/png" },
  "/apple-touch-icon.png": { body: appleTouchIcon, type: "image/png" },
  "/og.png": { body: ogImage, type: "image/png" },
  "/manifest.webmanifest": { body: MANIFEST, type: "application/manifest+json" },
  "/landing.js": { body: landingScript, type: "text/javascript; charset=utf-8" },
  "/fonts/geist.woff2": { body: geist, type: "font/woff2" },
};

const LANDING_CSP =
  "default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; img-src 'self' data:; font-src 'self'; manifest-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
// The landing page is the one page search engines may list; rooms, the stats and the API stay out.
const ROBOTS = "User-agent: *\nAllow: /$\nDisallow: /r/\nDisallow: /start\nDisallow: /dash\nDisallow: /api/\n";

const DASH_CSP = "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'";
const STATS_URL = "https://stats.internal";
const statsOf = (env: Env) => env.STATS.get(env.STATS.idFromName("all"));

const html = (body: string, status = 200, extra: Record<string, string> = {}) =>
  new Response(body, {
    status,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "content-security-policy": DASH_CSP, ...SECURITY_HEADERS, ...extra },
  });

/** `/dash`: the owner's stats, behind the `DASH_PASSWORD` secret. */
async function dash(request: Request, env: Env, pathname: string): Promise<Response> {
  const password = env.DASH_PASSWORD;
  if (!password) return html("<p>Set the DASH_PASSWORD secret to open the stats.</p>", 503);
  const now = Date.now();
  if (request.method === "POST" && pathname === "/dash/login") {
    const form = await request.formData().catch(() => null);
    if (!(await passwordMatches(form?.get("password"), password))) {
      await new Promise((resolve) => setTimeout(resolve, 600));
      return html(renderLogin("Wrong password."), 401);
    }
    return new Response(null, { status: 303, headers: { location: "/dash", "set-cookie": await sessionCookie(password, now) } });
  }
  if (request.method === "POST" && pathname === "/dash/logout")
    return new Response(null, { status: 303, headers: { location: "/dash", "set-cookie": signOutCookie() } });
  if (request.method !== "GET" || pathname !== "/dash") return new Response(null, { status: 303, headers: { location: "/dash" } });
  if (!(await signedIn(request.headers.get("Cookie"), password, now))) return html(renderLogin());
  const snapshot = await (await statsOf(env).fetch(`${STATS_URL}/snapshot`)).json();
  return html(renderDash(snapshot as Parameters<typeof renderDash>[0], now));
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store", ...SECURITY_HEADERS } });

function allowedOrigin(request: Request, env: Env): boolean {
  const origin = request.headers.get("Origin");
  if (!origin) return false;
  if (origin === env.PUBLIC_ORIGIN) return true;
  if (env.ALLOW_LOCALHOST !== "true") return false;
  try {
    return ["localhost", "127.0.0.1"].includes(new URL(origin).hostname);
  } catch {
    return false;
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const { pathname } = url;
    if (pathname === "/health") return new Response("ok");
    const roomPage = pathname.startsWith("/r/") && ROOM_ID.test(pathname.slice(3));
    if (request.method === "GET" && pathname === "/")
      return new Response(landing, {
        headers: {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "public, max-age=300",
          "content-security-policy": LANDING_CSP,
          ...SECURITY_HEADERS,
        },
      });
    if (request.method === "GET" && (pathname === "/start" || roomPage))
      return new Response(page, {
        headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-cache", "content-security-policy": CSP, ...SECURITY_HEADERS },
      });
    if (request.method === "GET" && pathname === "/app.js")
      return new Response(script, { headers: { "content-type": "text/javascript; charset=utf-8", "cache-control": "no-cache", ...SECURITY_HEADERS } });
    if (request.method === "GET" && pathname.startsWith("/face/")) {
      const asset = await env.ASSETS.fetch(request);
      const out = new Response(asset.body, asset);
      out.headers.set("cache-control", "public, max-age=604800");
      for (const [key, value] of Object.entries(SECURITY_HEADERS)) out.headers.set(key, value);
      return out;
    }
    const file = STATIC_FILES[pathname];
    if (request.method === "GET" && file)
      return new Response(file.body, { headers: { "content-type": file.type, "cache-control": "public, max-age=86400", ...SECURITY_HEADERS } });
    if (pathname === "/dash" || pathname.startsWith("/dash/")) return dash(request, env, pathname);
    if (pathname === "/robots.txt") return new Response(ROBOTS, { headers: { "content-type": "text/plain" } });
    const match = API.exec(pathname);
    if (!match) return new Response("Not found", { status: 404 });
    if (!allowedOrigin(request, env)) return json({ error: "bad-origin" }, 403);
    if (match[2] === "ws" && request.headers.get("Upgrade") !== "websocket") return json({ error: "expected-websocket" }, 426);
    const room = env.ROOMS.get(env.ROOMS.idFromName(match[1]!));
    const inner = new URL(`${INTERNAL}/${match[2]}`);
    inner.search = url.search;
    const forwarded = new Request(inner, request);
    forwarded.headers.set("x-live-room", match[1]!);
    return room.fetch(forwarded);
  },
};

type Attachment = Peer | null;

/**
 * One room on the WebSocket Hibernation API. Each socket's attachment is its peer, so an idle room costs no duration
 * and a fresh object rebuilds the room from `getWebSockets()`. Keepalive pings are answered without waking it.
 */
export class LiveRoom implements DurableObject {
  private readonly room: Room<WebSocket>;
  constructor(
    private readonly state: DurableObjectState,
    private readonly env: Env,
  ) {
    state.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
    this.room = createRoom<WebSocket>({
      io: {
        list: () => this.state.getWebSockets().map((socket) => ({ socket, peer: (socket.deserializeAttachment() as Attachment) ?? null })),
        save: (socket, peer) => socket.serializeAttachment(peer),
        send: (socket, text) => {
          try {
            socket.send(text);
          } catch {
            /* closing */
          }
        },
        close: (socket, code, reason) => {
          try {
            socket.close(code, reason);
          } catch {
            /* already closed */
          }
        },
      },
      store: {
        get: (key) => this.state.storage.kv.get<string>(key),
        put: (key, value) => this.state.storage.kv.put(key, value),
        delete: (key) => void this.state.storage.kv.delete(key),
      },
      realtime: (method, path, body) => this.realtime(method, path, body),
      iceServers: () => this.iceServers(),
      onChange: (event, peers) => {
        const id = this.state.storage.kv.get<string>("id");
        if (!id) return;
        const report: Report = { id, event, peers };
        this.state.waitUntil(
          statsOf(this.env)
            .fetch(`${STATS_URL}/report`, { method: "POST", body: JSON.stringify(report) })
            .catch(() => {}),
        );
      },
    });
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const token = /^Bearer (.+)$/.exec(request.headers.get("Authorization") ?? "")?.[1] ?? null;
    if (url.pathname === "/ws") {
      const roomId = request.headers.get("x-live-room");
      if (roomId && this.state.storage.kv.get("id") !== roomId) this.state.storage.kv.put("id", roomId);
      const name = url.searchParams.get("name") ?? "";
      const [client, server] = Object.values(new WebSocketPair());
      if (!client || !server) throw new Error("WebSocketPair did not yield two sockets");
      const clientId = url.searchParams.get("client");
      const refusal = this.room.refusal(name, clientId);
      if (refusal) {
        server.accept();
        server.close({ 409: 4409, 403: 4403 }[refusal.status] ?? 4400, refusal.error);
        return new Response(null, { status: 101, webSocket: client });
      }
      this.state.acceptWebSocket(server);
      this.state.waitUntil(this.room.join(server, name, { client: clientId, ownerKey: url.searchParams.get("owner") }));
      return new Response(null, { status: 101, webSocket: client });
    }
    if (url.pathname === "/ice") return reply(await this.room.ice(token));
    if (url.pathname === "/who") return request.method === "POST" ? json({ people: this.room.who() }) : json({ error: "expected-post" }, 405);
    const path = url.pathname.slice("/sfu/".length);
    const body = request.method === "GET" ? null : await request.text();
    return reply(await this.room.sfu({ token, method: request.method, path, body }));
  }

  webSocketMessage(socket: WebSocket, message: string | ArrayBuffer): void {
    this.room.message(socket, message);
  }

  webSocketClose(socket: WebSocket): void {
    this.room.leave(socket);
  }

  webSocketError(socket: WebSocket): void {
    this.room.leave(socket);
  }

  private async realtime(method: string, path: string, body: unknown): Promise<Answer> {
    if (!this.env.REALTIME_APP_ID || !this.env.REALTIME_APP_TOKEN) return { status: 503, body: { error: "realtime-not-configured" } };
    const response = await fetch(`${REALTIME}/apps/${this.env.REALTIME_APP_ID}/${path}`, {
      method,
      headers: { authorization: `Bearer ${this.env.REALTIME_APP_TOKEN}`, "content-type": "application/json" },
      body: body === undefined || body === null ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    try {
      return { status: response.status, body: JSON.parse(text) };
    } catch {
      return { status: 502, body: { error: "realtime-bad-answer" } };
    }
  }

  // Browsers refuse TURN on port 53, so those URLs only slow ICE down.
  private async iceServers(): Promise<IceServer[]> {
    if (!this.env.TURN_KEY_ID || !this.env.TURN_KEY_TOKEN) return FALLBACK_ICE;
    const response = await fetch(`${REALTIME}/turn/keys/${this.env.TURN_KEY_ID}/credentials/generate-ice-servers`, {
      method: "POST",
      headers: { authorization: `Bearer ${this.env.TURN_KEY_TOKEN}`, "content-type": "application/json" },
      body: JSON.stringify({ ttl: 86_400 }),
    });
    if (!response.ok) return FALLBACK_ICE;
    const { iceServers } = (await response.json()) as { iceServers: IceServer[] };
    return iceServers.map((server) => ({ ...server, urls: [server.urls].flat().filter((entry) => !/:53(\?|$)/.test(entry)) }));
  }
}

const reply = ({ status, body }: Answer) => json(body, status);

const USAGE_EVERY_MS = 5 * 60 * 1000;
// Cloudflare keeps Realtime analytics for a limited window; months older than it come from what this object stored.
const USAGE_WINDOW_DAYS = 89;
const LIVE_SINCE = "2026-11-01";

/**
 * Every room's last roster and the day's counts, for `/dash`, and what Cloudflare reports Realtime sent: fetched at
 * most every five minutes with a read-only analytics token, with each month's total kept so the cost so far survives
 * Cloudflare's retention.
 */
export class LiveStats implements DurableObject {
  private readonly stats;
  private readonly kv;
  constructor(
    state: DurableObjectState,
    private readonly env: Env,
  ) {
    const kv = state.storage.kv;
    this.kv = kv;
    this.stats = createStats({
      store: {
        get: (key) => kv.get<string>(key),
        put: (key, value) => kv.put(key, value),
        delete: (key) => {
          kv.delete(key);
        },
        list: (prefix) => kv.list<string>({ prefix }),
      },
    });
  }

  async fetch(request: Request): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (pathname === "/report" && request.method === "POST") {
      this.stats.report((await request.json()) as Report);
      return new Response(null, { status: 204 });
    }
    if (pathname === "/snapshot") return Response.json({ ...this.stats.snapshot(), usage: await this.usage() });
    return new Response("Not found", { status: 404 });
  }

  private async usage() {
    if (!this.env.CF_ANALYTICS_TOKEN || !this.env.CF_ACCOUNT_ID) return null;
    const last = this.kv.get<string>("usage:last");
    const cached = last ? (JSON.parse(last) as { at: number; days: UsageDay[]; error?: string }) : null;
    if (!cached || Date.now() - cached.at > USAGE_EVERY_MS) await this.refreshUsage(cached);
    const fresh = JSON.parse(this.kv.get<string>("usage:last") ?? "null") as { at: number; days: UsageDay[]; error?: string } | null;
    const months = [...this.kv.list<string>({ prefix: "usage:month:" })].map(([, value]) => JSON.parse(value) as { month: string; gb: number });
    const cost = costOf(months.map(({ month, gb }) => ({ date: `${month}-01`, bytes: gb * 1e9 })));
    return { at: fresh?.at ?? null, error: fresh?.error ?? null, days: fresh?.days ?? [], cost };
  }

  private async refreshUsage(previous: { days: UsageDay[] } | null) {
    const today = new Date().toISOString().slice(0, 10);
    const windowStart = new Date(Date.now() - USAGE_WINDOW_DAYS * 86_400_000).toISOString().slice(0, 10);
    const start = windowStart > LIVE_SINCE ? windowStart : LIVE_SINCE;
    try {
      const response = await fetch("https://api.cloudflare.com/client/v4/graphql", {
        method: "POST",
        headers: { authorization: `Bearer ${this.env.CF_ANALYTICS_TOKEN}`, "content-type": "application/json" },
        body: JSON.stringify({ query: USAGE_QUERY, variables: { account: this.env.CF_ACCOUNT_ID, start, end: today } }),
      });
      const days = daysFrom(await response.json());
      // A month is only replaced when the window covers all of it; a month the window starts inside keeps what was stored.
      for (const row of costOf(days).months)
        if (start <= `${row.month}-01`) this.kv.put(`usage:month:${row.month}`, JSON.stringify({ month: row.month, gb: row.gb }));
      this.kv.put("usage:last", JSON.stringify({ at: Date.now(), days }));
    } catch (error) {
      this.kv.put("usage:last", JSON.stringify({ at: Date.now(), days: previous?.days ?? [], error: (error as Error).message }));
    }
  }
}

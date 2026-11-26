export const MAX_PEERS = 16;
const MAX_NAME = 40;
const MAX_TRACKS = 6;
export const ROOM_ID = /^[a-z]{4}-[a-z]{4}-[a-z]{4}$/;
const TRACK_NAME = /^[a-z0-9]{8}-(screen|camera|mic|screen-audio)-[0-9]{1,6}$/;
const SESSION_ID = /^[A-Za-z0-9_-]{1,128}$/;
const MID = /^[A-Za-z0-9_-]{1,32}$/;
const SOURCES = new Set(["screen", "camera", "mic", "screen-audio"]);
const MATERIALS = new Set(["flat", "fluffy"]);
const SHAPE = /^[a-z0-9-]{1,40}$/;
const COLOR = /^#[0-9a-f]{6}$/i;
const CLIENT = /^[a-z0-9]{16,40}$/;
const OWNER_KEY = /^[a-z0-9]{32,64}$/;

async function sha256(text) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
const MAX_BODY = 256 * 1024;

const ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";
export function randomId(length, alphabet = ALPHABET, random = (n) => crypto.getRandomValues(new Uint8Array(n))) {
  const bytes = random(length * 2);
  let out = "";
  for (const byte of bytes) {
    if (byte >= 256 - (256 % alphabet.length)) continue;
    out += alphabet[byte % alphabet.length];
    if (out.length === length) return out;
  }
  return out + randomId(length - out.length, alphabet, random);
}

const HIDDEN = [
  [0x00, 0x1f],
  [0x7f, 0x9f],
  [0x200b, 0x200f],
  [0x2028, 0x202e],
  [0x2066, 0x2069],
];
const hidden = (code) => HIDDEN.some(([from, to]) => code >= from && code <= to);

export function cleanName(raw) {
  if (typeof raw !== "string") return "";
  const name = raw
    .replace(/./gsu, (char) => (hidden(char.codePointAt(0)) ? "" : char))
    .replace(/\s+/g, " ")
    .trim();
  return [...name].slice(0, MAX_NAME).join("");
}

const publicPeer = (peer) => ({
  id: peer.id,
  name: peer.name,
  sessionId: peer.sessionId,
  tracks: peer.tracks,
  avatar: peer.avatar ?? null,
  host: Boolean(peer.host),
  deafened: Boolean(peer.deafened),
  muted: Boolean(peer.muted),
});

function cleanAvatar(avatar) {
  if (!avatar || !SHAPE.test(avatar.shape ?? "") || !COLOR.test(avatar.color ?? "") || !MATERIALS.has(avatar.material)) return null;
  return { shape: avatar.shape, color: avatar.color.toLowerCase(), material: avatar.material };
}

/**
 * One live room. Holds nothing of its own: every peer's state is the attachment on its socket, so the Durable
 * Object can hibernate between messages and rebuild the room from `io.list()`.
 *   io.list()               the open sockets and their peers ({ socket, peer }); peer is null for a socket being let go
 *   io.save(socket, peer)   stores a peer's new state on its socket
 *   io.send(socket, text)
 *   io.close(socket, code, reason)
 * `store` is the room's own durable key-value storage: the hash of the host's key, and the browsers the host removed.
 *
 * The host is whoever brings the room's key: the browser that made the room keeps it, and the first key a room hears
 * becomes its key. A removed browser is turned away by its client id, which a new private window doesn't share.
 */
export function createRoom({ io, store, realtime, iceServers, onChange = () => {}, newPeerId = () => randomId(8), newToken = () => randomId(32) }) {
  const peers = () => io.list().filter((entry) => entry.peer);
  const broadcast = (event = "change") => {
    const text = JSON.stringify({ type: "peers", peers: peers().map(({ peer }) => publicPeer(peer)) });
    for (const { socket } of peers()) io.send(socket, text);
    onChange(
      event,
      peers().map(({ peer }) => ({
        name: peer.name,
        host: Boolean(peer.host),
        camera: peer.tracks.some((track) => track.source === "camera"),
        screen: peer.tracks.some((track) => track.source === "screen"),
        mic: peer.tracks.some((track) => track.source === "mic"),
        screenAudio: peer.tracks.some((track) => track.source === "screen-audio"),
        screenKbps: peer.tracks.find((track) => track.source === "screen")?.kbps ?? null,
      })),
    );
  };
  const byToken = (token) => (typeof token === "string" && token ? peers().find(({ peer }) => peer.token === token) : undefined);

  return {
    /** Who is in the room, for the join screen: names, bots and the host, nothing a peer could act on. */
    who() {
      return peers().map(({ peer }) => ({ name: peer.name, avatar: peer.avatar ?? null, host: Boolean(peer.host) }));
    },

    refusal(name, client) {
      if (!cleanName(name)) return { status: 400, error: "name-required" };
      if (CLIENT.test(client ?? "") && store.get(`removed:${client}`)) return { status: 403, error: "removed" };
      if (peers().length >= MAX_PEERS) return { status: 409, error: "room-full" };
      return null;
    },

    async join(socket, name, { client = null, ownerKey = null } = {}) {
      let host = false;
      if (OWNER_KEY.test(ownerKey ?? "")) {
        const hash = await sha256(ownerKey);
        const known = store.get("owner");
        if (!known) store.put("owner", hash);
        host = !known || known === hash;
      }
      const peer = {
        id: newPeerId(),
        name: cleanName(name),
        token: newToken(),
        sessionId: null,
        tracks: [],
        avatar: null,
        host,
        client: CLIENT.test(client ?? "") ? client : null,
      };
      io.save(socket, peer);
      const ice = await iceServers().catch(() => FALLBACK_ICE);
      io.send(socket, JSON.stringify({ type: "welcome", id: peer.id, token: peer.token, iceServers: ice }));
      broadcast("join");
      return peer;
    },

    message(socket, data) {
      const entry = peers().find((item) => item.socket === socket);
      if (!entry || typeof data !== "string" || data.length > 8192) return;
      let message;
      try {
        message = JSON.parse(data);
      } catch {
        return;
      }
      if (message?.type === "remove") {
        if (!entry.peer.host) return;
        const target = peers().find(({ peer }) => peer.id === message.id && !peer.host);
        if (!target) return;
        if (target.peer.client) store.put(`removed:${target.peer.client}`, "1");
        io.save(target.socket, null);
        io.close(target.socket, 4403, "removed");
        return broadcast();
      }
      if (message?.type === "state") {
        const next = { ...entry.peer };
        for (const field of ["deafened", "muted"]) if (typeof message[field] === "boolean") next[field] = message[field];
        if (next.deafened === entry.peer.deafened && next.muted === entry.peer.muted) return;
        io.save(socket, next);
        return broadcast();
      }
      if (message?.type === "avatar") {
        const avatar = cleanAvatar(message.avatar);
        if (!avatar) return;
        io.save(socket, { ...entry.peer, avatar });
        return broadcast();
      }
      if (message?.type !== "publish" || !Array.isArray(message.tracks) || message.tracks.length > MAX_TRACKS) return;
      const tracks = [];
      for (const track of message.tracks) {
        if (!track || !SOURCES.has(track.source) || !TRACK_NAME.test(track.name ?? "")) return;
        if (!track.name.startsWith(`${entry.peer.id}-${track.source}-`)) return;
        const kbps = track.source === "screen" && Number.isInteger(track.kbps) && track.kbps >= 100 && track.kbps <= 20_000 ? track.kbps : undefined;
        tracks.push(kbps ? { name: track.name, source: track.source, kbps } : { name: track.name, source: track.source });
      }
      io.save(socket, { ...entry.peer, tracks });
      broadcast();
    },

    leave(socket) {
      const had = peers().some((entry) => entry.socket === socket);
      io.save(socket, null);
      if (had) broadcast();
    },

    /** Forwards one call to Cloudflare Realtime for the peer holding `token`, only on its own session. */
    async sfu({ token, method, path, body }) {
      const entry = byToken(token);
      if (!entry) return { status: 401, body: { error: "not-in-room" } };
      if (typeof body === "string" && body.length > MAX_BODY) return { status: 413, body: { error: "too-big" } };
      let parsed = null;
      if (body) {
        try {
          parsed = JSON.parse(body);
        } catch {
          return { status: 400, body: { error: "bad-json" } };
        }
      }
      const route = routeOf(method, path);
      if (!route) return { status: 404, body: { error: "unknown-call" } };
      if (route.kind === "new-session") {
        const problem = checkDescription(parsed, false);
        if (problem) return { status: 400, body: { error: problem } };
        const answer = await realtime("POST", "sessions/new", parsed ?? undefined);
        if (answer.status < 300 && typeof answer.body?.sessionId === "string") {
          const fresh = peers().find((item) => item.socket === entry.socket);
          if (fresh) io.save(fresh.socket, { ...fresh.peer, sessionId: answer.body.sessionId, tracks: [] });
          broadcast();
        }
        return answer;
      }
      if (route.sessionId !== entry.peer.sessionId) return { status: 403, body: { error: "not-your-session" } };
      const problem =
        route.kind === "tracks-new"
          ? checkNewTracks(parsed, entry.peer, peers())
          : route.kind === "tracks-close"
            ? checkClose(parsed)
            : checkDescription(parsed);
      if (problem) return { status: 400, body: { error: problem } };
      return realtime(method, path, parsed);
    },

    async ice(token) {
      if (!byToken(token)) return { status: 401, body: { error: "not-in-room" } };
      return { status: 200, body: { iceServers: await iceServers().catch(() => FALLBACK_ICE) } };
    },
  };
}

export const FALLBACK_ICE = [{ urls: "stun:stun.cloudflare.com:3478" }];

function routeOf(method, path) {
  if (method === "POST" && path === "sessions/new") return { kind: "new-session" };
  const match = /^sessions\/([^/]+)\/(tracks\/new|tracks\/close|renegotiate)$/.exec(path ?? "");
  if (!match || !SESSION_ID.test(match[1])) return null;
  const kind = { "tracks/new": "tracks-new", "tracks/close": "tracks-close", renegotiate: "renegotiate" }[match[2]];
  const expected = kind === "tracks-new" ? "POST" : "PUT";
  return method === expected ? { kind, sessionId: match[1] } : null;
}

function checkDescription(body, required = true) {
  const description = body?.sessionDescription;
  if (!description) return required ? "missing-description" : null;
  if (!["offer", "answer"].includes(description.type) || typeof description.sdp !== "string") return "bad-description";
  return null;
}

function checkNewTracks(body, peer, room) {
  if (!body || !Array.isArray(body.tracks) || body.tracks.length === 0 || body.tracks.length > 8) return "bad-tracks";
  const problem = checkDescription(body, false);
  if (problem) return problem;
  for (const track of body.tracks) {
    if (track?.location === "local") {
      if (!MID.test(track.mid ?? "") || !TRACK_NAME.test(track.trackName ?? "") || !track.trackName.startsWith(`${peer.id}-`)) return "bad-local-track";
      if (!body.sessionDescription) return "missing-description";
    } else if (track?.location === "remote") {
      const owner = room.find(({ peer: other }) => other.sessionId && other.sessionId === track.sessionId && other.id !== peer.id);
      if (!owner || !owner.peer.tracks.some((published) => published.name === track.trackName)) return "unknown-remote-track";
    } else return "bad-tracks";
  }
  return null;
}

function checkClose(body) {
  if (!body || !Array.isArray(body.tracks) || body.tracks.length === 0 || body.tracks.length > 8) return "bad-tracks";
  if (!body.tracks.every((track) => MID.test(track?.mid ?? ""))) return "bad-tracks";
  return checkDescription(body, false);
}

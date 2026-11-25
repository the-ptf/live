import { test } from "node:test";
import assert from "node:assert/strict";
import { createRoom, cleanName, randomId, MAX_PEERS, FALLBACK_ICE } from "./room.mjs";

function harness({ realtime } = {}) {
  const sockets = [];
  const calls = [];
  let next = 0;
  const io = {
    list: () => sockets.map((socket) => ({ socket, peer: socket.peer })),
    save: (socket, peer) => {
      socket.peer = peer;
    },
    send: (socket, text) => socket.sent.push(JSON.parse(text)),
    close: (socket, code, reason) => {
      socket.closed = { code, reason };
    },
  };
  const kv = new Map();
  const store = { get: (key) => kv.get(key), put: (key, value) => kv.set(key, value) };
  const room = createRoom({
    io,
    store,
    iceServers: async () => [{ urls: "turn:example" }],
    realtime: async (method, path, body) => {
      calls.push({ method, path, body });
      if (realtime) return realtime(method, path, body);
      if (path === "sessions/new") return { status: 201, body: { sessionId: `s${calls.length}` } };
      return { status: 200, body: { ok: true } };
    },
    newPeerId: () => `peer000${next}`,
    newToken: () => `token${next++}`,
  });
  const join = async (name, credentials) => {
    const socket = { sent: [], peer: null, closed: null };
    sockets.push(socket);
    await room.join(socket, name, credentials);
    return socket;
  };
  const session = async (socket) => {
    await room.sfu({ token: socket.peer.token, method: "POST", path: "sessions/new", body: null });
    return socket.peer.sessionId;
  };
  return { room, sockets, calls, join, session };
}

const offer = { type: "offer", sdp: "v=0" };

test("a name is trimmed, single-spaced, stripped of control characters and capped", () => {
  assert.equal(cleanName("  Ana \n  Souza\u0007 "), "Ana Souza");
  assert.equal(cleanName("a‮b"), "ab");
  assert.equal([...cleanName("é".repeat(80))].length, 40);
  assert.equal(cleanName(42), "");
});

test("random ids use only the alphabet and have the asked length", () => {
  const id = randomId(32);
  assert.match(id, /^[a-z0-9]{32}$/);
});

test("joining needs a name and turns people away past the cap", async () => {
  const { room, join } = harness();
  assert.deepEqual(room.refusal("   "), { status: 400, error: "name-required" });
  for (let i = 0; i < MAX_PEERS; i++) await join(`P${i}`);
  assert.deepEqual(room.refusal("Late"), { status: 409, error: "room-full" });
});

test("a joining peer gets its id, token and ICE servers, and everyone hears the roster", async () => {
  const { join } = harness();
  const ana = await join("Ana");
  const bia = await join("Bia");
  assert.deepEqual(bia.sent[0], { type: "welcome", id: "peer0001", token: "token1", iceServers: [{ urls: "turn:example" }] });
  const roster = ana.sent.at(-1);
  assert.equal(roster.type, "peers");
  assert.deepEqual(
    roster.peers.map((peer) => peer.name),
    ["Ana", "Bia"],
  );
  assert.ok(roster.peers.every((peer) => !("token" in peer)));
});

test("ICE falls back to Cloudflare STUN when TURN credentials fail", async () => {
  const socket = { sent: [], peer: null };
  const room = createRoom({
    io: { list: () => [{ socket, peer: socket.peer }], save: (s, p) => (s.peer = p), send: (s, t) => s.sent.push(JSON.parse(t)), close: () => {} },
    store: { get: () => undefined, put: () => {} },
    iceServers: () => Promise.reject(new Error("down")),
    realtime: async () => ({ status: 200, body: {} }),
  });
  await room.join(socket, "Ana");
  assert.deepEqual(socket.sent[0].iceServers, FALLBACK_ICE);
});

test("a peer publishes only tracks named after itself, and leaving drops it from the roster", async () => {
  const { room, join } = harness();
  const ana = await join("Ana");
  const bia = await join("Bia");
  room.message(ana, JSON.stringify({ type: "publish", tracks: [{ name: "peer0001-screen-1", source: "screen" }] }));
  assert.deepEqual(ana.peer.tracks, []);
  room.message(ana, JSON.stringify({ type: "publish", tracks: [{ name: "peer0000-screen-1", source: "screen" }] }));
  assert.deepEqual(bia.sent.at(-1).peers[0].tracks, [{ name: "peer0000-screen-1", source: "screen" }]);
  room.message(ana, "not json");
  room.leave(ana);
  assert.deepEqual(
    bia.sent.at(-1).peers.map((peer) => peer.name),
    ["Bia"],
  );
});

test("Realtime calls need a room token and stay on the caller's own session", async () => {
  const { room, join, session, calls } = harness();
  const ana = await join("Ana");
  const bia = await join("Bia");
  const anaSession = await session(ana);
  const biaSession = await session(bia);
  assert.equal(anaSession, "s1");

  assert.equal((await room.sfu({ token: "nope", method: "POST", path: "sessions/new", body: null })).status, 401);
  const close = JSON.stringify({ tracks: [{ mid: "0" }], sessionDescription: offer, force: false });
  assert.equal((await room.sfu({ token: ana.peer.token, method: "PUT", path: `sessions/${biaSession}/tracks/close`, body: close })).status, 403);
  assert.equal((await room.sfu({ token: ana.peer.token, method: "GET", path: `sessions/${anaSession}/tracks/close`, body: null })).status, 404);
  assert.equal((await room.sfu({ token: ana.peer.token, method: "PUT", path: `sessions/${anaSession}/tracks/close`, body: close })).status, 200);
  assert.equal(calls.at(-1).path, `sessions/${anaSession}/tracks/close`);
});

test("a peer pushes tracks under its own id and pulls only tracks someone in the room published", async () => {
  const { room, join, session } = harness();
  const ana = await join("Ana");
  const bia = await join("Bia");
  const anaSession = await session(ana);
  const biaSession = await session(bia);
  const push = (trackName) =>
    room.sfu({
      token: ana.peer.token,
      method: "POST",
      path: `sessions/${anaSession}/tracks/new`,
      body: JSON.stringify({ sessionDescription: offer, tracks: [{ location: "local", mid: "0", trackName }] }),
    });
  assert.equal((await push("peer0001-camera-1")).status, 400);
  assert.equal((await push("peer0000-camera-1")).status, 200);

  const pull = (sessionId, trackName) =>
    room.sfu({
      token: bia.peer.token,
      method: "POST",
      path: `sessions/${biaSession}/tracks/new`,
      body: JSON.stringify({ tracks: [{ location: "remote", sessionId, trackName }] }),
    });
  assert.deepEqual((await pull(anaSession, "peer0000-camera-1")).body, { error: "unknown-remote-track" });
  room.message(ana, JSON.stringify({ type: "publish", tracks: [{ name: "peer0000-camera-1", source: "camera" }] }));
  assert.equal((await pull(anaSession, "peer0000-camera-1")).status, 200);
  assert.equal((await pull("someone-else", "peer0000-camera-1")).status, 400);
});

test("a new session clears the tracks the peer had published on its old one", async () => {
  const { room, join, session } = harness();
  const ana = await join("Ana");
  await session(ana);
  room.message(ana, JSON.stringify({ type: "publish", tracks: [{ name: "peer0000-camera-1", source: "camera" }] }));
  await session(ana);
  assert.deepEqual(ana.peer.tracks, []);
  assert.equal(ana.peer.sessionId, "s2");
});

test("Realtime not answering with a session leaves the peer without one", async () => {
  const { room, join } = harness({ realtime: async () => ({ status: 503, body: { error: "realtime-not-configured" } }) });
  const ana = await join("Ana");
  const answer = await room.sfu({ token: ana.peer.token, method: "POST", path: "sessions/new", body: null });
  assert.equal(answer.status, 503);
  assert.equal(ana.peer.sessionId, null);
});

test("a peer's avatar reaches everyone, and a bad one is ignored", async () => {
  const { room, join } = harness();
  const ana = await join("Ana");
  const bia = await join("Bia");
  assert.equal(bia.sent.at(-1).peers[0].avatar, null);
  room.message(ana, JSON.stringify({ type: "avatar", avatar: { shape: "ghost", color: "#EC4899", material: "fluffy" } }));
  assert.deepEqual(bia.sent.at(-1).peers.find((peer) => peer.name === "Ana").avatar, { shape: "ghost", color: "#ec4899", material: "fluffy" });
  const before = bia.sent.length;
  room.message(ana, JSON.stringify({ type: "avatar", avatar: { shape: "<script>", color: "red", material: "glass" } }));
  assert.equal(bia.sent.length, before);
  assert.equal(ana.peer.avatar.shape, "ghost");
});

const KEY = "k".repeat(40);
const OTHER_KEY = "x".repeat(40);
const CLIENT_A = "a".repeat(20);
const CLIENT_B = "b".repeat(20);

test("the browser that brings the room's key first is the host, and only that key stays host", async () => {
  const { join } = harness();
  const ana = await join("Ana", { client: CLIENT_A, ownerKey: KEY });
  const bia = await join("Bia", { client: CLIENT_B, ownerKey: OTHER_KEY });
  const cris = await join("Cris", { ownerKey: KEY });
  assert.equal(ana.peer.host, true);
  assert.equal(bia.peer.host, false);
  assert.equal(cris.peer.host, true);
  assert.deepEqual(
    cris.sent.at(-1).peers.map((peer) => [peer.name, peer.host]),
    [
      ["Ana", true],
      ["Bia", false],
      ["Cris", true],
    ],
  );
  assert.ok(cris.sent.at(-1).peers.every((peer) => !("client" in peer)));
});

test("the host removes someone, who is disconnected and can't come back from that browser", async () => {
  const { room, join } = harness();
  const ana = await join("Ana", { client: CLIENT_A, ownerKey: KEY });
  const bia = await join("Bia", { client: CLIENT_B });
  room.message(bia, JSON.stringify({ type: "remove", id: ana.peer.id }));
  assert.equal(ana.closed, null);
  room.message(ana, JSON.stringify({ type: "remove", id: ana.peer.id }));
  assert.equal(ana.closed, null);
  room.message(ana, JSON.stringify({ type: "remove", id: bia.peer.id }));
  assert.deepEqual(bia.closed, { code: 4403, reason: "removed" });
  assert.equal(bia.peer, null);
  assert.deepEqual(
    ana.sent.at(-1).peers.map((peer) => peer.name),
    ["Ana"],
  );
  assert.deepEqual(room.refusal("Bia", CLIENT_B), { status: 403, error: "removed" });
  assert.equal(room.refusal("Bia", "c".repeat(20)), null);
});

test("every roster change is reported with who has a camera or a screen", async () => {
  const reports = [];
  const sockets = [];
  const room = createRoom({
    io: {
      list: () => sockets.map((socket) => ({ socket, peer: socket.peer })),
      save: (socket, peer) => (socket.peer = peer),
      send: () => {},
      close: () => {},
    },
    store: { get: () => undefined, put: () => {} },
    realtime: async () => ({ status: 200, body: {} }),
    iceServers: async () => [],
    onChange: (event, peers) => reports.push({ event, peers }),
  });
  const ana = { peer: null };
  sockets.push(ana);
  await room.join(ana, "Ana", { ownerKey: "k".repeat(40) });
  room.message(ana, JSON.stringify({ type: "publish", tracks: [{ name: `${ana.peer.id}-screen-1`, source: "screen" }] }));
  room.leave(ana);
  assert.deepEqual(reports, [
    { event: "join", peers: [{ name: "Ana", host: true, camera: false, screen: false, mic: false }] },
    { event: "change", peers: [{ name: "Ana", host: true, camera: false, screen: true, mic: false }] },
    { event: "change", peers: [] },
  ]);
});

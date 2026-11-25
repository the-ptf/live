import { hideBot, loadLook, lookFor, openPicker, showBot } from "./avatars.js";
import { EFFECTS, createEffectCamera, loadEffect, saveEffect } from "./effects.js";
import { cameraEncoding, SCREEN_AUDIO_BITRATE, SCREEN_BITRATE } from "./media.mjs";
import { playVoice, setDeafened, stopAllVoices, stopVoice, unwatchLevel, watchLevel } from "./voice.js";

const $ = (id) => document.getElementById(id);
const NAME_KEY = "milagre-live:name";
const ROOM_PATH = /^\/r\/([a-z]{4}-[a-z]{4}-[a-z]{4})$/;

let myLook = loadLook();
let effect = loadEffect();
let deafened = false;
let micBeforeDeafen = false;
let roomId = ROOM_PATH.exec(location.pathname)?.[1] ?? null;
let socket = null;
let pinger = 0;
let me = null;
let pc = null;
let sessionId = null;
let peers = [];
let seq = 0;
let chain = Promise.resolve();
let leaving = false;
let retry = 0;
/** source → { track, transceiver, name } */
const local = new Map();
/** trackName → { peerId, source, transceiver, stream, ready } */
const remote = new Map();
const tiles = new Map();

function randomToken(length) {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  return [...crypto.getRandomValues(new Uint8Array(length))].map((byte) => alphabet[byte % alphabet.length]).join("");
}

const CLIENT_KEY = "milagre-live:client";
const clientId = localStorage.getItem(CLIENT_KEY) ?? randomToken(24);
localStorage.setItem(CLIENT_KEY, clientId);
const hostKeyOf = (room) => localStorage.getItem(`milagre-live:host:${room}`);

function newRoomId() {
  const letters = "abcdefghijklmnopqrstuvwxyz";
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  const chars = [...bytes].map((byte) => letters[byte % 26]);
  return [chars.slice(0, 4), chars.slice(4, 8), chars.slice(8)].map((part) => part.join("")).join("-");
}

function toast(text) {
  const element = $("toast");
  element.textContent = text;
  element.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (element.hidden = true), 2400);
}

let connectionStatus = "";

function setStatus(text) {
  connectionStatus = text;
  paintStatus();
}

function paintStatus() {
  const alone = connectionStatus === "Live" && !peers.some((peer) => peer.id !== me?.id);
  $("status").textContent = connectionStatus !== "Live" ? connectionStatus : alone ? "Just you here. Copy the link from ··· to invite people." : "";
}

function serial(step) {
  chain = chain.then(step).catch((error) => {
    console.error(error);
    if (/disconnected|media-unreachable/i.test(error?.message ?? "")) return restartMedia("media-lost");
    toast(error.message || "Something went wrong");
  });
  return chain;
}

async function sfu(method, path, body) {
  const init = { method, headers: { authorization: `Bearer ${me.token}`, "content-type": "application/json" } };
  if (body !== undefined) init.body = JSON.stringify(body);
  const response = await fetch(`/api/rooms/${roomId}/sfu/${path}`, init);
  const answer = await response.json().catch(() => ({}));
  if (!response.ok || answer.errorCode) throw new Error(answer.errorDescription || answer.error || `Realtime answered ${response.status}`);
  const failed = answer.tracks?.find((track) => track.errorCode);
  if (failed) throw new Error(failed.errorDescription || failed.errorCode);
  return answer;
}

const offerOf = () => ({ type: "offer", sdp: pc.localDescription.sdp });

function restartMedia(reason) {
  if (socket?.readyState !== WebSocket.OPEN) return;
  setStatus("Reconnecting");
  socket.close(4000, reason);
}

function waitConnected(connection) {
  return new Promise((resolve, reject) => {
    const check = () => {
      if (connection.connectionState === "connected") finish(resolve);
      else if (connection.connectionState === "failed" || connection.connectionState === "closed") finish(() => reject(new Error("media-unreachable")));
    };
    const timer = setTimeout(() => finish(() => reject(new Error("media-unreachable"))), 15_000);
    const finish = (done) => {
      clearTimeout(timer);
      connection.removeEventListener("connectionstatechange", check);
      done();
    };
    connection.addEventListener("connectionstatechange", check);
    check();
  });
}

/**
 * Opens the session with an offer and waits until the browser is connected to Cloudflare. Realtime refuses to push or
 * pull tracks on a session whose connection isn't up, so a camera-off viewer still negotiates a data channel first. An idle audio or video line doesn't work: Chrome rejects the answer's header extension ids.
 */
async function startSession(iceServers) {
  const connection = new RTCPeerConnection({ iceServers, bundlePolicy: "max-bundle" });
  pc = connection;
  let lost = 0;
  connection.addEventListener("connectionstatechange", () => {
    if (pc !== connection) return;
    clearTimeout(lost);
    if (connection.connectionState === "failed") restartMedia("media-failed");
    if (connection.connectionState === "disconnected")
      lost = setTimeout(() => pc === connection && connection.connectionState !== "connected" && restartMedia("media-lost"), 5000);
  });
  connection.createDataChannel("setup");
  await connection.setLocalDescription(await connection.createOffer());
  const answer = await sfu("POST", "sessions/new", { sessionDescription: { type: "offer", sdp: connection.localDescription.sdp } });
  sessionId = answer.sessionId;
  await connection.setRemoteDescription(answer.sessionDescription);
  await waitConnected(connection);
}

function sendState() {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "state", deafened }));
}

/** Like Discord: deafening also mutes you, and undeafening turns your mic back on if it was on. */
async function toggleDeafen() {
  deafened = !deafened;
  setDeafened(deafened);
  const button = $("deafen");
  button.setAttribute("aria-pressed", String(deafened));
  button.setAttribute("aria-label", deafened ? "Undeafen" : "Deafen");
  button.title = deafened ? "Undeafen" : "Deafen";
  sendState();
  render();
  if (deafened) {
    micBeforeDeafen = local.has("mic");
    if (micBeforeDeafen) stopLocal("mic");
  } else if (micBeforeDeafen && !local.has("mic")) {
    micBeforeDeafen = false;
    await toggle("mic");
  }
}

function sendLook() {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "avatar", avatar: myLook }));
}

function customize() {
  openPicker(myLook, (look) => {
    myLook = look;
    showBot($("join-avatar"), myLook);
    sendLook();
    render();
  });
}

function announce() {
  const tracks = [...local].filter(([, entry]) => entry.name).map(([source, entry]) => ({ name: entry.name, source }));
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "publish", tracks }));
}

function push(source) {
  return serial(async () => {
    const entry = local.get(source);
    if (!entry || entry.name || !pc || !sessionId) return;
    const encodings = {
      camera: [cameraEncoding(peers.length)],
      screen: [{ maxBitrate: SCREEN_BITRATE }],
      "screen-audio": [{ maxBitrate: SCREEN_AUDIO_BITRATE }],
    }[source];
    const transceiver = pc.addTransceiver(entry.track, { direction: "sendonly", ...(encodings ? { sendEncodings: encodings } : {}) });
    await pc.setLocalDescription(await pc.createOffer());
    const name = `${me.id}-${source}-${++seq}`;
    const answer = await sfu("POST", `sessions/${sessionId}/tracks/new`, {
      sessionDescription: offerOf(),
      tracks: [{ location: "local", mid: transceiver.mid, trackName: name }],
    });
    await pc.setRemoteDescription(answer.sessionDescription);
    if (local.get(source) !== entry) return closeMid(transceiver);
    Object.assign(entry, { transceiver, name });
    if (transceiver.sender.track !== entry.track) await transceiver.sender.replaceTrack(entry.track);
    if (source === "camera") tuneCamera();
    announce();
  });
}

/** Cameras send less once the room is crowded (see media.mjs), changed in place as people come and go. */
function tuneCamera() {
  const sender = local.get("camera")?.transceiver?.sender;
  if (!sender) return;
  const parameters = sender.getParameters();
  const [encoding] = parameters.encodings ?? [];
  if (!encoding) return;
  const want = cameraEncoding(peers.length);
  if (encoding.maxBitrate === want.maxBitrate && (encoding.scaleResolutionDownBy ?? 1) === want.scaleResolutionDownBy) return;
  Object.assign(encoding, want);
  sender.setParameters(parameters).catch(() => {});
}

async function closeMid(transceiver) {
  if (!pc || !transceiver?.mid || transceiver.currentDirection === "stopped") return;
  const mid = transceiver.mid;
  transceiver.stop();
  await pc.setLocalDescription(await pc.createOffer());
  const answer = await sfu("PUT", `sessions/${sessionId}/tracks/close`, { tracks: [{ mid }], sessionDescription: offerOf(), force: false });
  if (answer.sessionDescription) await pc.setRemoteDescription(answer.sessionDescription);
}

function stopLocal(source) {
  const entry = local.get(source);
  if (!entry) return;
  local.delete(source);
  entry.track.stop();
  entry.raw?.stop();
  entry.pipeline?.stop();
  if (source === "mic") unwatchLevel("me");
  if (source === "screen") stopLocal("screen-audio");
  paintToggle(source, false);
  announce();
  render();
  if (entry.transceiver) serial(() => closeMid(entry.transceiver));
}

const wanted = () => {
  const out = new Map();
  for (const peer of peers) {
    if (peer.id === me?.id || !peer.sessionId) continue;
    for (const track of peer.tracks) out.set(track.name, { peer, track });
  }
  return out;
};

function syncRemote() {
  const want = wanted();
  for (const [name, entry] of remote) if (!want.has(name)) drop(name, entry);
  for (const [name, { peer, track }] of want) if (!remote.has(name)) pull(name, peer, track);
}

function pull(name, peer, track) {
  const entry = { peerId: peer.id, source: track.source, ready: false };
  remote.set(name, entry);
  serial(async () => {
    if (remote.get(name) !== entry || !pc) return;
    const answer = await sfu("POST", `sessions/${sessionId}/tracks/new`, {
      tracks: [{ location: "remote", sessionId: peer.sessionId, trackName: name }],
    }).catch((error) => {
      remote.delete(name);
      throw error;
    });
    if (answer.requiresImmediateRenegotiation) {
      await pc.setRemoteDescription(answer.sessionDescription);
      await pc.setLocalDescription(await pc.createAnswer());
      await sfu("PUT", `sessions/${sessionId}/renegotiate`, { sessionDescription: { type: "answer", sdp: pc.localDescription.sdp } });
    }
    const mid = answer.tracks?.[0]?.mid;
    const transceiver = pc.getTransceivers().find((item) => item.mid === mid);
    if (!transceiver) throw new Error("The video did not arrive");
    Object.assign(entry, { transceiver, stream: new MediaStream([transceiver.receiver.track]), ready: true });
    if (remote.get(name) !== entry) return closeMid(transceiver);
    if (entry.source === "mic") {
      playVoice(name, entry.stream);
      watchLevel(`peer:${entry.peerId}`, entry.stream, paintSpeaking);
    }
    if (entry.source === "screen-audio") playVoice(name, entry.stream);
    render();
  });
}

function drop(name, entry) {
  remote.delete(name);
  if (entry.source === "mic") {
    stopVoice(name);
    unwatchLevel(`peer:${entry.peerId}`);
  }
  if (entry.source === "screen-audio") stopVoice(name);
  render();
  if (entry.transceiver) serial(() => closeMid(entry.transceiver));
}

const GAP = 12;
const RATIO = 16 / 9;

function makeTile(key) {
  const tile = document.createElement("figure");
  tile.className = "tile";
  const video = Object.assign(document.createElement("video"), { autoplay: true, muted: true, playsInline: true });
  video.addEventListener("click", () => {
    if (document.fullscreenElement) return void document.exitFullscreen();
    if (video.requestFullscreen) video.requestFullscreen().catch(() => {});
    else video.webkitEnterFullscreen?.();
  });
  const avatar = Object.assign(document.createElement("div"), { className: "avatar" });
  const remove = Object.assign(document.createElement("button"), { type: "button", className: "remove", hidden: true });
  tile.append(avatar, video, document.createElement("figcaption"), remove);
  tiles.set(key, tile);
  return tile;
}

const MIC_ON =
  '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 19v3"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><rect x="9" y="2" width="6" height="13" rx="3"/></svg>';
const MIC_OFF =
  '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 19v3"/><path d="M15 9.34V5a3 3 0 0 0-5.68-1.33"/><path d="M16.95 16.95A7 7 0 0 1 5 12v-2"/><path d="M18.89 13.23A7 7 0 0 0 19 12v-2"/><path d="m2 2 20 20"/><path d="M9 9v3a3 3 0 0 0 5.12 2.12"/></svg>';

let speakingNow = new Set();

function paintSpeaking(speaking) {
  speakingNow = speaking;
  for (const tile of tiles.values()) tile.classList.toggle("speaking", Boolean(tile.dataset.voice) && speaking.has(tile.dataset.voice));
}

const DEAFENED =
  '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 14h-1.343"/><path d="M9.128 3.47A9 9 0 0 1 21 12v3.343"/><path d="m2 2 20 20"/><path d="M20.414 20.414A2 2 0 0 1 19 21h-1a2 2 0 0 1-2-2v-3"/><path d="M3 14h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a9 9 0 0 1 2.6-6.4"/></svg>';

function tileFor(key, { label, stream, kind, mine = false, look, working = false, removable = null, voice = null, mic = null, deaf = false }) {
  const tile = tiles.get(key) ?? makeTile(key);
  const remove = tile.querySelector(".remove");
  remove.hidden = !removable;
  if (removable && remove.dataset.peer !== removable.id) {
    remove.dataset.peer = removable.id;
    remove.dataset.name = removable.name;
    disarm(remove);
  }
  tile.className = `tile ${kind}${mine ? " mine" : ""}${stream ? " has-video" : ""}${voice && speakingNow.has(voice) ? " speaking" : ""}`;
  if (voice) tile.dataset.voice = voice;
  const video = tile.querySelector("video");
  if (video.srcObject !== (stream ?? null)) video.srcObject = stream ?? null;
  video.hidden = !stream;
  const avatar = tile.querySelector(".avatar");
  avatar.hidden = Boolean(stream) || !look;
  if (stream || !look) hideBot(avatar);
  else showBot(avatar, look, { working });
  const caption = tile.querySelector("figcaption");
  caption.textContent = label;
  if (mic !== null) {
    const icon = Object.assign(document.createElement("span"), { className: `mic-state${mic ? "" : " off"}`, innerHTML: mic ? MIC_ON : MIC_OFF });
    icon.setAttribute("aria-label", mic ? "Microphone on" : "Microphone off");
    caption.prepend(icon);
  }
  if (deaf) {
    const icon = Object.assign(document.createElement("span"), { className: "mic-state off", innerHTML: DEAFENED });
    icon.setAttribute("aria-label", "Deafened");
    caption.prepend(icon);
  }
  return tile;
}

/** Lays `count` tiles out in `area` at the biggest 16:9 size where all of them fit, like a video call gallery. */
function fit(area, count) {
  if (!count) return;
  const width = area.clientWidth;
  const height = area.clientHeight;
  let best = { columns: 1, size: 0 };
  for (let columns = 1; columns <= count; columns++) {
    const rows = Math.ceil(count / columns);
    const size = Math.min((width - GAP * (columns - 1)) / columns, ((height - GAP * (rows - 1)) / rows) * RATIO);
    if (size > best.size) best = { columns, size };
  }
  const tileWidth = Math.max(Math.floor(best.size), 1);
  area.style.gridTemplateColumns = `repeat(${best.columns}, ${tileWidth}px)`;
  area.style.gridAutoRows = `${Math.floor(tileWidth / RATIO)}px`;
}

function layout() {
  const screens = $("screens");
  const gallery = $("gallery");
  $("stage").classList.toggle("presenting", screens.childElementCount > 0);
  screens.hidden = screens.childElementCount === 0;
  fit(screens, screens.childElementCount);
  fit(gallery, gallery.childElementCount);
}

function render() {
  const others = peers.filter((peer) => peer.id !== me?.id);
  $("people").textContent = peers.length === 1 ? "1 person here" : `${peers.length} people here`;
  const hosting = Boolean(peers.find((peer) => peer.id === me?.id)?.host);
  $("people-list").replaceChildren(
    ...peers.map((peer) => {
      const row = Object.assign(document.createElement("div"), { className: "person" });
      const name = Object.assign(document.createElement("span"), { textContent: peer.id === me?.id ? `${peer.name} (you)` : peer.name });
      row.append(name);
      if (peer.host) row.append(Object.assign(document.createElement("span"), { className: "tag", textContent: "Host" }));
      if (hosting && !peer.host) {
        const remove = Object.assign(document.createElement("button"), { type: "button", className: "remove inline" });
        remove.dataset.peer = peer.id;
        remove.dataset.name = peer.name;
        disarm(remove);
        row.append(remove);
      }
      return row;
    }),
  );
  paintStatus();
  const cameraOf = (peerId) => [...remote.values()].find((entry) => entry.ready && entry.peerId === peerId && entry.source === "camera")?.stream;
  const localStream = (source) => {
    const entry = local.get(source);
    return entry ? (entry.stream ??= new MediaStream([entry.track])) : undefined;
  };
  const people = [];
  const screens = [];
  const myName = peers.find((peer) => peer.id === me?.id)?.name ?? $("name").value;
  people.push(
    tileFor("person:me", {
      label: hosting ? `${myName} (you, host)` : `${myName} (you)`,
      stream: localStream("camera"),
      kind: "camera",
      mine: true,
      look: myLook,
      working: local.has("screen"),
      voice: "me",
      mic: local.has("mic"),
      deaf: deafened,
    }),
  );
  for (const peer of others) {
    const working = peer.tracks.some((track) => track.source === "screen");
    people.push(
      tileFor(`person:${peer.id}`, {
        label: peer.host ? `${peer.name} (host)` : peer.name,
        stream: cameraOf(peer.id),
        kind: "camera",
        look: peer.avatar ?? lookFor(peer.id),
        working,
        removable: hosting && !peer.host ? peer : null,
        voice: `peer:${peer.id}`,
        mic: peer.tracks.some((track) => track.source === "mic"),
        deaf: Boolean(peer.deafened),
      }),
    );
  }
  if (local.has("screen"))
    screens.push(
      tileFor("screen:me", { label: local.has("screen-audio") ? "Your screen, with sound" : "Your screen", stream: localStream("screen"), kind: "screen" }),
    );
  for (const [name, entry] of remote) {
    if (!entry.ready || entry.source !== "screen") continue;
    const owner = peers.find((peer) => peer.id === entry.peerId)?.name ?? "Someone";
    const sound = peers.find((peer) => peer.id === entry.peerId)?.tracks.some((track) => track.source === "screen-audio");
    screens.push(tileFor(`screen:${name}`, { label: sound ? `${owner}'s screen, with sound` : `${owner}'s screen`, stream: entry.stream, kind: "screen" }));
  }
  const keep = new Set([...people, ...screens]);
  for (const [key, tile] of tiles)
    if (!keep.has(tile)) {
      hideBot(tile.querySelector(".avatar"));
      tile.remove();
      tiles.delete(key);
    }
  $("screens").replaceChildren(...screens);
  $("gallery").replaceChildren(...people);
  layout();
}

function resetMedia() {
  pc?.close();
  pc = null;
  sessionId = null;
  chain = Promise.resolve();
  for (const entry of local.values()) Object.assign(entry, { transceiver: null, name: null });
  for (const entry of remote.values()) if (entry.source === "mic") unwatchLevel(`peer:${entry.peerId}`);
  stopAllVoices();
  remote.clear();
}

function connect(name) {
  setStatus("Connecting");
  const scheme = location.protocol === "https:" ? "wss:" : "ws:";
  const query = new URLSearchParams({ name, client: clientId });
  if (hostKeyOf(roomId)) query.set("owner", hostKeyOf(roomId));
  socket = new WebSocket(`${scheme}//${location.host}/api/rooms/${roomId}/ws?${query}`);
  const current = socket;
  current.addEventListener("message", ({ data }) => {
    if (current !== socket || data === "pong") return;
    let message;
    try {
      message = JSON.parse(data);
    } catch {
      return;
    }
    if (message.type === "welcome") {
      me = { id: message.id, token: message.token };
      sendLook();
      if (deafened) sendState();
      serial(async () => {
        await startSession(message.iceServers);
        retry = 0;
        setStatus("Live");
        for (const source of local.keys()) push(source);
        syncRemote();
      });
    } else if (message.type === "peers") {
      peers = message.peers;
      render();
      tuneCamera();
      if (sessionId) syncRemote();
    }
  });
  current.addEventListener("close", ({ code }) => {
    if (current !== socket) return;
    clearInterval(pinger);
    resetMedia();
    peers = [];
    render();
    if (leaving) return;
    if (code === 4409) return backToJoin("This room is full.");
    if (code === 4403) return backToJoin("The host removed you from this room.");
    if (code === 4400) return backToJoin("Type your name to join.");
    setStatus("Reconnecting");
    setTimeout(() => connect(name), Math.min(1000 * 2 ** retry++, 15_000));
  });
  clearInterval(pinger);
  pinger = setInterval(() => current.readyState === WebSocket.OPEN && current.send("ping"), 20_000);
}

function backToJoin(error) {
  leaving = true;
  socket?.close(1000);
  socket = null;
  for (const source of local.keys()) stopLocal(source);
  resetMedia();
  peers = [];
  render();
  $("room").hidden = true;
  $("join").hidden = false;
  $("join-error").hidden = !error;
  $("join-error").textContent = error ?? "";
  $("join-button").textContent = "Join again";
}

/** Swaps what the camera sends without renegotiating: the plain camera, or the effect canvas running over it. */
function setEffect(id) {
  effect = id;
  saveEffect(id);
  paintEffects();
  const entry = local.get("camera");
  if (!entry) return;
  if (entry.pipeline && id !== "none") return entry.pipeline.setEffect(id);
  const pipeline = id === "none" ? null : createEffectCamera(entry.raw, id);
  if (id !== "none" && !pipeline) return toast("Effects need WebGL, which this browser has turned off");
  entry.pipeline?.stop();
  Object.assign(entry, { pipeline, track: pipeline?.track ?? entry.raw, stream: undefined });
  entry.transceiver?.sender.replaceTrack(entry.track).catch(() => {});
  render();
}

function paintEffects() {
  $("effects").setAttribute("aria-pressed", String(effect !== "none"));
  for (const button of $("effect-list").children) button.setAttribute("aria-pressed", String(button.dataset.effect === effect));
}

function setUpEffects() {
  $("effect-list").append(
    ...EFFECTS.map(({ id, name }) => {
      const button = Object.assign(document.createElement("button"), { type: "button", textContent: name });
      button.dataset.effect = id;
      return button;
    }),
  );
  $("effect-list").addEventListener("click", (event) => {
    const button = event.target.closest("[data-effect]");
    if (button) setEffect(button.dataset.effect);
  });
  $("effects-done").addEventListener("click", () => $("effects-sheet").close());
  $("effects-sheet").addEventListener("click", (event) => event.target === $("effects-sheet") && $("effects-sheet").close());
  $("effects").addEventListener("click", () => {
    paintEffects();
    $("effects-sheet").showModal();
  });
  paintEffects();
}

function disarm(button) {
  clearTimeout(Number(button.dataset.timer));
  delete button.dataset.armed;
  button.textContent = "Remove";
  button.setAttribute("aria-label", `Remove ${button.dataset.name}`);
}

/** Removing takes two clicks: the first asks, the second (within a few seconds) removes. */
function removeClicked(button) {
  if (!button.dataset.armed) {
    button.dataset.armed = "1";
    button.textContent = `Remove ${button.dataset.name}?`;
    button.dataset.timer = String(setTimeout(() => disarm(button), 4000));
    return;
  }
  disarm(button);
  if (socket?.readyState !== WebSocket.OPEN) return;
  socket.send(JSON.stringify({ type: "remove", id: button.dataset.peer }));
  toast(`${button.dataset.name} was removed`);
}

const TOGGLE_LABELS = {
  camera: ["Turn on camera", "Turn off camera"],
  screen: ["Share your screen", "Stop sharing"],
  mic: ["Unmute", "Mute"],
};
const DEVICES = {
  camera: { kind: "videoinput", key: "milagre-live:camera", title: "Camera", none: "No camera found" },
  mic: { kind: "audioinput", key: "milagre-live:mic", title: "Microphone", none: "No microphone found" },
};
const deviceId = (source) => localStorage.getItem(DEVICES[source].key);

function paintToggle(source, on) {
  if (!TOGGLE_LABELS[source]) return;
  const button = $(source);
  button.setAttribute("aria-pressed", String(on));
  const label = TOGGLE_LABELS[source][on ? 1 : 0];
  button.setAttribute("aria-label", label);
  button.title = label;
}

function closeMenus() {
  for (const menu of document.querySelectorAll(".menu")) menu.hidden = true;
}

function toggleMenu(id) {
  const open = $(id).hidden;
  closeMenus();
  $(id).hidden = !open;
}

async function openDeviceMenu(source) {
  const { kind, title, none } = DEVICES[source];
  const devices = (await navigator.mediaDevices.enumerateDevices().catch(() => [])).filter((device) => device.kind === kind && device.deviceId);
  const entry = local.get(source);
  const active = (entry?.raw ?? entry?.track)?.getSettings().deviceId ?? deviceId(source);
  const menu = $(`${source}-menu`);
  menu.replaceChildren(
    Object.assign(document.createElement("div"), { className: "menu-label", textContent: title }),
    ...(devices.length
      ? devices.map((device, index) => {
          const item = Object.assign(document.createElement("button"), { type: "button", textContent: device.label || `${title} ${index + 1}` });
          item.setAttribute("role", "menuitemradio");
          item.setAttribute("aria-checked", String(device.deviceId === active));
          item.dataset.device = device.deviceId;
          return item;
        })
      : [Object.assign(document.createElement("div"), { className: "people-list", textContent: none })]),
  );
  toggleMenu(`${source}-menu`);
}

async function chooseDevice(source, id) {
  closeMenus();
  localStorage.setItem(DEVICES[source].key, id);
  if (!local.has(source)) return;
  stopLocal(source);
  await toggle(source);
}

/**
 * A screen share takes the shared tab's sound, or the whole computer's where the browser offers it (Chrome and Edge ask
 * with a "Share audio" switch). A browser that refuses audio for screen capture gets asked again for video alone.
 */
async function captureScreen() {
  const video = { frameRate: { ideal: 15, max: 30 } };
  try {
    return await navigator.mediaDevices.getDisplayMedia({
      video,
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      systemAudio: "include",
    });
  } catch (error) {
    if (error?.name !== "TypeError" && error?.name !== "NotSupportedError") throw error;
    return navigator.mediaDevices.getDisplayMedia({ video, audio: false });
  }
}

function capture(source) {
  const saved = DEVICES[source] && deviceId(source);
  const chosen = saved ? { deviceId: { ideal: saved } } : {};
  if (source === "camera") return navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 }, ...chosen }, audio: false });
  if (source === "mic")
    return navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, ...chosen }, video: false });
  return captureScreen();
}

async function toggle(source) {
  if (local.has(source)) return stopLocal(source);
  if (source === "mic" && deafened) {
    micBeforeDeafen = false;
    toggleDeafen();
  }
  let stream;
  try {
    stream = await capture(source);
  } catch (error) {
    if (error?.name !== "NotAllowedError" && error?.name !== "AbortError") toast(error?.message || "Could not start it");
    else if (source === "camera") toast("Camera access was blocked");
    else if (source === "mic") toast("Microphone access was blocked");
    return;
  }
  const [track] = source === "mic" ? stream.getAudioTracks() : stream.getVideoTracks();
  if (!track) return;
  if (source === "screen") track.contentHint = "detail";
  track.addEventListener("ended", () => (local.get(source)?.raw ?? local.get(source)?.track) === track && stopLocal(source));
  const pipeline = source === "camera" && effect !== "none" ? createEffectCamera(track, effect) : null;
  local.set(source, { track: pipeline?.track ?? track, raw: source === "camera" ? track : null, pipeline, transceiver: null, name: null });
  const [sound] = source === "screen" ? stream.getAudioTracks() : [];
  if (sound) {
    sound.addEventListener("ended", () => local.get("screen-audio")?.track === sound && stopLocal("screen-audio"));
    local.set("screen-audio", { track: sound, raw: null, pipeline: null, transceiver: null, name: null });
    push("screen-audio");
  }
  if (source === "mic") watchLevel("me", stream, paintSpeaking);
  paintToggle(source, true);
  render();
  push(source);
}

function join(event) {
  event.preventDefault();
  const name = $("name").value.replace(/\s+/g, " ").trim();
  if (!name) {
    $("join-error").textContent = "Type your name first.";
    $("join-error").hidden = false;
    return $("name").focus();
  }
  localStorage.setItem(NAME_KEY, name);
  if (!roomId) {
    roomId = newRoomId();
    localStorage.setItem(`milagre-live:host:${roomId}`, randomToken(40));
    history.replaceState(null, "", `/r/${roomId}`);
  }
  leaving = false;
  $("join").hidden = true;
  $("room").hidden = false;
  render();
  connect(name);
}

$("name").value = localStorage.getItem(NAME_KEY) ?? "";
if (roomId) {
  $("join-button").textContent = "Join";
  $("join-intro").textContent = "Type your name to join this room. You can share your screen or camera once you're in.";
}
if (!navigator.mediaDevices?.getDisplayMedia) $("screen").hidden = true;
$("join-form").addEventListener("submit", join);
$("join-avatar-button").addEventListener("click", customize);
$("avatar").addEventListener("click", customize);
setUpEffects();
showBot($("join-avatar"), myLook);
$("camera").addEventListener("click", () => toggle("camera"));
$("mic").addEventListener("click", () => toggle("mic"));
$("deafen").addEventListener("click", () => toggleDeafen());
$("screen").addEventListener("click", () => toggle("screen"));
$("leave").addEventListener("click", () => backToJoin(null));
$("copy").addEventListener("click", () => {
  closeMenus();
  navigator.clipboard.writeText(location.href).then(
    () => toast("Link copied"),
    () => toast(location.href),
  );
});
for (const source of ["camera", "mic"]) {
  $(`${source}-menu-button`).addEventListener("click", (event) => {
    event.stopPropagation();
    openDeviceMenu(source);
  });
  $(`${source}-menu`).addEventListener("click", (event) => {
    const item = event.target.closest("[data-device]");
    if (item) chooseDevice(source, item.dataset.device);
  });
}
window.addEventListener("voice-blocked", () => toast("Click anywhere to hear the room"));
$("more-button").addEventListener("click", (event) => {
  event.stopPropagation();
  toggleMenu("more-menu");
});
document.addEventListener("click", (event) => !event.target.closest(".menu") && closeMenus());
document.addEventListener("keydown", (event) => event.key === "Escape" && closeMenus());
document.addEventListener("click", (event) => {
  const button = event.target.closest("button.remove");
  if (!button) return;
  event.stopPropagation();
  removeClicked(button);
});
$("name").focus();
new ResizeObserver(layout).observe($("stage"));

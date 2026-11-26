import { NAME_KEY, cleanName, createRoom, hostKeyName, randomToken } from "./ids.js";
import { botSvg, hideBot, loadLook, lookFor, openPicker, showBot } from "./avatars.js";
import { createPreview } from "./preview.js";
import { EFFECTS, createEffectCamera, loadEffect, saveEffect } from "./effects.js";
import { noiseSuppression, setNoiseSuppression, suppressNoise } from "./noise.js";
import { cameraEncoding, DEFAULT_SCREEN_PRESET, SCREEN_AUDIO_BITRATE, SCREEN_PRESETS, screenLayers } from "./media.mjs";
import { playVoice, setDeafened, setVolume, stopAllVoices, stopVoice, unwatchLevel, volumeOf, watchLevel } from "./voice.js";

const $ = (id) => document.getElementById(id);
const ROOM_PATH = /^\/r\/([a-z]{4}-[a-z]{4}-[a-z]{4})$/;

let myLook = loadLook();
let effect = loadEffect();
let deafened = false;
let micMuted = false;
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

const CLIENT_KEY = "milagre-live:client";
const clientId = localStorage.getItem(CLIENT_KEY) ?? randomToken(24);
localStorage.setItem(CLIENT_KEY, clientId);
const hostKeyOf = (room) => localStorage.getItem(hostKeyName(room));

function toast(text, duration = 2400) {
  const element = $("toast");
  element.textContent = text;
  element.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (element.hidden = true), duration);
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
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "state", deafened, muted: micMuted }));
}

const micLive = () => local.has("mic") && !micMuted;

/**
 * Muting keeps the mic open and sends silence, like Discord. Stopping and reopening it on every click made other sound
 * dip: the device switched modes (Bluetooth headsets drop to call quality) and the connection renegotiated.
 */
function setMicMuted(on) {
  micMuted = on;
  const entry = local.get("mic");
  if (entry) entry.track.enabled = !on;
  paintToggle("mic", micLive());
  sendState();
  render();
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
    micBeforeDeafen = micLive();
    if (micBeforeDeafen) setMicMuted(true);
  } else if (micBeforeDeafen) {
    micBeforeDeafen = false;
    if (local.has("mic")) setMicMuted(false);
    else await toggle("mic");
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

const QUALITY_KEY = "milagre-live:screen-quality";
const BEST_KEY = "milagre-live:screen-best";
const screenPreset = () => SCREEN_PRESETS[localStorage.getItem(QUALITY_KEY)] ?? SCREEN_PRESETS[DEFAULT_SCREEN_PRESET];
const screenBest = () => (localStorage.getItem(BEST_KEY) === "text" ? "text" : "motion");
const screenVideo = (preset) => ({
  frameRate: { ideal: preset.fps, max: preset.fps },
  ...(preset.width ? { width: { max: preset.width }, height: { max: preset.height } } : {}),
});

/**
 * Applies the picked quality to a running share without picking the screen again: the capture's size and frame rate,
 * what the encoder may send, and what it gives up first when the network is short (frames for text, sharpness for
 * motion).
 */
function tuneScreen() {
  const entry = local.get("screen");
  if (!entry) return;
  const preset = screenPreset();
  entry.track.contentHint = screenBest() === "text" ? "detail" : "motion";
  entry.track.applyConstraints(screenVideo(preset)).catch(() => {});
  const sender = entry.transceiver?.sender;
  if (!sender) return;
  const parameters = sender.getParameters();
  if (!parameters.encodings?.length) return;
  const wanted = new Map(screenLayers(preset).map((layer) => [layer.rid, layer]));
  for (const encoding of parameters.encodings) {
    const layer = wanted.get(encoding.rid) ?? wanted.get("f");
    Object.assign(encoding, { maxBitrate: layer.maxBitrate, maxFramerate: layer.maxFramerate });
  }
  parameters.degradationPreference = screenBest() === "text" ? "maintain-resolution" : "maintain-framerate";
  sender.setParameters(parameters).catch(() => {});
}

/** The simulcast layers the browser really sends: one that couldn't make them sends a single unnamed encoding. */
const sentLayers = (entry) => {
  const rids = (entry.transceiver?.sender.getParameters().encodings ?? []).map((encoding) => encoding.rid).filter(Boolean);
  return rids.length > 1 ? rids : [];
};

function announce() {
  const tracks = [...local]
    .filter(([, entry]) => entry.name)
    .map(([source, entry]) =>
      source === "screen"
        ? { name: entry.name, source, kbps: Math.round(screenPreset().bitrate / 1000), layers: sentLayers(entry) }
        : { name: entry.name, source },
    );
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "publish", tracks }));
}

function push(source) {
  return serial(async () => {
    const entry = local.get(source);
    if (!entry || entry.name || !pc || !sessionId) return;
    const encodings = {
      camera: [cameraEncoding(peers.length)],
      screen: screenLayers(screenPreset()),
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
    if (source === "screen") tuneScreen();
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
      tracks: [
        {
          location: "remote",
          sessionId: peer.sessionId,
          trackName: name,
          ...(track.layers?.length ? { simulcast: { preferredRid: track.layers[0], priorityOrdering: "asciibetical", ridNotAvailable: "asciibetical" } } : {}),
        },
      ],
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
      playVoice(name, entry.stream, `voice:${peer.name}`);
      watchLevel(`peer:${entry.peerId}`, entry.stream, paintSpeaking);
    }
    if (entry.source === "screen-audio") playVoice(name, entry.stream, `stream:${peer.name}`);
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

const EXPAND =
  '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 3h6v6"/><path d="m21 3-7 7"/><path d="m3 21 7-7"/><path d="M9 21H3v-6"/></svg>';
const SHRINK =
  '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m14 10 7-7"/><path d="M20 10h-6V4"/><path d="m3 21 7-7"/><path d="M4 14h6v6"/></svg>';

/**
 * Full view, like Meet: one tile fills the page above the dock, inside the page rather than the browser's fullscreen,
 * so the dock, the menus and everyone's sound stay where they are. It ends when its tile goes away.
 */
let focusKey = null;

function setFocus(key) {
  focusKey = key;
  paintFocus();
}

function paintFocus() {
  if (focusKey && !tiles.get(focusKey)?.isConnected) focusKey = null;
  for (const [key, tile] of tiles) {
    const on = key === focusKey;
    tile.classList.toggle("focused", on);
    const button = tile.querySelector(".expand");
    if (button.dataset.on === String(on)) continue;
    button.dataset.on = String(on);
    button.innerHTML = on ? SHRINK : EXPAND;
    button.setAttribute("aria-label", on ? "Exit full view" : "Full view");
    button.title = on ? "Exit full view (Esc)" : "Full view";
  }
  $("room").classList.toggle("focusing", Boolean(focusKey));
}

/** Puts `nodes` in `container` in order, moving only what is out of place, so playing videos aren't interrupted. */
function placeChildren(container, nodes) {
  const keep = new Set(nodes);
  for (const child of Array.from(container.children)) if (!keep.has(child)) child.remove();
  nodes.forEach((node, index) => {
    if (container.children[index] !== node) container.insertBefore(node, container.children[index] ?? null);
  });
}

function makeTile(key) {
  const tile = document.createElement("figure");
  tile.className = "tile";
  const video = Object.assign(document.createElement("video"), { autoplay: true, muted: true, playsInline: true });
  // A live picture is never meant to stop: Safari and iPhones pause it on leaving their video player, and nothing else
  // would start it again, so the picture froze on its last frame.
  video.addEventListener("pause", () => video.srcObject && video.play().catch(() => {}));
  const avatar = Object.assign(document.createElement("div"), { className: "avatar" });
  const remove = Object.assign(document.createElement("button"), { type: "button", className: "remove", hidden: true });
  const volume = Object.assign(document.createElement("label"), { className: "volume", hidden: true });
  const slider = Object.assign(document.createElement("input"), { type: "range", min: "0", max: "100", step: "1" });
  volume.append(Object.assign(document.createElement("span"), { className: "volume-icon" }), slider);
  slider.addEventListener("input", () => {
    setVolume(volume.dataset.group, Number(slider.value) / 100);
    paintVolume(volume);
  });
  const expand = Object.assign(document.createElement("button"), { type: "button", className: "expand" });
  expand.addEventListener("click", () => setFocus(focusKey === key ? null : key));
  video.addEventListener("dblclick", () => setFocus(focusKey === key ? null : key));
  tile.append(avatar, video, document.createElement("figcaption"), remove, volume, expand);
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

const SPEAKER =
  '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 4.702a.705.705 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.705.705 0 0 0 11 19.298z"/><path d="M16 9a5 5 0 0 1 0 6"/><path d="M19.364 18.364a9 9 0 0 0 0-12.728"/></svg>';
const SPEAKER_OFF =
  '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 4.702a.705.705 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.705.705 0 0 0 11 19.298z"/><line x1="22" x2="16" y1="9" y2="15"/><line x1="16" x2="22" y1="9" y2="15"/></svg>';

function paintVolume(volume) {
  const slider = volume.querySelector("input");
  const value = Number(slider.value);
  volume.querySelector(".volume-icon").innerHTML = value === 0 ? SPEAKER_OFF : SPEAKER;
  slider.style.setProperty("--fill", `${value}%`);
  slider.setAttribute("aria-valuetext", `${value}%`);
}

/** A slider for whose sound this tile carries; `null` hides it. Leaves a slider alone while someone drags it. */
function showVolume(tile, sound) {
  const volume = tile.querySelector(".volume");
  volume.hidden = !sound;
  if (!sound) return;
  const slider = volume.querySelector("input");
  slider.setAttribute("aria-label", sound.label);
  volume.title = sound.label;
  if (volume.dataset.group === sound.group && document.activeElement === slider) return;
  volume.dataset.group = sound.group;
  slider.value = String(Math.round(volumeOf(sound.group) * 100));
  paintVolume(volume);
}

function tileFor(key, { label, stream, kind, mine = false, look, working = false, removable = null, voice = null, mic = null, deaf = false, sound = null }) {
  const tile = tiles.get(key) ?? makeTile(key);
  showVolume(tile, sound);
  const remove = tile.querySelector(".remove");
  remove.hidden = !removable;
  if (removable && remove.dataset.peer !== removable.id) {
    remove.dataset.peer = removable.id;
    remove.dataset.name = removable.name;
    disarm(remove);
  }
  tile.className = `tile ${kind}${mine ? " mine" : ""}${stream ? " has-video" : ""}${voice && speakingNow.has(voice) ? " speaking" : ""}${key === focusKey ? " focused" : ""}`;
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
      mic: micLive(),
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
        mic: peer.tracks.some((track) => track.source === "mic") && !peer.muted,
        deaf: Boolean(peer.deafened),
        sound: peer.tracks.some((track) => track.source === "mic") ? { group: `voice:${peer.name}`, label: `${peer.name}'s volume` } : null,
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
    screens.push(
      tileFor(`screen:${name}`, {
        label: sound ? `${owner}'s screen, with sound` : `${owner}'s screen`,
        stream: entry.stream,
        kind: "screen",
        sound: sound ? { group: `stream:${owner}`, label: `${owner}'s screen volume` } : null,
      }),
    );
  }
  const keep = new Set([...people, ...screens]);
  for (const [key, tile] of tiles)
    if (!keep.has(tile)) {
      hideBot(tile.querySelector(".avatar"));
      tile.remove();
      tiles.delete(key);
    }
  placeChildren($("screens"), screens);
  placeChildren($("gallery"), people);
  paintFocus();
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
  $("join-label").textContent = "Join again";
  showJoin();
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
  if (source === "mic") {
    const item = Object.assign(document.createElement("button"), { type: "button", textContent: "Noise suppression", id: "noise-toggle" });
    item.setAttribute("role", "menuitemcheckbox");
    item.setAttribute("aria-checked", String(noiseSuppression()));
    menu.append(Object.assign(document.createElement("div"), { className: "menu-line" }), item);
  }
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
  const video = screenVideo(screenPreset());
  let stream;
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({
      video,
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, restrictOwnAudio: true },
      systemAudio: "include",
      selfBrowserSurface: "exclude",
    });
  } catch (error) {
    if (error?.name !== "TypeError" && error?.name !== "NotSupportedError") throw error;
    return navigator.mediaDevices.getDisplayMedia({ video, audio: false });
  }
  keepCallOutOfSound(stream);
  return stream;
}

/**
 * A whole screen's or window's sound includes the call playing on this computer, so everyone would hear themselves back.
 * Chrome leaves this page's own sound out when asked (`restrictOwnAudio`); where the browser didn't, the share goes
 * without sound. A tab's sound never has the call in it: the picker hides this tab.
 */
function keepCallOutOfSound(stream) {
  const [sound] = stream.getAudioTracks();
  if (!sound) return;
  const surface = stream.getVideoTracks()[0]?.getSettings().displaySurface;
  if (surface === "browser" || sound.getSettings().restrictOwnAudio === true) return;
  stream.removeTrack(sound);
  sound.stop();
  toast("Sharing without sound: this browser would send the call back to everyone. Share a tab to include its sound.", 6000);
}

function radio(label, checked, data) {
  const item = Object.assign(document.createElement("button"), { type: "button", textContent: label });
  item.setAttribute("role", "menuitemradio");
  item.setAttribute("aria-checked", String(checked));
  Object.assign(item.dataset, data);
  return item;
}

function openScreenMenu() {
  const current = screenPreset();
  $("screen-menu").replaceChildren(
    Object.assign(document.createElement("div"), { className: "menu-label", textContent: "Screen quality" }),
    ...Object.entries(SCREEN_PRESETS).map(([id, preset]) => radio(preset.label, preset === current, { quality: id })),
    Object.assign(document.createElement("div"), { className: "menu-line" }),
    Object.assign(document.createElement("div"), { className: "menu-label", textContent: "Best for" }),
    radio("Smooth motion", screenBest() === "motion", { best: "motion" }),
    radio("Sharp text", screenBest() === "text", { best: "text" }),
  );
  toggleMenu("screen-menu");
}

function chooseScreen(item) {
  closeMenus();
  if (item.dataset.quality) localStorage.setItem(QUALITY_KEY, item.dataset.quality);
  if (item.dataset.best) localStorage.setItem(BEST_KEY, item.dataset.best);
  toast(`${screenPreset().label}, ${screenBest() === "text" ? "sharp text" : "smooth motion"}`);
  if (!local.has("screen")) return;
  tuneScreen();
  announce();
}

/** Applies at once: a mic that is on starts again with or without RNNoise. */
async function toggleNoise() {
  closeMenus();
  setNoiseSuppression(!noiseSuppression());
  toast(noiseSuppression() ? "Noise suppression on" : "Noise suppression off");
  if (!local.has("mic")) return;
  stopLocal("mic");
  await toggle("mic");
}

function openDevice(source) {
  const saved = DEVICES[source] && deviceId(source);
  const chosen = saved ? { deviceId: { ideal: saved } } : {};
  if (source === "camera") return navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 }, ...chosen }, audio: false });
  if (source === "mic")
    return navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, ...chosen }, video: false });
  return captureScreen();
}

/** The join screen's camera and mic go into the room as they are; anything else asks the browser. */
function capture(source) {
  const track = preview.take(source);
  return track ? Promise.resolve(new MediaStream([track])) : openDevice(source);
}

const preview = createPreview({
  open: openDevice,
  blocked: (source) => toast(source === "camera" ? "Camera access was blocked" : "Microphone access was blocked"),
  meter: $("preview-meter"),
  paint(intent, tracks) {
    for (const source of ["mic", "camera"]) {
      const button = $(`preview-${source}`);
      const label = source === "mic" ? (intent.mic ? "Join with mic off" : "Join with mic on") : intent.camera ? "Join with camera off" : "Join with camera on";
      button.setAttribute("aria-pressed", String(intent[source]));
      button.setAttribute("aria-label", label);
      button.title = label;
    }
    const video = $("preview-video");
    const camera = intent.camera ? tracks.camera : null;
    if ((video.srcObject?.getVideoTracks()[0] ?? null) !== camera) video.srcObject = camera ? new MediaStream([camera]) : null;
    video.hidden = !camera;
    $("preview").classList.toggle("camera-on", Boolean(camera));
  },
});

function paintStars() {
  let seed = 7;
  const random = () => (seed = (seed * 9301 + 49297) % 233280) / 233280;
  const stars = Array.from({ length: 70 }, () => {
    const star = document.createElement("i");
    const size = [1, 1, 1, 1.5, 1.5, 2, 2.5][Math.floor(random() * 7)];
    star.className = size >= 2.5 ? "star big" : "star";
    star.style.cssText = `left:${2 + random() * 96}%;top:${2 + random() * 60}%;--s:${size}px;--d:${2.5 + random() * 4.5}s;--delay:${-random() * 7}s;--low:${0.1 + random() * 0.35}`;
    return star;
  });
  $("sky").prepend(...stars);
}

const listNames = (names, more) => {
  if (more) return `${names.join(", ")} and ${more} other${more === 1 ? "" : "s"}`;
  return names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}` : names[0];
};

/** The join screen's title and who's here row, from the room's roster; checked again while the screen is up. */
async function paintWho() {
  if (!roomId) return;
  let people;
  try {
    const response = await fetch(`/api/rooms/${roomId}/who`, { method: "POST" });
    if (!response.ok) return;
    ({ people } = await response.json());
  } catch {
    return;
  }
  if ($("join").hidden) return;
  const host = people.find((person) => person.host);
  const title = $("join-title");
  title.replaceChildren();
  if (host && host.name !== cleanName($("name").value))
    title.append("Join ", Object.assign(document.createElement("em"), { textContent: `${host.name}'s` }), " room");
  else title.textContent = "Join the room";
  $("here").hidden = false;
  $("here-bots").hidden = !people.length;
  $("here-bots").replaceChildren(
    ...people.slice(0, 3).map((person) => {
      const bubble = document.createElement("span");
      bubble.innerHTML = botSvg(person.avatar ?? lookFor(person.name));
      return bubble;
    }),
  );
  const names = people.slice(0, people.length > 3 ? 2 : 3).map((person) => person.name);
  $("here-text").textContent = people.length
    ? `${listNames(names, people.length - names.length)} ${people.length === 1 ? "is" : "are"} here`
    : "Nobody's here yet";
}

let whoTimer = 0;
function showJoin() {
  preview.start();
  paintWho();
  clearInterval(whoTimer);
  if (roomId) whoTimer = setInterval(paintWho, 8000);
}

async function toggle(source) {
  if (source === "mic" && local.has("mic")) {
    if (micMuted && deafened) {
      micBeforeDeafen = false;
      toggleDeafen();
    }
    return setMicMuted(!micMuted);
  }
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
  if (source === "screen") track.contentHint = screenBest() === "text" ? "detail" : "motion";
  track.addEventListener("ended", () => (local.get(source)?.raw ?? local.get(source)?.track) === track && stopLocal(source));
  const pipeline = source === "camera" && effect !== "none" ? createEffectCamera(track, effect) : null;
  local.set(source, { track: pipeline?.track ?? track, raw: source === "camera" ? track : null, pipeline, transceiver: null, name: null });
  const [sound] = source === "screen" ? stream.getAudioTracks() : [];
  if (sound) {
    sound.addEventListener("ended", () => local.get("screen-audio")?.track === sound && stopLocal("screen-audio"));
    local.set("screen-audio", { track: sound, raw: null, pipeline: null, transceiver: null, name: null });
    push("screen-audio");
  }
  if (source === "mic") {
    micMuted = false;
    const cleaned = noiseSuppression() ? await suppressNoise(track).catch(() => null) : null;
    if (noiseSuppression() && !cleaned) toast("Noise suppression couldn't start; your mic is on without it");
    if (cleaned) Object.assign(local.get("mic"), { track: cleaned.track, raw: track, pipeline: cleaned });
    watchLevel("me", new MediaStream([local.get("mic").track]), paintSpeaking);
    sendState();
  }
  paintToggle(source, true);
  render();
  push(source);
}

function join(event) {
  event.preventDefault();
  enter(cleanName($("name").value));
}

function enter(name) {
  if (!name) {
    $("join-error").textContent = "Type your name first.";
    $("join-error").hidden = false;
    return $("name").focus();
  }
  localStorage.setItem(NAME_KEY, name);
  if (!roomId) {
    roomId = createRoom();
    history.replaceState(null, "", `/r/${roomId}`);
  }
  leaving = false;
  clearInterval(whoTimer);
  $("join").hidden = true;
  $("room").hidden = false;
  render();
  connect(name);
  const bring = preview.intent();
  for (const source of ["mic", "camera"]) if (bring[source] && !local.has(source)) toggle(source);
  preview.stop();
}

$("name").value = localStorage.getItem(NAME_KEY) ?? "";
const paintName = () => ($("preview-name").textContent = cleanName($("name").value) || "You");
paintName();
$("name").addEventListener("input", paintName);
if (roomId) {
  $("join-label").textContent = "Join room";
  $("join-title").textContent = "Join the room";
}
paintStars();
for (const source of ["mic", "camera"]) $(`preview-${source}`).addEventListener("click", () => preview.toggle(source));
$("join-avatar").addEventListener("click", customize);
$("join-avatar").addEventListener("keydown", (event) => (event.key === "Enter" || event.key === " ") && (event.preventDefault(), customize()));
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
    if (event.target.closest("#noise-toggle")) toggleNoise();
  });
}
$("screen-menu-button").addEventListener("click", (event) => {
  event.stopPropagation();
  openScreenMenu();
});
$("screen-menu").addEventListener("click", (event) => {
  const item = event.target.closest("[data-quality], [data-best]");
  if (item) chooseScreen(item);
});
window.addEventListener("voice-blocked", () => toast("Click anywhere to hear the room"));
$("more-button").addEventListener("click", (event) => {
  event.stopPropagation();
  toggleMenu("more-menu");
});
document.addEventListener("click", (event) => !event.target.closest(".menu") && closeMenus());
document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  if (focusKey && [...document.querySelectorAll(".menu")].every((menu) => menu.hidden) && !document.querySelector("dialog[open]")) setFocus(null);
  closeMenus();
});
document.addEventListener("click", (event) => {
  const button = event.target.closest("button.remove");
  if (!button) return;
  event.stopPropagation();
  removeClicked(button);
});
$("name").focus();
new ResizeObserver(layout).observe($("stage"));
const autoJoin = roomId && new URLSearchParams(location.search).has("join") && localStorage.getItem(NAME_KEY);
if (!autoJoin) showJoin();
// The landing page made this room and sends its host here with `?join=1`: they already typed a name, so go in.
if (autoJoin) {
  history.replaceState(null, "", `/r/${roomId}`);
  enter(localStorage.getItem(NAME_KEY));
}

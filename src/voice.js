const players = new Map();
const meters = new Map();
let context = null;
let ticking = 0;
let blocked = false;
let report = () => {};

function container() {
  let element = document.getElementById("voices");
  if (!element) {
    element = Object.assign(document.createElement("div"), { id: "voices", hidden: true });
    document.body.append(element);
  }
  return element;
}

/** A browser may refuse to start sound before the person clicks; the next click anywhere starts every voice. */
function play(audio) {
  audio.play().catch(() => {
    if (blocked) return;
    blocked = true;
    document.addEventListener(
      "click",
      () => {
        blocked = false;
        for (const player of players.values()) player.play().catch(() => {});
        context?.resume().catch(() => {});
      },
      { once: true, capture: true },
    );
    window.dispatchEvent(new CustomEvent("voice-blocked"));
  });
}

export function playVoice(key, stream) {
  let audio = players.get(key);
  if (!audio) {
    audio = Object.assign(document.createElement("audio"), { autoplay: true });
    container().append(audio);
    players.set(key, audio);
  }
  if (audio.srcObject !== stream) audio.srcObject = stream;
  play(audio);
}

export function stopVoice(key) {
  const audio = players.get(key);
  if (!audio) return;
  audio.srcObject = null;
  audio.remove();
  players.delete(key);
}

export function stopAllVoices() {
  for (const key of players.keys()) stopVoice(key);
}

/**
 * Measures each voice's loudness ten times a second and reports who is speaking. One AudioContext serves every voice;
 * the analysers only read the stream and are never connected to the speakers.
 */
export function watchLevel(key, stream, onSpeaking) {
  unwatchLevel(key);
  report = onSpeaking;
  context ??= new AudioContext();
  context.resume().catch(() => {});
  const source = context.createMediaStreamSource(stream);
  const analyser = Object.assign(context.createAnalyser(), { fftSize: 512, smoothingTimeConstant: 0.6 });
  source.connect(analyser);
  meters.set(key, { source, analyser, samples: new Uint8Array(analyser.fftSize), loudUntil: 0 });
  if (!ticking)
    ticking = setInterval(() => {
      const now = performance.now();
      const speaking = new Set();
      for (const [name, meter] of meters) {
        meter.analyser.getByteTimeDomainData(meter.samples);
        let sum = 0;
        for (const sample of meter.samples) sum += ((sample - 128) / 128) ** 2;
        if (Math.sqrt(sum / meter.samples.length) > 0.04) meter.loudUntil = now + 350;
        if (meter.loudUntil > now) speaking.add(name);
      }
      report(speaking);
    }, 100);
}

export function unwatchLevel(key) {
  const meter = meters.get(key);
  if (!meter) return;
  meter.source.disconnect();
  meters.delete(key);
  if (!meters.size) {
    clearInterval(ticking);
    ticking = 0;
    report(new Set());
  }
}

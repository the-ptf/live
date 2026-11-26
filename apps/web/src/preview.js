// The join screen's check before going in: the camera as the room will see it, the mic's level, and which of the two to
// bring. The tracks it opens are handed to the room on join, so nobody is asked twice.
const INTENT_KEY = "milagre-live:join-media";
const BARS = [1, 0.8, 0.65, 0.5, 0.4];

export function loadIntent() {
  try {
    const saved = JSON.parse(localStorage.getItem(INTENT_KEY) ?? "null");
    if (typeof saved?.mic === "boolean" && typeof saved?.camera === "boolean") return saved;
  } catch {
    /* falls through to the default */
  }
  return { mic: true, camera: false };
}

async function micAllowed() {
  try {
    return (await navigator.permissions.query({ name: "microphone" })).state === "granted";
  } catch {
    return false;
  }
}

/**
 * `open(source)` asks the browser for a fresh stream, `blocked(source)` says it was refused, and `paint(intent, tracks)`
 * redraws the screen. The mic is only opened on its own at start when the browser already allows it, so a first visit
 * isn't met by a permission prompt.
 */
export function createPreview({ open, blocked, paint, meter }) {
  const intent = loadIntent();
  const tracks = { mic: null, camera: null };
  let audio = null;
  let timer = 0;
  let active = false;

  const save = () => localStorage.setItem(INTENT_KEY, JSON.stringify(intent));
  const render = () => paint({ ...intent }, { ...tracks });

  function stopMeter() {
    clearInterval(timer);
    timer = 0;
    audio?.close().catch(() => {});
    audio = null;
    for (const bar of meter.children) bar.style.height = "";
  }

  function startMeter(track) {
    stopMeter();
    audio = new AudioContext();
    audio.resume().catch(() => {});
    const analyser = Object.assign(audio.createAnalyser(), { fftSize: 512, smoothingTimeConstant: 0.5 });
    audio.createMediaStreamSource(new MediaStream([track])).connect(analyser);
    const samples = new Uint8Array(analyser.fftSize);
    timer = setInterval(() => {
      analyser.getByteTimeDomainData(samples);
      let sum = 0;
      for (const sample of samples) sum += ((sample - 128) / 128) ** 2;
      const level = Math.min(1, Math.sqrt(sum / samples.length) * 8);
      [...meter.children].forEach((bar, index) => (bar.style.height = `${Math.round(3 + 9 * level * BARS[index])}px`));
    }, 90);
  }

  function drop(source) {
    tracks[source]?.stop();
    tracks[source] = null;
    if (source === "mic") stopMeter();
  }

  async function bring(source) {
    if (tracks[source]) return;
    let stream;
    try {
      stream = await open(source);
    } catch (error) {
      intent[source] = false;
      save();
      render();
      if (error?.name === "NotAllowedError") blocked(source);
      return;
    }
    const [track] = source === "mic" ? stream.getAudioTracks() : stream.getVideoTracks();
    if (!active || !intent[source] || !track) return track?.stop();
    tracks[source] = track;
    if (source === "mic") startMeter(track);
    render();
  }

  return {
    intent: () => ({ ...intent }),
    async start() {
      active = true;
      render();
      if (intent.camera) bring("camera");
      if (intent.mic && (await micAllowed())) bring("mic");
    },
    toggle(source) {
      intent[source] = !intent[source];
      save();
      if (intent[source]) bring(source);
      else drop(source);
      render();
    },
    /** Hands an open track to the room, which then owns it. */
    take(source) {
      const track = tracks[source];
      tracks[source] = null;
      if (source === "mic") stopMeter();
      return track;
    },
    stop() {
      active = false;
      drop("mic");
      drop("camera");
      render();
    },
  };
}

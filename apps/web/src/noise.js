import { loadRnnoise, RnnoiseWorkletNode } from "@sapphi-red/web-noise-suppressor";

const KEY = "milagre-live:noise";
let context = null;
let wasm = null;
let worklet = null;

export const noiseSuppression = () => localStorage.getItem(KEY) !== "off";
export const setNoiseSuppression = (on) => localStorage.setItem(KEY, on ? "on" : "off");

/**
 * Runs a mic through RNNoise (a small neural network that keeps voices and drops keyboards, fans and traffic) on top
 * of the browser's own noise suppression, and returns the cleaned track. RNNoise expects 48 kHz, so the context runs
 * at that rate whatever the mic does.
 */
export async function suppressNoise(track) {
  context ??= new AudioContext({ sampleRate: 48000 });
  await context.resume();
  wasm ??= loadRnnoise({ url: "/noise/rnnoise.wasm", simdUrl: "/noise/rnnoise_simd.wasm" });
  worklet ??= context.audioWorklet.addModule("/noise/rnnoise-worklet.js");
  const [binary] = await Promise.all([wasm, worklet]);
  const source = context.createMediaStreamSource(new MediaStream([track]));
  const node = new RnnoiseWorkletNode(context, { wasmBinary: binary, maxChannels: 1 });
  const destination = context.createMediaStreamDestination();
  source.connect(node);
  node.connect(destination);
  const [cleaned] = destination.stream.getAudioTracks();
  return {
    track: cleaned,
    stop() {
      source.disconnect();
      node.disconnect();
      node.destroy();
      cleaned.stop();
    },
  };
}

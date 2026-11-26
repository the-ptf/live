// Finds the face in the camera on the device, with MediaPipe's BlazeFace detector, so the camera effects can center on
// it. The detector (a few MB of wasm) loads only the first time someone turns an effect on; nothing leaves the device.
import { DEFAULT_FACE, LOST_AFTER_MS, faceFromBoxes, follow } from "./face-math.mjs";

const BASE = "/face/";
const FILESET = { wasmLoaderPath: `${BASE}vision_wasm_internal.js`, wasmBinaryPath: `${BASE}vision_wasm_internal.wasm` };
let vision = null;
let detector = null;
let segmenter = null;

const loadVision = () => {
  const bundle = `${BASE}vision_bundle.mjs`;
  vision ??= import(bundle).catch((error) => {
    vision = null;
    throw error;
  });
  return vision;
};
const retry = (promise, reset) => promise.catch((error) => (reset(), Promise.reject(error)));

function loadDetector() {
  detector ??= retry(
    loadVision().then(({ FaceDetector }) =>
      FaceDetector.createFromOptions(FILESET, {
        baseOptions: { modelAssetPath: `${BASE}blaze_face_short_range.tflite`, delegate: "CPU" },
        runningMode: "VIDEO",
        minDetectionConfidence: 0.5,
      }),
    ),
    () => (detector = null),
  );
  return detector;
}

/** The selfie segmenter: which pixels are the person, so Big head scales the head and not the wall behind it. */
function loadSegmenter() {
  segmenter ??= retry(
    loadVision().then(({ ImageSegmenter }) =>
      ImageSegmenter.createFromOptions(FILESET, {
        baseOptions: { modelAssetPath: `${BASE}selfie_segmenter.tflite`, delegate: "CPU" },
        runningMode: "VIDEO",
        outputConfidenceMasks: true,
        outputCategoryMask: false,
      }),
    ),
    () => (segmenter = null),
  );
  return segmenter;
}

/** Tracks the face in `video` about 12 times a second; `step()` eases toward it once per drawn frame. */
export function createFaceTracker(video, { fps = 12 } = {}) {
  let face = { ...DEFAULT_FACE };
  let target = DEFAULT_FACE;
  let seenAt = 0;
  let stopped = false;
  let timer = 0;
  let last = 0;
  const tracker = { found: false, failed: false, mask: null, wantsMask: false };
  let segment = null;

  const tick = (model) => {
    if (stopped) return;
    const now = performance.now();
    if (video.readyState >= 2 && video.videoWidth && now > last) {
      last = now;
      try {
        const result = model.detectForVideo(video, now);
        const found = faceFromBoxes(
          result.detections.map((detection) => detection.boundingBox),
          video.videoWidth,
          video.videoHeight,
        );
        if (tracker.wantsMask && segment) {
          const result = segment.segmentForVideo(video, now + 0.5);
          const mask = result.confidenceMasks?.[0];
          if (mask) {
            const values = mask.getAsFloat32Array();
            const data = new Uint8Array(values.length);
            for (let i = 0; i < values.length; i++) data[i] = values[i] * 255;
            tracker.mask = { data, width: mask.width, height: mask.height, version: (tracker.mask?.version ?? 0) + 1 };
          }
          result.close?.();
        }
        if (found) {
          target = { ...found, y: found.y + found.size * 0.08 };
          seenAt = now;
          tracker.found = true;
        } else if (now - seenAt > LOST_AFTER_MS) {
          target = DEFAULT_FACE;
          tracker.found = false;
        }
      } catch {
        /* a frame the detector couldn't read; try the next one */
      }
    }
    timer = setTimeout(() => tick(model), 1000 / fps);
  };
  loadDetector().then(tick, () => (tracker.failed = true));

  return Object.assign(tracker, {
    /** Also cut out the person each tick (Big head needs it). */
    useMask(on) {
      tracker.wantsMask = on;
      if (on && !segment)
        loadSegmenter().then(
          (model) => (segment = model),
          () => {},
        );
      if (!on) tracker.mask = null;
    },
    step() {
      face = follow(face, target, 0.25);
      return face;
    },
    stop() {
      stopped = true;
      clearTimeout(timer);
    },
  });
}

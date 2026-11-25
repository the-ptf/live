/** People in a room from which cameras send less: in a grid that full, every camera tile is small. */
export const CROWDED_AT = 6;
/** What a screen share sends at each quality the sharer can pick; `width` null keeps the screen's own size. */
export const SCREEN_PRESETS = {
  "720p30": { label: "720p · 30 fps", width: 1280, height: 720, fps: 30, bitrate: 2_500_000 },
  "1080p30": { label: "1080p · 30 fps", width: 1920, height: 1080, fps: 30, bitrate: 4_000_000 },
  "1080p60": { label: "1080p · 60 fps", width: 1920, height: 1080, fps: 60, bitrate: 6_000_000 },
  source60: { label: "Source · 60 fps", width: null, height: null, fps: 60, bitrate: 8_000_000 },
};
export const DEFAULT_SCREEN_PRESET = "1080p30";
export const SCREEN_BITRATE = SCREEN_PRESETS[DEFAULT_SCREEN_PRESET].bitrate;
/** What Opus sends for a voice, roughly; the browser picks it, so it is an estimate, not a cap. */
export const MIC_BITRATE = 50_000;
/** A shared tab's or screen's sound: music and video need more than a voice. */
export const SCREEN_AUDIO_BITRATE = 128_000;

export function cameraEncoding(people) {
  return people >= CROWDED_AT ? { maxBitrate: 300_000, scaleResolutionDownBy: 2 } : { maxBitrate: 900_000, scaleResolutionDownBy: 1 };
}

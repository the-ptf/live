/** People in a room from which cameras send less: in a grid that full, every camera tile is small. */
export const CROWDED_AT = 6;
export const SCREEN_BITRATE = 2_500_000;
/** What Opus sends for a voice, roughly; the browser picks it, so it is an estimate, not a cap. */
export const MIC_BITRATE = 50_000;
/** A shared tab's or screen's sound: music and video need more than a voice. */
export const SCREEN_AUDIO_BITRATE = 128_000;

export function cameraEncoding(people) {
  return people >= CROWDED_AT ? { maxBitrate: 300_000, scaleResolutionDownBy: 2 } : { maxBitrate: 900_000, scaleResolutionDownBy: 1 };
}

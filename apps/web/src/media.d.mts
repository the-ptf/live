export const CROWDED_AT: number;
export const SCREEN_BITRATE: number;
export const MIC_BITRATE: number;
export const SCREEN_AUDIO_BITRATE: number;
export function cameraEncoding(people: number): { maxBitrate: number; scaleResolutionDownBy: number };

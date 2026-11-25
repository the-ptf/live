export const CROWDED_AT: number;
export const SCREEN_PRESETS: Record<string, { label: string; width: number | null; height: number | null; fps: number; bitrate: number }>;
export const DEFAULT_SCREEN_PRESET: string;
export const SCREEN_BITRATE: number;
export const MIC_BITRATE: number;
export const SCREEN_AUDIO_BITRATE: number;
export function cameraEncoding(people: number): { maxBitrate: number; scaleResolutionDownBy: number };

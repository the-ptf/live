export const MAX_TEXT: number;
export const MAX_IMAGE: number;
export const HISTORY: number;
export const BURST: number;
export const BURST_MS: number;
export function cleanChat(message: unknown): { text: string; image: string | null } | null;
export function allowPost(times: unknown, now: number): { ok: boolean; times: number[] };

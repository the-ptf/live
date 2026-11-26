// The room's text chat: what a message may carry, the history a late joiner gets, and how fast one person may post.
export const MAX_TEXT = 4000;
export const MAX_IMAGE = 300_000;
export const HISTORY = 50;
export const BURST = 6;
export const BURST_MS = 10_000;
const IMAGE = /^data:image\/(jpeg|png|webp|gif);base64,[A-Za-z0-9+/]+=*$/;

const visible = (code) =>
  code === 9 ||
  code === 10 ||
  (code >= 32 &&
    code !== 127 &&
    !(code >= 0x80 && code < 0xa0) &&
    !(code >= 0x200b && code <= 0x200f) &&
    !(code >= 0x202a && code <= 0x202e) &&
    !(code >= 0x2066 && code <= 0x2069));

/** A posted message's text and image, cleaned, or null when there is nothing allowed to show. */
export function cleanChat(message) {
  const raw = typeof message?.text === "string" ? message.text : "";
  const text = [...raw]
    .filter((char) => visible(char.codePointAt(0)))
    .join("")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim();
  if ([...text].length > MAX_TEXT) return null;
  const image = typeof message?.image === "string" && message.image.length <= MAX_IMAGE && IMAGE.test(message.image) ? message.image : null;
  if (!text && !image) return null;
  return { text, image };
}

/** Whether someone who posted at `times` (newest last) may post again at `now`, and the times to keep. */
export function allowPost(times, now) {
  const recent = (Array.isArray(times) ? times : []).filter((at) => Number.isFinite(at) && now - at < BURST_MS);
  if (recent.length >= BURST) return { ok: false, times: recent };
  return { ok: true, times: [...recent, now].slice(-BURST) };
}

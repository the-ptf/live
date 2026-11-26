export const NAME_KEY = "milagre-live:name";
export const hostKeyName = (room) => `milagre-live:host:${room}`;

export function randomToken(length) {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  return [...crypto.getRandomValues(new Uint8Array(length))].map((byte) => alphabet[byte % alphabet.length]).join("");
}

export function newRoomId() {
  const letters = "abcdefghijklmnopqrstuvwxyz";
  const chars = [...crypto.getRandomValues(new Uint8Array(12))].map((byte) => letters[byte % 26]);
  return [chars.slice(0, 4), chars.slice(4, 8), chars.slice(8)].map((part) => part.join("")).join("-");
}

/** Makes a room this browser hosts: the host key stays here, the room only ever sees its hash. */
export function createRoom() {
  const room = newRoomId();
  localStorage.setItem(hostKeyName(room), randomToken(40));
  return room;
}

export const cleanName = (raw) => raw.replace(/\s+/g, " ").trim().slice(0, 40);

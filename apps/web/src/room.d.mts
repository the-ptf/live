export const MAX_PEERS: number;
export const ROOM_ID: RegExp;
export const FALLBACK_ICE: IceServer[];
export function randomId(length: number, alphabet?: string, random?: (n: number) => Uint8Array): string;
export function cleanName(raw: unknown): string;

export type Source = "screen" | "camera" | "mic" | "screen-audio";
export interface Peer {
  id: string;
  name: string;
  token: string;
  sessionId: string | null;
  tracks: { name: string; source: Source; kbps?: number }[];
  avatar: Avatar | null;
  host: boolean;
  client: string | null;
  deafened?: boolean;
  muted?: boolean;
}
export interface Avatar {
  shape: string;
  color: string;
  material: "flat" | "fluffy";
}
export interface IceServer {
  urls: string | string[];
  username?: string;
  credential?: string;
}
export interface RoomIo<S> {
  list(): { socket: S; peer: Peer | null }[];
  save(socket: S, peer: Peer | null): void;
  send(socket: S, text: string): void;
  close(socket: S, code: number, reason: string): void;
}
export interface RoomStore {
  get(key: string): string | undefined;
  put(key: string, value: string): void;
}
export interface Answer {
  status: number;
  body: unknown;
}
export interface Room<S> {
  refusal(name: unknown, client?: string | null): { status: number; error: string } | null;
  join(socket: S, name: string, credentials?: { client?: string | null; ownerKey?: string | null }): Promise<Peer>;
  message(socket: S, data: unknown): void;
  leave(socket: S): void;
  sfu(call: { token: string | null; method: string; path: string; body: string | null }): Promise<Answer>;
  ice(token: string | null): Promise<Answer>;
}
export function createRoom<S>(options: {
  io: RoomIo<S>;
  store: RoomStore;
  realtime: (method: string, path: string, body: unknown) => Promise<Answer>;
  iceServers: () => Promise<IceServer[]>;
  onChange?: (event: "join" | "change", peers: import("./stats.mjs").StatsPeer[]) => void;
  newPeerId?: () => string;
  newToken?: () => string;
}): Room<S>;

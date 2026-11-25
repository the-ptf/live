export interface StatsPeer {
  name: string;
  host: boolean;
  camera: boolean;
  screen: boolean;
  mic?: boolean;
  screenAudio?: boolean;
}
export interface Report {
  id: string;
  event: "join" | "change";
  peers: StatsPeer[];
}
export interface Day {
  joins: number;
  rooms: number;
  peak: number;
  gb: number;
}
export interface Snapshot {
  rooms: { id: string; since: number; updated: number; peers: StatsPeer[] }[];
  totals: { rooms: number; people: number; cameras: number; screens: number; mics: number; gbPerHour: number };
  today: Day;
  yesterday: Day;
  day24: { at: number; people: number; rooms: number }[];
  days: (Day & { date: string })[];
  monthGb: number;
}
export interface StatsStore {
  get(key: string): string | undefined;
  put(key: string, value: string): void;
  delete(key: string): void;
  list(prefix: string): Iterable<[string, string]>;
}
export function createStats(options: { store: StatsStore; now?: () => number }): {
  report(report: Report): void;
  snapshot(): Snapshot;
};

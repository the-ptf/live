import { cameraEncoding, MIC_BITRATE, SCREEN_BITRATE } from "./media.mjs";

const gbPerHour = (bitsPerSecond) => (bitsPerSecond * 3600) / 8 / 1e9;
const STALE_MS = 12 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const BUCKET_MS = 5 * 60 * 1000;
const KEEP_SAMPLES_MS = 8 * DAY;
const CHART_DAYS = 14;

const dayOf = (time) => new Date(time).toISOString().slice(0, 10);
const bucketKey = (bucket) => `sample:${String(bucket).padStart(10, "0")}`;

/** Every stream goes out once to each other person in its room, at the most the page lets it send. */
function totalsOf(rooms) {
  const sum = (pick) => rooms.reduce((total, room) => total + room.peers.filter(pick).length, 0);
  const rate = rooms.reduce((total, room) => {
    const others = room.peers.length - 1;
    const count = (source) => room.peers.filter((peer) => peer[source]).length;
    const camera = gbPerHour(cameraEncoding(room.peers.length).maxBitrate);
    return total + others * (count("camera") * camera + count("screen") * gbPerHour(SCREEN_BITRATE) + count("mic") * gbPerHour(MIC_BITRATE));
  }, 0);
  return {
    rooms: rooms.length,
    people: sum(() => true),
    cameras: sum((peer) => peer.camera),
    screens: sum((peer) => peer.screen),
    mics: sum((peer) => peer.mic),
    gbPerHour: rate,
  };
}

/**
 * The stats every room reports to. `store` is the stats object's durable key-value storage:
 *   room:<id>       the room's people as of its last change, and when it started
 *   day:<date>      joins, rooms started, the most people live at once, and video sent (GB, at most) that UTC day
 *   sample:<bucket> the most people and rooms live in each five minutes, kept eight days
 *   last            when the video rate last changed and what it was, to add up GB between reports
 */
export function createStats({ store, now = () => Date.now() }) {
  const rooms = () => {
    const out = [];
    for (const [key, value] of store.list("room:")) {
      const room = JSON.parse(value);
      if (now() - room.updated > STALE_MS) store.delete(key);
      else out.push(room);
    }
    return out;
  };
  const day = (date) => ({ joins: 0, rooms: 0, peak: 0, gb: 0, ...JSON.parse(store.get(`day:${date}`) ?? "{}") });
  const last = () => JSON.parse(store.get("last") ?? "null");

  /** The video sent since the last change, at the rate set then, split across the UTC days it spans. */
  function settle(until) {
    const previous = last();
    if (!previous || !previous.gbPerHour) return;
    let from = previous.at;
    while (from < until) {
      const date = dayOf(from);
      const end = Math.min(until, Date.parse(`${date}T00:00:00Z`) + DAY);
      const counts = day(date);
      counts.gb += (previous.gbPerHour * (end - from)) / HOUR;
      store.put(`day:${date}`, JSON.stringify(counts));
      from = end;
    }
  }

  /** A new bucket starts from who was live just before it, so a change inside it can't hide its peak. */
  function sample(totals, previous) {
    const bucket = Math.floor(now() / BUCKET_MS);
    const key = bucketKey(bucket);
    const before = JSON.parse(store.get(key) ?? "null") ?? previous;
    if (!store.get(key)) for (const [old] of store.list("sample:")) if (old < bucketKey(Math.floor((now() - KEEP_SAMPLES_MS) / BUCKET_MS))) store.delete(old);
    store.put(
      key,
      JSON.stringify({
        people: Math.max(before?.people ?? 0, totals.people),
        rooms: Math.max(before?.rooms ?? 0, totals.rooms),
        end: { people: totals.people, rooms: totals.rooms },
      }),
    );
  }

  return {
    report({ id, event, peers }) {
      settle(now());
      const previous = last();
      const key = `room:${id}`;
      const before = store.get(key);
      const today = dayOf(now());
      const counts = day(today);
      if (event === "join") counts.joins += 1;
      if (!peers.length) store.delete(key);
      else {
        if (!before) counts.rooms += 1;
        const since = before ? JSON.parse(before).since : now();
        store.put(key, JSON.stringify({ id, since, updated: now(), peers }));
      }
      const totals = totalsOf(rooms());
      counts.peak = Math.max(counts.peak, totals.people);
      store.put(`day:${today}`, JSON.stringify(counts));
      store.put("last", JSON.stringify({ at: now(), gbPerHour: totals.gbPerHour, people: totals.people, rooms: totals.rooms }));
      sample(totals, previous && { people: previous.people ?? 0, rooms: previous.rooms ?? 0 });
    },

    snapshot() {
      const live = rooms().sort((a, b) => b.peers.length - a.peers.length || a.since - b.since);
      const time = now();
      const pending = last();
      const pendingGb = (date) => {
        if (!pending?.gbPerHour) return 0;
        const dayStart = Date.parse(`${date}T00:00:00Z`);
        const from = Math.max(pending.at, dayStart);
        const until = Math.min(time, dayStart + DAY);
        return Math.max(0, (pending.gbPerHour * (until - from)) / HOUR);
      };
      const withPending = (date) => {
        const counts = day(date);
        return { ...counts, gb: counts.gb + pendingGb(date) };
      };

      // Samples only exist where something changed; a quiet stretch carries the last value forward.
      const end = Math.floor(time / BUCKET_MS);
      const start = end - (DAY / BUCKET_MS - 1);
      const samples = new Map([...store.list("sample:")].map(([key, value]) => [Number(key.slice(7)), JSON.parse(value)]));
      // A bucket with a change shows its peak; the buckets after it start from how it ended.
      const endOf = (value) => value.end ?? value;
      let carried = { people: 0, rooms: 0 };
      for (const [bucket, value] of [...samples].sort((a, b) => a[0] - b[0])) if (bucket < start) carried = endOf(value);
      const day24 = [];
      for (let bucket = start; bucket <= end; bucket++) {
        const value = samples.get(bucket);
        day24.push({ at: bucket * BUCKET_MS, people: value?.people ?? carried.people, rooms: value?.rooms ?? carried.rooms });
        if (value) carried = endOf(value);
      }

      const days = [];
      for (let back = CHART_DAYS - 1; back >= 0; back--) {
        const date = dayOf(time - back * DAY);
        days.push({ date, ...withPending(date) });
      }
      const month = dayOf(time).slice(0, 7);
      let monthGb = 0;
      for (const [key] of store.list(`day:${month}`)) monthGb += withPending(key.slice(4)).gb;
      if (!store.get(`day:${dayOf(time)}`)) monthGb += pendingGb(dayOf(time));

      return {
        rooms: live,
        totals: totalsOf(live),
        today: withPending(dayOf(time)),
        yesterday: withPending(dayOf(time - DAY)),
        day24,
        days,
        monthGb,
      };
    },
  };
}

import { test } from "node:test";
import assert from "node:assert/strict";
import { createStats } from "./stats.mjs";

function memoryStore() {
  const kv = new Map();
  return {
    get: (key) => kv.get(key),
    put: (key, value) => kv.set(key, value),
    delete: (key) => kv.delete(key),
    list: (prefix) => [...kv].filter(([key]) => key.startsWith(prefix)),
  };
}

const person = (name, extra = {}) => ({ name, host: false, camera: false, screen: false, ...extra });

test("rooms appear while someone is in them and count joins, rooms started and the peak", () => {
  let clock = Date.parse("2026-11-25T10:00:00Z");
  const stats = createStats({ store: memoryStore(), now: () => clock });
  stats.report({ id: "aaaa-bbbb-cccc", event: "join", peers: [person("Ana", { host: true })] });
  clock += 60_000;
  stats.report({ id: "aaaa-bbbb-cccc", event: "join", peers: [person("Ana", { host: true }), person("Bia", { camera: true })] });
  stats.report({ id: "dddd-eeee-ffff", event: "join", peers: [person("Cris", { screen: true })] });
  let snap = stats.snapshot();
  assert.deepEqual(
    snap.rooms.map((room) => [room.id, room.peers.length]),
    [
      ["aaaa-bbbb-cccc", 2],
      ["dddd-eeee-ffff", 1],
    ],
  );
  assert.equal(snap.rooms[0].since, Date.parse("2026-11-25T10:00:00Z"));
  assert.deepEqual({ ...snap.totals, gbPerHour: undefined }, { rooms: 2, people: 3, cameras: 1, screens: 1, mics: 0, gbPerHour: undefined });
  assert.ok(Math.abs(snap.totals.gbPerHour - 0.405) < 0.001);
  assert.deepEqual({ ...snap.today, gb: undefined }, { joins: 3, rooms: 2, peak: 3, gb: undefined });

  stats.report({ id: "aaaa-bbbb-cccc", event: "change", peers: [] });
  snap = stats.snapshot();
  assert.deepEqual(
    snap.rooms.map((room) => room.id),
    ["dddd-eeee-ffff"],
  );
  assert.equal(snap.today.peak, 3);
});

test("a room that stopped reporting for half a day is dropped", () => {
  let clock = Date.parse("2026-11-25T10:00:00Z");
  const stats = createStats({ store: memoryStore(), now: () => clock });
  stats.report({ id: "aaaa-bbbb-cccc", event: "join", peers: [person("Ana")] });
  clock += 13 * 60 * 60 * 1000;
  assert.deepEqual(stats.snapshot().rooms, []);
  assert.deepEqual(stats.snapshot().today, { joins: 1, rooms: 1, peak: 1, gb: 0 });
});

test("video adds up at the rate between changes, split at midnight, and counts toward the month", () => {
  let clock = Date.parse("2026-11-25T23:00:00Z");
  const stats = createStats({ store: memoryStore(), now: () => clock });
  const room = (peers) => stats.report({ id: "aaaa-bbbb-cccc", event: "change", peers });
  room([person("Ana", { camera: true }), person("Bia")]);
  clock += 2 * 60 * 60 * 1000;
  const snap = stats.snapshot();
  const byDate = Object.fromEntries(snap.days.map((day) => [day.date, day.gb]));
  assert.ok(Math.abs(byDate["2026-11-25"] - 0.405) < 0.001);
  assert.ok(Math.abs(byDate["2026-11-26"] - 0.405) < 0.001);
  room([]);
  const after = stats.snapshot();
  assert.ok(Math.abs(after.days.at(-1).gb - 0.405) < 0.001);
  assert.equal(after.days.length, 14);
  assert.ok(Math.abs(after.monthGb - 0.81) < 0.001);
});

test("the 24-hour series carries the last value through quiet stretches", () => {
  let clock = Date.parse("2026-11-25T10:00:00Z");
  const stats = createStats({ store: memoryStore(), now: () => clock });
  stats.report({ id: "aaaa-bbbb-cccc", event: "join", peers: [person("Ana"), person("Bia")] });
  clock += 60 * 60 * 1000;
  stats.report({ id: "aaaa-bbbb-cccc", event: "change", peers: [] });
  clock += 30 * 60 * 1000;
  const series = stats.snapshot().day24;
  assert.equal(series.length, 288);
  const at = (time) => series.find((point) => point.at <= Date.parse(time) && Date.parse(time) < point.at + 5 * 60 * 1000);
  assert.deepEqual([at("2026-11-25T09:00:00Z").people, at("2026-11-25T10:30:00Z").people, at("2026-11-25T11:20:00Z").people], [0, 2, 0]);
  assert.equal(at("2026-11-25T11:00:00Z").people, 2);
});

test("cameras count at the lower rate once a room has six people, and voices add a little", () => {
  const stats = createStats({ store: memoryStore(), now: () => Date.parse("2026-11-25T10:00:00Z") });
  const five = Array.from({ length: 5 }, (_, index) => person(`P${index}`, { camera: true }));
  stats.report({ id: "aaaa-bbbb-cccc", event: "join", peers: five });
  assert.ok(Math.abs(stats.snapshot().totals.gbPerHour - 5 * 4 * 0.405) < 0.001);
  stats.report({ id: "aaaa-bbbb-cccc", event: "join", peers: [...five, person("P5", { camera: true })] });
  assert.ok(Math.abs(stats.snapshot().totals.gbPerHour - 6 * 5 * 0.135) < 0.001);
  stats.report({ id: "aaaa-bbbb-cccc", event: "change", peers: [person("Ana", { mic: true }), person("Bia")] });
  assert.ok(Math.abs(stats.snapshot().totals.gbPerHour - 0.0225) < 0.0001);
  assert.equal(stats.snapshot().totals.mics, 1);
});

test("a screen share counts at the bitrate its sharer picked", () => {
  const stats = createStats({ store: memoryStore(), now: () => Date.parse("2026-11-25T10:00:00Z") });
  stats.report({ id: "aaaa-bbbb-cccc", event: "join", peers: [person("Ana", { screen: true, screenKbps: 8000 }), person("Bia")] });
  assert.ok(Math.abs(stats.snapshot().totals.gbPerHour - 3.6) < 0.001);
});

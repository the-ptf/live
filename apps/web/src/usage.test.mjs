import { test } from "node:test";
import assert from "node:assert/strict";
import { costOf, daysFrom, forecastOf } from "./usage.mjs";

test("each month gets 1,000 GB free and pays $0.05 a GB past it", () => {
  const cost = costOf([
    { date: "2026-11-25", bytes: 1.2e12 },
    { date: "2026-11-26", bytes: 0.3e12 },
    { date: "2026-12-01", bytes: 0.4e12 },
  ]);
  assert.deepEqual(
    cost.months.map(({ month, gb, billableGb, cost: usd, freeLeftGb }) => [month, gb, billableGb, Math.round(usd * 100) / 100, freeLeftGb]),
    [
      ["2026-11", 1500, 500, 25, 0],
      ["2026-12", 400, 0, 0, 600],
    ],
  );
  assert.equal(cost.totalGb, 1900);
  assert.equal(Math.round(cost.totalCost * 100) / 100, 25);
});

test("Cloudflare's answer becomes one row per date with SFU and TURN bytes", () => {
  const days = daysFrom({
    data: {
      viewer: {
        accounts: [
          {
            sfu: [
              { sum: { egressBytes: 4 }, dimensions: { date: "2026-11-26" } },
              { sum: { egressBytes: 1 }, dimensions: { date: "2026-11-25" } },
              { sum: { egressBytes: 2 }, dimensions: { date: "2026-11-26" } },
            ],
            turn: [{ sum: { egressBytes: 9 }, dimensions: { date: "2026-11-25" } }],
          },
        ],
      },
    },
  });
  assert.deepEqual(days, [
    { date: "2026-11-25", bytes: 1, turnBytes: 9 },
    { date: "2026-11-26", bytes: 6, turnBytes: 0 },
  ]);
  assert.throws(() => daysFrom({ errors: [{ message: "not authorized" }] }), /not authorized/);
});

test("the forecast holds the last week's pace to the end of the month", () => {
  const days = [
    { date: "2026-11-24", bytes: 0 },
    { date: "2026-11-25", bytes: 1e9 },
    { date: "2026-11-26", bytes: 3e9 },
    { date: "2026-11-27", bytes: 0.5e9 },
  ];
  const forecast = forecastOf(days, "2026-11-27");
  assert.equal(forecast.perDay, 2);
  assert.equal(forecast.basedOnDays, 2);
  assert.equal(forecast.daysInMonth, 30);
  assert.deepEqual(forecast.sent.slice(-3), [1, 4, 4.5]);
  assert.equal(forecast.projectedGb, 4.5 + 2 * 3);
  assert.equal(forecast.projectedCost, 0);
  assert.equal(forecast.freeRunsOutOn, null);
});

test("the forecast says when the free 1,000 GB runs out and what past it costs", () => {
  const days = Array.from({ length: 10 }, (_, index) => ({ date: `2026-12-${String(index + 1).padStart(2, "0")}`, bytes: 60e9 }));
  const forecast = forecastOf(days, "2026-12-10");
  assert.equal(forecast.perDay, 60);
  assert.equal(forecast.projectedGb, 600 + 60 * 21);
  assert.equal(forecast.freeRunsOutOn, "2026-12-17");
  assert.equal(Math.round(forecast.projectedCost * 100) / 100, 43);
  assert.equal(Math.round(forecast.monthAtPaceCost * 100) / 100, 40);
});

test("with no complete day yet, today so far is the pace", () => {
  const forecast = forecastOf([{ date: "2026-11-25", bytes: 2e9 }], "2026-11-25");
  assert.equal(forecast.perDay, 2);
  assert.equal(forecast.basedOnDays, 0);
  assert.equal(forecast.projectedGb, 2 + 2 * 5);
});

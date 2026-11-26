import { test } from "node:test";
import assert from "node:assert/strict";
import { costOf, daysFrom } from "./usage.mjs";

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

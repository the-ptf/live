import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_FACE, faceFromBoxes, follow } from "./face-math.mjs";

test("the biggest face becomes a center and size in uv space, y up", () => {
  const face = faceFromBoxes(
    [
      { originX: 100, originY: 100, width: 40, height: 40 },
      { originX: 800, originY: 180, width: 320, height: 360 },
    ],
    1280,
    720,
  );
  assert.deepEqual(face, { x: 960 / 1280, y: 1 - 360 / 720, size: 0.5 });
  assert.equal(faceFromBoxes([], 1280, 720), null);
  assert.equal(faceFromBoxes(undefined, 1280, 720), null);
});

test("following glides part of the way and never overshoots", () => {
  const target = { x: 0.8, y: 0.2, size: 0.6 };
  const half = follow(DEFAULT_FACE, target, 0.5);
  assert.ok(Math.abs(half.x - 0.65) < 1e-9 && Math.abs(half.y - 0.36) < 1e-9 && Math.abs(half.size - 0.51) < 1e-9);
  assert.deepEqual(follow(DEFAULT_FACE, target, 3), target);
  assert.deepEqual(follow(DEFAULT_FACE, target, -1), DEFAULT_FACE);
});

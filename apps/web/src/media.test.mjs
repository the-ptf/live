import { test } from "node:test";
import assert from "node:assert/strict";
import { SCREEN_LAYERS, SCREEN_PRESETS, screenLayers } from "./media.mjs";

test("a screen share sends full, half and quarter layers, best first in alphabetical order", () => {
  const layers = screenLayers(SCREEN_PRESETS["1080p60"]);
  assert.deepEqual(
    layers.map((layer) => layer.rid),
    SCREEN_LAYERS,
  );
  assert.deepEqual([...SCREEN_LAYERS].sort(), SCREEN_LAYERS);
  assert.deepEqual(
    layers.map((layer) => layer.scaleResolutionDownBy ?? 1),
    [1, 2, 4],
  );
  assert.equal(layers[0].maxBitrate, 6_000_000);
  assert.ok(layers[1].maxBitrate < layers[0].maxBitrate && layers[2].maxBitrate < layers[1].maxBitrate);
  assert.equal(layers[2].maxFramerate, 15);
});

// Where a camera effect is centered, in the shader's uv space (0 to 1, y up), and how big the face is there.
export const DEFAULT_FACE = { x: 0.5, y: 0.52, size: 0.42 };
export const LOST_AFTER_MS = 900;

/** The biggest detected face box (pixels, y down) as a center and a size in uv units, or null when there is none. */
export function faceFromBoxes(boxes, width, height) {
  const box = [...(boxes ?? [])].filter((item) => item && item.width > 0 && item.height > 0).sort((a, b) => b.width * b.height - a.width * a.height)[0];
  if (!box || !width || !height) return null;
  return {
    x: (box.originX + box.width / 2) / width,
    y: 1 - (box.originY + box.height / 2) / height,
    size: box.height / height,
  };
}

/** One smoothing step toward `target`: a fraction of the way each frame, so the effect glides instead of jittering. */
export function follow(current, target, amount) {
  const step = Math.max(0, Math.min(1, amount));
  return {
    x: current.x + (target.x - current.x) * step,
    y: current.y + (target.y - current.y) * step,
    size: current.size + (target.size - current.size) * step,
  };
}

export interface Face {
  x: number;
  y: number;
  size: number;
}
export const DEFAULT_FACE: Face;
export const LOST_AFTER_MS: number;
export function faceFromBoxes(
  boxes: { originX: number; originY: number; width: number; height: number }[] | undefined,
  width: number,
  height: number,
): Face | null;
export function follow(current: Face, target: Face, amount: number): Face;

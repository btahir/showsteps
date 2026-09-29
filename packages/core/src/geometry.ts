import type { Rect } from "./schema";

export function highlightPath(_rect: Rect, _pad: number, _radius: number): string {
  throw new Error("highlightPath: not implemented yet");
}
export function scaleRect(_rect: Rect, _sx: number, _sy?: number): Rect {
  throw new Error("scaleRect: not implemented yet");
}
export function clampRect(_rect: Rect, _bounds: { width: number; height: number }): Rect {
  throw new Error("clampRect: not implemented yet");
}

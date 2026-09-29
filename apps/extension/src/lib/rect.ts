// Maps CSS-pixel rectangles measured in the page to pixels of the captured screenshot.
// captureVisibleTab returns the visible viewport at device resolution, so the scale is
// imageWidth / viewportWidth (normally the devicePixelRatio, but zoom and scrollbars
// make the real ratio differ slightly, so measure it from the image instead of trusting dpr).

import type { Rect } from "@stepsnap/core";

export interface Viewport {
  width: number;
  height: number;
  scrollX: number;
  scrollY: number;
}

export function roundRect(r: Rect): Rect {
  const x = Math.round(r.x);
  const y = Math.round(r.y);
  return { x, y, width: Math.round(r.x + r.width) - x, height: Math.round(r.y + r.height) - y };
}

/** Intersect `r` with the box [0,0,w,h]. Returns null when nothing is left. */
export function clipRect(r: Rect, w: number, h: number): Rect | null {
  const x1 = Math.max(0, r.x);
  const y1 = Math.max(0, r.y);
  const x2 = Math.min(w, r.x + r.width);
  const y2 = Math.min(h, r.y + r.height);
  if (x2 <= x1 || y2 <= y1) return null;
  return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
}

/**
 * Viewport-relative CSS rect → image-pixel rect, clipped to the image.
 * One scale for both axes, measured from the width (PLAN §0.7: imageRect = cssRect × imageWidth /
 * viewportWidth). The captured height can differ from innerHeight (browser UI, emulated
 * viewports), the width does not. Returns null when the rect is off-screen or inputs are degenerate.
 */
export function cssRectToImage(
  css: Rect,
  viewport: Pick<Viewport, "width" | "height">,
  image: { width: number; height: number },
): Rect | null {
  if (viewport.width <= 0 || image.width <= 0 || image.height <= 0) return null;
  const k = image.width / viewport.width;
  const scaled = { x: css.x * k, y: css.y * k, width: css.width * k, height: css.height * k };
  const clipped = clipRect(scaled, image.width, image.height);
  return clipped ? roundRect(clipped) : null;
}

/** Image-pixel rect → rect in the coordinate space of an element showing the image at `displayWidth`. */
export function imageRectToDisplay(r: Rect, imageWidth: number, displayWidth: number): Rect {
  const s = displayWidth / imageWidth;
  return { x: r.x * s, y: r.y * s, width: r.width * s, height: r.height * s };
}

/** Display rect (e.g. drawn with the mouse over a scaled preview) → image pixels, clipped. */
export function displayRectToImage(
  r: Rect,
  displayWidth: number,
  image: { width: number; height: number },
): Rect | null {
  const s = image.width / displayWidth;
  const norm = normalizeRect(r);
  const clipped = clipRect({ x: norm.x * s, y: norm.y * s, width: norm.width * s, height: norm.height * s }, image.width, image.height);
  return clipped ? roundRect(clipped) : null;
}

/** Rect from two drag corners in any order. */
export function normalizeRect(r: Rect): Rect {
  const x = r.width < 0 ? r.x + r.width : r.x;
  const y = r.height < 0 ? r.y + r.height : r.y;
  return { x, y, width: Math.abs(r.width), height: Math.abs(r.height) };
}

/** Grow a rect by `pad` on each side, clipped to the image. */
export function padRect(r: Rect, pad: number, w: number, h: number): Rect {
  return clipRect({ x: r.x - pad, y: r.y - pad, width: r.width + 2 * pad, height: r.height + 2 * pad }, w, h) ?? r;
}

/** Translate a rect into the space of a crop (for drawing on a cropped canvas). */
export function toCropSpace(r: Rect, crop: Rect | undefined): Rect {
  if (!crop) return r;
  return { x: r.x - crop.x, y: r.y - crop.y, width: r.width, height: r.height };
}

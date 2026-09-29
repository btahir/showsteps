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

export type Corner = "nw" | "ne" | "sw" | "se";

/** Move `r` by (dx, dy), kept inside `bounds` (size unchanged). */
export function moveRect(r: Rect, dx: number, dy: number, bounds: { width: number; height: number }): Rect {
  const x = Math.round(Math.max(0, Math.min(bounds.width - r.width, r.x + dx)));
  const y = Math.round(Math.max(0, Math.min(bounds.height - r.height, r.y + dy)));
  return { x, y, width: r.width, height: r.height };
}

/**
 * Drag one corner of `r` by (dx, dy). The opposite corner stays put; the box never gets smaller
 * than `min` on either side and never leaves `bounds`.
 */
export function resizeRect(r: Rect, corner: Corner, dx: number, dy: number, bounds: { width: number; height: number }, min = 8): Rect {
  let x1 = r.x;
  let y1 = r.y;
  let x2 = r.x + r.width;
  let y2 = r.y + r.height;
  if (corner === "nw" || corner === "sw") x1 = Math.max(0, Math.min(x2 - min, x1 + dx));
  else x2 = Math.min(bounds.width, Math.max(x1 + min, x2 + dx));
  if (corner === "nw" || corner === "ne") y1 = Math.max(0, Math.min(y2 - min, y1 + dy));
  else y2 = Math.min(bounds.height, Math.max(y1 + min, y2 + dy));
  return roundRect({ x: x1, y: y1, width: x2 - x1, height: y2 - y1 });
}

/**
 * The "focus frame" for list thumbnails (design review #4): a 16:10 window centred on the
 * highlight, wide enough to show context (3 × the target, at least 40% of the image and 480 image
 * px), kept inside `bounds` (the crop, or the whole image). Steps without a highlight show the
 * top of the page at 16:10. Exports and the large view keep the full frame.
 */
export function focusFrame(image: { width: number; height: number }, highlight?: Rect, bounds?: Rect, scale = 1): Rect {
  const B = bounds ?? { x: 0, y: 0, width: image.width, height: image.height };
  const ASPECT = 16 / 10;
  if (!highlight) {
    const h = Math.min(B.height, B.width / ASPECT);
    return roundRect({ x: B.x, y: B.y, width: B.width, height: h });
  }
  // Same rule as core's focusFrame (used for the HTML phone detail images): 3 × the ring, whose box is
  // the target plus the 4 CSS px pad on each side.
  const ringW = highlight.width + 2 * 4 * scale;
  let w = Math.min(B.width, Math.max(3 * ringW, 0.4 * image.width, 480));
  let h = w / ASPECT;
  // Tall targets: grow until the whole ring (plus room for its tab) is inside.
  const needH = highlight.height * 1.5;
  if (h < needH) {
    h = needH;
    w = h * ASPECT;
  }
  if (w > B.width) {
    w = B.width;
    h = Math.min(h, w / ASPECT);
  }
  if (h > B.height) {
    h = B.height;
    w = Math.min(B.width, h * ASPECT);
  }
  const cx = highlight.x + highlight.width / 2;
  const cy = highlight.y + highlight.height / 2;
  const x = Math.max(B.x, Math.min(B.x + B.width - w, cx - w / 2));
  const y = Math.max(B.y, Math.min(B.y + B.height - h, cy - h / 2));
  return roundRect({ x, y, width: w, height: h });
}

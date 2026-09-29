// Maps CSS-pixel rectangles measured in the page to pixels of the captured screenshot.
// captureVisibleTab returns the visible viewport at device resolution, so the scale is
// imageWidth / viewportWidth (normally the devicePixelRatio, but zoom and scrollbars
// make the real ratio differ slightly, so measure it from the image instead of trusting dpr).

import { clampRect, cssToImageRect as coreCssToImage, focusFrame as coreFocusFrame } from "@showsteps/core";
import type { Rect } from "@showsteps/core";

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
 * The part of the page a screenshot shows, in layout-viewport CSS px (PLAN §3.8). At page scale 1
 * this is the whole layout viewport: `{width: innerWidth, height: innerHeight, offsetLeft: 0,
 * offsetTop: 0}`. With pinch zoom (`visualViewport.scale > 1`) only `innerWidth / scale` CSS px
 * are on screen, starting at `visualViewport.offsetLeft/offsetTop`.
 *
 * Why `innerWidth / scale` and not `visualViewport.width`: `visualViewport.width` leaves out a
 * classic scrollbar, but captureVisibleTab includes it, so the scale would be off by the
 * scrollbar's share (about 1.2% at 1280 px, 12 px at the right edge).
 */
export interface VisualViewportLike {
  width: number;
  height: number;
  offsetLeft: number;
  offsetTop: number;
  scale?: number;
}

/** What the recorder measures in the top frame (see VisualViewportLike). */
export function visualViewportOf(win: Pick<Window, "innerWidth" | "innerHeight"> & { visualViewport?: { scale: number; offsetLeft: number; offsetTop: number } | null }): VisualViewportLike {
  const vv = win.visualViewport;
  const scale = vv && vv.scale > 0 ? vv.scale : 1;
  return { width: win.innerWidth / scale, height: win.innerHeight / scale, offsetLeft: vv?.offsetLeft ?? 0, offsetTop: vv?.offsetTop ?? 0, scale };
}

/**
 * Layout-viewport CSS rect → image-pixel rect, clipped to the image (PLAN §3.8):
 *   sx = W / vv.width;  x0 = floor((r.x - vv.offsetLeft) * sx);  x1 = ceil((r.right - vv.offsetLeft) * sx)
 * and the same for y with the same factor. The scale is measured from the image, never assumed to
 * equal devicePixelRatio (browser zoom, pinch zoom and a 1 px rounding of the capture all fold into
 * it). One factor for both axes: captureVisibleTab pixels are square, so an image whose height does
 * not match the viewport's is a taller or shorter cut of the same page (headless viewport emulation,
 * browser UI), never a stretched one; scaling y by H / vv.height would move every ring in that case.
 * Outward rounding: the result always covers the element. Null when nothing is left on screen.
 */
export function cssRectToImageVV(css: Rect, vv: VisualViewportLike, image: { width: number; height: number }): Rect | null {
  if (!(vv.width > 0) || !(image.width > 0) || !(image.height > 0)) return null;
  const sx = image.width / vv.width;
  const shifted = { x: css.x - vv.offsetLeft, y: css.y - vv.offsetTop, width: css.width, height: css.height };
  const out = coreCssToImage(shifted, { devicePixelRatio: sx, round: "none" });
  // Snap values within a millionth of a pixel first, so 100.5 * 2 does not round out to 202.
  const snap = (v: number) => (Math.abs(v - Math.round(v)) < 1e-6 ? Math.round(v) : v);
  const x0 = Math.floor(snap(out.x));
  const y0 = Math.floor(snap(out.y));
  const x1 = Math.ceil(snap(out.x + out.width));
  const y1 = Math.ceil(snap(out.y + out.height));
  const c = clampRect({ x: x0, y: y0, width: x1 - x0, height: y1 - y0 }, image);
  return c.width > 0 && c.height > 0 ? c : null;
}

/**
 * Viewport-relative CSS rect → image-pixel rect when only the layout viewport is known (older
 * drafts, worker-side navigations): page scale 1, no pinch offset.
 */
export function cssRectToImage(
  css: Rect,
  viewport: Pick<Viewport, "width" | "height">,
  image: { width: number; height: number },
  visual?: VisualViewportLike,
): Rect | null {
  return cssRectToImageVV(css, visual ?? { width: viewport.width, height: viewport.height, offsetLeft: 0, offsetTop: 0 }, image);
}

/**
 * One hop of a frame chain: where a frame's content box sits in its parent's viewport, and how
 * much the parent scales it (CSS `transform: scale(0.5)` on the iframe gives 0.5).
 */
export interface FrameHop {
  x: number;
  y: number;
  scaleX: number;
  scaleY: number;
}

/** Compose hops outermost first into one hop (frame viewport → top viewport). */
export function composeHops(hops: FrameHop[]): FrameHop {
  let acc: FrameHop = { x: 0, y: 0, scaleX: 1, scaleY: 1 };
  for (const h of hops) acc = { x: acc.x + h.x * acc.scaleX, y: acc.y + h.y * acc.scaleY, scaleX: acc.scaleX * h.scaleX, scaleY: acc.scaleY * h.scaleY };
  return acc;
}

/** A rect in a frame's own viewport → the top-level viewport, through the composed hop. */
export function rectThroughHop(r: Rect, hop: FrameHop): Rect {
  return { x: hop.x + r.x * hop.scaleX, y: hop.y + r.y * hop.scaleY, width: r.width * hop.scaleX, height: r.height * hop.scaleY };
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
 * The "focus frame" for list thumbnails (design review #4, R2-3): core's focusFrame (16:10 around
 * the ring, width max(1.6 × ring, 0.3 × image, 360 CSS px), taller only when the ring and its tab
 * need it), applied inside `bounds` (the crop, or the whole image). Steps without a highlight show
 * the top of the page at 16:10. Exports and the large view keep the full frame.
 */
export function focusFrame(image: { width: number; height: number }, highlight?: Rect, bounds?: Rect, scale = 1, dpr = 1): Rect {
  const B = bounds ?? { x: 0, y: 0, width: image.width, height: image.height };
  if (!highlight) {
    const h = Math.min(B.height, B.width / 1.6);
    return roundRect({ x: B.x, y: B.y, width: B.width, height: h });
  }
  const local = { x: highlight.x - B.x, y: highlight.y - B.y, width: highlight.width, height: highlight.height };
  const f = coreFocusFrame(local, { width: B.width, height: B.height }, scale, dpr);
  return { x: f.x + B.x, y: f.y + B.y, width: f.width, height: f.height };
}

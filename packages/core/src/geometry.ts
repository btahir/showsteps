import type { Rect } from "./schema";

/** Pure rectangle math for highlights, redactions and crops. Units are whatever the caller uses. */

export interface Size {
  width: number;
  height: number;
}

const num = (n: number): string => {
  const r = Math.round(n * 100) / 100;
  return Object.is(r, -0) ? "0" : String(r);
};

/**
 * SVG path (`d` attribute) of a rounded rectangle around `rect`, grown by `pad` on every side.
 * `radius` is clamped to half the shorter side. Usable with `new Path2D(d)` on a canvas.
 */
export function highlightPath(rect: Rect, pad: number, radius: number): string {
  const x = rect.x - pad;
  const y = rect.y - pad;
  const w = Math.max(0, rect.width + pad * 2);
  const h = Math.max(0, rect.height + pad * 2);
  const r = Math.max(0, Math.min(radius, w / 2, h / 2));
  const x2 = x + w;
  const y2 = y + h;
  if (r === 0) return `M${num(x)} ${num(y)}H${num(x2)}V${num(y2)}H${num(x)}Z`;
  return (
    `M${num(x + r)} ${num(y)}H${num(x2 - r)}A${num(r)} ${num(r)} 0 0 1 ${num(x2)} ${num(y + r)}` +
    `V${num(y2 - r)}A${num(r)} ${num(r)} 0 0 1 ${num(x2 - r)} ${num(y2)}` +
    `H${num(x + r)}A${num(r)} ${num(r)} 0 0 1 ${num(x)} ${num(y2 - r)}` +
    `V${num(y + r)}A${num(r)} ${num(r)} 0 0 1 ${num(x + r)} ${num(y)}Z`
  );
}

/** Multiply a rect by `sx` (and `sy`, default `sx`). */
export function scaleRect(rect: Rect, sx: number, sy: number = sx): Rect {
  return { x: rect.x * sx, y: rect.y * sy, width: rect.width * sx, height: rect.height * sy };
}

/** Intersect `rect` with `[0, width] x [0, height]`. A rect fully outside becomes zero-sized at the nearest edge. */
export function clampRect(rect: Rect, bounds: Size): Rect {
  const x1 = Math.min(Math.max(rect.x, 0), bounds.width);
  const y1 = Math.min(Math.max(rect.y, 0), bounds.height);
  const x2 = Math.min(Math.max(rect.x + rect.width, 0), bounds.width);
  const y2 = Math.min(Math.max(rect.y + rect.height, 0), bounds.height);
  return { x: x1, y: y1, width: Math.max(0, x2 - x1), height: Math.max(0, y2 - y1) };
}

export function translateRect(rect: Rect, dx: number, dy: number): Rect {
  return { x: rect.x + dx, y: rect.y + dy, width: rect.width, height: rect.height };
}

/** Grow (or shrink, if negative) a rect by `pad` on every side. */
export function expandRect(rect: Rect, pad: number): Rect {
  return { x: rect.x - pad, y: rect.y - pad, width: Math.max(0, rect.width + pad * 2), height: Math.max(0, rect.height + pad * 2) };
}

export function intersectRects(a: Rect, b: Rect): Rect | undefined {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.width, b.x + b.width);
  const y2 = Math.min(a.y + a.height, b.y + b.height);
  return x2 > x1 && y2 > y1 ? { x: x1, y: y1, width: x2 - x1, height: y2 - y1 } : undefined;
}

export function unionRects(a: Rect, b: Rect): Rect {
  const x1 = Math.min(a.x, b.x);
  const y1 = Math.min(a.y, b.y);
  const x2 = Math.max(a.x + a.width, b.x + b.width);
  const y2 = Math.max(a.y + a.height, b.y + b.height);
  return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
}

/** True when `outer` fully covers `inner`. */
export function rectContains(outer: Rect, inner: Rect): boolean {
  return inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.width <= outer.x + outer.width && inner.y + inner.height <= outer.y + outer.height;
}

/** Round outward to whole pixels so the result always covers the original area. */
export function roundRectOut(rect: Rect): Rect {
  const x = Math.floor(rect.x);
  const y = Math.floor(rect.y);
  return { x, y, width: Math.ceil(rect.x + rect.width) - x, height: Math.ceil(rect.y + rect.height) - y };
}

export function isEmptyRect(rect: Rect): boolean {
  return !(rect.width > 0 && rect.height > 0);
}

export interface CssImageSpace {
  /** Screenshot pixels per CSS pixel (the page's devicePixelRatio at capture time). */
  devicePixelRatio: number;
  /** Viewport scroll offset in CSS px. Only used when `origin` is "document". */
  scrollX?: number;
  scrollY?: number;
  /**
   * "viewport" (default): the CSS rect came from `getBoundingClientRect()`, so it is already
   * relative to the captured viewport. "document": the rect is in page coordinates
   * (`rect + scroll`), so the scroll offset is subtracted first.
   */
  origin?: "viewport" | "document";
  /** Rounding of the result: "out" (default, whole pixels covering the target), "nearest", or "none". */
  round?: "out" | "nearest" | "none";
}

/** CSS px rect (from the page) to image px rect (in the captured screenshot). */
export function cssToImageRect(css: Rect, space: CssImageSpace): Rect {
  const dpr = space.devicePixelRatio > 0 ? space.devicePixelRatio : 1;
  const ox = space.origin === "document" ? (space.scrollX ?? 0) : 0;
  const oy = space.origin === "document" ? (space.scrollY ?? 0) : 0;
  const r = scaleRect({ x: css.x - ox, y: css.y - oy, width: css.width, height: css.height }, dpr);
  if (space.round === "none") return r;
  if (space.round === "nearest") return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) };
  return roundRectOut(r);
}

/** Inverse of `cssToImageRect` (never rounded). */
export function imageToCssRect(img: Rect, space: Omit<CssImageSpace, "round">): Rect {
  const dpr = space.devicePixelRatio > 0 ? space.devicePixelRatio : 1;
  const r = scaleRect(img, 1 / dpr);
  const ox = space.origin === "document" ? (space.scrollX ?? 0) : 0;
  const oy = space.origin === "document" ? (space.scrollY ?? 0) : 0;
  return { x: r.x + ox, y: r.y + oy, width: r.width, height: r.height };
}

/** Highlight geometry in CSS px of the captured page; multiply by `highlightScale(...)`. Mirrors packages/brand/tokens.ts. */
export const FLAG = {
  ringWidth: 3,
  haloWidth: 2,
  pad: 4,
  radius: 8,
  spotlightDim: [28, 18, 12, 0.12] as [number, number, number, number],
  tab: { height: 24, minWidth: 27, paddingX: 8.5, cornerRadius: 7, fillet: 7, fontSizeRatio: 0.6 },
} as const;

/** Image pixels per CSS px of highlight geometry: `devicePixelRatio * clamp(viewportCssWidth / 960, 1, 2)`. */
export function highlightScale(viewportCssWidth: number, devicePixelRatio: number): number {
  const s = Math.min(2, Math.max(1, viewportCssWidth / 960));
  return (devicePixelRatio > 0 ? devicePixelRatio : 1) * s;
}

/**
 * Highlight padding, corner radius and ring width in image pixels for a screenshot captured at
 * `devicePixelRatio` (and, optionally, a viewport of `viewportCssWidth` CSS px; wide captures get bolder marks).
 */
export function defaultHighlightMetrics(devicePixelRatio: number, viewportCssWidth = 0): { pad: number; radius: number; stroke: number } {
  const k = highlightScale(viewportCssWidth, devicePixelRatio);
  return { pad: Math.round(FLAG.pad * k), radius: Math.round(FLAG.radius * k), stroke: Math.max(2, Math.round(FLAG.ringWidth * k)) };
}

/**
 * The window a list thumbnail or a phone-sized detail image shows: 16:10, centred on the highlight ring.
 * Width is the largest of 1.6 x the ring width, 0.3 x the image width and 360 x `dpr` image px (360 CSS px);
 * the height follows at 16:10 and grows only when the ring plus its tab does not fit. Clamped inside the
 * image (shrunk, keeping the shape, if the image is too small). Whole pixels.
 */
export function focusFrame(highlight: Rect, image: Size, scale = 1, dpr = 1): Rect {
  const pad = FLAG.pad * scale;
  const ringW = highlight.width + pad * 2;
  const ringH = highlight.height + pad * 2 + FLAG.tab.height * scale; // the tab grows out of the ring's top or bottom
  const cx = highlight.x + highlight.width / 2, cy = highlight.y + highlight.height / 2;
  let w = Math.max(1.6 * ringW, 0.3 * image.width, 360 * (dpr > 0 ? dpr : 1));
  let h = Math.max(w / 1.6, ringH + 8 * scale);
  if (w > image.width) { const r = image.width / w; w = image.width; h = Math.min(h * r, image.height); }
  if (h > image.height) { const r = image.height / h; h = image.height; w = Math.min(w * r, image.width); }
  w = Math.round(w); h = Math.round(h);
  const x = Math.round(Math.min(Math.max(cx - w / 2, 0), image.width - w));
  const y = Math.round(Math.min(Math.max(cy - h / 2, 0), image.height - h));
  return { x, y, width: w, height: h };
}

// Pure-TS screenshot rendering on RGBA pixels: redactions (blur, pixelate, solid), the click-target
// highlight (anti-aliased rounded ring) and crop. Runs anywhere; used by the exporters and the
// CLI when no canvas renderer is available. The extension may use its own canvas renderer instead
// and tell exporters so with `imagesPrerendered`.

import type { Rect, Redaction, Step, TabCorner } from "./schema";
import { flagLayout, flagTabCenter } from "./flag";
import { clampRect, FLAG, highlightScale, isEmptyRect, roundRectOut, scaleRect } from "./geometry";
import { decodePng, encodePng, isPng, PngError, type RgbaImage } from "./png";

export type Screenshot = NonNullable<Step["screenshot"]>;

export const DEFAULT_HIGHLIGHT_COLOR = "#EB4E26";
/** Brand `redactSolidColor` (#1F1C19). */
export const SOLID_REDACTION_RGB: [number, number, number] = [31, 28, 25];

export class RenderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RenderError";
  }
}

export interface RenderOptions {
  /** Draw the highlight (ring, spotlight, numbered tab). Default true. */
  highlight?: boolean;
  /** CSS colour for the ring (hex or rgb()). Default `DEFAULT_HIGHLIGHT_COLOR`. */
  highlightColor?: string;
  /** Number shown on the highlight's tab (the step number). Omit for a plain ring. */
  stepNumber?: number;
  /** Dim everything outside the highlight (brand "spotlight"). Default true. */
  spotlight?: boolean;
  /** Right-to-left page: the numbered tab grows out of the top-left corner instead. */
  rtl?: boolean;
  /** Bake `screenshot.redactions` into the pixels. Default true; turning it off is only safe if already baked. */
  redact?: boolean;
  /** Apply `screenshot.crop`. Default true. */
  crop?: boolean;
}

const NAMED: Record<string, string> = {
  red: "#ff0000", orange: "#ffa500", yellow: "#ffd400", green: "#008000", blue: "#0000ff", purple: "#800080",
  pink: "#ffc0cb", magenta: "#ff00ff", cyan: "#00ffff", black: "#000000", white: "#ffffff", crimson: "#dc143c", tomato: "#ff6347",
};

/** Parse `#rgb`, `#rrggbb`, `#rgba`, `#rrggbbaa`, `rgb()`/`rgba()` and a few names. Returns undefined when unknown. */
export function parseColor(css: string): [number, number, number] | undefined {
  let s = css.trim().toLowerCase();
  if (NAMED[s]) s = NAMED[s] as string;
  let m = /^#([0-9a-f]{3,8})$/.exec(s);
  if (m) {
    let h = m[1] as string;
    if (h.length === 3 || h.length === 4) h = h.split("").map((c) => c + c).join("");
    if (h.length === 6 || h.length === 8) return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
    return undefined;
  }
  m = /^rgba?\(\s*(\d{1,3})[\s,]+(\d{1,3})[\s,]+(\d{1,3})/.exec(s);
  if (m) return [Math.min(255, +(m[1] as string)), Math.min(255, +(m[2] as string)), Math.min(255, +(m[3] as string))];
  return undefined;
}

// ---- redaction ----------------------------------------------------------------------------
// Same algorithm as the extension's canvas renderer (apps/extension/src/lib/render.ts) so both agree:
// average the region down to a coarse grid, then scale it back up (nearest for pixelate, bilinear plus a
// light grey veil for blur). The original glyphs are gone from the pixels, not hidden.

/** Pixelate/blur cells are at least this many CSS px (the renderer uses 10; the brand minimum is 8). */
export const REDACT_MIN_CELL_CSS_PX = 10;
/** Opacity of the grey veil laid over a blur so it reads as "hidden on purpose". */
export const BLUR_VEIL = 0.18;

/** Cell size in image px for a region `height` px tall at `scale` image px per CSS px. */
export function redactBlock(height: number, scale: number): number {
  const k = scale > 0 ? scale : 1;
  return Math.max(Math.round(REDACT_MIN_CELL_CSS_PX * k), Math.round(Math.min(height, 40 * k) / 2));
}

/**
 * Cover `rect` (image pixels) in place. `solid` fills `SOLID_REDACTION_RGB`; `pixelate` shows the
 * coarse grid; `blur` interpolates it and adds a light veil. `scale` is image px per CSS px.
 */
export function redactRegion(img: RgbaImage, rect: Rect, style: Redaction["style"], scale = 1): void {
  const r = roundRectOut(clampRect(rect, img));
  if (isEmptyRect(r)) return;
  const { width: W, data } = img;
  if (style === "solid") {
    for (let y = r.y; y < r.y + r.height; y++) {
      for (let x = r.x; x < r.x + r.width; x++) {
        const p = (y * W + x) * 4;
        data[p] = SOLID_REDACTION_RGB[0]; data[p + 1] = SOLID_REDACTION_RGB[1]; data[p + 2] = SOLID_REDACTION_RGB[2]; data[p + 3] = 255;
      }
    }
    return;
  }
  if (style === "mask") {
    maskField(img, r, scale);
    return;
  }
  const block = redactBlock(r.height, scale);
  const sw = Math.max(1, Math.round(r.width / block));
  const sh = Math.max(1, Math.round(r.height / block));
  // 1. average down to sw x sh cells
  const grid = new Float32Array(sw * sh * 3);
  for (let j = 0; j < sh; j++) {
    const y0 = r.y + Math.floor((j * r.height) / sh), y1 = r.y + Math.max(Math.floor(((j + 1) * r.height) / sh), Math.floor((j * r.height) / sh) + 1);
    for (let i = 0; i < sw; i++) {
      const x0 = r.x + Math.floor((i * r.width) / sw), x1 = r.x + Math.max(Math.floor(((i + 1) * r.width) / sw), Math.floor((i * r.width) / sw) + 1);
      let sr = 0, sg = 0, sb = 0, n = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const p = (y * W + x) * 4;
          sr += data[p] as number; sg += data[p + 1] as number; sb += data[p + 2] as number; n++;
        }
      }
      const o = (j * sw + i) * 3;
      grid[o] = sr / n; grid[o + 1] = sg / n; grid[o + 2] = sb / n;
    }
  }
  // 2. scale back up over the region
  const veil = style === "blur" ? BLUR_VEIL : 0;
  for (let dy = 0; dy < r.height; dy++) {
    const v = ((dy + 0.5) * sh) / r.height - 0.5;
    const j0 = Math.max(0, Math.min(sh - 1, Math.floor(v))), j1 = Math.min(sh - 1, j0 + 1);
    const ty = style === "blur" ? Math.max(0, Math.min(1, v - Math.floor(v))) : 0;
    const jn = Math.max(0, Math.min(sh - 1, Math.floor((dy + 0.5) * sh / r.height)));
    for (let dx = 0; dx < r.width; dx++) {
      const u = ((dx + 0.5) * sw) / r.width - 0.5;
      const p = ((r.y + dy) * W + r.x + dx) * 4;
      for (let c = 0; c < 3; c++) {
        let val: number;
        if (style === "blur") {
          const i0 = Math.max(0, Math.min(sw - 1, Math.floor(u))), i1 = Math.min(sw - 1, i0 + 1);
          const tx = Math.max(0, Math.min(1, u - Math.floor(u)));
          const top = (grid[(j0 * sw + i0) * 3 + c] as number) * (1 - tx) + (grid[(j0 * sw + i1) * 3 + c] as number) * tx;
          const bot = (grid[(j1 * sw + i0) * 3 + c] as number) * (1 - tx) + (grid[(j1 * sw + i1) * 3 + c] as number) * tx;
          val = top * (1 - ty) + bot * ty;
        } else {
          const inn = Math.max(0, Math.min(sw - 1, Math.floor(((dx + 0.5) * sw) / r.width)));
          val = grid[(jn * sw + inn) * 3 + c] as number;
        }
        data[p + c] = Math.round(veil ? val * (1 - veil) + 128 * veil : val);
      }
      data[p + 3] = 255;
    }
  }
}

/** Brand ink-3, the colour of the "masked value" dots. */
const MASK_DOT_RGB: [number, number, number] = [0x73, 0x6b, 0x63];

/**
 * A form field replaced by what a masked field looks like: the field's own background (median colour of
 * its inner pixels, so page focus rings and text vanish), rounded like a field, a 1 px border a shade
 * darker, and a row of eight 4 px dots. Applying it twice changes (almost) nothing.
 */
function maskField(img: RgbaImage, r: Rect, scale: number): void {
  const { width: W, data } = img;
  const k = scale > 0 ? scale : 1;
  // median of the inner 60% (subsampled), per channel
  const ix0 = r.x + Math.floor(r.width * 0.2), ix1 = r.x + Math.max(Math.floor(r.width * 0.8), Math.floor(r.width * 0.2) + 1);
  const iy0 = r.y + Math.floor(r.height * 0.2), iy1 = r.y + Math.max(Math.floor(r.height * 0.8), Math.floor(r.height * 0.2) + 1);
  const sx = Math.max(1, Math.floor((ix1 - ix0) / 64)), sy = Math.max(1, Math.floor((iy1 - iy0) / 24));
  const chans: number[][] = [[], [], []];
  for (let y = iy0; y < iy1; y += sy) for (let x = ix0; x < ix1; x += sx) for (let c = 0; c < 3; c++) (chans[c] as number[]).push(data[(y * W + x) * 4 + c] as number);
  const med = chans.map((a) => (a.sort((p, q) => p - q), a[Math.floor(a.length / 2)] as number)) as [number, number, number];
  const luma = (0.2126 * med[0] + 0.7152 * med[1] + 0.0722 * med[2]) / 255;
  const edge = med.map((v, i) => Math.round(v * 0.7 + (MASK_DOT_RGB[i] as number) * 0.3)) as [number, number, number];
  const dot: [number, number, number] = luma < 0.35 ? [190, 184, 178] : MASK_DOT_RGB; // dark fields get light dots
  const rad = Math.min(4 * k, Math.min(r.width, r.height) / 2);
  const cx = r.x + r.width / 2, cy = r.y + r.height / 2;
  const border = Math.max(1, Math.round(k));
  for (let y = r.y; y < r.y + r.height; y++) {
    for (let x = r.x; x < r.x + r.width; x++) {
      const d = sdBox(x + 0.5, y + 0.5, cx, cy, r.width / 2, r.height / 2, [rad, rad, rad, rad]);
      const inside = clamp01(0.5 - d);
      if (inside <= 0) continue;
      const p = (y * W + x) * 4;
      const c = d > -border ? edge : med;
      for (let i = 0; i < 3; i++) data[p + i] = Math.round((data[p + i] as number) * (1 - inside) + (c[i] as number) * inside);
      data[p + 3] = 255;
    }
  }
  // eight dots, 4 CSS px wide with 4 CSS px gaps, from 10 CSS px in; fewer when the field is narrow
  const dd = 4 * k, gap = 4 * k, start = r.x + Math.min(10 * k, r.width * 0.1);
  const fit = Math.max(0, Math.floor((r.x + r.width - start - Math.min(10 * k, r.width * 0.1) + gap) / (dd + gap)));
  for (let n = 0; n < Math.min(8, fit); n++) {
    const dcx = start + dd / 2 + n * (dd + gap);
    for (let y = Math.floor(cy - dd); y <= Math.ceil(cy + dd); y++) {
      for (let x = Math.floor(dcx - dd); x <= Math.ceil(dcx + dd); x++) {
        if (x < r.x || x >= r.x + r.width || y < r.y || y >= r.y + r.height) continue;
        const a = clamp01(0.5 - (Math.hypot(x + 0.5 - dcx, y + 0.5 - cy) - dd / 2));
        if (a <= 0) continue;
        const p = (y * W + x) * 4;
        for (let i = 0; i < 3; i++) data[p + i] = Math.round((data[p + i] as number) * (1 - a) + (dot[i] as number) * a);
      }
    }
  }
}

// ---- highlight ----------------------------------------------------------------------------
// The "Flag" highlight from packages/brand/tokens.ts, rasterised without a canvas: spotlight dim,
// white halo, coloured ring whose one square corner grows into a numbered tab.

type Poly = [number, number][];

function arcPoints(cx: number, cy: number, r: number, a0: number, a1: number, n = 10): Poly {
  const pts: Poly = [];
  for (let i = 0; i <= n; i++) {
    const a = ((a0 + ((a1 - a0) * i) / n) * Math.PI) / 180;
    pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  return pts;
}

/** Signed distance from (px, py) to a closed polygon: negative inside. */
function polySd(px: number, py: number, poly: Poly): number {
  let d2 = Infinity;
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i] as [number, number];
    const [xj, yj] = poly[j] as [number, number];
    const ex = xj - xi, ey = yj - yi;
    const wx = px - xi, wy = py - yi;
    const t = Math.max(0, Math.min(1, (wx * ex + wy * ey) / (ex * ex + ey * ey || 1)));
    const dx = wx - ex * t, dy = wy - ey * t;
    d2 = Math.min(d2, dx * dx + dy * dy);
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  const d = Math.sqrt(d2);
  return inside ? -d : d;
}

/** Distance from a point to the segment a-b. */
function segDist(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const ex = bx - ax, ey = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * ex + (py - ay) * ey) / (ex * ex + ey * ey || 1)));
  return Math.hypot(px - (ax + ex * t), py - (ay + ey * t));
}

/** SDF of a rectangle with per-corner radii [tl, tr, br, bl]. */
function sdBox(px: number, py: number, cx: number, cy: number, hw: number, hh: number, r: [number, number, number, number]): number {
  const rad = px > cx ? (py > cy ? r[2] : r[1]) : py > cy ? r[3] : r[0];
  const qx = Math.abs(px - cx) - hw + rad;
  const qy = Math.abs(py - cy) - hh + rad;
  return Math.min(Math.max(qx, qy), 0) + Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) - rad;
}

// Digit strokes on a 1 x 1.6 grid (y down). Each digit is a list of polylines.
const DIGITS: Record<string, Poly[]> = (() => {
  const loop = (cx: number, cy: number, rx: number, ry: number, a0 = 0, a1 = 360): Poly =>
    arcPoints(0, 0, 1, a0, a1, 24).map(([x, y]) => [cx + x * rx, cy + y * ry] as [number, number]);
  const six: Poly[] = [
    [[0.9, 0.12], [0.62, -0.02], [0.36, 0.08], [0.14, 0.5], [0.03, 1.1]],
    loop(0.5, 1.1, 0.47, 0.5, 180, 540),
  ];
  return {
    "0": [loop(0.5, 0.8, 0.48, 0.8)],
    "1": [[[0.18, 0.34], [0.58, 0], [0.58, 1.6]]],
    "2": [[...arcPoints(0.5, 0.5, 0.47, 180, 385, 14), [0.02, 1.6], [1, 1.6]]],
    "3": [arcPoints(0.5, 0.42, 0.4, 205, 450, 14), arcPoints(0.5, 1.15, 0.45, 270, 525, 14)],
    "4": [[[0.74, 1.6], [0.74, 0], [0.02, 1.12], [1, 1.12]]],
    "5": [[[0.92, 0], [0.16, 0], [0.1, 0.72]], arcPoints(0.5, 1.14, 0.46, 235, 512, 14)],
    "6": six,
    "7": [[[0.02, 0], [1, 0], [0.34, 1.6]]],
    "8": [loop(0.5, 0.42, 0.4, 0.4), loop(0.5, 1.15, 0.46, 0.45)],
    "9": six.map((pl) => pl.map(([x, y]) => [1 - x, 1.6 - y] as [number, number])),
  };
})();

interface FlagOptions {
  target: Rect;
  /** Step number for the tab; omit to draw the ring only. */
  n?: number;
  scale: number;
  color: [number, number, number];
  dim?: [number, number, number, number] | null;
  rtl?: boolean;
  corner?: TabCorner;
  labelRect?: Rect;
}

function blend(img: RgbaImage, p: number, rgb: readonly number[], a: number): void {
  if (a <= 0) return;
  const d = img.data;
  const ia = 1 - a;
  d[p] = Math.round((d[p] as number) * ia + (rgb[0] as number) * a);
  d[p + 1] = Math.round((d[p + 1] as number) * ia + (rgb[1] as number) * a);
  d[p + 2] = Math.round((d[p + 2] as number) * ia + (rgb[2] as number) * a);
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Draw the Showsteps "Flag" highlight in place: spotlight dim, haloed ring, numbered tab. */
export function drawFlagHighlight(img: RgbaImage, o: FlagOptions): void {
  const layout = flagLayout({ target: o.target, ...(o.n !== undefined ? { n: o.n } : {}), scale: o.scale, imageWidth: img.width, imageHeight: img.height, ...(o.rtl ? { rtl: true } : {}), ...(o.corner ? { corner: o.corner } : {}), ...(o.labelRect ? { labelRect: o.labelRect } : {}) });
  const { x, y, w, h, radii } = layout.ring;
  const { sw, halo } = layout;
  const cx = x + w / 2, cy = y + h / 2, hw = w / 2, hh = h / 2;
  const t = layout.tab;
  const digits = o.n !== undefined ? String(Math.max(0, Math.floor(o.n))) : "";
  const W = img.width, H = img.height;
  const pxIdx = (i: number, j: number): number => (j * W + i) * 4;

  // 1. spotlight dim with the ring box cut out
  if (o.dim && o.dim[3] > 0) {
    const bx0 = Math.max(0, Math.floor(x) - 2), bx1 = Math.min(W, Math.ceil(x + w) + 2);
    const by0 = Math.max(0, Math.floor(y) - 2), by1 = Math.min(H, Math.ceil(y + h) + 2);
    for (let j = 0; j < H; j++) {
      const inRow = j >= by0 && j < by1;
      for (let i = 0; i < W; i++) {
        let a = o.dim[3];
        if (inRow && i >= bx0 && i < bx1) a *= 1 - clamp01(0.5 - sdBox(i + 0.5, j + 0.5, cx, cy, hw, hh, radii));
        blend(img, pxIdx(i, j), o.dim, a);
      }
    }
  }

  // tab polygon (arcs flattened), from the same layout the vector renderers use
  let tab: Poly | undefined;
  let tabBox: Rect | undefined;
  if (t) {
    const P = (dx: number, dy: number): [number, number] => [t.ax + t.sx * dx, t.ay + t.sy * dy];
    const pts: Poly = [P(0, 0), P(0, -(t.th - t.rt))];
    for (const [ux, uy] of arcPoints(0, 0, 1, 0, 90, 8)) pts.push(P(-t.rt + ux * t.rt, -(t.th - t.rt) - uy * t.rt)); // top outer corner
    pts.push(P(-(t.tw - t.rt), -t.th));
    for (const [ux, uy] of arcPoints(0, 0, 1, 90, 180, 8)) pts.push(P(-(t.tw - t.rt) + ux * t.rt, -(t.th - t.rt) - uy * t.rt)); // top inner corner
    pts.push(P(-t.tw, -t.f));
    for (const [ux, uy] of arcPoints(0, 0, 1, 0, 90, 8)) pts.push(P(-(t.tw + t.f) + t.f * ux, -t.f + t.f * uy)); // concave fillet
    tab = pts;
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    tabBox = { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
  }

  const ring = (d: number, extra: number): number => clamp01(0.5 - (Math.abs(d) - (sw / 2 + extra)));
  const region = (r: Rect, m: number): [number, number, number, number] => [
    Math.max(0, Math.floor(r.x - m)), Math.max(0, Math.floor(r.y - m)), Math.min(W, Math.ceil(r.x + r.width + m)), Math.min(H, Math.ceil(r.y + r.height + m)),
  ];
  const HALO: [number, number, number] = [255, 255, 255];
  const HALO_A = 0.96;
  const [rx0, ry0, rx1, ry1] = region({ x, y, width: w, height: h }, sw / 2 + halo + 2);
  const tbb = tabBox ? region(tabBox, halo + 2) : undefined;

  // 2. halo under everything coloured
  for (let j = ry0; j < ry1; j++) for (let i = rx0; i < rx1; i++) blend(img, pxIdx(i, j), HALO, ring(sdBox(i + 0.5, j + 0.5, cx, cy, hw, hh, radii), halo) * HALO_A);
  if (tab && tbb) for (let j = tbb[1]; j < tbb[3]; j++) for (let i = tbb[0]; i < tbb[2]; i++) blend(img, pxIdx(i, j), HALO, clamp01(0.5 - (polySd(i + 0.5, j + 0.5, tab) - halo)) * HALO_A);
  // 3. colour
  for (let j = ry0; j < ry1; j++) for (let i = rx0; i < rx1; i++) blend(img, pxIdx(i, j), o.color, ring(sdBox(i + 0.5, j + 0.5, cx, cy, hw, hh, radii), 0));
  if (tab && tbb) for (let j = tbb[1]; j < tbb[3]; j++) for (let i = tbb[0]; i < tbb[2]; i++) blend(img, pxIdx(i, j), o.color, clamp01(0.5 - polySd(i + 0.5, j + 0.5, tab)));

  // 4. numeral
  const center = flagTabCenter(layout);
  if (t && digits && center) {
    const lum = (0.2126 * o.color[0] + 0.7152 * o.color[1] + 0.0722 * o.color[2]) / 255;
    const ink: [number, number, number] = lum > 0.45 ? [26, 11, 5] : [255, 255, 255];
    const gh = t.fs * 0.72; // digit height
    const gw = (gh / 1.6) * 1.12;
    const half = t.fs * 0.075; // stroke half-width
    const total = digits.length * t.advance;
    for (let di = 0; di < digits.length; di++) {
      const strokes = DIGITS[digits[di] as string] ?? [];
      const ox = center.x - total / 2 + di * t.advance + (t.advance - gw) / 2;
      const oy = center.y - gh / 2 + t.fs * 0.02;
      const segs: [number, number, number, number][] = [];
      for (const pl of strokes) {
        for (let s = 0; s + 1 < pl.length; s++) {
          const a = pl[s] as [number, number], b = pl[s + 1] as [number, number];
          segs.push([ox + a[0] * gw, oy + (a[1] / 1.6) * gh, ox + b[0] * gw, oy + (b[1] / 1.6) * gh]);
        }
      }
      const gx0 = Math.max(0, Math.floor(ox - half - 1)), gx1 = Math.min(W, Math.ceil(ox + gw + half + 1));
      const gy0 = Math.max(0, Math.floor(oy - half - 1)), gy1 = Math.min(H, Math.ceil(oy + gh + half + 1));
      for (let j = gy0; j < gy1; j++) {
        for (let i = gx0; i < gx1; i++) {
          let d = Infinity;
          for (const sg of segs) d = Math.min(d, segDist(i + 0.5, j + 0.5, sg[0], sg[1], sg[2], sg[3]));
          blend(img, pxIdx(i, j), ink, clamp01(0.5 - (d - half)));
        }
      }
    }
  }
}

// ---- crop and pipeline --------------------------------------------------------------------

function cropImage(img: RgbaImage, r: Rect): RgbaImage {
  const c = roundRectOut(clampRect(r, img));
  if (isEmptyRect(c) || (c.x === 0 && c.y === 0 && c.width === img.width && c.height === img.height)) return img;
  const out = new Uint8Array(c.width * c.height * 4);
  for (let y = 0; y < c.height; y++) {
    const s = ((c.y + y) * img.width + c.x) * 4;
    out.set(img.data.subarray(s, s + c.width * 4), y * c.width * 4);
  }
  return { width: c.width, height: c.height, data: out };
}

/**
 * How a screenshot's rects map onto actual image bytes of size `imgW` x `imgH`: `fit` rescales a rect
 * when the bytes differ in size from the metadata, `crop` is the export crop clamped to the image
 * (whole pixels), if any. Shared by the pixel renderer and the vector renderers.
 */
export function imageSpace(shot: Screenshot, imgW: number, imgH: number): { fit: (r: Rect) => Rect; crop?: Rect } {
  const sx = shot.width > 0 ? imgW / shot.width : 1;
  const sy = shot.height > 0 ? imgH / shot.height : 1;
  const same = Math.abs(sx - 1) < 0.001 && Math.abs(sy - 1) < 0.001;
  const fit = (r: Rect): Rect => (same ? r : scaleRect(r, sx, sy));
  let crop: Rect | undefined;
  if (shot.crop && !isEmptyRect(shot.crop)) {
    const c = roundRectOut(clampRect(fit(shot.crop), { width: imgW, height: imgH }));
    if (!isEmptyRect(c) && !(c.x === 0 && c.y === 0 && c.width === imgW && c.height === imgH)) crop = c;
  }
  return crop ? { fit, crop } : { fit };
}

/**
 * Render one screenshot: bake redactions, draw the highlight, apply the crop; returns PNG bytes.
 * Returns the input bytes untouched when there is nothing to do. When redactions are required but
 * the bytes cannot be decoded (not a supported PNG), throws `RenderError` rather than leaking pixels.
 */
export function renderStepImage(bytes: Uint8Array, shot: Screenshot, opts: RenderOptions = {}): Uint8Array {
  const wantRedact = opts.redact !== false && (shot.redactions?.length ?? 0) > 0;
  const wantHighlight = opts.highlight !== false && !!shot.highlight && !isEmptyRect(shot.highlight);
  const wantCrop = opts.crop !== false && !!shot.crop && !isEmptyRect(shot.crop);
  if (!wantRedact && !wantHighlight && !wantCrop) return bytes;
  let img: RgbaImage;
  try {
    if (!isPng(bytes)) throw new PngError("not a PNG (JPEG and other formats cannot be rewritten here)");
    img = decodePng(bytes);
  } catch (e) {
    if (wantRedact) {
      throw new RenderError(`Cannot bake redactions into ${shot.image}: ${(e as Error).message}. Refusing to export unredacted pixels.`);
    }
    return bytes; // only decoration was wanted; pass the image through untouched
  }
  const space = imageSpace(shot, img.width, img.height);
  const fit = space.fit;
  const metaScale = Math.max(shot.width > 0 ? img.width / shot.width : 1, shot.height > 0 ? img.height / shot.height : 1);
  const redactScale = shot.width > 0 && shot.viewport.width > 0 ? img.width / shot.viewport.width : shot.devicePixelRatio;
  if (wantRedact) for (const red of shot.redactions ?? []) redactRegion(img, fit(red.rect), red.style, redactScale);
  // Crop before the highlight, like the extension's canvas renderer: the spotlight and the tab's
  // position (flipped below or to the side near an edge) then follow the cropped image.
  let dx = 0, dy = 0;
  if (wantCrop && space.crop) {
    img = cropImage(img, space.crop);
    dx = space.crop.x;
    dy = space.crop.y;
  }
  if (wantHighlight) {
    const color = parseColor(opts.highlightColor ?? DEFAULT_HIGHLIGHT_COLOR) ?? (parseColor(DEFAULT_HIGHLIGHT_COLOR) as [number, number, number]);
    const t = fit(shot.highlight as Rect);
    drawFlagHighlight(img, {
      target: { x: t.x - dx, y: t.y - dy, width: t.width, height: t.height },
      ...(opts.stepNumber !== undefined ? { n: opts.stepNumber } : {}),
      scale: highlightScale(shot.viewport.width, shot.devicePixelRatio) * metaScale,
      color,
      dim: opts.spotlight === false ? null : [...FLAG.spotlightDim],
      ...(opts.rtl ? { rtl: true } : {}),
      ...((shot.highlight as { corner?: TabCorner }).corner ? { corner: (shot.highlight as { corner?: TabCorner }).corner as TabCorner } : {}),
      ...(shot.highlight?.labelRect ? { labelRect: ((l) => ({ x: l.x - dx, y: l.y - dy, width: l.width, height: l.height }))(fit(shot.highlight.labelRect)) } : {}),
    });
  }
  return encodePng(img, 6);
}

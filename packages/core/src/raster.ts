// Pure-TS screenshot rendering on RGBA pixels: redactions (blur, pixelate, solid), the click-target
// highlight (anti-aliased rounded ring) and crop. Runs anywhere; used by the exporters and the
// CLI when no canvas renderer is available. The extension may use its own canvas renderer instead
// and tell exporters so with `imagesPrerendered`.

import type { Rect, Redaction, Step } from "./schema";
import { clampRect, defaultHighlightMetrics, expandRect, isEmptyRect, roundRectOut, scaleRect } from "./geometry";
import { decodePng, encodePng, isPng, PngError, type RgbaImage } from "./png";

export type Screenshot = NonNullable<Step["screenshot"]>;

export const DEFAULT_HIGHLIGHT_COLOR = "#ff5a1f";
export const SOLID_REDACTION_RGB: [number, number, number] = [26, 26, 26];

export class RenderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RenderError";
  }
}

export interface RenderOptions {
  /** Draw the highlight ring. Default true. */
  highlight?: boolean;
  /** CSS colour for the ring (hex or rgb()). Default `DEFAULT_HIGHLIGHT_COLOR`. */
  highlightColor?: string;
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

function pixelate(img: RgbaImage, r: Rect, block: number): void {
  const { width, data } = img;
  for (let by = r.y; by < r.y + r.height; by += block) {
    for (let bx = r.x; bx < r.x + r.width; bx += block) {
      const x2 = Math.min(bx + block, r.x + r.width);
      const y2 = Math.min(by + block, r.y + r.height);
      let sr = 0, sg = 0, sb = 0, n = 0;
      for (let y = by; y < y2; y++) {
        for (let x = bx; x < x2; x++) {
          const p = (y * width + x) * 4;
          sr += data[p] as number; sg += data[p + 1] as number; sb += data[p + 2] as number; n++;
        }
      }
      const ar = Math.round(sr / n), ag = Math.round(sg / n), ab = Math.round(sb / n);
      for (let y = by; y < y2; y++) {
        for (let x = bx; x < x2; x++) {
          const p = (y * width + x) * 4;
          data[p] = ar; data[p + 1] = ag; data[p + 2] = ab; data[p + 3] = 255;
        }
      }
    }
  }
}

/** Separable box blur restricted to the rect (edge-clamped inside it, never reads outside pixels). */
function boxBlur(img: RgbaImage, r: Rect, radius: number, passes: number): void {
  const { width, data } = img;
  const w = r.width, h = r.height;
  const buf = new Float32Array(w * h * 3);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = ((r.y + y) * width + r.x + x) * 4;
      const o = (y * w + x) * 3;
      buf[o] = data[p] as number; buf[o + 1] = data[p + 1] as number; buf[o + 2] = data[p + 2] as number;
    }
  }
  const tmp = new Float32Array(buf.length);
  const size = radius * 2 + 1;
  for (let pass = 0; pass < passes; pass++) {
    for (let y = 0; y < h; y++) {
      for (let c = 0; c < 3; c++) {
        let acc = 0;
        for (let k = -radius; k <= radius; k++) acc += buf[(y * w + Math.min(w - 1, Math.max(0, k))) * 3 + c] as number;
        for (let x = 0; x < w; x++) {
          tmp[(y * w + x) * 3 + c] = acc / size;
          const add = Math.min(w - 1, x + radius + 1), sub = Math.max(0, x - radius);
          acc += (buf[(y * w + add) * 3 + c] as number) - (buf[(y * w + sub) * 3 + c] as number);
        }
      }
    }
    for (let x = 0; x < w; x++) {
      for (let c = 0; c < 3; c++) {
        let acc = 0;
        for (let k = -radius; k <= radius; k++) acc += tmp[(Math.min(h - 1, Math.max(0, k)) * w + x) * 3 + c] as number;
        for (let y = 0; y < h; y++) {
          buf[(y * w + x) * 3 + c] = acc / size;
          const add = Math.min(h - 1, y + radius + 1), sub = Math.max(0, y - radius);
          acc += (tmp[(add * w + x) * 3 + c] as number) - (tmp[(sub * w + x) * 3 + c] as number);
        }
      }
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = ((r.y + y) * width + r.x + x) * 4;
      const o = (y * w + x) * 3;
      data[p] = Math.round(buf[o] as number); data[p + 1] = Math.round(buf[o + 1] as number); data[p + 2] = Math.round(buf[o + 2] as number); data[p + 3] = 255;
    }
  }
}

/** Cover `rect` (image pixels) in place. Blur is pixelate-then-blur, so it is not reversible. */
export function redactRegion(img: RgbaImage, rect: Rect, style: Redaction["style"]): void {
  const r = roundRectOut(clampRect(rect, img));
  if (isEmptyRect(r)) return;
  if (style === "solid") {
    for (let y = r.y; y < r.y + r.height; y++) {
      for (let x = r.x; x < r.x + r.width; x++) {
        const p = (y * img.width + x) * 4;
        img.data[p] = SOLID_REDACTION_RGB[0]; img.data[p + 1] = SOLID_REDACTION_RGB[1]; img.data[p + 2] = SOLID_REDACTION_RGB[2]; img.data[p + 3] = 255;
      }
    }
    return;
  }
  const side = Math.min(r.width, r.height);
  if (style === "pixelate") {
    pixelate(img, r, Math.max(4, Math.round(side / 3)));
    return;
  }
  const block = Math.max(3, Math.round(side / 4));
  pixelate(img, r, block);
  boxBlur(img, r, Math.max(2, Math.min(block, Math.floor(side / 2) - 1)), 2);
}

// ---- highlight ----------------------------------------------------------------------------

function sdRoundRect(px: number, py: number, cx: number, cy: number, hw: number, hh: number, rad: number): number {
  const qx = Math.abs(px - cx) - (hw - rad);
  const qy = Math.abs(py - cy) - (hh - rad);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - rad;
}

/** Draw the highlight ring (anti-aliased stroke plus a faint tint) around `rect` in place. */
export function drawHighlight(img: RgbaImage, rect: Rect, colorCss: string, devicePixelRatio: number): void {
  const color = parseColor(colorCss) ?? (parseColor(DEFAULT_HIGHLIGHT_COLOR) as [number, number, number]);
  const m = defaultHighlightMetrics(devicePixelRatio);
  const box = expandRect(rect, m.pad);
  if (isEmptyRect(box)) return;
  const rad = Math.min(m.radius, box.width / 2, box.height / 2);
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  const hw = box.width / 2, hh = box.height / 2;
  const x0 = Math.max(0, Math.floor(box.x) - 1), x1 = Math.min(img.width, Math.ceil(box.x + box.width) + 1);
  const y0 = Math.max(0, Math.floor(box.y) - 1), y1 = Math.min(img.height, Math.ceil(box.y + box.height) + 1);
  const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const d = sdRoundRect(x + 0.5, y + 0.5, cx, cy, hw, hh, rad);
      const inside = clamp01(0.5 - d);
      if (inside <= 0) continue;
      const ring = inside * clamp01(d + m.stroke + 0.5);
      const alpha = Math.max(ring, inside * 0.1);
      const p = (y * img.width + x) * 4;
      for (let c = 0; c < 3; c++) img.data[p + c] = Math.round((img.data[p + c] as number) * (1 - alpha) + (color[c] as number) * alpha);
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
  const sx = shot.width > 0 ? img.width / shot.width : 1;
  const sy = shot.height > 0 ? img.height / shot.height : 1;
  const fit = (r: Rect): Rect => (Math.abs(sx - 1) < 0.001 && Math.abs(sy - 1) < 0.001 ? r : scaleRect(r, sx, sy));
  if (wantRedact) for (const red of shot.redactions ?? []) redactRegion(img, fit(red.rect), red.style);
  if (wantHighlight) drawHighlight(img, fit(shot.highlight as Rect), opts.highlightColor ?? DEFAULT_HIGHLIGHT_COLOR, shot.devicePixelRatio * Math.max(sx, sy));
  if (wantCrop) img = cropImage(img, fit(shot.crop as Rect));
  return encodePng(img, 6);
}

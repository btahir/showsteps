// Shared helpers for the PDF and DOCX exporters: inline-Markdown parsing, colour and date
// formatting, image sniffing, and a tiny PNG codec (fflate) used to bake redactions, crops and
// (for DOCX) highlight rings into pixels. Pure TS: no DOM, no Node-only APIs.

import { unzlibSync, zlibSync } from "fflate";
import type { Guide, Rect, Step } from "../schema";

// ---------------------------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------------------------

export interface DocExportOptions {
  /** Page size. Default "A4". */
  pageSize?: "A4" | "Letter";
  /** Draw the click-target highlight ring. Default true. */
  highlight?: boolean;
  /**
   * Set true when the image bytes you pass already have every `screenshot.redactions` rect
   * baked into the pixels (e.g. you drew them on a canvas). Otherwise the exporter bakes
   * solid blocks into PNGs itself and THROWS for images it cannot rewrite (JPEG, interlaced
   * or palette-depth<8 PNG), because a vector overlay alone leaves the original pixels
   * extractable from the file.
   */
  redactionsBaked?: boolean;
  /** Print "Made with Showsteps" on the cover / title block. Default true. */
  branding?: boolean;
}

export type RGB = { r: number; g: number; b: number };

export const DEFAULT_HIGHLIGHT_COLOR = "#ff5a1f";
export const ACCENT_COLOR: RGB = { r: 0x4f, g: 0x46, b: 0xe5 };
/** Redaction fill. Near-black, fully opaque. */
export const REDACTION_COLOR: RGB = { r: 0x1a, g: 0x1a, b: 0x1a };

// ---------------------------------------------------------------------------------------------
// Steps, text
// ---------------------------------------------------------------------------------------------

export function activeSteps(guide: Guide): Step[] {
  return guide.steps.filter((s) => !s.skipped);
}

export interface InlineRun {
  text: string;
  bold?: boolean;
}

const INLINE_RE = /\*\*([^]+?)\*\*|__([^]+?)__|`([^`]+)`|\[([^\]]+)\]\([^)]*\)|\*([^*\s][^*]*)\*/g;

/** Inline Markdown to runs. Keeps **bold**; flattens links, `code` and *italic* to plain text. */
export function parseInline(md: string): InlineRun[] {
  const runs: InlineRun[] = [];
  const push = (text: string, bold?: boolean) => {
    if (!text) return;
    const last = runs[runs.length - 1];
    if (last && !!last.bold === !!bold) last.text += text;
    else runs.push(bold ? { text, bold: true } : { text });
  };
  let i = 0;
  INLINE_RE.lastIndex = 0;
  for (let m = INLINE_RE.exec(md); m; m = INLINE_RE.exec(md)) {
    push(md.slice(i, m.index));
    if (m[1] !== undefined) push(flatten(m[1]), true);
    else if (m[2] !== undefined) push(flatten(m[2]), true);
    else if (m[3] !== undefined) push(m[3]);
    else if (m[4] !== undefined) push(flatten(m[4]));
    else if (m[5] !== undefined) push(m[5]);
    i = m.index + m[0].length;
  }
  push(md.slice(i));
  return runs;
}

function flatten(s: string): string {
  return s.replace(/`([^`]+)`/g, "$1");
}

export function stripInline(md: string): string {
  return parseInline(md)
    .map((r) => r.text)
    .join("");
}

export interface Block {
  kind: "p" | "li";
  text: string;
}

/** Very small block parser for descriptions: paragraphs and "- " / "* " / "1. " list items. */
export function parseBlocks(md: string | undefined): Block[] {
  if (!md) return [];
  const blocks: Block[] = [];
  let para: string[] = [];
  const flush = () => {
    if (para.length) blocks.push({ kind: "p", text: para.join(" ") });
    para = [];
  };
  for (const raw of md.replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.trim();
    const li = /^(?:[-*+]|\d+[.)])\s+(.*)$/.exec(line);
    if (!line) flush();
    else if (li) {
      flush();
      blocks.push({ kind: "li", text: li[1] ?? "" });
    } else para.push(line.replace(/^#{1,6}\s+/, ""));
  }
  flush();
  return blocks;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "28 Sep 2026" in UTC; locale-independent so output is reproducible. "" if unparseable. */
export function formatDate(iso: string | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

export function stepCountLabel(n: number): string {
  return `${n} ${n === 1 ? "step" : "steps"}`;
}

/** The guide's meta line, e.g. "4 steps · 28 Sep 2026". */
export function metaLine(guide: Guide, stepCount: number): string {
  const date = formatDate(guide.createdAt);
  return date ? `${stepCountLabel(stepCount)} · ${date}` : stepCountLabel(stepCount);
}

/** The URL line under a step title, or undefined when hidden / not applicable. */
export function stepUrl(guide: Guide, step: Step): string | undefined {
  if (guide.settings?.includeUrls === false) return undefined;
  if (step.action.type === "note") return undefined;
  const url = step.action.type === "navigate" ? step.action.url : step.page.url;
  return url || undefined;
}

export function parseColor(css: string | undefined, fallback: string = DEFAULT_HIGHLIGHT_COLOR): RGB {
  const parse = (s: string): RGB | undefined => {
    const t = s.trim().toLowerCase();
    let m = /^#([0-9a-f]{3})$/.exec(t);
    if (m) {
      const h = m[1] as string;
      return { r: parseInt(h[0]! + h[0]!, 16), g: parseInt(h[1]! + h[1]!, 16), b: parseInt(h[2]! + h[2]!, 16) };
    }
    m = /^#([0-9a-f]{6})(?:[0-9a-f]{2})?$/.exec(t);
    if (m) {
      const h = m[1] as string;
      return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16) };
    }
    const rgb = /^rgba?\(\s*(\d{1,3})[\s,]+(\d{1,3})[\s,]+(\d{1,3})/.exec(t);
    if (rgb) {
      const c = (v: string | undefined) => Math.min(255, Number(v));
      return { r: c(rgb[1]), g: c(rgb[2]), b: c(rgb[3]) };
    }
    return undefined;
  };
  return (css ? parse(css) : undefined) ?? (parse(fallback) as RGB);
}

export function toHex({ r, g, b }: RGB): string {
  return [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("");
}

// ---------------------------------------------------------------------------------------------
// Image sniffing
// ---------------------------------------------------------------------------------------------

export type ImageFormat = "png" | "jpg";
export interface ImageInfo {
  format: ImageFormat;
  width: number;
  height: number;
}

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function isPng(b: Uint8Array): boolean {
  return b.length > 24 && PNG_SIG.every((v, i) => b[i] === v);
}

const be32 = (b: Uint8Array, o: number) =>
  (((b[o] as number) << 24) | ((b[o + 1] as number) << 16) | ((b[o + 2] as number) << 8) | (b[o + 3] as number)) >>> 0;

export function sniffImage(b: Uint8Array): ImageInfo {
  if (isPng(b)) return { format: "png", width: be32(b, 16), height: be32(b, 20) };
  if (b.length > 4 && b[0] === 0xff && b[1] === 0xd8) {
    let o = 2;
    while (o + 9 < b.length) {
      if (b[o] !== 0xff) {
        o++;
        continue;
      }
      const marker = b[o + 1] as number;
      if (marker === 0xff) {
        o++;
        continue;
      }
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
        o += 2;
        continue;
      }
      const len = ((b[o + 2] as number) << 8) | (b[o + 3] as number);
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return {
          format: "jpg",
          height: ((b[o + 5] as number) << 8) | (b[o + 6] as number),
          width: ((b[o + 7] as number) << 8) | (b[o + 8] as number),
        };
      }
      o += 2 + len;
    }
  }
  throw new Error("Unsupported image format: screenshots must be PNG or JPEG");
}

// ---------------------------------------------------------------------------------------------
// Tiny PNG codec (non-interlaced; 8/16-bit gray, gray+alpha, RGB, RGBA; palette up to 8-bit)
// ---------------------------------------------------------------------------------------------

export interface Raster {
  width: number;
  height: number;
  /** RGBA, row-major, 4 bytes per pixel. */
  data: Uint8Array;
}

/** Returns null for PNG flavours we do not rewrite (interlaced, bad data). */
export function decodePng(bytes: Uint8Array): Raster | null {
  if (!isPng(bytes)) return null;
  let width = 0;
  let height = 0;
  let depth = 0;
  let colorType = 0;
  let interlace = 0;
  let palette: Uint8Array | undefined;
  let trns: Uint8Array | undefined;
  const idat: Uint8Array[] = [];
  let o = 8;
  while (o + 8 <= bytes.length) {
    const len = be32(bytes, o);
    const type = String.fromCharCode(bytes[o + 4]!, bytes[o + 5]!, bytes[o + 6]!, bytes[o + 7]!);
    const body = bytes.subarray(o + 8, o + 8 + len);
    if (type === "IHDR") {
      width = be32(body, 0);
      height = be32(body, 4);
      depth = body[8] as number;
      colorType = body[9] as number;
      interlace = body[12] as number;
    } else if (type === "PLTE") palette = body;
    else if (type === "tRNS") trns = body;
    else if (type === "IDAT") idat.push(body);
    else if (type === "IEND") break;
    o += 12 + len;
  }
  if (!width || !height || interlace !== 0 || idat.length === 0) return null;
  const channels = ({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 } as Record<number, number>)[colorType];
  if (!channels) return null;
  if (colorType === 3 ? ![1, 2, 4, 8].includes(depth) : depth !== 8 && depth !== 16) return null;
  if (colorType === 3 && !palette) return null;

  let raw: Uint8Array;
  try {
    raw = unzlibSync(concat(idat));
  } catch {
    return null;
  }
  const bitsPerPixel = channels * depth;
  const bpp = Math.max(1, bitsPerPixel >> 3);
  const stride = Math.ceil((width * bitsPerPixel) / 8);
  if (raw.length < (stride + 1) * height) return null;

  // Unfilter in place into `pix` (height rows of `stride` bytes).
  const pix = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    const ft = raw[y * (stride + 1)] as number;
    const src = y * (stride + 1) + 1;
    const dst = y * stride;
    for (let x = 0; x < stride; x++) {
      const v = raw[src + x] as number;
      const a = x >= bpp ? (pix[dst + x - bpp] as number) : 0;
      const b = y > 0 ? (pix[dst - stride + x] as number) : 0;
      const c = x >= bpp && y > 0 ? (pix[dst - stride + x - bpp] as number) : 0;
      let out: number;
      switch (ft) {
        case 0: out = v; break;
        case 1: out = v + a; break;
        case 2: out = v + b; break;
        case 3: out = v + ((a + b) >> 1); break;
        case 4: {
          const p = a + b - c;
          const pa = Math.abs(p - a);
          const pb = Math.abs(p - b);
          const pc = Math.abs(p - c);
          out = v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
          break;
        }
        default: return null;
      }
      pix[dst + x] = out & 0xff;
    }
  }

  const data = new Uint8Array(width * height * 4);
  const step = depth === 16 ? 2 : 1; // take the high byte of 16-bit samples
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const d = (y * width + x) * 4;
      const s = y * stride;
      if (colorType === 3) {
        const bitPos = x * depth;
        const byte = pix[s + (bitPos >> 3)] as number;
        const idx = (byte >> (8 - depth - (bitPos & 7))) & ((1 << depth) - 1);
        data[d] = palette![idx * 3] ?? 0;
        data[d + 1] = palette![idx * 3 + 1] ?? 0;
        data[d + 2] = palette![idx * 3 + 2] ?? 0;
        data[d + 3] = trns && idx < trns.length ? (trns[idx] as number) : 255;
      } else {
        const p = s + x * channels * step;
        if (colorType === 0 || colorType === 4) {
          const g = pix[p] as number;
          data[d] = data[d + 1] = data[d + 2] = g;
          data[d + 3] = colorType === 4 ? (pix[p + step] as number) : 255;
        } else {
          data[d] = pix[p] as number;
          data[d + 1] = pix[p + step] as number;
          data[d + 2] = pix[p + 2 * step] as number;
          data[d + 3] = colorType === 6 ? (pix[p + 3 * step] as number) : 255;
        }
      }
    }
  }
  return { width, height, data };
}

let crcTable: Uint32Array | undefined;
function crc32(buf: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = (crcTable[(c ^ (buf[i] as number)) & 0xff] as number) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, body: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + body.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, body.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(body, 8);
  dv.setUint32(8 + body.length, crc32(out.subarray(4, 8 + body.length)));
  return out;
}

/** Encode RGBA as an 8-bit RGBA PNG (Up filter, zlib). */
export function encodePng(r: Raster): Uint8Array {
  const stride = r.width * 4;
  const raw = new Uint8Array((stride + 1) * r.height);
  for (let y = 0; y < r.height; y++) {
    const o = y * (stride + 1);
    raw[o] = 2;
    for (let x = 0; x < stride; x++) {
      const cur = r.data[y * stride + x] as number;
      const up = y > 0 ? (r.data[(y - 1) * stride + x] as number) : 0;
      raw[o + 1 + x] = (cur - up) & 0xff;
    }
  }
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, r.width);
  dv.setUint32(4, r.height);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const parts = [new Uint8Array(PNG_SIG), chunk("IHDR", ihdr), chunk("IDAT", zlibSync(raw, { level: 6 })), chunk("IEND", new Uint8Array(0))];
  return concat(parts);
}

function concat(parts: Uint8Array[]): Uint8Array {
  if (parts.length === 1) return parts[0] as Uint8Array;
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Pixel drawing
// ---------------------------------------------------------------------------------------------

function cropRaster(r: Raster, c: Rect): Raster {
  const out = new Uint8Array(c.width * c.height * 4);
  for (let y = 0; y < c.height; y++) {
    const s = ((c.y + y) * r.width + c.x) * 4;
    out.set(r.data.subarray(s, s + c.width * 4), y * c.width * 4);
  }
  return { width: c.width, height: c.height, data: out };
}

function fillRectSolid(r: Raster, rect: Rect, c: RGB): void {
  const x0 = Math.max(0, Math.floor(rect.x));
  const y0 = Math.max(0, Math.floor(rect.y));
  const x1 = Math.min(r.width, Math.ceil(rect.x + rect.width));
  const y1 = Math.min(r.height, Math.ceil(rect.y + rect.height));
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * r.width + x) * 4;
      r.data[i] = c.r;
      r.data[i + 1] = c.g;
      r.data[i + 2] = c.b;
      r.data[i + 3] = 255;
    }
  }
}

/** Signed distance to a rounded rectangle (negative inside). */
function sdRoundRect(px: number, py: number, rect: Rect, radius: number): number {
  const cx = rect.x + rect.width / 2;
  const cy = rect.y + rect.height / 2;
  const hx = rect.width / 2 - radius;
  const hy = rect.height / 2 - radius;
  const qx = Math.abs(px - cx) - hx;
  const qy = Math.abs(py - cy) - hy;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - radius;
}

function blend(r: Raster, x: number, y: number, c: RGB, alpha: number): void {
  if (alpha <= 0) return;
  const i = (y * r.width + x) * 4;
  const a = Math.min(1, alpha);
  r.data[i] = Math.round((r.data[i] as number) * (1 - a) + c.r * a);
  r.data[i + 1] = Math.round((r.data[i + 1] as number) * (1 - a) + c.g * a);
  r.data[i + 2] = Math.round((r.data[i + 2] as number) * (1 - a) + c.b * a);
  r.data[i + 3] = Math.max(r.data[i + 3] as number, Math.round(a * 255));
}

function drawHighlightRaster(r: Raster, rect: Rect, c: RGB): void {
  const g = highlightGeometry(r.width);
  const box: Rect = { x: rect.x - g.pad, y: rect.y - g.pad, width: rect.width + 2 * g.pad, height: rect.height + 2 * g.pad };
  const radius = Math.min(g.radius, box.width / 2, box.height / 2);
  const x0 = Math.max(0, Math.floor(box.x - g.thickness - 1));
  const y0 = Math.max(0, Math.floor(box.y - g.thickness - 1));
  const x1 = Math.min(r.width, Math.ceil(box.x + box.width + g.thickness + 1));
  const y1 = Math.min(r.height, Math.ceil(box.y + box.height + g.thickness + 1));
  const half = g.thickness / 2;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      // Stroke centred on the box edge, 1px anti-aliased; faint tint inside.
      const d = sdRoundRect(x + 0.5, y + 0.5, box, radius);
      const stroke = Math.max(0, Math.min(1, half + 0.5 - Math.abs(d)));
      if (stroke > 0) blend(r, x, y, c, stroke);
      else if (d < 0) blend(r, x, y, c, 0.1);
    }
  }
}

/** Highlight ring geometry in image pixels, scaled to the image width so it reads at any size. */
export function highlightGeometry(imageWidth: number): { pad: number; radius: number; thickness: number } {
  const k = Math.max(1, imageWidth / 1000);
  return { pad: Math.round(4 * k), radius: Math.round(8 * k), thickness: Math.max(2, Math.round(3 * k)) };
}

// ---------------------------------------------------------------------------------------------
// Preparing one step image
// ---------------------------------------------------------------------------------------------

export interface PreparedImage {
  bytes: Uint8Array;
  format: ImageFormat;
  width: number;
  height: number;
  /** Highlight rect in prepared-image pixels, when it still needs drawing by the caller. */
  highlight?: Rect;
  /** Redaction rects in prepared-image pixels (already baked unless `redactionsBaked`). */
  redactions: Rect[];
}

export interface PrepareOptions {
  highlight: boolean;
  /** Draw the ring into the pixels (DOCX). When false the rect is returned for vector drawing (PDF). */
  bakeHighlight: boolean;
  redactionsBaked?: boolean;
  highlightColor: RGB;
}

function intersect(a: Rect, b: Rect): Rect | undefined {
  const x0 = Math.max(a.x, b.x);
  const y0 = Math.max(a.y, b.y);
  const x1 = Math.min(a.x + a.width, b.x + b.width);
  const y1 = Math.min(a.y + a.height, b.y + b.height);
  return x1 > x0 && y1 > y0 ? { x: x0, y: y0, width: x1 - x0, height: y1 - y0 } : undefined;
}

/**
 * Applies crop, redactions and (optionally) the highlight to a step's screenshot.
 * PNG: rewritten pixel-exact (cropped-away and redacted pixels are gone from the output).
 * JPEG: passed through; crop is ignored, and unbaked redactions throw (see DocExportOptions).
 */
export function prepareStepImage(step: Step, bytes: Uint8Array, opts: PrepareOptions): PreparedImage {
  const shot = step.screenshot;
  const info = sniffImage(bytes);
  // Rects are in `shot.width` pixels; scale if the supplied bytes differ in size.
  const sx = shot && shot.width > 0 ? info.width / shot.width : 1;
  const sy = shot && shot.height > 0 ? info.height / shot.height : 1;
  const scale = (r: Rect): Rect => ({ x: r.x * sx, y: r.y * sy, width: r.width * sx, height: r.height * sy });
  const full: Rect = { x: 0, y: 0, width: info.width, height: info.height };

  let redactions = (shot?.redactions ?? []).map((r) => scale(r.rect)).filter((r) => r.width > 0 && r.height > 0);
  let highlight = opts.highlight && shot?.highlight ? scale(shot.highlight) : undefined;
  let crop = shot?.crop && info.format === "png" ? intersect(scale(shot.crop), full) : undefined;
  if (crop) {
    crop = { x: Math.round(crop.x), y: Math.round(crop.y), width: Math.max(1, Math.round(crop.width)), height: Math.max(1, Math.round(crop.height)) };
  }

  const mustBake = redactions.length > 0 && !opts.redactionsBaked;
  const wantBake = mustBake || !!crop || (opts.bakeHighlight && !!highlight);

  let out: PreparedImage = { bytes, format: info.format, width: info.width, height: info.height, redactions, highlight };
  if (wantBake) {
    const raster = info.format === "png" ? decodePng(bytes) : null;
    if (!raster) {
      if (mustBake) {
        throw new Error(
          `Step ${step.id}: cannot bake redactions into this image (only non-interlaced PNG is rewritten). ` +
            `Bake them into the pixels first and pass redactionsBaked: true.`,
        );
      }
      // Highlight/crop only: fall back to the original bytes (PDF still draws the ring as vectors).
      return out;
    }
    let work = raster;
    if (crop) {
      work = cropRaster(work, crop);
      const shift = (r: Rect): Rect => ({ x: r.x - crop!.x, y: r.y - crop!.y, width: r.width, height: r.height });
      redactions = redactions.map((r) => intersect(r, crop!)).filter((r): r is Rect => !!r).map(shift);
      if (highlight) highlight = shift(highlight);
    }
    if (mustBake) for (const r of redactions) fillRectSolid(work, r, REDACTION_COLOR);
    if (opts.bakeHighlight && highlight) {
      drawHighlightRaster(work, highlight, opts.highlightColor);
      highlight = undefined;
    }
    out = { bytes: encodePng(work), format: "png", width: work.width, height: work.height, redactions, highlight };
  }
  return out;
}

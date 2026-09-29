// Shared helpers for the PDF and DOCX exporters: inline-Markdown flattening, date formatting, image
// sniffing and the per-step image preparation (redactions baked into pixels, crop applied, highlight
// baked for DOCX or handed back for vector drawing in the PDF). Pixel work is core's raster.ts.
// Pure TS: no DOM, no Node-only APIs.

import type { Guide, Rect, Step, TabCorner } from "../schema";
import { highlightScale } from "../geometry";
import { DEFAULT_HIGHLIGHT_COLOR, imageSpace, renderStepImage } from "../raster";
import { pngSize } from "../png";
import { typographicQuotes } from "../text";
import { displayUrl } from "./shared";

// ---------------------------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------------------------

export interface DocExportOptions {
  /** Page size. Default "A4". */
  pageSize?: "A4" | "Letter";
  /** Draw the click-target highlight (spotlight, ring, numbered tab). Default true. */
  highlight?: boolean;
  /**
   * Set true when the image bytes you pass already have every `screenshot.redactions` rect
   * baked into the pixels (e.g. you drew them on a canvas). Otherwise the exporter bakes them
   * (solid, pixelate or blur, as each redaction says) and THROWS for images it cannot rewrite
   * (JPEG, interlaced PNG), because a vector overlay alone leaves the original pixels
   * extractable from the file. Baking twice is harmless.
   */
  redactionsBaked?: boolean;
  /**
   * Set true when the bytes are fully rendered already (redactions, crop, highlight with its
   * number, e.g. by the extension's canvas renderer). They are embedded untouched.
   */
  imagesPrerendered?: boolean;
  /** Add a small "Made with Showsteps" credit. Default false (opt-in). */
  branding?: boolean;
  /**
   * Clock for the document's creation and modification dates. Default: the guide's own
   * `createdAt` / `updatedAt`, so the same guide always exports to the same bytes. Pass a fixed
   * value (or `SOURCE_DATE_EPOCH * 1000`) to override.
   */
  now?: Date | number | string;
  /** Called with a human-readable message when something was substituted (a glyph the fonts lack). */
  onWarning?: (message: string) => void;
}

export type RGB = { r: number; g: number; b: number };

export { DEFAULT_HIGHLIGHT_COLOR };
/** Brand accent (persimmon) and neutrals, from packages/brand tokens (light theme). */
export const ACCENT_COLOR: RGB = { r: 0xeb, g: 0x4e, b: 0x26 };
/** Fill for markers with white text on them (brand accent-strong: 4.7:1 with white). */
export const ACCENT_STRONG: RGB = { r: 0xd1, g: 0x3f, b: 0x19 };
/** Redaction fill (brand `redactSolidColor`). */
export const REDACTION_COLOR: RGB = { r: 0x1f, g: 0x1c, b: 0x19 };

/** Creation and modification dates for a document: the injected clock, else the guide's own dates. */
export function documentDates(guide: Guide, opts: { now?: Date | number | string }): { created: Date; modified: Date } {
  const valid = (d: Date): d is Date => !Number.isNaN(d.getTime());
  if (opts.now !== undefined) {
    const n = new Date(opts.now);
    if (valid(n)) return { created: n, modified: n };
  }
  const created = new Date(guide.createdAt);
  const modified = new Date(guide.updatedAt);
  const fallback = new Date(0);
  return { created: valid(created) ? created : fallback, modified: valid(modified) ? modified : valid(created) ? created : fallback };
}

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

/**
 * Inline Markdown to runs. Keeps **bold**; flattens links, `code` and *italic* to plain text. Straight
 * quotes become typographic ones (see `typographicQuotes`): the documents are for people to read.
 */
export function parseInline(md: string): InlineRun[] {
  const raw = parseInlineRaw(md);
  let prev = "";
  return raw.map((r) => {
    const text = typographicQuotes(r.text, prev);
    prev = r.text.slice(-1) || prev;
    return r.bold ? { text, bold: true } : { text };
  });
}

function parseInlineRaw(md: string): InlineRun[] {
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

/** Plain text of inline Markdown, straight quotes kept (for metadata and search). */
export function stripInline(md: string): string {
  return parseInlineRaw(md)
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

/**
 * "28 Sep 2026", read from the date part of the ISO string as written (the extension writes local-offset
 * timestamps, so this is the user's own day). No time zone conversion, so it is deterministic. "" if unparseable.
 */
export function formatDate(iso: string | undefined): string {
  const m = iso ? /^(\d{4})-(\d{2})-(\d{2})/.exec(iso) : null;
  if (!m) return "";
  const month = MONTHS[Number(m[2]) - 1];
  return month ? `${Number(m[3])} ${month} ${m[1]}` : "";
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
  return url ? displayUrl(url) : undefined; // no query string or fragment: they often carry tokens
}

export function parseColorRgb(css: string | undefined, fallback: string = DEFAULT_HIGHLIGHT_COLOR): RGB {
  const parse = (v: string): RGB | undefined => {
    const t = v.trim().toLowerCase();
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
      const c = (x: string | undefined) => Math.min(255, Number(x));
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
// Preparing one step image
// ---------------------------------------------------------------------------------------------

export interface PreparedImage {
  bytes: Uint8Array;
  format: ImageFormat;
  width: number;
  height: number;
  /** Highlight target in prepared-image pixels, when the caller still has to draw it (vector mode). */
  highlight?: Rect;
  /** Corner the recorder stored for the tab, if any. */
  corner?: TabCorner;
  /** Scale (image px per CSS px) for the highlight geometry, when `highlight` is set. */
  highlightScale?: number;
}

export interface PrepareOptions {
  /** Draw the highlight at all. */
  highlight: boolean;
  /**
   * "bake": draw the highlight (number included) into the pixels (DOCX). "vector": leave the pixels
   * clean and return the target rect for the caller to draw with paths (PDF).
   */
  highlightMode: "bake" | "vector";
  /** Step number shown on the highlight tab. */
  n: number;
  color: string;
  redactionsBaked?: boolean;
  imagesPrerendered?: boolean;
}

/**
 * Applies crop and redactions (always baked into the pixels unless the caller says they already are)
 * and, in bake mode, the highlight. PNG: rewritten pixel-exact. JPEG or other: redactions throw
 * `RenderError`; crop and highlight are skipped (the vector highlight is still returned).
 */
export function prepareStepImage(step: Step, bytes: Uint8Array, opts: PrepareOptions): PreparedImage {
  const shot = step.screenshot;
  const info = sniffImage(bytes);
  if (!shot || opts.imagesPrerendered) return { bytes, format: info.format, width: info.width, height: info.height };
  const wantHighlight = opts.highlight && !!shot.highlight && shot.highlight.width > 0 && shot.highlight.height > 0;
  const rtl = step.page.dir === "rtl";
  const out = renderStepImage(bytes, shot, {
    highlight: wantHighlight && opts.highlightMode === "bake",
    highlightColor: opts.color,
    stepNumber: opts.n,
    redact: !opts.redactionsBaked,
    ...(rtl ? { rtl: true } : {}),
  });
  const size = out === bytes ? { width: info.width, height: info.height } : (pngSize(out) ?? { width: info.width, height: info.height });
  const prepared: PreparedImage = { bytes: out, format: out === bytes ? info.format : "png", width: size.width, height: size.height };
  if (wantHighlight && opts.highlightMode === "vector") {
    const space = imageSpace(shot, info.width, info.height);
    let hl = space.fit(shot.highlight as Rect);
    // the crop only applied if the bytes were rewritten to exactly its size
    if (space.crop && out !== bytes && size.width === space.crop.width && size.height === space.crop.height) {
      hl = { x: hl.x - space.crop.x, y: hl.y - space.crop.y, width: hl.width, height: hl.height };
    }
    prepared.highlight = hl;
    const stored = (shot.highlight as { corner?: TabCorner }).corner;
    if (stored) prepared.corner = stored;
    prepared.highlightScale = highlightScale(shot.viewport.width, shot.devicePixelRatio) * Math.max(shot.width > 0 ? info.width / shot.width : 1, shot.height > 0 ? info.height / shot.height : 1);
  }
  return prepared;
}

// Pixel work on step screenshots with OffscreenCanvas (works in the service worker and pages).
//  - bakeRedactions: destroys the pixels under every redaction (for .stepsnap bundles and
//    as the first pass of every export), so no exported file contains the secret.
//  - renderAnnotated: crop + redactions + highlight box + numbered step marker, for human
//    exports (Markdown, HTML, PDF, DOCX) and previews.

import { redactRegion } from "@stepsnap/core";
import type { Rect, Redaction, Step } from "@stepsnap/core";
import { clipRect, toCropSpace } from "./rect";
import { drawFlagHighlight, highlight as flag, highlightScale } from "@stepsnap/brand";

type Ctx = OffscreenCanvasRenderingContext2D;

export interface AnnotateOptions {
  highlight?: boolean; // default true
  marker?: number; // step number drawn on the flag tab
  color?: string;
  dim?: boolean; // darken everything outside the highlight (default true)
}

async function decode(blob: Blob): Promise<ImageBitmap> {
  return createImageBitmap(blob);
}

function ctx2d(c: OffscreenCanvas): Ctx {
  const ctx = c.getContext("2d");
  if (!ctx) throw new Error("2D canvas unavailable");
  return ctx;
}

/**
 * Irreversibly obscure `r` on `ctx`. The region is averaged down to coarse blocks (so the
 * original glyphs are gone from the pixel data), then scaled back up.
 */
export function obscure(ctx: Ctx, r: Rect, style: Redaction["style"], scale = 1): void {
  const w = Math.max(1, Math.round(r.width));
  const h = Math.max(1, Math.round(r.height));
  const x = Math.round(r.x);
  const y = Math.round(r.y);
  if (style === "solid") {
    ctx.save();
    ctx.fillStyle = flag.redactSolidColor;
    ctx.fillRect(x, y, w, h);
    ctx.restore();
    return;
  }
  if (style === "mask") {
    // Automatic redactions: the field's own background, a thin border and a row of dots, drawn by
    // core's rasteriser on the pixels (same result as the CLI and every exporter).
    const cw = ctx.canvas.width;
    const ch = ctx.canvas.height;
    const x0 = Math.max(0, x);
    const y0 = Math.max(0, y);
    const w0 = Math.min(cw, x + w) - x0;
    const h0 = Math.min(ch, y + h) - y0;
    if (w0 <= 0 || h0 <= 0) return;
    const img = ctx.getImageData(x0, y0, w0, h0);
    redactRegion({ width: w0, height: h0, data: img.data as unknown as Uint8Array }, { x: 0, y: 0, width: w0, height: h0 }, "mask", scale);
    ctx.putImageData(img, x0, y0);
    return;
  }
  // Block size: at least ~10 CSS px, and no more than 3 blocks per text line height.
  const block = Math.max(Math.round(10 * scale), Math.round(Math.min(h, 40 * scale) / 2));
  const sw = Math.max(1, Math.round(w / block));
  const sh = Math.max(1, Math.round(h / block));
  const small = new OffscreenCanvas(sw, sh);
  const sctx = ctx2d(small);
  sctx.imageSmoothingEnabled = true;
  sctx.imageSmoothingQuality = "high";
  sctx.drawImage(ctx.canvas, x, y, w, h, 0, 0, sw, sh);
  ctx.save();
  ctx.imageSmoothingEnabled = style === "blur";
  ctx.imageSmoothingQuality = "high";
  ctx.clearRect(x, y, w, h);
  ctx.drawImage(small, 0, 0, sw, sh, x, y, w, h);
  if (style === "blur") {
    // A soft veil keeps it readable as "hidden on purpose" rather than a rendering glitch.
    ctx.fillStyle = "rgba(128,128,128,0.18)";
    ctx.fillRect(x, y, w, h);
  }
  ctx.restore();
}

async function toPng(c: OffscreenCanvas): Promise<Blob> {
  return c.convertToBlob({ type: "image/png" });
}

/** Scale factor between image pixels and CSS pixels for a step. */
export function scaleOf(step: Step): number {
  const sh = step.screenshot;
  if (!sh) return 1;
  const s = sh.width / Math.max(1, sh.viewport.width);
  return Number.isFinite(s) && s > 0 ? s : sh.devicePixelRatio || 1;
}

/** Full-size image with every redaction burned in. No crop, no highlight. */
export async function bakeRedactions(blob: Blob, step: Step): Promise<Blob> {
  const reds = step.screenshot?.redactions ?? [];
  if (!reds.length) return blob;
  const bmp = await decode(blob);
  const c = new OffscreenCanvas(bmp.width, bmp.height);
  const ctx = ctx2d(c);
  ctx.drawImage(bmp, 0, 0);
  bmp.close();
  const k = scaleOf(step);
  for (const r of reds) {
    const clipped = clipRect(r.rect, c.width, c.height);
    if (clipped) obscure(ctx, clipped, r.style, k);
  }
  return toPng(c);
}

/** Crop, redactions, highlight and marker, ready for a document. */
export async function renderAnnotated(blob: Blob, step: Step, opts: AnnotateOptions = {}): Promise<{ blob: Blob; width: number; height: number }> {
  const sh = step.screenshot;
  const bmp = await decode(blob);
  const full: Rect = { x: 0, y: 0, width: bmp.width, height: bmp.height };
  const crop = sh?.crop ? clipRect(sh.crop, bmp.width, bmp.height) ?? full : full;
  const k = scaleOf(step);

  // Redact on a full-size canvas first so blocks never sample pixels outside the crop edge differently.
  const work = new OffscreenCanvas(bmp.width, bmp.height);
  const wctx = ctx2d(work);
  wctx.drawImage(bmp, 0, 0);
  bmp.close();
  for (const r of sh?.redactions ?? []) {
    const clipped = clipRect(r.rect, work.width, work.height);
    if (clipped) obscure(wctx, clipped, r.style, k);
  }

  const out = new OffscreenCanvas(Math.round(crop.width), Math.round(crop.height));
  const octx = ctx2d(out);
  octx.drawImage(work, crop.x, crop.y, crop.width, crop.height, 0, 0, out.width, out.height);

  if (opts.highlight !== false && sh?.highlight) {
    const hl = clipRect(toCropSpace(sh.highlight, crop), out.width, out.height);
    if (hl) {
      // The brand's signature mark (ring + numbered flag tab + soft dim), shared with core's exporters.
      drawFlagHighlight(octx as unknown as Parameters<typeof drawFlagHighlight>[0], {
        target: hl,
        n: opts.marker ?? "",
        imageWidth: out.width,
        imageHeight: out.height,
        scale: highlightScale(sh.viewport.width, k),
        color: opts.color ?? flag.color,
        dim: opts.dim === false ? "transparent" : undefined,
        corner: sh.highlight.corner,
        rtl: step.page.dir === "rtl",
      });
    }
  }
  return { blob: await toPng(out), width: out.width, height: out.height };
}

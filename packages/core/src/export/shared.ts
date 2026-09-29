import type { Guide, Step } from "../schema";
import { DEFAULT_HIGHLIGHT_COLOR, renderStepImage } from "../raster";
import type { ImageSource } from "../types";

/** Steps that appear in exports: everything not marked `skipped`. */
export function visibleSteps(guide: Guide): Step[] {
  return guide.steps.filter((s) => !s.skipped);
}

export interface ImageRenderOptions {
  /**
   * Set when the image bytes already have redactions, highlight and crop baked in (for example
   * drawn on a canvas by the extension). Then bytes pass through untouched. Default false.
   */
  imagesPrerendered?: boolean;
  /** Draw the highlight ring (ignored when prerendered). Default true. */
  highlight?: boolean;
  /** CSS colour override; default is `guide.settings.highlightColor`, then the built-in accent. */
  highlightColor?: string;
}

/**
 * Render every visible step's screenshot for export: redactions baked into pixels (always, never
 * optional unless prerendered), highlight ring drawn, crop applied. Result is keyed by
 * `step.screenshot.image`. Steps whose bytes are absent from `images` are left out.
 * Throws `RenderError` if a redaction cannot be baked (e.g. a JPEG).
 */
export function renderGuideImages(guide: Guide, images: ImageSource, opts: ImageRenderOptions = {}): ImageSource {
  const out: ImageSource = {};
  const color = opts.highlightColor ?? guide.settings?.highlightColor ?? DEFAULT_HIGHLIGHT_COLOR;
  for (const step of visibleSteps(guide)) {
    const shot = step.screenshot;
    if (!shot) continue;
    const bytes = images[shot.image];
    if (!bytes) continue;
    out[shot.image] = opts.imagesPrerendered ? bytes : renderStepImage(bytes, shot, { highlight: opts.highlight !== false, highlightColor: color });
  }
  return out;
}

/** Effective "show page URLs" flag: explicit option, then guide setting, then true. */
export function resolveIncludeUrls(guide: Guide, opt?: boolean): boolean {
  return opt ?? guide.settings?.includeUrls ?? true;
}

/** Numbered position (1-based) of each visible step, by step id. */
export function stepNumbers(guide: Guide): Map<string, number> {
  const m = new Map<string, number>();
  visibleSteps(guide).forEach((s, i) => m.set(s.id, i + 1));
  return m;
}

/**
 * URL as shown in human-readable exports: origin and path only. Query strings and fragments are
 * dropped because they often carry tokens, ids or email addresses. (Replay files keep the full URL.)
 */
export function displayUrl(url: string): string {
  try {
    const u = new URL(url);
    if (u.protocol !== "http:" && u.protocol !== "https:") return url.split(/[?#]/)[0] as string;
    return u.origin + (u.pathname === "/" ? "/" : u.pathname.replace(/\/$/, ""));
  } catch {
    return url.split(/[?#]/)[0] as string;
  }
}

export function sniffImageMime(bytes: Uint8Array): string {
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return "image/png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return "image/jpeg";
  if (bytes[0] === 0x47 && bytes[1] === 0x49) return "image/gif";
  if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[8] === 0x57) return "image/webp";
  return "application/octet-stream";
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** `2026-09-28T10:00:00Z` -> `28 September 2026` (UTC date part; deterministic, locale-free). */
export function formatDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1] ?? ""} ${m[1]}`;
}

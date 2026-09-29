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

import type { Guide } from "../schema";
import { PRODUCT_NAME, SITE_URL } from "../brand";
import type { ExportFiles, ExportResult, ImageSource } from "../types";
import { escapeInline, plainTitle } from "../text";
import { displayUrl, renderGuideImages, resolveIncludeUrls, visibleSteps, type ImageRenderOptions } from "./shared";

export interface MarkdownOptions extends ImageRenderOptions {
  /**
   * Screenshot bytes keyed by `step.screenshot.image`. When given, the returned `files` include the
   * rendered images (redactions baked in, highlight drawn, crop applied) under the same paths the
   * Markdown links to. When omitted, the Markdown still links `images/...` so the caller can add files.
   */
  images?: ImageSource;
  /** Show the page each step happened on. Default: `guide.settings.includeUrls`, else true. */
  includeUrls?: boolean;
  /** Emit `![...](images/...)` links. Default true; set false for a text-only copy (clipboard). */
  imageLinks?: boolean;
  /** Add a small "Made with Showsteps" credit. Default false (opt-in). */
  branding?: boolean;
}

/** Make a URL safe inside a Markdown link destination. */
export function markdownUrl(url: string): string {
  return url.replace(/[\s()<>]/g, (c) => ({ " ": "%20", "(": "%28", ")": "%29", "<": "%3C", ">": "%3E" })[c] as string);
}

/**
 * `guide.md` plus (with `opts.images`) the `images/...` screenshots. Skipped steps are left out and
 * the remaining steps are numbered 1..n. Deterministic: no clock, sorted file order.
 */
export function exportMarkdown(guide: Guide, opts: MarkdownOptions = {}): ExportResult {
  const steps = visibleSteps(guide);
  const includeUrls = resolveIncludeUrls(guide, opts.includeUrls);
  const rendered = opts.images ? renderGuideImages(guide, opts.images, opts) : undefined;
  const links = opts.imageLinks !== false;

  const out: string[] = [];
  out.push(`# ${escapeInline(guide.title.trim() || "Untitled guide")}`, "");
  if (guide.description?.trim()) out.push(guide.description.trim(), "");

  let lastUrl: string | undefined;
  steps.forEach((step, i) => {
    const n = i + 1;
    out.push(`## ${n}. ${step.title.trim() || "Step"}`, "");
    if (step.description?.trim()) out.push(step.description.trim(), "");
    const shot = step.screenshot;
    if (links && shot && (!rendered || rendered[shot.image])) {
      out.push(`![Step ${n}: ${escapeInline(plainTitle(step.title))}](${markdownUrl(shot.image)})`, "");
    }
    const shown = step.page.url ? displayUrl(step.page.url) : "";
    if (includeUrls && shown && shown !== lastUrl) {
      const label = escapeInline(step.page.title?.trim() || shown);
      out.push(`*Page: [${label}](${markdownUrl(shown)})*`, "");
    }
    if (shown) lastUrl = shown;
  });

  if (opts.branding === true) out.push("---", "", `*Made with [${PRODUCT_NAME}](${SITE_URL})*`, "");

  const files: ExportFiles = { "guide.md": out.join("\n").replace(/\n{3,}/g, "\n\n") };
  if (rendered) for (const p of Object.keys(rendered).sort()) files[p] = rendered[p] as Uint8Array;
  return { files };
}

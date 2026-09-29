// Export orchestration (runs in extension pages). Screenshots are re-drawn on a canvas first:
//  - human formats get "annotated" images (crop + redactions + highlight + step number) and a
//    guide copy whose screenshots describe those rendered images (no highlight/crop/redaction
//    metadata left, so no exporter draws anything twice);
//  - the project bundle (.showsteps) gets "baked" images (redactions burned in, nothing else) and the
//    original metadata, so it stays editable but never carries the secret pixels.

import {
  exportAgentSkill,
  exportHtml,
  exportMarkdown,
  packBundle,
  unpackBundle,
  validateGuide,
} from "@stepsnap/core";
import * as core from "@stepsnap/core";
import type { Guide, ImageSource, Step } from "@stepsnap/core";
import { zipSync, strToU8 } from "fflate";
import { bakeRedactions, renderAnnotated } from "./render";
import { visibleSteps } from "./guide-ops";
import { loadExportPrefs } from "./prefs";
import { PROJECT_EXT } from "../config";

import type { ExportFormat } from "./formats";
export type { ExportFormat } from "./formats";

export interface ExportFile {
  filename: string;
  blob: Blob;
}

export function slugify(s: string): string {
  const slug = s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return slug || "guide";
}

async function bytesOf(b: Blob): Promise<Uint8Array> {
  return new Uint8Array(await b.arrayBuffer());
}

function toU8(v: Uint8Array | string): Uint8Array {
  return typeof v === "string" ? strToU8(v) : v;
}

export interface ExportOptions {
  /** Highlight colour (one of the brand swatches); default from the guide or the brand. */
  color?: string;
  /** Dim everything around the highlight (default true). */
  dim?: boolean;
  /** Show page addresses under steps (default: the guide setting, else true). */
  includeUrls?: boolean;
  /** Export skipped steps too (default false). */
  includeHidden?: boolean;
  /** Progress while screenshots are rendered. */
  onProgress?: (done: number, total: number) => void;
  /** Add the small "Made with Showsteps" credit (default: the Settings choice, which is off). */
  branding?: boolean;
  /** PDF paper size. */
  pageSize?: "A4" | "Letter";
}

/** Wait for the brand font so the flag numerals are drawn in Rethink Sans. */
async function fontsReady(): Promise<void> {
  try {
    await (globalThis as { document?: Document }).document?.fonts?.load('750 16px "Rethink Sans"');
  } catch {
    /* system fallback is fine */
  }
}

/** Annotated images + a guide describing them. Only visible steps with screenshots are drawn. */
export async function prepareAnnotated(guide: Guide, blobs: Record<string, Blob>, opts: ExportOptions = {}): Promise<{ guide: Guide; images: ImageSource }> {
  await fontsReady();
  const images: ImageSource = {};
  const color = opts.color ?? guide.settings?.highlightColor;
  let n = 0;
  const steps: Step[] = [];
  const total = guide.steps.filter((s) => !s.skipped && s.screenshot).length;
  let done = 0;
  opts.onProgress?.(0, total);
  for (const s of guide.steps) {
    if (s.skipped) {
      steps.push(s);
      continue;
    }
    n++;
    const blob = s.screenshot ? blobs[s.screenshot.image] : undefined;
    if (!s.screenshot || !blob) {
      const { screenshot: _drop, ...rest } = s;
      steps.push(rest);
      continue;
    }
    const r = await renderAnnotated(blob, s, { marker: n, color, dim: opts.dim });
    opts.onProgress?.(++done, total);
    images[s.screenshot.image] = await bytesOf(r.blob);
    const { highlight: _h, redactions: _r, crop: _c, ...shot } = s.screenshot;
    steps.push({ ...s, screenshot: { ...shot, width: r.width, height: r.height } });
  }
  return { guide: { ...guide, steps }, images };
}

/** Redaction-baked images (full size) for bundles. */
export async function prepareBaked(guide: Guide, blobs: Record<string, Blob>): Promise<ImageSource> {
  const images: ImageSource = {};
  for (const s of guide.steps) {
    const blob = s.screenshot ? blobs[s.screenshot.image] : undefined;
    if (!s.screenshot || !blob) continue;
    images[s.screenshot.image] = await bytesOf(await bakeRedactions(blob, s));
  }
  return images;
}

type PdfFn = (g: Guide, i: ImageSource, o?: Record<string, unknown>) => Promise<Uint8Array>;

function optionalExporter(name: "exportPdf" | "exportDocx"): PdfFn {
  const fn = (core as unknown as Record<string, unknown>)[name];
  if (typeof fn !== "function") throw new Error(`${name === "exportPdf" ? "PDF" : "Word"} export is not available in this build yet.`);
  return fn as PdfFn;
}

export async function markdownText(guide: Guide): Promise<string> {
  // Clipboard copy: text only (image links would point at files that are not there).
  const { credit } = await loadExportPrefs();
  const { files } = exportMarkdown(guide, { imageLinks: false, branding: credit } as Parameters<typeof exportMarkdown>[1]);
  const md = Object.entries(files).find(([p]) => p.endsWith(".md"))?.[1];
  if (md === undefined) throw new Error("Markdown exporter returned no .md file");
  return typeof md === "string" ? md : new TextDecoder().decode(md);
}

export async function exportGuide(format: ExportFormat, source: Guide, blobs: Record<string, Blob>, opts: ExportOptions = {}): Promise<ExportFile> {
  const base = slugify(source.title);
  const branding = opts.branding ?? (await loadExportPrefs()).credit;
  const includeUrls = opts.includeUrls ?? source.settings?.includeUrls ?? true;
  let guide: Guide = { ...source, settings: { ...source.settings, includeUrls, ...(opts.color ? { highlightColor: opts.color } : {}) } };
  if (opts.includeHidden) guide = { ...guide, steps: guide.steps.map((s) => (s.skipped ? { ...s, skipped: false } : s)) };
  switch (format) {
    case "markdown": {
      const { guide: g, images } = await prepareAnnotated(guide, blobs, opts);
      const { files } = exportMarkdown(g, { images, imagesPrerendered: true, includeUrls, branding } as Parameters<typeof exportMarkdown>[1]);
      const all: Record<string, Uint8Array> = {};
      for (const [p, v] of Object.entries(files)) all[p] = toU8(v);
      // Include referenced images if the exporter left them to us.
      for (const [p, v] of Object.entries(images)) if (!(p in all) && visibleUses(g, p)) all[p] = v;
      return { filename: `${base}-markdown.zip`, blob: new Blob([zipSync(all, { level: 6 }) as BlobPart], { type: "application/zip" }) };
    }
    case "html": {
      const { guide: g, images } = await prepareAnnotated(guide, blobs, opts);
      const html = exportHtml(g, images, { includeUrls, imagesPrerendered: true, branding } as Parameters<typeof exportHtml>[2]);
      return { filename: `${base}.html`, blob: new Blob([html], { type: "text/html" }) };
    }
    case "pdf": {
      const { guide: g, images } = await prepareAnnotated(guide, blobs, opts);
      const bytes = await optionalExporter("exportPdf")(g, images, { redactionsBaked: true, highlight: false, branding, pageSize: opts.pageSize ?? "A4" });
      return { filename: `${base}.pdf`, blob: new Blob([bytes as BlobPart], { type: "application/pdf" }) };
    }
    case "docx": {
      const { guide: g, images } = await prepareAnnotated(guide, blobs, opts);
      const bytes = await optionalExporter("exportDocx")(g, images, { redactionsBaked: true, highlight: false, branding });
      return {
        filename: `${base}.docx`,
        blob: new Blob([bytes as BlobPart], { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }),
      };
    }
    case "skill": {
      const { files } = exportAgentSkill(guide, { branding } as Parameters<typeof exportAgentSkill>[1]);
      const all: Record<string, Uint8Array> = {};
      for (const [p, v] of Object.entries(files)) all[`${base}/${p}`] = toU8(v);
      return { filename: `${base}-skill.zip`, blob: new Blob([zipSync(all, { level: 6 }) as BlobPart], { type: "application/zip" }) };
    }
    case "project": {
      // The project keeps the author's own settings and hidden steps; only pixels are made safe.
      const images = await prepareBaked(source, blobs);
      const bytes = packBundle(source, images);
      return { filename: `${base}${PROJECT_EXT}`, blob: new Blob([bytes as BlobPart], { type: "application/zip" }) };
    }
  }
}

function visibleUses(g: Guide, path: string): boolean {
  return visibleSteps(g).some((s) => s.screenshot?.image === path);
}

/** Parse and validate a project file (.showsteps; .stepsnap accepted too). */
export async function readBundle(file: Blob): Promise<{ guide: Guide; images: Record<string, Blob> }> {
  const { guide, images } = unpackBundle(await bytesOf(file));
  const v = validateGuide(guide);
  if (!v.ok) throw new Error(`Not a valid Showsteps project: ${v.errors.slice(0, 3).join("; ")}`);
  const blobs: Record<string, Blob> = {};
  for (const [p, bytes] of Object.entries(images)) blobs[p] = new Blob([bytes as BlobPart], { type: p.endsWith(".jpg") || p.endsWith(".jpeg") ? "image/jpeg" : "image/png" });
  return { guide: v.guide, images: blobs };
}

/** Trigger a download from an extension page (no downloads permission needed). */
export function download(file: ExportFile): void {
  const url = URL.createObjectURL(file.blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = file.filename;
  a.rel = "noopener";
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

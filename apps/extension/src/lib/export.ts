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

/** Annotated images + a guide describing them. Only visible steps with screenshots are drawn. */
export async function prepareAnnotated(guide: Guide, blobs: Record<string, Blob>): Promise<{ guide: Guide; images: ImageSource }> {
  const images: ImageSource = {};
  const color = guide.settings?.highlightColor;
  let n = 0;
  const steps: Step[] = [];
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
    const r = await renderAnnotated(blob, s, { marker: n, color });
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
  const { files } = exportMarkdown(guide);
  const md = Object.entries(files).find(([p]) => p.endsWith(".md"))?.[1];
  if (md === undefined) throw new Error("Markdown exporter returned no .md file");
  return typeof md === "string" ? md : new TextDecoder().decode(md);
}

export async function exportGuide(format: ExportFormat, guide: Guide, blobs: Record<string, Blob>): Promise<ExportFile> {
  const base = slugify(guide.title);
  switch (format) {
    case "markdown": {
      const { guide: g, images } = await prepareAnnotated(guide, blobs);
      const { files } = exportMarkdown(g, { images });
      const all: Record<string, Uint8Array> = {};
      for (const [p, v] of Object.entries(files)) all[p] = toU8(v);
      // Include referenced images if the exporter left them to us.
      for (const [p, v] of Object.entries(images)) if (!(p in all) && visibleUses(g, p)) all[p] = v;
      return { filename: `${base}-markdown.zip`, blob: new Blob([zipSync(all, { level: 6 }) as BlobPart], { type: "application/zip" }) };
    }
    case "html": {
      const { guide: g, images } = await prepareAnnotated(guide, blobs);
      const html = exportHtml(g, images, { includeUrls: guide.settings?.includeUrls !== false });
      return { filename: `${base}.html`, blob: new Blob([html], { type: "text/html" }) };
    }
    case "pdf": {
      const { guide: g, images } = await prepareAnnotated(guide, blobs);
      const bytes = await optionalExporter("exportPdf")(g, images, { redactionsBaked: true, highlight: false });
      return { filename: `${base}.pdf`, blob: new Blob([bytes as BlobPart], { type: "application/pdf" }) };
    }
    case "docx": {
      const { guide: g, images } = await prepareAnnotated(guide, blobs);
      const bytes = await optionalExporter("exportDocx")(g, images, { redactionsBaked: true, highlight: false });
      return {
        filename: `${base}.docx`,
        blob: new Blob([bytes as BlobPart], { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }),
      };
    }
    case "skill": {
      const { files } = exportAgentSkill(guide);
      const all: Record<string, Uint8Array> = {};
      for (const [p, v] of Object.entries(files)) all[`${base}/${p}`] = toU8(v);
      return { filename: `${base}-skill.zip`, blob: new Blob([zipSync(all, { level: 6 }) as BlobPart], { type: "application/zip" }) };
    }
    case "project": {
      const images = await prepareBaked(guide, blobs);
      const bytes = packBundle(guide, images);
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

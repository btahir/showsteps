// PDF exporter (pdf-lib, MIT). Pure TS: runs in Node, browsers and extension workers.
//
// REDACTION CONTRACT. A PDF embeds the image bytes you give it, so a shape drawn on top does not
// remove what is underneath. This exporter therefore bakes every `screenshot.redactions` rect into
// the pixels before embedding (style solid, pixelate or blur, as each redaction says) and THROWS for
// images it cannot rewrite (JPEG, interlaced PNG) unless the caller passes `redactionsBaked: true`
// to say the bytes were already redacted. A `crop` on a PNG is applied to the pixels too, so
// cropped-away content is not carried in the file. JPEG crops are ignored.
// The highlight (spotlight dim, keyline ring, numbered tab) is drawn as vector shapes on top.

import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, PDFFont, PDFImage, PDFPage, rgb } from "pdf-lib";
import { FRAGMENT_MONO_WOFF_B64, RETHINK_SANS_FACES, SOURCE_SANS_3_FACES } from "../../assets/fonts/default-fonts";
import { flagLayout, flagRingPath, flagTabCenter, flagTabPath, type FlagLayout } from "../flag";
import { FLAG } from "../geometry";
import type { Guide, Rect, Step, TabCorner } from "../schema";
import {
  ACCENT_COLOR,
  ACCENT_STRONG,
  activeSteps,
  documentDates,
  metaLine,
  parseBlocks,
  parseColorRgb,
  parseInline,
  prepareStepImage,
  stepUrl,
  stripInline,
  type DocExportOptions,
  type InlineRun,
  type RGB,
} from "./doc-shared";
import { DEFAULT_HIGHLIGHT_COLOR } from "../raster";

export interface PdfFonts {
  regular: Uint8Array;
  bold: Uint8Array;
  /** More faces, tried in order for characters this one lacks (other scripts). */
  fallbacks?: { regular: Uint8Array; bold: Uint8Array }[];
  /** Monospaced face for URLs. Default: Fragment Mono. */
  mono?: Uint8Array;
}

export interface PdfExportOptions extends DocExportOptions {
  /** TTF/OTF/WOFF bytes for regular and bold. Default: Rethink Sans for Latin, Source Sans 3 for Cyrillic and Greek, Fragment Mono for URLs (all OFL). */
  font?: PdfFonts;
}

const PAGE_SIZES = { A4: [595.28, 841.89], Letter: [612, 792] } as const;
const MARGIN = 54;
const FOOTER_Y = 28;

// Brand neutrals (packages/brand tokens, light theme)
const INK: RGB = { r: 0x1f, g: 0x1c, b: 0x19 };
const MUTED: RGB = { r: 0x57, g: 0x51, b: 0x4b };
const FAINT: RGB = { r: 0x73, g: 0x6b, b: 0x63 };
const HAIRLINE: RGB = { r: 0xe0, g: 0xdc, b: 0xd6 };

const col = (c: RGB) => rgb(c.r / 255, c.g / 255, c.b / 255);

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * Rethink Sans (static 400 and 700 instances) for Latin, then Source Sans 3 for what it lacks: Cyrillic,
 * Greek and, as a last resort, Latin. Fragment Mono for URLs.
 */
export function defaultPdfFonts(): PdfFonts {
  const dec = (f: { regular: string; bold: string }) => ({ regular: b64ToBytes(f.regular), bold: b64ToBytes(f.bold) });
  const [rLatin, ...rRest] = RETHINK_SANS_FACES;
  const sans = SOURCE_SANS_3_FACES.filter((f) => f.script !== "latin-ext");
  return { ...dec(rLatin as (typeof RETHINK_SANS_FACES)[number]), fallbacks: [...rRest, ...sans].map(dec), mono: b64ToBytes(FRAGMENT_MONO_WOFF_B64) };
}

// ---------------------------------------------------------------------------------------------
// Text layout
// ---------------------------------------------------------------------------------------------

interface Face {
  regular: PDFFont;
  bold: PDFFont;
  chars: Set<number>;
}

interface Seg {
  text: string;
  bold: boolean;
  face: number;
}
interface Line {
  segs: Seg[];
  width: number;
}

class Typesetter {
  /** Code points replaced with "?" because no face has them. */
  readonly missing = new Set<number>();

  constructor(readonly faces: Face[]) {}

  get regular(): PDFFont {
    return (this.faces[0] as Face).regular;
  }
  get bold(): PDFFont {
    return (this.faces[0] as Face).bold;
  }

  private faceOf(cp: number): number {
    for (let i = 0; i < this.faces.length; i++) if ((this.faces[i] as Face).chars.has(cp)) return i;
    return -1;
  }

  /** Split text into runs that each one face can draw; unsupported characters become "?". */
  split(s: string, bold: boolean): Seg[] {
    const segs: Seg[] = [];
    const push = (text: string, face: number): void => {
      const last = segs[segs.length - 1];
      if (last && last.face === face && last.bold === bold) last.text += text;
      else segs.push({ text, bold, face });
    };
    for (const ch of s.normalize("NFC")) {
      const cp = ch.codePointAt(0) as number;
      if (cp === 0xa0 || cp === 0x202f || cp === 0x2009) push(" ", 0);
      else if (cp < 0x20 || cp === 0x7f || (cp >= 0x200b && cp <= 0x200f) || cp === 0xfeff) push(cp === 9 || cp === 10 ? " " : "", 0);
      else if (cp === 0x20) push(" ", 0);
      else {
        let f = this.faceOf(cp);
        let out = ch;
        if (f < 0) {
          this.missing.add(cp);
          out = "?";
          f = 0;
        }
        // keep spaces and digits with the neighbouring face so runs do not fragment
        push(out, /[\s\d.,;:!?()-]/.test(out) && segs.length ? (segs[segs.length - 1] as Seg).face : f);
      }
    }
    return segs.filter((x) => x.text !== "");
  }

  /** Replace characters no face has (and control chars) so encoding never throws. */
  clean(s: string): string {
    return this.split(s, false)
      .map((x) => x.text)
      .join("");
  }

  font(bold: boolean, face = 0): PDFFont {
    const f = this.faces[face] as Face;
    return bold ? f.bold : f.regular;
  }

  width(text: string, size: number, bold = false, face = 0): number {
    return this.font(bold, face).widthOfTextAtSize(text, size);
  }

  /** Width of clean text made of several faces. */
  widthOf(segs: Seg[], size: number): number {
    return segs.reduce((n, s) => n + this.width(s.text, size, s.bold, s.face), 0);
  }

  /** Wrap inline runs to maxWidth. `baseBold` makes the whole text bold. */
  wrap(runs: InlineRun[], size: number, maxWidth: number, baseBold = false): Line[] {
    // Split into words; a word is a list of pieces (adjacent runs with no whitespace between).
    const words: Seg[][] = [];
    let cur: Seg[] = [];
    for (const run of runs) {
      const bold = baseBold || !!run.bold;
      for (const part of run.text.split(/(\s+)/)) {
        if (part === "") continue;
        if (/^\s+$/.test(part)) {
          if (cur.length) words.push(cur);
          cur = [];
        } else cur.push(...this.split(part, bold));
      }
    }
    if (cur.length) words.push(cur);

    const space = this.width(" ", size);
    const lines: Line[] = [];
    let line: Line = { segs: [], width: 0 };
    const pushSegs = (segs: Seg[], w: number) => {
      for (const s of segs) {
        const last = line.segs[line.segs.length - 1];
        if (last && last.bold === s.bold && last.face === s.face) last.text += s.text;
        else line.segs.push({ ...s });
      }
      line.width += w;
    };
    const endLine = () => {
      if (line.segs.length) lines.push(line);
      line = { segs: [], width: 0 };
    };

    for (const word of words) {
      let w = this.widthOf(word, size);
      if (w > maxWidth) {
        // Over-long token (URL): break it by characters.
        endLine();
        let piece: Seg[] = [];
        let pw = 0;
        for (const seg of word) {
          for (const ch of seg.text) {
            const cw = this.width(ch, size, seg.bold, seg.face);
            if (pw + cw > maxWidth && piece.length) {
              pushSegs(piece, pw);
              endLine();
              piece = [];
              pw = 0;
            }
            const last = piece[piece.length - 1];
            if (last && last.bold === seg.bold && last.face === seg.face) last.text += ch;
            else piece.push({ text: ch, bold: seg.bold, face: seg.face });
            pw += cw;
          }
        }
        pushSegs(piece, pw);
        continue;
      }
      const needed = line.segs.length ? space + w : w;
      if (line.segs.length && line.width + needed > maxWidth) {
        endLine();
        w = this.widthOf(word, size);
        pushSegs(word, w);
      } else {
        if (line.segs.length) pushSegs([{ text: " ", bold: baseBold, face: 0 }], space);
        pushSegs(word, w);
      }
    }
    endLine();
    return lines;
  }
}

/** Every character the document will print, to decide which font faces to embed. */
function collectText(guide: Guide, steps: Step[], opts: PdfExportOptions): string {
  const parts: string[] = [guide.title, guide.description ?? "", "Made with Showsteps", "STEPS ABOUT MINUTE 0123456789"];
  for (const s of steps) parts.push(s.title, s.description ?? "", stepUrl(guide, s) ?? "");
  void opts;
  return parts.join("\n");
}

async function embedFaces(doc: PDFDocument, fonts: PdfFonts, text: string): Promise<Face[]> {
  const cps = new Set<number>();
  for (const ch of text.normalize("NFC")) cps.add(ch.codePointAt(0) as number);
  const faces: Face[] = [];
  const all = [{ regular: fonts.regular, bold: fonts.bold }, ...(fonts.fallbacks ?? [])];
  for (let i = 0; i < all.length; i++) {
    const f = all[i] as { regular: Uint8Array; bold: Uint8Array };
    const probe = fontkit.create(f.regular) as unknown as { hasGlyphForCodePoint(cp: number): boolean };
    const covered = new Set<number>();
    for (const cp of cps) if (probe.hasGlyphForCodePoint(cp)) covered.add(cp);
    const usedBefore = new Set(faces.flatMap((x) => [...x.chars]));
    const needed = i === 0 || [...covered].some((cp) => !usedBefore.has(cp));
    if (!needed) continue;
    const regular = await doc.embedFont(f.regular, { subset: true });
    const bold = await doc.embedFont(f.bold, { subset: true });
    const bs = new Set(bold.getCharacterSet());
    // characters both weights have, so bold text never falls off a face; latin keeps its whole set
    faces.push({ regular, bold, chars: new Set(regular.getCharacterSet().filter((c) => bs.has(c))) });
  }
  return faces;
}

// ---------------------------------------------------------------------------------------------
// Highlight (vector)
// ---------------------------------------------------------------------------------------------

/**
 * Draw the Flag highlight (spotlight dim, keyline ring, numbered tab) over a screenshot placed with
 * its top-left at (ix, iyTop) in page points, `s` points per image pixel. Geometry comes from
 * `flagLayout`, the same numbers the pixel renderer uses.
 */
function drawFlag(page: PDFPage, hl: Rect, n: number, ix: number, iyTop: number, s: number, imgW: number, imgH: number, k: number, color: RGB, bold: PDFFont, rtl: boolean, corner?: TabCorner): void {
  const layout = flagLayout({ target: hl, n, scale: k, imageWidth: imgW, imageHeight: imgH, ...(rtl ? { rtl: true } : {}), ...(corner ? { corner } : {}) });
  const white = rgb(1, 1, 1);
  const dim = FLAG.spotlightDim;
  const dimColor = rgb(dim[0] / 255, dim[1] / 255, dim[2] / 255);
  const { x, y, w, h } = layout.ring;
  const bx0 = Math.max(0, x), by0 = Math.max(0, y), bx1 = Math.min(imgW, x + w), by1 = Math.min(imgH, y + h);
  const dimRect = (rx: number, ry: number, rw: number, rh: number): void => {
    if (rw > 0 && rh > 0) page.drawRectangle({ x: ix + rx * s, y: iyTop - (ry + rh) * s, width: rw * s, height: rh * s, color: dimColor, opacity: dim[3] });
  };
  // everything outside the ring's box (the rounded corners inside the box stay undimmed: invisible)
  dimRect(0, 0, imgW, by0);
  dimRect(0, by1, imgW, imgH - by1);
  dimRect(0, by0, bx0, by1 - by0);
  dimRect(bx1, by0, imgW - bx1, by1 - by0);

  // Path coordinates are image pixels; drawSvgPath scales them (and the stroke width) by `scale`.
  const base = { x: ix, y: iyTop, scale: s };
  const ring = flagRingPath(layout);
  const tab = flagTabPath(layout);
  page.drawSvgPath(ring, { ...base, borderColor: white, borderWidth: layout.sw + layout.halo * 2, borderOpacity: 0.96 });
  if (tab) page.drawSvgPath(tab, { ...base, color: white, opacity: 0.96, borderColor: white, borderWidth: layout.halo * 2, borderOpacity: 0.96 });
  page.drawSvgPath(ring, { ...base, borderColor: col(color), borderWidth: layout.sw });
  if (tab) page.drawSvgPath(tab, { ...base, color: col(color) });

  const c = flagTabCenter(layout);
  if (layout.tab && c) {
    const label = String(Math.max(0, Math.floor(n)));
    const size = layout.tab.fs * s;
    const lum = (0.2126 * color.r + 0.7152 * color.g + 0.0722 * color.b) / 255;
    const ink = lum > 0.45 ? rgb(26 / 255, 11 / 255, 5 / 255) : white;
    page.drawText(label, { x: ix + c.x * s - bold.widthOfTextAtSize(label, size) / 2, y: iyTop - c.y * s - size * 0.34, size, font: bold, color: ink });
  }
}

// ---------------------------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------------------------

export async function exportPdf(
  guide: Guide,
  images: Record<string, Uint8Array>,
  opts: PdfExportOptions = {},
): Promise<Uint8Array> {
  const [pageW, pageH] = PAGE_SIZES[opts.pageSize ?? "A4"];
  const contentW = pageW - 2 * MARGIN;
  const top = pageH - MARGIN;
  const bottom = MARGIN + 6;
  const contentH = top - bottom;
  const steps = activeSteps(guide);
  const highlightColor = parseColorRgb(guide.settings?.highlightColor);
  const drawHighlight = opts.highlight !== false;

  const doc = await PDFDocument.create({ updateMetadata: false });
  doc.registerFontkit(fontkit);
  const faces = await embedFaces(doc, opts.font ?? defaultPdfFonts(), collectText(guide, steps, opts));
  const ts = new Typesetter(faces);
  const bold = ts.bold;
  const fontSet = opts.font ?? defaultPdfFonts();
  const monoFont = await doc.embedFont(fontSet.mono ?? (defaultPdfFonts().mono as Uint8Array), { subset: true });
  const monoChars = new Set(monoFont.getCharacterSet());
  /** URL text the mono face can draw: anything else becomes "?"; ellipsised to `maxW`. */
  const monoFit = (text: string, size: number, maxW: number): string => {
    let t = [...text].map((c) => (monoChars.has(c.codePointAt(0) as number) ? c : "?")).join("");
    if (monoFont.widthOfTextAtSize(t, size) <= maxW) return t;
    while (t.length > 1 && monoFont.widthOfTextAtSize(t + "\u2026", size) > maxW) t = t.slice(0, -1);
    return t + "\u2026";
  };
  const { created, modified: updated } = documentDates(guide, opts);
  const title = stripInline(guide.title) || "Untitled guide";
  doc.setTitle(title);
  doc.setAuthor("Showsteps");
  doc.setCreator("Showsteps");
  doc.setProducer("Showsteps (pdf-lib)");
  if (guide.description) doc.setSubject(stripInline(guide.description));
  doc.setCreationDate(created);
  doc.setModificationDate(updated);

  // Page state ------------------------------------------------------------------------------
  const pages: PDFPage[] = [];
  let page!: PDFPage;
  let y = 0;
  const newPage = () => {
    page = doc.addPage([pageW, pageH]);
    pages.push(page);
    y = top;
  };
  const drawLines = (lines: Line[], x: number, size: number, leading: number, color: RGB) => {
    for (const line of lines) {
      let cx = x;
      y -= leading;
      for (const s of line.segs) {
        page.drawText(s.text, { x: cx, y: y + leading * 0.28, size, font: ts.font(s.bold, s.face), color: col(color) });
        cx += ts.width(s.text, size, s.bold, s.face);
      }
    }
  };
  /** Draws lines, breaking pages between lines when needed. */
  const flowLines = (lines: Line[], x: number, size: number, leading: number, color: RGB) => {
    for (const line of lines) {
      if (y - leading < bottom) newPage();
      drawLines([line], x, size, leading, color);
    }
  };

  // Title block: on page 1, above step 1 ------------------------------------------------------
  newPage();
  {
    // eyebrow: the brand's mini flag with the step count, then "N STEPS \u00b7 ABOUT M MINUTES" in mono, ink-3
    const count = String(steps.length);
    const fw = Math.max(16, monoFont.widthOfTextAtSize(count, 8) + 10);
    page.drawSvgPath(flagMarkerPath(fw, 15), { x: MARGIN, y: y - 2, color: col(ACCENT_STRONG) });
    page.drawText(count, { x: MARGIN + fw / 2 - bold.widthOfTextAtSize(count, 8) / 2, y: y - 12.2, size: 8, font: bold, color: rgb(1, 1, 1) });
    const minutes = Math.max(1, Math.ceil(steps.length / 3));
    page.drawText(`${steps.length === 1 ? "STEP" : "STEPS"} \u00b7 ABOUT ${minutes} ${minutes === 1 ? "MINUTE" : "MINUTES"}`, { x: MARGIN + fw + 8, y: y - 11.5, size: 8, font: monoFont, color: col(FAINT) });
    y -= 34;
  }
  flowLines(ts.wrap(parseInline(guide.title || "Untitled guide"), 26, contentW, true), MARGIN, 26, 31, INK);
  y -= 10;
  for (const b of parseBlocks(guide.description)) {
    const runs = parseInline(b.kind === "li" ? `\u2022 ${b.text}` : b.text);
    flowLines(ts.wrap(runs, 12, contentW), MARGIN, 12, 17.5, MUTED);
    y -= 5;
  }
  y -= 22;

  // Steps -----------------------------------------------------------------------------------
  const TEXT_X = MARGIN + 40;
  const TEXT_W = contentW - 40;
  const TITLE_SIZE = 15;
  const TITLE_LEAD = 20;
  const DESC_SIZE = 10.5;
  const DESC_LEAD = 15;
  const GAP = 12;
  const AFTER = 30;

  let n = 0;
  let lastUrl: string | undefined;
  for (const step of steps) {
    n++;
    const titleLines = ts.wrap(parseInline(step.title || "Untitled step"), TITLE_SIZE, TEXT_W);
    const url = stepUrl(guide, step);
    const urlText = url && url !== lastUrl ? monoFit(url, 8, TEXT_W) : undefined; // only when the page changes
    if (url) lastUrl = url;
    const descLines: { lines: Line[]; x: number }[] = parseBlocks(step.description).map((b) => ({
      lines: ts.wrap(parseInline(b.text), DESC_SIZE, b.kind === "li" ? TEXT_W - 14 : TEXT_W),
      x: b.kind === "li" ? TEXT_X + 14 : TEXT_X,
    }));
    const bullets = parseBlocks(step.description).map((b) => b.kind === "li");
    const descHeight = descLines.reduce((h, d) => h + d.lines.length * DESC_LEAD + 5, 0);
    const titleHeight = titleLines.length * TITLE_LEAD + (urlText ? 13 : 0);

    const img = loadImage(step, n, images, opts, highlightColor, drawHighlight);
    let embedded: PDFImage | undefined;
    let scale = 0;
    let imgW = 0;
    let imgH = 0;
    let descAfter = false;
    if (img) {
      embedded = img.prepared.format === "png" ? await doc.embedPng(img.prepared.bytes) : await doc.embedJpg(img.prepared.bytes);
      const fit = (maxH: number) => Math.min(contentW / img.prepared.width, maxH / img.prepared.height, 3);
      const maxH = Math.min(contentH * 0.66, contentH - titleHeight - descHeight - GAP);
      if (maxH < contentH * 0.3) {
        // Very long description: put the image straight under the title, text after it.
        descAfter = true;
        scale = fit(Math.min(contentH * 0.66, contentH - titleHeight - GAP));
      } else scale = fit(maxH);
      imgW = img.prepared.width * scale;
      imgH = img.prepared.height * scale;
    }

    const headerH = titleHeight + (descAfter ? 0 : descHeight);
    const blockH = headerH + (img ? GAP + imgH : 0);
    if (y !== top && y - blockH < bottom) newPage();

    // Marker (the brand's flag shape) + title + url
    const label = String(n);
    const ls = n > 99 ? 9.5 : 12.5;
    const mw = Math.max(26, ts.width(label, ls, true) + 14);
    const mh = 22;
    const cy = y - TITLE_LEAD / 2 - 1;
    page.drawSvgPath(flagMarkerPath(mw, mh), { x: MARGIN, y: cy + mh / 2, color: col(ACCENT_STRONG) });
    page.drawText(label, { x: MARGIN + mw / 2 - ts.width(label, ls, true) / 2, y: cy - ls * 0.34, size: ls, font: bold, color: rgb(1, 1, 1) });
    drawLines(titleLines, TEXT_X, TITLE_SIZE, TITLE_LEAD, INK);
    if (urlText) {
      y -= 12;
      page.drawText(urlText, { x: TEXT_X, y, size: 8, font: monoFont, color: col(FAINT) });
    }

    const drawDesc = (breakPages: boolean) => {
      y -= 3;
      let bi = 0;
      for (const d of descLines) {
        if (breakPages) flowLines(d.lines, d.x, DESC_SIZE, DESC_LEAD, MUTED);
        else drawLines(d.lines, d.x, DESC_SIZE, DESC_LEAD, MUTED);
        if (bullets[bi]) {
          // Bullet glyph sits left of the first line of the item.
          const first = y + (d.lines.length - 1) * DESC_LEAD + DESC_LEAD * 0.28;
          if (!breakPages) page.drawText("\u2022", { x: TEXT_X + 2, y: first, size: DESC_SIZE, font: ts.regular, color: col(MUTED) });
        }
        bi++;
        y -= 5;
      }
    };
    if (!descAfter && descLines.length) drawDesc(false);

    if (img && embedded) {
      y -= GAP;
      const ix = MARGIN + (contentW - imgW) / 2;
      const iyTop = y;
      const iyBottom = y - imgH;
      page.drawImage(embedded, { x: ix, y: iyBottom, width: imgW, height: imgH });
      const hl = img.prepared.highlight;
      if (hl) drawFlag(page, hl, n, ix, iyTop, scale, img.prepared.width, img.prepared.height, img.prepared.highlightScale ?? 1, highlightColor, bold, step.page.dir === "rtl", img.prepared.corner);
      page.drawRectangle({ x: ix, y: iyBottom, width: imgW, height: imgH, borderColor: col(HAIRLINE), borderWidth: 0.75 });
      y = iyBottom;
    }
    if (descAfter && descLines.length) {
      y -= GAP;
      drawDesc(true);
    }
    y -= AFTER;
  }

  // Footer on every page ----------------------------------------------------------------------
  const total = pages.length;
  pages.forEach((p, i) => {
    drawRun(p, ts, title.length > 60 ? `${title.slice(0, 59)}\u2026` : title, MARGIN, FOOTER_Y, 8.5, FAINT);
    const right = `${i + 1} / ${total}`;
    p.drawText(right, { x: pageW - MARGIN - ts.width(right, 8.5), y: FOOTER_Y, size: 8.5, font: ts.regular, color: col(FAINT) });
  });

  if (opts.branding === true) drawRun(pages[pages.length - 1] as PDFPage, ts, "Made with Showsteps", MARGIN + 0, FOOTER_Y + 14, 8, FAINT);
  if (ts.missing.size) {
    const list = [...ts.missing].slice(0, 8).map((cp) => `U+${cp.toString(16).toUpperCase().padStart(4, "0")}`).join(", ");
    opts.onWarning?.(`The PDF fonts have no glyph for ${ts.missing.size} character${ts.missing.size === 1 ? "" : "s"} (${list}${ts.missing.size > 8 ? ", ..." : ""}); they were replaced with "?".`);
  }
  return doc.save({ useObjectStreams: false });
}

function loadImage(step: Step, n: number, images: Record<string, Uint8Array>, opts: PdfExportOptions, highlightColor: RGB, highlight: boolean) {
  const key = step.screenshot?.image;
  const bytes = key ? images[key] : undefined;
  if (!step.screenshot || !bytes) {
    if (step.screenshot) opts.onWarning?.(`Screenshot ${key ?? ""} for step ${n} was not provided; that step has no image.`);
    return undefined;
  }
  const prepared = prepareStepImage(step, bytes, {
    highlight,
    highlightMode: "vector",
    n,
    color: `#${[highlightColor.r, highlightColor.g, highlightColor.b].map((v) => v.toString(16).padStart(2, "0")).join("")}`,
    redactionsBaked: opts.redactionsBaked,
    imagesPrerendered: opts.imagesPrerendered,
  });
  return { prepared };
}

/** Draw text made of several font faces starting at x. */
function drawRun(page: PDFPage, ts: Typesetter, text: string, x: number, y: number, size: number, color: RGB, bold = false): void {
  let cx = x;
  for (const s of ts.split(text, bold)) {
    page.drawText(s.text, { x: cx, y, size, font: ts.font(s.bold, s.face), color: col(color) });
    cx += ts.width(s.text, size, s.bold, s.face);
  }
}

/** The brand flag marker: rounded box with one small corner at the bottom left. */
function flagMarkerPath(w: number, h: number): string {
  const r = Math.min(7, h / 2), f = 2.4;
  return `M${r} 0H${w - r}A${r} ${r} 0 0 1 ${w} ${r}V${h - r}A${r} ${r} 0 0 1 ${w - r} ${h}H${f}A${f} ${f} 0 0 1 0 ${h - f}V${r}A${r} ${r} 0 0 1 ${r} 0Z`;
}

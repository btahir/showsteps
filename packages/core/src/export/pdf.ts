// PDF exporter (pdf-lib, MIT). Pure TS: runs in Node, browsers and extension workers.
//
// REDACTION CONTRACT. A PDF embeds the image bytes you give it, so a shape drawn on top does not
// remove what is underneath. This exporter therefore (1) bakes every `screenshot.redactions` rect
// into PNG pixels as an opaque block before embedding (and also draws an opaque vector block on
// top), and (2) throws for images it cannot rewrite (JPEG, interlaced PNG) unless the caller passes
// `redactionsBaked: true` to say the bytes were already redacted. A `crop` on a PNG is applied to
// the pixels too, so cropped-away content is not carried in the file. JPEG crops are ignored.
// The highlight ring is always drawn as vector shapes.

import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, PDFFont, PDFImage, PDFPage, rgb } from "pdf-lib";
import { SOURCE_SANS_3_BOLD_B64, SOURCE_SANS_3_REGULAR_B64 } from "../../assets/fonts/default-fonts";
import type { Guide, Rect, Step } from "../schema";
import {
  ACCENT_COLOR,
  REDACTION_COLOR,
  activeSteps,
  highlightGeometry,
  metaLine,
  parseBlocks,
  parseColor,
  parseInline,
  prepareStepImage,
  stepUrl,
  stripInline,
  type DocExportOptions,
  type InlineRun,
  type RGB,
} from "./doc-shared";

export interface PdfFonts {
  regular: Uint8Array;
  bold: Uint8Array;
}

export interface PdfExportOptions extends DocExportOptions {
  /** TTF/OTF/WOFF bytes for regular and bold. Default: Source Sans 3 (Latin subset, OFL). */
  font?: PdfFonts;
}

const PAGE_SIZES = { A4: [595.28, 841.89], Letter: [612, 792] } as const;
const MARGIN = 54;
const FOOTER_Y = 28;

const INK: RGB = { r: 0x1c, g: 0x1c, b: 0x22 };
const MUTED: RGB = { r: 0x5f, g: 0x63, b: 0x6e };
const FAINT: RGB = { r: 0x9a, g: 0x9d, b: 0xa6 };
const HAIRLINE: RGB = { r: 0xd9, g: 0xdb, b: 0xe1 };

const col = (c: RGB) => rgb(c.r / 255, c.g / 255, c.b / 255);

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function defaultPdfFonts(): PdfFonts {
  return { regular: b64ToBytes(SOURCE_SANS_3_REGULAR_B64), bold: b64ToBytes(SOURCE_SANS_3_BOLD_B64) };
}

// ---------------------------------------------------------------------------------------------
// Text layout
// ---------------------------------------------------------------------------------------------

interface Seg {
  text: string;
  bold: boolean;
}
interface Line {
  segs: Seg[];
  width: number;
}

class Typesetter {
  private readonly supported: Set<number>;
  constructor(
    readonly regular: PDFFont,
    readonly bold: PDFFont,
  ) {
    const bs = new Set(bold.getCharacterSet());
    this.supported = new Set(regular.getCharacterSet().filter((c) => bs.has(c)));
  }

  /** Replace characters the fonts lack (and control chars) so encoding never throws. */
  clean(s: string): string {
    let out = "";
    for (const ch of s.normalize("NFC")) {
      const cp = ch.codePointAt(0) as number;
      if (cp === 0xa0 || cp === 0x202f || cp === 0x2009) out += " ";
      else if (cp < 0x20 || cp === 0x7f || (cp >= 0x200b && cp <= 0x200f) || cp === 0xfeff) out += cp === 9 || cp === 10 ? " " : "";
      else out += this.supported.has(cp) ? ch : "?";
    }
    return out;
  }

  font(bold: boolean): PDFFont {
    return bold ? this.bold : this.regular;
  }

  width(text: string, size: number, bold = false): number {
    return this.font(bold).widthOfTextAtSize(text, size);
  }

  /** Wrap inline runs to maxWidth. `baseBold` makes the whole text bold. */
  wrap(runs: InlineRun[], size: number, maxWidth: number, baseBold = false): Line[] {
    // Split into words; a word is a list of pieces (adjacent runs with no whitespace between).
    const words: Seg[][] = [];
    let cur: Seg[] = [];
    for (const run of runs) {
      const bold = baseBold || !!run.bold;
      for (const part of this.clean(run.text).split(/(\s+)/)) {
        if (part === "") continue;
        if (/^\s+$/.test(part)) {
          if (cur.length) words.push(cur);
          cur = [];
        } else cur.push({ text: part, bold });
      }
    }
    if (cur.length) words.push(cur);

    const space = this.width(" ", size);
    const lines: Line[] = [];
    let line: Line = { segs: [], width: 0 };
    const pushSegs = (segs: Seg[], w: number) => {
      for (const s of segs) {
        const last = line.segs[line.segs.length - 1];
        if (last && last.bold === s.bold) last.text += s.text;
        else line.segs.push({ ...s });
      }
      line.width += w;
    };
    const wordWidth = (w: Seg[]) => w.reduce((n, s) => n + this.width(s.text, size, s.bold), 0);
    const endLine = () => {
      if (line.segs.length) lines.push(line);
      line = { segs: [], width: 0 };
    };

    for (const word of words) {
      let w = wordWidth(word);
      if (w > maxWidth) {
        // Over-long token (URL): break it by characters.
        endLine();
        let piece: Seg[] = [];
        let pw = 0;
        for (const seg of word) {
          for (const ch of seg.text) {
            const cw = this.width(ch, size, seg.bold);
            if (pw + cw > maxWidth && piece.length) {
              pushSegs(piece, pw);
              endLine();
              piece = [];
              pw = 0;
            }
            const last = piece[piece.length - 1];
            if (last && last.bold === seg.bold) last.text += ch;
            else piece.push({ text: ch, bold: seg.bold });
            pw += cw;
          }
        }
        pushSegs(piece, pw);
        continue;
      }
      const needed = line.segs.length ? space + w : w;
      if (line.segs.length && line.width + needed > maxWidth) {
        endLine();
        w = wordWidth(word);
        pushSegs(word, w);
      } else {
        if (line.segs.length) pushSegs([{ text: " ", bold: baseBold }], space);
        pushSegs(word, w);
      }
    }
    endLine();
    return lines;
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
  const highlightColor = parseColor(guide.settings?.highlightColor);
  const drawHighlight = opts.highlight !== false;

  const doc = await PDFDocument.create({ updateMetadata: false });
  doc.registerFontkit(fontkit);
  const fontBytes = opts.font ?? defaultPdfFonts();
  const regular = await doc.embedFont(fontBytes.regular, { subset: true });
  const bold = await doc.embedFont(fontBytes.bold, { subset: true });
  const ts = new Typesetter(regular, bold);

  const created = new Date(guide.createdAt);
  const updated = new Date(guide.updatedAt);
  const title = stripInline(guide.title) || "Untitled guide";
  doc.setTitle(title);
  doc.setAuthor("Showsteps");
  doc.setCreator("Showsteps");
  doc.setProducer("Showsteps (pdf-lib)");
  if (guide.description) doc.setSubject(stripInline(guide.description));
  if (!Number.isNaN(created.getTime())) doc.setCreationDate(created);
  if (!Number.isNaN(updated.getTime())) doc.setModificationDate(updated);

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
        page.drawText(s.text, { x: cx, y: y + leading * 0.28, size, font: ts.font(s.bold), color: col(color) });
        cx += ts.width(s.text, size, s.bold);
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

  // Cover -----------------------------------------------------------------------------------
  newPage();
  y = top - contentH * 0.22;
  page.drawRectangle({ x: MARGIN, y: y, width: 56, height: 5, color: col(ACCENT_COLOR) });
  y -= 30;
  flowLines(ts.wrap(parseInline(guide.title || "Untitled guide"), 32, contentW, true), MARGIN, 32, 38, INK);
  y -= 14;
  for (const b of parseBlocks(guide.description)) {
    const runs = parseInline(b.kind === "li" ? `• ${b.text}` : b.text);
    flowLines(ts.wrap(runs, 13, contentW), MARGIN, 13, 19, MUTED);
    y -= 6;
  }
  y -= 10;
  flowLines(ts.wrap([{ text: metaLine(guide, steps.length) }], 11, contentW, true), MARGIN, 11, 16, ACCENT_COLOR);
  if (opts.branding !== false) {
    page.drawText(ts.clean("Made with Showsteps"), { x: MARGIN, y: MARGIN, size: 9, font: regular, color: col(FAINT) });
  }

  // Steps -----------------------------------------------------------------------------------
  const TEXT_X = MARGIN + 40;
  const TEXT_W = contentW - 40;
  const TITLE_SIZE = 15;
  const TITLE_LEAD = 20;
  const DESC_SIZE = 10.5;
  const DESC_LEAD = 15;
  const GAP = 12;
  const AFTER = 30;

  if (steps.length) newPage(); // steps start on their own page after the cover
  let n = 0;
  for (const step of steps) {
    n++;
    const titleLines = ts.wrap(parseInline(step.title || "Untitled step"), TITLE_SIZE, TEXT_W);
    const url = stepUrl(guide, step);
    const urlLines = url ? ts.wrap([{ text: url }], 8.5, TEXT_W).slice(0, 1) : [];
    const descLines: { lines: Line[]; x: number }[] = parseBlocks(step.description).map((b) => ({
      lines: ts.wrap(parseInline(b.text), DESC_SIZE, b.kind === "li" ? TEXT_W - 14 : TEXT_W),
      x: b.kind === "li" ? TEXT_X + 14 : TEXT_X,
    }));
    const bullets = parseBlocks(step.description).map((b) => b.kind === "li");
    const descHeight = descLines.reduce((h, d) => h + d.lines.length * DESC_LEAD + 5, 0);
    const titleHeight = titleLines.length * TITLE_LEAD + urlLines.length * 12;

    const img = loadImage(step, images, opts, highlightColor, drawHighlight);
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

    // Marker + title + url
    const r = 13;
    const cy = y - TITLE_LEAD / 2 - 1;
    page.drawCircle({ x: MARGIN + r, y: cy, size: r, color: col(ACCENT_COLOR) });
    const label = String(n);
    const ls = n > 99 ? 9.5 : 12.5;
    page.drawText(label, { x: MARGIN + r - ts.width(label, ls, true) / 2, y: cy - ls * 0.34, size: ls, font: bold, color: rgb(1, 1, 1) });
    drawLines(titleLines, TEXT_X, TITLE_SIZE, TITLE_LEAD, INK);
    if (urlLines.length) {
      y -= 2;
      drawLines(urlLines, TEXT_X, 8.5, 10, FAINT);
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
          if (!breakPages) page.drawText(ts.clean("•"), { x: TEXT_X + 2, y: first, size: DESC_SIZE, font: regular, color: col(MUTED) });
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
      // Opaque redaction blocks (vector), then the highlight ring.
      for (const rd of img.prepared.redactions) {
        const p = toPage(rd, ix, iyTop, scale);
        page.drawRectangle({ x: p.x, y: p.y - p.h, width: p.w, height: p.h, color: col(REDACTION_COLOR) });
      }
      const hl = img.prepared.highlight;
      if (hl) drawRing(page, hl, ix, iyTop, scale, img.prepared.width, highlightColor);
      page.drawRectangle({ x: ix, y: iyBottom, width: imgW, height: imgH, borderColor: col(HAIRLINE), borderWidth: 0.75 });
      y = iyBottom;
    } else if (step.screenshot && !img) {
      y -= GAP - 2;
      drawLines(ts.wrap([{ text: "Screenshot unavailable" }], 9, TEXT_W), TEXT_X, 9, 12, FAINT);
    }
    if (descAfter && descLines.length) {
      y -= GAP;
      drawDesc(true);
    }
    y -= AFTER;
  }

  // Footer on every page but the cover -------------------------------------------------------
  const total = pages.length;
  pages.forEach((p, i) => {
    if (i === 0) return;
    const left = ts.clean(title.length > 60 ? `${title.slice(0, 59)}…` : title);
    p.drawText(left, { x: MARGIN, y: FOOTER_Y, size: 8.5, font: regular, color: col(FAINT) });
    const right = `${i + 1} / ${total}`;
    p.drawText(right, { x: pageW - MARGIN - ts.width(right, 8.5), y: FOOTER_Y, size: 8.5, font: regular, color: col(FAINT) });
  });

  return doc.save({ useObjectStreams: false });
}

function loadImage(
  step: Step,
  images: Record<string, Uint8Array>,
  opts: PdfExportOptions,
  highlightColor: RGB,
  highlight: boolean,
) {
  const key = step.screenshot?.image;
  const bytes = key ? images[key] : undefined;
  if (!step.screenshot || !bytes) return undefined;
  const prepared = prepareStepImage(step, bytes, {
    highlight,
    bakeHighlight: false,
    redactionsBaked: opts.redactionsBaked,
    highlightColor,
  });
  return { prepared };
}

/** Image-pixel rect to page coordinates: returns top-left x,y (page space) and size in points. */
function toPage(r: Rect, ix: number, iyTop: number, s: number) {
  return { x: ix + r.x * s, y: iyTop - r.y * s, w: r.width * s, h: r.height * s };
}

function drawRing(page: PDFPage, r: Rect, ix: number, iyTop: number, s: number, imgPxW: number, color: RGB) {
  const g = highlightGeometry(imgPxW);
  const p = toPage(r, ix, iyTop, s);
  const pad = g.pad * s;
  const x = p.x - pad;
  const y = p.y + pad; // top edge in page space (y grows up)
  const w = p.w + 2 * pad;
  const h = p.h + 2 * pad;
  const rad = Math.max(1, Math.min(g.radius * s, w / 2, h / 2));
  // SVG path with origin at (x, y): svg y grows downward from the top edge.
  const d =
    `M ${rad} 0 H ${w - rad} A ${rad} ${rad} 0 0 1 ${w} ${rad} V ${h - rad} A ${rad} ${rad} 0 0 1 ${w - rad} ${h} ` +
    `H ${rad} A ${rad} ${rad} 0 0 1 0 ${h - rad} V ${rad} A ${rad} ${rad} 0 0 1 ${rad} 0 Z`;
  page.drawSvgPath(d, {
    x,
    y,
    color: col(color),
    opacity: 0.12,
    borderColor: col(color),
    borderWidth: Math.min(3.5, Math.max(1.5, g.thickness * s)),
    borderOpacity: 1,
  });
}

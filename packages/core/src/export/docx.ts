// DOCX exporter (`docx`, MIT). Pure TS: runs in Node, browsers and extension workers.
//
// Word has no vector overlay we can rely on, so for PNG screenshots the exporter rewrites the
// pixels: redaction blocks and the highlight ring are baked into the embedded image, and a `crop`
// is applied. Redactions follow the same contract as the PDF exporter (see pdf.ts): unbaked
// redactions on an image we cannot rewrite (JPEG, interlaced PNG) throw unless the caller passes
// `redactionsBaked: true`. JPEG screenshots get no highlight ring and no crop.

import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  HeadingLevel,
  ImageRun,
  LevelFormat,
  Packer,
  PageNumber,
  Paragraph,
  TextRun,
} from "docx";
import type { Guide, Step } from "../schema";
import {
  ACCENT_COLOR,
  activeSteps,
  metaLine,
  parseBlocks,
  parseColor,
  parseInline,
  prepareStepImage,
  stepUrl,
  stripInline,
  toHex,
  type DocExportOptions,
} from "./doc-shared";

export type DocxExportOptions = DocExportOptions;

// Page geometry in twips (1/20 pt).
const PAGES = { A4: { width: 11906, height: 16838 }, Letter: { width: 12240, height: 15840 } } as const;
const MARGIN = 1080; // 0.75 in
const px = (twips: number) => Math.round((twips / 20) * (96 / 72)); // twips -> CSS px (docx sizes images in px @96dpi)

const INK = "1C1C22";
const MUTED = "5F636E";
const FAINT = "9A9DA6";
const ACCENT = toHex(ACCENT_COLOR);
const FONT = "Calibri";

function runs(md: string, extra: { size?: number; color?: string } = {}): TextRun[] {
  return parseInline(md).map((r) => new TextRun({ text: r.text, bold: r.bold, ...extra }));
}

export async function exportDocx(
  guide: Guide,
  images: Record<string, Uint8Array>,
  opts: DocxExportOptions = {},
): Promise<Uint8Array> {
  const page = PAGES[opts.pageSize ?? "A4"];
  const contentWpx = px(page.width - 2 * MARGIN);
  const maxHpx = Math.round(px(page.height - 2 * MARGIN) * 0.78);
  const steps = activeSteps(guide);
  const highlightColor = parseColor(guide.settings?.highlightColor);
  const title = stripInline(guide.title) || "Untitled guide";

  const body: Paragraph[] = [];

  // Title block -----------------------------------------------------------------------------
  body.push(new Paragraph({ heading: HeadingLevel.TITLE, children: runs(guide.title || "Untitled guide") }));
  for (const b of parseBlocks(guide.description)) {
    body.push(
      new Paragraph({
        children: runs(b.text, { color: MUTED }),
        spacing: { after: 120 },
        ...(b.kind === "li" ? { numbering: { reference: "bullets", level: 0 } } : {}),
      }),
    );
  }
  body.push(
    new Paragraph({
      children: [
        new TextRun({ text: metaLine(guide, steps.length), bold: true, color: ACCENT, size: 20 }),
        ...(opts.branding !== false ? [new TextRun({ text: "   ·   Made with Showsteps", color: FAINT, size: 18 })] : []),
      ],
      spacing: { before: 60, after: 360 },
      border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: "D9DBE1", space: 10 } },
    }),
  );

  // Steps -----------------------------------------------------------------------------------
  let n = 0;
  for (const step of steps) {
    n++;
    body.push(...stepParagraphs(guide, step, n, images, opts, { contentWpx, maxHpx, highlightColor }));
  }

  const doc = new Document({
    creator: "Showsteps",
    title,
    description: guide.description ? stripInline(guide.description) : undefined,
    styles: {
      default: {
        document: { run: { font: FONT, size: 22, color: INK } },
        title: { run: { font: FONT, size: 60, bold: true, color: INK }, paragraph: { spacing: { after: 160 } } },
        heading2: {
          run: { font: FONT, size: 30, bold: false, color: INK },
          paragraph: { spacing: { before: 420, after: 120 }, keepNext: true, keepLines: true },
        },
      },
    },
    numbering: {
      config: [
        {
          reference: "steps",
          levels: [
            {
              level: 0,
              format: LevelFormat.DECIMAL,
              text: "%1.",
              alignment: AlignmentType.LEFT,
              style: {
                paragraph: { indent: { left: 567, hanging: 567 } },
                run: { bold: true, color: ACCENT },
              },
            },
          ],
        },
        {
          reference: "bullets",
          levels: [
            {
              level: 0,
              format: LevelFormat.BULLET,
              text: "•",
              alignment: AlignmentType.LEFT,
              style: { paragraph: { indent: { left: 567 + 284, hanging: 284 } } },
            },
          ],
        },
      ],
    },
    sections: [
      {
        properties: { page: { size: { width: page.width, height: page.height }, margin: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN } } },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                alignment: AlignmentType.RIGHT,
                children: [
                  new TextRun({ text: `${title}   ·   `, color: FAINT, size: 16 }),
                  new TextRun({ children: [PageNumber.CURRENT], color: FAINT, size: 16 }),
                ],
              }),
            ],
          }),
        },
        children: body,
      },
    ],
  });

  return new Uint8Array(await Packer.toArrayBuffer(doc));
}

function stepParagraphs(
  guide: Guide,
  step: Step,
  n: number,
  images: Record<string, Uint8Array>,
  opts: DocxExportOptions,
  g: { contentWpx: number; maxHpx: number; highlightColor: ReturnType<typeof parseColor> },
): Paragraph[] {
  const out: Paragraph[] = [];
  const plainTitle = stripInline(step.title) || `Step ${n}`;
  const key = step.screenshot?.image;
  const bytes = key ? images[key] : undefined;
  const hasImage = !!(step.screenshot && bytes);
  const url = stepUrl(guide, step);
  const blocks = parseBlocks(step.description);

  // Heading, URL and description keep with the next paragraph so the title never strands
  // away from its screenshot.
  out.push(
    new Paragraph({
      heading: HeadingLevel.HEADING_2,
      numbering: { reference: "steps", level: 0 },
      keepNext: true,
      children: runs(step.title || `Step ${n}`),
    }),
  );
  if (url) {
    out.push(
      new Paragraph({
        keepNext: hasImage || blocks.length > 0,
        indent: { left: 567 },
        spacing: { after: 80 },
        children: [new TextRun({ text: url, color: FAINT, size: 17 })],
      }),
    );
  }
  blocks.forEach((b, i) => {
    out.push(
      new Paragraph({
        keepNext: hasImage && i === blocks.length - 1,
        spacing: { after: 100 },
        ...(b.kind === "li"
          ? { numbering: { reference: "bullets", level: 0 } }
          : { indent: { left: 567 } }),
        children: runs(b.text, { color: MUTED, size: 21 }),
      }),
    );
  });

  if (hasImage && bytes) {
    const prepared = prepareStepImage(step, bytes, {
      highlight: opts.highlight !== false,
      bakeHighlight: true,
      redactionsBaked: opts.redactionsBaked,
      highlightColor: g.highlightColor,
    });
    // Fit to the page width (and a height cap); never enlarge more than 3x.
    const scale = Math.min(g.contentWpx / prepared.width, g.maxHpx / prepared.height, 3);
    const width = Math.max(1, Math.round(prepared.width * scale));
    const height = Math.max(1, Math.round((width * prepared.height) / prepared.width));
    out.push(
      new Paragraph({
        keepLines: true,
        spacing: { before: 60, after: 120 },
        children: [
          new ImageRun({
            type: prepared.format,
            data: prepared.bytes,
            transformation: { width, height },
            altText: { name: `Step ${n} screenshot`, title: plainTitle, description: plainTitle },
          }),
        ],
      }),
    );
  } else if (step.screenshot) {
    out.push(new Paragraph({ children: [new TextRun({ text: "Screenshot unavailable", italics: true, color: FAINT, size: 18 })] }));
  }
  return out;
}

import { PDFArray, PDFDict, PDFName, PDFDocument, PDFRawStream, PDFRef, decodePDFRawStream } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { decodePng, encodePng, parseInline, type Raster } from "../src/export/doc-shared";
import { MAGENTA, SECRET, makeGuide, makePng, makeStep } from "./doc-fixtures";
import { exportPdf } from "../src/export/pdf";
import type { Guide } from "../src/schema";

// ---- PDF inspection helpers -------------------------------------------------------------------

async function inspect(bytes: Uint8Array) {
  const doc = await PDFDocument.load(bytes);
  const ctx = doc.context;
  const streamText = (s: PDFRawStream) => Buffer.from(decodePDFRawStream(s).decode()).toString("latin1");
  const stream = (o: unknown) => ctx.lookup(o as PDFRef) as PDFRawStream;

  function parseToUnicode(cmap: string): Map<number, string> {
    const m = new Map<number, string>();
    const u = (hex: string) => Buffer.from(hex, "hex").swap16().toString("utf16le");
    for (const blk of cmap.matchAll(/beginbfchar([^]*?)endbfchar/g))
      for (const l of (blk[1] as string).matchAll(/<([0-9a-f]+)>\s*<([0-9a-f]+)>/gi)) m.set(parseInt(l[1]!, 16), u(l[2]!));
    for (const blk of cmap.matchAll(/beginbfrange([^]*?)endbfrange/g))
      for (const l of (blk[1] as string).matchAll(/<([0-9a-f]+)>\s*<([0-9a-f]+)>\s*<([0-9a-f]+)>/gi)) {
        const [a, b] = [parseInt(l[1]!, 16), parseInt(l[2]!, 16)];
        const base = u(l[3]!).codePointAt(0)!;
        for (let g = a; g <= b; g++) m.set(g, String.fromCodePoint(base + g - a));
      }
    return m;
  }

  const pages = doc.getPages().map((page) => {
    const res = page.node.Resources()!;
    const fonts = res.lookup(PDFName.of("Font"), PDFDict);
    const maps = new Map<string, Map<number, string>>();
    for (const key of fonts.keys()) {
      const f = fonts.lookup(key, PDFDict);
      const tu = f.get(PDFName.of("ToUnicode"));
      if (tu) maps.set(key.decodeText(), parseToUnicode(streamText(stream(tu))));
    }
    const contents = page.node.Contents();
    const parts = contents instanceof PDFArray ? contents.asArray().map((r) => stream(r)) : [stream(contents)];
    const content = parts.map(streamText).join("\n");
    // Walk text ops: "/F0 12 Tf" selects a font; "... y Tm" positions; "<hex> Tj" shows glyphs.
    // A new line of text starts whenever the Tm y coordinate changes.
    let font = "";
    let text = "";
    let lastY = "";
    const NUM = "[\\d.\\-]+";
    const re = new RegExp(`\\/(\\S+)\\s+[\\d.]+\\s+Tf|(?:${NUM}\\s+){5}(${NUM})\\s+Tm|<([0-9a-f]+)>\\s*Tj`, "gi");
    for (const m of content.matchAll(re)) {
      if (m[1]) font = m[1];
      else if (m[2] !== undefined) {
        if (m[2] !== lastY && text && !text.endsWith("\n")) text += "\n";
        lastY = m[2];
      } else {
        const map = maps.get(font);
        const hex = m[3] as string;
        for (let i = 0; i < hex.length; i += 4) text += map?.get(parseInt(hex.slice(i, i + 4), 16)) ?? "\uFFFD";
      }
    }
    return { content, text, images: (content.match(/\bDo\b/g) ?? []).length };
  });

  // Decoded pixel data of every image XObject (RGB planes only, not alpha masks).
  const imagePixels: { width: number; height: number; data: Uint8Array }[] = [];
  for (const [, obj] of ctx.enumerateIndirectObjects()) {
    if (obj instanceof PDFRawStream && obj.dict.get(PDFName.of("Subtype")) === PDFName.of("Image")) {
      const cs = obj.dict.get(PDFName.of("ColorSpace"));
      if (cs !== PDFName.of("DeviceRGB")) continue;
      imagePixels.push({
        width: Number(obj.dict.lookup(PDFName.of("Width"))!.toString()),
        height: Number(obj.dict.lookup(PDFName.of("Height"))!.toString()),
        data: decodePDFRawStream(obj).decode(),
      });
    }
  }
  // Every stream, decoded, as latin1 text (for "is this string anywhere in the file" checks).
  const allStreams: string[] = [];
  for (const [, obj] of ctx.enumerateIndirectObjects()) if (obj instanceof PDFRawStream) {
    try { allStreams.push(streamText(obj)); } catch { /* binary */ }
  }
  return { doc, pages, imagePixels, allStreams };
}

const hasPixel = (img: { data: Uint8Array }, rgb: [number, number, number]) => {
  for (let i = 0; i + 2 < img.data.length; i += 3)
    if (img.data[i] === rgb[0] && img.data[i + 1] === rgb[1] && img.data[i + 2] === rgb[2]) return true;
  return false;
};

// ---- tests ------------------------------------------------------------------------------------

describe("exportPdf", () => {
  it("produces a valid PDF with metadata, cover and one block per active step", async () => {
    const { guide, images } = makeGuide();
    const bytes = await exportPdf(guide, images);
    expect(Buffer.from(bytes.subarray(0, 5)).toString()).toBe("%PDF-");
    const { doc, pages, imagePixels } = await inspect(bytes);
    expect(doc.getTitle()).toBe("Change your billing settings");
    expect(doc.getAuthor()).toBe("Showsteps");
    expect(doc.getCreationDate()?.toISOString()).toBe("2026-09-28T09:00:00.000Z");
    expect(pages.length).toBeGreaterThanOrEqual(2);
    const cover = pages[0]!.text;
    expect(cover).toContain("Change your billing settings");
    expect(cover).toContain("A four step walkthrough for admins.");
    expect(cover).toContain("4 steps");
    expect(cover).toContain("28 Sep 2026");
    const body = pages.slice(1).map((p) => p.text).join("\n");
    for (const t of ["Go to Settings – Acme", "Click Save", "Type in Password", "Press Enter"]) expect(body).toContain(t);
    expect(body).toContain("Saving applies the change immediately.");
    expect(body).toContain("Everyone on the team sees it");
    expect(body).toContain("https://app.example.com/page/2");
    expect(body).not.toContain("SKIPPED STEP TITLE");
    // Steps are numbered 1..4, skipped step omitted, 4 screenshots embedded.
    for (const n of ["1", "2", "3", "4"]) expect(body.split("\n")).toContain(n);
    expect(body.split("\n")).not.toContain("5");
    expect(imagePixels).toHaveLength(4);
  });

  it("supports Letter and omits the highlight ring when highlight is false", async () => {
    const { guide, images } = makeGuide();
    const a4 = await exportPdf(guide, images);
    const letter = await exportPdf(guide, images, { pageSize: "Letter" });
    const plain = await exportPdf(guide, images, { highlight: false });
    const size = async (b: Uint8Array) => (await PDFDocument.load(b)).getPage(0).getSize();
    expect((await size(a4)).width).toBeCloseTo(595.28, 1);
    expect(await size(letter)).toEqual({ width: 612, height: 792 });
    expect(plain.length).toBeLessThan(a4.length);
  });

  it("keeps redacted values out of the file: no text, and the pixels underneath are gone", async () => {
    const { guide, images } = makeGuide();
    const bytes = await exportPdf(guide, images);
    const raw = Buffer.from(bytes).toString("latin1");
    const { pages, allStreams, imagePixels } = await inspect(bytes);
    // 1. The (masked) secret in step.action.value never reaches the output, raw or decoded.
    expect(raw).not.toContain(SECRET);
    expect(allStreams.join("\n")).not.toContain(SECRET);
    expect(pages.map((p) => p.text).join("\n")).not.toContain(SECRET);
    // 2. The sensitive pixels (magenta) are not in any embedded image: they were baked out.
    expect(imagePixels).toHaveLength(4);
    expect(imagePixels.some((img) => hasPixel(img, MAGENTA))).toBe(false);
    // ...and the source image really did contain them.
    expect(hasPixel({ data: decodePng(images["images/s_3.png"]!)!.data.filter((_, i) => i % 4 !== 3) }, MAGENTA)).toBe(true);
    // 3. The redacted region is a solid dark block in the embedded image and drawn opaque on top.
    const shot = imagePixels.find((img) => img.width === 160 && hasPixel(img, [0x1a, 0x1a, 0x1a]))!;
    const at = (x: number, y: number) => Array.from(shot.data.subarray((y * 160 + x) * 3, (y * 160 + x) * 3 + 3));
    expect(at(50, 60)).toEqual([0x1a, 0x1a, 0x1a]);
    // Vector block: solid fill (no ExtGState/opacity) of 0x1a grey after the image draw.
    const dark = pages.some((p) => /\bDo\b[^]*?0\.101\d*\s+0\.101\d*\s+0\.101\d*\s+rg[^]*?\bh\s+f\b/.test(p.content));
    expect(dark).toBe(true);
  });

  it("refuses to embed unredactable images with redactions unless the caller baked them", async () => {
    const { guide, images } = makeGuide();
    const jpeg = jpegStub(160, 100);
    const withJpeg = { ...images, "images/s_3.jpg": jpeg };
    const g: Guide = structuredClone(guide);
    g.steps[2]!.screenshot!.image = "images/s_3.jpg";
    await expect(exportPdf(g, withJpeg)).rejects.toThrow(/redactions/);
    // Baked by the caller: allowed.
    await expect(exportPdf(g, withJpeg, { redactionsBaked: true })).resolves.toBeInstanceOf(Uint8Array);
  });

  it("never separates a step title from its screenshot across pages", async () => {
    const { guide, images } = makeGuide();
    // 14 steps with tall screenshots and descriptions of varying length forces many page breaks.
    guide.steps = [];
    for (let i = 1; i <= 14; i++) {
      guide.steps.push(
        makeStep(i, { description: i % 3 === 0 ? "Some detail about this step. ".repeat(12 * (i % 4 || 1)) : undefined }, 900, 620),
      );
      images[`images/s_${i}.png`] = makePng(900, 620, (x, y) => [(x / 4) & 255, (y / 3) & 255, 90]);
    }
    const { pages } = await inspect(await exportPdf(guide, images));
    expect(pages.length).toBeGreaterThan(4);
    let titles = 0;
    for (const p of pages.slice(1)) {
      const onPage = (p.text.match(/^Click Item \d+$/gm) ?? []).length;
      titles += onPage;
      expect(p.images).toBe(onPage); // every title on a page has its image on that same page
      expect(p.images).toBeGreaterThan(0);
    }
    expect(titles).toBe(14);
  });

  it("handles notes without screenshots, missing images, unsupported glyphs and empty guides", async () => {
    const { guide } = makeGuide();
    const images: Record<string, Uint8Array> = { "images/s_3.png": makePng(160, 100, () => [9, 9, 9]) };
    guide.steps = [
      makeStep(1, { action: { type: "note" }, title: "Read this note first", screenshot: undefined }),
      makeStep(2, { title: "Click **Missing**" }), // image bytes absent
      makeStep(3, { title: "Click **日本語 ok**" }), // renders as ??? (default font is Latin)
    ];
    const { pages } = await inspect(await exportPdf(guide, images));
    const body = pages.slice(1).map((p) => p.text).join("\n");
    expect(body).toContain("Read this note first");
    expect(body).toContain("Screenshot unavailable");
    expect(body).toContain("Click ??? ok");
    guide.steps = [];
    const empty = await inspect(await exportPdf(guide, images));
    expect(empty.pages).toHaveLength(1);
    expect(empty.pages[0]!.text).toContain("0 steps");
  });

  it("accepts a custom font parameter", async () => {
    const { defaultPdfFonts } = await import("../src/export/pdf");
    const { guide, images } = makeGuide();
    const f = defaultPdfFonts();
    const bytes = await exportPdf(guide, images, { font: { regular: f.bold, bold: f.regular } });
    expect((await PDFDocument.load(bytes)).getPageCount()).toBeGreaterThan(1);
  });
});

describe("doc-shared", () => {
  it("round-trips PNG pixels", () => {
    const r: Raster = { width: 3, height: 2, data: Uint8Array.from({ length: 24 }, (_, i) => (i * 37) & 255) };
    const back = decodePng(encodePng(r))!;
    expect(back.width).toBe(3);
    expect(Array.from(back.data)).toEqual(Array.from(r.data));
  });

  it("parses inline Markdown", () => {
    expect(parseInline('Type "a" in **Email** or [link](http://x) `code` *it*')).toEqual([
      { text: 'Type "a" in ' },
      { text: "Email", bold: true },
      { text: " or link code it" },
    ]);
  });
});

/** Minimal bytes that sniff as a JPEG of the given size (not decodable; enough to hit guards). */
function jpegStub(w: number, h: number): Uint8Array {
  return Uint8Array.from([0xff, 0xd8, 0xff, 0xc0, 0, 17, 8, h >> 8, h & 255, w >> 8, w & 255, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1, 0xff, 0xd9]);
}

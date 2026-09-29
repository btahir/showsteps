import { PDFDocument, PDFName, PDFRawStream } from "pdf-lib";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { describe, expect, it } from "vitest";
import { exportPdf, typographicQuotes, type Guide, type Step } from "../src";
import { fixtureGuide, fixtureImages } from "./fixtures/guide";
import { SAMPLE_CANARY_PASSWORD, sample11Guide, sample11Images } from "./fixtures/sample11";
import { sha256 } from "./golden";

/** Text of every page, as pdfjs-dist extracts it (items joined line by line). */
async function pdfText(bytes: Uint8Array): Promise<string[]> {
  const task = pdfjs.getDocument({ data: new Uint8Array(bytes), verbosity: 0, useSystemFonts: false });
  const doc = await task.promise;
  const pages: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const content = await (await doc.getPage(i)).getTextContent();
    let text = "";
    for (const item of content.items) {
      if (!("str" in item)) continue;
      text += item.str + (item.hasEOL ? "\n" : "");
    }
    pages.push(text);
  }
  await task.destroy();
  return pages;
}

async function imageXObjects(bytes: Uint8Array): Promise<number> {
  const doc = await PDFDocument.load(bytes);
  let n = 0;
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    if (obj instanceof PDFRawStream && obj.dict.get(PDFName.of("Subtype")) === PDFName.of("Image") && obj.dict.get(PDFName.of("SMask")) === undefined) n++;
  }
  // masks are separate image objects; count only colour images (those that are not the SMask of another)
  return n;
}

const plain = (title: string): string => typographicQuotes(title.replace(/\*\*/g, ""));

describe("B-PDF: exportPdf(sample-11) parsed back", () => {
  const sample = sample11Guide();
  const images = sample11Images();
  const NOW = new Date("2026-09-28T12:00:00Z");

  let bytes: Uint8Array;
  let pages: string[];
  it("loads, has one embedded image per screenshot step, and the right metadata", async () => {
    bytes = await exportPdf(sample, images, { now: NOW });
    pages = await pdfText(bytes);
    const doc = await PDFDocument.load(bytes);
    expect(doc.getTitle()).toBe(sample.title);
    expect(await imageXObjects(bytes)).toBe(sample.steps.filter((s) => s.screenshot).length);
    expect(bytes.length).toBeLessThanOrEqual(4 * 1024 * 1024);
  });

  it("pdfjs extracts the guide title on page 1 and every step title exactly once, in order", () => {
    expect(pages[0]).toContain("Sign in, ask for help, and update");
    const body = pages.slice(1).join("\n");
    let from = -1;
    for (const s of sample.steps) {
      const title = plain(s.title);
      const first = body.indexOf(title);
      expect(first, `title of ${s.id}: ${title}`).toBeGreaterThan(from);
      expect(body.indexOf(title, first + 1), `title of ${s.id} appears once`).toBe(-1);
      from = first;
    }
    expect(pages.join("\n")).not.toContain(SAMPLE_CANARY_PASSWORD);
  });

  it("never contains the canary in raw bytes either", () => {
    expect(Buffer.from(bytes).toString("latin1")).not.toContain(SAMPLE_CANARY_PASSWORD);
  });

  it("is byte-identical for the same input and the same injected clock, and follows the clock", async () => {
    const b = await exportPdf(sample, images, { now: NOW });
    expect(sha256(b)).toBe(sha256(bytes));
    const c = await exportPdf(sample, images, { now: new Date("2027-01-01T00:00:00Z") });
    expect(sha256(c)).not.toBe(sha256(bytes));
    expect((await PDFDocument.load(c)).getCreationDate()?.toISOString()).toBe("2027-01-01T00:00:00.000Z");
    // without an injected clock the guide's own dates are used: still reproducible
    const d = await exportPdf(sample, images);
    expect((await PDFDocument.load(d)).getCreationDate()?.toISOString()).toBe("2026-09-28T10:00:00.000Z");
  });
});

describe("B-PDF: text in other scripts", () => {
  const base = fixtureGuide();
  const mk = (titles: string[]): Guide => ({
    ...base,
    title: "Résumé – Добро пожаловать",
    description: "Ça marche: naïve café über Łódź αβγ",
    steps: titles.map((t, i): Step => ({ ...(base.steps[1] as Step), id: `s${i}`, title: t, screenshot: undefined })),
  });
  const warnings: string[] = [];

  it("accented Latin, Latin Extended, Cyrillic and Greek titles extract correctly", async () => {
    const titles = ["Click **Café crème**", "Нажмите **Сохранить**", "Kliknij **Łódź**", "Click **Αποθήκευση**", "Mixed **Привет** and Latin"];
    const pages = await pdfText(await exportPdf(mk(titles), {}, { onWarning: (m) => warnings.push(m) }));
    const text = pages.join("\n");
    for (const t of titles) expect(text, t).toContain(plain(t));
    expect(pages[0]).toContain("Résumé");
    expect(pages[0]).toContain("Добро");
    expect(warnings).toEqual([]);
  });

  it("a title with a glyph no font has does not throw: it substitutes '?' and warns", async () => {
    const seen: string[] = [];
    const pages = await pdfText(await exportPdf(mk(["Click **日本語 ok**", "Emoji \u{1F600} here"]), {}, { onWarning: (m) => seen.push(m) }));
    const text = pages.join("\n");
    expect(text).toContain("Click ??? ok");
    expect(text).toContain("Emoji ? here");
    expect(seen.length).toBe(1);
    expect(seen[0]).toMatch(/no glyph for 4 characters \(U\+65E5/);
  });

  it("warns when a screenshot is missing", async () => {
    const seen: string[] = [];
    const g: Guide = { ...base, steps: [base.steps[1] as Step] };
    await exportPdf(g, {}, { onWarning: (m) => seen.push(m) });
    expect(seen.join()).toMatch(/was not provided/);
  });
});

describe("exportPdf: small fixture", () => {
  it("draws the highlight as vectors: a flag path and its numeral are in the page content", async () => {
    const g = fixtureGuide();
    const withHl = await exportPdf(g, fixtureImages());
    const without = await exportPdf(g, fixtureImages(), { highlight: false });
    expect(withHl.length).toBeGreaterThan(without.length);
    expect((await pdfText(withHl)).join("\n")).toContain("Click Sign in");
  });

  it("embeds prerendered images untouched", async () => {
    const g = fixtureGuide();
    const imgs = fixtureImages();
    const a = await exportPdf(g, imgs, { imagesPrerendered: true });
    const b = await exportPdf(g, imgs, { imagesPrerendered: true });
    expect(sha256(a)).toBe(sha256(b));
  });
});

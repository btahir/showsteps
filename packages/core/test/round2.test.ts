import { strFromU8, unzipSync } from "fflate";
import { parse } from "parse5";
import { describe, expect, it } from "vitest";
import { encodePng, exportAgentSkill, exportDocx, exportHtml, exportMarkdown, exportPdf, type Guide, type Step } from "../src";
import { formatDate } from "../src/export/doc-shared";
import { fixtureGuide, fixtureImages } from "./fixtures/guide";
import { sample11Guide, sample11Images } from "./fixtures/sample11";
import { HTML_CSS, HTML_TOKENS_DARK, HTML_TOKENS_LIGHT } from "../src/export/html-css";

const guide = fixtureGuide();
const images = fixtureImages();
const text = (f: string | Uint8Array | undefined): string => (typeof f === "string" ? f : new TextDecoder().decode(f));

describe("the Showsteps credit is off by default and opt-in everywhere (item 7)", () => {
  it("markdown", () => {
    expect(text(exportMarkdown(guide).files["guide.md"])).not.toContain("Made with");
    expect(text(exportMarkdown(guide, { branding: true }).files["guide.md"])).toContain("Made with [Showsteps]");
  });
  it("html", () => {
    expect(exportHtml(guide, images)).not.toContain("Made with");
    expect(exportHtml(guide, images, { branding: true })).toContain("Made with Showsteps");
  });
  it("skill", () => {
    expect(text(exportAgentSkill(guide).files["SKILL.md"])).not.toContain("Made with");
    expect(text(exportAgentSkill(guide, { branding: true }).files["SKILL.md"])).toContain("Made with [Showsteps]");
  });
  it("docx", async () => {
    const off = strFromU8(unzipSync(await exportDocx(guide, images))["word/document.xml"] as Uint8Array);
    const on = strFromU8(unzipSync(await exportDocx(guide, images, { branding: true }))["word/document.xml"] as Uint8Array);
    expect(off).not.toContain("Made with");
    expect(on).toContain("Made with Showsteps");
  });
  it("pdf", async () => {
    const { PDFDocument } = await import("pdf-lib");
    const a = await exportPdf(guide, images);
    const b = await exportPdf(guide, images, { branding: true });
    expect(b.length).toBeGreaterThan(a.length);
    expect((await PDFDocument.load(a)).getPageCount()).toBe((await PDFDocument.load(b)).getPageCount());
  });
});

describe("dates use the day as written (item 9)", () => {
  it("reads the date part of a local-offset timestamp, no UTC shift", () => {
    expect(formatDate("2026-09-28T22:42:00-07:00")).toBe("28 Sep 2026");
    expect(formatDate("2026-09-28T23:59:59+14:00")).toBe("28 Sep 2026");
    expect(formatDate("2026-09-28T00:00:00Z")).toBe("28 Sep 2026");
    expect(formatDate("2026-12-01")).toBe("1 Dec 2026");
    expect(formatDate("nonsense")).toBe("");
    expect(formatDate(undefined)).toBe("");
  });
  it("HTML and DOCX show the same day the title and the timestamps say", async () => {
    const g: Guide = { ...guide, createdAt: "2026-09-28T22:42:00-07:00", updatedAt: "2026-09-28T22:50:00-07:00" };
    expect(exportHtml(g, images)).toContain("28 September 2026");
    const xml = strFromU8(unzipSync(await exportDocx(g, images))["word/document.xml"] as Uint8Array);
    expect(xml).toContain("28 Sep 2026");
  });
});

describe("HTML guide (items 20, 21, 34)", () => {
  const sample = sample11Guide();
  const html = exportHtml(sample, sample11Images());
  const errors = (h: string): string[] => {
    const e: string[] = [];
    parse(h, { onParseError: (x) => e.push(x.code) });
    return e;
  };

  it("ends with a green tick marker and \u201cThat\u2019s it\u201d", () => {
    expect(html).toContain('<span class="tick" aria-hidden="true">');
    expect(html).toContain("That\u2019s it");
  });

  it("repeats the URL caption only when the page changes", () => {
    const captions = [...html.matchAll(/<figcaption>.*?<span class="mono">([^<]*)<\/span>/g)].map((m) => m[1]);
    for (let i = 1; i < captions.length; i++) expect(captions[i]).not.toBe(captions[i - 1]);
    expect(captions.filter((c) => c === "http://127.0.0.1:4517/index.html").length).toBeLessThanOrEqual(1);
  });

  it("drops the Starts-at fact when step 1 is a navigation, keeps it otherwise", () => {
    expect(html).not.toContain("Starts at");
    expect(exportHtml({ ...sample, steps: sample.steps.slice(1) }, sample11Images())).toContain("Starts at");
  });

  it("has a sticky TOC only for guides with more than 8 steps", () => {
    expect(html).toContain('<nav class="toc"');
    expect((html.match(/<nav class="toc"[^]*?<\/nav>/)?.[0].match(/<li>/g) ?? []).length).toBe(11);
    expect(exportHtml({ ...sample, steps: sample.steps.slice(0, 8) }, sample11Images())).not.toContain('<nav class="toc"');
    expect(html).toContain("position: sticky");
    expect(html).toContain("@media (min-width: 1100px)");
  });

  it("titles may be 20 characters wide, and phones keep the marker inline", () => {
    expect(html).toContain("max-width: 20ch");
    expect(html).toMatch(/@media \(max-width: 600px\)[^]*\.step \{ grid-template-columns: 28px minmax\(0, 1fr\); column-gap: 12px; \}/);
    expect(html).toMatch(/\.step h2 \{ font-size: 19px; \}/);
  });

  it("emits a zoomed detail image for phones and stays valid", () => {
    const pictures = html.match(/<picture><source media="\(max-width: 600px\)" srcset="data:image\/png;base64,/g) ?? [];
    const highlighted = sample.steps.filter((s) => s.screenshot?.highlight).length;
    expect(pictures.length).toBeGreaterThan(3); // wide targets already fill the frame and get no separate detail image
    expect(pictures.length).toBeLessThanOrEqual(highlighted);
    expect(errors(html)).toEqual([]);
    expect(Buffer.byteLength(html)).toBeLessThanOrEqual(6 * 1024 * 1024);
    expect(exportHtml(sample, sample11Images(), { detailImages: false })).not.toContain("<picture>");
  });
});

describe("DOCX font table (item 35, R2-9)", () => {
  it("uses Arial as the base font and describes it as a swiss sans", async () => {
    const z = unzipSync(await exportDocx(guide, images));
    const xml = strFromU8(z["word/fontTable.xml"] as Uint8Array);
    expect(xml).toContain('<w:font w:name="Arial">');
    expect(strFromU8(z["word/styles.xml"] as Uint8Array)).toContain('w:ascii="Arial"');
    expect(strFromU8(z["word/styles.xml"] as Uint8Array)).not.toContain("Calibri");
    expect(xml).toContain('<w:family w:val="swiss"/>');
    expect(xml).toContain('<w:panose1 w:val="020B0604020202020204"/>');
    expect(xml.trim().endsWith("</w:fonts>")).toBe(true);
  });
  it("sets the meta line in ink-3, not the accent colour", async () => {
    const z = unzipSync(await exportDocx(guide, images));
    const xml = strFromU8(z["word/document.xml"] as Uint8Array);
    const run = /<w:r>(?:(?!<\/w:r>)[^])*?steps \u00b7[^]*?<\/w:r>/.exec(xml)?.[0] ?? "";
    expect(run).toContain('w:val="736B63"');
    expect(run).not.toContain("EB4E26");
  });
});

describe("PDF layout (item 6)", () => {
  it("has no cover page and no per-step Screenshot unavailable line; a missing image just has none", async () => {
    const g: Guide = { ...guide, steps: guide.steps.slice(1, 2) as Step[] };
    const { PDFDocument } = await import("pdf-lib");
    const withImages = await PDFDocument.load(await exportPdf(g, images));
    expect(withImages.getPageCount()).toBe(1); // the title block and step 1 share page 1
    const none = await exportPdf(g, {});
    expect(Buffer.from(none).toString("latin1")).not.toContain("unavailable");
  });
  it("uses Rethink Sans and Fragment Mono by default", async () => {
    const { PDFDocument, PDFName, PDFDict } = await import("pdf-lib");
    const doc = await PDFDocument.load(await exportPdf(guide, images));
    const names: string[] = [];
    for (const [, obj] of doc.context.enumerateIndirectObjects()) {
      if (obj instanceof PDFDict && obj.get(PDFName.of("Type")) === PDFName.of("Font")) names.push(String(obj.get(PDFName.of("BaseFont"))));
    }
    expect(names.some((n) => /Rethink/i.test(n))).toBe(true);
    expect(names.some((n) => /FragmentMono/i.test(n))).toBe(true);
  });
});

describe("exported HTML colour contrast (no axe needed)", () => {
  const lum = (hex: string): number => {
    const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * (c[0] as number) + 0.7152 * (c[1] as number) + 0.0722 * (c[2] as number);
  };
  const ratio = (a: string, b: string): number => {
    const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x) as [number, number];
    return (hi + 0.05) / (lo + 0.05);
  };
  const vars = (block: string): Record<string, string> => Object.fromEntries([...block.matchAll(/--ss-([a-z0-9-]+):\s*(#[0-9A-Fa-f]{6})/g)].map((m) => [m[1] as string, m[2] as string]));
  const light = vars(HTML_TOKENS_LIGHT);
  const dark = { ...light, ...vars(HTML_TOKENS_DARK) };
  // [foreground, background, what it is]: every text-on-fill pair the stylesheet uses
  const pairs: [string, string, string][] = [
    ["on-accent", "accent-strong", ".flag and .flag.sm (step numbers)"],
    ["ink", "bg", "body text"],
    ["ink-2", "bg", ".lede, .desc, .toc links"],
    ["ink-3", "bg", ".eyebrow, figcaption, .facts, footer, .toc .n"],
    ["ink-2", "surface-2", ".step.note .flag"],
    ["ok", "ok-soft", ".done .tick"],
    ["accent-ink", "bg", "links"],
    ["ink", "surface-2", "code"],
  ];
  it.each(pairs)("%s on %s reaches 4.5:1 in light and dark (%s)", (fg, bg) => {
    expect(ratio(light[fg] as string, light[bg] as string), `light ${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
    expect(ratio(dark[fg] as string, dark[bg] as string), `dark ${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
  });
  it("the stylesheet really uses accent-strong for the flag", () => {
    expect(HTML_CSS).toMatch(/\.flag \{[^}]*background: var\(--ss-accent-strong\); color: var\(--ss-on-accent\)/);
  });
});

describe("PDF pagination (R2-5)", () => {
  const mk = (n: number, w: number, h: number): { g: Guide; imgs: Record<string, Uint8Array> } => {
    const base = sample11Guide();
    const steps: Step[] = Array.from({ length: n }, (_, i) => ({ ...(base.steps[3] as Step), id: `p${i}`, title: `Click **Item ${i + 1}**`, page: { url: `https://a.test/${i}`, title: `P${i}` }, screenshot: { image: `images/p${i}.png`, width: w, height: h, devicePixelRatio: 1, viewport: { width: w, height: h, scrollX: 0, scrollY: 0 } } }));
    const png = fixtureImagesFor(w, h);
    return { g: { ...base, steps }, imgs: Object.fromEntries(steps.map((s) => [s.screenshot!.image, png])) };
  };
  function fixtureImagesFor(w: number, h: number): Uint8Array {
    const data = new Uint8Array(w * h * 4).fill(235);
    return encodePng({ width: w, height: h, data }, 1);
  }
  it.each([["A4"], ["Letter"]] as const)("12 steps of 1280x800 at %s take 7 pages: two per page after the title block", async (size) => {
    const { PDFDocument } = await import("pdf-lib");
    const { g, imgs } = mk(12, 1280, 800);
    const doc = await PDFDocument.load(await exportPdf(g, imgs, { pageSize: size }));
    expect(doc.getPageCount()).toBeLessThanOrEqual(7);
  });
  it("prerendered images with the extension's options paginate the same as the default path", async () => {
    const { PDFDocument } = await import("pdf-lib");
    const { g, imgs } = mk(12, 1280, 800);
    const a = (await PDFDocument.load(await exportPdf(g, imgs))).getPageCount();
    const b = (await PDFDocument.load(await exportPdf(g, imgs, { redactionsBaked: true, highlight: false, imagesPrerendered: true }))).getPageCount();
    expect(b).toBe(a);
  });
  it("portrait screenshots are still allowed to be tall", async () => {
    const { PDFDocument } = await import("pdf-lib");
    const { g, imgs } = mk(4, 600, 1000);
    expect((await PDFDocument.load(await exportPdf(g, imgs))).getPageCount()).toBeGreaterThanOrEqual(3);
  });
});

describe("DOCX repeats no URL (R2-9)", () => {
  it("shows a URL only when the page changes", async () => {
    const g: Guide = { ...guide, steps: guide.steps.slice(0, 4) };
    const xml = strFromU8(unzipSync(await exportDocx(g, images))["word/document.xml"] as Uint8Array);
    const urls = [...xml.matchAll(/<w:t[^>]*>(https?:\/\/[^<]*)<\/w:t>/g)].map((m) => m[1]);
    expect(urls.length).toBeGreaterThan(0);
    for (let i = 1; i < urls.length; i++) expect(urls[i]).not.toBe(urls[i - 1]);
    expect(new Set(urls).size).toBe(urls.length);
  });
});

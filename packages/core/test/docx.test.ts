import { unzipSync, strFromU8 } from "fflate";
import { describe, expect, it } from "vitest";
import { decodePng } from "../src/png";
import { exportDocx } from "../src/export/docx";
import type { Guide } from "../src/schema";
import { MAGENTA, SECRET, makeGuide, makePng, makeStep } from "./doc-fixtures";

const unxml = (s: string) =>
  s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");

async function open(guide: Guide, images: Record<string, Uint8Array>, opts = {}) {
  const bytes = await exportDocx(guide, images, opts);
  const zip = unzipSync(bytes);
  const documentXml = strFromU8(zip["word/document.xml"]!);
  const paragraphs = documentXml
    .split("</w:p>")
    .map((p) => unxml([...p.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g)].map((m) => m[1]).join("")))
    .filter(Boolean);
  const rels = strFromU8(zip["word/_rels/document.xml.rels"]!);
  const imageRels = [...rels.matchAll(/<Relationship [^>]*relationships\/image"[^>]*>/g)].map((m) => m[0]);
  return { bytes, zip, documentXml, paragraphs, rels, imageRels };
}

describe("exportDocx", () => {
  it("writes a valid docx with every step title, numbered headings and one image relationship per screenshot", async () => {
    const { guide, images } = makeGuide();
    const { bytes, zip, documentXml, paragraphs, imageRels } = await open(guide, images);
    expect(Buffer.from(bytes.subarray(0, 2)).toString()).toBe("PK");
    for (const f of ["[Content_Types].xml", "word/document.xml", "word/numbering.xml", "word/styles.xml", "docProps/core.xml"])
      expect(zip[f], f).toBeTruthy();

    expect(paragraphs[0]).toBe("Change your billing settings");
    expect(paragraphs).toContain("A four step walkthrough for admins.");
    for (const t of ["Go to Settings – Acme", "Click Save", "Type in Password", "Press Enter"]) expect(paragraphs).toContain(t);
    expect(paragraphs.some((p) => p.includes("4 steps · 28 Sep 2026"))).toBe(true);
    expect(paragraphs).toContain("Saving applies the change immediately.");
    expect(paragraphs).toContain("Everyone on the team sees it");
    expect(documentXml).not.toContain("SKIPPED STEP TITLE");

    // Four headings, all numbered from one list, kept with the next paragraph.
    const headings = documentXml.split("</w:p>").filter((p) => p.includes('w:val="Heading2"'));
    expect(headings).toHaveLength(4);
    for (const h of headings) {
      expect(h).toContain("<w:numPr>");
      expect(h).toContain("<w:keepNext/>");
    }
    // **bold** is a bold run inside the heading.
    expect(documentXml).toMatch(/<w:b\/>[^]*?<w:t[^>]*>Save<\/w:t>/);

    // N image relationships, N drawings, N media files, alt text = step title.
    expect(imageRels).toHaveLength(4);
    expect(documentXml.match(/<w:drawing>/g)).toHaveLength(4);
    expect(Object.keys(zip).filter((f) => f.startsWith("word/media/") && !f.endsWith("/"))).toHaveLength(4);
    const descr = [...documentXml.matchAll(/<wp:docPr[^>]*\sdescr="([^"]*)"/g)].map((m) => unxml(m[1]!));
    expect(descr).toEqual(["Go to Settings – Acme", "Click Save", "Type in Password", "Press Enter"]);
  });

  it("sizes images to the page width and supports Letter", async () => {
    const { guide } = makeGuide();
    guide.steps = [makeStep(1, {}, 1400, 800)];
    const images = { "images/s_1.png": makePng(1400, 800, (x, y) => [x & 255, y & 255, 9]) };
    const a4 = (await open(guide, images)).documentXml;
    const letter = (await open(guide, images, { pageSize: "Letter" })).documentXml;
    const cx = (x: string) => Number(/<wp:extent cx="(\d+)"/.exec(x)![1]);
    const EMU_PER_TWIP = 635;
    // Content width = page width minus 2 x 0.75in margins (within 1px rounding).
    expect(Math.abs(cx(a4) - (11906 - 2160) * EMU_PER_TWIP)).toBeLessThan(2 * 9525);
    expect(Math.abs(cx(letter) - (12240 - 2160) * EMU_PER_TWIP)).toBeLessThan(2 * 9525);
    expect(a4).toContain('w:w="11906"');
    expect(letter).toContain('w:w="12240"');
  });

  it("bakes redactions and the highlight ring into the embedded PNGs", async () => {
    const { guide, images } = makeGuide();
    guide.steps[2]!.screenshot!.redactions![0]!.style = "solid";
    const { zip, documentXml, rels } = await open(guide, images);
    // Map rId -> media for step 3 (index 2 among image rels, in document order).
    const order = [...documentXml.matchAll(/<a:blip r:embed="(rId\d+)"/g)].map((m) => m[1]!);
    const target = (id: string) => /Target="([^"]+)"/.exec(new RegExp(`<Relationship [^>]*Id="${id}"[^>]*>`).exec(rels)![0])![1]!;
    const pngs = order.map((id) => decodePng(zip[`word/${target(id)}`]!)!);
    const step3 = pngs[2]!;
    const at = (r: typeof step3, x: number, y: number) => Array.from(r.data.subarray((y * r.width + x) * 4, (y * r.width + x) * 4 + 4));
    // redaction block: the brand solid colour, dimmed 16% by the spotlight because it is outside the ring
    expect(at(step3, 90, 60).map((v, i) => Math.abs(v - [0x1f, 0x1c, 0x19, 255][i]!))).toEqual([expect.any(Number), expect.any(Number), expect.any(Number), 0]);
    expect(Math.max(...at(step3, 90, 60).slice(0, 3).map((v, i) => Math.abs(v - [0x1f, 0x1c, 0x19][i]!)))).toBeLessThanOrEqual(6);
    for (const p of pngs) {
      // No sensitive magenta left anywhere.
      let found = false;
      for (let i = 0; i < p.data.length; i += 4) if (p.data[i] === MAGENTA[0] && p.data[i + 1] === MAGENTA[1] && p.data[i + 2] === MAGENTA[2]) found = true;
      expect(found).toBe(false);
    }
    // Highlight: pixels on the ring edge (x=20-pad, y=45) are orange-ish, unlike the source gradient.
    const src = decodePng(images["images/s_1.png"]!)!;
    const ring = pngs[0]!;
    expect(at(ring, 16, 30)).not.toEqual(at(src, 16, 30));
    const [r, g, b] = at(ring, 16, 30);
    expect(r!).toBeGreaterThan(200);
    expect(b!).toBeLessThan(120);
    // highlight:false leaves the pixels untouched.
    const plain = await open(guide, images, { highlight: false });
    const plainId = [...plain.documentXml.matchAll(/<a:blip r:embed="(rId\d+)"/g)][0]![1]!;
    const plainTarget = /Target="([^"]+)"/.exec(new RegExp(`<Relationship [^>]*Id="${plainId}"[^>]*>`).exec(plain.rels)![0])![1]!;
    const plainPng = decodePng(plain.zip[`word/${plainTarget}`]!)!;
    expect(at(plainPng, 16, 30)).toEqual(at(src, 16, 30));
    expect(Buffer.from(await exportDocxRaw(guide, images)).includes(SECRET)).toBe(false);
  });

  it("applies crop by rewriting pixels", async () => {
    const { guide, images } = makeGuide();
    guide.steps[0]!.screenshot!.crop = { x: 10, y: 10, width: 80, height: 40 };
    const { zip, documentXml, rels } = await open(guide, images);
    const id = /<a:blip r:embed="(rId\d+)"/.exec(documentXml)![1]!;
    const t = /Target="([^"]+)"/.exec(new RegExp(`<Relationship [^>]*Id="${id}"[^>]*>`).exec(rels)![0])![1]!;
    const p = decodePng(zip[`word/${t}`]!)!;
    expect([p.width, p.height]).toEqual([80, 40]);
  });

  it("refuses unredactable images with redactions unless baked; handles notes and missing images", async () => {
    const { guide, images } = makeGuide();
    const g: Guide = structuredClone(guide);
    g.steps[2]!.screenshot!.image = "images/s_3.jpg";
    const jpg = Uint8Array.from([0xff, 0xd8, 0xff, 0xc0, 0, 17, 8, 0, 100, 0, 160, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1, 0xff, 0xd9]);
    await expect(exportDocx(g, { ...images, "images/s_3.jpg": jpg })).rejects.toThrow(/redactions/);

    const g2 = structuredClone(guide);
    g2.steps = [
      makeStep(1, { action: { type: "note" }, title: "Read this first", screenshot: undefined }),
      makeStep(2, { title: "Click **Gone**" }),
    ];
    const { paragraphs, imageRels } = await open(g2, {});
    expect(paragraphs).toContain("Read this first");
    expect(paragraphs).toContain("Screenshot unavailable");
    expect(imageRels).toHaveLength(0);
  });

  it("omits URLs when includeUrls is false and sets document properties", async () => {
    const { guide, images } = makeGuide();
    expect((await open(guide, images)).paragraphs).toContain("https://app.example.com/page/2");
    guide.settings = { includeUrls: false };
    const o = await open(guide, images);
    expect(o.paragraphs).not.toContain("https://app.example.com/page/2");
    const core = strFromU8(o.zip["docProps/core.xml"]!);
    expect(core).toContain("Change your billing settings");
    expect(core).toContain("Showsteps");
  });

  it("scales tall screenshots down to fit a page", async () => {
    const { guide } = makeGuide();
    guide.steps = [makeStep(1, {}, 400, 4000)];
    const images = { "images/s_1.png": makePng(400, 4000, (x, y) => [x & 255, y & 255, 0]) };
    const { documentXml } = await open(guide, images);
    const cy = Number(/<wp:extent cx="\d+" cy="(\d+)"/.exec(documentXml)![1]);
    expect(cy).toBeLessThan((16838 - 2160) * 635); // shorter than the page's content height
  });
});

async function exportDocxRaw(guide: Guide, images: Record<string, Uint8Array>) {
  return exportDocx(guide, images);
}

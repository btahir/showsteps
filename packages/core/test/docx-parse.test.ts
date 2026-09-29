import { XMLParser, XMLValidator } from "fast-xml-parser";
import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { exportDocx, type Guide, type Step } from "../src";
import { SAMPLE_CANARY_PASSWORD, sample11Guide, sample11Images } from "./fixtures/sample11";
import { sha256 } from "./golden";

const plain = (t: string): string => t.replace(/\*\*/g, "");
const unxml = (s: string): string => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");

describe("B-DOCX: exportDocx(sample-11) parsed back", () => {
  const sample = sample11Guide();
  const images = sample11Images();
  const NOW = new Date("2026-09-28T12:00:00Z");
  let bytes: Uint8Array;
  let zip: Record<string, Uint8Array>;
  let documentXml: string;

  it("builds", async () => {
    bytes = await exportDocx(sample, images, { now: NOW });
    zip = unzipSync(bytes);
    documentXml = strFromU8(zip["word/document.xml"] as Uint8Array);
    expect(bytes.length).toBeLessThanOrEqual(6 * 1024 * 1024);
  });

  it("word/document.xml is well-formed XML (fast-xml-parser throws nothing)", () => {
    expect(XMLValidator.validate(documentXml)).toBe(true);
    for (const [name, data] of Object.entries(zip)) if (/\.(xml|rels)$/.test(name)) expect(XMLValidator.validate(strFromU8(data)), name).toBe(true);
    expect(() => new XMLParser({ ignoreAttributes: false }).parse(documentXml)).not.toThrow();
  });

  it("every plain step title is in a w:t run, in order", () => {
    const text = [...documentXml.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g)].map((m) => unxml(m[1] as string));
    let from = -1;
    for (const s of sample.steps) {
      const at = text.findIndex((t, i) => i > from && t.includes(plain(s.title)) || (i > from && plain(s.title).includes(t) && t.length > 0 && text.slice(i, i + 4).join("").includes(plain(s.title))));
      expect(at, s.title).toBeGreaterThan(from);
      from = at;
    }
  });

  it("has one drawing and one media file per screenshot step, and matching properties", () => {
    const shots = sample.steps.filter((s) => s.screenshot).length;
    expect(documentXml.match(/<w:drawing>/g)).toHaveLength(shots);
    expect(Object.keys(zip).filter((f) => /^word\/media\/.+\.png$/.test(f))).toHaveLength(shots);
    const core = strFromU8(zip["docProps/core.xml"] as Uint8Array);
    expect(unxml(core)).toContain(`<dc:title>${sample.title}</dc:title>`);
    expect(core).toContain("2026-09-28T12:00:00Z");
  });

  it("contains no password canary", () => {
    expect(Buffer.from(bytes).toString("latin1")).not.toContain(SAMPLE_CANARY_PASSWORD);
    for (const [name, data] of Object.entries(zip)) if (/\.xml$/.test(name)) expect(strFromU8(data), name).not.toContain(SAMPLE_CANARY_PASSWORD);
  });

  it("is byte-identical for the same input and clock, and follows the clock", async () => {
    const a = await exportDocx(sample, images, { now: NOW });
    expect(sha256(a)).toBe(sha256(bytes));
    const c = await exportDocx(sample, images, { now: new Date("2027-01-01T00:00:00Z") });
    expect(sha256(c)).not.toBe(sha256(a));
    expect(strFromU8(unzipSync(c)["docProps/core.xml"] as Uint8Array)).toContain("2027-01-01T00:00:00Z");
    expect(sha256(await exportDocx(sample, images))).toBe(sha256(await exportDocx(sample, images)));
  });

  it("zip entries are sorted with a fixed mtime", () => {
    const names = Object.keys(zip);
    expect(names[0]).toBe("[Content_Types].xml");
    expect(names.slice(1)).toEqual([...names.slice(1)].sort());
    const dv = new DataView(bytes.buffer, bytes.byteOffset);
    expect(dv.getUint16(10, true)).toBe(0);
    expect(dv.getUint16(12, true)).toBe(0x21);
  });
});

describe("exportDocx: other scripts", () => {
  it("keeps Cyrillic and accented titles as real text", async () => {
    const base = sample11Guide();
    const g: Guide = { ...base, title: "Ça marche – Добро", steps: [{ ...(base.steps[1] as Step), title: "Нажмите **Сохранить**", screenshot: undefined }] };
    const zip = unzipSync(await exportDocx(g, {}));
    const xml = strFromU8(zip["word/document.xml"] as Uint8Array);
    expect(xml).toContain("Нажмите");
    expect(xml).toContain("Сохранить");
    expect(xml).toContain("Ça marche");
  });
});

import { describe, expect, it } from "vitest";
import { exportAgentSkill, exportDocx, exportHtml, exportMarkdown, exportPdf, exportPlaywright, packBundle, type ExportFiles, type Guide } from "../src";
import { fixtureGuide, fixtureImages } from "./fixtures/guide";
import { sha256 } from "./golden";

const guide = fixtureGuide();
const images = fixtureImages();
const bytes = (f: string | Uint8Array | undefined): Uint8Array => (typeof f === "string" ? new TextEncoder().encode(f) : (f as Uint8Array));
const digest = (files: ExportFiles): string => Object.keys(files).map((k) => `${k}:${sha256(bytes(files[k]))}`).join("\n");
/** Same guide with every object's keys in reverse order: exporters must not depend on insertion order. */
const reversed = (g: Guide): Guide => {
  const flip = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(flip);
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v as object).reverse().map(([k, x]) => [k, flip(x)]));
    return v;
  };
  return flip(g) as Guide;
};

describe("B-DET: exporters and packBundle are deterministic", () => {
  it("markdown", () => {
    expect(digest(exportMarkdown(guide, { images }).files)).toBe(digest(exportMarkdown(guide, { images }).files));
    expect(digest(exportMarkdown(guide, { images }).files)).toBe(digest(exportMarkdown(reversed(guide), { images }).files));
  });
  it("html", () => {
    expect(exportHtml(guide, images)).toBe(exportHtml(guide, images));
    expect(exportHtml(guide, images)).toBe(exportHtml(reversed(guide), images));
  });
  it("playwright", () => {
    expect(exportPlaywright(guide)).toBe(exportPlaywright(reversed(guide)));
  });
  it("agent skill", () => {
    expect(digest(exportAgentSkill(guide, { images }).files)).toBe(digest(exportAgentSkill(guide, { images }).files));
    expect(digest(exportAgentSkill(guide).files)).toBe(digest(exportAgentSkill(reversed(guide)).files));
  });
  it("bundle", () => {
    expect(sha256(packBundle(guide, images))).toBe(sha256(packBundle(guide, images)));
    expect(sha256(packBundle(guide, images))).toBe(sha256(packBundle(reversed(guide), images)));
  });
  it("pdf and docx: same input and same injected clock give the same bytes, whatever the key order", async () => {
    const now = new Date("2026-09-28T12:00:00Z");
    expect(sha256(await exportPdf(guide, images, { now }))).toBe(sha256(await exportPdf(reversed(guide), images, { now })));
    expect(sha256(await exportDocx(guide, images, { now }))).toBe(sha256(await exportDocx(reversed(guide), images, { now })));
  });
  it("pdf and docx follow the injected clock (and only it) for their dates", async () => {
    const a = await exportPdf(guide, images, { now: new Date("2026-01-01T00:00:00Z") });
    const b = await exportPdf(guide, images, { now: new Date("2026-06-01T00:00:00Z") });
    expect(sha256(a)).not.toBe(sha256(b));
    const c = await exportDocx(guide, images, { now: new Date("2026-01-01T00:00:00Z") });
    const d = await exportDocx(guide, images, { now: new Date("2026-06-01T00:00:00Z") });
    expect(sha256(c)).not.toBe(sha256(d));
  });
  it("does not read the clock or randomness: output is identical across a faked Date", async () => {
    const real = Date.now;
    try {
      Date.now = () => 42;
      const a = exportHtml(guide, images) + digest(exportAgentSkill(guide).files) + exportPlaywright(guide) + sha256(await exportPdf(guide, images)) + sha256(await exportDocx(guide, images));
      Date.now = () => 1_900_000_000_000;
      const b = exportHtml(guide, images) + digest(exportAgentSkill(guide).files) + exportPlaywright(guide) + sha256(await exportPdf(guide, images)) + sha256(await exportDocx(guide, images));
      expect(a).toBe(b);
    } finally {
      Date.now = real;
    }
  });
});

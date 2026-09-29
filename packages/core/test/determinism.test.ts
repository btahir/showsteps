import { describe, expect, it } from "vitest";
import { exportAgentSkill, exportHtml, exportMarkdown, exportPlaywright, packBundle, type ExportFiles, type Guide } from "../src";
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
  it("does not read the clock or randomness: output is identical across a faked Date", () => {
    const real = Date.now;
    try {
      Date.now = () => 42;
      const a = exportHtml(guide, images) + digest(exportAgentSkill(guide).files) + exportPlaywright(guide);
      Date.now = () => 1_900_000_000_000;
      const b = exportHtml(guide, images) + digest(exportAgentSkill(guide).files) + exportPlaywright(guide);
      expect(a).toBe(b);
    } finally {
      Date.now = real;
    }
  });
});

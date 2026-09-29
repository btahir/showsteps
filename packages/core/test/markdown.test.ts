import { describe, expect, it } from "vitest";
import { decodePng, exportMarkdown, type Guide, type Step } from "../src";
import { fixtureGuide, fixtureImages } from "./fixtures/guide";
import { SAMPLE_CANARY_PASSWORD, sample11Guide, sample11Images } from "./fixtures/sample11";
import { expectGolden, sha256 } from "./golden";

const guide = fixtureGuide();
const images = fixtureImages();
const text = (f: string | Uint8Array | undefined): string => (typeof f === "string" ? f : new TextDecoder().decode(f));

describe("exportMarkdown (small fixture)", () => {
  it("matches the golden guide.md", () => {
    const { files } = exportMarkdown(guide, { images });
    expectGolden("markdown/guide.md", text(files["guide.md"]));
    expectGolden("markdown/files.txt", Object.entries(files).map(([k, v]) => `${k} ${typeof v === "string" ? "text" : "bytes"}`).join("\n") + "\n");
  });

  it("links images without bytes when no images are given, and can omit the links", () => {
    const withLinks = exportMarkdown(guide).files;
    expect(Object.keys(withLinks)).toEqual(["guide.md"]);
    expect(text(withLinks["guide.md"])).toContain('![Step 2: Type "jane@example.com" in Email](images/s_email.png)');
    expect(text(exportMarkdown(guide, { imageLinks: false }).files["guide.md"])).not.toContain("![");
  });

  it("skips skipped steps and renumbers", () => {
    const g: Guide = { ...guide, steps: guide.steps.map((s) => (s.id === "s_gear" ? { ...s, skipped: true } : s)) };
    const out = exportMarkdown(g, { images });
    expect(text(out.files["guide.md"])).not.toContain("Open settings");
    expect(text(out.files["guide.md"])).toContain("## 5. Select **Monthly** in **Billing period**");
    expect(Object.keys(out.files)).not.toContain("images/s_gear.png");
  });

  it("honours includeUrls and strips query strings and fragments from shown URLs", () => {
    const g: Guide = { ...guide, steps: guide.steps.map((s, i) => (i === 0 ? { ...s, page: { ...s.page, url: "https://app.acme.test/login?token=abc123#x" } } : s)) };
    const md = text(exportMarkdown(g).files["guide.md"]);
    expect(md).not.toContain("abc123");
    expect(md).toContain("https://app.acme.test/login");
    expect(text(exportMarkdown(g, { includeUrls: false }).files["guide.md"])).not.toContain("acme.test/login");
    expect(text(exportMarkdown({ ...g, settings: { includeUrls: false } }).files["guide.md"])).not.toContain("*Page:");
  });

  it("escapes the guide title and can drop branding", () => {
    expect(text(exportMarkdown({ ...guide, title: "Q1 *report* [draft]" }).files["guide.md"]).startsWith("# Q1 \\*report\\* \\[draft\\]\n")).toBe(true);
    expect(text(exportMarkdown(guide, { branding: false }).files["guide.md"])).not.toContain("Made with");
  });

  it("copes with an empty guide and an untitled step", () => {
    const empty = text(exportMarkdown({ ...guide, title: "", steps: [] }).files["guide.md"]);
    expect(empty.startsWith("# Untitled guide")).toBe(true);
    const untitled = text(exportMarkdown({ ...guide, steps: [{ ...(guide.steps[0] as Step), title: "" }] }).files["guide.md"]);
    expect(untitled).toContain("## 1. Step");
  });

  it("URL-encodes parentheses and spaces in link destinations", () => {
    const g: Guide = { ...guide, steps: [{ ...(guide.steps[0] as Step), page: { url: "https://a.test/wiki/Foo_(bar) baz", title: "Foo (bar)" } }] };
    expect(text(exportMarkdown(g).files["guide.md"])).toContain("https://a.test/wiki/Foo_%28bar%29%20baz");
  });
});

describe("exportMarkdown (sample-11, B-MD)", () => {
  const sample = sample11Guide();
  const imgs = sample11Images();
  const skipped: Guide = { ...sample, steps: sample.steps.map((s) => (s.id === "s06" ? { ...s, skipped: true } : s)) };
  const { files } = exportMarkdown(skipped, { images: imgs });
  const md = text(files["guide.md"]);
  const visible = skipped.steps.filter((s) => !s.skipped);

  it("returns exactly guide.md plus images/<id>.png for every visible step with a screenshot", () => {
    const expected = ["guide.md", ...visible.filter((s) => s.screenshot).map((s) => `images/${s.id}.png`)].sort();
    expect(Object.keys(files).sort()).toEqual(expected);
    expect(Object.keys(files)).not.toContain("images/s06.png");
    expect(visible.length).toBe(10);
  });

  it("every image link resolves to a returned file, and headings equal the visible step count", () => {
    const links = [...md.matchAll(/!\[[^\]]*\]\((images\/[^)]+)\)/g)].map((m) => m[1] as string);
    expect(links.length).toBe(visible.length);
    for (const l of links) expect(files[l], l).toBeInstanceOf(Uint8Array);
    expect((md.match(/^## \d+\. /gm) ?? []).length).toBe(visible.length);
  });

  it("contains no password canary and matches the golden byte for byte", () => {
    expect(md).not.toContain(SAMPLE_CANARY_PASSWORD);
    expectGolden("markdown/sample-11.guide.md", md);
  });

  it("the returned password screenshot has the redaction burnt in (blur predicate)", () => {
    const shot = sample.steps.find((s) => s.id === "s02")?.screenshot as NonNullable<Step["screenshot"]>;
    const rect = shot.highlight as { x: number; y: number; width: number; height: number }; // the field itself, inside the redaction and inside the ring
    const out = decodePng(files["images/s02.png"] as Uint8Array);
    const orig = decodePng(imgs["images/s02.png"] as Uint8Array);
    const hdiff = (img: typeof out): number => {
      let sum = 0, n = 0;
      for (let y = rect.y + 4; y < rect.y + rect.height - 4; y++) for (let x = rect.x + 4; x < rect.x + rect.width - 5; x++) { sum += Math.abs((img.data[(y * img.width + x) * 4] as number) - (img.data[(y * img.width + x + 1) * 4] as number)); n++; }
      return sum / n;
    };
    expect(hdiff(orig)).toBeGreaterThan(1);
    expect(hdiff(out)).toBeLessThanOrEqual(hdiff(orig) * 0.15);
    // the dark bullet pixels of the secret are gone from the returned bytes
    let dark = 0;
    for (let y = rect.y; y < rect.y + rect.height; y++) for (let x = rect.x; x < rect.x + rect.width; x++) if ((out.data[(y * out.width + x) * 4] as number) < 40) dark++;
    expect(dark).toBe(0);
  });

  it("is deterministic: same bytes on every run", () => {
    const again = exportMarkdown(skipped, { images: imgs }).files;
    for (const k of Object.keys(files)) expect(sha256(typeof files[k] === "string" ? new TextEncoder().encode(files[k] as string) : (files[k] as Uint8Array))).toBe(sha256(typeof again[k] === "string" ? new TextEncoder().encode(again[k] as string) : (again[k] as Uint8Array)));
  });
});

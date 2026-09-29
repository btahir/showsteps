import { parse } from "parse5";
import { describe, expect, it } from "vitest";
import { exportHtml, type Guide, type Step } from "../src";
import { fixtureGuide, fixtureImages } from "./fixtures/guide";
import { SAMPLE_CANARY_PASSWORD, sample11Guide, sample11Images } from "./fixtures/sample11";
import { expectGolden } from "./golden";

const guide = fixtureGuide();
const images = fixtureImages();

/** Parse with parse5 and return every parse error (0 means the document is valid HTML5 as far as the parser cares). */
function parseErrors(html: string): string[] {
  const errors: string[] = [];
  parse(html, { onParseError: (e) => errors.push(`${e.code} at ${e.startLine}:${e.startCol}`) });
  return errors;
}

/** Every URL-ish attribute value and CSS url()/@import in the document, excluding data:, mailto: and #anchors. */
function externalRefs(html: string): string[] {
  const refs: string[] = [];
  for (const m of html.matchAll(/\s(?:src|href|action|poster|srcset)="([^"]*)"/gi)) refs.push(m[1] as string);
  for (const m of html.matchAll(/url\(\s*['"]?([^'")]+)/gi)) refs.push(m[1] as string);
  for (const m of html.matchAll(/@import\s+(?:url\()?\s*['"]?([^'");]+)/gi)) refs.push(m[1] as string);
  return refs.filter((r) => !/^(data:|mailto:|#)/i.test(r));
}

describe("exportHtml (small fixture)", () => {
  const html = exportHtml(guide, images);

  it("matches the golden HTML", () => expectGolden("html/guide.html", html));

  it("is valid HTML5 for parse5 (0 parse errors)", () => expect(parseErrors(html)).toEqual([]));

  it("escapes hostile content", () => {
    const evil: Guide = {
      ...guide,
      title: "<script>alert(1)</script>",
      description: "[click](javascript:alert(1)) and <img src=x onerror=alert(2)> and **bold**",
      steps: guide.steps.slice(0, 1).map((s) => ({ ...s, title: "Click **<b onclick=1>x</b>**", description: "- one\n- <i>two</i>\n\n```\n<script>x</script>\n```" })),
    };
    const out = exportHtml(evil, images);
    for (const bad of ["<script", "javascript:", "<img src=x", "<b onclick"]) expect(out).not.toContain(bad);
    expect(out).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(out).toContain("<b>bold</b>");
    expect(out).toContain("<li>one</li>");
    expect(out).toContain("<pre><code>&lt;script&gt;x&lt;/script&gt;</code></pre>");
    expect(parseErrors(out)).toEqual([]);
  });

  it("puts alt text on every screenshot and marks the steps up as an ordered list", () => {
    expect(html).toContain('alt="Screenshot of step 2: Type &quot;jane@example.com&quot; in Email"');
    expect((html.match(/<li class="step/g) ?? []).length).toBe(10);
    expect(html).toContain('<span class="flag" aria-hidden="true">10</span>');
  });

  it("supports branding off, theme forcing, extra CSS and system fonts", () => {
    expect(exportHtml(guide, images, { branding: false })).not.toContain("Made with");
    const out = exportHtml(guide, images, { theme: "dark", css: ":root{--ss-accent:#0af}", embedFonts: false });
    expect(out).toContain('<html lang="en" data-theme="dark">');
    expect(out).toContain(":root{--ss-accent:#0af}");
    expect(out).not.toContain("@font-face");
    expect(out.length).toBeLessThan(html.length - 90_000);
  });

  it("embeds Rethink Sans and Fragment Mono as data URIs by default", () => {
    expect(html).toContain('font-family: "Rethink Sans"');
    expect(html).toContain('font-family: "Fragment Mono"');
    expect((html.match(/data:font\/woff2;base64,/g) ?? []).length).toBe(3);
  });

  it("works without screenshots and drops query strings from displayed URLs", () => {
    const out = exportHtml({ ...guide, steps: guide.steps.map((s) => ({ ...s, screenshot: undefined })) }, {});
    expect((out.match(/<img /g) ?? []).length).toBe(0);
    const q: Guide = { ...guide, steps: guide.steps.map((s) => ({ ...s, page: { ...s.page, url: s.page.url + "?session=SECRET42" } })) };
    expect(exportHtml(q, images)).not.toContain("SECRET42");
  });

  it("renders descriptions with lists, quotes, code and safe links only", () => {
    const g: Guide = { ...guide, steps: [{ ...(guide.steps[0] as Step), description: "Intro line\nsecond line\n\n1. first\n2. second\n\n> quoted\n\nUse `npm i` and [docs](https://a.test/x) or [bad](ftp://x)." }] };
    const out = exportHtml(g, images);
    expect(out).toContain("Intro line<br>second line");
    expect(out).toContain("<ol><li>first</li><li>second</li></ol>");
    expect(out).toContain("<blockquote><p>quoted</p></blockquote>");
    expect(out).toContain("<code>npm i</code>");
    expect(out).toContain('<a href="https://a.test/x" rel="noopener noreferrer">docs</a>');
    expect(out).not.toContain("ftp://");
  });
});

describe("exportHtml (sample-11, B-HTML)", () => {
  const sample = sample11Guide();
  const html = exportHtml(sample, sample11Images());

  it("is a single string with print CSS that keeps steps together", () => {
    expect(typeof html).toBe("string");
    expect(html).toContain("@media print");
    expect(html).toMatch(/\.step\s*\{[^}]*page-break-inside: avoid/);
    expect(html).toMatch(/\.step\s*\{[^}]*break-inside: avoid/);
    expect(html).toContain("@page");
  });

  it("has one inlined PNG per screenshot step", () => {
    expect((html.match(/<img src="data:image\/png;base64,/g) ?? []).length).toBe(sample.steps.filter((s) => s.screenshot).length);
  });

  it("references nothing external: no http(s), //cdn, url() or @import outside data: URIs", () => {
    const refs = externalRefs(html);
    expect(refs).toEqual([]);
    expect(html).not.toMatch(/\/\/cdn/i);
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/<link\b/i);
  });

  it("parses with parse5 without errors and stays under 6 MB", () => {
    expect(parseErrors(html)).toEqual([]);
    expect(Buffer.byteLength(html)).toBeLessThanOrEqual(6 * 1024 * 1024);
  });

  it("contains no password canary and matches the golden (structure only: images elided)", () => {
    expect(html).not.toContain(SAMPLE_CANARY_PASSWORD);
    expectGolden("html/sample-11.skeleton.html", html.replace(/base64,[A-Za-z0-9+/=]+/g, "base64,..."));
  });
});

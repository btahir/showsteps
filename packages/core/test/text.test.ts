import { describe, expect, it } from "vitest";
import { escapeInline, exportHtml, parseInline, plainTitle, renderInlineHtml, typographicQuotes } from "../src";
import { fixtureGuide, fixtureImages } from "./fixtures/guide";

describe("typographicQuotes", () => {
  it.each([
    ['Type "jane@example.com" in Email', "Type “jane@example.com” in Email"],
    ['"quoted" at the start', "“quoted” at the start"],
    ['say ("hi") now', "say (“hi”) now"],
    ["it's fine", "it’s fine"],
    ["a 'single' quote", "a ‘single’ quote"],
    ['Search for "refund policy"', "Search for “refund policy”"],
    ['**"bold"**', "**“bold”**"],
    ["no quotes", "no quotes"],
    ['5" wide', "5” wide"],
    ["", ""],
  ])("%s", (input, expected) => expect(typographicQuotes(input)).toBe(expected));

  it("uses the previous character when given a fragment of a longer text", () => {
    expect(typographicQuotes('"x"', "a")).toBe("”x”");
    expect(typographicQuotes('"x"', " ")).toBe("“x”");
  });
});

describe("straight quotes stay in titles and plain text, curly ones only in what people read", () => {
  it("plainTitle keeps the straight quotes", () => {
    expect(plainTitle('Type "jane@example.com" in **Email**')).toBe('Type "jane@example.com" in Email');
  });
  it("parseInline (the shared one) does not change quotes", () => {
    expect(parseInline('Type "a"').map((r) => r.text).join("")).toBe('Type "a"');
  });
  it("renderInlineHtml converts only when asked, and never inside code", () => {
    expect(renderInlineHtml('Type "a" in **B**')).toBe("Type &quot;a&quot; in <b>B</b>");
    expect(renderInlineHtml('Type "a" in **B**', { smartQuotes: true })).toBe("Type “a” in <b>B</b>");
    expect(renderInlineHtml('Run `say "x"` now', { smartQuotes: true })).toBe("Run <code>say &quot;x&quot;</code> now");
  });
  it("escapeInline does not touch quotes", () => {
    expect(escapeInline('"a"')).toBe('"a"');
  });
  it("the exported HTML shows curly quotes in step titles and alt text keeps the plain form", () => {
    const html = exportHtml(fixtureGuide(), fixtureImages());
    expect(html).toContain("Type “jane@example.com” in <b>Email</b>");
    expect(html).not.toContain("<h2>Type &quot;");
    expect(html).toContain('alt="Screenshot of step 2: Type &quot;jane@example.com&quot; in Email"');
  });
});

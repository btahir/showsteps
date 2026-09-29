import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, "../src");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? walk(join(dir, f)) : f.endsWith(".ts") ? [join(dir, f)] : []));
}

describe("B-PURE: packages/core/src has no DOM and no Node-only API", () => {
  const allow = readFileSync(join(HERE, "purity.allow"), "utf8")
    .split("\n")
    .filter((l) => l && !l.startsWith("#"))
    .map((l) => l.split("\t") as [string, string]);
  const FORBIDDEN = /from ['"](node:|fs|path|crypto|child_process|os)['"]|\bdocument\.|\bwindow\.|\bBuffer\b|process\.(env|argv)/;

  it("finds nothing outside purity.allow", () => {
    const hits: string[] = [];
    for (const file of walk(SRC)) {
      const rel = relative(SRC, file);
      if (rel.endsWith("default-fonts.ts") || rel.endsWith("brand-fonts.ts")) continue; // base64 data
      readFileSync(file, "utf8")
        .split("\n")
        .forEach((line, i) => {
          if (FORBIDDEN.test(line) && !allow.some(([p, text]) => p === rel && line.includes(text))) hits.push(`${rel}:${i + 1}: ${line.trim()}`);
        });
    }
    expect(hits).toEqual([]);
  });

  it("every allow entry is still needed", () => {
    for (const [p, text] of allow) expect(readFileSync(join(SRC, p), "utf8")).toContain(text);
  });

  it("does not import from Node built-ins anywhere, including type-only imports", () => {
    for (const file of walk(SRC)) expect(readFileSync(file, "utf8"), file).not.toMatch(/from ["']node:/);
  });
});

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect } from "vitest";

const DIR = join(dirname(fileURLToPath(import.meta.url)), "golden");

/**
 * Compare `actual` with `test/golden/<name>`. Run with `UPDATE_GOLDEN=1` to (re)write the file,
 * then review the diff. Text goldens are compared as UTF-8 strings, binary ones by SHA-256 in a
 * sidecar `.sha256` file.
 */
export function expectGolden(name: string, actual: string): void {
  const file = join(DIR, name);
  if (process.env.UPDATE_GOLDEN === "1") {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, actual);
    return;
  }
  if (!existsSync(file)) throw new Error(`Missing golden file test/golden/${name}. Run: UPDATE_GOLDEN=1 pnpm --filter @showsteps/core test`);
  const expected = readFileSync(file, "utf8");
  expect(actual, `golden test/golden/${name} (UPDATE_GOLDEN=1 to accept changes)`).toBe(expected);
}

export const sha256 = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

export function expectGoldenBytes(name: string, bytes: Uint8Array): void {
  expectGolden(`${name}.sha256`, sha256(bytes) + "\n");
}

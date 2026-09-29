#!/usr/bin/env node
// The SKILL.md and replay.spec.ts samples on the site must be what the real exporter produces.
//   node scripts/check-site-samples.mjs          compare (exit 1 on drift)
//   node scripts/check-site-samples.mjs --write  regenerate apps/site/src/data/samples/*
// Input: scripts/site-sample-steps.json, run through the built CLI (`showsteps new` + `export --format skill`)
// with SOURCE_DATE_EPOCH fixed. Owned by the verifier.
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CLI = join(ROOT, "packages/cli/dist/showsteps.js");
const OUT = join(ROOT, "apps/site/src/data/samples");
const WRITE = process.argv.includes("--write");
if (!process.argv.includes("--no-build") || !existsSync(CLI)) execFileSync("pnpm", ["--filter", "@showsteps/cli", "build"], { cwd: ROOT, stdio: "ignore" });

const tmp = mkdtempSync(join(tmpdir(), "showsteps-samples-"));
const env = { ...process.env, SOURCE_DATE_EPOCH: "1790553600" }; // 2026-09-28
try {
  execFileSync("node", [CLI, "new", "--from-steps", join(ROOT, "scripts/site-sample-steps.json"), "--out", join(tmp, "g.showsteps"), "--json"], { env, stdio: "pipe" });
  execFileSync("node", [CLI, "export", join(tmp, "g.showsteps"), "--format", "skill", "--out", join(tmp, "out"), "--json"], { env, stdio: "pipe" });
  const pairs = [["skill/SKILL.md", "SKILL.md"], ["skill/replay.spec.ts", "replay.spec.ts"]];
  let drift = 0;
  for (const [from, to] of pairs) {
    const real = readFileSync(join(tmp, "out", from), "utf8");
    const dest = join(OUT, to);
    const have = existsSync(dest) ? readFileSync(dest, "utf8") : null;
    if (have === real) { console.log(`ok     ${to} equals the real exporter output (${real.split("\n").length} lines)`); continue; }
    if (WRITE) { mkdirSync(OUT, { recursive: true }); writeFileSync(dest, real); console.log(`wrote  ${to}`); continue; }
    drift++;
    console.log(`DRIFT  ${to} differs from the real exporter output; run: node scripts/check-site-samples.mjs --write`);
  }
  process.exit(drift ? 1 : 0);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

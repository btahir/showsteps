#!/usr/bin/env node
// Runs the whole local check list in sequence and prints a summary table. Owned by the verifier.
//
//   pnpm verify                     everything
//   pnpm verify --skip-heavy        unit tests, typechecks, licences only (no browser, no site build)
//   pnpm verify --only core,site    substring filter on step names
//   pnpm verify --json              also write notes/verify-last.json (gitignored) with the raw results
//
// Heavy steps (site build, Playwright: no-network, axe) run through research/heavy.sh, one at a time.
// Exit code: 0 when no step failed (pending steps are listed but do not fail the run), 1 otherwise.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const HEAVY = join(ROOT, "..", "research", "heavy.sh");
const argv = process.argv.slice(2);
const SKIP_HEAVY = argv.includes("--skip-heavy");
const AS_JSON = argv.includes("--json");
const onlyIdx = argv.indexOf("--only");
const ONLY = onlyIdx >= 0 ? argv[onlyIdx + 1].split(",") : null;
const LOGS = join(ROOT, "notes", "verify-logs");
mkdirSync(LOGS, { recursive: true });

const pkgDirs = [...readdirSync(join(ROOT, "packages")).map((d) => join("packages", d)), ...readdirSync(join(ROOT, "apps")).map((d) => join("apps", d))]
  .filter((d) => existsSync(join(ROOT, d, "package.json")));
const pkgs = pkgDirs.map((d) => ({ dir: d, ...JSON.parse(readFileSync(join(ROOT, d, "package.json"), "utf8")) }));
const has = (p, s) => Boolean(p.scripts && p.scripts[s]);

/** Pull a test count out of vitest / node:test output. */
function testCount(out) {
  const v = out.match(/Tests\s+(?:(\d+) failed \| )?(\d+) passed(?: \| (\d+) skipped)?/);
  if (v) return `${v[2]} passed${v[1] ? `, ${v[1]} failed` : ""}${v[3] ? `, ${v[3]} skipped` : ""}`;
  const n = out.match(/(?:# |ℹ )pass (\d+)/);
  if (n) return `${n[1]} passed, ${(out.match(/(?:# |ℹ )fail (\d+)/) || [])[1] || 0} failed`;
  return "";
}

const steps = [];
const pnpm = (name, filter, script, opts = {}) => steps.push({ name, cmd: ["pnpm", "--filter", filter, script], parse: script === "test" ? testCount : undefined, ...opts });
const order = ["core", "dom", "cli", "mcp", "fixtures", "brand", "extension", "site"];
const sorted = [...pkgs].sort((a, b) => order.indexOf(a.dir.split("/")[1]) - order.indexOf(b.dir.split("/")[1]));
for (const p of sorted) {
  const short = p.dir.split("/")[1];
  if (has(p, "test")) pnpm(`${short} test`, p.name, "test");
  if (has(p, "typecheck")) pnpm(`${short} typecheck`, p.name, "typecheck");
}
// The D-NONET / MCP6 runs: same suites again with the network guard preloaded.
for (const short of ["cli", "mcp"]) {
  const p = pkgs.find((x) => x.dir === `packages/${short}`);
  if (p) steps.push({ name: `${short} test (no-network preload)`, cmd: ["pnpm", "--filter", p.name, "test"], env: { NODE_OPTIONS: `--require ${join(ROOT, "scripts", "no-network.cjs")}` }, parse: testCount });
}
steps.push({ name: "site samples = real exporter output", cmd: ["node", "scripts/check-site-samples.mjs"], parse: (o) => o.trim().split("\n").join(" | ") });
steps.push({ name: "licences (prod)", cmd: ["node", "scripts/check-licenses.mjs", "--prod"], parse: (o) => (o.match(/over (\d+) workspace packages, (\d+) unique/) || []).slice(1).join(" pkgs, ").replace(/^(\d+)/, "$1") });
steps.push({ name: "licences (all)", cmd: ["node", "scripts/check-licenses.mjs", "--all"] });
steps.push({ name: "licence SPDX self-test", cmd: ["node", "scripts/check-licenses.mjs", "--self-test"], parse: (o) => o.trim() });
steps.push({ name: "no-network preload self-test", cmd: ["node", "scripts/no-network.cjs", "--self-test"], parse: (o) => (o.match(/self-test: .*/) || [""])[0] });
steps.push({ name: "extension build (store)", cmd: ["pnpm", "--filter", "@stepsnap/extension", "build"], heavy: true, label: "showsteps-ext-build" });
steps.push({ name: "extension build (e2e)", cmd: ["pnpm", "--filter", "@stepsnap/extension", "build:e2e"], heavy: true, label: "showsteps-ext-build" });
steps.push({ name: "site build", cmd: ["pnpm", "--filter", "@stepsnap/site", "build"], heavy: true, label: "showsteps-site-build", parse: (o) => (o.match(/(\d+) page\(s\) built/) || [])[0] || "" });
steps.push({ name: "site static checks (K2-K20)", cmd: ["node", "scripts/check-site.mjs"], parse: (o) => (o.match(/\d+\/\d+ static site checks pass/) || [""])[0] });
steps.push({ name: "site no-network", cmd: ["node", "scripts/no-network.cjs", "site"], heavy: true, label: "showsteps-nonet-site", parse: (o) => o.split("\n").filter((l) => /pages x|external \(non-localhost\)/.test(l)).map((l) => l.trim()).join("; ") });
steps.push({ name: "site axe", cmd: ["node", "scripts/axe.mjs"], heavy: true, label: "showsteps-site-axe", cwd: "apps/site", parse: (o) => (o.match(/axe: .*|\d+ serious.*/) || [""])[0] });
steps.push({ name: "extension no-network", cmd: ["node", "scripts/no-network.cjs", "extension", "--idle-ms", "60000"], heavy: true, label: "showsteps-nonet-ext", pendingExit: 3, parse: (o) => (o.split("\n").find((l) => /pending|PASS|FAIL/i.test(l)) || "").trim() });
steps.push({ name: "cli and mcp black-box (D, MCP)", cmd: ["node", "scripts/check-cli-mcp.mjs"], parse: (o) => (o.match(/\d+\/\d+ CLI and MCP checks pass/) || [""])[0] });
steps.push({ name: "extension static (P1-P5)", cmd: ["node", "scripts/check-manifest.mjs"], parse: (o) => (o.match(/\d+\/\d+ extension static checks pass/) || [""])[0] });
steps.push({ name: "extension e2e (builder)", cmd: ["pnpm", "--filter", "@stepsnap/extension", "e2e"], heavy: true, label: "showsteps-ext-e2e", parse: (o) => (o.match(/\d+ passed[^\n]*/) || [""])[0] });
steps.push({ name: "extension acceptance e2e (E1 R H G)", cmd: ["node", "scripts/e2e-extension.mjs"], heavy: true, label: "showsteps-verify-e2e", parse: (o) => (o.match(/\d+\/\d+ extension acceptance checks pass/) || [""])[0] });
steps.push({ name: "dom e2e", cmd: ["pnpm", "--filter", "@stepsnap/dom", "exec", "playwright", "test", "--workers=2", "--project=chrome"], heavy: true, label: "showsteps-dom-e2e", parse: (o) => (o.match(/\d+ passed[^\n]*/) || [""])[0] });

const rows = [];
const started = Date.now();
for (const s of steps) {
  if (ONLY && !ONLY.some((o) => s.name.includes(o))) continue;
  if (SKIP_HEAVY && s.heavy) { rows.push({ name: s.name, status: "SKIP", detail: "--skip-heavy", secs: 0 }); continue; }
  const cmd = s.heavy ? [HEAVY, ...s.cmd] : s.cmd;
  const t0 = Date.now();
  process.stderr.write(`> ${s.name} ... `);
  const r = spawnSync(cmd[0], cmd.slice(1), {
    cwd: s.cwd ? join(ROOT, s.cwd) : ROOT,
    env: { ...process.env, ...(s.env || {}), ...(s.heavy ? { HEAVY_LABEL: s.label || s.name, CI: "" } : {}) },
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  });
  const out = `${r.stdout || ""}\n${r.stderr || ""}`;
  const secs = (Date.now() - t0) / 1000;
  const file = join(LOGS, `${s.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.log`);
  writeFileSync(file, out);
  let status = r.status === 0 ? "PASS" : s.pendingExit && r.status === s.pendingExit ? "PENDING" : "FAIL";
  // `astro check` asks to install @astrojs/check and exits 0 when stdin is closed: that is not a pass.
  const notInstalled = /requires the following dependency to be installed: @astrojs\/check/.test(out);
  if (notInstalled) status = "PENDING";
  const detail = (notInstalled ? "@astrojs/check is not installed: astro check did not run" : "") || (s.parse ? s.parse(out) : "") || (status === "FAIL" ? lastLine(out) : "");
  rows.push({ name: s.name, status, detail, secs, log: file.replace(ROOT + "/", "") });
  process.stderr.write(`${status} (${secs.toFixed(1)}s)\n`);
}
function lastLine(o) { return o.trim().split("\n").filter(Boolean).slice(-1)[0]?.slice(0, 100) ?? ""; }

const w = Math.max(...rows.map((r) => r.name.length));
console.log("\n" + "step".padEnd(w) + "  status   time    detail");
console.log("-".repeat(w + 40));
for (const r of rows) console.log(r.name.padEnd(w) + "  " + r.status.padEnd(7) + "  " + `${r.secs.toFixed(1)}s`.padEnd(6) + "  " + r.detail);
const failed = rows.filter((r) => r.status === "FAIL");
const pending = rows.filter((r) => r.status === "PENDING");
console.log(`\n${rows.length - failed.length - pending.length - rows.filter((r) => r.status === "SKIP").length} passed, ${failed.length} failed, ${pending.length} pending, ${rows.filter((r) => r.status === "SKIP").length} skipped in ${((Date.now() - started) / 1000).toFixed(0)}s. Logs: notes/verify-logs/`);
if (AS_JSON) writeFileSync(join(ROOT, "notes", "verify-last.json"), JSON.stringify({ at: new Date().toISOString(), node: process.version, rows }, null, 2));
process.exit(failed.length ? 1 : 0);

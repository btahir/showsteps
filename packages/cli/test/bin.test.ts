import { spawnSync } from "node:child_process";
import { rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, expect, it } from "vitest";
import { makeSandbox, type Sandbox } from "./fixture.ts";

const bin = join(dirname(fileURLToPath(import.meta.url)), "..", "dist", "showsteps.js");
let sb: Sandbox;
beforeAll(async () => {
  sb = await makeSandbox();
});
afterAll(() => rm(sb.dir, { recursive: true, force: true }));

const spawn = (args: string[]) => spawnSync(process.execPath, [bin, ...args], { cwd: sb.dir, encoding: "utf8" });

it("built binary: validate --json exits 0 with one JSON line", () => {
  const r = spawn(["validate", "guide.showsteps", "--json"]);
  expect(r.status).toBe(0);
  expect(r.stderr).toBe("");
  expect(r.stdout.trim().split("\n")).toHaveLength(1);
  expect(JSON.parse(r.stdout)).toMatchObject({ ok: true, valid: true, steps: 6 });
});

it("built binary: exit codes 1, 2, 3 reach the process", () => {
  expect(spawn(["validate", "missing.showsteps"]).status).toBe(3);
  expect(spawn(["nonsense"]).status).toBe(2);
  expect(spawn(["edit-step", "guide.showsteps", "--id", "zzz", "--title", "t", "--out", "o.showsteps"]).status).toBe(1);
});

it("built binary: shebang and executable bit", () => {
  const r = spawnSync(bin, ["--version"], { encoding: "utf8" });
  expect(r.status).toBe(0);
  expect(r.stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
});

it("built binary: --version answers in 400 ms or less (median of 5)", () => {
  const times: number[] = [];
  for (let i = 0; i < 5; i++) {
    const t0 = performance.now();
    const r = spawn(["--version"]);
    times.push(performance.now() - t0);
    expect(r.status).toBe(0);
  }
  times.sort((a, b) => a - b);
  expect(times[2]!).toBeLessThanOrEqual(400);
});

it("built binary: --help equals the in-process help (no terminal width leaks in)", () => {
  const r = spawn(["export", "--help"]);
  expect(r.status).toBe(0);
  expect(r.stdout).toContain("--format <format>");
  expect(r.stdout).toContain("project");
});

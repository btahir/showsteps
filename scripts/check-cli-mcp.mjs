#!/usr/bin/env node
// Black-box checks of the built CLI (ACCEPTANCE D1-D9) and MCP server (MCP1-MCP7) on the 11-step sample guide.
// Owned by the verifier. Builds sample-11.showsteps from packages/core/test/fixtures with esbuild, then runs the
// real binaries. Prints PASS/FAIL per check with the measured numbers; exit 1 when any check fails.
//   node scripts/check-cli-mcp.mjs [--json]
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CLI = join(ROOT, "packages/cli/dist/showsteps.js");
const MCP = join(ROOT, "packages/mcp/dist/showsteps-mcp.js");
const results = [];
const check = (id, ok, detail) => { results.push({ id, ok, detail }); console.log(`${ok ? "PASS" : "FAIL"} ${id.padEnd(8)} ${detail}`); };
execFileSync("pnpm", ["--filter", "@stepsnap/cli", "build"], { cwd: ROOT, stdio: "ignore" });
execFileSync("pnpm", ["--filter", "@stepsnap/mcp", "build"], { cwd: ROOT, stdio: "ignore" });
const tmp = mkdtempSync(join(tmpdir(), "showsteps-cli-"));
const run = (args, opts = {}) => spawnSync(process.execPath, [CLI, ...args], { encoding: "utf8", env: { ...process.env, ...(opts.env ?? {}) }, cwd: opts.cwd });
const jsonOf = (r) => { try { return JSON.parse(r.stdout); } catch { return null; } };

// ---- sample guide
const esbuild = createRequire(join(ROOT, "packages/cli/package.json"))("esbuild");
const built = await esbuild.build({
  stdin: { contents: `import { packBundle } from "./src/index.ts"; import { sample11Guide, sample11Images } from "./test/fixtures/sample11.ts"; import { writeFileSync } from "node:fs"; writeFileSync(process.env.OUT, packBundle(sample11Guide(), sample11Images()));`, resolveDir: join(ROOT, "packages/core"), loader: "ts", sourcefile: "gen.ts" },
  bundle: true, platform: "node", format: "esm", write: false, logLevel: "silent", banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
});
const S = join(tmp, "sample-11.showsteps");
writeFileSync(join(tmp, "gen.mjs"), built.outputFiles[0].text);
execFileSync(process.execPath, [join(tmp, "gen.mjs")], { env: { ...process.env, OUT: S }, cwd: join(ROOT, "packages/core") });

// D1
const times = [];
for (let i = 0; i < 5; i++) { const t0 = process.hrtime.bigint(); run(["--version"]); times.push(Number(process.hrtime.bigint() - t0) / 1e6); }
times.sort((a, b) => a - b);
const cmds = ["validate", "info", "steps", "edit-step", "regen-titles", "export", "new"];
const helps = cmds.map((c) => run([c, "--help"]));
const goldenHelp = existsSync(join(ROOT, "packages/cli/test/golden/help.txt")) || existsSync(join(ROOT, "packages/cli/test/golden/help"));
check("D1", times[2] <= 400 && helps.every((h) => h.status === 0) && goldenHelp, `--version median ${times[2].toFixed(0)} ms (limit 400); ${helps.filter((h) => h.status === 0).length}/${cmds.length} subcommand --help exit 0; help goldens in packages/cli/test/golden: ${goldenHelp ? "yes" : "NO (the box requires --help output equal to goldens)"}`);
// D2
const ok = run(["validate", S, "--json"]); const okj = jsonOf(ok);
const bad = join(tmp, "bad.json"); writeFileSync(bad, '{"nope":1}');
const badr = run(["validate", bad, "--json"]); const badj = jsonOf(badr);
check("D2", ok.status === 0 && okj?.ok === true && badr.status === 1 && badj?.ok === false && Array.isArray(badj?.errors) && badj.errors.length >= 1, `valid: exit ${ok.status} ok=${okj?.ok}; invalid: exit ${badr.status} ok=${badj?.ok}, top-level errors[] ${Array.isArray(badj?.errors) ? badj.errors.length : "absent (shape is error.errors[] " + (badj?.error?.errors?.length ?? 0) + ")"}`);
// D3
const info = jsonOf(run(["info", S, "--json"]));
const d3keys = ["stepCount", "activeSteps"]; const d3has = ["sensitiveSteps", "screenshots"].every((k) => k in (info ?? {}));
check("D3", info?.stepCount === 11 && d3keys.every((k) => k in info) && d3has && "sizeBytes" in info, `stepCount ${info?.stepCount}, activeSteps ${info?.activeSteps}, screenshots ${JSON.stringify(info?.screenshots)}, sensitive steps ${info?.sensitiveSteps?.length}, size in bytes: ${"sizeBytes" in (info ?? {}) ? "yes" : "no (box requires it)"}, title list: ${"titles" in (info ?? {}) ? "yes" : "no (box requires it)"}`);
// D4
const fmts = ["md", "html", "pdf", "docx", "playwright", "skill", "project"];
const d4 = [];
for (const f of fmts) { const r = run(["export", S, "--format", f, "--out", join(tmp, "o1", f), "--json"]); const j = jsonOf(r); d4.push([f, r.status, j?.ok, Array.isArray(j?.files) && typeof j.files[0] === "object"]); }
check("D4", d4.every((x) => x[1] === 0 && x[2] && x[3]), d4.map((x) => `${x[0]}:exit ${x[1]}${x[3] ? "" : " (files are plain strings, not {path,bytes})"}`).join(", "));
// D5
const d5 = { missing: run(["info", join(tmp, "nope.showsteps"), "--json"]).status, unwritable: run(["export", S, "--format", "md", "--out", "/proc/nope/x", "--json"]).status, badformat: run(["export", S, "--format", "wat", "--out", join(tmp, "x"), "--json"]).status, badflag: run(["export", S, "--bogus", "--json"]).status, invalid: run(["export", bad, "--format", "md", "--out", join(tmp, "oinv"), "--json"]).status };
check("D5", d5.missing === 3 && d5.unwritable === 3 && d5.badformat === 2 && d5.badflag === 2 && d5.invalid === 1 && !existsSync(join(tmp, "oinv")), `exit codes ${JSON.stringify(d5)} (want 3,3,2,2,1); no partial output on invalid: ${!existsSync(join(tmp, "oinv"))}`);
// D6
const d6 = ["validate", "info", "steps"].map((c) => run([c, S, "--json"])).concat([run(["export", S, "--format", "md", "--out", join(tmp, "o6"), "--json"])]);
check("D6", d6.every((r) => r.stdout.endsWith("\n") && r.stdout.trim().split("\n").length === 1 && jsonOf(r) !== null), `4 commands: stdout is exactly one JSON document + newline: ${d6.every((r) => jsonOf(r) !== null && r.stdout.trim().split("\n").length === 1)}`);
// D7 (non-PNG half; pixel half is B-RASTER + the CLI test "exported screenshots are re-rendered")
const python = spawnSync("python3", ["-c", `
import zipfile
zin=zipfile.ZipFile(r'${S}'); zout=zipfile.ZipFile(r'${join(tmp, "jpeg.showsteps")}','w',zipfile.ZIP_DEFLATED)
for i in zin.infolist():
    d=zin.read(i.filename)
    if i.filename=='images/s02.png': d=bytes([0xFF,0xD8,0xFF,0xE0])+b'\\x00'*200
    zout.writestr(i.filename,d)
zout.close()`], { encoding: "utf8" });
const jp = run(["export", join(tmp, "jpeg.showsteps"), "--format", "md", "--out", join(tmp, "ojpeg"), "--json"]);
check("D7-nonpng", python.status === 0 && jp.status === 1 && !existsSync(join(tmp, "ojpeg")), `redaction on a non-PNG image: exit ${jp.status}, nothing written: ${!existsSync(join(tmp, "ojpeg"))}, message: ${(jsonOf(jp)?.error?.message ?? "").slice(0, 90)}`);
// D8
const rerun = (dir) => { for (const f of ["md", "html", "pdf", "docx", "playwright", "skill"]) run(["export", S, "--format", f, "--out", join(tmp, dir, f), "--json"]); };
rerun("o2"); rerun("o3");
const diff = spawnSync("diff", ["-rq", join(tmp, "o2"), join(tmp, "o3")], { encoding: "utf8" });
check("D8", diff.status === 0 && d4.find((x) => x[0] === "project")?.[1] === 0, `two exports (md html pdf docx playwright skill), no SOURCE_DATE_EPOCH: ${diff.status === 0 ? "byte-identical" : diff.stdout.trim()}; format project ${d4.find((x) => x[0] === "project")?.[1] === 0 ? "exists" : "missing"}`);
// D9
check("D9", d4.find((x) => x[0] === "project")?.[1] === 0, "`export --format project` " + (d4.find((x) => x[0] === "project")?.[1] === 0 ? "works" : "does not exist (exit 2, unknown format); the round trip needs it"));

// ---- MCP
const rpc = (input) => new Promise((res) => {
  const p = spawn(process.execPath, [MCP], { stdio: ["pipe", "pipe", "pipe"] });
  let out = "", err = ""; p.stdout.on("data", (d) => (out += d)); p.stderr.on("data", (d) => (err += d));
  const t0 = Date.now();
  p.on("exit", (code) => res({ out, err, code, ms: Date.now() - t0 }));
  p.stdin.write(input.map((m) => JSON.stringify(m)).join("\n") + "\n");
  setTimeout(() => p.stdin.end(), 1500);
});
const init = [{ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "v", version: "1" } } }, { jsonrpc: "2.0", method: "notifications/initialized" }];
const s1 = await rpc([...init, { jsonrpc: "2.0", id: 2, method: "tools/list" },
  { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "validate_guide", arguments: { path: S, image: "aGVsbG8=" } } },
  { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "list_steps", arguments: { path: "/nonexistent.showsteps" } } },
  { jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "list_steps", arguments: { path: S } } }]);
const lines = s1.out.split("\n").filter(Boolean); let parsed = []; let unparse = 0;
for (const l of lines) { try { parsed.push(JSON.parse(l)); } catch { unparse++; } }
const byId = Object.fromEntries(parsed.filter((m) => m.id).map((m) => [m.id, m]));
const tools = byId[2]?.result?.tools ?? [];
const want = ["create_guide_from_steps", "edit_step", "export_guide", "list_steps", "validate_guide"];
const names = tools.map((t) => t.name).sort();
check("MCP1", JSON.stringify(names) === JSON.stringify(want) && tools.every((t) => t.inputSchema.additionalProperties === false && t.description.length >= 40) && byId[1]?.result?.serverInfo?.name === "showsteps-mcp", `${names.length} tools ${names.join(",")}; additionalProperties:false on ${tools.filter((t) => t.inputSchema.additionalProperties === false).length}/${tools.length}; serverInfo.name ${byId[1]?.result?.serverInfo?.name}`);
check("MCP3", byId[4]?.result?.isError === true && byId[5]?.result?.isError !== true, `missing path: isError=${byId[4]?.result?.isError}, code ${byId[4]?.result?.structuredContent?.error?.code}; the next list_steps ok=${byId[5]?.result?.isError !== true}`);
check("MCP4", unparse === 0 && lines.length >= 5, `${lines.length} stdout lines, ${unparse} not JSON`);
check("MCP5-exit", s1.code === 0 && s1.ms < 4000, `exit code ${s1.code} after stdin closed (whole session ${s1.ms} ms incl. the 1.5 s hold)`);
const s2 = await rpc([...init, ...Array.from({ length: 20 }, (_, i) => ({ jsonrpc: "2.0", id: 100 + i, method: "tools/call", params: { name: "validate_guide", arguments: { path: S } } }))]);
const okCalls = s2.out.split("\n").filter(Boolean).filter((l) => /"id":1\d\d/.test(l)).length;
check("MCP5", okCalls === 20 && s2.ms - 1500 <= 5000, `20 sequential tool calls answered: ${okCalls}, session ${s2.ms - 1500} ms (limit 5000 excluding the 1.5 s hold)`);
const accepted = byId[3]?.result && byId[3].result.isError !== true;
check("MCP7", !accepted, `validate_guide with an extra base64 "image" argument: ${accepted ? "ACCEPTED silently (schema is not strict)" : "rejected"}`);

rmSync(tmp, { recursive: true, force: true });
const fails = results.filter((r) => !r.ok);
console.log(`\n${results.length - fails.length}/${results.length} CLI and MCP checks pass`);
if (process.argv.includes("--json")) console.log(JSON.stringify(results, null, 2));
process.exit(fails.length ? 1 : 0);

#!/usr/bin/env node
// Licence gate (ACCEPTANCE I1/I2). Owned by the verifier.
//
//   node scripts/check-licenses.mjs [--prod | --all] [--json] [--verbose]
//
// * Walks every workspace package with `pnpm --filter <pkg> licenses list --json [--prod]`.
// * Evaluates each SPDX expression: `A OR B` passes when any branch is allowed (the chosen branch is
//   recorded), `A AND B` passes only when all branches are allowed, `WITH` exceptions are ignored.
// * Fails on GPL, AGPL, LGPL, SSPL, proprietary and unknown licences unless the package is in
//   scripts/licence-allowlist.json with a reason.
// * Scans committed font folders for a licence text, and lists image/font assets missing from CREDITS.md.
//
// --prod (default): production closure only. --all: also dev dependencies (each licence outside the
// allowed list must then be covered by the allowlist, see I2).
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, basename, extname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = new Set(process.argv.slice(2));
const MODE = args.has("--all") ? "all" : "prod";
const AS_JSON = args.has("--json");
const VERBOSE = args.has("--verbose");

// ---------- policy ----------
// Exact SPDX ids allowed everywhere. Families are matched by prefix below.
const ALLOWED = new Set([
  "MIT", "MIT-0", "ISC", "0BSD", "Apache-2.0", "Zlib", "BlueOak-1.0.0", "MPL-2.0",
  "CC0-1.0", "Unlicense", "WTFPL", "OFL-1.1", "OFL-1.1-RFN", "OFL-1.1-no-RFN",
]);
const ALLOWED_PREFIXES = ["BSD-", "CC-BY-"]; // BSD-2-Clause, BSD-3-Clause, CC-BY-4.0 ... (not CC-BY-NC/ND/SA below)
const DENIED_RE = /(^|[^A-Z])(A?L?GPL|SSPL|BUSL|Commons-Clause|Elastic|CC-BY-(NC|ND|SA)|EUPL|CPAL|OSL|RPL|proprietary|commercial|UNLICENSED)/i;
// Allowed only outside the production closure (ACCEPTANCE I1: dev only).
const DEV_ONLY = new Set(["Python-2.0"]);

const ALLOWLIST_FILE = join(ROOT, "scripts", "licence-allowlist.json");
const allowlist = existsSync(ALLOWLIST_FILE) ? JSON.parse(readFileSync(ALLOWLIST_FILE, "utf8")) : { packages: [] };
for (const e of allowlist.packages) if (!e.reason || e.reason.length < 20) fail(`allowlist entry ${e.name} needs a real reason`);
function fail(msg) { console.error(`check-licenses: ${msg}`); process.exit(2); }

function globToRe(g) { return new RegExp("^" + g.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*") + "$"); }
function allowlisted(name, license) {
  return allowlist.packages.find((e) => globToRe(e.name).test(name) && (!e.license || e.license === license));
}

// ---------- SPDX evaluation ----------
function tokenize(s) {
  const out = [];
  const re = /\s*(\(|\)|[^\s()]+)/g;
  let m;
  while ((m = re.exec(s))) out.push(m[1]);
  return out;
}
/** Returns { ok, chosen: string[], reasons: string[] } for one licence expression. */
function evaluate(expr, prodMode) {
  const toks = tokenize(expr);
  let i = 0;
  const peek = () => toks[i];
  const next = () => toks[i++];
  function atom() {
    const t = next();
    if (t === undefined) throw new Error("unexpected end");
    if (t === "(") {
      const v = orExpr();
      if (next() !== ")") throw new Error("missing )");
      return v;
    }
    let id = t.replace(/\+$/, "");
    if (peek() && peek().toUpperCase() === "WITH") { next(); next(); } // exception id: ignore
    return leaf(id, prodMode);
  }
  function andExpr() {
    let v = atom();
    while (peek() && peek().toUpperCase() === "AND") {
      next();
      const r = atom();
      v = { ok: v.ok && r.ok, chosen: [...v.chosen, ...r.chosen], reasons: [...v.reasons, ...r.reasons] };
    }
    return v;
  }
  function orExpr() {
    let v = andExpr();
    while (peek() && peek().toUpperCase() === "OR") {
      next();
      const r = andExpr();
      // any allowed branch wins; prefer the first allowed one
      v = v.ok ? v : r.ok ? r : { ok: false, chosen: [], reasons: [...v.reasons, ...r.reasons] };
    }
    return v;
  }
  const v = orExpr();
  if (i < toks.length) throw new Error(`trailing tokens: ${toks.slice(i).join(" ")}`);
  return v;
}
function leaf(id, prodMode) {
  if (DENIED_RE.test(id)) return { ok: false, chosen: [], reasons: [`${id} is a denied licence family`] };
  if (ALLOWED.has(id) || ALLOWED_PREFIXES.some((p) => id.startsWith(p))) return { ok: true, chosen: [id], reasons: [] };
  if (DEV_ONLY.has(id)) {
    return prodMode
      ? { ok: false, chosen: [], reasons: [`${id} is allowed for dev dependencies only`] }
      : { ok: true, chosen: [id], reasons: [] };
  }
  return { ok: false, chosen: [], reasons: [`${id} is not on the allowed list`] };
}

if (args.has("--self-test")) {
  const cases = [
    ["MIT", true], ["(MIT OR GPL-3.0-or-later)", true], ["(MIT AND Zlib)", true], ["GPL-3.0-only", false],
    ["(GPL-2.0 OR LGPL-3.0)", false], ["AGPL-3.0-or-later", false], ["LGPL-2.1", false], ["SSPL-1.0", false],
    ["Apache-2.0 WITH LLVM-exception", true], ["(MIT AND GPL-3.0)", false], ["BSD-3-Clause", true],
    ["(BSD-2-Clause OR MIT OR Apache-2.0)", true], ["OFL-1.1", true], ["CC-BY-4.0", true], ["CC-BY-NC-4.0", false],
    ["Unknown", false], ["SEE LICENSE IN LICENSE.txt", "throws"], ["Python-2.0", false], ["MPL-2.0", true], ["CC0-1.0", true],
    ["(MIT OR (GPL-2.0 AND MIT))", true], ["MIT OR", "throws"],
  ];
  let bad = 0;
  for (const [expr, want] of cases) {
    let got;
    try { got = evaluate(expr, true).ok && !/^unknown$|^see license/i.test(expr); } catch { got = "throws"; }
    if (got !== want) { bad++; console.error(`self-test FAIL: ${expr} expected ${want} got ${got}`); }
  }
  console.log(bad ? `self-test: ${bad} failed` : `self-test: ${cases.length} SPDX cases ok`);
  process.exit(bad ? 1 : 0);
}

// ---------- collect ----------
function run(cmd, cmdArgs) {
  return execFileSync(cmd, cmdArgs, { cwd: ROOT, encoding: "utf8", maxBuffer: 256 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
}
const workspace = JSON.parse(run("pnpm", ["-r", "ls", "--json", "--depth", "-1"]));
const packages = workspace.filter((p) => p.path !== ROOT).map((p) => ({ name: p.name, path: p.path }));
// A workspace package's own licence field is checked too (root + packages).
const results = []; // one row per (workspace package, dependency)
const seen = new Map(); // name@version@license -> row, for the summary
for (const pkg of packages) {
  const listArgs = ["--filter", pkg.name, "licenses", "list", "--json", ...(MODE === "prod" ? ["--prod"] : [])];
  let raw;
  try { raw = run("pnpm", listArgs); } catch (e) { fail(`pnpm licenses failed for ${pkg.name}: ${e.stderr || e.message}`); }
  const start = raw.indexOf("{");
  const byLicense = start >= 0 ? JSON.parse(raw.slice(start)) : {};
  for (const [license, deps] of Object.entries(byLicense)) {
    for (const d of deps) {
      for (const v of d.versions) {
        results.push({ workspace: pkg.name, name: d.name, version: v, license, path: d.paths?.[0] ?? "" });
      }
    }
  }
}

const rows = new Map();
for (const r of results) {
  const key = `${r.name}@${r.version}\u0000${r.license}`;
  const row = rows.get(key) ?? { ...r, workspaces: new Set() };
  row.workspaces.add(r.workspace);
  rows.set(key, row);
}

const failures = [];
const dual = [];
const allowlistedUsed = [];
const counts = {};
for (const row of rows.values()) {
  counts[row.license] = (counts[row.license] ?? 0) + 1;
  const ws = [...row.workspaces].sort();
  let verdict;
  try {
    verdict = evaluate(row.license, MODE === "prod");
  } catch (e) {
    verdict = { ok: false, chosen: [], reasons: [`unparseable licence "${row.license}" (${e.message})`] };
  }
  if (/^unknown$|^unlicensed$|^see license|^custom|^$/i.test(row.license.trim())) verdict = { ok: false, chosen: [], reasons: ["unknown licence"] };
  if (!verdict.ok) {
    const a = allowlisted(row.name, row.license);
    if (a) { allowlistedUsed.push({ name: row.name, version: row.version, license: row.license, reason: a.reason, workspaces: ws }); continue; }
    failures.push({ name: row.name, version: row.version, license: row.license, why: verdict.reasons.join("; "), workspaces: ws });
    continue;
  }
  if (/\b(OR|AND)\b/.test(row.license)) dual.push({ name: row.name, version: row.version, expression: row.license, accepted_as: verdict.chosen.join(" + "), workspaces: ws });
}

// ---------- fonts and assets ----------
const listFiles = () => {
  try { return run("git", ["ls-files", "-co", "--exclude-standard"]).split("\n").filter(Boolean); } catch { return []; }
};
const files = listFiles();
const FONT_EXT = new Set([".woff", ".woff2", ".ttf", ".otf", ".eot"]);
const IMG_EXT = new Set([".png", ".jpg", ".jpeg", ".webp", ".svg", ".ico"]);
const LICENCE_NAME = /^(OFL|LICEN[CS]E|COPYING|UNLICENSE)([-_.].*)?$/i;
const fontFiles = files.filter((f) => FONT_EXT.has(extname(f).toLowerCase()));
const fontDirs = [...new Set(fontFiles.map((f) => dirname(f)))];
const fontReport = [];
const credits = existsSync(join(ROOT, "CREDITS.md")) ? readFileSync(join(ROOT, "CREDITS.md"), "utf8") : "";
const creditsWarnings = [];
const spaced = (s) => s.replace(/([a-z])([A-Z0-9])/g, "$1 $2").toLowerCase();
for (const dir of fontDirs) {
  // Licence texts in the same folder (or up to two folders above, inside the same asset root).
  const cands = [];
  let d = dir;
  for (let up = 0; up < 3 && d && d !== "."; up++, d = dirname(d)) {
    for (const n of readdirSync(join(ROOT, d))) if (LICENCE_NAME.test(n) || (/licen[cs]e|ofl/i.test(n) && /\.(txt|md)$/i.test(n))) cands.push(join(d, n));
    if (cands.length) break;
  }
  const texts = cands.map((f) => ({ f, text: readFileSync(join(ROOT, f), "utf8") }));
  const kindOf = (t) => (/SIL OPEN FONT LICENSE/i.test(t) ? "OFL-1.1" : /Apache License/i.test(t) ? "Apache-2.0" : /Permission is hereby granted/i.test(t) ? "MIT" : "unrecognised");
  const dirFiles = fontFiles.filter((f) => dirname(f) === dir);
  const families = new Map(); // family -> [files]
  for (const f of dirFiles) {
    const fam = basename(f).split(/[-_.]/)[0];
    families.set(fam, [...(families.get(fam) ?? []), f]);
  }
  for (const [fam, ffiles] of families) {
    const famKey = fam.toLowerCase();
    // A licence file belongs to a family when its file name or its copyright line names it; a lone licence file covers the folder.
    const match = texts.find((t) => basename(t.f).toLowerCase().replace(/[^a-z0-9]/g, "").includes(famKey) || t.text.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 400).includes(famKey))
      ?? (texts.length === 1 ? texts[0] : null);
    const kind = match ? kindOf(match.text) : "missing";
    fontReport.push({ dir, family: fam, files: ffiles.length, licenceFile: match?.f ?? null, licence: kind });
    if (kind === "missing" || kind === "unrecognised") failures.push({ name: `font ${fam} in ${dir}`, version: "", license: kind, why: `no recognisable licence text for ${ffiles.length} font file(s)`, workspaces: [] });
    const nice = spaced(fam);
    if (!credits.toLowerCase().includes(nice) && !credits.toLowerCase().includes(famKey)) creditsWarnings.push(`CREDITS.md does not list font family "${nice}" (${kind}, ${dir})`);
  }
}

const creditsLower = credits.toLowerCase();
const assetWarnings = [];
const assetFiles = files.filter((f) => IMG_EXT.has(extname(f).toLowerCase()) && !/(^|\/)(node_modules|dist|\.output|\.astro)\//.test(f));
for (const f of assetFiles) {
  const base = basename(f).toLowerCase();
  const dir = basename(dirname(f)).toLowerCase();
  if (!creditsLower.includes(base) && !creditsLower.includes(f.toLowerCase()) && !creditsLower.includes(`${dir}/`) && !creditsLower.includes("all svg") ) assetWarnings.push(f);
}
const assetDirsWithLicence = [];
for (const dir of new Set(assetFiles.map((f) => dirname(f)))) {
  const abs = join(ROOT, dir);
  if (readdirSync(abs).some((n) => LICENCE_NAME.test(n))) assetDirsWithLicence.push(dir);
}

// ---------- report ----------
const summary = {
  mode: MODE,
  packagesScanned: packages.map((p) => p.name),
  dependencyRows: rows.size,
  licenceCounts: counts,
  failures,
  dualLicensed: dual,
  allowlisted: allowlistedUsed,
  fonts: fontReport,
  creditsWarnings,
  assetsNotMentionedInCredits: assetWarnings,
  ok: failures.length === 0,
};
if (AS_JSON) {
  console.log(JSON.stringify(summary, null, 2));
} else {
  console.log(`licence check (${MODE}) over ${packages.length} workspace packages, ${rows.size} unique dependency versions`);
  console.log("licences: " + Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(", "));
  if (dual.length) {
    console.log("\ndual/compound licences (accepted):");
    for (const d of dual) console.log(`  ${d.name}@${d.version}  ${d.expression}  -> accepted as ${d.accepted_as}  [${d.workspaces.join(", ")}]`);
  }
  if (allowlistedUsed.length) {
    console.log("\nallowlisted (would otherwise fail):");
    for (const a of allowlistedUsed) console.log(`  ${a.name}@${a.version}  ${a.license}  [${a.workspaces.join(", ")}]\n    reason: ${a.reason}`);
  }
  console.log("\nfont folders:");
  if (!fontReport.length) console.log("  (none)");
  for (const f of fontReport) console.log(`  ${f.dir}  ${f.family}  ${f.files} file(s)  licence: ${f.licence}${f.licenceFile ? ` (${f.licenceFile})` : ""}`);
  for (const w of creditsWarnings) console.log(`  warning: ${w}`);
  console.log(`\nimage assets: ${assetFiles.length}; ${assetWarnings.length} not named in CREDITS.md${VERBOSE || assetWarnings.length < 15 ? "" : " (use --verbose to list)"}`);
  if (VERBOSE || assetWarnings.length < 15) for (const a of assetWarnings) console.log(`  ? ${a}`);
  if (failures.length) {
    console.log("\nFAILURES:");
    for (const f of failures) console.log(`  ${f.name}${f.version ? "@" + f.version : ""}  ${f.license}  ${f.why}  [${f.workspaces.join(", ")}]`);
  }
  console.log(failures.length ? `\nFAIL: ${failures.length} problem(s)` : "\nPASS");
}
process.exit(failures.length ? 1 : 0);

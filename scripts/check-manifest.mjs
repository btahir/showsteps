#!/usr/bin/env node
// Static checks on the built extension (ACCEPTANCE P1-P5 and the size budgets of E12). Owned by the verifier
// because the extension agent did not ship one. No browser needed.
//   pnpm --filter @showsteps/extension build && pnpm --filter @showsteps/extension build:e2e
//   node scripts/check-manifest.mjs [--json]
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { gzipSync } from "node:zlib";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const EXT = join(ROOT, "apps/extension");
const STORE = join(EXT, ".output/chrome-mv3-production");
const E2E = join(EXT, ".output/chrome-mv3-e2e");
const out = [];
const rec = (id, ok, detail) => out.push({ id, ok, detail });
for (const d of [STORE, E2E]) if (!existsSync(join(d, "manifest.json"))) { console.error(`missing build ${relative(ROOT, d)}: run build and build:e2e first`); process.exit(2); }
const st = JSON.parse(readFileSync(join(STORE, "manifest.json"), "utf8"));
const e2 = JSON.parse(readFileSync(join(E2E, "manifest.json"), "utf8"));
const pkg = JSON.parse(readFileSync(join(EXT, "package.json"), "utf8"));
const sameSet = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
const walk = (dir, acc = []) => { for (const e of readdirSync(dir, { withFileTypes: true })) { const p = join(dir, e.name); e.isDirectory() ? walk(p, acc) : acc.push(p); } return acc; };

// P1
const p1 = [];
if (!sameSet(st.permissions ?? [], ["activeTab", "scripting", "storage", "sidePanel", "unlimitedStorage"])) p1.push(`permissions ${JSON.stringify(st.permissions)}`);
if (!sameSet(st.optional_host_permissions ?? [], ["<all_urls>"])) p1.push(`optional_host_permissions ${JSON.stringify(st.optional_host_permissions)}`);
for (const k of ["host_permissions", "content_scripts", "web_accessible_resources", "externally_connectable", "content_security_policy"]) if (k in st) p1.push(`has ${k}`);
if (st.background?.persistent !== undefined) p1.push("background.persistent present");
if (st.action?.default_popup) p1.push("action.default_popup present");
if (!st.side_panel?.default_path) p1.push("no side_panel.default_path");
const cmds = Object.values(st.commands ?? {});
if (cmds.length !== 2 || cmds.filter((c) => c.suggested_key).length > 4) p1.push(`commands ${cmds.length}`);
if (st.manifest_version !== 3) p1.push("manifest_version");
if (!(Number(st.minimum_chrome_version) >= 119)) p1.push(`minimum_chrome_version ${st.minimum_chrome_version}`);
if (st.name !== "Showsteps") p1.push(`name ${st.name}`);
if (st.version !== pkg.version) p1.push(`version ${st.version} != package.json ${pkg.version}`);
rec("P1", p1.length === 0, p1.length ? p1.join("; ") : `store manifest ok (${(st.permissions ?? []).length} permissions, optional <all_urls>, 2 commands, min Chrome ${st.minimum_chrome_version}, v${st.version})`);

// P2
const a = structuredClone(st), b = structuredClone(e2);
delete a.optional_host_permissions; delete b.host_permissions;
const hostMoved = sameSet(e2.host_permissions ?? [], ["<all_urls>"]) && !("optional_host_permissions" in e2);
const diffKeys = [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]));
rec("P2", hostMoved && diffKeys.length === 0, hostMoved ? `e2e manifest differs only in host access (differing other keys: ${diffKeys.join(", ") || "none"})` : "e2e build did not move <all_urls> to host_permissions");

// P3
const forbidden = ["tabs", "webNavigation", "offscreen", "downloads", "clipboardWrite", "webRequest", "declarativeNetRequest", "debugger", "cookies", "history", "bookmarks", "identity", "nativeMessaging", "management"];
const bad3 = [];
for (const [n, m] of [["store", st], ["e2e", e2]]) for (const f of forbidden) if ([...(m.permissions ?? []), ...(m.optional_permissions ?? [])].includes(f)) bad3.push(`${n}: ${f}`);
rec("P3", bad3.length === 0, bad3.length ? bad3.join(", ") : `none of the ${forbidden.length} forbidden permissions in either manifest`);

// P4 bundle audit (store build)
const files = walk(STORE).filter((f) => /\.(js|html|css)$/.test(f));
const flagged = [];
const urls = new Set();
const NS = /^https?:\/\/(schemas\.(openxmlformats|microsoft)\.(org|com)|www\.w3\.org|purl\.org\/dc)\b/;
const APP = /^https:\/\/showsteps\.vercel\.app(\/support\/|\/schema\/steps\.schema\.json)?$|^https:\/\/github\.com\/btahir\/showsteps/;
const DOC = /^https:\/\/(react\.dev\/|reactjs\.org\/|rolldown\.rs\/|answers\.microsoft\.com\/|developer\.mozilla\.org\/|bugs\.(webkit|chromium)\.org\/|json-schema\.org\/|github\.com\/(Hopding\/pdf-lib|ashtuchkin\/iconv-lite|facebook\/react|tc39\/|WICG\/|whatwg\/)|stuk\.github\.io\/jszip|tc39\.es\/|html\.spec\.whatwg\.org\/|w3c\.github\.io\/)/;
const fetchSites = [];
for (const f of files) {
  const rel = relative(STORE, f);
  const t = readFileSync(f, "utf8");
  for (const m of t.matchAll(/https?:\/\/[^"'`\s)\\<>]+/g)) urls.add(m[0]);
  if (/\beval\(|new Function\(/.test(t)) flagged.push(`${rel}: eval or new Function`);
  if (/<script[^>]+src=["']https?:/i.test(t) || /<link[^>]+href=["']https?:[^>]*stylesheet/i.test(t)) flagged.push(`${rel}: remote script or stylesheet`);
  for (const api of ["XMLHttpRequest", "WebSocket", "EventSource", "sendBeacon"]) if (new RegExp("\\b" + api + "\\b").test(t)) flagged.push(`${rel}: uses ${api}`);
  for (const m of t.matchAll(/(?<![\w.])fetch\(([^)]{0,80})\)/g)) {
    if (/https?:\/\//.test(m[1])) flagged.push(`${rel}: fetch of remote literal ${m[1]}`);
    else fetchSites.push(`${rel}: fetch(${m[1].slice(0, 30)})${/modulepreload/.test(t) && /e\.href/.test(m[1]) ? " [vite modulepreload polyfill]" : ""}`);
  }
}
const unknown = [...urls].filter((u) => !NS.test(u) && !APP.test(u) && !DOC.test(u));
for (const u of unknown) flagged.push(`unlisted URL string ${u}`);
const allowFile = join(ROOT, "notes/url-allowlist.txt");
rec("P4", flagged.length === 0, flagged.length ? flagged.join("; ") : `${files.length} files: no eval or new Function, no remote script/stylesheet, no XHR/WebSocket/EventSource/sendBeacon, ${urls.size} URL strings all namespaces (${[...urls].filter((u) => NS.test(u)).length}), app URLs (${[...urls].filter((u) => APP.test(u)).join(", ")}) or library doc links (${[...urls].filter((u) => DOC.test(u)).length}); fetch call sites: ${fetchSites.join(" | ")}${existsSync(allowFile) ? "" : " (notes/url-allowlist.txt does not exist: classification is in this script)"}`);

// P5 sizes and worker graph
const gz = (f) => gzipSync(readFileSync(join(STORE, f))).length;
const sw = readFileSync(join(STORE, "background.js"), "utf8");
const swImports = [...sw.matchAll(/(?:from\s*|import\(\s*)["'`]\.\/(chunks\/[^"'`]+)["'`]/g)].map((m) => m[1]);
const marks = { "pdf-lib": /PDFDocument|PDFName/, docx: /wordprocessingml|Packer\b/, react: /react\.transitional\.element|__SECRET_INTERNALS/ };
const inSw = Object.entries(marks).filter(([, re]) => re.test(sw) || swImports.some((c) => re.test(readFileSync(join(STORE, c), "utf8")))).map(([k]) => k);
const tmp = mkdtempSync(join(tmpdir(), "showsteps-zip-"));
let zipBytes = -1;
try { execFileSync("zip", ["-qr", join(tmp, "e.zip"), "."], { cwd: STORE }); zipBytes = statSync(join(tmp, "e.zip")).size; } catch { /* zip missing */ } finally { rmSync(tmp, { recursive: true, force: true }); }
const recGz = gz("recorder.js"), swGz = gz("background.js");
rec("P5", zipBytes > 0 && zipBytes <= 4 * 1024 * 1024 && inSw.length === 0, `store build zipped ${(zipBytes / 1024).toFixed(0)} KB (limit 4096); service worker imports ${swImports.length} chunk(s), contains none of docx/pdf-lib/react (found: ${inSw.join(",") || "none"})`);
rec("E12-size", recGz <= 60 * 1024 && swGz <= 250 * 1024, `recorder.js ${(recGz / 1024).toFixed(1)} KB gz (<= 60), background.js ${(swGz / 1024).toFixed(1)} KB gz (<= 250)`);

// NN2 static half: the content script uses no network API
const rec_ = readFileSync(join(STORE, "recorder.js"), "utf8");
const netApis = ["fetch(", "XMLHttpRequest", "WebSocket", "EventSource", "sendBeacon", "importScripts"].filter((a) => rec_.includes(a));
rec("NN2-static", netApis.length === 0, netApis.length ? `recorder.js uses ${netApis.join(", ")}` : "recorder.js contains no fetch, XHR, WebSocket, EventSource, sendBeacon or importScripts");

if (process.argv.includes("--json")) console.log(JSON.stringify(out, null, 2));
else for (const r of out) console.log(`${r.ok ? "PASS" : "FAIL"} ${r.id.padEnd(10)} ${r.detail}`);
const fails = out.filter((r) => !r.ok);
console.log(`\n${out.length - fails.length}/${out.length} extension static checks pass`);
process.exit(fails.length ? 1 : 0);

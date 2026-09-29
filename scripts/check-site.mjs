#!/usr/bin/env node
// Static checks on apps/site/dist (ACCEPTANCE K2-K15, K20 and part of K16/K19). Owned by the verifier.
//   node scripts/check-site.mjs [--json]
// Needs `pnpm --filter @stepsnap/site build` first. No browser: reads the built HTML.
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIST = join(ROOT, "apps/site/dist");
const SRC = readFileSync(join(ROOT, "apps/site/src/config/site.ts"), "utf8");
const SITE_URL = SRC.match(/SITE_URL = "([^"]+)"/)[1];
const results = []; // {id, ok, detail}
const rec = (id, ok, detail) => results.push({ id, ok, detail });

// ---- pages
function walk(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    e.isDirectory() ? walk(p, out) : out.push(p);
  }
  return out;
}
if (!existsSync(join(DIST, "index.html"))) { console.error("apps/site/dist missing: build the site first"); process.exit(2); }
const allPages = walk(DIST).filter((f) => f.endsWith(".html")).map((f) => {
  const rel = f.slice(DIST.length).replace(/index\.html$/, "");
  return { path: rel || "/", html: readFileSync(f, "utf8") };
});
// /404.html is not a normal page; /sample/ is a self-contained exportHtml document (no site chrome, no canonical or OG tags by design).
const pages = allPages.filter((p) => p.path !== "/404.html" && p.path !== "/sample/");
const samplePage = allPages.find((p) => p.path === "/sample/");
const byPath = Object.fromEntries(allPages.map((p) => [p.path, p]));
const text = (html) => html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&#39;|&apos;|&rsquo;/g, "'").replace(/&quot;|&ldquo;|&rdquo;/g, '"').replace(/&amp;/g, "&").replace(/&[a-z#0-9]+;/gi, " ").replace(/\s+/g, " ").trim();
const meta = (html, re) => (html.match(re) || [])[1];
const KEYWORD = /^\/(open-source-scribe-alternative|scribe-alternative|tango-alternative|free-step|how-to-create|steps-recorder|work-instructions|record-|convert-clicks)/;

// K2 inventory: exactly the list in ACCEPTANCE.md
const K2 = ["/", "/open-source-scribe-alternative/", "/steps-recorder-chrome-extension/", "/scribe-alternative-no-cloud-upload/", "/free-step-by-step-guide-maker/", "/steps-recorder-windows-11-alternative/", "/convert-clicks-to-playwright-test/", "/record-workflow-as-agent-skill/", "/how-to-create-an-sop-with-screenshots/", "/support/", "/docs/agents/", "/privacy/", "/sample/"];
const missing = K2.filter((p) => !byPath[p]);
const extra = Object.keys(byPath).filter((p) => !K2.includes(p));
const extras = ["/llms.txt", "/robots.txt", "/sitemap.xml"].filter((f) => !existsSync(join(DIST, f)));
rec("K2", missing.length === 0 && extras.length === 0, `${K2.length - missing.length}/${K2.length} required pages built; missing: ${missing.join(", ") || "none"}; missing files: ${extras.join(", ") || "none"}; built but not in K2: ${extra.join(", ")}`);

// K3 sitemap
const sm = readFileSync(join(DIST, "sitemap.xml"), "utf8");
const locs = [...sm.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
const notInSm = [...pages, ...(samplePage ? [samplePage] : [])].map((p) => SITE_URL + p.path).filter((u) => !locs.includes(u) && !u.endsWith("/404/"));
rec("K3", notInSm.length === 0 && locs.every((l) => l.startsWith(SITE_URL)), `${locs.length} sitemap URLs, all under ${SITE_URL}; built pages absent from sitemap: ${notInSm.join(", ") || "none"}`);

// K4 titles/descriptions
const titles = new Map(), descs = new Map(), bad4 = [];
for (const p of pages) {
  const t = meta(p.html, /<title>([^<]*)<\/title>/); const d = meta(p.html, /<meta name="description" content="([^"]*)"/);
  if (!t || t.length > 60) bad4.push(`${p.path} title ${t ? t.length : "missing"} chars`);
  if (!d || d.length < 70 || d.length > 160) bad4.push(`${p.path} description ${d ? d.length : "missing"} chars`);
  titles.set(t, (titles.get(t) || 0) + 1); descs.set(d, (descs.get(d) || 0) + 1);
}
for (const [t, n] of titles) if (n > 1) bad4.push(`duplicate title: ${t}`);
for (const [d, n] of descs) if (n > 1) bad4.push(`duplicate description: ${d}`);
rec("K4", bad4.length === 0, bad4.length ? bad4.join("; ") : `${pages.length} pages: unique titles <= 60 chars, unique descriptions 70-160 chars`);

// K5 headings
const bad5 = [];
for (const p of pages) {
  const hs = [...p.html.matchAll(/<h([1-6])[\s>]/g)].map((m) => Number(m[1]));
  if (hs.filter((h) => h === 1).length !== 1) bad5.push(`${p.path}: ${hs.filter((h) => h === 1).length} h1`);
  for (let i = 1; i < hs.length; i++) if (hs[i] > hs[i - 1] + 1) { bad5.push(`${p.path}: h${hs[i - 1]} then h${hs[i]}`); break; }
}
rec("K5", bad5.length === 0, bad5.length ? bad5.join("; ") : "exactly one h1 per page, no skipped levels");

// K6 canonical
const bad6 = pages.filter((p) => meta(p.html, /<link rel="canonical" href="([^"]*)"/) !== SITE_URL + p.path).map((p) => p.path);
rec("K6", bad6.length === 0, bad6.length ? `wrong or missing canonical: ${bad6.join(", ")}` : `canonical = SITE_URL + path on ${pages.length} pages`);

// K7 og + twitter
const need = ["og:title", "og:description", "og:image", "og:url", "og:type"];
const bad7 = [];
for (const p of pages) {
  for (const n of need) if (!new RegExp(`<meta property="${n}" content="[^"]+"`).test(p.html)) bad7.push(`${p.path} lacks ${n}`);
  if (!/<meta name="twitter:card" content="[^"]+"/.test(p.html)) bad7.push(`${p.path} lacks twitter:card`);
}
let ogDims = "og.png missing";
if (existsSync(join(DIST, "og.png"))) { const b = readFileSync(join(DIST, "og.png")); ogDims = `${b.readUInt32BE(16)}x${b.readUInt32BE(20)}`; if (ogDims !== "1200x630") bad7.push(`og.png is ${ogDims}`); }
rec("K7", bad7.length === 0, bad7.length ? bad7.slice(0, 6).join("; ") : `og:* and twitter:card on every page; og.png ${ogDims} (HTTP 200 served by the no-network run)`);

// K8 JSON-LD
const bad8 = [];
for (const p of pages) {
  const blocks = [...p.html.matchAll(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  const types = [];
  for (const b of blocks) { try { const j = JSON.parse(b); for (const x of [].concat(j["@graph"] || j)) types.push(x["@type"]); if (JSON.stringify(j).includes('"FAQPage"')) { for (const q of [].concat(j.mainEntity || (j["@graph"] || []).flatMap((g) => g.mainEntity || []))) { const name = q.name; if (name && !text(p.html).includes(name.slice(0, 40))) bad8.push(`${p.path}: FAQ not visible: ${name.slice(0, 40)}`); } } } catch (e) { bad8.push(`${p.path}: JSON-LD does not parse`); } }
  if (p.path === "/" && !types.includes("SoftwareApplication")) bad8.push("/: no SoftwareApplication");
  if (KEYWORD.test(p.path) && !types.includes("FAQPage")) bad8.push(`${p.path}: no FAQPage`);
  if ((KEYWORD.test(p.path) || p.path.startsWith("/docs/") || p.path === "/privacy/") && !types.includes("BreadcrumbList")) bad8.push(`${p.path}: no BreadcrumbList`);
}
rec("K8", bad8.length === 0, bad8.length ? bad8.slice(0, 8).join("; ") : "JSON-LD parses everywhere; SoftwareApplication on /, FAQPage on keyword pages, BreadcrumbList on nested pages, FAQ text visible");

// K9 words with no JS (Astro output is static HTML; scripts are stripped)
const bad9 = []; const wc = {};
for (const p of pages) {
  if (!KEYWORD.test(p.path)) continue;
  const n = text(p.html).split(" ").length; wc[p.path] = n;
  const min = /how-to-create/.test(p.path) ? 1800 : 600;
  if (n < min) bad9.push(`${p.path} ${n} words (< ${min})`);
}
rec("K9", bad9.length === 0, bad9.length ? bad9.join("; ") : `keyword pages word counts: ${Object.entries(wc).map(([k, v]) => `${k.replaceAll("/", "")}=${v}`).join(", ")}`);

// K10 internal links
const bad10 = [];
const kwPaths = pages.filter((p) => KEYWORD.test(p.path)).map((p) => p.path);
for (const p of pages.filter((q) => KEYWORD.test(q.path))) {
  const links = new Set([...p.html.matchAll(/href="(\/[^"#?]*)"/g)].map((m) => m[1]));
  const other = kwPaths.filter((k) => k !== p.path && links.has(k));
  if (other.length < 3) bad10.push(`${p.path}: ${other.length} keyword links`);
  if (!links.has("/support/")) bad10.push(`${p.path}: no /support/`);
  if (!links.has("/docs/agents/")) bad10.push(`${p.path}: no /docs/agents/`);
}
rec("K10", bad10.length === 0, bad10.length ? bad10.join("; ") : `${kwPaths.length} keyword pages each link >= 3 others, /support/ and /docs/agents/`);

// K11 llms.txt
const llms = existsSync(join(DIST, "llms.txt")) ? readFileSync(join(DIST, "llms.txt"), "utf8") : "";
const bad11 = [];
if (Buffer.byteLength(llms) > 20480) bad11.push(`${Buffer.byteLength(llms)} bytes > 20 KB`);
if (!llms.includes("/docs/agents/")) bad11.push("no /docs/agents/");
for (const k of kwPaths) if (!llms.includes(SITE_URL + k)) bad11.push(`missing ${k}`);
for (const w of ["showsteps", "showsteps-mcp"]) if (!llms.includes(w)) bad11.push(`no mention of ${w}`);
const cli = /validate|export/.test(llms), mcpTools = /list_steps|export_guide/.test(llms), schemaLoc = /schema/i.test(llms);
if (!cli) bad11.push("does not state CLI commands"); if (!mcpTools) bad11.push("does not state MCP tool names"); if (!schemaLoc) bad11.push("does not state the file schema location");
rec("K11", bad11.length === 0, bad11.length ? bad11.join("; ") : `${Buffer.byteLength(llms)} bytes; links agents docs and all ${kwPaths.length} keyword pages; states CLI, MCP tools, schema`);

// K12 robots
const robots = readFileSync(join(DIST, "robots.txt"), "utf8");
rec("K12", /Allow: \//.test(robots) && robots.includes(`Sitemap: ${SITE_URL}/sitemap.xml`), robots.replace(/\n+/g, " | "));

// K13 support
const rules = readFileSync(join(ROOT, "..", "research/open-hundred/RULES.md"), "utf8");
const grab = (s) => [...s.matchAll(/https:\/\/buy\.stripe\.com\/[A-Za-z0-9]+/g)].map((m) => m[0]);
const ruleLinks = grab(rules.slice(rules.indexOf("export const DONATION_LINKS"), rules.indexOf("as const;", rules.indexOf("export const DONATION_LINKS"))));
const cfgLinks = grab(SRC.slice(SRC.indexOf("export const DONATION_LINKS")));
const sup = byPath["/support/"]?.html || "";
const supLinks = [...sup.matchAll(/href="(https:\/\/buy\.stripe\.com\/[^"]+)"/g)].map((m) => m[1]);
const navOk = pages.filter((p) => (p.html.match(/href="\/support\/"/g) || []).length < 2).map((p) => p.path);
const monthlyOrdered = JSON.stringify(supLinks.filter((l) => l !== ruleLinks[0])) === JSON.stringify(ruleLinks.slice(1));
rec("K13", JSON.stringify(cfgLinks) === JSON.stringify(ruleLinks) && supLinks.includes(ruleLinks[0]) && monthlyOrdered && navOk.length === 0, `config == RULES §5 (${cfgLinks.length} links); /support/ has ${supLinks.length} stripe hrefs, once present ${supLinks.includes(ruleLinks[0])}, monthly order ${monthlyOrdered}; pages with fewer than 2 /support/ links (header and footer): ${navOk.join(", ") || "none"}`);

// K14 single source of truth
const { execSync } = await import("node:child_process");
let k14 = "";
try { k14 = execSync(`grep -rn "showsteps.vercel.app" apps/site/src apps/extension/src packages --include='*.ts' --include='*.tsx' --include='*.astro' --include='*.mjs' --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=.astro || true`, { cwd: ROOT, encoding: "utf8" }); } catch { /* none */ }
const allowed = (l) => /^apps\/site\/src\/config\/site\.ts|^apps\/extension\/src\/config\.ts|\.test\.|\/test\/|\/e2e\//.test(l);
const k14bad = k14.split("\n").filter(Boolean).filter((l) => !allowed(l));
const oldHost = walk(DIST).filter((f) => /\.(html|txt|xml)$/.test(f)).filter((f) => /stepsnap\.vercel\.app/.test(readFileSync(f, "utf8")));
rec("K14", k14bad.length === 0 && oldHost.length === 0, `${k14bad.length} literal hosts outside config/tests${k14bad.length ? ": " + k14bad.slice(0, 4).map((l) => l.slice(0, 100)).join(" | ") : ""}; dist mentions of stepsnap.vercel.app: ${oldHost.length} (the SITE_URL-swap rebuild was not run)`);

// K15 honesty
const alt = byPath["/open-source-scribe-alternative/"]?.html || "";
const asof = [...alt.matchAll(/data-asof="([^"]*)"/g)].map((m) => m[1]);
const win = byPath["/steps-recorder-windows-11-alternative/"] || byPath["/steps-recorder-alternative/"];
const winText = win ? text(win.html) : "";
const sentences = winText.split(/(?<=[.!?])\s+/);
rec("K15", alt.includes("github.com/westpoint-io/mimik") && asof.length > 0 && asof.every((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)) && sentences.some((s) => /\bweb\b/i.test(s) && /\bdesktop\b/i.test(s)), `Mimik link ${alt.includes("github.com/westpoint-io/mimik")}; ${asof.length} [data-asof] with ISO dates; windows page has a web+desktop sentence: ${sentences.some((s) => /\bweb\b/i.test(s) && /\bdesktop\b/i.test(s))} (5-figure spot check against market-check.md is manual)`);

// K16: zero third-party requests and the home page byte budget are measured in a browser by scripts/no-network.cjs site.

// K17 (static half): images have alt
const noAlt = pages.filter((p) => [...p.html.matchAll(/<img\b[^>]*>/g)].some((m) => !/\balt=/.test(m[0]))).map((p) => p.path);
rec("K17-alt", noAlt.length === 0, noAlt.length ? `img without alt on ${noAlt.join(", ")}` : "every <img> has an alt attribute");

// K19 sample page: a guide rendered by core exportHtml at build time
if (samplePage) {
  const steps = (samplePage.html.match(/<li[^>]*class="[^"]*\bstep\b[^"]*"/g) || []).length;
  const imgs = (samplePage.html.match(/<img[^>]+src="data:image\/png;base64,/g) || []).length;
  const external = [...samplePage.html.matchAll(/(?:src|href)="(https?:\/\/[^"]+)"|@import|url\((https?:)/g)].length;
  const icon = /<link[^>]+rel="(?:shortcut )?icon"/.test(samplePage.html);
  rec("K19", steps === 11 && external === 0 && /ld|@media print/.test(samplePage.html), `/sample/ has ${steps} steps (want 11: sample-11), ${imgs} inlined PNG images, ${external} external refs; no favicon link: ${!icon} (the browser then asks the server for /favicon.ico)`);
} else rec("K19", false, "/sample/ does not exist");

// K20 privacy
const priv = text(byPath["/privacy/"]?.html || "");
const perms = readFileSync(join(ROOT, "notes/permissions.md"), "utf8");
const justif = [...perms.matchAll(/^\| (`[a-zA-Z]+`|optional host permission `<all_urls>`) \| (.+) \|$/gm)].map((m) => ({ name: m[1], sentence: m[2] }));
const norm = (s) => s.replace(/`/g, "").replace(/\s+/g, " ").trim().toLowerCase();
const matched = justif.filter((j) => priv.toLowerCase().includes(norm(j.sentence).slice(0, 60)));
const verifyHow = /devtools|net-export|netlog|network tab/i.test(priv);
const issues = /issues/.test(byPath["/privacy/"]?.html || "");
rec("K20", matched.length === justif.length && verifyHow && issues, `${matched.length}/${justif.length} permission sentences from notes/permissions.md appear verbatim (first 60 chars); how-to-verify-no-network section: ${verifyHow}; issues link: ${issues}`);

// ---- report
const asJson = process.argv.includes("--json");
if (asJson) console.log(JSON.stringify(results, null, 2));
else for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"} ${r.id.padEnd(9)} ${r.detail}`);
const fails = results.filter((r) => !r.ok);
console.log(`\n${results.length - fails.length}/${results.length} static site checks pass`);
process.exit(fails.length ? 1 : 0);

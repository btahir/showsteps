// Lighthouse (mobile and desktop presets) on built pages, using the installed Chrome.
//   research/heavy.sh node scripts/lighthouse.mjs [path ...]      (defaults: / and /tango-alternative/)
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join, extname } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const run = promisify(execFile);
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";

const dist = new URL("../dist/", import.meta.url).pathname;
const paths = process.argv.slice(2).length ? process.argv.slice(2) : ["/", "/tango-alternative/"];
const types = { ".html": "text/html", ".css": "text/css", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".webp": "image/webp", ".png": "image/png", ".txt": "text/plain", ".xml": "application/xml" };
const server = createServer(async (req, res) => {
  let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (p.endsWith("/")) p += "index.html";
  try { const buf = await readFile(join(dist, p)); res.writeHead(200, { "content-type": types[extname(p)] ?? "application/octet-stream", "cache-control": "public, max-age=31536000" }).end(buf); }
  catch { res.writeHead(404).end("nf"); }
}).listen(4635);
const out = mkdtempSync(join(tmpdir(), "lh-"));
// Lighthouse is not a project dependency (its tslib pin clashes with the workspace). Install it anywhere and point LIGHTHOUSE_BIN at it:
//   mkdir /tmp/lh && cd /tmp/lh && npm i lighthouse && LIGHTHOUSE_BIN=/tmp/lh/node_modules/.bin/lighthouse node scripts/lighthouse.mjs
const bin = process.env.LIGHTHOUSE_BIN ?? "lighthouse";
let failed = false;
for (const preset of ["mobile", "desktop"]) {
  for (const p of paths) {
    const file = join(out, `${preset}-${p.replace(/\W/g, "_")}.json`);
    await run(bin, [`http://localhost:4635${p}`, "--quiet", "--output=json", `--output-path=${file}`, `--preset=${preset === "desktop" ? "desktop" : "perf"}`, ...(preset === "mobile" ? [] : []), "--chrome-flags=--headless=new --no-sandbox", "--only-categories=performance,accessibility,best-practices,seo"], { timeout: 240000, env: { ...process.env, CHROME_PATH: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" } });
    const r = JSON.parse(await readFile(file, "utf8"));
    const c = r.categories, s = (k) => Math.round(c[k].score * 100);
    const a = r.audits;
    console.log(`${preset.padEnd(7)} ${p.padEnd(24)} perf ${s("performance")}  a11y ${s("accessibility")}  best-practices ${s("best-practices")}  seo ${s("seo")}  | LCP ${a["largest-contentful-paint"].displayValue}  TBT ${a["total-blocking-time"].displayValue}  CLS ${a["cumulative-layout-shift"].displayValue}`);
    if (s("performance") < 90 || s("accessibility") < 95) failed = true;
  }
}
server.close();
process.exit(failed ? 1 : 0);

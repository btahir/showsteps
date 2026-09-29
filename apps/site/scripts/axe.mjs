// Run axe-core against every built page in light and dark. Exit 1 on serious/critical violations.
//   research/heavy.sh node scripts/axe.mjs
import { chromium } from "playwright-core";
import { createServer } from "node:http";
import { readFile, readdir } from "node:fs/promises";
import { join, extname } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const axeSrc = await readFile(require.resolve("axe-core/axe.min.js"), "utf8");
const dist = new URL("../dist/", import.meta.url).pathname;
const types = { ".html": "text/html", ".css": "text/css", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".txt": "text/plain", ".xml": "application/xml" };
const server = createServer(async (req, res) => {
  let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (p.endsWith("/")) p += "index.html";
  try { res.writeHead(200, { "content-type": types[extname(p)] ?? "application/octet-stream" }).end(await readFile(join(dist, p))); }
  catch { res.writeHead(404).end("nf"); }
}).listen(4632);

const paths = ["/"];
for (const d of await readdir(dist, { withFileTypes: true })) {
  if (d.isDirectory() && d.name !== "_astro") {
    paths.push(`/${d.name}/`);
    if (d.name === "docs") paths.push("/docs/agents/");
  }
}
const uniq = [...new Set(paths.filter((p) => p !== "/docs/"))];
const browser = await chromium.launch({ channel: "chrome" });
let bad = 0;
for (const scheme of ["light", "dark"]) {
  const ctx = await browser.newContext({ colorScheme: scheme, viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  for (const p of uniq) {
    await page.goto("http://localhost:4632" + p, { waitUntil: "networkidle" });
    await page.evaluate(axeSrc);
    const r = await page.evaluate(() => axe.run(document, { runOnly: ["wcag2a", "wcag2aa", "wcag21aa", "best-practice"] }));
    const hard = r.violations.filter((v) => ["serious", "critical"].includes(v.impact));
    for (const v of r.violations) console.log(`${hard.includes(v) ? "FAIL" : "note"} ${scheme} ${p} ${v.id} (${v.impact}) x${v.nodes.length}: ${v.nodes[0].target.join(" ")}`);
    bad += hard.length;
  }
  await ctx.close();
}
await browser.close();
server.close();
console.log(bad ? `${bad} serious/critical violations` : `axe: no serious violations on ${uniq.length} pages x 2 themes`);
process.exit(bad ? 1 : 0);

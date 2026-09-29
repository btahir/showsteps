// Screenshot pages of the built site (dist/) in light and dark, using the installed Chrome.
//   node scripts/shots.mjs <outDir> [path ...]      (run through research/heavy.sh)
import { chromium } from "playwright-core";
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import { join, extname } from "node:path";

const out = process.argv[2];
const paths = process.argv.slice(3).length ? process.argv.slice(3) : ["/"];
const dist = new URL("../dist/", import.meta.url).pathname;
const types = { ".html": "text/html", ".css": "text/css", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".png": "image/png", ".txt": "text/plain", ".xml": "application/xml" };
const server = createServer(async (req, res) => {
  let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (p.endsWith("/")) p += "index.html";
  try {
    const buf = await readFile(join(dist, p));
    res.writeHead(200, { "content-type": types[extname(p)] ?? "application/octet-stream" }).end(buf);
  } catch { res.writeHead(404).end("not found"); }
}).listen(4631);
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ channel: "chrome" });
for (const scheme of ["light", "dark"]) {
  for (const [w, h, tag] of [[1280, 800, "d"], [390, 844, "m"]]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, colorScheme: scheme, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    const ext = [];
    page.on("request", (r) => { if (!r.url().startsWith("http://localhost:4631")) ext.push(r.url()); });
    for (const p of paths) {
      await page.goto("http://localhost:4631" + p, { waitUntil: "networkidle" });
      const name = (p === "/" ? "home" : p.replace(/\//g, "_").replace(/^_|_$/g, "")) + `-${scheme}-${tag}.png`;
      await page.screenshot({ path: join(out, name), fullPage: true });
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
      if (overflow) console.log("HORIZONTAL OVERFLOW", p, scheme, tag);
    }
    if (ext.length) console.log("EXTERNAL REQUESTS", ext);
    await ctx.close();
  }
}
await browser.close();
server.close();

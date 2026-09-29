// Regenerates the real-product figures in public/img/ from (a) the extension e2e renders and
// (b) the exported sample guide in dist/sample/. Run after `pnpm build`, through research/heavy.sh:
//   node scripts/make-assets.mjs
// All content is synthetic ("Acme Books" mock data). Needs `cwebp` and `unzip` on PATH.
import { chromium } from "playwright-core";
import { createServer } from "node:http";
import { readFile, mkdir, copyFile, writeFile, mkdtemp } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { join, extname } from "node:path";
import { tmpdir } from "node:os";

const root = new URL("../", import.meta.url).pathname;
const dist = join(root, "dist/");
const out = join(root, "public/img/");
const screens = join(root, "../extension/e2e/.artifacts/screens/");
await mkdir(out, { recursive: true });
const tmp = await mkdtemp(join(tmpdir(), "assets-"));
const webp = (src, dest, q = 88, crop = []) => execFileSync("cwebp", ["-quiet", "-q", String(q), "-m", "6", ...(crop.length ? ["-crop", ...crop.map(String)] : []), src, "-o", join(out, dest)]);

// 1. e2e renders (real DPR 2 captures) -> webp; light and dark variants of the same screen
for (const name of ["panel-recording", "panel-guide", "panel-export", "panel-support", "panel-empty"]) {
  for (const t of ["light", "dark"]) webp(join(screens, `${name}-2x-${t}.png`), `${name}-${t}.webp`, 82);
}
// The export sheet's format grid (title, six format tiles), cropped from the export screen.
for (const t of ["light", "dark"]) webp(join(screens, `panel-export-2x-${t}.png`), `panel-export-grid-${t}.webp`, 84, [0, 545, 800, 670]);

// 2. figures from the built sample guide
const types = { ".html": "text/html", ".css": "text/css", ".svg": "image/svg+xml", ".woff2": "font/woff2" };
const server = createServer(async (req, res) => {
  let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (p.endsWith("/")) p += "index.html";
  try { const buf = await readFile(join(dist, p)); res.writeHead(200, { "content-type": types[extname(p)] ?? "application/octet-stream" }).end(buf); }
  catch { res.writeHead(404).end("nf"); }
}).listen(4633);
const browser = await chromium.launch({ channel: "chrome" });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2, colorScheme: "light" });
await page.goto("http://localhost:4633/sample/", { waitUntil: "networkidle" });
await page.evaluate(() => document.fonts.ready);

const shot = async (selector, name, q = 86) => {
  const png = join(tmp, name + ".png");
  await page.locator(selector).screenshot({ path: png });
  webp(png, name + ".webp", q);
};
await shot("#step-2 figure .frame", "sample-step-email");
await shot("#step-4 figure .frame", "sample-step-signin");

// Phone crop of the hero step: the same focus-frame rule as the product (window = max(1.6 x ring, 0.3 x image, 360), 16:10, centred on the ring).
{
  const bundle = join(root, "src/sample/acme-sign-in.showsteps");
  execFileSync("unzip", ["-o", "-q", bundle, "-d", join(tmp, "b2")]);
  const g = JSON.parse(await readFile(join(tmp, "b2/guide.json"), "utf8"));
  const shot = g.steps[1].screenshot;
  const h = shot.highlight;
  const w = Math.min(shot.width, Math.max(1.6 * h.width, 0.3 * shot.width, 360 * shot.devicePixelRatio));
  const ht = Math.min(shot.height, w / 1.6);
  const x = Math.round(Math.min(Math.max(h.x + h.width / 2 - w / 2, 0), shot.width - w));
  const y = Math.round(Math.min(Math.max(h.y + h.height / 2 - ht / 2, 0), shot.height - ht));
  const dataUrl2 = await page.$eval("#step-2 img", (el) => el.getAttribute("src"));
  await writeFile(join(tmp, "step2.png"), Buffer.from(dataUrl2.split(",")[1], "base64"));
  webp(join(tmp, "step2.png"), "sample-step-email-crop.webp", 90, [x, y, Math.round(w), Math.round(ht)]);
  await writeFile(join(tmp, "crop-size.txt"), `${Math.round(w)}x${Math.round(ht)}`);
  console.log("hero crop", x, y, Math.round(w), Math.round(ht));
}

// Privacy before/after. "Before" is what a synthetic fixture page (apps/fixtures/site/patterns.html: mock card, SSN, IBAN and API
// key, all fake) actually showed; the committed screenshot and field rects feed src/pages/img/privacy-after.png.ts, which renders
// "after" with core's own redaction and highlight code.
const fixtures = join(root, "../fixtures/site/");
const fsrv = createServer(async (req, res) => {
  let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
  try { const buf = await readFile(join(fixtures, p)); res.writeHead(200, { "content-type": types[extname(p)] ?? "text/html" }).end(buf); }
  catch { res.writeHead(404).end("nf"); }
}).listen(4634);
const fp = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, colorScheme: "light" });
await fp.goto("http://localhost:4634/patterns.html");
await fp.waitForSelector("#token");
await fp.evaluate(() => document.fonts.ready);
const rects = await fp.evaluate(() => {
  const textBox = (id) => { const el = document.getElementById(id); const r = document.createRange(); r.selectNodeContents(el); const b = r.getBoundingClientRect(); return { x: Math.round(b.x), y: Math.round(b.y), width: Math.round(b.width), height: Math.round(b.height) }; };
  const box = (id) => { const b = document.getElementById(id).getBoundingClientRect(); return { x: Math.round(b.x), y: Math.round(b.y), width: Math.round(b.width), height: Math.round(b.height) }; };
  return { card: textBox("card"), ssn: textBox("ssn"), iban: textBox("iban"), jwt: textBox("jwt"), token: textBox("token"), notes: box("notes"), button: box("refresh"), panel: box("secrets") };
});
await fp.screenshot({ path: join(root, "src/sample/patterns-before.png") });
await writeFile(join(root, "src/sample/patterns-rects.json"), JSON.stringify(rects, null, 2) + "\n");
const crop = { x: 200, y: 64, width: 880, height: Math.min(700, rects.button.y + rects.button.height + 40 - 64) };
await writeFile(join(root, "src/sample/patterns-crop.json"), JSON.stringify(crop) + "\n");
webp(join(root, "src/sample/patterns-before.png"), "privacy-before.webp", 90, [crop.x, crop.y, crop.width, crop.height]);
fsrv.close();

await browser.close();
server.close();
console.log("wrote", out);

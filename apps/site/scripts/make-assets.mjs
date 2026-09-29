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

// 1. e2e renders -> webp (light and dark variants of the same screen)
for (const name of ["panel-recording", "panel-guide", "panel-export", "panel-support", "panel-empty"]) {
  for (const t of ["light", "dark"]) webp(join(screens, `${name}-${t}.png`), `${name}-${t}.webp`);
}
// The editor screen is cropped to the right-hand pane (title, toolbar, blurred field), dropping the fixture host in the list meta and URL caption.
for (const t of ["light", "dark"]) webp(join(screens, `editor-${t}.png`), `editor-${t}.webp`, 88, [360, 56, 920, 724]);

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

// blur before/after: the same 600x170 region of step 3, raw capture vs the exported (rendered) image
const region = { x: 330, y: 250, width: 600, height: 170 };
const dataUrl = await page.$eval("#step-3 img", (el) => el.getAttribute("src"));
await writeFile(join(tmp, "after-full.png"), Buffer.from(dataUrl.split(",")[1], "base64"));
const bundle = join(root, "src/sample/acme-sign-in.showsteps");
execFileSync("unzip", ["-o", "-q", bundle, "-d", join(tmp, "b")]);
const guide = JSON.parse(await readFile(join(tmp, "b/guide.json"), "utf8"));
const p2 = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
for (const [name, file] of [["blur-before", join(tmp, "b", guide.steps[2].screenshot.image)], ["blur-after", join(tmp, "after-full.png")]]) {
  await writeFile(join(tmp, name + ".html"), `<body style="margin:0"><img src="file://${file}" style="display:block;width:1280px"></body>`);
  await p2.goto("file://" + join(tmp, name + ".html"));
  await p2.screenshot({ path: join(tmp, name + ".png"), clip: region });
  webp(join(tmp, name + ".png"), name + ".webp", 90);
}

await browser.close();
server.close();
console.log("wrote", out);

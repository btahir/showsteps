// Rasterises the brand icons (packages/brand/icon.svg, icon-16.svg) into public/icon/*.png for
// the manifest. Run after the brand changes: ../../../research/heavy.sh node scripts/icons.mjs
import { chromium } from "@playwright/test";
import { readFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const brand = join(here, "../../../packages/brand");
const out = join(here, "../public/icon");
mkdirSync(out, { recursive: true });
const svg16 = readFileSync(join(brand, "icon-16.svg"), "utf8");
const svg = readFileSync(join(brand, "icon.svg"), "utf8");

const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 1 });
for (const [size, src] of [[16, svg16], [32, svg], [48, svg], [128, svg]]) {
  await page.setViewportSize({ width: size, height: size });
  const data = Buffer.from(src).toString("base64");
  await page.setContent(`<style>html,body{margin:0;background:transparent}img{display:block;width:${size}px;height:${size}px}</style><img src="data:image/svg+xml;base64,${data}">`);
  await page.waitForLoadState();
  await page.screenshot({ path: join(out, `${size}.png`), omitBackground: true });
  console.log(`icon ${size}px`);
}
await browser.close();

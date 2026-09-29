/**
 * /img/privacy-after.png: what the guide keeps. Renders the committed "before" screenshot of the synthetic fixture page
 * (src/sample/patterns-before.png, mock data only) through core's own renderer: text-pattern fields masked, the button outlined.
 * Regenerate the inputs with scripts/make-assets.mjs.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderStepImage } from "@showsteps/core";
import type { Redaction, Rect } from "@showsteps/core";

const read = (f: string) => readFileSync(resolve(process.cwd(), "src/sample", f));

export function GET() {
  const rects = JSON.parse(read("patterns-rects.json").toString()) as Record<string, Rect>;
  const crop = JSON.parse(read("patterns-crop.json").toString()) as Rect;
  const png = new Uint8Array(read("patterns-before.png"));
  const pad = (r: Rect, p = 5): Rect => ({ x: r.x - p, y: r.y - p, width: r.width + p * 2, height: r.height + p * 2 });
  const mask = (r: Rect, label: string): Redaction => ({ rect: pad(r), style: "mask", auto: true, label });
  const redactions: Redaction[] = [
    mask(rects.card!, "Card number"),
    mask(rects.ssn!, "Tax ID"),
    mask(rects.iban!, "IBAN"),
    mask(rects.jwt!, "Session token"),
    mask(rects.token!, "API key"),
    { rect: rects.notes!, style: "mask", auto: true, label: "Card number" },
  ];
  const out = renderStepImage(png, {
    image: "images/patterns.png",
    width: 1280,
    height: 800,
    devicePixelRatio: 1,
    viewport: { width: 1280, height: 800, scrollX: 0, scrollY: 0 },
    highlight: rects.button!,
    redactions,
    crop,
  }, { highlight: true, stepNumber: 1 });
  return new Response(out, { headers: { "Content-Type": "image/png" } });
}

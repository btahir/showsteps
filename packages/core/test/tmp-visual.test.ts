import { writeFileSync } from "node:fs";
import { it } from "vitest";
import { encodePng, exportHtml, exportMarkdown, type Guide, type ImageSource } from "../src";
import { fixtureGuide } from "./fixtures/guide";

const K = 8;
it("writes big visual fixtures", () => {
  const g0 = fixtureGuide();
  const images: ImageSource = {};
  const g: Guide = { ...g0, steps: g0.steps.map((s) => {
    if (!s.screenshot) return s;
    const sc = s.screenshot;
    const w = sc.width * K, h = sc.height * K;
    const data = new Uint8Array(w * h * 4);
    const fill = (x: number, y: number, ww: number, hh: number, c: number[]) => { for (let j = y; j < Math.min(h, y + hh); j++) for (let i = x; i < Math.min(w, x + ww); i++) { const p = (j * w + i) * 4; data[p] = c[0]!; data[p+1] = c[1]!; data[p+2] = c[2]!; data[p+3] = 255; } };
    fill(0, 0, w, h, [246, 247, 249]);
    fill(0, 0, w, 12 * K, [223, 227, 234]);
    fill(12 * K, 18 * K, 60 * K, 6 * K, [190, 196, 208]);
    for (let i = 0; i < 4; i++) fill(12 * K, (30 + i * 16) * K, 136 * K, 10 * K, [255, 255, 255]);
    if (sc.highlight) fill(sc.highlight.x * K, sc.highlight.y * K, sc.highlight.width * K, sc.highlight.height * K, s.id === "s_pass" ? [34, 34, 34] : [201, 211, 234]);
    images[sc.image] = encodePng({ width: w, height: h, data }, 3);
    const sc2 = { ...sc, width: w, height: h, devicePixelRatio: 2, viewport: { ...sc.viewport, width: w / 2, height: h / 2 },
      highlight: sc.highlight && { x: sc.highlight.x * K, y: sc.highlight.y * K, width: sc.highlight.width * K, height: sc.highlight.height * K },
      redactions: sc.redactions?.map((r) => ({ ...r, rect: { x: r.rect.x * K, y: r.rect.y * K, width: r.rect.width * K, height: r.rect.height * K } })) };
    return { ...s, screenshot: sc2 };
  }) };
  writeFileSync("/private/tmp/claude-501/-Users-bilaltahir-Downloads-personal-projects-throwaway/b2fe3a32-6cad-4ba4-a70d-123f81fc7941/scratchpad/big.html", exportHtml(g, images));
  writeFileSync("/private/tmp/claude-501/-Users-bilaltahir-Downloads-personal-projects-throwaway/b2fe3a32-6cad-4ba4-a70d-123f81fc7941/scratchpad/big-dark.html", exportHtml(g, images, { theme: "dark" }));
  const md = exportMarkdown(g, { images });
  for (const [k, v] of Object.entries(md.files)) { if (typeof v !== "string") { writeFileSync("/private/tmp/claude-501/-Users-bilaltahir-Downloads-personal-projects-throwaway/b2fe3a32-6cad-4ba4-a70d-123f81fc7941/scratchpad/" + k.replace("images/", "md-"), v); } }
});

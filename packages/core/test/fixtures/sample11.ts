// The 11-step sample guide (fixture flow plus an initial navigate step): the JSON is committed
// (sample-11.guide.json, made from apps/fixtures/flows); the 2880x1800 screenshots (1440x900 CSS px at
// dpr 2) are synthetic PNGs drawn in code. Memoised because drawing and encoding 11 of them takes ~2 s.

import type { Guide, ImageSource, Rect, Step } from "../../src";
import { encodePng } from "../../src/png";
import sample from "./sample-11.guide.json";

export const SAMPLE_CANARY_PASSWORD = "Correct-Horse-9";

export function sample11Guide(): Guide {
  return JSON.parse(JSON.stringify(sample)) as Guide;
}

let cache: ImageSource | undefined;

function drawStep(step: Step): Uint8Array {
  const shot = step.screenshot as NonNullable<Step["screenshot"]>;
  const { width: W, height: H } = shot;
  const data = new Uint8Array(W * H * 4);
  const fill = (r: Rect, c: [number, number, number]): void => {
    const x0 = Math.max(0, r.x), y0 = Math.max(0, r.y), x1 = Math.min(W, r.x + r.width), y1 = Math.min(H, r.y + r.height);
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const p = (y * W + x) * 4;
        data[p] = c[0]; data[p + 1] = c[1]; data[p + 2] = c[2]; data[p + 3] = 255;
      }
    }
  };
  /** A line of fake text: vertical bars of varying width, like glyphs at a distance. */
  const textLine = (x: number, y: number, w: number, h: number, seed: number, c: [number, number, number]): void => {
    let cx = x;
    let s = seed;
    while (cx < x + w) {
      s = (s * 1103515245 + 12345) & 0x7fffffff;
      const gw = 4 + (s % 9);
      fill({ x: cx, y, width: Math.min(gw, x + w - cx), height: h }, c);
      cx += gw + 3 + ((s >> 4) % 5);
    }
  };
  const seed = step.id.charCodeAt(1) * 31 + step.id.charCodeAt(2);
  fill({ x: 0, y: 0, width: W, height: H }, [244, 242, 238]);
  fill({ x: 0, y: 0, width: W, height: 96 }, [255, 255, 255]);
  fill({ x: 0, y: 96, width: W, height: 2 }, [224, 220, 214]);
  textLine(64, 32, 220, 32, seed, [31, 28, 25]);
  for (let i = 0; i < 6; i++) textLine(500 + i * 160, 36, 110, 24, seed + i, [110, 104, 98]);
  fill({ x: 0, y: 98, width: 240, height: H - 98 }, [236, 233, 228]);
  for (let i = 0; i < 8; i++) textLine(40, 200 + i * 64, 150, 22, seed + 40 + i, [87, 81, 75]);
  for (let i = 0; i < 9; i++) {
    fill({ x: 320, y: 160 + i * 150, width: W - 420, height: 110 }, [255, 255, 255]);
    textLine(352, 190 + i * 150, 900, 26, seed + 90 + i, [31, 28, 25]);
    textLine(352, 240 + i * 150, 1400, 18, seed + 130 + i, [115, 107, 99]);
  }
  if (shot.highlight) {
    const sensitive = step.target?.sensitive;
    fill(shot.highlight, sensitive ? [255, 255, 255] : [252, 230, 221]);
    if (sensitive) {
      // the secret: dark bullets that a redaction must destroy
      for (let i = 0; i < 30; i++) fill({ x: shot.highlight.x + 30 + i * 22, y: shot.highlight.y + shot.highlight.height / 2 - 6, width: 12, height: 12 }, [20, 20, 20]);
    } else {
      textLine(shot.highlight.x + 20, shot.highlight.y + shot.highlight.height / 2 - 10, Math.min(shot.highlight.width - 40, 600), 20, seed + 7, [31, 28, 25]);
    }
  }
  return encodePng({ width: W, height: H, data }, 1);
}

export function sample11Images(): ImageSource {
  if (!cache) {
    cache = {};
    for (const s of sample11Guide().steps) if (s.screenshot) cache[s.screenshot.image] = drawStep(s);
  }
  return cache;
}

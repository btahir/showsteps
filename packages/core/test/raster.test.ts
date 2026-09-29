import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  decodePng,
  encodePng,
  highlightScale,
  parseColor,
  redactBlock,
  REDACT_MIN_CELL_CSS_PX,
  redactRegion,
  RenderError,
  renderStepImage,
  SOLID_REDACTION_RGB,
  type Rect,
  type RgbaImage,
  type Screenshot,
} from "../src";
import { fixtureGuide, fixtureImages } from "./fixtures/guide";

const guide = fixtureGuide();
const images = fixtureImages();
const shotOf = (id: string): Screenshot => guide.steps.find((s) => s.id === id)?.screenshot as Screenshot;

const px = (img: RgbaImage, x: number, y: number): number[] => Array.from(img.data.subarray((y * img.width + x) * 4, (y * img.width + x) * 4 + 4));

/** Synthetic screenshot with text-like stripes: lines of 2px vertical bars on a light page. */
function stripes(width: number, height: number): RgbaImage {
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = (y * width + x) * 4;
      const line = Math.floor(y / 24) % 2 === 0 && y % 24 > 4 && y % 24 < 20;
      const bar = line && Math.floor(x / 2) % 3 !== 2 && (Math.floor(x / 7) * 31) % 5 !== 0;
      const v = bar ? 30 : 245;
      data[p] = v; data[p + 1] = v; data[p + 2] = bar ? 45 : 240; data[p + 3] = 255;
    }
  }
  return { width, height, data };
}

function shot(img: RgbaImage, over: Partial<Screenshot> = {}): Screenshot {
  return { image: "images/x.png", width: img.width, height: img.height, devicePixelRatio: 2, viewport: { width: img.width / 2, height: img.height / 2, scrollX: 0, scrollY: 0 }, ...over };
}

const meanHDiff = (img: RgbaImage, r: Rect): number => {
  let sum = 0, n = 0;
  for (let y = r.y; y < r.y + r.height; y++) for (let x = r.x; x < r.x + r.width - 1; x++) { sum += Math.abs((px(img, x, y)[0] as number) - (px(img, x + 1, y)[0] as number)); n++; }
  return sum / n;
};

const outsideHash = (img: RgbaImage, rects: Rect[]): string => {
  const h = createHash("sha256");
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      if (rects.some((r) => x >= r.x && x < r.x + r.width && y >= r.y && y < r.y + r.height)) continue;
      h.update(img.data.subarray((y * img.width + x) * 4, (y * img.width + x) * 4 + 4));
    }
  }
  return h.digest("hex");
};

describe("redactions on a 1440x900 text-like image", () => {
  const src = stripes(1440, 900);
  const bytes = encodePng(src, 3);
  const R1: Rect = { x: 200, y: 120, width: 400, height: 56 };
  const R2: Rect = { x: 900, y: 500, width: 300, height: 40 };
  const original = decodePng(bytes);

  for (const style of ["solid", "pixelate", "blur"] as const) {
    it(`${style}: changes only pixels inside the rects (outside is byte-identical)`, () => {
      const out = decodePng(renderStepImage(bytes, shot(src, { redactions: [{ rect: R1, style }, { rect: R2, style }] }), { highlight: false }));
      expect(outsideHash(out, [R1, R2])).toBe(outsideHash(original, [R1, R2]));
    });
  }

  it("solid: every pixel equals SOLID_REDACTION_RGB", () => {
    const out = decodePng(renderStepImage(bytes, shot(src, { redactions: [{ rect: R1, style: "solid" }] })));
    for (let y = R1.y; y < R1.y + R1.height; y++) for (let x = R1.x; x < R1.x + R1.width; x++) expect(px(out, x, y).slice(0, 3)).toEqual(SOLID_REDACTION_RGB);
  });

  it("pixelate: at most one colour per cell", () => {
    const out = decodePng(renderStepImage(bytes, shot(src, { redactions: [{ rect: R1, style: "pixelate" }] })));
    const cell = redactBlock(R1.height, 2);
    const colours = new Set<string>();
    for (let y = R1.y; y < R1.y + R1.height; y++) for (let x = R1.x; x < R1.x + R1.width; x++) colours.add(px(out, x, y).join(","));
    expect(colours.size).toBeLessThanOrEqual(Math.ceil(R1.width / cell) * Math.ceil(R1.height / cell));
    expect(cell).toBeGreaterThanOrEqual(8 * 2); // cells are at least 8 CSS px (10 at dpr 2 is 20 px)
    expect(REDACT_MIN_CELL_CSS_PX).toBeGreaterThanOrEqual(8);
  });

  it("blur: neighbour differences drop to at most 15% of the original's (not reversible)", () => {
    const out = decodePng(renderStepImage(bytes, shot(src, { redactions: [{ rect: R1, style: "blur" }] })));
    const before = meanHDiff(original, R1);
    expect(before).toBeGreaterThan(10);
    expect(meanHDiff(out, R1)).toBeLessThanOrEqual(before * 0.15);
    // no original pixel value pattern survives: the dark bar colour (30) is gone
    let dark = 0;
    for (let y = R1.y; y < R1.y + R1.height; y++) for (let x = R1.x; x < R1.x + R1.width; x++) if ((px(out, x, y)[0] as number) < 60) dark++;
    expect(dark).toBe(0);
  });

  it("redactRegion clamps to the image and ignores empty rects", () => {
    const img = decodePng(bytes);
    redactRegion(img, { x: -50, y: -50, width: 100, height: 100 }, "solid");
    expect(px(img, 0, 0).slice(0, 3)).toEqual(SOLID_REDACTION_RGB);
    expect(px(img, 60, 60)).toEqual(px(original, 60, 60));
    redactRegion(img, { x: 5000, y: 5000, width: 10, height: 10 }, "blur");
    redactRegion(img, { x: 10, y: 10, width: 0, height: 10 }, "blur");
  });

  it("refuses to export unredacted pixels when the image cannot be decoded", () => {
    expect(() => renderStepImage(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]), shot(src, { redactions: [{ rect: R1, style: "solid" }] }))).toThrow(RenderError);
    expect(() => renderStepImage(new Uint8Array([1, 2, 3]), shot(src, { redactions: [{ rect: R1, style: "blur" }] }))).toThrow(/Refusing to export unredacted pixels/);
  });

  it("scales rects when the bytes are a different size than the metadata says", () => {
    const half = shot(src, { width: 720, height: 450, redactions: [{ rect: { x: 100, y: 60, width: 200, height: 28 }, style: "solid" }] });
    const out = decodePng(renderStepImage(bytes, half, { highlight: false }));
    expect(px(out, 300, 130).slice(0, 3)).toEqual(SOLID_REDACTION_RGB);
  });
});

describe("highlight", () => {
  const src = stripes(1440, 900);
  const bytes = encodePng(src, 3);
  const target: Rect = { x: 300, y: 300, width: 400, height: 80 };
  const sh = shot(src, { highlight: target, viewport: { width: 720, height: 450, scrollX: 0, scrollY: 0 } });
  const color = parseColor("#EB4E26") as number[];
  const ring = decodePng(renderStepImage(bytes, sh, { stepNumber: 7 }));
  const k = highlightScale(720, 2); // image px per highlight CSS px
  const pad = 4 * k;

  it("draws the ring in the highlight colour around the padded box, and leaves the target centre alone", () => {
    const near = (p: number[]): boolean => Math.abs((p[0] as number) - (color[0] as number)) <= 2 && Math.abs((p[1] as number) - (color[1] as number)) <= 2 && Math.abs((p[2] as number) - (color[2] as number)) <= 2;
    // centre line of the ring on the left and bottom edges (the tab sits on the top right)
    let hits = 0, total = 0;
    for (let y = target.y + 20; y < target.y + target.height - 20; y++) { total++; if (near(px(ring, Math.round(target.x - pad), y))) hits++; }
    for (let x = target.x + 20; x < target.x + target.width - 20; x++) { total++; if (near(px(ring, x, Math.round(target.y + target.height + pad - 1)))) hits++; }
    expect(hits / total).toBeGreaterThanOrEqual(0.9);
    expect(px(ring, target.x + 200, target.y + 40)).toEqual(px(decodePng(bytes), target.x + 200, target.y + 40));
  });

  it("dims the rest of the screenshot by 16% and keeps the inside of the ring bright", () => {
    const before = decodePng(bytes);
    const far = px(ring, 30, 30);
    const orig = px(before, 30, 30);
    for (let c = 0; c < 3; c++) expect(far[c]).toBe(Math.round((orig[c] as number) * 0.84 + [28, 18, 12][c]! * 0.16));
    expect(px(ring, 400, 340)).toEqual(px(before, 400, 340));
    const off = decodePng(renderStepImage(bytes, sh, { spotlight: false, stepNumber: 7 }));
    expect(px(off, 30, 30)).toEqual(orig);
  });

  it("grows a numbered tab out of the top-right corner, in the highlight colour with a white numeral", () => {
    const tabCorner = { x: target.x + target.width + pad, y: target.y - pad };
    let colored = 0, white = 0;
    for (let y = Math.round(tabCorner.y - 24 * k); y < tabCorner.y; y++) {
      for (let x = Math.round(tabCorner.x - 27 * k); x < tabCorner.x; x++) {
        const p = px(ring, x, y);
        if (Math.abs((p[0] as number) - (color[0] as number)) <= 2 && Math.abs((p[1] as number) - (color[1] as number)) <= 2) colored++;
        if ((p[0] as number) > 250 && (p[1] as number) > 250 && (p[2] as number) > 250) white++;
      }
    }
    expect(colored).toBeGreaterThan(300);
    expect(white).toBeGreaterThan(30); // numeral and keyline
    // and nothing coloured at the mirrored top-left position
    const left = px(ring, Math.round(target.x - pad - 10), Math.round(target.y - pad - 12 * k));
    expect(Math.abs((left[0] as number) - (color[0] as number)) > 2 || Math.abs((left[1] as number) - (color[1] as number)) > 2).toBe(true);
  });

  const isRing = (img: RgbaImage, x: number, y: number): boolean => {
    const p = px(img, Math.round(x), Math.round(y));
    return Math.abs((p[0] as number) - (color[0] as number)) <= 2 && Math.abs((p[1] as number) - (color[1] as number)) <= 2 && Math.abs((p[2] as number) - (color[2] as number)) <= 2;
  };

  it("flips the tab to the left for right-to-left pages", () => {
    const rtl = decodePng(renderStepImage(bytes, sh, { stepNumber: 7, rtl: true }));
    const y = target.y - pad - 18 * k;
    expect(isRing(rtl, target.x - pad + 3 * k, y)).toBe(true);
    expect(isRing(ring, target.x - pad + 3 * k, y)).toBe(false);
    expect(isRing(ring, target.x + target.width + pad - 3 * k, y)).toBe(true);
    expect(isRing(rtl, target.x + target.width + pad - 3 * k, y)).toBe(false);
  });

  it("drops the tab below the ring when the target is at the top edge", () => {
    const top: Rect = { x: 300, y: 10, width: 400, height: 60 };
    const out = decodePng(renderStepImage(bytes, shot(src, { highlight: top, viewport: { width: 720, height: 450, scrollX: 0, scrollY: 0 } }), { stepNumber: 2 }));
    expect(isRing(out, top.x + top.width + pad - 3 * k, top.y + top.height + pad + 18 * k)).toBe(true);
    expect(isRing(out, top.x + top.width + pad - 3 * k, top.y - pad - 6 * k)).toBe(false);
  });

  it("draws a plain ring without a step number, and multi-digit numbers", () => {
    const plain = decodePng(renderStepImage(bytes, sh));
    expect(px(plain, Math.round(target.x + target.width + pad - 10 * k), Math.round(target.y - pad - 10 * k))).not.toEqual(px(ring, Math.round(target.x + target.width + pad - 10 * k), Math.round(target.y - pad - 10 * k)));
    for (const n of [0, 5, 10, 123, 9]) expect(() => renderStepImage(bytes, sh, { stepNumber: n })).not.toThrow();
  });

  it("uses the guide's highlight colour when given", () => {
    const red = decodePng(renderStepImage(bytes, sh, { highlightColor: "#0000ff", stepNumber: 1 }));
    const p = px(red, Math.round(target.x - pad), target.y + 40);
    expect(p[2]).toBeGreaterThan(200);
    expect(p[0]).toBeLessThan(40);
  });

  it("a light highlight colour gets a dark numeral", () => {
    const out = decodePng(renderStepImage(bytes, sh, { highlightColor: "#ffe600", stepNumber: 8 }));
    let dark = 0;
    for (let y = Math.round(target.y - pad - 24 * k); y < target.y - pad; y++) for (let x = Math.round(target.x + target.width + pad - 27 * k); x < target.x + target.width + pad; x++) if ((px(out, x, y)[0] as number) < 80) dark++;
    expect(dark).toBeGreaterThan(20);
  });
});

describe("pipeline", () => {
  it("returns the same bytes when there is nothing to draw", () => {
    const bytes = images["images/s_open.png"] as Uint8Array;
    expect(renderStepImage(bytes, shotOf("s_open"))).toBe(bytes);
  });

  it("applies the crop last and shrinks the output to exactly the crop", () => {
    const bytes = images["images/s_email.png"] as Uint8Array;
    const out = decodePng(renderStepImage(bytes, { ...shotOf("s_email"), crop: { x: 10, y: 20, width: 100, height: 40 } }, { stepNumber: 2 }));
    expect([out.width, out.height]).toEqual([100, 40]);
  });

  it("crops first, so the highlight follows the cropped image (tab flips below at the crop's top edge)", () => {
    const src = stripes(1440, 900);
    const bytes = encodePng(src, 3);
    // target sits 10 px below the crop's top edge: no room for a tab above, so it goes below
    const sh = shot(src, { highlight: { x: 400, y: 410, width: 300, height: 60 }, crop: { x: 300, y: 400, width: 700, height: 300 }, viewport: { width: 720, height: 450, scrollX: 0, scrollY: 0 } });
    const out = decodePng(renderStepImage(bytes, sh, { stepNumber: 3 }));
    expect([out.width, out.height]).toEqual([700, 300]);
    const color = parseColor("#EB4E26") as number[];
    const k = highlightScale(720, 2);
    const pad = 4 * k;
    const near = (x: number, y: number): boolean => { const p = px(out, Math.round(x), Math.round(y)); return Math.abs((p[0] as number) - (color[0] as number)) <= 2 && Math.abs((p[1] as number) - (color[1] as number)) <= 2; };
    const right = 100 + 300 + pad; // ring's right edge in crop space
    expect(near(right - 3 * k, 10 + 60 + pad + 18 * k)).toBe(true); // tab below the ring
    expect(near(right - 3 * k, 10 - pad - 6 * k + 0)).toBe(false);
  });

  it("passes undecodable images through when only the highlight was wanted", () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
    expect(renderStepImage(jpeg, shotOf("s_signin"))).toBe(jpeg);
  });

  it("highlightScale follows the brand formula", () => {
    expect(highlightScale(480, 2)).toBe(2);
    expect(highlightScale(960, 2)).toBe(2);
    expect(highlightScale(1440, 2)).toBe(3);
    expect(highlightScale(4000, 1)).toBe(2);
    expect(highlightScale(1000, 0)).toBeCloseTo(1000 / 960);
  });

  it("parseColor understands the common CSS forms", () => {
    expect(parseColor("#ff5a1f")).toEqual([255, 90, 31]);
    expect(parseColor("#f00")).toEqual([255, 0, 0]);
    expect(parseColor("#11223344")).toEqual([17, 34, 51]);
    expect(parseColor("rgb(1, 2, 3)")).toEqual([1, 2, 3]);
    expect(parseColor("rgba(10 20 30 / 50%)")).toEqual([10, 20, 30]);
    expect(parseColor("red")).toEqual([255, 0, 0]);
    expect(parseColor("var(--x)")).toBeUndefined();
    expect(parseColor("#12345")).toBeUndefined();
  });

  it("renders a 2880x1800 screenshot with 2 redactions and a highlight in under 2.5 s (median of 3)", () => {
    const big = stripes(2880, 1800);
    const bytes = encodePng(big, 1);
    const sh2 = shot(big, {
      highlight: { x: 600, y: 700, width: 800, height: 120 },
      redactions: [{ rect: { x: 200, y: 100, width: 900, height: 120 }, style: "blur" }, { rect: { x: 1500, y: 900, width: 600, height: 100 }, style: "pixelate" }],
    });
    const times: number[] = [];
    for (let i = 0; i < 3; i++) {
      const t0 = performance.now();
      const out = renderStepImage(bytes, sh2, { stepNumber: 3 });
      times.push(performance.now() - t0);
      expect(out.length).toBeGreaterThan(100);
    }
    times.sort((a, b) => a - b);
    console.log(`2880x1800 render ms: ${times.map((t) => Math.round(t)).join(", ")}`);
    expect(times[1]).toBeLessThanOrEqual(2500);
  });
});

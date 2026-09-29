import { describe, expect, it } from "vitest";
import { clampRect, cssToImageRect, expandRect, highlightPath, imageToCssRect, intersectRects, rectContains, roundRectOut, scaleRect, unionRects } from "../src";

describe("highlightPath", () => {
  it("draws a rounded rect grown by the padding", () => {
    expect(highlightPath({ x: 10, y: 20, width: 100, height: 40 }, 4, 8)).toBe(
      "M14 16H106A8 8 0 0 1 114 24V56A8 8 0 0 1 106 64H14A8 8 0 0 1 6 56V24A8 8 0 0 1 14 16Z",
    );
  });
  it("clamps the radius to half the shorter side", () => {
    expect(highlightPath({ x: 0, y: 0, width: 10, height: 10 }, 0, 100)).toContain("A5 5 0 0 1");
  });
  it("falls back to a plain rectangle for radius 0", () => {
    expect(highlightPath({ x: 1, y: 2, width: 3, height: 4 }, 0, 0)).toBe("M1 2H4V6H1Z");
  });
  it("shrinks with negative padding and never goes negative", () => {
    expect(highlightPath({ x: 0, y: 0, width: 4, height: 4 }, -10, 2)).toBe("M10 10H10V10H10Z");
  });
  it("rounds to two decimals", () => {
    expect(highlightPath({ x: 0.333333, y: 0, width: 10, height: 10 }, 0, 0)).toBe("M0.33 0H10.33V10H0.33Z");
  });
});

describe("rect helpers", () => {
  it("scaleRect scales uniformly or per axis", () => {
    expect(scaleRect({ x: 1, y: 2, width: 3, height: 4 }, 2)).toEqual({ x: 2, y: 4, width: 6, height: 8 });
    expect(scaleRect({ x: 1, y: 2, width: 3, height: 4 }, 2, 3)).toEqual({ x: 2, y: 6, width: 6, height: 12 });
  });
  it("clampRect intersects with the bounds", () => {
    expect(clampRect({ x: -5, y: -5, width: 20, height: 20 }, { width: 10, height: 12 })).toEqual({ x: 0, y: 0, width: 10, height: 12 });
    expect(clampRect({ x: 3, y: 3, width: 2, height: 2 }, { width: 10, height: 10 })).toEqual({ x: 3, y: 3, width: 2, height: 2 });
  });
  it("clampRect gives an empty rect for a rect fully outside", () => {
    const r = clampRect({ x: 50, y: 50, width: 5, height: 5 }, { width: 10, height: 10 });
    expect(r.width).toBe(0);
    expect(r.height).toBe(0);
  });
  it("expand, union, intersect, contains, roundOut", () => {
    expect(expandRect({ x: 5, y: 5, width: 2, height: 2 }, 1)).toEqual({ x: 4, y: 4, width: 4, height: 4 });
    expect(unionRects({ x: 0, y: 0, width: 2, height: 2 }, { x: 5, y: 5, width: 1, height: 1 })).toEqual({ x: 0, y: 0, width: 6, height: 6 });
    expect(intersectRects({ x: 0, y: 0, width: 4, height: 4 }, { x: 2, y: 2, width: 4, height: 4 })).toEqual({ x: 2, y: 2, width: 2, height: 2 });
    expect(intersectRects({ x: 0, y: 0, width: 1, height: 1 }, { x: 2, y: 2, width: 1, height: 1 })).toBeUndefined();
    expect(rectContains({ x: 0, y: 0, width: 10, height: 10 }, { x: 1, y: 1, width: 2, height: 2 })).toBe(true);
    expect(rectContains({ x: 0, y: 0, width: 10, height: 10 }, { x: 9, y: 9, width: 2, height: 2 })).toBe(false);
    expect(roundRectOut({ x: 1.2, y: 1.8, width: 2.1, height: 2.1 })).toEqual({ x: 1, y: 1, width: 3, height: 3 });
  });
});

describe("CSS <-> image pixel conversion", () => {
  const css = { x: 10.25, y: 20.5, width: 100, height: 30.1 };
  it("multiplies by devicePixelRatio and rounds outward by default", () => {
    expect(cssToImageRect(css, { devicePixelRatio: 2 })).toEqual({ x: 20, y: 41, width: 201, height: 61 });
  });
  it("viewport rects ignore scroll", () => {
    expect(cssToImageRect(css, { devicePixelRatio: 1, scrollX: 500, scrollY: 900, round: "none" })).toEqual(css);
  });
  it("document rects subtract the scroll offset first", () => {
    expect(cssToImageRect({ x: 510, y: 920, width: 10, height: 10 }, { devicePixelRatio: 2, scrollX: 500, scrollY: 900, origin: "document" })).toEqual({ x: 20, y: 40, width: 20, height: 20 });
  });
  it("supports fractional devicePixelRatio like 1.25 and 1.5", () => {
    expect(cssToImageRect({ x: 10, y: 10, width: 10, height: 10 }, { devicePixelRatio: 1.25, round: "nearest" })).toEqual({ x: 13, y: 13, width: 13, height: 13 });
    expect(cssToImageRect({ x: 1, y: 1, width: 3, height: 3 }, { devicePixelRatio: 1.5 })).toEqual({ x: 1, y: 1, width: 5, height: 5 });
  });
  it("treats a bad devicePixelRatio as 1", () => {
    expect(cssToImageRect({ x: 1, y: 1, width: 1, height: 1 }, { devicePixelRatio: 0 })).toEqual({ x: 1, y: 1, width: 1, height: 1 });
  });
  it("imageToCssRect inverts it", () => {
    const space = { devicePixelRatio: 2, scrollX: 40, scrollY: 80, origin: "document" as const };
    const img = cssToImageRect({ x: 50, y: 100, width: 20, height: 10 }, { ...space, round: "none" });
    expect(imageToCssRect(img, space)).toEqual({ x: 50, y: 100, width: 20, height: 10 });
  });
});

// ---- B-GEOM: exact numbers and seeded property tests --------------------------------------------

import { defaultHighlightMetrics, roundRectOut as roundOut, type Rect } from "../src";

describe("B-GEOM: cssToImageRect exact cases", () => {
  const r = { x: 100.5, y: 200.25, width: 80, height: 32 };
  const cases: [string, number, { x: number; y: number; width: number; height: number }][] = [
    // dpr, expected outward-rounded image rect for r (right = (x+w)*dpr, bottom = (y+h)*dpr)
    ["dpr 1", 1, { x: 100, y: 200, width: 81, height: 33 }], // x 100.5->100, right 180.5->181, y 200.25->200, bottom 232.25->233
    ["dpr 1.25", 1.25, { x: 125, y: 250, width: 101, height: 41 }], // x 125.625->125, right 225.625->226; y 250.3125->250, bottom 290.3125->291
    ["dpr 1.5", 1.5, { x: 150, y: 300, width: 121, height: 49 }], // x 150.75->150, right 270.75->271; y 300.375->300, bottom 348.375->349
    ["dpr 2", 2, { x: 201, y: 400, width: 160, height: 65 }],
    ["dpr 2.5", 2.5, { x: 251, y: 500, width: 201, height: 81 }], // x 251.25->251, right 451.25->452; y 500.625->500, bottom 580.625->581
    ["dpr 3", 3, { x: 301, y: 600, width: 241, height: 97 }], // x 301.5->301, right 541.5->542; y 600.75->600, bottom 696.75->697
  ];
  it.each(cases)("%s", (_n, dpr, expected) => {
    expect(cssToImageRect(r, { devicePixelRatio: dpr })).toEqual(expected);
  });
  it("document origin subtracts the scroll offset first, then scales", () => {
    expect(cssToImageRect({ x: 610.5, y: 1100.25, width: 80, height: 32 }, { devicePixelRatio: 2, scrollX: 510, scrollY: 900, origin: "document" })).toEqual({ x: 201, y: 400, width: 160, height: 65 });
  });
  it("nearest and none rounding", () => {
    expect(cssToImageRect(r, { devicePixelRatio: 2, round: "nearest" })).toEqual({ x: 201, y: 401, width: 160, height: 64 });
    expect(cssToImageRect(r, { devicePixelRatio: 2, round: "none" })).toEqual({ x: 201, y: 400.5, width: 160, height: 64 });
  });
});

describe("B-GEOM: clampRect, scaleRect, highlightPath, metrics", () => {
  const bounds = { width: 200, height: 100 };
  it("clampRect: fully outside, partially outside, negative origin, inside, degenerate", () => {
    expect(clampRect({ x: 300, y: 10, width: 20, height: 20 }, bounds)).toEqual({ x: 200, y: 10, width: 0, height: 20 });
    expect(clampRect({ x: -10, y: -10, width: 30, height: 30 }, bounds)).toEqual({ x: 0, y: 0, width: 20, height: 20 });
    expect(clampRect({ x: 190, y: 90, width: 30, height: 30 }, bounds)).toEqual({ x: 190, y: 90, width: 10, height: 10 });
    expect(clampRect({ x: 10, y: 10, width: 20, height: 20 }, bounds)).toEqual({ x: 10, y: 10, width: 20, height: 20 });
    expect(clampRect({ x: -50, y: -50, width: 10, height: 10 }, bounds)).toEqual({ x: 0, y: 0, width: 0, height: 0 });
    expect(clampRect({ x: 5, y: 5, width: 0, height: 0 }, bounds)).toEqual({ x: 5, y: 5, width: 0, height: 0 });
  });
  it("scaleRect with sx != sy", () => {
    expect(scaleRect({ x: 10, y: 20, width: 30, height: 40 }, 1.5, 0.5)).toEqual({ x: 15, y: 10, width: 45, height: 20 });
  });
  it("highlightPath string goldens", () => {
    expect(highlightPath({ x: 100, y: 50, width: 200, height: 40 }, 8, 16)).toBe("M108 42H292A16 16 0 0 1 308 58V82A16 16 0 0 1 292 98H108A16 16 0 0 1 92 82V58A16 16 0 0 1 108 42Z");
    expect(highlightPath({ x: 0, y: 0, width: 10, height: 10 }, 0, 50)).toBe("M5 0H5A5 5 0 0 1 10 5V5A5 5 0 0 1 5 10H5A5 5 0 0 1 0 5V5A5 5 0 0 1 5 0Z");
    expect(highlightPath({ x: 20.5, y: 10.25, width: 30, height: 12 }, 2.5, 4)).toBe("M22 7.75H49A4 4 0 0 1 53 11.75V20.75A4 4 0 0 1 49 24.75H22A4 4 0 0 1 18 20.75V11.75A4 4 0 0 1 22 7.75Z");
  });
  it("defaultHighlightMetrics at 3 device pixel ratios (brand: pad 4, radius 8, ring 3 CSS px)", () => {
    expect(defaultHighlightMetrics(1)).toEqual({ pad: 4, radius: 8, stroke: 3 });
    expect(defaultHighlightMetrics(2)).toEqual({ pad: 8, radius: 16, stroke: 6 });
    expect(defaultHighlightMetrics(3)).toEqual({ pad: 12, radius: 24, stroke: 9 });
    expect(defaultHighlightMetrics(2, 1440)).toEqual({ pad: 12, radius: 24, stroke: 9 }); // wide capture: scale 3
    expect(defaultHighlightMetrics(0)).toEqual({ pad: 4, radius: 8, stroke: 3 });
  });
});

describe("B-GEOM: property tests (1000 seeded cases each)", () => {
  function rng(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const rand = rng(424242);
  const DPRS = [1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4];
  const randomCase = (): { r: Rect; dpr: number } => ({
    r: { x: rand() * 2000 - 200, y: rand() * 1500 - 200, width: rand() * 900, height: rand() * 300 },
    dpr: DPRS[Math.floor(rand() * DPRS.length)] as number,
  });

  it("the outward-rounded image rect always contains the exact scaled rect", () => {
    for (let i = 0; i < 1000; i++) {
      const { r, dpr } = randomCase();
      const exact = scaleRect(r, dpr);
      const out = cssToImageRect(r, { devicePixelRatio: dpr });
      expect(out.x).toBeLessThanOrEqual(exact.x);
      expect(out.y).toBeLessThanOrEqual(exact.y);
      expect(out.x + out.width).toBeGreaterThanOrEqual(exact.x + exact.width - 1e-9);
      expect(out.y + out.height).toBeGreaterThanOrEqual(exact.y + exact.height - 1e-9);
      expect(Number.isInteger(out.x) && Number.isInteger(out.y) && Number.isInteger(out.width) && Number.isInteger(out.height)).toBe(true);
    }
  });

  it("imageToCssRect(cssToImageRect(r)) is within 1/dpr of r on every edge", () => {
    for (let i = 0; i < 1000; i++) {
      const { r, dpr } = randomCase();
      const scroll = { scrollX: rand() * 500, scrollY: rand() * 800 };
      const origin = rand() < 0.5 ? ("document" as const) : ("viewport" as const);
      const space = { devicePixelRatio: dpr, ...scroll, origin };
      const back = imageToCssRect(cssToImageRect(r, space), space);
      const tol = 1 / dpr + 1e-9;
      expect(Math.abs(back.x - r.x)).toBeLessThanOrEqual(tol);
      expect(Math.abs(back.y - r.y)).toBeLessThanOrEqual(tol);
      expect(Math.abs(back.x + back.width - (r.x + r.width))).toBeLessThanOrEqual(tol);
      expect(Math.abs(back.y + back.height - (r.y + r.height))).toBeLessThanOrEqual(tol);
    }
  });

  it("clampRect always lands inside the bounds and never grows the rect", () => {
    for (let i = 0; i < 1000; i++) {
      const { r } = randomCase();
      const c = clampRect(r, { width: 800, height: 600 });
      expect(c.x).toBeGreaterThanOrEqual(0);
      expect(c.y).toBeGreaterThanOrEqual(0);
      expect(c.x + c.width).toBeLessThanOrEqual(800 + 1e-9);
      expect(c.y + c.height).toBeLessThanOrEqual(600 + 1e-9);
      expect(c.width).toBeLessThanOrEqual(r.width + 1e-9);
      expect(c.height).toBeLessThanOrEqual(r.height + 1e-9);
      expect(c.width).toBeGreaterThanOrEqual(0);
    }
  });

  it("roundRectOut is idempotent and never shrinks", () => {
    for (let i = 0; i < 1000; i++) {
      const { r } = randomCase();
      const o = roundOut(r);
      expect(roundOut(o)).toEqual(o);
      expect(o.x).toBeLessThanOrEqual(r.x);
      expect(o.x + o.width).toBeGreaterThanOrEqual(r.x + r.width - 1e-9);
    }
  });
});

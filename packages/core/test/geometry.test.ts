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

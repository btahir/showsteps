import { describe, expect, it } from "vitest";
import { clipRect, composeHops, cssRectToImage, cssRectToImageVV, displayRectToImage, imageRectToDisplay, normalizeRect, padRect, rectThroughHop, roundRect, toCropSpace, visualViewportOf } from "../src/lib/rect";
import { frameBoxFrom, offsetInto } from "../src/lib/frames";

describe("rect mapping", () => {
  it("maps CSS px to image px at dpr 2", () => {
    const r = cssRectToImage({ x: 100, y: 50, width: 80, height: 32 }, { width: 1280, height: 800 }, { width: 2560, height: 1600 });
    expect(r).toEqual({ x: 200, y: 100, width: 160, height: 64 });
  });

  it("uses the measured image/viewport ratio, not dpr (zoom, scrollbars)", () => {
    // 125% zoom on a dpr-1 screen: 1024 CSS px wide viewport captured as 1280 px.
    // 12.5 .. 137.5 rounds outward to 12 .. 138 (the ring always covers the element).
    const r = cssRectToImage({ x: 10, y: 10, width: 100, height: 20 }, { width: 1024, height: 640 }, { width: 1280, height: 800 });
    expect(r).toEqual({ x: 12, y: 12, width: 126, height: 26 });
  });

  it("clips rects that stick out of the viewport and drops off-screen ones", () => {
    expect(cssRectToImage({ x: -20, y: 780, width: 60, height: 40 }, { width: 1280, height: 800 }, { width: 1280, height: 800 })).toEqual({
      x: 0,
      y: 780,
      width: 40,
      height: 20,
    });
    expect(cssRectToImage({ x: 0, y: 900, width: 10, height: 10 }, { width: 1280, height: 800 }, { width: 1280, height: 800 })).toBeNull();
    expect(cssRectToImage({ x: 0, y: 0, width: 10, height: 10 }, { width: 0, height: 800 }, { width: 1280, height: 800 })).toBeNull();
  });

  it("scales both axes by the width ratio even when the captured height differs", () => {
    // Captured surface taller than innerHeight (e.g. emulated viewport): y must not stretch.
    expect(cssRectToImage({ x: 100, y: 200, width: 50, height: 30 }, { width: 1280, height: 702 }, { width: 1280, height: 800 })).toEqual({
      x: 100,
      y: 200,
      width: 50,
      height: 30,
    });
  });

  it("rounds fractional device pixels outward-consistently (edges, not sizes)", () => {
    expect(roundRect({ x: 10.4, y: 10.6, width: 10.2, height: 10.2 })).toEqual({ x: 10, y: 11, width: 11, height: 10 });
  });

  it("clipRect intersects with the image box", () => {
    expect(clipRect({ x: 90, y: 90, width: 20, height: 20 }, 100, 100)).toEqual({ x: 90, y: 90, width: 10, height: 10 });
    expect(clipRect({ x: 100, y: 0, width: 5, height: 5 }, 100, 100)).toBeNull();
  });

  it("maps a drag on a scaled preview back to image pixels, any drag direction", () => {
    const img = { width: 2560, height: 1600 };
    expect(displayRectToImage({ x: 100, y: 50, width: 64, height: 20 }, 640, img)).toEqual({ x: 400, y: 200, width: 256, height: 80 });
    expect(displayRectToImage({ x: 164, y: 70, width: -64, height: -20 }, 640, img)).toEqual({ x: 400, y: 200, width: 256, height: 80 });
    expect(imageRectToDisplay({ x: 400, y: 200, width: 256, height: 80 }, 2560, 640)).toEqual({ x: 100, y: 50, width: 64, height: 20 });
  });

  it("normalises, pads within bounds and shifts into crop space", () => {
    expect(normalizeRect({ x: 10, y: 10, width: -5, height: 5 })).toEqual({ x: 5, y: 10, width: 5, height: 5 });
    expect(padRect({ x: 2, y: 2, width: 10, height: 10 }, 4, 100, 100)).toEqual({ x: 0, y: 0, width: 16, height: 16 });
    expect(toCropSpace({ x: 50, y: 60, width: 10, height: 10 }, { x: 40, y: 40, width: 100, height: 100 })).toEqual({ x: 10, y: 20, width: 10, height: 10 });
    expect(toCropSpace({ x: 50, y: 60, width: 10, height: 10 }, undefined)).toEqual({ x: 50, y: 60, width: 10, height: 10 });
  });
});

// ACCEPTANCE B-GEOM, extension side: PLAN §3.8 with visualViewport. Every expected rect is literal.
describe("visualViewport mapping (B-GEOM, 10 cases)", () => {
  const vv = (width: number, height: number, offsetLeft = 0, offsetTop = 0, scale = 1) => ({ width, height, offsetLeft, offsetTop, scale });

  it("1. dpr 1, scale 1: identity", () => {
    expect(cssRectToImageVV({ x: 100, y: 50, width: 80, height: 32 }, vv(1280, 800), { width: 1280, height: 800 })).toEqual({ x: 100, y: 50, width: 80, height: 32 });
  });

  it("2. dpr 2 with a fractional rect rounds outward", () => {
    expect(cssRectToImageVV({ x: 100.5, y: 200.25, width: 80, height: 32 }, vv(1280, 800), { width: 2560, height: 1600 })).toEqual({ x: 201, y: 400, width: 160, height: 65 });
  });

  it("3. browser zoom 150% on a dpr-2 screen (sx = 3)", () => {
    // innerWidth 853.33 CSS px captured as 2560 px.
    expect(cssRectToImageVV({ x: 10, y: 20, width: 30, height: 10 }, vv(2560 / 3, 1600 / 3), { width: 2560, height: 1600 })).toEqual({ x: 30, y: 60, width: 90, height: 30 });
  });

  it("4. pinch zoom vv.scale = 2: half the layout viewport fills the image", () => {
    const v = visualViewportOf({ innerWidth: 1280, innerHeight: 800, visualViewport: { scale: 2, offsetLeft: 0, offsetTop: 0 } });
    expect(v).toEqual({ width: 640, height: 400, offsetLeft: 0, offsetTop: 0, scale: 2 });
    expect(cssRectToImageVV({ x: 100, y: 100, width: 50, height: 20 }, v, { width: 1280, height: 800 })).toEqual({ x: 200, y: 200, width: 100, height: 40 });
  });

  it("5. pinch zoom with vv.offsetLeft = 37.5 and offsetTop = 20", () => {
    const v = visualViewportOf({ innerWidth: 1280, innerHeight: 800, visualViewport: { scale: 2, offsetLeft: 37.5, offsetTop: 20 } });
    expect(cssRectToImageVV({ x: 137.5, y: 60, width: 50, height: 20 }, v, { width: 1280, height: 800 })).toEqual({ x: 200, y: 80, width: 100, height: 40 });
    // Left of the visual viewport: clipped at the image edge.
    expect(cssRectToImageVV({ x: 17.5, y: 60, width: 40, height: 20 }, v, { width: 1280, height: 800 })).toEqual({ x: 0, y: 80, width: 40, height: 40 });
  });

  it("6. image 1 px wider than innerWidth*dpr: sx = W / vv.width, not dpr", () => {
    // sx = 2561 / 1280 = 2.00078125: 1000 .. 1100 CSS px -> 2000.78 .. 2200.86 -> 2000 .. 2201.
    expect(cssRectToImageVV({ x: 1000, y: 10, width: 100, height: 10 }, vv(1280, 800), { width: 2561, height: 1600 })).toEqual({ x: 2000, y: 20, width: 201, height: 21 });
  });

  it("7. iframe with transform scale(0.5) and a 4 px border", () => {
    // Frame border box at (100, 50), 400 x 300 on screen (800 x 600 untransformed), border 4 CSS px.
    const box = frameBoxFrom({ x: 100, y: 50, width: 400, height: 300 }, { bl: 4, bt: 4, br: 4, bb: 4, pl: 0, pt: 0, pr: 0, pb: 0 }, 0.5);
    expect(box).toEqual({ x: 102, y: 52, width: 396, height: 296, scaleX: 0.5, scaleY: 0.5 });
    const inTop = rectThroughHop({ x: 40, y: 20, width: 100, height: 40 }, box);
    expect(inTop).toEqual({ x: 122, y: 62, width: 50, height: 20 });
    expect(cssRectToImageVV(inTop, vv(1280, 800), { width: 2560, height: 1600 })).toEqual({ x: 244, y: 124, width: 100, height: 40 });
  });

  it("8. nested frames: an unscaled frame inside a scale(0.5) frame compose outermost first", () => {
    const outer = { x: 100, y: 100, scaleX: 0.5, scaleY: 0.5 };
    const inner = { x: 20, y: 40, scaleX: 1, scaleY: 1 };
    expect(composeHops([outer, inner])).toEqual({ x: 110, y: 120, scaleX: 0.5, scaleY: 0.5 });
    expect(rectThroughHop({ x: 10, y: 10, width: 60, height: 30 }, composeHops([outer, inner]))).toEqual({ x: 115, y: 125, width: 30, height: 15 });
  });

  it("9. redaction rects from a scaled frame are scaled and clipped to the frame box", () => {
    const box = frameBoxFrom({ x: 100, y: 50, width: 400, height: 300 }, { bl: 0, bt: 0, br: 0, bb: 0, pl: 0, pt: 0, pr: 0, pb: 0 }, 0.5);
    expect(offsetInto([{ x: 700, y: 100, width: 200, height: 40 }, { x: 900, y: 0, width: 10, height: 10 }], box)).toEqual([{ x: 450, y: 100, width: 50, height: 20 }]);
  });

  it("10. taller capture than the viewport (headless emulation): y uses the width's factor", () => {
    // Pixels are square: 1280 px wide for 1280 CSS px means 1 px per CSS px on both axes.
    expect(cssRectToImageVV({ x: 100, y: 200, width: 50, height: 30 }, vv(1280, 713), { width: 1280, height: 800 })).toEqual({ x: 100, y: 200, width: 50, height: 30 });
    // Entirely outside after the pinch offset: nothing to draw.
    expect(cssRectToImageVV({ x: 0, y: 0, width: 10, height: 10 }, vv(640, 400, 300, 200, 2), { width: 1280, height: 800 })).toBeNull();
  });
});

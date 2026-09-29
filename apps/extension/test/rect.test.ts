import { describe, expect, it } from "vitest";
import { clipRect, cssRectToImage, displayRectToImage, imageRectToDisplay, normalizeRect, padRect, roundRect, toCropSpace } from "../src/lib/rect";

describe("rect mapping", () => {
  it("maps CSS px to image px at dpr 2", () => {
    const r = cssRectToImage({ x: 100, y: 50, width: 80, height: 32 }, { width: 1280, height: 800 }, { width: 2560, height: 1600 });
    expect(r).toEqual({ x: 200, y: 100, width: 160, height: 64 });
  });

  it("uses the measured image/viewport ratio, not dpr (zoom, scrollbars)", () => {
    // 125% zoom on a dpr-1 screen: 1024 CSS px wide viewport captured as 1280 px.
    const r = cssRectToImage({ x: 10, y: 10, width: 100, height: 20 }, { width: 1024, height: 640 }, { width: 1280, height: 800 });
    expect(r).toEqual({ x: 13, y: 13, width: 125, height: 25 });
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

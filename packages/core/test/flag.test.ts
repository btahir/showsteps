import { describe, expect, it } from "vitest";
import { decodePng, encodePng, flagLayout, flagRingPath, flagTabPath, focusFrame, highlightScale, minRingBox, renderStepImage, type Rect, type RgbaImage, type Screenshot } from "../src";
import { expectGoldenBytes } from "./golden";

const k = 2; // image px per highlight CSS px (dpr 2, narrow viewport)

describe("flagLayout: small targets and stored corners", () => {
  const checkbox: Rect = { x: 400, y: 300, width: 32, height: 32 }; // a 16 CSS px checkbox at dpr 2
  const layout = flagLayout({ target: checkbox, n: 11, scale: k, imageWidth: 1440, imageHeight: 900 });
  const tab = layout.tab!;

  it("grows the ring so the tab never spikes outside it", () => {
    const { x, w } = layout.ring;
    expect(w).toBeGreaterThanOrEqual(tab.tw + 2 * 8 * k + 4 * k - 1e-9);
    expect(layout.ring.h).toBeGreaterThanOrEqual(0.75 * tab.th - 1e-9);
    // tab spans [ax - tw, ax]; the fillet reaches f further left: all of it stays over the ring, past the corner radius
    const left = tab.ax - tab.tw - tab.f;
    expect(left).toBeGreaterThanOrEqual(x + 8 * k - 1e-9);
    expect(tab.ax).toBeLessThanOrEqual(x + w + layout.sw);
    // the ring is centred on the target
    expect(x + w / 2).toBeCloseTo(checkbox.x + checkbox.width / 2);
  });

  it("minRingBox leaves big targets alone", () => {
    const big: Rect = { x: 0, y: 0, width: 600, height: 200 };
    expect(minRingBox(big, 60, 48, 16, 2)).toEqual(big);
  });

  it("uses the stored corner, and lets the image edges win over it", () => {
    const at = (corner: "top-right" | "top-left" | "bottom-right" | "bottom-left", target: Rect) => flagLayout({ target, n: 3, scale: k, imageWidth: 1440, imageHeight: 900, corner }).tab!;
    const mid: Rect = { x: 600, y: 400, width: 200, height: 60 };
    expect([at("bottom-left", mid).top, at("bottom-left", mid).right]).toEqual([false, false]);
    expect([at("top-left", mid).top, at("top-left", mid).right]).toEqual([true, false]);
    expect([at("bottom-right", mid).top, at("bottom-right", mid).right]).toEqual([false, true]);
    expect(at("top-right", { x: 600, y: 10, width: 200, height: 60 }).top).toBe(false); // no room above
    expect(at("top-right", { x: 1300, y: 400, width: 130, height: 60 }).right).toBe(false); // no room to the right
    expect(at("top-left", { x: 4, y: 400, width: 100, height: 60 }).right).toBe(true); // no room to the left
  });

  it("without a stored corner: top-right, top-left for RTL", () => {
    const mid: Rect = { x: 600, y: 400, width: 200, height: 60 };
    expect(flagLayout({ target: mid, n: 1, scale: k, imageWidth: 1440, imageHeight: 900 }).tab).toMatchObject({ top: true, right: true });
    expect(flagLayout({ target: mid, n: 1, scale: k, imageWidth: 1440, imageHeight: 900, rtl: true }).tab).toMatchObject({ top: true, right: false });
  });

  it("produces SVG paths for ring and tab", () => {
    expect(flagRingPath(layout)).toMatch(/^M[\d. -]+H.*Z$/);
    expect(flagTabPath(layout)).toMatch(/^M.*A.*Z$/);
    expect(flagTabPath(flagLayout({ target: checkbox, scale: k, imageWidth: 1440, imageHeight: 900 }))).toBeUndefined();
  });
});

describe("focusFrame", () => {
  const image = { width: 2880, height: 1800 };
  it("is 16:10, centred on the ring, at least 480 px and 0.4 x the image width", () => {
    const f = focusFrame({ x: 1000, y: 800, width: 200, height: 60 }, image, 2);
    expect(f.width).toBe(1152); // 0.4 x 2880
    expect(f.height).toBe(720);
    expect(f.x + f.width / 2).toBeCloseTo(1100, -1);
    expect(f.y + f.height / 2).toBeCloseTo(830, -1);
  });
  it("grows to 3 x the ring width for wide targets", () => {
    const f = focusFrame({ x: 400, y: 800, width: 700, height: 60 }, image, 2);
    expect(f.width).toBe(Math.round(3 * (700 + 16)));
  });
  it("clamps inside the image at every edge", () => {
    for (const h of [{ x: 0, y: 0, width: 40, height: 40 }, { x: 2840, y: 0, width: 40, height: 40 }, { x: 0, y: 1760, width: 40, height: 40 }, { x: 2840, y: 1760, width: 40, height: 40 }]) {
      const f = focusFrame(h, image, 2);
      expect(f.x).toBeGreaterThanOrEqual(0);
      expect(f.y).toBeGreaterThanOrEqual(0);
      expect(f.x + f.width).toBeLessThanOrEqual(image.width);
      expect(f.y + f.height).toBeLessThanOrEqual(image.height);
    }
  });
  it("shrinks (keeping 16:10) for small images", () => {
    const f = focusFrame({ x: 10, y: 10, width: 20, height: 20 }, { width: 300, height: 100 }, 1);
    expect(f.height).toBe(100);
    expect(f.width).toBe(160);
  });
  it("is deterministic and whole-pixel", () => {
    const f = focusFrame({ x: 333.3, y: 444.4, width: 77.7, height: 12.2 }, image, 2);
    for (const v of Object.values(f)) expect(Number.isInteger(v)).toBe(true);
  });
});

// ---- golden renders -----------------------------------------------------------------------------

function page(width: number, height: number): RgbaImage {
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const p = (y * width + x) * 4;
    const text = y % 40 > 12 && y % 40 < 26 && (x * 7 + Math.floor(y / 40) * 13) % 11 < 6;
    const v = text ? 60 : 248;
    data[p] = v; data[p + 1] = v; data[p + 2] = v - 4; data[p + 3] = 255;
  }
  return { width, height, data };
}

describe("golden renders (sha256 of the PNG)", () => {
  const W = 1440, H = 900;
  const img = page(W, H);
  const bytes = encodePng(img, 3);
  const shot = (highlight: Rect & { corner?: "top-right" | "top-left" | "bottom-right" | "bottom-left" }): Screenshot => ({
    image: "images/x.png", width: W, height: H, devicePixelRatio: 2, viewport: { width: 720, height: 450, scrollX: 0, scrollY: 0 }, highlight,
  });
  const cases: [string, Rect & { corner?: "top-right" | "top-left" | "bottom-right" | "bottom-left" }][] = [
    ["checkbox-16px", { x: 400, y: 300, width: 32, height: 32 }],
    ["button-under-label", { x: 300, y: 340, width: 160, height: 64, corner: "bottom-right" }],
    ["edge-top-left", { x: 4, y: 4, width: 120, height: 60 }],
    ["edge-top-right", { x: W - 124, y: 4, width: 120, height: 60 }],
    ["edge-bottom-left", { x: 4, y: H - 64, width: 120, height: 60 }],
    ["edge-bottom-right", { x: W - 124, y: H - 64, width: 120, height: 60 }],
  ];
  it.each(cases)("%s", (name, hl) => {
    const out = renderStepImage(bytes, shot(hl), { stepNumber: 11 });
    expectGoldenBytes(`flag/${name}.png`, out);
    const dec = decodePng(out);
    expect([dec.width, dec.height]).toEqual([W, H]);
  });
  it("highlightScale is the brand formula (used by every case above)", () => expect(highlightScale(720, 2)).toBe(2));
});

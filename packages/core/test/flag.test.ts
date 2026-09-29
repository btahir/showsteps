import { describe, expect, it } from "vitest";
import { isInputLike, decodePng, encodePng, flagLayout, flagRingPath, flagTabPath, focusFrame, highlightScale, minRingBox, renderStepImage, type Rect, type RgbaImage, type Screenshot } from "../src";
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

describe("labels and small controls (R2-4)", () => {
  // a 13 CSS px checkbox (26 px at dpr 2) with its label to the right
  const checkbox: Rect = { x: 400, y: 300, width: 26, height: 26 };
  const label: Rect = { x: 440, y: 298, width: 300, height: 30 };
  const at = (extra: object) => flagLayout({ target: checkbox, n: 11, scale: k, imageWidth: 1440, imageHeight: 900, ...extra });

  it("with a label rect, the ring goes around the control and its label together", () => {
    const l = at({ labelRect: label });
    expect(l.ring.x).toBeLessThanOrEqual(checkbox.x);
    expect(l.ring.x + l.ring.w).toBeGreaterThanOrEqual(label.x + label.width);
    const alone = at({});
    expect(l.ring.w).toBeGreaterThan(alone.ring.w);
  });

  it("a big enough control ignores its label", () => {
    const big: Rect = { x: 400, y: 300, width: 300, height: 60 };
    expect(flagLayout({ target: big, n: 3, scale: k, imageWidth: 1440, imageHeight: 900, labelRect: { x: 720, y: 310, width: 100, height: 30 } }).ring)
      .toEqual(flagLayout({ target: big, n: 3, scale: k, imageWidth: 1440, imageHeight: 900 }).ring);
  });

  it("without a label rect but with a stored corner, the ring grows toward the free side only", () => {
    const right = at({ corner: "top-right" }).ring;
    const left = at({ corner: "top-left" }).ring;
    expect(right.x).toBeCloseTo(checkbox.x - 4 * k); // left edge stays at the control (plus padding)
    expect(right.x + right.w).toBeGreaterThan(checkbox.x + checkbox.width + 4 * k);
    expect(left.x + left.w).toBeCloseTo(checkbox.x + checkbox.width + 4 * k);
    expect(left.x).toBeLessThan(checkbox.x - 4 * k);
  });

  it("the label rect follows a crop and renders", () => {
    const W = 1440, H = 900;
    const data = new Uint8Array(W * H * 4).fill(240);
    const bytes = encodePng({ width: W, height: H, data }, 3);
    const shot: Screenshot = { image: "i", width: W, height: H, devicePixelRatio: 2, viewport: { width: 720, height: 450, scrollX: 0, scrollY: 0 }, highlight: { ...checkbox, labelRect: label }, crop: { x: 300, y: 250, width: 700, height: 300 } };
    const out = decodePng(renderStepImage(bytes, shot, { stepNumber: 11 }));
    expect([out.width, out.height]).toEqual([700, 300]);
    expectGoldenBytes("flag/checkbox-with-label.png", renderStepImage(bytes, { ...shot, crop: undefined }, { stepNumber: 11 }));
  });
});

describe("labels above inputs (R3-3)", () => {
  const field: Rect = { x: 400, y: 300, width: 400, height: 44 };
  const base = { target: field, n: 4, scale: k, imageWidth: 1440, imageHeight: 900 } as const;
  it("an input gets 2 CSS px of ring above it instead of 4", () => {
    const plain = flagLayout(base).ring, input = flagLayout({ ...base, inputLike: true }).ring;
    expect(plain.y).toBeCloseTo(field.y - 4 * k);
    expect(input.y).toBeCloseTo(field.y - 2 * k);
    expect(input.x).toBeCloseTo(plain.x); // sides and bottom unchanged
    expect(input.y + input.h).toBeCloseTo(plain.y + plain.h);
  });
  it("a label right above the field stops the ring 1 px below the label", () => {
    const label: Rect = { x: 400, y: 284, width: 120, height: 14 }; // bottom at 298, field top 300
    const r = flagLayout({ ...base, labelRect: label }).ring;
    expect(r.y).toBeCloseTo(299);
    expect(r.y).toBeGreaterThanOrEqual(label.y + label.height);
  });
  it("a label further than 8 CSS px above is ignored", () => {
    const far: Rect = { x: 400, y: 240, width: 120, height: 14 };
    expect(flagLayout({ ...base, labelRect: far }).ring.y).toBeCloseTo(field.y - 4 * k);
  });
  it("checkbox labels to the side still ring together", () => {
    const cb: Rect = { x: 400, y: 300, width: 26, height: 26 };
    const l = flagLayout({ target: cb, n: 4, scale: k, imageWidth: 1440, imageHeight: 900, labelRect: { x: 440, y: 298, width: 300, height: 30 } }).ring;
    expect(l.x + l.w).toBeGreaterThanOrEqual(740);
  });
  it("isInputLike picks text inputs, selects and textareas, not checkboxes or buttons", () => {
    const t = (tag: string, extra: object = {}) => isInputLike({ target: { tag, locators: [{ kind: "css", value: tag }], ...extra } });
    expect(t("input", { inputType: "email" })).toBe(true);
    expect(t("select")).toBe(true);
    expect(t("textarea")).toBe(true);
    expect(t("div", { role: "textbox" })).toBe(true);
    expect(t("input", { inputType: "checkbox" })).toBe(false);
    expect(t("button")).toBe(false);
    expect(isInputLike({})).toBe(false);
  });
});

describe("focusFrame", () => {
  const image = { width: 2880, height: 1800 };
  it("is 16:10 and centred on the ring; width = max(1.6 x ring, 0.3 x image, 360 CSS px)", () => {
    const f = focusFrame({ x: 1000, y: 800, width: 200, height: 60 }, image, 2, 2);
    expect(f.width).toBe(864); // 0.3 x 2880
    expect(f.height).toBe(540);
    expect(f.x + f.width / 2).toBeCloseTo(1100, -1);
    expect(f.y + f.height / 2).toBeCloseTo(830, -1);
  });
  it("uses 360 CSS px on a big capture of a small target", () => {
    expect(focusFrame({ x: 1000, y: 800, width: 20, height: 20 }, { width: 1000, height: 800 }, 1, 1).width).toBe(360); // 0.3 x 1000 = 300 < 360
    expect(focusFrame({ x: 1000, y: 800, width: 20, height: 20 }, { width: 5000, height: 3000 }, 2, 2).width).toBe(1500);
  });
  it("grows to 1.6 x the ring width for wide targets", () => {
    const f = focusFrame({ x: 400, y: 800, width: 700, height: 60 }, image, 2, 2);
    expect(f.width).toBe(Math.round(1.6 * (700 + 16)));
  });
  it("a DPR 1 email field (360 px wide on a 1280 capture) gets a window well under the whole image", () => {
    const f = focusFrame({ x: 460, y: 300, width: 360, height: 36 }, { width: 1280, height: 800 }, 1, 1);
    expect(f.width / 1280).toBeLessThan(0.55);
    expect(f.width).toBe(Math.round(1.6 * (360 + 8)));
  });
  it("a wide ring is never cut off: the window is at least the ring plus 24 CSS px each side (R3-5)", () => {
    const f = focusFrame({ x: 400, y: 800, width: 2000, height: 60 }, { width: 5000, height: 3000 }, 2, 2);
    expect(f.width).toBeGreaterThanOrEqual(2000 + 16 + 96 - 1);
    expect(f.x).toBeLessThanOrEqual(400 - 8 - 48 + 1);
    expect(f.x + f.width).toBeGreaterThanOrEqual(2400 + 8 + 48 - 1);
  });
  it("grows the height only when the ring and its tab do not fit", () => {
    const tall = focusFrame({ x: 1000, y: 400, width: 200, height: 500 }, image, 2, 2);
    expect(tall.width).toBe(864);
    expect(tall.height).toBeGreaterThan(540);
    expect(tall.height).toBeGreaterThanOrEqual(500 + 16 + 48);
  });
  it("clamps inside the image at every edge", () => {
    for (const h of [{ x: 0, y: 0, width: 40, height: 40 }, { x: 2840, y: 0, width: 40, height: 40 }, { x: 0, y: 1760, width: 40, height: 40 }, { x: 2840, y: 1760, width: 40, height: 40 }]) {
      const f = focusFrame(h, image, 2, 2);
      expect(f.x).toBeGreaterThanOrEqual(0);
      expect(f.y).toBeGreaterThanOrEqual(0);
      expect(f.x + f.width).toBeLessThanOrEqual(image.width);
      expect(f.y + f.height).toBeLessThanOrEqual(image.height);
    }
  });
  it("shrinks for small images", () => {
    const f = focusFrame({ x: 10, y: 10, width: 20, height: 20 }, { width: 300, height: 100 }, 1, 1);
    expect(f.height).toBeLessThanOrEqual(100);
    expect(f.width).toBeLessThanOrEqual(300);
  });
  it("is deterministic and whole-pixel", () => {
    const f = focusFrame({ x: 333.3, y: 444.4, width: 77.7, height: 12.2 }, image, 2, 2);
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

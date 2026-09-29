import { describe, expect, it } from "vitest";
import { decodePng, encodePng, isPng, pngSize, PngError, RenderError, renderStepImage, parseColor, redactRegion, type Screenshot } from "../src";
import { fixtureGuide, fixtureImages, fixturePng } from "./fixtures/guide";

const guide = fixtureGuide();
const images = fixtureImages();
const shotOf = (id: string): Screenshot => guide.steps.find((s) => s.id === id)?.screenshot as Screenshot;

function pixel(img: { width: number; data: Uint8Array }, x: number, y: number): number[] {
  const p = (y * img.width + x) * 4;
  return [img.data[p] as number, img.data[p + 1] as number, img.data[p + 2] as number, img.data[p + 3] as number];
}

describe("png codec", () => {
  it("round-trips RGBA exactly", () => {
    const data = new Uint8Array(5 * 3 * 4).map((_, i) => (i * 37) & 255);
    const png = encodePng({ width: 5, height: 3, data });
    expect(isPng(png)).toBe(true);
    expect(pngSize(png)).toEqual({ width: 5, height: 3 });
    const back = decodePng(png);
    expect(back.width).toBe(5);
    expect(Array.from(back.data)).toEqual(Array.from(data));
  });
  it("is deterministic", () => {
    expect(Array.from(fixturePng({ tab: 1 }))).toEqual(Array.from(fixturePng({ tab: 1 })));
  });
  it("rejects garbage", () => {
    expect(() => decodePng(new Uint8Array([1, 2, 3]))).toThrow(PngError);
    expect(() => encodePng({ width: 2, height: 2, data: new Uint8Array(3) })).toThrow(PngError);
  });
  it("decodes an 8-bit RGB PNG made by another encoder (hand-built)", () => {
    // 2x1 RGB, filter 0: red, blue
    const raw = new Uint8Array([0, 255, 0, 0, 0, 0, 255]);
    const png = encodeRawRgb(raw);
    const img = decodePng(png);
    expect(pixel(img, 0, 0)).toEqual([255, 0, 0, 255]);
    expect(pixel(img, 1, 0)).toEqual([0, 0, 255, 255]);
  });
});

import { zlibSync } from "fflate";
function encodeRawRgb(raw: Uint8Array): Uint8Array {
  const chunk = (type: string, body: Uint8Array): Uint8Array => {
    const out = new Uint8Array(12 + body.length);
    const dv = new DataView(out.buffer);
    dv.setUint32(0, body.length);
    for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
    out.set(body, 8);
    // CRC is not verified by our decoder; leave zero
    return out;
  };
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, 2);
  dv.setUint32(4, 1);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const parts = [new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", zlibSync(raw)), chunk("IEND", new Uint8Array(0))];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

describe("parseColor", () => {
  it.each([
    ["#ff5a1f", [255, 90, 31]],
    ["#f00", [255, 0, 0]],
    ["#11223344", [17, 34, 51]],
    ["rgb(1, 2, 3)", [1, 2, 3]],
    ["rgba(10 20 30 / 50%)", [10, 20, 30]],
    ["red", [255, 0, 0]],
  ])("%s", (css, rgb) => expect(parseColor(css)).toEqual(rgb));
  it("returns undefined for junk", () => expect(parseColor("var(--x)")).toBeUndefined());
});

describe("renderStepImage", () => {
  it("returns the same bytes when there is nothing to draw", () => {
    const bytes = images["images/s_open.png"] as Uint8Array;
    expect(renderStepImage(bytes, shotOf("s_open"))).toBe(bytes);
  });

  it("draws the highlight ring around the target and leaves far pixels alone", () => {
    const bytes = images["images/s_signin.png"] as Uint8Array;
    const out = decodePng(renderStepImage(bytes, shotOf("s_signin"), { highlightColor: "#ff0000" }));
    const before = decodePng(bytes);
    const h = shotOf("s_signin").highlight as { x: number; y: number; width: number; height: number };
    // a pixel on the ring: pad 6 (dpr 2), stroke 5 -> the outermost ring pixel sits at x - 6
    const px = pixel(out, h.x - 5, h.y + 4);
    expect(px[0]).toBeGreaterThan(200);
    expect(px[1]).toBeLessThan(120);
    expect(pixel(out, 150, 90)).toEqual(pixel(before, 150, 90));
    expect(out.width).toBe(160);
    expect(out.height).toBe(100);
  });

  it("bakes a solid redaction and removes the original pixels", () => {
    const bytes = images["images/s_pass.png"] as Uint8Array;
    const shot = { ...shotOf("s_pass"), redactions: [{ rect: { x: 16, y: 42, width: 128, height: 18 }, style: "solid" as const }], highlight: undefined };
    const before = decodePng(bytes);
    expect(pixel(before, 60, 50)).toEqual([34, 34, 34, 255]); // the fake password text
    const out = decodePng(renderStepImage(bytes, shot));
    expect(pixel(out, 60, 50)).toEqual([26, 26, 26, 255]);
    expect(pixel(out, 5, 5)).toEqual(pixel(before, 5, 5));
  });

  it("blur and pixelate destroy detail inside the rect but keep the outside", () => {
    const img = { width: 40, height: 20, data: new Uint8Array(40 * 20 * 4) };
    for (let y = 0; y < 20; y++) for (let x = 0; x < 40; x++) {
      const p = (y * 40 + x) * 4;
      const v = (x + y) % 2 === 0 ? 0 : 255; // checkerboard: maximum detail
      img.data[p] = img.data[p + 1] = img.data[p + 2] = v; img.data[p + 3] = 255;
    }
    for (const style of ["blur", "pixelate"] as const) {
      const copy = { ...img, data: img.data.slice() };
      redactRegion(copy, { x: 10, y: 4, width: 20, height: 12 }, style);
      const inside = new Set<number>();
      for (let y = 4; y < 16; y++) for (let x = 10; x < 30; x++) inside.add(pixel(copy, x, y)[0] as number);
      const spread = Math.max(...inside) - Math.min(...inside);
      expect(spread).toBeLessThan(40);
      expect(pixel(copy, 9, 4)).toEqual(pixel(img, 9, 4));
      expect(pixel(copy, 30, 15)).toEqual(pixel(img, 30, 15));
    }
  });

  it("applies the crop last and shrinks the output", () => {
    const bytes = images["images/s_email.png"] as Uint8Array;
    const shot = { ...shotOf("s_email"), crop: { x: 10, y: 20, width: 100, height: 40 } };
    const out = decodePng(renderStepImage(bytes, shot));
    expect(out.width).toBe(100);
    expect(out.height).toBe(40);
  });

  it("refuses to export unredacted pixels when the image cannot be decoded", () => {
    const shot = { ...shotOf("s_pass") };
    expect(() => renderStepImage(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]), shot)).toThrow(RenderError);
  });

  it("passes undecodable images through when only the highlight was wanted", () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
    expect(renderStepImage(jpeg, shotOf("s_signin"))).toBe(jpeg);
  });

  it("scales rects when the bytes are a different size than the metadata says", () => {
    const bytes = images["images/s_pass.png"] as Uint8Array; // 160x100
    const shot = { ...shotOf("s_pass"), width: 80, height: 50, highlight: undefined, redactions: [{ rect: { x: 9, y: 22, width: 62, height: 7 }, style: "solid" as const }] };
    const out = decodePng(renderStepImage(bytes, shot));
    expect(pixel(out, 60, 50)).toEqual([26, 26, 26, 255]);
  });
});

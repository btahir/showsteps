import { zlibSync } from "fflate";
import { describe, expect, it } from "vitest";
import { decodePng, encodePng, isPng, PngError, pngSize } from "../src";
import { fixturePng } from "./fixtures/guide";

function chunk(type: string, body: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + body.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, body.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(body, 8);
  return out; // CRC left zero: our decoder does not verify it
}
const SIG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
function png(width: number, height: number, colorType: number, depth: number, raw: Uint8Array, extra: Uint8Array[] = []): Uint8Array {
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, width);
  dv.setUint32(4, height);
  ihdr[8] = depth;
  ihdr[9] = colorType;
  const parts = [SIG, chunk("IHDR", ihdr), ...extra, chunk("IDAT", zlibSync(raw)), chunk("IEND", new Uint8Array(0))];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}
const px = (img: { width: number; data: Uint8Array }, x: number, y: number): number[] => Array.from(img.data.subarray((y * img.width + x) * 4, (y * img.width + x) * 4 + 4));

describe("png codec", () => {
  it("decodePng(encodePng(x)) is lossless, for many sizes", () => {
    for (const [w, h] of [[1, 1], [5, 3], [64, 64], [257, 13], [3, 300]] as const) {
      const data = new Uint8Array(w * h * 4);
      for (let i = 0; i < data.length; i++) data[i] = (i * 2654435761) >>> 24;
      const back = decodePng(encodePng({ width: w, height: h, data }));
      expect([back.width, back.height]).toEqual([w, h]);
      expect(Array.from(back.data)).toEqual(Array.from(data));
    }
  });

  it("is deterministic and reports its size without decoding", () => {
    const a = fixturePng({ tab: 1, target: { x: 10, y: 10, width: 20, height: 10 } });
    expect(Array.from(a)).toEqual(Array.from(fixturePng({ tab: 1, target: { x: 10, y: 10, width: 20, height: 10 } })));
    expect(isPng(a)).toBe(true);
    expect(pngSize(a)).toEqual({ width: 160, height: 100 });
    expect(isPng(new Uint8Array([1, 2, 3]))).toBe(false);
    expect(pngSize(new Uint8Array(30))).toBeUndefined();
  });

  it("decodes RGB, gray, gray+alpha, palette and 16-bit PNGs (all filters)", () => {
    const rgb = decodePng(png(2, 1, 2, 8, new Uint8Array([0, 255, 0, 0, 0, 0, 255])));
    expect(px(rgb, 0, 0)).toEqual([255, 0, 0, 255]);
    expect(px(rgb, 1, 0)).toEqual([0, 0, 255, 255]);
    const gray = decodePng(png(2, 1, 0, 8, new Uint8Array([0, 10, 200])));
    expect(px(gray, 1, 0)).toEqual([200, 200, 200, 255]);
    const ga = decodePng(png(1, 1, 4, 8, new Uint8Array([0, 50, 128])));
    expect(px(ga, 0, 0)).toEqual([50, 50, 50, 128]);
    const pal = decodePng(png(2, 1, 3, 8, new Uint8Array([0, 1, 0]), [chunk("PLTE", new Uint8Array([9, 8, 7, 1, 2, 3])), chunk("tRNS", new Uint8Array([255, 40]))]));
    expect(px(pal, 0, 0)).toEqual([1, 2, 3, 40]);
    expect(px(pal, 1, 0)).toEqual([9, 8, 7, 255]);
    const pal4 = decodePng(png(3, 1, 3, 4, new Uint8Array([0, 0x01, 0x20]), [chunk("PLTE", new Uint8Array([0, 0, 0, 255, 0, 0, 0, 255, 0]))]));
    expect([px(pal4, 0, 0)[0], px(pal4, 1, 0)[0], px(pal4, 2, 0)[1]]).toEqual([0, 255, 255]);
    const deep = decodePng(png(1, 1, 6, 16, new Uint8Array([0, 200, 1, 100, 2, 50, 3, 255, 4])));
    expect(px(deep, 0, 0)).toEqual([200, 100, 50, 255]);
    // Sub, Up, Average, Paeth over a 3x2 RGB image
    const rows = (ft: number): Uint8Array => new Uint8Array([ft, 10, 20, 30, 1, 1, 1, 1, 1, 1, ft, 5, 5, 5, 2, 2, 2, 3, 3, 3]);
    for (const ft of [0, 1, 2, 3, 4]) {
      const img = decodePng(png(3, 2, 2, 8, rows(ft)));
      expect(img.data.length).toBe(24);
    }
    const sub = decodePng(png(3, 1, 2, 8, new Uint8Array([1, 10, 20, 30, 1, 1, 1, 1, 1, 1])));
    expect(px(sub, 2, 0)).toEqual([12, 22, 32, 255]);
  });

  it("rejects unsupported and corrupt input with PngError", () => {
    expect(() => decodePng(new Uint8Array([1, 2, 3]))).toThrow(PngError);
    expect(() => encodePng({ width: 2, height: 2, data: new Uint8Array(3) })).toThrow(PngError);
    expect(() => encodePng({ width: 0, height: 2, data: new Uint8Array(0) })).toThrow(PngError);
    const interlaced = png(1, 1, 2, 8, new Uint8Array([0, 1, 2, 3]));
    interlaced[16 + 12] = 1; // IHDR interlace byte
    expect(() => decodePng(interlaced)).toThrow(/interlaced/);
    const good = png(1, 1, 2, 8, new Uint8Array([0, 1, 2, 3]));
    expect(() => decodePng(good.subarray(0, good.length - 20))).toThrow(PngError);
    expect(() => decodePng(png(4, 4, 2, 8, new Uint8Array([0, 1])))).toThrow(/too short/);
  });

  it("rejects images over 64,000,000 pixels before decoding them", () => {
    const ihdr = new Uint8Array(13);
    const dv = new DataView(ihdr.buffer);
    dv.setUint32(0, 9000);
    dv.setUint32(4, 9000); // 81M pixels
    ihdr[8] = 8;
    ihdr[9] = 6;
    const bomb = new Uint8Array([...SIG, ...chunk("IHDR", ihdr), ...chunk("IEND", new Uint8Array(0))]);
    expect(() => decodePng(bomb)).toThrow(PngError);
    expect(() => decodePng(bomb)).toThrow(/too large/);
  });
});

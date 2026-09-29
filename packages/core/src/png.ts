// Minimal PNG codec on top of fflate (pure TS). Enough to redact, highlight and crop
// screenshots (8/16-bit gray, RGB, palette, gray+alpha, RGBA; non-interlaced) and to
// generate test fixtures. Output is always 8-bit RGBA.

import { unzlibSync, zlibSync } from "fflate";

export interface RgbaImage {
  width: number;
  height: number;
  /** width * height * 4 bytes, straight (non-premultiplied) RGBA. */
  data: Uint8Array;
}

export class PngError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PngError";
  }
}

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

let CRC_TABLE: Uint32Array | undefined;
/** CRC-32 (PNG/zip polynomial) of `bytes[start, end)`. */
export function crc32(bytes: Uint8Array, start = 0, end: number = bytes.length): number {
  if (!CRC_TABLE) {
    CRC_TABLE = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      CRC_TABLE[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = start; i < end; i++) crc = (CRC_TABLE[(crc ^ (bytes[i] as number)) & 0xff] as number) ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

export function isPng(bytes: Uint8Array): boolean {
  return bytes.length >= 8 && SIGNATURE.every((b, i) => bytes[i] === b);
}

function u32(b: Uint8Array, o: number): number {
  return (((b[o] as number) << 24) | ((b[o + 1] as number) << 16) | ((b[o + 2] as number) << 8) | (b[o + 3] as number)) >>> 0;
}

function chunk(type: string, body: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + body.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, body.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(body, 8);
  dv.setUint32(8 + body.length, crc32(out, 4, 8 + body.length));
  return out;
}

/** Encode straight RGBA pixels as an 8-bit RGBA PNG (Sub filter, deflate). Deterministic. */
export function encodePng(img: RgbaImage, level: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 = 6): Uint8Array {
  const { width, height, data } = img;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) throw new PngError(`invalid size ${width}x${height}`);
  if (data.length !== width * height * 4) throw new PngError("pixel buffer does not match width * height * 4");
  const stride = width * 4;
  const raw = new Uint8Array((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    const ro = y * (stride + 1);
    raw[ro] = 1; // Sub
    const so = y * stride;
    for (let x = 0; x < stride; x++) {
      const left = x >= 4 ? (data[so + x - 4] as number) : 0;
      raw[ro + 1 + x] = ((data[so + x] as number) - left) & 0xff;
    }
  }
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, width);
  dv.setUint32(4, height);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const parts = [new Uint8Array(SIGNATURE), chunk("IHDR", ihdr), chunk("IDAT", zlibSync(raw, { level })), chunk("IEND", new Uint8Array(0))];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

const paeth = (a: number, b: number, c: number): number => {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
};

/** Read width and height from the IHDR without decoding. */
export function pngSize(bytes: Uint8Array): { width: number; height: number } | undefined {
  if (!isPng(bytes) || bytes.length < 24) return undefined;
  return { width: u32(bytes, 16), height: u32(bytes, 20) };
}

/** Decode a non-interlaced PNG into 8-bit RGBA. Throws `PngError` for anything unsupported. */
export function decodePng(bytes: Uint8Array, maxPixels = 64_000_000): RgbaImage {
  if (!isPng(bytes)) throw new PngError("not a PNG file");
  let o = 8;
  let width = 0;
  let height = 0;
  let depth = 0;
  let colorType = 0;
  let interlace = 0;
  let palette: Uint8Array | undefined;
  let trns: Uint8Array | undefined;
  const idat: Uint8Array[] = [];
  while (o + 8 <= bytes.length) {
    const len = u32(bytes, o);
    const type = String.fromCharCode(bytes[o + 4] as number, bytes[o + 5] as number, bytes[o + 6] as number, bytes[o + 7] as number);
    const body = bytes.subarray(o + 8, o + 8 + len);
    if (o + 12 + len > bytes.length) throw new PngError("truncated PNG");
    if (type === "IHDR") {
      width = u32(body, 0);
      height = u32(body, 4);
      depth = body[8] as number;
      colorType = body[9] as number;
      interlace = body[12] as number;
    } else if (type === "PLTE") palette = body;
    else if (type === "tRNS") trns = body;
    else if (type === "IDAT") idat.push(body);
    else if (type === "IEND") break;
    o += 12 + len;
  }
  if (!width || !height) throw new PngError("missing IHDR");
  if (width * height > maxPixels) throw new PngError(`image too large (${width}x${height})`);
  if (interlace !== 0) throw new PngError("interlaced PNGs are not supported");
  if (depth !== 8 && depth !== 16 && !(colorType === 3 && depth < 8) && !(colorType === 0 && depth < 8)) throw new PngError(`unsupported bit depth ${depth}`);
  const channels = ({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 } as Record<number, number>)[colorType];
  if (!channels) throw new PngError(`unsupported colour type ${colorType}`);
  if (colorType === 3 && !palette) throw new PngError("palette PNG without PLTE");

  const total = idat.reduce((n, p) => n + p.length, 0);
  const joined = new Uint8Array(total);
  let jo = 0;
  for (const p of idat) {
    joined.set(p, jo);
    jo += p.length;
  }
  let inflated: Uint8Array;
  try {
    inflated = unzlibSync(joined);
  } catch {
    throw new PngError("corrupt PNG image data");
  }
  const bitsPerPixel = channels * depth;
  const bpp = Math.max(1, bitsPerPixel >> 3);
  const stride = Math.ceil((width * bitsPerPixel) / 8);
  if (inflated.length < (stride + 1) * height) throw new PngError("PNG image data is too short");
  const cur = new Uint8Array(stride);
  let prev = new Uint8Array(stride);
  const out = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    const ro = y * (stride + 1);
    const ft = inflated[ro] as number;
    for (let x = 0; x < stride; x++) {
      const v = inflated[ro + 1 + x] as number;
      const a = x >= bpp ? (cur[x - bpp] as number) : 0;
      const b = prev[x] as number;
      const c = x >= bpp ? (prev[x - bpp] as number) : 0;
      let r: number;
      switch (ft) {
        case 0: r = v; break;
        case 1: r = v + a; break;
        case 2: r = v + b; break;
        case 3: r = v + ((a + b) >> 1); break;
        case 4: r = v + paeth(a, b, c); break;
        default: throw new PngError(`bad filter type ${ft}`);
      }
      cur[x] = r & 0xff;
    }
    const oo = y * width * 4;
    for (let x = 0; x < width; x++) {
      const p = oo + x * 4;
      if (depth === 8) {
        const i = x * channels;
        if (colorType === 6) {
          out[p] = cur[i] as number; out[p + 1] = cur[i + 1] as number; out[p + 2] = cur[i + 2] as number; out[p + 3] = cur[i + 3] as number;
        } else if (colorType === 2) {
          out[p] = cur[i] as number; out[p + 1] = cur[i + 1] as number; out[p + 2] = cur[i + 2] as number; out[p + 3] = 255;
        } else if (colorType === 0) {
          const g = cur[i] as number;
          out[p] = g; out[p + 1] = g; out[p + 2] = g; out[p + 3] = 255;
        } else if (colorType === 4) {
          const g = cur[i] as number;
          out[p] = g; out[p + 1] = g; out[p + 2] = g; out[p + 3] = cur[i + 1] as number;
        } else {
          const idx = cur[i] as number;
          out[p] = (palette as Uint8Array)[idx * 3] ?? 0;
          out[p + 1] = (palette as Uint8Array)[idx * 3 + 1] ?? 0;
          out[p + 2] = (palette as Uint8Array)[idx * 3 + 2] ?? 0;
          out[p + 3] = trns ? (trns[idx] ?? 255) : 255;
        }
      } else if (depth === 16) {
        const i = x * channels * 2;
        const hi = (k: number): number => cur[i + k * 2] as number;
        if (colorType === 6) { out[p] = hi(0); out[p + 1] = hi(1); out[p + 2] = hi(2); out[p + 3] = hi(3); }
        else if (colorType === 2) { out[p] = hi(0); out[p + 1] = hi(1); out[p + 2] = hi(2); out[p + 3] = 255; }
        else if (colorType === 0) { out[p] = out[p + 1] = out[p + 2] = hi(0); out[p + 3] = 255; }
        else { out[p] = out[p + 1] = out[p + 2] = hi(0); out[p + 3] = hi(1); }
      } else {
        // 1, 2 or 4 bit gray or palette
        const bitPos = x * depth;
        const byte = cur[bitPos >> 3] as number;
        const shift = 8 - depth - (bitPos & 7);
        const v = (byte >> shift) & ((1 << depth) - 1);
        if (colorType === 3) {
          out[p] = (palette as Uint8Array)[v * 3] ?? 0;
          out[p + 1] = (palette as Uint8Array)[v * 3 + 1] ?? 0;
          out[p + 2] = (palette as Uint8Array)[v * 3 + 2] ?? 0;
          out[p + 3] = trns ? (trns[v] ?? 255) : 255;
        } else {
          const g = Math.round((v * 255) / ((1 << depth) - 1));
          out[p] = g; out[p + 1] = g; out[p + 2] = g; out[p + 3] = 255;
        }
      }
    }
    prev = cur.slice();
  }
  return { width, height, data: out };
}

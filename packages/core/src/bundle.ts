import { unzipSync, zipSync, type Zippable } from "fflate";
import type { Guide } from "./schema";
import type { ImageSource } from "./types";
import { canonicalJson } from "./json";
import { crc32 } from "./png";
import { GuideValidationError, isSafeBundlePath, migrateGuide, validateGuide } from "./validate";

/** File extension of a saved project (a zip with `guide.json` + `images/`). Older builds used `.stepsnap`. */
export const BUNDLE_EXTENSION = ".showsteps";

export class BundleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BundleError";
  }
}

const MAX_ENTRY_BYTES = 256 * 1024 * 1024;
const MAX_TOTAL_BYTES = 512 * 1024 * 1024;
const MAX_ENTRIES = 2000;

// DOS timestamps have no time zone; building the date with local getters keeps bytes identical everywhere.
const FIXED_MTIME = new Date(1980, 0, 1, 0, 0, 0);

const enc = new TextEncoder();

/** Paths of the screenshots the guide references, in step order, without duplicates. */
export function referencedImages(guide: Guide): string[] {
  const seen = new Set<string>();
  for (const s of guide.steps) if (s.screenshot) seen.add(s.screenshot.image);
  return [...seen];
}

/**
 * Serialize a guide and its screenshots as a `.showsteps` zip: `guide.json` first, then `images/...`
 * sorted by name. Output is byte-stable: same input gives the same bytes on every machine and run.
 * Throws `GuideValidationError` for an invalid guide and `BundleError` if a referenced image is missing.
 */
export function packBundle(guide: Guide, images: ImageSource): Uint8Array {
  const check = validateGuide(guide);
  if (!check.ok) throw new GuideValidationError(check.errors, "Cannot pack an invalid guide");
  const paths = referencedImages(guide).sort();
  const missing = paths.filter((p) => !images[p]);
  if (missing.length) {
    throw new BundleError(`Cannot pack: ${missing.length} screenshot${missing.length === 1 ? "" : "s"} missing from images (${missing.slice(0, 3).join(", ")}${missing.length > 3 ? ", ..." : ""})`);
  }
  const entries: Zippable = {
    "guide.json": [enc.encode(canonicalJson(guide)), { level: 6, mtime: FIXED_MTIME }],
  };
  for (const p of paths) entries[p] = [images[p] as Uint8Array, { level: 0, mtime: FIXED_MTIME }];
  return zipSync(entries);
}

/** Names, sizes and CRC-32s from the zip's central directory (no Zip64). Empty map if unreadable. */
function readCentralDirectory(zip: Uint8Array): Map<string, { size: number; crc: number }> {
  const out = new Map<string, { size: number; crc: number }>();
  if (zip.length < 22) return out;
  const dv = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  let eocd = -1;
  for (let o = zip.length - 22; o >= Math.max(0, zip.length - 22 - 65535); o--) {
    if (dv.getUint32(o, true) === 0x06054b50) {
      eocd = o;
      break;
    }
  }
  if (eocd < 0) return out;
  const count = dv.getUint16(eocd + 10, true);
  let o = dv.getUint32(eocd + 16, true);
  for (let i = 0; i < count && o + 46 <= zip.length; i++) {
    if (dv.getUint32(o, true) !== 0x02014b50) break;
    const nameLen = dv.getUint16(o + 28, true);
    const extraLen = dv.getUint16(o + 30, true);
    const commentLen = dv.getUint16(o + 32, true);
    const name = new TextDecoder().decode(zip.subarray(o + 46, o + 46 + nameLen));
    out.set(name, { crc: dv.getUint32(o + 16, true), size: dv.getUint32(o + 24, true) });
    o += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

export interface UnpackedBundle {
  guide: Guide;
  images: ImageSource;
}

/**
 * Read a `.showsteps` zip. Migrates old schema versions. Every failure is a typed error, never a
 * partial result: `BundleError` (unsafe or oversized entries, missing files, missing screenshots,
 * corrupt zip) or `GuideValidationError` (guide.json is not a valid guide).
 */
export function unpackBundle(bytes: Uint8Array): UnpackedBundle {
  let total = 0;
  let count = 0;
  const declared = new Map<string, number>();
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes, {
      filter: (f) => {
        if (++count > MAX_ENTRIES) throw new BundleError(`Bundle has too many entries (more than ${MAX_ENTRIES})`);
        const isDir = f.name.endsWith("/");
        const bare = isDir ? f.name.slice(0, -1) : f.name;
        if (!isSafeBundlePath(bare)) throw new BundleError(`Bundle contains an unsafe entry name: ${JSON.stringify(f.name.slice(0, 80))}`);
        if (f.originalSize > MAX_ENTRY_BYTES) throw new BundleError(`Entry ${f.name} is too large (${f.originalSize} bytes)`);
        total += f.originalSize;
        if (total > MAX_TOTAL_BYTES) throw new BundleError("Bundle is too large to open (over 512 MB unpacked)");
        if (isDir) return false;
        const keep = f.name === "guide.json" || f.name.startsWith("images/");
        if (keep) declared.set(f.name, f.originalSize);
        return keep;
      },
    });
  } catch (e) {
    if (e instanceof BundleError) throw e;
    throw new BundleError("Not a Showsteps project file (could not read it as a zip)");
  }
  const directory = readCentralDirectory(bytes);
  for (const [name, data] of Object.entries(files)) {
    const entry = directory.get(name);
    if (data.length !== declared.get(name) || !entry || data.length !== entry.size || crc32(data) !== entry.crc) {
      throw new BundleError(`Entry ${name} does not match its declared size or checksum (corrupt zip)`);
    }
  }
  const raw = files["guide.json"];
  if (!raw) throw new BundleError("Not a Showsteps project file (no guide.json inside)");
  let json: unknown;
  try {
    json = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(raw).replace(/^\uFEFF/, ""));
  } catch {
    throw new BundleError("guide.json is not valid JSON");
  }
  const guide = migrateGuide(json);
  const images: ImageSource = {};
  for (const [name, data] of Object.entries(files)) if (name !== "guide.json") images[name] = data;
  const missing = referencedImages(guide).filter((p) => !images[p]);
  if (missing.length) {
    throw new BundleError(`Screenshots referenced by the guide are missing from the file: ${missing.slice(0, 10).join(", ")}${missing.length > 10 ? `, and ${missing.length - 10} more` : ""}`);
  }
  return { guide, images };
}

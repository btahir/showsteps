import { unzipSync, zipSync, type Zippable } from "fflate";
import type { Guide } from "./schema";
import type { ImageSource } from "./types";
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
const MAX_TOTAL_BYTES = 1024 * 1024 * 1024;

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
    "guide.json": [enc.encode(JSON.stringify(guide, null, 2) + "\n"), { level: 6, mtime: FIXED_MTIME }],
  };
  for (const p of paths) entries[p] = [images[p] as Uint8Array, { level: 0, mtime: FIXED_MTIME }];
  return zipSync(entries);
}

export interface UnpackedBundle {
  guide: Guide;
  images: ImageSource;
  /** Non-fatal problems, e.g. a screenshot the guide references that is not in the zip. */
  warnings: string[];
}

/** Read a `.showsteps` zip. Migrates old schema versions. Throws `BundleError` or `GuideValidationError`. */
export function unpackBundle(bytes: Uint8Array): UnpackedBundle {
  let total = 0;
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes, {
      filter: (f) => {
        if (f.name.endsWith("/")) return false;
        if (f.originalSize > MAX_ENTRY_BYTES) throw new BundleError(`Entry ${f.name} is too large (${f.originalSize} bytes)`);
        total += f.originalSize;
        if (total > MAX_TOTAL_BYTES) throw new BundleError("Bundle is too large to open");
        return f.name === "guide.json" || f.name.startsWith("images/");
      },
    });
  } catch (e) {
    if (e instanceof BundleError) throw e;
    throw new BundleError("Not a Showsteps project file (could not read it as a zip)");
  }
  const raw = files["guide.json"];
  if (!raw) throw new BundleError("Not a Showsteps project file (no guide.json inside)");
  let json: unknown;
  try {
    json = JSON.parse(new TextDecoder("utf-8").decode(raw).replace(/^﻿/, ""));
  } catch {
    throw new BundleError("guide.json is not valid JSON");
  }
  const guide = migrateGuide(json);
  const images: ImageSource = {};
  for (const [name, data] of Object.entries(files)) if (name !== "guide.json" && isSafeBundlePath(name)) images[name] = data;
  const warnings = referencedImages(guide)
    .filter((p) => !images[p])
    .map((p) => `Screenshot ${p} is referenced by the guide but missing from the file`);
  return { guide, images, warnings };
}

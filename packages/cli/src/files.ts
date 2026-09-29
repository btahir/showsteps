// Node file access for guide files. All guide logic lives in @stepsnap/core.
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import {
  migrateGuide,
  packBundle,
  unpackBundle,
  validateGuide,
  type Guide,
} from "@stepsnap/core";
import { invalid, ioError } from "./errors.ts";

export type ImageSource = Record<string, Uint8Array>;
export type GuideFileKind = "bundle" | "json";

export interface LoadedGuide {
  /** Absolute path the guide was read from. */
  path: string;
  kind: GuideFileKind;
  guide: Guide;
  /** Screenshot bytes keyed by `step.screenshot.image`. Empty for a bare guide.json without images. */
  images: ImageSource;
  /** Non-fatal problems found while reading, e.g. a screenshot the guide references that is missing. */
  warnings: string[];
}

export type CheckResult =
  | { ok: true; loaded: LoadedGuide }
  | { ok: false; path: string; errors: string[] };

const fsMessage = (e: unknown, path: string, verb: string): string => {
  const code = (e as NodeJS.ErrnoException).code;
  if (code === "ENOENT") return `no such file: ${path}`;
  if (code === "EISDIR") return `is a directory, not a file: ${path}`;
  if (code === "EACCES" || code === "EPERM") return `permission denied: ${path}`;
  return `cannot ${verb} ${path}: ${(e as Error).message}`;
};

async function readBytes(path: string): Promise<Uint8Array> {
  try {
    return new Uint8Array(await readFile(path));
  } catch (e) {
    throw ioError(fsMessage(e, path, "read"));
  }
}

const isZip = (b: Uint8Array) => b.length > 3 && b[0] === 0x50 && b[1] === 0x4b;

function validated(raw: unknown): { ok: true; guide: Guide } | { ok: false; errors: string[] } {
  let candidate = raw;
  try {
    candidate = migrateGuide(raw);
  } catch {
    // Not migratable: let validateGuide report what is wrong with the original.
  }
  return validateGuide(candidate);
}

/** Read guide.json images that sit next to it (`<dir>/images/...`), ignoring anything outside <dir>. */
async function readSiblingImages(dir: string, guide: Guide): Promise<{ images: ImageSource; warnings: string[] }> {
  const images: ImageSource = {};
  const warnings: string[] = [];
  for (const step of guide.steps) {
    const rel = step.screenshot?.image;
    if (!rel) continue;
    const abs = resolve(dir, rel);
    const back = relative(dir, abs);
    if (back.startsWith("..") || isAbsolute(back)) {
      warnings.push(`screenshot path leaves the guide folder and was ignored: ${rel}`);
      continue;
    }
    try {
      images[rel] = new Uint8Array(await readFile(abs));
    } catch {
      warnings.push(`screenshot not found next to guide.json: ${rel}`);
    }
  }
  return { images, warnings };
}

/** Load and validate a `.showsteps` bundle or a bare `guide.json`. Never throws for an invalid guide. */
export async function checkGuideFile(file: string, cwd = process.cwd()): Promise<CheckResult> {
  const path = resolve(cwd, file);
  const bytes = await readBytes(path);
  if (isZip(bytes)) {
    let unpacked: { guide: unknown; images: ImageSource; warnings?: string[] };
    try {
      unpacked = unpackBundle(bytes) as typeof unpacked;
    } catch (e) {
      const errs = (e as { errors?: unknown }).errors;
      return { ok: false, path, errors: Array.isArray(errs) ? (errs as string[]) : [`not a readable .showsteps bundle: ${(e as Error).message}`] };
    }
    const v = validated(unpacked.guide);
    if (!v.ok) return { ok: false, path, errors: v.errors };
    return { ok: true, loaded: { path, kind: "bundle", guide: v.guide, images: unpacked.images ?? {}, warnings: unpacked.warnings ?? [] } };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(new TextDecoder().decode(bytes));
  } catch (e) {
    return { ok: false, path, errors: [`not a .showsteps bundle or guide.json (invalid JSON: ${(e as Error).message})`] };
  }
  const v = validated(raw);
  if (!v.ok) return { ok: false, path, errors: v.errors };
  const { images, warnings } = await readSiblingImages(dirname(path), v.guide);
  return { ok: true, loaded: { path, kind: "json", guide: v.guide, images, warnings } };
}

/** Like checkGuideFile but throws exit-code-1 errors for an invalid guide. */
export async function loadGuideFile(file: string, cwd = process.cwd()): Promise<LoadedGuide> {
  const r = await checkGuideFile(file, cwd);
  if (!r.ok) throw invalid(`invalid guide: ${r.path}`, r.errors);
  return r.loaded;
}

/** Atomic write, creating parent folders. */
export async function writeFileSafe(path: string, data: string | Uint8Array): Promise<void> {
  try {
    await mkdir(dirname(path), { recursive: true });
    const tmp = `${path}.${process.pid}.tmp`;
    await writeFile(tmp, data);
    await rename(tmp, path);
  } catch (e) {
    throw ioError(fsMessage(e, path, "write"));
  }
}

export async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

/** Save a guide. Format follows the output extension (.json bare, .showsteps bundle; legacy .stepsnap also a bundle), else the input kind. */
export async function saveGuideFile(
  guide: Guide,
  images: ImageSource,
  outPath: string,
  fallbackKind: GuideFileKind,
): Promise<GuideFileKind> {
  const lower = outPath.toLowerCase();
  const kind: GuideFileKind = lower.endsWith(".json") ? "json" : /\.(showsteps|stepsnap)$/.test(lower) ? "bundle" : fallbackKind;
  if (kind === "json") {
    await writeFileSafe(outPath, JSON.stringify(guide, null, 2) + "\n");
    return kind;
  }
  let bytes: Uint8Array;
  try {
    bytes = packBundle(guide, images);
  } catch (e) {
    throw invalid(`cannot save ${outPath}: ${(e as Error).message}`, (e as { errors?: string[] }).errors);
  }
  await writeFileSafe(outPath, bytes);
  return kind;
}

/** Join and confine a relative export path to `dir`. */
export function confinedJoin(dir: string, rel: string): string {
  const abs = resolve(join(dir, rel));
  if (abs !== dir && !abs.startsWith(dir + sep)) throw invalid(`refusing to write outside the output folder: ${rel}`);
  return abs;
}

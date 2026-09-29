import { SCHEMA_VERSION, type Guide } from "./schema";

export type ValidateResult = { ok: true; guide: Guide } | { ok: false; errors: string[] };

/** Thrown by `migrateGuide` and `unpackBundle` when the input is not a usable guide. */
export class GuideValidationError extends Error {
  readonly errors: string[];
  constructor(errors: string[], prefix = "Invalid guide") {
    super(`${prefix}: ${errors.slice(0, 5).join("; ")}${errors.length > 5 ? `; and ${errors.length - 5} more` : ""}`);
    this.name = "GuideValidationError";
    this.errors = errors;
  }
}

const MAX_TITLE = 2000;
const MAX_STEPS = 5000;
const MAX_DEPTH = 40;
const ID_RE = /^[A-Za-z0-9_-]+$/;
const ISO_RE = /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/;

const LOCATOR_KINDS = ["testid", "role", "label", "placeholder", "text", "css", "xpath"] as const;
const ACTION_TYPES = ["navigate", "click", "type", "select", "check", "press", "scroll", "hover", "note"] as const;
const REDACT_STYLES = ["blur", "pixelate", "solid", "mask"] as const;
const TAB_CORNERS = ["top-right", "top-left", "bottom-right", "bottom-left"] as const;

type Obj = Record<string, unknown>;

const isObj = (x: unknown): x is Obj => typeof x === "object" && x !== null && !Array.isArray(x);
const isNum = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);

function describe(x: unknown): string {
  if (x === null) return "null";
  if (Array.isArray(x)) return "an array";
  if (typeof x === "string") return x.length > 30 ? "a string" : JSON.stringify(x);
  if (typeof x === "number") return Number.isFinite(x) ? String(x) : "a non-finite number";
  if (typeof x === "undefined") return "missing";
  return typeof x === "object" ? "an object" : `a ${typeof x}`;
}

class Checker {
  errors: string[] = [];
  err(path: string, msg: string): void {
    this.errors.push(`${path}: ${msg}`);
  }
  str(o: Obj, key: string, path: string, opts: { optional?: boolean; nonEmpty?: boolean } = {}): string | undefined {
    const v = o[key];
    if (v === undefined) {
      if (!opts.optional) this.err(`${path}.${key}`, "is required (expected a string)");
      return undefined;
    }
    if (typeof v !== "string") {
      this.err(`${path}.${key}`, `expected a string, got ${describe(v)}`);
      return undefined;
    }
    if (opts.nonEmpty && v.trim() === "") this.err(`${path}.${key}`, "must not be empty");
    return v;
  }
  num(o: Obj, key: string, path: string, opts: { optional?: boolean; min?: number } = {}): number | undefined {
    const v = o[key];
    if (v === undefined) {
      if (!opts.optional) this.err(`${path}.${key}`, "is required (expected a number)");
      return undefined;
    }
    if (!isNum(v)) {
      this.err(`${path}.${key}`, `expected a finite number, got ${describe(v)}`);
      return undefined;
    }
    if (opts.min !== undefined && v < opts.min) this.err(`${path}.${key}`, `must be >= ${opts.min}, got ${v}`);
    return v;
  }
  bool(o: Obj, key: string, path: string, optional = true): boolean | undefined {
    const v = o[key];
    if (v === undefined) {
      if (!optional) this.err(`${path}.${key}`, "is required (expected true or false)");
      return undefined;
    }
    if (typeof v !== "boolean") {
      this.err(`${path}.${key}`, `expected true or false, got ${describe(v)}`);
      return undefined;
    }
    return v;
  }
  obj(v: unknown, path: string): Obj | undefined {
    if (!isObj(v)) {
      this.err(path, `expected an object, got ${describe(v)}`);
      return undefined;
    }
    return v;
  }
  oneOf<T extends string>(o: Obj, key: string, path: string, allowed: readonly T[], optional = false): T | undefined {
    const v = o[key];
    if (v === undefined) {
      if (!optional) this.err(`${path}.${key}`, `is required (one of ${allowed.join(", ")})`);
      return undefined;
    }
    if (typeof v !== "string" || !(allowed as readonly string[]).includes(v)) {
      this.err(`${path}.${key}`, `expected one of ${allowed.join(", ")}; got ${describe(v)}`);
      return undefined;
    }
    return v as T;
  }
  iso(o: Obj, key: string, path: string): void {
    const v = this.str(o, key, path);
    if (v !== undefined && (!ISO_RE.test(v) || Number.isNaN(Date.parse(v)))) {
      this.err(`${path}.${key}`, `expected an ISO 8601 timestamp such as 2026-09-28T10:15:00Z, got ${describe(v)}`);
    }
  }
  rect(v: unknown, path: string, bounds?: { width?: number; height?: number }): void {
    const o = this.obj(v, path);
    if (!o) return;
    const x = this.num(o, "x", path);
    const y = this.num(o, "y", path);
    const w = this.num(o, "width", path, { min: 0 });
    const h = this.num(o, "height", path, { min: 0 });
    if (bounds?.width !== undefined && x !== undefined && w !== undefined && (x < 0 || x + w > bounds.width)) {
      this.err(path, `is outside the image (x ${x}, width ${w}, image width ${bounds.width})`);
    } else if (bounds?.height !== undefined && y !== undefined && h !== undefined && (y < 0 || y + h > bounds.height)) {
      this.err(path, `is outside the image (y ${y}, height ${h}, image height ${bounds.height})`);
    }
  }
  strArray(v: unknown, path: string): void {
    if (!Array.isArray(v)) {
      this.err(path, `expected an array of strings, got ${describe(v)}`);
      return;
    }
    v.forEach((s, i) => {
      if (typeof s !== "string") this.err(`${path}[${i}]`, `expected a string, got ${describe(s)}`);
    });
  }
}

/**
 * Reject values that cannot come out of `JSON.parse` and keys that enable prototype pollution:
 * functions, symbols, bigints, class instances (Date, Map, typed arrays), `undefined` inside arrays,
 * `__proto__` keys, and nesting deeper than MAX_DEPTH.
 */
function scanJson(c: Checker, v: unknown, path: string, depth: number): void {
  if (depth > MAX_DEPTH) {
    c.err(path, `is nested too deeply (more than ${MAX_DEPTH} levels)`);
    return;
  }
  if (v === null || typeof v === "string" || typeof v === "boolean" || v === undefined) return;
  if (typeof v === "number") return; // finiteness is checked where a number is expected
  if (Array.isArray(v)) {
    v.forEach((item, i) => {
      if (item === undefined) c.err(`${path}[${i}]`, "is undefined, which is not a JSON value");
      else scanJson(c, item, `${path}[${i}]`, depth + 1);
    });
    return;
  }
  if (typeof v === "object") {
    const proto = Object.getPrototypeOf(v);
    if (proto !== Object.prototype && proto !== null) {
      c.err(path, "is not plain JSON data (a class instance such as Date, Map or a typed array)");
      return;
    }
    for (const key of Object.getOwnPropertyNames(v)) {
      if (key === "__proto__") {
        c.err(`${path}.__proto__`, "forbidden key (prototype pollution)");
        continue;
      }
      scanJson(c, (v as Obj)[key], `${path}.${key}`, depth + 1);
    }
    return;
  }
  c.err(path, `is a ${typeof v}, which is not a JSON value`);
}

/** A path inside a bundle: relative, forward slashes, no `..`, no drive letters. */
export function isSafeBundlePath(p: string): boolean {
  if (p === "" || p.length > 300) return false;
  if (p.startsWith("/") || p.includes("\\") || p.includes("\0") || /^[A-Za-z]:/.test(p)) return false;
  return p.split("/").every((seg) => seg !== "" && seg !== "." && seg !== "..");
}

function checkLocator(c: Checker, v: unknown, path: string): void {
  const o = c.obj(v, path);
  if (!o) return;
  const kind = c.oneOf(o, "kind", path, LOCATOR_KINDS);
  if (!kind) return;
  if (kind === "role") {
    c.str(o, "role", path, { nonEmpty: true });
    c.str(o, "name", path);
  } else {
    c.str(o, "value", path, { nonEmpty: true });
    if (kind === "text") c.bool(o, "exact", path);
  }
}

function checkTarget(c: Checker, v: unknown, path: string): void {
  const o = c.obj(v, path);
  if (!o) return;
  c.str(o, "tag", path, { nonEmpty: true });
  for (const k of ["role", "name", "label", "text", "placeholder", "inputType", "href"]) c.str(o, k, path, { optional: true });
  c.bool(o, "sensitive", path);
  const loc = o.locators;
  if (!Array.isArray(loc) || loc.length === 0) {
    c.err(`${path}.locators`, "expected a non-empty array of locators (best first)");
  } else {
    loc.forEach((l, i) => checkLocator(c, l, `${path}.locators[${i}]`));
  }
  if (o.frame !== undefined) c.strArray(o.frame, `${path}.frame`);
  if (o.shadow !== undefined) c.strArray(o.shadow, `${path}.shadow`);
}

function checkAction(c: Checker, v: unknown, path: string): void {
  const o = c.obj(v, path);
  if (!o) return;
  const type = c.oneOf(o, "type", path, ACTION_TYPES);
  switch (type) {
    case "navigate":
      c.str(o, "url", path, { nonEmpty: true });
      break;
    case "click":
      c.oneOf(o, "button", path, ["left", "right", "middle"] as const, true);
      c.bool(o, "double", path);
      break;
    case "type": {
      const value = c.str(o, "value", path);
      const masked = c.bool(o, "masked", path);
      if (masked === true && value !== undefined && value !== "" && value !== "\u2022\u2022\u2022") {
        c.err(`${path}.value`, 'a masked type step must have value "" or "\u2022\u2022\u2022"; the real value must never be stored');
      }
      break;
    }
    case "select":
      c.str(o, "value", path);
      c.str(o, "optionText", path, { optional: true });
      break;
    case "check":
      c.bool(o, "checked", path, false);
      break;
    case "press":
      c.str(o, "key", path, { nonEmpty: true });
      break;
    case "scroll":
      c.num(o, "x", path);
      c.num(o, "y", path);
      break;
    default:
      break;
  }
}

function checkScreenshot(c: Checker, v: unknown, path: string): void {
  const o = c.obj(v, path);
  if (!o) return;
  const image = c.str(o, "image", path, { nonEmpty: true });
  if (image !== undefined && image !== "" && (!isSafeBundlePath(image) || !image.startsWith("images/"))) {
    c.err(`${path}.image`, `must be a relative path inside images/, such as images/s_1.png, got ${describe(image)}`);
  }
  const width = c.num(o, "width", path, { min: 1 });
  const height = c.num(o, "height", path, { min: 1 });
  const bounds = { ...(width !== undefined ? { width } : {}), ...(height !== undefined ? { height } : {}) };
  c.num(o, "devicePixelRatio", path, { min: 0.01 });
  const vp = c.obj(o.viewport, `${path}.viewport`);
  if (vp) {
    c.num(vp, "width", `${path}.viewport`, { min: 0 });
    c.num(vp, "height", `${path}.viewport`, { min: 0 });
    c.num(vp, "scrollX", `${path}.viewport`);
    c.num(vp, "scrollY", `${path}.viewport`);
  }
  if (o.highlight !== undefined) {
    c.rect(o.highlight, `${path}.highlight`, bounds);
    if (isObj(o.highlight)) c.oneOf(o.highlight, "corner", `${path}.highlight`, TAB_CORNERS, true);
  }
  if (o.crop !== undefined) c.rect(o.crop, `${path}.crop`, bounds);
  if (o.redactions !== undefined) {
    if (!Array.isArray(o.redactions)) c.err(`${path}.redactions`, `expected an array, got ${describe(o.redactions)}`);
    else
      o.redactions.forEach((r, i) => {
        const rp = `${path}.redactions[${i}]`;
        const ro = c.obj(r, rp);
        if (!ro) return;
        c.rect(ro.rect, `${rp}.rect`, bounds);
        c.oneOf(ro, "style", rp, REDACT_STYLES);
        c.bool(ro, "auto", rp);
        c.str(ro, "label", rp, { optional: true });
      });
  }
}

function checkStep(c: Checker, v: unknown, path: string, ids: Set<string>): void {
  const o = c.obj(v, path);
  if (!o) return;
  const id = c.str(o, "id", path, { nonEmpty: true });
  if (id !== undefined && id !== "") {
    if (!ID_RE.test(id)) c.err(`${path}.id`, `must be url-safe (letters, digits, "_" and "-"), got ${describe(id)}`);
    else if (ids.has(id)) c.err(`${path}.id`, `duplicate step id ${JSON.stringify(id)}`);
    ids.add(id);
  }
  checkAction(c, o.action, `${path}.action`);
  if (o.target !== undefined) checkTarget(c, o.target, `${path}.target`);
  const title = c.str(o, "title", path);
  if (title !== undefined && title.length > MAX_TITLE) c.err(`${path}.title`, `is too long (${title.length} characters, at most ${MAX_TITLE})`);
  c.bool(o, "titleEdited", path);
  c.str(o, "description", path, { optional: true });
  const page = c.obj(o.page, `${path}.page`);
  if (page) {
    c.str(page, "url", `${path}.page`);
    c.str(page, "title", `${path}.page`, { optional: true });
    c.num(page, "tabId", `${path}.page`, { optional: true });
    c.oneOf(page, "dir", `${path}.page`, ["ltr", "rtl"] as const, true);
  }
  if (o.screenshot !== undefined) checkScreenshot(c, o.screenshot, `${path}.screenshot`);
  c.iso(o, "timestamp", path);
  c.bool(o, "skipped", path);
}

/** Validate an unknown value against the guide schema (v1). Never throws. Unknown extra fields are allowed. */
export function validateGuide(x: unknown): ValidateResult {
  const c = new Checker();
  const root = "guide";
  if (!isObj(x)) return { ok: false, errors: [`${root}: expected an object, got ${describe(x)}`] };
  if (x.schemaVersion !== SCHEMA_VERSION) {
    c.err(
      `${root}.schemaVersion`,
      x.schemaVersion === undefined
        ? `is required (must be ${SCHEMA_VERSION})`
        : `unsupported version ${describe(x.schemaVersion)}; this build reads version ${SCHEMA_VERSION}`,
    );
  }
  scanJson(c, x, root, 0);
  c.str(x, "id", root, { nonEmpty: true });
  const gtitle = c.str(x, "title", root);
  if (gtitle !== undefined && gtitle.length > MAX_TITLE) c.err(`${root}.title`, `is too long (${gtitle.length} characters, at most ${MAX_TITLE})`);
  c.str(x, "description", root, { optional: true });
  c.iso(x, "createdAt", root);
  c.iso(x, "updatedAt", root);
  if (typeof x.createdAt === "string" && typeof x.updatedAt === "string") {
    const a = Date.parse(x.createdAt), b = Date.parse(x.updatedAt);
    if (!Number.isNaN(a) && !Number.isNaN(b) && b < a) c.err(`${root}.updatedAt`, "is before createdAt");
  }
  if (x.app !== undefined) {
    const app = c.obj(x.app, `${root}.app`);
    if (app) {
      if (app.name !== "showsteps" && app.name !== "stepsnap") c.err(`${root}.app.name`, `expected "showsteps", got ${describe(app.name)}`);
      c.str(app, "version", `${root}.app`);
    }
  }
  if (x.settings !== undefined) {
    const s = c.obj(x.settings, `${root}.settings`);
    if (s) {
      c.str(s, "highlightColor", `${root}.settings`, { optional: true });
      c.oneOf(s, "redactStyle", `${root}.settings`, REDACT_STYLES, true);
      c.bool(s, "includeUrls", `${root}.settings`);
    }
  }
  if (!Array.isArray(x.steps)) {
    c.err(`${root}.steps`, `expected an array, got ${describe(x.steps)}`);
  } else if (x.steps.length > MAX_STEPS) {
    c.err(`${root}.steps`, `has too many steps (${x.steps.length}, at most ${MAX_STEPS})`);
  } else {
    const ids = new Set<string>();
    x.steps.forEach((s, i) => checkStep(c, s, `${root}.steps[${i}]`, ids));
  }
  return c.errors.length ? { ok: false, errors: c.errors } : { ok: true, guide: x as unknown as Guide };
}

type Migration = (g: Obj) => Obj;
/** `MIGRATIONS[n]` upgrades a version-n guide to version n + 1. Empty until schema v2 exists. */
const MIGRATIONS: Record<number, Migration> = {};

/**
 * Bring a parsed guide of any known version up to the current schema and validate it.
 * Throws `GuideValidationError` (with `.errors`) when the input is not usable.
 */
export function migrateGuide(x: unknown): Guide {
  if (!isObj(x)) throw new GuideValidationError([`guide: expected an object, got ${describe(x)}`]);
  let cur: Obj = x;
  const raw = cur.schemaVersion;
  if (typeof raw !== "number" || !Number.isInteger(raw) || raw < 1) {
    throw new GuideValidationError([`guide.schemaVersion: expected a positive integer, got ${describe(raw)}`]);
  }
  let v: number = raw;
  if (v > SCHEMA_VERSION) {
    throw new GuideValidationError([
      `guide.schemaVersion: ${v} was written by a newer Stepsnap; this build reads version ${SCHEMA_VERSION}. Update Stepsnap to open it.`,
    ]);
  }
  while (v < SCHEMA_VERSION) {
    const step = MIGRATIONS[v];
    if (!step) throw new GuideValidationError([`guide.schemaVersion: no migration from version ${v}`]);
    cur = step(cur);
    v += 1;
    cur = { ...cur, schemaVersion: v };
  }
  const res = validateGuide(cur);
  if (!res.ok) throw new GuideValidationError(res.errors);
  return res.guide;
}

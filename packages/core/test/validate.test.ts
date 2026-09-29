import { describe, expect, it } from "vitest";
import { GuideValidationError, migrateGuide, validateGuide } from "../src";
import { fixtureGuide } from "./fixtures/guide";
import bad from "./validate.bad.json";

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
type Any = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

function errorsFor(mutate: (g: Any) => void): string[] {
  const g = clone(fixtureGuide()) as unknown as Any;
  mutate(g);
  const r = validateGuide(g);
  expect(r.ok).toBe(false);
  return r.ok ? [] : r.errors;
}

describe("validateGuide", () => {
  it("accepts the fixture guide", () => {
    const r = validateGuide(fixtureGuide());
    expect(r.ok).toBe(true);
  });

  it("accepts a minimal guide", () => {
    const r = validateGuide({ schemaVersion: 1, id: "g", title: "", createdAt: "2026-09-28T10:00:00Z", updatedAt: "2026-09-28T10:00:00Z", steps: [] });
    expect(r.ok).toBe(true);
  });

  it("keeps unknown extra fields (forward compatible)", () => {
    const g = clone(fixtureGuide()) as unknown as Any;
    g.futureField = { a: 1 };
    g.steps[0].alsoNew = true;
    const r = validateGuide(g);
    expect(r.ok).toBe(true);
    if (r.ok) expect((r.guide as unknown as Any).futureField).toEqual({ a: 1 });
  });

  it.each([
    ["null", null],
    ["a string", "guide"],
    ["an array", []],
    ["a number", 3],
    ["undefined", undefined],
  ])("rejects %s at the root", (_l, x) => {
    const r = validateGuide(x);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]).toMatch(/^guide: expected an object/);
  });

  it("names the path of every error, with readable messages", () => {
    const errs = errorsFor((g) => {
      g.steps[2].action.type = "teleport";
      g.steps[3].page = "nope";
      delete g.steps[4].timestamp;
      g.steps[5].screenshot.width = "wide";
    });
    expect(errs).toContain("guide.steps[2].action.type: expected one of navigate, click, type, select, check, press, scroll, hover, note; got \"teleport\"");
    expect(errs.some((e) => e.startsWith("guide.steps[3].page: expected an object"))).toBe(true);
    expect(errs).toContain("guide.steps[4].timestamp: is required (expected a string)");
    expect(errs).toContain("guide.steps[5].screenshot.width: expected a finite number, got \"wide\"");
  });

  it("requires the current schemaVersion", () => {
    expect(errorsFor((g) => delete g.schemaVersion)[0]).toBe("guide.schemaVersion: is required (must be 1)");
    expect(errorsFor((g) => (g.schemaVersion = 2))[0]).toMatch(/unsupported version 2/);
  });

  it("rejects duplicate and unsafe step ids", () => {
    expect(errorsFor((g) => (g.steps[1].id = g.steps[0].id))).toEqual([expect.stringMatching(/duplicate step id/)]);
    expect(errorsFor((g) => (g.steps[1].id = "a b/c"))).toEqual([expect.stringMatching(/url-safe/)]);
    expect(errorsFor((g) => (g.steps[1].id = ""))).toEqual([expect.stringMatching(/must not be empty/)]);
  });

  it.each(["../evil.png", "/abs.png", "images\\a.png", "C:/a.png", "images//a.png", "images/./a.png", ""])("rejects screenshot path %j", (p) => {
    const errs = errorsFor((g) => (g.steps[0].screenshot.image = p));
    expect(errs.length).toBeGreaterThan(0);
  });

  it("checks rectangles", () => {
    const errs = errorsFor((g) => {
      g.steps[0].screenshot.highlight = { x: 1, y: 2, width: -5, height: 4 };
      g.steps[1].screenshot.redactions = [{ rect: { x: 0, y: 0, width: 1 }, style: "smudge" }];
    });
    expect(errs).toContain("guide.steps[0].screenshot.highlight.width: must be >= 0, got -5");
    expect(errs.some((e) => e.includes("redactions[0].rect.height"))).toBe(true);
    expect(errs.some((e) => e.includes("redactions[0].style: expected one of blur, pixelate, solid"))).toBe(true);
  });

  it("rejects NaN and Infinity in numbers", () => {
    const g = clone(fixtureGuide()) as unknown as Any;
    g.steps[0].screenshot.devicePixelRatio = Number.NaN;
    const r = validateGuide(g);
    expect(r.ok).toBe(false);
  });

  it("requires at least one locator on a target and validates each", () => {
    const errs = errorsFor((g) => {
      g.steps[1].target.locators = [];
      g.steps[2].target.locators = [{ kind: "role", role: "button" }, { kind: "magic", value: "x" }];
    });
    expect(errs).toContain("guide.steps[1].target.locators: expected a non-empty array of locators (best first)");
    expect(errs).toContain("guide.steps[2].target.locators[0].name: is required (expected a string)");
    expect(errs.some((e) => e.startsWith("guide.steps[2].target.locators[1].kind: expected one of testid"))).toBe(true);
  });

  it("validates action payloads", () => {
    const errs = errorsFor((g) => {
      g.steps[0].action = { type: "navigate" };
      g.steps[1].action = { type: "check" };
      g.steps[2].action = { type: "click", button: "back" };
      g.steps[3].action = { type: "scroll", x: 1 };
      g.steps[4].action = { type: "press", key: "" };
    });
    expect(errs.length).toBeGreaterThanOrEqual(5);
    expect(errs.some((e) => e.includes("steps[0].action.url"))).toBe(true);
    expect(errs.some((e) => e.includes("steps[1].action.checked"))).toBe(true);
    expect(errs.some((e) => e.includes("steps[2].action.button"))).toBe(true);
    expect(errs.some((e) => e.includes("steps[3].action.y"))).toBe(true);
    expect(errs.some((e) => e.includes("steps[4].action.key"))).toBe(true);
  });

  it("rejects bad timestamps and a bad steps container", () => {
    expect(errorsFor((g) => (g.createdAt = "yesterday"))[0]).toMatch(/guide.createdAt: expected an ISO 8601 timestamp/);
    expect(errorsFor((g) => (g.steps = {}))[0]).toBe("guide.steps: expected an array, got an object");
  });

  it("validates settings and app", () => {
    const errs = errorsFor((g) => {
      g.settings = { redactStyle: "fuzzy", includeUrls: "yes" };
      g.app = { name: "other", version: 3 };
    });
    expect(errs.length).toBe(4);
  });

  it("collects many errors instead of stopping at the first", () => {
    const errs = errorsFor((g) => {
      g.id = 4;
      g.title = null;
      g.steps[0].id = 5;
    });
    expect(errs.length).toBeGreaterThanOrEqual(3);
  });
});

describe("migrateGuide", () => {
  it("returns a valid v1 guide unchanged", () => {
    const g = fixtureGuide();
    expect(migrateGuide(clone(g))).toEqual(g);
  });
  it("throws GuideValidationError with details for invalid input", () => {
    try {
      migrateGuide({ schemaVersion: 1, id: "x" });
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(GuideValidationError);
      expect((e as GuideValidationError).errors.length).toBeGreaterThan(1);
    }
  });
  it("explains a guide from a newer version", () => {
    expect(() => migrateGuide({ schemaVersion: 7 })).toThrow(/newer Showsteps/);
  });
  it("rejects a missing or non-integer version and non-objects", () => {
    expect(() => migrateGuide({})).toThrow(/schemaVersion/);
    expect(() => migrateGuide({ schemaVersion: 1.5 })).toThrow(/schemaVersion/);
    expect(() => migrateGuide("x")).toThrow(/expected an object/);
    expect(() => migrateGuide(null)).toThrow(GuideValidationError);
  });
});

// ---- data-driven bad inputs (test/validate.bad.json) -----------------------------------------

type Op = ["set", string, unknown] | ["delete", string] | ["setNum", string, string] | ["setJson", string, string] | ["fillSteps", number];
interface BadCase {
  name: string;
  expect: string;
  patch?: Op[];
  input?: unknown;
}

function applyPatch(root: Any, ops: Op[]): void {
  const walk = (path: string): { parent: Any; key: string } => {
    const parts = path.split(".");
    let cur = root;
    for (const p of parts.slice(0, -1)) cur = cur[p];
    return { parent: cur, key: parts[parts.length - 1] as string };
  };
  for (const op of ops) {
    if (op[0] === "fillSteps") {
      const base = root.steps[0];
      root.steps = Array.from({ length: op[1] }, (_, i) => ({ ...clone(base), id: `s${i}` }));
    } else if (op[0] === "set") {
      const { parent, key } = walk(op[1]);
      parent[key] = op[2];
    } else if (op[0] === "delete") {
      const { parent, key } = walk(op[1]);
      delete parent[key];
    } else if (op[0] === "setNum") {
      const { parent, key } = walk(op[1]);
      parent[key] = op[2] === "NaN" ? Number.NaN : op[2] === "Infinity" ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY;
    } else {
      const { parent, key } = walk(op[1]);
      // JSON.parse creates an own "__proto__" property, exactly like a hostile file would
      Object.defineProperty(parent, key, { value: JSON.parse(op[2]), enumerable: true, writable: true, configurable: true });
    }
  }
}

describe("validate.bad.json", () => {
  const cases = bad as unknown as BadCase[];
  it("has at least 30 bad inputs", () => expect(cases.length).toBeGreaterThanOrEqual(30));
  it.each(cases.map((c) => [c.name, c] as const))("rejects: %s", (_name, c) => {
    let input: unknown;
    if ("input" in c) input = c.input;
    else {
      const g = clone(fixtureGuide()) as unknown as Any;
      applyPatch(g, c.patch ?? []);
      input = g;
    }
    const r = validateGuide(input);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join("\n")).toContain(c.expect);
  });
});

describe("non-JSON values and hostile shapes", () => {
  const g = (): Any => clone(fixtureGuide()) as unknown as Any;
  it.each([
    ["a function", () => () => 1],
    ["a Date", () => new Date()],
    ["a Map", () => new Map()],
    ["a Uint8Array", () => new Uint8Array(2)],
    ["a symbol", () => Symbol("x")],
    ["a bigint", () => 10n],
  ])("rejects %s inside a guide", (_n, make) => {
    const x = g();
    x.meta = { v: make() };
    const r = validateGuide(x);
    expect(r.ok).toBe(false);
  });
  it("rejects undefined inside an array but accepts undefined optional fields", () => {
    const x = g();
    x.steps[0].target = undefined;
    expect(validateGuide(x).ok).toBe(true);
    x.meta = [undefined];
    expect(validateGuide(x).ok).toBe(false);
  });
  it("rejects absurdly deep nesting", () => {
    const x = g();
    let cur: Any = (x.meta = {});
    for (let i = 0; i < 60; i++) cur = cur.n = {};
    const r = validateGuide(x);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join()).toContain("nested too deeply");
  });
  it("accepts a masked type step with the bullet placeholder, and a null-prototype object", () => {
    const x = g();
    x.steps[2].action.value = "\u2022\u2022\u2022";
    expect(validateGuide(x).ok).toBe(true);
    expect(validateGuide(Object.assign(Object.create(null), x)).ok).toBe(true);
  });
  it("accepts an agent-authored guide: no screenshots, no tabId, no timestamps beyond ISO", () => {
    const x = g();
    x.steps = x.steps.map((s: Any) => ({ id: s.id, action: s.action, title: s.title, page: { url: s.page.url }, timestamp: s.timestamp, ...(s.target ? { target: s.target } : {}) }));
    expect(validateGuide(x).ok).toBe(true);
  });
  it("migrateGuide is idempotent and accepts both app names", () => {
    for (const name of ["showsteps", "stepsnap"]) {
      const x = g();
      x.app.name = name;
      const once = migrateGuide(x);
      expect(migrateGuide(once)).toEqual(once);
    }
  });
});

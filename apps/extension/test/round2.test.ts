// Round-2 features: typing amends, auto-blur Undo bookkeeping, highlight handles, bar position, chip text.
import { describe, expect, it } from "vitest";
import type { Guide, Step } from "@stepsnap/core";
import { amendStep, removeAutoRedactions } from "../src/lib/guide-ops";
import { moveRect, resizeRect } from "../src/lib/rect";
import { OriginalStore, pendingImageWrites } from "../src/lib/originals";
import { redactionChip, reviewChip } from "../src/lib/chip";
import { clampBottom } from "../src/lib/rec-bar";
import { parseRedactPrefs } from "../src/lib/prefs";

const T = "2026-09-28T10:00:00.000Z";
const shot = { image: "images/s1.png", width: 200, height: 100, devicePixelRatio: 1, viewport: { width: 200, height: 100, scrollX: 0, scrollY: 0 } };
const typeStep = (id: string, value: string, extra: Partial<Step> = {}): Step => ({
  id,
  action: { type: "type", value },
  title: `Type "${value}" in **Name**`,
  page: { url: "http://localhost:4517/" },
  timestamp: T,
  screenshot: { ...shot, image: `images/${id}.png` },
  ...extra,
});
const guide = (steps: Step[]): Guide => ({ schemaVersion: 1, id: "g", title: "G", createdAt: T, updatedAt: T, steps });

describe("amendStep (PLAN §3.6: later typing in the same field amends its step)", () => {
  it("replaces value, title and timestamp in place", () => {
    const g = guide([typeStep("a", "x"), typeStep("s1", "ab")]);
    const next = typeStep("s1", "abcd", { timestamp: "2026-09-28T10:00:05.000Z" });
    const out = amendStep(g, "s1", next, T);
    expect(out.steps).toHaveLength(2);
    expect(out.steps[1]!.action).toEqual({ type: "type", value: "abcd" });
    expect(out.steps[1]!.title).toBe('Type "abcd" in **Name**');
    expect(out.steps[1]!.timestamp).toBe("2026-09-28T10:00:05.000Z");
  });
  it("keeps a title, description or skip the person already set", () => {
    const g = guide([typeStep("s1", "ab", { title: "Enter your name", titleEdited: true, description: "Any name", skipped: true })]);
    const out = amendStep(g, "s1", typeStep("s1", "abcd"), T);
    expect(out.steps[0]).toMatchObject({ title: "Enter your name", titleEdited: true, description: "Any name", skipped: true });
    expect(out.steps[0]!.action).toEqual({ type: "type", value: "abcd" });
  });
  it("is a no-op when the step was deleted meanwhile", () => {
    const g = guide([typeStep("a", "x")]);
    expect(amendStep(g, "gone", typeStep("gone", "y"))).toBe(g);
  });
});

describe("removeAutoRedactions", () => {
  it("drops only the automatic ones", () => {
    const s = typeStep("s1", "", {
      screenshot: {
        ...shot,
        redactions: [
          { rect: { x: 0, y: 0, width: 10, height: 10 }, style: "blur", auto: true },
          { rect: { x: 20, y: 0, width: 10, height: 10 }, style: "solid" },
        ],
      },
    });
    const out = removeAutoRedactions(guide([s]), "s1", T);
    expect(out.steps[0]!.screenshot!.redactions).toEqual([{ rect: { x: 20, y: 0, width: 10, height: 10 }, style: "solid" }]);
    const none = removeAutoRedactions(out, "s1", T);
    const allAuto = removeAutoRedactions(guide([{ ...s, screenshot: { ...shot, redactions: [{ rect: { x: 0, y: 0, width: 5, height: 5 }, style: "blur", auto: true }] } }]), "s1", T);
    expect(none.steps[0]!.screenshot!.redactions).toHaveLength(1);
    expect(allAuto.steps[0]!.screenshot!.redactions).toBeUndefined();
  });
});

describe("originals (memory only)", () => {
  const blob = new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" });
  it("keeps a bounded number per guide, oldest dropped first", () => {
    const store = new OriginalStore(2);
    store.set("g", "a", { blob, token: "1" });
    store.set("g", "b", { blob, token: "2" });
    store.set("g", "c", { blob, token: "3" });
    expect(store.entries("g").map(([k]) => k)).toEqual(["b", "c"]);
    store.drop("g");
    expect(store.size).toBe(0);
  });
  it("writes the original after Undo and re-burns after undoing the Undo", () => {
    const auto = { rect: { x: 0, y: 0, width: 10, height: 10 }, style: "blur" as const, auto: true };
    const withBlur = typeStep("s1", "", { screenshot: { ...shot, redactions: [auto] } });
    const without = typeStep("s1", "", { screenshot: { ...shot } });
    const originals = new Map([["s1", { blob, token: T }]]);
    const written = new Map<string, "burnt" | "original">();
    expect(pendingImageWrites([withBlur], originals, written)).toEqual([]);
    expect(pendingImageWrites([without], originals, written)).toEqual([{ stepId: "s1", want: "original" }]);
    written.set("s1", "original");
    expect(pendingImageWrites([withBlur], originals, written)).toEqual([{ stepId: "s1", want: "burnt" }]);
  });
  it("ignores an original whose step was amended since (token mismatch)", () => {
    const without = typeStep("s1", "", { timestamp: "2026-09-28T11:00:00.000Z", screenshot: { ...shot } });
    expect(pendingImageWrites([without], new Map([["s1", { blob, token: T }]]), new Map())).toEqual([]);
  });
});

describe("redaction chip", () => {
  const auto = (n: number) => Array.from({ length: n }, (_, i) => ({ rect: { x: i * 20, y: 0, width: 10, height: 10 }, style: "blur" as const, auto: true }));
  it("names the field and offers Undo while the original is in memory", () => {
    const s = typeStep("s1", "", { target: { tag: "input", sensitive: true, label: "Password", locators: [] }, screenshot: { ...shot, redactions: auto(1) } });
    expect(redactionChip(s, undefined, true)).toEqual({ text: "Password blurred", canUndo: true });
    expect(redactionChip(s, undefined, false)).toEqual({ text: "Password blurred", canUndo: false, note: "Blurred at capture for safety" });
  });
  it("names what each redaction covers (labels stored at capture), then falls back to text kinds", () => {
    const labeled = typeStep("s1", "", {
      screenshot: { ...shot, redactions: [...auto(3).map((r, i) => ({ ...r, label: ["Password", "Card number", "password"][i] }))] },
    });
    expect(redactionChip(labeled, undefined, true)?.text).toBe("Password and 1 more blurred");
    const s = typeStep("s1", "", { screenshot: { ...shot, redactions: auto(2) } });
    expect(redactionChip(s, { kinds: ["card"] }, true)?.text).toBe("Card number blurred");
    expect(redactionChip(s, { kinds: ["card", "token", "ssn"] }, true)?.text).toBe("Card number and 2 more blurred");
    expect(redactionChip(s, {}, true)?.text).toBe("2 sensitive fields blurred");
  });
  it("is absent without automatic redactions; review chip when the scan was incomplete", () => {
    expect(redactionChip(typeStep("s1", "x"), undefined, true)).toBeUndefined();
    expect(reviewChip({ review: true })).toMatch(/could not be scanned/);
    expect(reviewChip({})).toBeUndefined();
  });
});

describe("highlight handles", () => {
  const b = { width: 200, height: 100 };
  const r = { x: 50, y: 20, width: 40, height: 30 };
  it("moves within the image", () => {
    expect(moveRect(r, 5, -3, b)).toEqual({ x: 55, y: 17, width: 40, height: 30 });
    expect(moveRect(r, 500, 500, b)).toEqual({ x: 160, y: 70, width: 40, height: 30 });
    expect(moveRect(r, -500, -500, b)).toEqual({ x: 0, y: 0, width: 40, height: 30 });
  });
  it("resizes from each corner, keeping the opposite corner", () => {
    expect(resizeRect(r, "se", 10, 5, b)).toEqual({ x: 50, y: 20, width: 50, height: 35 });
    expect(resizeRect(r, "nw", -10, -5, b)).toEqual({ x: 40, y: 15, width: 50, height: 35 });
    expect(resizeRect(r, "ne", 10, 5, b)).toEqual({ x: 50, y: 25, width: 50, height: 25 });
    expect(resizeRect(r, "sw", 5, 10, b)).toEqual({ x: 55, y: 20, width: 35, height: 40 });
  });
  it("never inverts, shrinks below the minimum or leaves the image", () => {
    expect(resizeRect(r, "se", -100, -100, b)).toEqual({ x: 50, y: 20, width: 8, height: 8 });
    expect(resizeRect(r, "nw", 100, 100, b)).toEqual({ x: 82, y: 42, width: 8, height: 8 });
    expect(resizeRect(r, "se", 500, 500, b)).toEqual({ x: 50, y: 20, width: 150, height: 80 });
  });
});

describe("recording bar and presets", () => {
  it("keeps the bar on screen", () => {
    expect(clampBottom(24, 800)).toBe(24);
    expect(clampBottom(-50, 800)).toBe(8);
    expect(clampBottom(5000, 800)).toBe(800 - 48 - 8);
  });
  it("email preset defaults off", () => {
    expect(parseRedactPrefs(undefined)).toEqual({ emails: false });
    expect(parseRedactPrefs({ emails: "yes" })).toEqual({ emails: false });
    expect(parseRedactPrefs({ emails: true })).toEqual({ emails: true });
  });
});

describe("local-offset timestamps (review #9)", () => {
  it("writes the local wall-clock date with its offset", async () => {
    const { localIso } = await import("../src/lib/time");
    const d = new Date("2026-09-29T05:42:00.000Z");
    const s = localIso(d);
    expect(s).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}[+-]\d{2}:\d{2}$/);
    expect(Date.parse(s)).toBe(d.getTime());
    expect(Number(s.slice(8, 10))).toBe(d.getDate());
  });
});

describe("focus frame thumbnails (review #4, R2-3)", async () => {
  const { focusFrame } = await import("../src/lib/rect");
  const img = { width: 2560, height: 1600 };
  it("is 16:10 around the target, max(1.6 x ring, 30% of the image, 360 CSS px)", () => {
    const f = focusFrame(img, { x: 1200, y: 700, width: 80, height: 40 }, undefined, 2, 2);
    expect(f.width).toBe(768); // 0.3 x 2560 beats 360 x 2 = 720 and 1.6 x 96
    expect(f.width / f.height).toBeCloseTo(1.6, 1);
    expect(Math.abs(f.x + f.width / 2 - 1240)).toBeLessThanOrEqual(1);
    const wide = focusFrame(img, { x: 100, y: 100, width: 700, height: 60 }, undefined, 2, 2);
    expect(wide.width).toBe(Math.round(1.6 * (700 + 16)));
  });
  it("always leaves 24 CSS px around the ring (review R3-5)", () => {
    const f = focusFrame(img, { x: 200, y: 200, width: 1500, height: 40 }, undefined, 2, 2);
    expect(f.width).toBeGreaterThanOrEqual(1500 + 2 * 4 * 2 + 2 * 24 * 2);
  });
  it("stays inside the image near an edge", () => {
    const f = focusFrame(img, { x: 2500, y: 10, width: 50, height: 20 });
    expect(f.x + f.width).toBe(2560);
    expect(f.y).toBe(0);
  });
  it("shows the top of the page without a highlight, and respects the crop", () => {
    expect(focusFrame({ width: 1280, height: 3000 })).toEqual({ x: 0, y: 0, width: 1280, height: 800 });
    const crop = { x: 100, y: 100, width: 600, height: 400 };
    const f = focusFrame(img, { x: 300, y: 300, width: 40, height: 20 }, crop);
    expect(f.x).toBeGreaterThanOrEqual(100);
    expect(f.x + f.width).toBeLessThanOrEqual(700);
    expect(f.y + f.height).toBeLessThanOrEqual(500);
  });
});

describe("tab corner at capture (review #5b)", async () => {
  const { pickCorner, tabCandidates } = await import("../src/lib/tab-corner");
  const vp = { width: 1280, height: 800 };
  const target = { x: 400, y: 300, width: 16, height: 16 };
  const c = tabCandidates(target, 1280);
  it("keeps the default when nothing is under it", () => {
    expect(pickCorner(c, [], vp)).toBeUndefined();
    expect(pickCorner(c, [{ x: 0, y: 0, width: 50, height: 10 }], vp)).toBeUndefined();
  });
  it("moves the tab off a label that sits where the default tab would go", () => {
    const label = { ...c["top-right"], width: 200 };
    expect(pickCorner(c, [label], vp)).toBe("bottom-right");
    const labelBelowToo = { ...c["bottom-right"], width: 200 };
    expect(pickCorner(c, [label, labelBelowToo], vp)).toBe("top-left");
  });
  it("prefers the left side in RTL and skips tabs that would leave the viewport", () => {
    const top = { x: 0, y: c["top-left"].y, width: 1280, height: c["top-left"].height };
    expect(pickCorner(c, [top], vp, true)).toBe("bottom-left");
    const edge = tabCandidates({ x: 400, y: 2, width: 60, height: 20 }, 1280);
    expect(pickCorner(edge, [edge["bottom-right"]], vp)).toBe("bottom-left");
  });
});

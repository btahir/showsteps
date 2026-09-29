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
  it("names text patterns", () => {
    const s = typeStep("s1", "", { screenshot: { ...shot, redactions: auto(2) } });
    expect(redactionChip(s, { kinds: ["card"] }, true)?.text).toBe("Card number blurred");
    expect(redactionChip(s, { kinds: ["card", "token"] }, true)?.text).toBe("Card number and access token blurred");
    expect(redactionChip(s, { kinds: ["card", "token", "ssn"] }, true)?.text).toBe("2 sensitive areas blurred");
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

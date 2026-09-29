import { describe, expect, it } from "vitest";
import { draftForFrame, viewOf } from "../src/lib/frame-pick";
import type { StepDraft } from "../src/lib/steps";
import { buildStep } from "../src/lib/steps";

const base = (scrollY = 300, extra: Partial<StepDraft> = {}): StepDraft => ({
  action: { type: "click" },
  page: { url: "http://127.0.0.1:4517/dashboard.html" },
  at: "2026-09-29T10:00:00+02:00",
  rect: { x: 100, y: 200, width: 80, height: 30 },
  sensitiveRects: [{ x: 10, y: 400, width: 200, height: 30 }],
  sensitiveLabels: ["Password"],
  metrics: { devicePixelRatio: 1, viewport: { width: 1024, height: 640, scrollX: 0, scrollY } },
  ...extra,
});

describe("draftForFrame (a step falls back to an earlier frame)", () => {
  it("same view: the draft is used as it is", () => {
    const d = base();
    expect(draftForFrame(d, viewOf(d.metrics))).toBe(d);
    expect(draftForFrame(d, undefined)).toBe(d);
  });

  it("scrolled since the frame: target moves by the scroll difference, blur covers both positions, review asked", () => {
    const d = base(300);
    const out = draftForFrame(d, { scrollX: 0, scrollY: 0, width: 1024, height: 640, dpr: 1 });
    expect(out.rect).toEqual({ x: 100, y: 500, width: 80, height: 30 });
    expect(out.sensitiveRects).toEqual([
      { x: 10, y: 400, width: 200, height: 30 },
      { x: 10, y: 700, width: 200, height: 30 },
    ]);
    expect(out.scanIncomplete).toBe(true);
    expect(out.metrics!.viewport.scrollY).toBe(0);
    // The stored highlight is where the element was in that frame.
    const step = buildStep("s1", out, { width: 1280, height: 800 });
    expect(step.screenshot!.highlight).toMatchObject({ x: 125, y: 625, width: 100, height: 38 });
  });

  it("a fixed or sticky target does not move; a frame with its own scan needs no review", () => {
    const out = draftForFrame(base(300, { pinned: true }), { scrollX: 0, scrollY: 0, width: 1024, height: 640, dpr: 1 }, { rects: [{ x: 0, y: 0, width: 5, height: 5 }], labels: ["Card number"] });
    expect(out.rect).toEqual({ x: 100, y: 200, width: 80, height: 30 });
    expect(out.scanIncomplete).toBeUndefined();
    expect(out.sensitiveRects).toHaveLength(3);
    expect(out.sensitiveLabels).toEqual(["Password", "Password", "Card number"]);
  });

  it("window size or zoom changed: no highlight, only the frame's own scan, review asked", () => {
    const out = draftForFrame(base(0), { scrollX: 0, scrollY: 0, width: 1280, height: 800, dpr: 1 });
    expect(out.rect).toBeUndefined();
    expect(out.sensitiveRects).toEqual([]);
    expect(out.scanIncomplete).toBe(true);
    expect(out.metrics!.viewport.width).toBe(1280);
  });
});

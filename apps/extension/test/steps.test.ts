import { describe, expect, it } from "vitest";
import { buildStep, newGuide, titleFromPage } from "../src/lib/steps";
import type { StepDraft } from "../src/lib/steps";

const metrics = { devicePixelRatio: 2, viewport: { width: 1280, height: 800, scrollX: 0, scrollY: 120 } };
const frame = { width: 2560, height: 1600 };

describe("buildStep", () => {
  it("builds a click step with highlight in image pixels and a generated title", () => {
    const d: StepDraft = {
      action: { type: "click" },
      target: { tag: "button", role: "button", name: "Save", locators: [{ kind: "role", role: "button", name: "Save" }] },
      page: { url: "http://localhost:4517/settings.html", title: "Settings – Acme Books" },
      rect: { x: 600, y: 300, width: 80, height: 32 },
      metrics,
      at: "2026-09-28T10:00:00.000Z",
    };
    const s = buildStep("s_1", d, frame);
    expect(s.title).toBe("Click **Save**");
    expect(s.screenshot).toMatchObject({
      image: "images/s_1.png",
      width: 2560,
      height: 1600,
      devicePixelRatio: 2,
      viewport: { width: 1280, height: 800, scrollX: 0, scrollY: 120 },
      highlight: { x: 1200, y: 600, width: 160, height: 64 },
    });
    expect(s.screenshot!.redactions).toBeUndefined();
  });

  it("masks a sensitive target: no value, auto redaction over the field", () => {
    const d: StepDraft = {
      action: { type: "type", value: "", masked: true },
      target: { tag: "input", role: "textbox", name: "Password", inputType: "password", sensitive: true, locators: [{ kind: "label", value: "Password" }] },
      page: { url: "http://localhost:4517/" },
      rect: { x: 100, y: 100, width: 200, height: 30 },
      sensitiveRects: [{ x: 100, y: 100, width: 200, height: 30 }],
      metrics,
      at: "2026-09-28T10:00:00.000Z",
    };
    const s = buildStep("s_2", d, frame);
    expect(s.title).not.toMatch(/hunter|•/);
    const reds = s.screenshot!.redactions!;
    expect(reds.length).toBeGreaterThanOrEqual(1);
    expect(reds.every((r) => r.auto)).toBe(true);
    // The redaction covers the whole field (in image px).
    const covers = reds.some((r) => r.rect.x <= 200 && r.rect.y <= 200 && r.rect.x + r.rect.width >= 600 && r.rect.y + r.rect.height >= 260);
    expect(covers).toBe(true);
  });

  it("blurs other sensitive fields on screen, padded, and skips off-screen ones", () => {
    const d: StepDraft = {
      action: { type: "click" },
      target: { tag: "button", role: "button", name: "Pay", locators: [{ kind: "role", role: "button", name: "Pay" }] },
      page: { url: "http://localhost:4517/" },
      rect: { x: 10, y: 10, width: 50, height: 20 },
      sensitiveRects: [
        { x: 300, y: 400, width: 240, height: 36 },
        { x: 300, y: 2000, width: 240, height: 36 },
      ],
      metrics,
      at: "2026-09-28T10:00:00.000Z",
    };
    const s = buildStep("s_3", d, frame);
    expect(s.screenshot!.redactions).toEqual([{ rect: { x: 592, y: 792, width: 496, height: 88 }, style: "mask", auto: true }]);
    // With labels (review #26) and the tab corner measured at capture (review #5).
    const labeled = buildStep("s_4", { ...d, sensitiveLabels: ["Card number", null], corner: "bottom-right" }, frame);
    expect(labeled.screenshot!.redactions![0]!.label).toBe("Card number");
    expect(labeled.screenshot!.highlight!.corner).toBe("bottom-right");
    // A checkbox's label box travels with the highlight (review R2-4), in image px.
    const withLabel = buildStep("s_5", { ...d, labelRect: { x: 70, y: 10, width: 100, height: 20 } }, frame);
    expect(withLabel.screenshot!.highlight!.labelRect).toEqual({ x: 140, y: 20, width: 200, height: 40 });
  });

  it("merges two reports of the same field into one redaction", () => {
    const d: StepDraft = {
      action: { type: "click" },
      target: { tag: "button", role: "button", name: "Go", locators: [{ kind: "role", role: "button", name: "Go" }] },
      page: { url: "http://localhost:4517/" },
      rect: { x: 10, y: 10, width: 50, height: 20 },
      sensitiveRects: [
        { x: 298, y: 398, width: 244, height: 40 },
        { x: 300, y: 400, width: 240, height: 36 },
      ],
      metrics: { devicePixelRatio: 1, viewport: { width: 1280, height: 800, scrollX: 0, scrollY: 0 } },
      at: "x",
    };
    const reds = buildStep("s_5", d, { width: 1280, height: 800 }).screenshot!.redactions!;
    expect(reds).toHaveLength(1);
    expect(reds[0]!.rect).toEqual({ x: 294, y: 394, width: 252, height: 48 });
  });

  it("works without a frame (no screenshot) and for navigations", () => {
    const s = buildStep("s_4", { action: { type: "navigate", url: "http://localhost:4517/help.html" }, page: { url: "http://localhost:4517/help.html", title: "Help" }, at: "x" });
    expect(s.screenshot).toBeUndefined();
    expect(s.title).toBe("Go to **Help**");
  });
});

describe("guide helpers", () => {
  it("creates an empty v1 guide", () => {
    expect(newGuide("g1", "2026-09-28T10:00:00.000Z", "0.1.0", "T")).toEqual({
      schemaVersion: 1,
      id: "g1",
      title: "T",
      createdAt: "2026-09-28T10:00:00.000Z",
      updatedAt: "2026-09-28T10:00:00.000Z",
      app: { name: "showsteps", version: "0.1.0" },
      steps: [],
    });
  });

  it("titles a guide from the first page, site first, no date (review #2)", () => {
    expect(titleFromPage({ url: "http://x", title: "Sign in – Acme Books" })).toBe("Acme Books: Sign in");
    expect(titleFromPage({ url: "http://x", title: "Inbox (3) - Mail — Example" })).toBe("Example: Inbox (3)");
    expect(titleFromPage({ url: "http://x", title: "Settings | Acme" })).toBe("Acme: Settings");
    expect(titleFromPage({ url: "http://x", title: "Dashboard" })).toBe("Dashboard");
    expect(titleFromPage({ url: "http://x", title: "Well-known name" })).toBe("Well-known name");
    expect(titleFromPage({ url: "https://www.books.acme.test/a" })).toBe("books.acme.test");
    expect(titleFromPage(undefined)).toBe("Untitled guide");
  });
});

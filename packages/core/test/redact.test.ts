import { describe, expect, it } from "vitest";
import { applyAutoRedactions, autoRedactions, type Step } from "../src";
import { fixtureGuide } from "./fixtures/guide";

const guide = fixtureGuide();
const byId = (id: string): Step => guide.steps.find((s) => s.id === id) as Step;

describe("autoRedactions", () => {
  it("covers the highlight box of a password step, padded and clamped", () => {
    const step = byId("s_pass");
    const stripped: Step = { ...step, screenshot: { ...(step.screenshot as NonNullable<Step["screenshot"]>), redactions: undefined } };
    const r = autoRedactions(stripped);
    expect(r).toEqual([{ rect: { x: 16, y: 42, width: 128, height: 18 }, style: "blur", auto: true }]);
  });

  it("matches the redaction the fixture recorded", () => {
    const step = byId("s_pass");
    const recorded = step.screenshot?.redactions?.[0];
    expect(recorded?.auto).toBe(true);
    const stripped: Step = { ...step, screenshot: { ...(step.screenshot as NonNullable<Step["screenshot"]>), redactions: undefined } };
    const r = autoRedactions(stripped);
    expect(recorded?.rect).toEqual(r[0]?.rect);
  });

  it("is idempotent: an existing covering redaction yields nothing", () => {
    expect(autoRedactions(byId("s_pass"))).toEqual([]);
  });

  it("returns nothing for non-sensitive steps", () => {
    for (const id of ["s_open", "s_email", "s_signin", "s_gear", "s_period", "s_invoices", "s_pay", "s_help", "s_search"]) {
      expect(autoRedactions(byId(id))).toEqual([]);
    }
  });

  it("honours the style option", () => {
    const step = byId("s_pass");
    const stripped: Step = { ...step, screenshot: { ...(step.screenshot as NonNullable<Step["screenshot"]>), redactions: undefined } };
    expect(autoRedactions(stripped, { style: "solid" })[0]?.style).toBe("solid");
  });

  it("returns nothing when there is no highlight to cover", () => {
    const step = byId("s_pass");
    const shot = { ...(step.screenshot as NonNullable<Step["screenshot"]>), redactions: undefined, highlight: undefined };
    expect(autoRedactions({ ...step, screenshot: shot })).toEqual([]);
  });

  it("flags a typed value in a card-number field even without the sensitive flag", () => {
    const step: Step = {
      ...byId("s_email"),
      action: { type: "type", value: "4242424242424242" },
    };
    expect(autoRedactions(step)).toHaveLength(1);
  });

  it("clamps to the image bounds", () => {
    const step = byId("s_pass");
    const shot = { ...(step.screenshot as NonNullable<Step["screenshot"]>), redactions: undefined, highlight: { x: 150, y: 90, width: 30, height: 30 } };
    const r = autoRedactions({ ...step, screenshot: shot })[0];
    expect(r && r.rect.x + r.rect.width).toBeLessThanOrEqual(160);
    expect(r && r.rect.y + r.rect.height).toBeLessThanOrEqual(100);
  });
});

describe("applyAutoRedactions", () => {
  it("adds missing redactions and leaves everything else alone", () => {
    const stripped = {
      ...guide,
      steps: guide.steps.map((s) => (s.id === "s_pass" && s.screenshot ? { ...s, screenshot: { ...s.screenshot, redactions: undefined } } : s)),
    };
    const out = applyAutoRedactions(stripped, { style: "pixelate" });
    expect(out.steps.find((s) => s.id === "s_pass")?.screenshot?.redactions).toHaveLength(1);
    expect(out.steps.find((s) => s.id === "s_pass")?.screenshot?.redactions?.[0]?.style).toBe("pixelate");
    expect(out.steps.filter((s) => s.screenshot?.redactions?.length)).toHaveLength(1);
    expect(applyAutoRedactions(out)).toBe(out);
  });
  it("returns the same guide object when nothing changes", () => {
    expect(applyAutoRedactions(guide)).toBe(guide);
  });
});

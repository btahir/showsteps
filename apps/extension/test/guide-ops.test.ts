import { describe, expect, it } from "vitest";
import type { Guide, Step } from "@showsteps/core";
import {
  addNote,
  addRedaction,
  deleteStep,
  mergeRemote,
  mergeWithNext,
  moveStep,
  moveStepBy,
  removeRedaction,
  setCrop,
  setHighlight,
  toggleSkip,
  updateStep,
  visibleSteps,
} from "../src/lib/guide-ops";

const T = "2026-09-28T10:00:00.000Z";
const step = (id: string, extra: Partial<Step> = {}): Step => ({
  id,
  action: { type: "click" },
  title: `Click **${id}**`,
  page: { url: "http://localhost:4517/" },
  timestamp: T,
  screenshot: { image: `images/${id}.png`, width: 200, height: 100, devicePixelRatio: 1, viewport: { width: 200, height: 100, scrollX: 0, scrollY: 0 }, highlight: { x: 1, y: 2, width: 3, height: 4 } },
  ...extra,
});
const guide = (ids: string[]): Guide => ({ schemaVersion: 1, id: "g", title: "G", createdAt: T, updatedAt: T, steps: ids.map((i) => step(i)) });
const ids = (g: Guide) => g.steps.map((s) => s.id);

describe("guide ops", () => {
  it("moves steps by index and by delta, clamped, immutably", () => {
    const g = guide(["a", "b", "c", "d"]);
    expect(ids(moveStep(g, "a", 2))).toEqual(["b", "c", "a", "d"]);
    expect(ids(moveStep(g, "d", 0))).toEqual(["d", "a", "b", "c"]);
    expect(ids(moveStep(g, "b", 99))).toEqual(["a", "c", "d", "b"]);
    expect(ids(moveStepBy(g, "c", -1))).toEqual(["a", "c", "b", "d"]);
    expect(moveStep(g, "a", 0)).toBe(g);
    expect(moveStep(g, "zz", 1)).toBe(g);
    expect(ids(g)).toEqual(["a", "b", "c", "d"]);
  });

  it("deletes, skips and counts visible steps", () => {
    let g = guide(["a", "b", "c"]);
    g = deleteStep(g, "b");
    expect(ids(g)).toEqual(["a", "c"]);
    g = toggleSkip(g, "a");
    expect(g.steps[0]!.skipped).toBe(true);
    expect(visibleSteps(g).map((s) => s.id)).toEqual(["c"]);
    expect(toggleSkip(g, "a").steps[0]!.skipped).toBe(false);
  });

  it("marks titles as edited only when the title changes", () => {
    const g = guide(["a"]);
    expect(updateStep(g, "a", { description: "x" }).steps[0]!.titleEdited).toBeUndefined();
    expect(updateStep(g, "a", { title: "Press the big button" }).steps[0]).toMatchObject({ title: "Press the big button", titleEdited: true });
  });

  it("adds a note after a step or at the start", () => {
    const g = guide(["a", "b"]);
    const n = addNote(g, "a", { id: "n1", now: T });
    expect(ids(n)).toEqual(["a", "n1", "b"]);
    expect(n.steps[1]).toMatchObject({ action: { type: "note" }, titleEdited: true, page: { url: "http://localhost:4517/" } });
    expect(ids(addNote(g, null, { id: "n0" }))).toEqual(["n0", "a", "b"]);
  });

  it("merges a step with the next one, keeping the first screenshot", () => {
    let g = guide(["a", "b", "c"]);
    g = updateStep(g, "a", { description: "First" });
    const m = mergeWithNext(g, "a");
    expect(ids(m)).toEqual(["a", "c"]);
    expect(m.steps[0]!.description).toBe("First\n\nClick **b**");
    expect(m.steps[0]!.screenshot!.image).toBe("images/a.png");
    expect(mergeWithNext(g, "c")).toBe(g);
  });

  it("edits highlight, redactions and crop", () => {
    let g = guide(["a"]);
    g = setHighlight(g, "a", undefined);
    expect(g.steps[0]!.screenshot!.highlight).toBeUndefined();
    g = setHighlight(g, "a", { x: 5, y: 5, width: 5, height: 5 });
    expect(g.steps[0]!.screenshot!.highlight).toEqual({ x: 5, y: 5, width: 5, height: 5 });
    g = addRedaction(g, "a", { rect: { x: 0, y: 0, width: 10, height: 10 }, style: "blur" });
    g = addRedaction(g, "a", { rect: { x: 20, y: 0, width: 10, height: 10 }, style: "solid" });
    g = removeRedaction(g, "a", 0);
    expect(g.steps[0]!.screenshot!.redactions).toEqual([{ rect: { x: 20, y: 0, width: 10, height: 10 }, style: "solid" }]);
    g = setCrop(g, "a", { x: 0, y: 0, width: 100, height: 50 });
    expect(g.steps[0]!.screenshot!.crop).toEqual({ x: 0, y: 0, width: 100, height: 50 });
    expect(setCrop(g, "a", undefined).steps[0]!.screenshot!.crop).toBeUndefined();
    // No screenshot: untouched.
    const noShot = { ...guide([]), steps: [{ ...step("n"), screenshot: undefined }] };
    expect(setCrop(noShot, "n", { x: 0, y: 0, width: 1, height: 1 })).toBe(noShot);
  });

  it("merges recorder additions into an editor copy without undoing local edits", () => {
    const remote = guide(["a", "b", "c", "d"]);
    let local = moveStep(guide(["a", "b", "c"]), "c", 0);
    local = deleteStep(local, "b");
    const merged = mergeRemote(local, remote, new Set(["b"]));
    expect(ids(merged)).toEqual(["c", "a", "d"]);
    expect(mergeRemote(local, guide(["a", "c"]), new Set())).toBe(local);
  });
});

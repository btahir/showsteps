import { describe, expect, it } from "vitest";
import { acceptsSteps, IDLE, isActive, reduceSession, shouldJoin } from "../src/lib/session";
import type { SessionState } from "../src/lib/session";

const started = (): SessionState => reduceSession(IDLE, { type: "start", guideId: "g1", windowId: 7, tabIds: [1, 2, 2], at: "2026-09-28T10:00:00Z" });

describe("session state machine", () => {
  it("starts from idle with deduplicated tabs", () => {
    const s = started();
    expect(s.status).toBe("recording");
    expect(s.tabIds).toEqual([1, 2]);
    expect(s.guideId).toBe("g1");
    expect(acceptsSteps(s)).toBe(true);
  });

  it("ignores start while already recording (identity preserved)", () => {
    const s = started();
    expect(reduceSession(s, { type: "start", guideId: "g2", windowId: 1, tabIds: [], at: "" })).toBe(s);
  });

  it("pause stops accepting steps; resume accumulates paused time", () => {
    const p = reduceSession(started(), { type: "pause", now: 1000 });
    expect(p.status).toBe("paused");
    expect(acceptsSteps(p)).toBe(false);
    expect(isActive(p)).toBe(true);
    const r = reduceSession(p, { type: "resume", now: 4500 });
    expect(r.status).toBe("recording");
    expect(r.pausedMs).toBe(3500);
    expect(r.pausedAt).toBeUndefined();
  });

  it("pause is only valid while recording, resume only while paused", () => {
    expect(reduceSession(IDLE, { type: "pause", now: 1 })).toBe(IDLE);
    const s = started();
    expect(reduceSession(s, { type: "resume", now: 1 })).toBe(s);
  });

  it("stop → stopping → stopped returns to a fresh idle state", () => {
    const stopping = reduceSession(started(), { type: "stop" });
    expect(stopping.status).toBe("stopping");
    expect(acceptsSteps(stopping)).toBe(false);
    expect(isActive(stopping)).toBe(false);
    const done = reduceSession(stopping, { type: "stopped" });
    expect(done).toEqual({ status: "idle", tabIds: [], stepCount: 0, pausedMs: 0 });
  });

  it("stop works from paused, not from idle", () => {
    const p = reduceSession(started(), { type: "pause", now: 0 });
    expect(reduceSession(p, { type: "stop" }).status).toBe("stopping");
    expect(reduceSession(IDLE, { type: "stop" })).toBe(IDLE);
  });

  it("tabs join once and leave", () => {
    let s = reduceSession(started(), { type: "tab-joined", tabId: 3 });
    expect(s.tabIds).toEqual([1, 2, 3]);
    expect(reduceSession(s, { type: "tab-joined", tabId: 3 })).toBe(s);
    s = reduceSession(s, { type: "tab-closed", tabId: 1 });
    expect(s.tabIds).toEqual([2, 3]);
    expect(reduceSession(IDLE, { type: "tab-joined", tabId: 9 })).toBe(IDLE);
  });

  it("closing the recording window stops, other windows do not", () => {
    const s = started();
    expect(reduceSession(s, { type: "window-closed", windowId: 8 })).toBe(s);
    expect(reduceSession(s, { type: "window-closed", windowId: 7 }).status).toBe("stopping");
  });

  it("counts steps and never goes negative", () => {
    let s = reduceSession(started(), { type: "step-added" });
    s = reduceSession(s, { type: "step-added" });
    expect(s.stepCount).toBe(2);
    s = reduceSession(s, { type: "step-removed" });
    s = reduceSession(s, { type: "step-removed" });
    expect(reduceSession(s, { type: "step-removed" }).stepCount).toBe(0);
    expect(reduceSession(IDLE, { type: "step-added" })).toBe(IDLE);
  });

  it("new tabs join by window or by opener", () => {
    const s = started();
    expect(shouldJoin(s, { windowId: 7 })).toBe(true);
    expect(shouldJoin(s, { windowId: 9, openerTabId: 2 })).toBe(true);
    expect(shouldJoin(s, { windowId: 9, openerTabId: 99 })).toBe(false);
    expect(shouldJoin(IDLE, { windowId: 7 })).toBe(false);
  });
});

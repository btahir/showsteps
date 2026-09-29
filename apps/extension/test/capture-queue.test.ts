import { describe, expect, it } from "vitest";
import { CaptureQueue, isQuotaError } from "../src/lib/capture-queue";
import type { Clock } from "../src/lib/capture-queue";

/** Deterministic clock: sleep advances time instantly. */
function fakeClock(): Clock & { t: number } {
  const c = {
    t: 0,
    now: () => c.t,
    sleep: async (ms: number) => {
      c.t += ms;
    },
  };
  return c;
}

describe("CaptureQueue", () => {
  it("never starts more than 2 captures in any 1s window", async () => {
    const clock = fakeClock();
    const q = new CaptureQueue({ clock, marginMs: 0 });
    const starts: number[] = [];
    const jobs = Array.from({ length: 7 }, (_, i) =>
      q.schedule(`k${i}`, async () => {
        starts.push(clock.now());
        return i;
      }),
    );
    expect(await Promise.all(jobs)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(starts).toEqual([0, 0, 1000, 1000, 2000, 2000, 3000]);
    for (let i = 2; i < starts.length; i++) expect(starts[i]! - starts[i - 2]!).toBeGreaterThanOrEqual(1000);
  });

  it("adds the safety margin to the window", async () => {
    const clock = fakeClock();
    const q = new CaptureQueue({ clock, marginMs: 60 });
    const starts: number[] = [];
    await Promise.all([0, 1, 2].map((i) => q.schedule(`k${i}`, async () => void starts.push(clock.now()))));
    expect(starts).toEqual([0, 0, 1060]);
  });

  it("lets a request join a queued job with the same key", async () => {
    const clock = fakeClock();
    const q = new CaptureQueue({ clock, marginMs: 0, maxCalls: 1 });
    let runs = 0;
    const a = q.schedule("x", async () => ++runs); // starts immediately
    const b = q.schedule("w", async () => ++runs); // queued
    const c = q.schedule("w", async () => ++runs); // joins b
    expect(await a).toBe(1);
    const [rb, rc] = await Promise.all([b, c]);
    expect(rb).toBe(2);
    expect(rc).toBe(2);
    expect(runs).toBe(2);
  });

  it("does not join a job that already started", async () => {
    const clock = fakeClock();
    const q = new CaptureQueue({ clock, marginMs: 0 });
    let runs = 0;
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const a = q.schedule("w", async () => {
      await gate;
      return ++runs;
    });
    await Promise.resolve();
    const b = q.schedule("w", async () => ++runs);
    release();
    expect(await a).toBe(1);
    expect(await b).toBe(2);
  });

  it("retries quota errors after waiting a full window", async () => {
    const clock = fakeClock();
    const q = new CaptureQueue({ clock, marginMs: 0 });
    const attempts: number[] = [];
    const r = await q.schedule("w", async () => {
      attempts.push(clock.now());
      if (attempts.length < 3) throw new Error("This request exceeds the MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND quota.");
      return "ok";
    });
    expect(r).toBe("ok");
    expect(attempts).toEqual([0, 1000, 2000]);
  });

  it("gives up after the retry budget and rejects other errors at once", async () => {
    const clock = fakeClock();
    const q = new CaptureQueue({ clock, marginMs: 0, retries: 1 });
    await expect(q.schedule("a", async () => Promise.reject(new Error("quota exceeded")))).rejects.toThrow(/quota/);
    await expect(q.schedule("b", async () => Promise.reject(new Error("tab closed")))).rejects.toThrow("tab closed");
    // The queue keeps working after failures.
    expect(await q.schedule("c", async () => 42)).toBe(42);
    expect(q.size).toBe(0);
  });

  it("recognises Chrome's quota message", () => {
    expect(isQuotaError(new Error("This request exceeds the MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND quota."))).toBe(true);
    expect(isQuotaError("Cannot access contents of url")).toBe(false);
  });

  it("spaces captures 520 ms apart in the one-at-a-time configuration", async () => {
    const clock = fakeClock();
    const q = new CaptureQueue({ clock, maxCalls: 1, windowMs: 520, marginMs: 0 });
    const starts: number[] = [];
    await Promise.all([0, 1, 2].map((i) => q.schedule(`k${i}`, async () => void starts.push(clock.now()))));
    expect(starts).toEqual([0, 520, 1040]);
  });

  it("runs idle (settled-frame) captures in the next free slot, only when the queue is quiet", async () => {
    const clock = fakeClock();
    const q = new CaptureQueue({ clock, maxCalls: 1, windowMs: 520, marginMs: 0 });
    const starts: number[] = [];
    expect(await q.scheduleIdle("w", async () => (starts.push(clock.now()), "first"))).toBe("first");
    // Right after a capture: waits for the slot instead of being skipped.
    expect(await q.scheduleIdle("w", async () => (starts.push(clock.now()), "second"))).toBe("second");
    expect(starts).toEqual([0, 520]);
    clock.t += 1000;
    // Something queued: skipped so the real capture is not delayed.
    const real = q.schedule("w", async () => "real");
    expect(await q.scheduleIdle("w2", async () => "idle")).toBeNull();
    expect(await real).toBe("real");
  });

  it("a real capture replaces an idle refresh that is still waiting for its slot", async () => {
    const clock = fakeClock();
    const q = new CaptureQueue({ clock, maxCalls: 1, windowMs: 520, marginMs: 0 });
    await q.schedule("w", async () => "click");
    let idleRan = false;
    const idle = q.scheduleIdle("w", async () => ((idleRan = true), "idle"));
    const real = q.schedule("w", async () => "next click");
    expect(await idle).toBeNull();
    expect(await real).toBe("next click");
    expect(idleRan).toBe(false);
    expect(q.size).toBe(0);
  });

  it("reports the delay until the next free slot", () => {
    const clock = fakeClock();
    const q = new CaptureQueue({ clock, marginMs: 0 });
    expect(q.delayUntilSlot(0)).toBe(0);
  });
});

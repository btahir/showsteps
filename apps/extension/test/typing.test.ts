import { beforeEach, describe, expect, it } from "vitest";
import { TypingTracker } from "../src/lib/typing";
import type { CommitReason, Timers, TypingEntry } from "../src/lib/typing";

/** Manual timers: `tick(ms)` fires whatever is due. */
function manualTimers() {
  let now = 0;
  let seq = 0;
  const pending = new Map<number, { at: number; fn: () => void }>();
  const timers: Timers & { tick(ms: number): void } = {
    set(fn, ms) {
      const id = ++seq;
      pending.set(id, { at: now + ms, fn });
      return id;
    },
    clear(h) {
      pending.delete(h as number);
    },
    tick(ms) {
      now += ms;
      for (const [id, t] of [...pending]) if (t.at <= now) {
        pending.delete(id);
        t.fn();
      }
    },
  };
  return timers;
}

describe("TypingTracker", () => {
  let commits: [TypingEntry<string>, CommitReason][];
  let timers: ReturnType<typeof manualTimers>;
  let t: TypingTracker<string>;

  beforeEach(() => {
    commits = [];
    timers = manualTimers();
    t = new TypingTracker<string>((e, r) => commits.push([e, r]), 1500, timers);
  });

  const type = (key: string, text: string, opts: { sensitive?: boolean; start?: string } = {}) => {
    for (let i = 1; i <= text.length; i++) {
      t.input(key, (opts.start ?? "") + text.slice(0, i), { sensitive: !!opts.sensitive, now: i, startValue: opts.start ?? "", meta: key });
      timers.tick(100);
    }
  };

  it("folds keystrokes in one field into one step after idle", () => {
    type("email", "jane@example.com");
    expect(commits).toHaveLength(0);
    timers.tick(1500);
    expect(commits).toHaveLength(1);
    expect(commits[0]![0]).toMatchObject({ key: "email", value: "jane@example.com", masked: false });
    expect(commits[0]![1]).toBe("idle");
  });

  it("commits the previous field when another field gets input", () => {
    type("first", "Jane");
    type("last", "Doe");
    expect(commits.map(([e, r]) => [e.key, e.value, r])).toEqual([["first", "Jane", "switch"]]);
    t.flush();
    expect(commits.map(([e, r]) => [e.key, e.value, r])).toEqual([
      ["first", "Jane", "switch"],
      ["last", "Doe", "flush"],
    ]);
  });

  it("never keeps the value of a sensitive field", () => {
    type("pw", "hunter2", { sensitive: true });
    t.flush();
    expect(commits).toHaveLength(1);
    expect(commits[0]![0].value).toBe("");
    expect(commits[0]![0].masked).toBe(true);
    expect(JSON.stringify(commits)).not.toContain("hunter");
  });

  it("stays masked if a field becomes sensitive mid-way", () => {
    t.input("f", "abc", { sensitive: false, now: 0, meta: "f" });
    t.input("f", "abcd", { sensitive: true, now: 1, meta: "f" });
    t.input("f", "abcde", { sensitive: false, now: 2, meta: "f" });
    t.flush();
    expect(commits[0]![0]).toMatchObject({ value: "", masked: true });
  });

  it("drops a visit that leaves the value unchanged", () => {
    t.input("q", "hello!", { sensitive: false, now: 0, startValue: "hello", meta: "q" });
    t.input("q", "hello", { sensitive: false, now: 1, startValue: "hello", meta: "q" });
    expect(t.flush()).toBe(false);
    expect(commits).toHaveLength(0);
  });

  it("flush(key) only commits that field", () => {
    type("a", "x");
    expect(t.flush("b")).toBe(false);
    expect(t.flush("a")).toBe(true);
    expect(t.pendingKey).toBeUndefined();
  });

  it("keeps the latest meta for the commit and a new idle window per keystroke", () => {
    t.input("a", "1", { sensitive: false, now: 0, meta: "first" });
    timers.tick(1400);
    t.input("a", "12", { sensitive: false, now: 1400, meta: "second" });
    timers.tick(1400);
    expect(commits).toHaveLength(0);
    timers.tick(100);
    expect(commits[0]![0]).toMatchObject({ value: "12", meta: "second" });
  });

  it("cancel drops pending input and its timer", () => {
    type("a", "abc");
    t.cancel();
    timers.tick(5000);
    expect(commits).toHaveLength(0);
  });
});

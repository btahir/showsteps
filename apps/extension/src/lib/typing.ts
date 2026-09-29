// Folds a stream of `input` events into one "type" step per field visit.
// A field's pending entry is committed when another field receives input, after
// `idleMs` without input, or on an explicit flush (blur, change, Enter, a click
// elsewhere, submit, pause, stop). Sensitive fields never keep their value.

export interface TypingEntry<M> {
  key: string;
  value: string; // "" when sensitive
  masked: boolean;
  startValue: string;
  firstAt: number;
  lastAt: number;
  meta: M;
}

export interface Timers {
  set(fn: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

const defaultTimers: Timers = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

export type CommitReason = "switch" | "idle" | "flush";

export class TypingTracker<M> {
  private pending: TypingEntry<M> | undefined;
  private timer: unknown;

  constructor(
    private readonly onCommit: (entry: TypingEntry<M>, reason: CommitReason) => void,
    private readonly idleMs = 1500,
    private readonly timers: Timers = defaultTimers,
  ) {}

  /**
   * Record that field `key` now holds `value`. `startValue` is the value the field had
   * before this visit (used to drop visits that changed nothing). `meta` is refreshed
   * on every input so it describes the field as it is at commit time.
   */
  input(key: string, value: string, opts: { sensitive: boolean; now: number; startValue?: string; meta: M }): void {
    if (this.pending && this.pending.key !== key) this.commit("switch");
    const masked = opts.sensitive;
    if (!this.pending) {
      this.pending = {
        key,
        value: masked ? "" : value,
        masked,
        startValue: masked ? "" : (opts.startValue ?? ""),
        firstAt: opts.now,
        lastAt: opts.now,
        meta: opts.meta,
      };
    } else {
      this.pending.value = masked || this.pending.masked ? "" : value;
      this.pending.masked = this.pending.masked || masked;
      this.pending.lastAt = opts.now;
      this.pending.meta = opts.meta;
    }
    this.arm();
  }

  /** Update the metadata of the pending entry (e.g. a fresher capture id) without touching the value. */
  touch(key: string, meta: M): void {
    if (this.pending?.key === key) this.pending.meta = meta;
  }

  /** Commit the pending entry now, if any. Returns whether something was committed. */
  flush(key?: string): boolean {
    if (!this.pending) return false;
    if (key !== undefined && this.pending.key !== key) return false;
    return this.commit("flush");
  }

  /** Throw away the pending entry without committing (e.g. recording was discarded). */
  cancel(): void {
    this.disarm();
    this.pending = undefined;
  }

  get pendingKey(): string | undefined {
    return this.pending?.key;
  }

  private commit(reason: CommitReason): boolean {
    this.disarm();
    const entry = this.pending;
    this.pending = undefined;
    if (!entry) return false;
    if (!entry.masked && entry.value === entry.startValue) return false;
    this.onCommit(entry, reason);
    return true;
  }

  private arm(): void {
    this.disarm();
    this.timer = this.timers.set(() => {
      this.timer = undefined;
      this.commit("idle");
    }, this.idleMs);
  }

  private disarm(): void {
    if (this.timer !== undefined) this.timers.clear(this.timer);
    this.timer = undefined;
  }
}

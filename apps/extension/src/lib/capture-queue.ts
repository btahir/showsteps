// Rate-limited queue for chrome.tabs.captureVisibleTab.
// Chrome allows MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND (2) calls per second; going over
// throws "This request exceeds the MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND quota".
// The queue keeps at most `maxCalls` starts in any `windowMs` window, runs jobs in order,
// lets a new request join a job for the same key that has not started yet (so a typing
// commit and the click that caused it share one frame), and retries quota errors.

export interface Clock {
  now(): number;
  sleep(ms: number): Promise<void>;
}

export const realClock: Clock = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
};

export interface CaptureQueueOptions {
  maxCalls?: number; // per window
  windowMs?: number;
  marginMs?: number; // safety gap added to the window
  retries?: number;
  clock?: Clock;
}

interface Job<T> {
  key: string;
  run: () => Promise<T>;
  promise: Promise<T>;
  resolve: (v: T) => void;
  reject: (e: unknown) => void;
  started: boolean;
}

export function isQuotaError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  return /MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND|quota/i.test(msg);
}

export class CaptureQueue {
  private readonly maxCalls: number;
  private readonly windowMs: number;
  private readonly retries: number;
  private readonly clock: Clock;
  private starts: number[] = [];
  private lastStart = -Infinity;
  private jobs: Job<unknown>[] = [];
  private draining = false;

  constructor(opts: CaptureQueueOptions = {}) {
    this.maxCalls = opts.maxCalls ?? 2;
    this.windowMs = (opts.windowMs ?? 1000) + (opts.marginMs ?? 60);
    this.retries = opts.retries ?? 3;
    this.clock = opts.clock ?? realClock;
  }

  /** Jobs waiting or running. */
  get size(): number {
    return this.jobs.length;
  }

  /**
   * Queue `run`. If a job with the same key is queued and has not started, the caller
   * shares its result instead of adding another capture.
   */
  schedule<T>(key: string, run: () => Promise<T>): Promise<T> {
    const waiting = this.jobs.find((j) => j.key === key && !j.started);
    if (waiting) return waiting.promise as Promise<T>;
    let resolve!: (v: T) => void;
    let reject!: (e: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    const job: Job<T> = { key, run, promise, resolve, reject, started: false };
    this.jobs.push(job as Job<unknown>);
    void this.drain();
    return promise;
  }

  /**
   * Low-priority capture (a "settled frame" refresh): runs only when nothing is queued and the
   * last capture started at least `gapMs` ago; otherwise resolves to null without capturing,
   * so it never delays a capture a step is waiting for.
   */
  scheduleIdle<T>(key: string, run: () => Promise<T>, gapMs = 1000): Promise<T | null> {
    if (this.jobs.length > 0 || this.clock.now() - this.lastStart < gapMs || this.delayUntilSlot() > 0) return Promise.resolve(null);
    return this.schedule(key, run);
  }

  /** Milliseconds to wait before another call may start (0 = now). */
  delayUntilSlot(now = this.clock.now()): number {
    this.starts = this.starts.filter((t) => now - t < this.windowMs);
    if (this.starts.length < this.maxCalls) return 0;
    const oldest = this.starts[0]!;
    return Math.max(0, oldest + this.windowMs - now);
  }

  private async drain(): Promise<void> {
    if (this.draining) return;
    this.draining = true;
    try {
      while (this.jobs.length) {
        const job = this.jobs[0]!;
        let attempt = 0;
        for (;;) {
          const wait = this.delayUntilSlot();
          if (wait > 0) await this.clock.sleep(wait);
          job.started = true;
          this.lastStart = this.clock.now();
          this.starts.push(this.lastStart);
          try {
            job.resolve(await job.run());
            break;
          } catch (e) {
            if (isQuotaError(e) && attempt < this.retries) {
              attempt++;
              // Chrome's own window disagrees with ours: treat the window as full.
              const now = this.clock.now();
              this.starts = Array.from({ length: this.maxCalls }, () => now);
              continue;
            }
            job.reject(e);
            break;
          }
        }
        this.jobs.shift();
      }
    } finally {
      this.draining = false;
    }
  }
}

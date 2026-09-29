// When a step has to use a frame captured earlier than the action (its own capture lost the race
// with a new tab, a navigation or the rate limit), the page may have scrolled in between. The
// recorder measured the target and the sensitive fields at the action, so this moves them into
// the older frame's coordinates, or drops what cannot be placed, and never claims a clean
// redaction scan it did not have (PLAN §3.4 rung 3, §3.7 fail closed).

import type { Rect } from "@showsteps/core";
import type { PageMetricsLike, StepDraft } from "./steps";

/** Scroll, size and scale of the page when a frame was captured (or asked for). */
export interface FrameView {
  scrollX: number;
  scrollY: number;
  width: number;
  height: number;
  dpr: number;
}

/** Sensitive rects scanned together with a frame (worker-side navigate captures have them). */
export interface FrameScan {
  rects: Rect[];
  labels?: (string | null)[];
}

export function viewOf(m: PageMetricsLike | undefined): FrameView | undefined {
  if (!m) return undefined;
  return { scrollX: m.viewport.scrollX, scrollY: m.viewport.scrollY, width: m.viewport.width, height: m.viewport.height, dpr: m.devicePixelRatio };
}

const close = (a: number, b: number, eps = 0.5) => Math.abs(a - b) <= eps;

export function sameSize(a: FrameView, b: FrameView): boolean {
  return close(a.width, b.width) && close(a.height, b.height) && close(a.dpr, b.dpr, 0.01);
}

export function sameView(a: FrameView, b: FrameView): boolean {
  return sameSize(a, b) && close(a.scrollX, b.scrollX) && close(a.scrollY, b.scrollY);
}

/**
 * The draft as it applies to a frame taken at `frame` (undefined = unknown, treated as the same
 * moment). Scroll only: the target moves by the scroll difference unless it sits in a fixed or
 * sticky container (`draft.pinned`); sensitive rects are kept both where they are now and where
 * they were (one of the two is right for every field, fixed or not), plus whatever was scanned
 * with the frame itself. Any other difference (window size, zoom): no highlight. In both cases the
 * step asks for a review unless the frame came with its own scan, because content that was on
 * screen then may have scrolled out of reach of the scan made at the action.
 */
export function draftForFrame(draft: StepDraft, frame: FrameView | undefined, frameScan?: FrameScan): StepDraft {
  const now = viewOf(draft.metrics);
  if (!frame || !now || sameView(now, frame)) {
    if (!frameScan?.rects.length) return draft;
    return withExtraRects(draft, frameScan.rects, frameScan.labels);
  }
  const out: StepDraft = { ...draft };
  const metrics = draft.metrics!;
  // The screenshot's own facts: its scroll, not the one at the action.
  out.metrics = { ...metrics, viewport: { ...metrics.viewport, scrollX: frame.scrollX, scrollY: frame.scrollY } };
  if (!sameSize(now, frame)) {
    delete out.rect;
    delete out.labelRect;
    delete out.corner;
    out.metrics = { devicePixelRatio: frame.dpr, viewport: { width: frame.width, height: frame.height, scrollX: frame.scrollX, scrollY: frame.scrollY } };
    out.sensitiveRects = [];
    out.sensitiveLabels = undefined;
    if (!frameScan) out.scanIncomplete = true;
    return frameScan?.rects.length ? withExtraRects(out, frameScan.rects, frameScan.labels) : out;
  }
  const dx = now.scrollX - frame.scrollX;
  const dy = now.scrollY - frame.scrollY;
  const move = (r: Rect): Rect => ({ x: r.x + dx, y: r.y + dy, width: r.width, height: r.height });
  if (!draft.pinned) {
    if (out.rect) out.rect = move(out.rect);
    if (out.labelRect) out.labelRect = move(out.labelRect);
    delete out.corner; // measured for the other position
  }
  const cur = draft.sensitiveRects ?? [];
  const labels = draft.sensitiveLabels;
  out.sensitiveRects = [...cur, ...cur.map(move)];
  if (labels) out.sensitiveLabels = [...labels, ...labels];
  if (!frameScan) out.scanIncomplete = true;
  return frameScan?.rects.length ? withExtraRects(out, frameScan.rects, frameScan.labels) : out;
}

function withExtraRects(d: StepDraft, rects: Rect[], labels?: (string | null)[]): StepDraft {
  const cur = d.sensitiveRects ?? [];
  const curLabels = d.sensitiveLabels ?? cur.map(() => null);
  return {
    ...d,
    sensitiveRects: [...cur, ...rects],
    sensitiveLabels: [...curLabels, ...rects.map((_, i) => labels?.[i] ?? null)],
  };
}

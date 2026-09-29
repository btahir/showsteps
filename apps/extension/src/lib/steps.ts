// Turns what the recorder saw (action, element, CSS rects, page metrics) plus the captured
// frame into a schema Step. Pure apart from the core helpers it calls.

import { autoRedactions, generateStepTitle } from "@stepsnap/core";
import type { ElementDescriptor, Rect, Redaction, Step, StepAction } from "@stepsnap/core";
import { cssRectToImage, padRect } from "./rect";
import type { Viewport } from "./rect";

export interface PageMetricsLike {
  devicePixelRatio: number;
  viewport: Viewport;
}

/** What the content script (or the worker, for navigations) reports for one step. */
export interface StepDraft {
  action: StepAction;
  target?: ElementDescriptor;
  page: { url: string; title?: string; tabId?: number };
  /** Target box in top-level viewport CSS px, measured before the action. */
  rect?: Rect;
  /** Other sensitive fields visible at the same moment (CSS px), blurred automatically. */
  sensitiveRects?: Rect[];
  metrics?: PageMetricsLike;
  at: string;
}

export interface FrameInfo {
  width: number;
  height: number;
}

/** Padding (image px at 1x) around sensitive fields so borders and glyph edges are covered too. */
const REDACT_PAD = 4;

/** Intersection over union of two rects (0..1). */
export function overlap(a: Rect, b: Rect): number {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.width, b.x + b.width);
  const y2 = Math.min(a.y + a.height, b.y + b.height);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const union = a.width * a.height + b.width * b.height - inter;
  return union > 0 ? inter / union : 0;
}

/** The same field reported twice (different padding, or by two scanners). */
function sameRect(a: Rect, b: Rect): boolean {
  return overlap(a, b) >= 0.7;
}

function union(a: Rect, b: Rect): Rect {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, width: Math.max(a.x + a.width, b.x + b.width) - x, height: Math.max(a.y + a.height, b.y + b.height) - y };
}

/** Core's autoRedactions, tolerating a core build that has not implemented it yet. */
function coreAutoRedactions(step: Step): Redaction[] {
  try {
    return autoRedactions(step);
  } catch {
    // Fallback with the same meaning: a sensitive target is blurred over its highlight box.
    return step.target?.sensitive && step.screenshot?.highlight ? [{ rect: step.screenshot.highlight, style: "blur", auto: true }] : [];
  }
}

export function safeTitle(step: Pick<Step, "action" | "target" | "page">): string {
  try {
    return generateStepTitle(step);
  } catch {
    return step.action.type === "navigate" ? "Go to the page" : "Step";
  }
}

export function buildStep(id: string, d: StepDraft, frame?: FrameInfo): Step {
  const step: Step = {
    id,
    action: d.action,
    title: "",
    page: d.page,
    timestamp: d.at,
  };
  if (d.target) step.target = d.target;

  if (frame && d.metrics) {
    const { viewport, devicePixelRatio } = d.metrics;
    const shot: NonNullable<Step["screenshot"]> = {
      image: `images/${id}.png`,
      width: frame.width,
      height: frame.height,
      devicePixelRatio,
      viewport: { ...viewport },
    };
    const highlight = d.rect ? cssRectToImage(d.rect, viewport, frame) : null;
    if (highlight) shot.highlight = highlight;
    step.screenshot = shot;

    const scale = frame.width / Math.max(1, viewport.width);
    const redactions: Redaction[] = coreAutoRedactions(step).map((r) => ({ ...r, auto: true }));
    for (const css of d.sensitiveRects ?? []) {
      const img = cssRectToImage(css, viewport, frame);
      if (!img) continue;
      const padded = padRect(img, Math.round(REDACT_PAD * scale), frame.width, frame.height);
      const dup = redactions.find((r) => sameRect(r.rect, padded));
      // Keep one box per field, big enough to cover every report of it.
      if (dup) dup.rect = union(dup.rect, padded);
      else redactions.push({ rect: padded, style: "blur", auto: true });
    }
    if (redactions.length) shot.redactions = redactions;
  }

  step.title = safeTitle(step);
  return step;
}

/** A fresh, empty guide. */
export function newGuide(id: string, now: string, version: string, title = "Untitled guide") {
  return {
    schemaVersion: 1 as const,
    id,
    title,
    createdAt: now,
    updatedAt: now,
    app: { name: "showsteps" as const, version },
    steps: [] as Step[],
  };
}

/** A readable default guide title from the first page recorded. */
export function titleFromPage(page: { url: string; title?: string } | undefined, date: Date): string {
  const when = date.toLocaleDateString("en", { month: "short", day: "numeric" });
  const name = page?.title?.trim();
  if (name) return `${name.length > 60 ? name.slice(0, 59) + "…" : name} — ${when}`;
  try {
    return `${new URL(page?.url ?? "").hostname} — ${when}`;
  } catch {
    return `Guide — ${when}`;
  }
}

// Pure, immutable edits on a Guide. The editor and side panel use these; the service
// worker uses appendStep while recording. Every function returns a new Guide.

import { localIso } from "./time";
import type { Guide, Rect, Redaction, Step } from "@stepsnap/core";

export function newId(prefix = "s"): string {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  const s = Array.from(bytes, (b) => (b % 36).toString(36)).join("");
  return `${prefix}_${s}`;
}

function touch(g: Guide, steps: Step[], now?: string): Guide {
  return { ...g, steps, updatedAt: now ?? localIso() };
}

export function indexOfStep(g: Guide, id: string): number {
  return g.steps.findIndex((s) => s.id === id);
}

export function appendStep(g: Guide, step: Step, now?: string): Guide {
  return touch(g, [...g.steps, step], now);
}

/**
 * Later typing in the same field replaces the earlier typing step instead of adding one
 * (PLAN §3.6): the new value, title and screenshot win; a title or description the person
 * already edited is kept. Returns the guide unchanged when the step is gone (deleted meanwhile).
 */
export function amendStep(g: Guide, id: string, next: Step, now?: string): Guide {
  const i = indexOfStep(g, id);
  if (i < 0) return g;
  const prev = g.steps[i]!;
  const merged: Step = { ...next, id };
  if (prev.titleEdited) {
    merged.title = prev.title;
    merged.titleEdited = true;
  }
  if (prev.description) merged.description = prev.description;
  if (prev.skipped) merged.skipped = true;
  const steps = g.steps.slice();
  steps[i] = merged;
  return touch(g, steps, now);
}

/** Move step `id` to position `to` (clamped). */
export function moveStep(g: Guide, id: string, to: number, now?: string): Guide {
  const from = indexOfStep(g, id);
  if (from < 0) return g;
  const target = Math.max(0, Math.min(g.steps.length - 1, to));
  if (target === from) return g;
  const steps = g.steps.slice();
  const [s] = steps.splice(from, 1);
  steps.splice(target, 0, s!);
  return touch(g, steps, now);
}

export function moveStepBy(g: Guide, id: string, delta: number, now?: string): Guide {
  const i = indexOfStep(g, id);
  return i < 0 ? g : moveStep(g, id, i + delta, now);
}

export function deleteStep(g: Guide, id: string, now?: string): Guide {
  if (indexOfStep(g, id) < 0) return g;
  return touch(g, g.steps.filter((s) => s.id !== id), now);
}

export function updateStep(g: Guide, id: string, patch: Partial<Step>, now?: string): Guide {
  const i = indexOfStep(g, id);
  if (i < 0) return g;
  const steps = g.steps.slice();
  const next = { ...steps[i]!, ...patch };
  if (patch.title !== undefined && patch.title !== steps[i]!.title) next.titleEdited = true;
  steps[i] = next;
  return touch(g, steps, now);
}

export function toggleSkip(g: Guide, id: string, now?: string): Guide {
  const s = g.steps[indexOfStep(g, id)];
  return s ? updateStep(g, id, { skipped: !s.skipped }, now) : g;
}

/** Insert a human-only note step after `afterId` (or at the start when afterId is null). */
export function addNote(g: Guide, afterId: string | null, opts: { id?: string; title?: string; now?: string } = {}): Guide {
  const now = opts.now ?? localIso();
  const at = afterId === null ? 0 : indexOfStep(g, afterId) + 1;
  const prev = g.steps[Math.max(0, at - 1)];
  const note: Step = {
    id: opts.id ?? newId("n"),
    action: { type: "note" },
    title: opts.title ?? "Note",
    titleEdited: true,
    description: "",
    page: prev ? { url: prev.page.url, title: prev.page.title } : { url: "" },
    timestamp: now,
  };
  const steps = g.steps.slice();
  steps.splice(Math.max(0, at), 0, note);
  return touch(g, steps, now);
}

/**
 * Merge step `id` with the step after it: keep the first step's screenshot and action,
 * join the descriptions. Useful when a recording split one idea into two steps.
 */
export function mergeWithNext(g: Guide, id: string, now?: string): Guide {
  const i = indexOfStep(g, id);
  const a = g.steps[i];
  const b = g.steps[i + 1];
  if (!a || !b) return g;
  const parts = [a.description, b.title, b.description].filter((x): x is string => !!x && x.trim() !== "");
  const merged: Step = { ...a, description: parts.join("\n\n") };
  const steps = g.steps.slice();
  steps.splice(i, 2, merged);
  return touch(g, steps, now);
}

function withScreenshot(g: Guide, id: string, fn: (sh: NonNullable<Step["screenshot"]>) => NonNullable<Step["screenshot"]>, now?: string): Guide {
  const s = g.steps[indexOfStep(g, id)];
  if (!s?.screenshot) return g;
  return updateStep(g, id, { screenshot: fn(s.screenshot) }, now);
}

export function setHighlight(g: Guide, id: string, rect: Rect | undefined, now?: string): Guide {
  return withScreenshot(g, id, (sh) => {
    const next = { ...sh };
    if (rect) next.highlight = rect;
    else delete next.highlight;
    return next;
  }, now);
}

export function addRedaction(g: Guide, id: string, r: Redaction, now?: string): Guide {
  return withScreenshot(g, id, (sh) => ({ ...sh, redactions: [...(sh.redactions ?? []), r] }), now);
}

/** Drop the automatic (capture-time) redactions of a step: the person decided they are not secret. */
export function removeAutoRedactions(g: Guide, id: string, now?: string): Guide {
  return withScreenshot(g, id, (sh) => {
    const keep = (sh.redactions ?? []).filter((r) => !r.auto);
    const next = { ...sh };
    if (keep.length) next.redactions = keep;
    else delete next.redactions;
    return next;
  }, now);
}

export function removeRedaction(g: Guide, id: string, index: number, now?: string): Guide {
  return withScreenshot(g, id, (sh) => ({ ...sh, redactions: (sh.redactions ?? []).filter((_, i) => i !== index) }), now);
}

export function setCrop(g: Guide, id: string, crop: Rect | undefined, now?: string): Guide {
  return withScreenshot(g, id, (sh) => {
    const next = { ...sh };
    if (crop) next.crop = crop;
    else delete next.crop;
    return next;
  }, now);
}

/**
 * Merge an editor's local copy with the stored copy: keep local order and edits, append
 * steps the recorder added meanwhile, and honour local deletions.
 */
export function mergeRemote(local: Guide, remote: Guide, deletedIds: ReadonlySet<string>): Guide {
  const known = new Set(local.steps.map((s) => s.id));
  const added = remote.steps.filter((s) => !known.has(s.id) && !deletedIds.has(s.id));
  if (!added.length) return local;
  return { ...local, steps: [...local.steps, ...added], updatedAt: remote.updatedAt > local.updatedAt ? remote.updatedAt : local.updatedAt };
}

/** Steps shown in exports, numbered from 1. */
export function visibleSteps(g: Guide): Step[] {
  return g.steps.filter((s) => !s.skipped);
}

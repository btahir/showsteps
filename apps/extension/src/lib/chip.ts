// Text of the auto-redaction chip under a step (SPEC §4): "Password blurred · Undo", or, when the
// unredacted original is no longer in memory, "Blurred at capture for safety" without Undo.
import type { Step } from "@stepsnap/core";
import { KIND_LABEL } from "./text-patterns";
import type { SecretKind } from "./text-patterns";

export interface ImageFacts {
  kinds?: string[];
  review?: boolean;
}

export interface RedactionChip {
  text: string;
  /** Undo is possible (the original is held in memory by this editor). */
  canUndo: boolean;
  /** Why there is no Undo. */
  note?: string;
}

export function redactionChip(step: Step, facts: ImageFacts | undefined, hasOriginal: boolean): RedactionChip | undefined {
  const auto = step.screenshot?.redactions?.filter((r) => r.auto) ?? [];
  if (!auto.length) return undefined;
  // What was covered, from the labels stored at capture (review #26), then older fallbacks.
  const labels: string[] = [];
  const add = (l: string | undefined) => {
    const t = l?.trim();
    if (t && !labels.some((x) => x.toLowerCase() === t.toLowerCase())) labels.push(t);
  };
  for (const r of auto) add(r.label);
  if (!labels.length) {
    if (step.target?.sensitive) add(step.target.label ?? step.target.name);
    for (const k of facts?.kinds ?? []) add(KIND_LABEL[k as SecretKind]);
  }
  let text: string;
  if (labels.length === 1) text = `${labels[0]} blurred`;
  else if (labels.length > 1) text = `${labels[0]} and ${labels.length - 1} more blurred`;
  else text = auto.length === 1 ? "Sensitive field blurred" : `${auto.length} sensitive fields blurred`;
  return hasOriginal ? { text, canUndo: true } : { text, canUndo: false, note: "Blurred at capture for safety" };
}

/** A capture whose redaction scan did not finish gets a "check it" chip (fail closed, not silent). */
export function reviewChip(facts: ImageFacts | undefined): string | undefined {
  return facts?.review ? "Check the blur on this step: part of the page could not be scanned in time." : undefined;
}

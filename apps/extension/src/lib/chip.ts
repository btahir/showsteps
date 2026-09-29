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
  const labels: string[] = [];
  const field = step.target?.sensitive ? (step.target.label ?? step.target.name) : undefined;
  if (field) labels.push(field);
  for (const k of facts?.kinds ?? []) {
    const l = KIND_LABEL[k as SecretKind];
    if (l && !labels.includes(l)) labels.push(l);
  }
  let text: string;
  if (labels.length === 1) text = `${labels[0]} blurred`;
  else if (labels.length === 2) text = `${labels[0]} and ${labels[1]!.toLowerCase()} blurred`;
  else if (labels.length > 2) text = `${auto.length} sensitive areas blurred`;
  else text = auto.length === 1 ? "Sensitive field blurred" : `${auto.length} sensitive fields blurred`;
  return hasOriginal ? { text, canUndo: true } : { text, canUndo: false, note: "Blurred at capture for safety" };
}

/** A capture whose redaction scan did not finish gets a "check it" chip (fail closed, not silent). */
export function reviewChip(facts: ImageFacts | undefined): string | undefined {
  return facts?.review ? "Check the blur on this step: part of the page could not be scanned in time." : undefined;
}

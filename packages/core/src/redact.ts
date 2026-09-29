import type { Guide, Redaction, Step } from "./schema";
import { clampRect, expandRect, isEmptyRect, rectContains, roundRectOut } from "./geometry";
import { isSensitiveStep } from "./titles";

export interface AutoRedactOptions {
  /** Default "blur". */
  style?: Redaction["style"];
  /** Extra margin around the field in image pixels. Default: 2 CSS px at the screenshot's devicePixelRatio. */
  pad?: number;
}

/**
 * Redactions Showsteps adds on its own: a sensitive target (password, card, OTP, SSN-like, or
 * user-marked) gets its highlight box covered. Returns `[]` when the step is not sensitive, has no
 * screenshot or highlight, or already has a redaction covering that area, so it is safe to call again.
 */
export function autoRedactions(step: Step, opts: AutoRedactOptions = {}): Redaction[] {
  const shot = step.screenshot;
  if (!shot?.highlight || !isSensitiveStep(step)) return [];
  const pad = opts.pad ?? Math.round(2 * (shot.devicePixelRatio > 0 ? shot.devicePixelRatio : 1));
  const rect = clampRect(roundRectOut(expandRect(shot.highlight, pad)), { width: shot.width, height: shot.height });
  if (isEmptyRect(rect)) return [];
  if ((shot.redactions ?? []).some((r) => rectContains(r.rect, rect))) return [];
  return [{ rect, style: opts.style ?? "blur", auto: true }];
}

/** Guide copy with `autoRedactions` added to every step that needs them (style from `guide.settings.redactStyle`). */
export function applyAutoRedactions(guide: Guide, opts: AutoRedactOptions = {}): Guide {
  const style = opts.style ?? guide.settings?.redactStyle ?? "blur";
  let changed = false;
  const steps = guide.steps.map((s) => {
    const add = autoRedactions(s, { ...opts, style });
    if (!add.length || !s.screenshot) return s;
    changed = true;
    return { ...s, screenshot: { ...s.screenshot, redactions: [...(s.screenshot.redactions ?? []), ...add] } };
  });
  return changed ? { ...guide, steps } : guide;
}

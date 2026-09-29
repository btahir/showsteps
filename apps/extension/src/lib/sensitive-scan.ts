// Finds every sensitive field on screen so its pixels are redacted automatically: walks the
// document, open *and closed* shadow roots (content scripts can open closed ones through
// chrome.dom.openOrClosedShadowRoot) and same-origin iframes. Cross-origin iframes cannot be
// inspected, so frames that look like payment, card, password or sign-in widgets are
// redacted whole.

import type { Rect } from "@stepsnap/core";

export const FIELD_SELECTOR =
  'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"]';

const SENSITIVE_FRAME =
  /card|payment|\bpay\b|paypal|checkout|cvc|cvv|security.?code|secure|iban|stripe|braintree|adyen|3ds|otp|one.?time|password|passcode|login|sign.?in|auth/i;

export interface ScanDeps {
  isSensitive(el: Element): boolean;
  rectOf(el: Element): Rect;
  viewport: { width: number; height: number };
  /** Returns the shadow root of `el`, open or closed, if any. */
  shadowRootOf?(el: Element): ShadowRoot | null;
  maxResults?: number;
  maxElements?: number;
  /**
   * Cross-origin frames found during the scan. When given, they are collected here (so the
   * caller can ask the recorder inside them) instead of being judged by their attributes.
   */
  opaqueFrames?: Element[];
}

type Root = Document | ShadowRoot;

function onScreen(r: Rect, vp: { width: number; height: number }): boolean {
  return r.width > 0 && r.height > 0 && r.x + r.width > 0 && r.y + r.height > 0 && r.x < vp.width && r.y < vp.height;
}

/** True for a cross-origin frame whose attributes suggest it holds secrets. */
export function frameLooksSensitive(frame: Element): boolean {
  const attrs = ["src", "name", "title", "id", "aria-label", "class", "allow"]
    .map((a) => frame.getAttribute(a) ?? "")
    .join(" ");
  return SENSITIVE_FRAME.test(attrs);
}

function frameDocument(frame: Element): Document | null {
  try {
    return (frame as HTMLIFrameElement).contentDocument ?? null;
  } catch {
    return null;
  }
}

export interface LabeledRect {
  rect: Rect;
  /** What the field is called ("Password", "Card number"), for the editor's "… blurred" chip. */
  label?: string;
}

const tidy = (s: string | null | undefined): string | undefined => {
  const t = (s ?? "").replace(/\s+/g, " ").replace(/[\s:*]+$/, "").trim();
  return t ? (t.length > 40 ? t.slice(0, 39) + "…" : t) : undefined;
};

/** A short human name for a sensitive field: its label, else what its type or autocomplete says it holds. */
export function fieldLabel(el: Element): string | undefined {
  const aria = tidy(el.getAttribute("aria-label"));
  if (aria) return aria;
  const labelledBy = el.getAttribute("aria-labelledby");
  if (labelledBy) {
    const t = tidy(labelledBy.split(/\s+/).map((id) => el.ownerDocument.getElementById(id)?.textContent ?? "").join(" "));
    if (t) return t;
  }
  const labels = (el as HTMLInputElement).labels;
  if (labels?.length) {
    const t = tidy(labels[0]!.textContent);
    if (t) return t;
  }
  const ac = (el.getAttribute("autocomplete") ?? "").toLowerCase();
  const byAc: Record<string, string> = {
    "cc-number": "Card number",
    "cc-csc": "Security code",
    "cc-exp": "Expiry date",
    "one-time-code": "One-time code",
    "current-password": "Password",
    "new-password": "New password",
  };
  for (const [k, v] of Object.entries(byAc)) if (ac.includes(k)) return v;
  if ((el.getAttribute("type") ?? "").toLowerCase() === "password") return "Password";
  return tidy(el.getAttribute("placeholder"));
}

export function scanSensitive(doc: Document, deps: ScanDeps): Rect[] {
  return scanSensitiveLabeled(doc, deps).map((r) => r.rect);
}

export function scanSensitiveLabeled(doc: Document, deps: ScanDeps): LabeledRect[] {
  const out: LabeledRect[] = [];
  const max = deps.maxResults ?? 60;
  const maxEls = deps.maxElements ?? 25_000;
  const roots: Root[] = [doc];
  const seen = new Set<Root>();
  let visited = 0;
  const shadowOf = deps.shadowRootOf ?? ((el: Element) => el.shadowRoot);

  const push = (el: Element, label?: string) => {
    try {
      const r = deps.rectOf(el);
      if (onScreen(r, deps.viewport)) out.push({ rect: r, label });
    } catch {
      /* detached */
    }
  };

  while (roots.length && visited < maxEls) {
    const root = roots.shift()!;
    if (seen.has(root)) continue;
    seen.add(root);

    for (const el of Array.from(root.querySelectorAll(FIELD_SELECTOR))) {
      if (out.length >= max) break;
      try {
        if (deps.isSensitive(el)) push(el, fieldLabel(el));
      } catch {
        /* ignore odd elements */
      }
    }

    for (const el of Array.from(root.querySelectorAll("*"))) {
      if (++visited > maxEls) break;
      const sr = shadowOf(el);
      if (sr) roots.push(sr);
      const tag = el.localName;
      if (tag === "iframe" || tag === "frame") {
        const d = frameDocument(el);
        if (d) roots.push(d);
        else if (deps.opaqueFrames) deps.opaqueFrames.push(el);
        else if (frameLooksSensitive(el)) push(el, "Payment or sign-in frame");
      }
    }
  }
  return out.slice(0, max);
}

/** Same-origin frame documents reachable from `doc` (for attaching event listeners). */
export function sameOriginFrames(doc: Document, shadowRootOf?: (el: Element) => ShadowRoot | null): Document[] {
  const out: Document[] = [];
  const roots: Root[] = [doc];
  const seen = new Set<Root>();
  const shadowOf = shadowRootOf ?? ((el: Element) => el.shadowRoot);
  let guard = 0;
  while (roots.length && guard++ < 200) {
    const root = roots.shift()!;
    if (seen.has(root)) continue;
    seen.add(root);
    for (const el of Array.from(root.querySelectorAll("iframe, frame"))) {
      const d = frameDocument(el);
      if (d) {
        out.push(d);
        roots.push(d);
      }
    }
    // Frames inside shadow roots are rare; only look one level into hosts that have them.
    for (const el of Array.from(root.querySelectorAll("*"))) {
      const sr = shadowOf(el);
      if (sr && sr.querySelector("iframe, frame")) roots.push(sr);
    }
  }
  return out;
}

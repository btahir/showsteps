// Page-wide scan for sensitive elements, for auto-redaction of everything on screen (not only the click
// target). Walks open shadow roots and same-origin iframes; cross-origin frames are opaque here, so their
// own content script must run this in-frame (use `rectOf(el, { topLevel: false })` there and offset by the
// frame's rect in the parent).
import { isHidden, labelText } from "./aria";
import { pageMetrics, rectOf, type CssRect } from "./geometry";
import { isSensitive, LEGACY_SENSITIVE_ATTR, SENSITIVE_ATTR } from "./sensitive";
import { isElement, type RootNode } from "./util";

const CANDIDATES = [
  "input", "textarea", "select", "iframe", "frame", "[contenteditable]", '[role="textbox"]', '[role="searchbox"]',
  '[role="spinbutton"]', '[role="combobox"]', `[${SENSITIVE_ATTR}]`, `[${LEGACY_SENSITIVE_ATTR}]`,
].join(",");

export interface FindSensitiveOptions {
  /**
   * How to get an element's shadow root. Default: `el.shadowRoot`, which is null for closed roots, so
   * closed roots are invisible to this package. A content script passes `chrome.dom.openOrClosedShadowRoot`
   * here (the extension's own walk does exactly that) to cover them.
   */
  shadowRootOf?: (el: Element) => ShadowRoot | null;
}

/** All sensitive elements under `root`, including inside open shadow roots and same-origin iframes. */
export function findSensitiveElements(root: RootNode = document, opts: FindSensitiveOptions = {}): Element[] {
  const shadowOf = opts.shadowRootOf ?? ((el: Element) => (el as Element & { shadowRoot: ShadowRoot | null }).shadowRoot);
  const out: Element[] = [];
  const seen = new Set<Element>();
  const visit = (r: RootNode, depth: number) => {
    if (depth > 12) return;
    for (const el of Array.from(r.querySelectorAll("*"))) {
      const sr = shadowOf(el);
      if (sr) visit(sr, depth + 1);
      if ((el.localName === "iframe" || el.localName === "frame") && depth < 12) {
        try {
          const d = (el as HTMLIFrameElement).contentDocument;
          if (d) visit(d, depth + 1);
        } catch {
          /* cross-origin */
        }
      }
      if (!el.matches(CANDIDATES) || seen.has(el)) continue;
      seen.add(el);
      if (isSensitive(el, { labelText: labelText(el) })) out.push(el);
    }
  };
  visit(root, 0);
  return out;
}

export interface SensitiveRectOptions extends FindSensitiveOptions {
  /** Clip to the top-level viewport and drop rects fully outside it (default true). */
  clip?: boolean;
  /** Pad each rect by this many CSS px (default 0). */
  pad?: number;
}

/** Top-level-viewport CSS-px rects of the visible sensitive elements. */
export function sensitiveRects(root: RootNode = document, opts: SensitiveRectOptions = {}): CssRect[] {
  const { clip = true, pad = 0 } = opts;
  const vp = pageMetrics().viewport;
  const rects: CssRect[] = [];
  for (const el of findSensitiveElements(root, { shadowRootOf: opts.shadowRootOf })) {
    if (!isElement(el) || isHidden(el, true)) continue;
    const r = rectOf(el);
    if (r.width <= 0 || r.height <= 0) continue;
    let x0 = r.x - pad, y0 = r.y - pad, x1 = r.x + r.width + pad, y1 = r.y + r.height + pad;
    if (clip) {
      x0 = Math.max(0, x0); y0 = Math.max(0, y0);
      x1 = Math.min(vp.width, x1); y1 = Math.min(vp.height, y1);
      if (x1 <= x0 || y1 <= y0) continue;
    }
    rects.push({ x: Math.round(x0 * 100) / 100, y: Math.round(y0 * 100) / 100, width: Math.round((x1 - x0) * 100) / 100, height: Math.round((y1 - y0) * 100) / 100 });
  }
  return rects;
}

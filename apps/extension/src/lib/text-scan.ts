// Finds secrets shown as text on screen (card numbers, SSNs, IBANs, tokens, optionally emails)
// and returns their rectangles in this frame's viewport CSS px. Walks the document, open and
// closed shadow roots and same-origin iframes in one pass, only measures text that passed the
// cheap pre-filter, and stops at a time budget (the result is then marked incomplete so the
// editor asks for a review instead of silently passing an unscanned frame).
//
// Values of ordinary text inputs are checked too (a card number pasted into a notes field):
// the whole field is blurred. Values never leave the page, only rectangles do.

import type { Rect } from "@stepsnap/core";
import { findSecrets, KIND_LABEL, mightContainSecret } from "./text-patterns";
import type { PatternOptions, SecretKind } from "./text-patterns";

export interface TextScanOptions extends PatternOptions {
  viewport: { width: number; height: number };
  shadowRootOf?(el: Element): ShadowRoot | null;
  /** Milliseconds before giving up (default 40). */
  budgetMs?: number;
  now?(): number;
  maxRects?: number;
}

export interface TextScanResult {
  rects: Rect[];
  /** Parallel to `rects`: what each one hides ("Card number"). */
  labels: string[];
  kinds: SecretKind[];
  incomplete: boolean;
}

const SKIP = new Set(["script", "style", "noscript", "template", "title", "textarea", "option", "svg", "math"]);
const VALUE_INPUT_TYPES = new Set(["", "text", "search", "url", "tel", "email", "number"]);

type Root = Document | ShadowRoot;

function frameDoc(el: Element): Document | null {
  try {
    return (el as HTMLIFrameElement).contentDocument ?? null;
  } catch {
    return null;
  }
}

/** Offset of a same-origin frame's viewport inside the scanning document's viewport. */
function frameOffset(frame: Element, parent: { x: number; y: number }): { x: number; y: number } {
  const r = frame.getBoundingClientRect();
  let bl = 0;
  let bt = 0;
  try {
    const cs = frame.ownerDocument.defaultView!.getComputedStyle(frame);
    bl = (parseFloat(cs.borderLeftWidth) || 0) + (parseFloat(cs.paddingLeft) || 0);
    bt = (parseFloat(cs.borderTopWidth) || 0) + (parseFloat(cs.paddingTop) || 0);
  } catch {
    /* detached */
  }
  return { x: parent.x + r.x + bl, y: parent.y + r.y + bt };
}

function onScreen(r: { x: number; y: number; width: number; height: number }, vp: { width: number; height: number }): boolean {
  return r.width > 0 && r.height > 0 && r.x < vp.width && r.y < vp.height && r.x + r.width > 0 && r.y + r.height > 0;
}

export function scanTextSecrets(doc: Document, opts: TextScanOptions): TextScanResult {
  const now = opts.now ?? (() => performance.now());
  const deadline = now() + (opts.budgetMs ?? 40);
  const maxRects = opts.maxRects ?? 80;
  const shadowOf = opts.shadowRootOf ?? ((el: Element) => el.shadowRoot);
  const vp = opts.viewport;
  const rects: Rect[] = [];
  const labels: string[] = [];
  const kinds = new Set<SecretKind>();
  const queue: { root: Root; off: { x: number; y: number } }[] = [{ root: doc, off: { x: 0, y: 0 } }];
  const seen = new Set<Root>();
  let incomplete = false;
  let n = 0;

  const push = (r: DOMRect | Rect, off: { x: number; y: number }, kind: SecretKind) => {
    const box = { x: r.x + off.x, y: r.y + off.y, width: r.width, height: r.height };
    if (onScreen(box, vp) && rects.length < maxRects) {
      rects.push(box);
      labels.push(KIND_LABEL[kind]);
    }
  };

  outer: while (queue.length) {
    const { root, off } = queue.shift()!;
    if (seen.has(root)) continue;
    seen.add(root);
    const ownerDoc = root.nodeType === 9 ? (root as Document) : root.ownerDocument!;
    const walker = ownerDoc.createTreeWalker(root, 0x1 | 0x4 /* SHOW_ELEMENT | SHOW_TEXT */, {
      acceptNode(node) {
        // Skip script/style subtrees entirely (FILTER_REJECT), keep walking everything else.
        return node.nodeType === 1 && SKIP.has((node as Element).localName) ? 2 : 1;
      },
    });
    let range: Range | undefined;
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if ((++n & 127) === 0 && now() > deadline) {
        incomplete = true;
        break outer;
      }
      if (node.nodeType === 1) {
        const el = node as Element;
        const sr = shadowOf(el);
        if (sr) queue.push({ root: sr, off });
        const tag = el.localName;
        if (tag === "iframe" || tag === "frame") {
          const d = frameDoc(el);
          if (d) queue.push({ root: d, off: frameOffset(el, off) });
        } else if (tag === "input" && VALUE_INPUT_TYPES.has(((el as HTMLInputElement).type ?? "").toLowerCase())) {
          checkValue(el, (el as HTMLInputElement).value);
        }
        continue;
      }
      const text = node.nodeValue ?? "";
      if (!mightContainSecret(text, opts)) continue;
      const matches = findSecrets(text, opts);
      if (!matches.length) continue;
      const parent = node.parentElement;
      if (parent) {
        // Parent box off screen: nothing of it is in the screenshot.
        const pr = parent.getBoundingClientRect();
        if ((pr.width || pr.height) && !onScreen({ x: pr.x + off.x, y: pr.y + off.y, width: pr.width, height: pr.height }, vp)) continue;
      }
      range ??= ownerDoc.createRange();
      for (const m of matches) {
        try {
          range.setStart(node, m.start);
          range.setEnd(node, m.end);
          const boxes = Array.from(range.getClientRects());
          if (boxes.length) kinds.add(m.kind);
          for (const b of boxes) push(b, off, m.kind);
        } catch {
          /* node changed under us */
        }
      }
    }
    // Text areas: their value is not a text node.
    for (const ta of Array.from(root.querySelectorAll("textarea"))) checkValue(ta, (ta as HTMLTextAreaElement).value);

    function checkValue(el: Element, value: string) {
      if (!value || !mightContainSecret(value, opts)) return;
      const found = findSecrets(value, opts);
      if (!found.length) return;
      for (const m of found) kinds.add(m.kind);
      push(el.getBoundingClientRect(), off, found[0]!.kind);
    }
  }
  return { rects, labels, kinds: [...kinds], incomplete };
}

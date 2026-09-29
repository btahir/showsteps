// Where the numbered tab of the highlight should grow from (design review #5b): at capture, the
// recorder measures how much page text each of the four candidate tab positions would cover and
// stores the corner with the least (`screenshot.highlight.corner`). Brand's tabCorner() uses it,
// and its edge rules still keep the tab inside the image.
import type { Rect, TabCorner } from "@stepsnap/core";
import { highlight as flag, minRingBox } from "@stepsnap/brand";

/** The four places the tab could go, in the page's CSS px (the same geometry the export draws). */
export function tabCandidates(target: Rect, viewportWidth: number): Record<TabCorner, Rect> {
  // Export lengths are CSS px × highlightScale / dpr = clamp(viewport / 960, 1, 2) in page CSS px.
  const s = Math.min(2, Math.max(1, viewportWidth / 960));
  const pad = flag.pad * s;
  const th = flag.tab.height * s;
  const tw = Math.max(flag.tab.minWidth, 32) * s; // one or two digits
  const ring = minRingBox({ x: target.x - pad, y: target.y - pad, width: target.width + 2 * pad, height: target.height + 2 * pad }, tw, th, flag.radius * s, s);
  const right = ring.x + ring.width - tw;
  const bottom = ring.y + ring.height;
  return {
    "top-right": { x: right, y: ring.y - th, width: tw, height: th },
    "top-left": { x: ring.x, y: ring.y - th, width: tw, height: th },
    "bottom-right": { x: right, y: bottom, width: tw, height: th },
    "bottom-left": { x: ring.x, y: bottom, width: tw, height: th },
  };
}

function overlapArea(a: Rect, b: Rect): number {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

/**
 * The corner whose tab covers the least text. Returns undefined when the default corner (top-right,
 * top-left in RTL) covers none: the stored field is only written when it changes something.
 * Corners whose tab would leave the viewport are skipped (the drawing would flip them anyway).
 */
export function pickCorner(cands: Record<TabCorner, Rect>, text: Rect[], viewport: { width: number; height: number }, rtl = false): TabCorner | undefined {
  const order: TabCorner[] = rtl ? ["top-left", "bottom-left", "top-right", "bottom-right"] : ["top-right", "bottom-right", "top-left", "bottom-left"];
  const inside = (r: Rect) => r.x >= 0 && r.y >= 0 && r.x + r.width <= viewport.width && r.y + r.height <= viewport.height;
  const scored = order.filter((c) => inside(cands[c])).map((c) => ({ c, area: text.reduce((sum, t) => sum + overlapArea(cands[c], t), 0) }));
  if (!scored.length) return undefined;
  const def = scored.find((x) => x.c === order[0]);
  if (def && def.area === 0) return undefined;
  let best = scored[0]!;
  for (const x of scored) if (x.area < best.area) best = x;
  return best.c === order[0] ? undefined : best.c;
}

/** Text boxes (CSS px) of the page near `area`, found with elementsFromPoint on a small grid. */
export function textRectsNear(doc: Document, areas: Rect[], ignore?: (el: Element) => boolean): Rect[] {
  const seen = new Set<Element>();
  const out: Rect[] = [];
  const range = doc.createRange();
  for (const a of areas) {
    for (const fx of [0.15, 0.5, 0.85]) {
      for (const fy of [0.25, 0.75]) {
        let els: Element[] = [];
        try {
          els = doc.elementsFromPoint(a.x + a.width * fx, a.y + a.height * fy);
        } catch {
          continue;
        }
        for (const el of els.slice(0, 6)) {
          if (seen.has(el) || ignore?.(el)) continue;
          seen.add(el);
          for (const n of Array.from(el.childNodes)) {
            if (n.nodeType !== 3 || !n.nodeValue?.trim()) continue;
            range.selectNodeContents(n);
            for (const r of Array.from(range.getClientRects())) out.push({ x: r.x, y: r.y, width: r.width, height: r.height });
          }
        }
      }
    }
  }
  return out;
}

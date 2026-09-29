import { isElement, winOf } from "./util";

export interface CssRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PageMetrics {
  devicePixelRatio: number;
  viewport: { width: number; height: number; scrollX: number; scrollY: number };
}

const r2 = (n: number) => Math.round(n * 100) / 100;

function frameElementOf(win: Window): Element | null {
  try {
    return win.frameElement;
  } catch {
    return null;
  }
}

/**
 * Bounding box of `el` in CSS pixels, relative to the top-level viewport (what captureVisibleTab shows).
 * Same-origin iframe offsets are added up the frame chain; a cross-origin parent stops the walk
 * (the caller then gets frame-local coordinates). Pass `{ topLevel: false }` for frame-local coordinates.
 */
export function rectOf(el: Element, opts: { topLevel?: boolean } = {}): CssRect {
  const b = el.getBoundingClientRect();
  let x = b.left;
  let y = b.top;
  if (opts.topLevel !== false) {
    let win = winOf(el);
    for (let guard = 0; win && guard < 16; guard++) {
      const fe = frameElementOf(win);
      if (!isElement(fe)) break;
      const fr = fe.getBoundingClientRect();
      x += fr.left + (fe.clientLeft || 0);
      y += fr.top + (fe.clientTop || 0);
      win = winOf(fe);
    }
  }
  return { x: r2(x), y: r2(y), width: r2(b.width), height: r2(b.height) };
}

/** Viewport size, scroll and device pixel ratio of the top-level window when reachable, else `win`. */
export function pageMetrics(win: Window = window): PageMetrics {
  let w: Window = win;
  try {
    if (w.top && w.top.document) w = w.top;
  } catch {
    /* cross-origin top: stay in this frame */
  }
  return {
    devicePixelRatio: w.devicePixelRatio || 1,
    viewport: {
      width: w.innerWidth,
      height: w.innerHeight,
      scrollX: Math.round(w.scrollX ?? w.pageXOffset ?? 0),
      scrollY: Math.round(w.scrollY ?? w.pageYOffset ?? 0),
    },
  };
}

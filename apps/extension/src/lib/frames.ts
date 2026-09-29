// Cross-origin frame protocol for the recorder.
//
// The recorder runs in every frame, but only "root" frames record: the top frame, and any frame
// whose parent document it cannot read (a cross-origin frame). A root handles its same-origin
// descendants itself. Roots talk to each other with window.postMessage:
//   parent → child  { kind: "scan" }          child replies with its sensitive rects in its own
//                                             viewport space (children of its own included);
//                                             the parent offsets and clips them by the frame box.
//   child → parent  { kind: "offset" }        parent replies with the frame's content-box origin
//                                             in top-level CSS px (asking its own parent first)
//                                             plus the top-level page metrics, so steps recorded
//                                             inside the frame land in screenshot coordinates.
// Nothing secret crosses these messages (rects and metrics only). A page could forge replies;
// the worst it can do is add blur boxes or misplace a highlight.

import type { Rect } from "@showsteps/core";

export const TAG = "__showsteps";

export type FrameMsg =
  | { [TAG]: 1; kind: "scan"; id: string }
  | { [TAG]: 1; kind: "scan-reply"; id: string; rects: Rect[]; labels?: (string | null)[]; kinds?: string[]; incomplete?: boolean }
  | { [TAG]: 1; kind: "offset"; id: string }
  | { [TAG]: 1; kind: "offset-reply"; id: string; x: number; y: number; scaleX?: number; scaleY?: number; metrics?: unknown };

export function isFrameMsg(d: unknown): d is FrameMsg {
  return !!d && typeof d === "object" && (d as Record<string, unknown>)[TAG] === 1 && typeof (d as { id?: unknown }).id === "string";
}

/** A frame records on its own when it is the top frame or cannot see its parent's document. */
export function isRootFrame(win: Window = window): boolean {
  if (win.top === win) return true;
  try {
    return !win.parent.document;
  } catch {
    return true;
  }
}

/** A frame's content box in its parent's viewport, and the scale the parent draws it at. */
export interface FrameBox extends Rect {
  scaleX: number;
  scaleY: number;
}

/**
 * Content box of a frame element, given its border-box rect from getBoundingClientRect (which
 * includes CSS transforms). Borders and padding come from computed style, which is untransformed,
 * so they are multiplied by the frame's scale: `rect.width / offsetWidth` (0.5 for
 * `transform: scale(0.5)`, 1 otherwise).
 */
export function contentBox(frame: Element, border: Rect): FrameBox {
  let bl = 0;
  let bt = 0;
  let pl = 0;
  let pt = 0;
  let pr = 0;
  let pb = 0;
  let br = 0;
  let bb = 0;
  try {
    const cs = frame.ownerDocument.defaultView!.getComputedStyle(frame);
    bl = parseFloat(cs.borderLeftWidth) || 0;
    bt = parseFloat(cs.borderTopWidth) || 0;
    br = parseFloat(cs.borderRightWidth) || 0;
    bb = parseFloat(cs.borderBottomWidth) || 0;
    pl = parseFloat(cs.paddingLeft) || 0;
    pt = parseFloat(cs.paddingTop) || 0;
    pr = parseFloat(cs.paddingRight) || 0;
    pb = parseFloat(cs.paddingBottom) || 0;
  } catch {
    /* detached */
  }
  const ow = (frame as HTMLElement).offsetWidth;
  const oh = (frame as HTMLElement).offsetHeight;
  const scaleX = ow > 0 && border.width > 0 ? border.width / ow : 1;
  const scaleY = oh > 0 && border.height > 0 ? border.height / oh : 1;
  return frameBoxFrom(border, { bl, bt, br, bb, pl, pt, pr, pb }, scaleX, scaleY);
}

/** Pure part of contentBox (unit-tested): border rect minus scaled borders and padding. */
export function frameBoxFrom(
  border: Rect,
  e: { bl: number; bt: number; br: number; bb: number; pl: number; pt: number; pr: number; pb: number },
  scaleX = 1,
  scaleY = scaleX,
): FrameBox {
  return {
    x: border.x + (e.bl + e.pl) * scaleX,
    y: border.y + (e.bt + e.pt) * scaleY,
    width: Math.max(0, border.width - (e.bl + e.br + e.pl + e.pr) * scaleX),
    height: Math.max(0, border.height - (e.bt + e.bb + e.pt + e.pb) * scaleY),
    scaleX,
    scaleY,
  };
}

/** Map frame-local rects into the parent's space (scaled by the frame's transform) and clip them to the frame's box. */
export function offsetInto(rects: Rect[], box: Rect & { scaleX?: number; scaleY?: number }): Rect[] {
  const sx = box.scaleX ?? 1;
  const sy = box.scaleY ?? 1;
  const out: Rect[] = [];
  for (const r of rects) {
    const x1 = Math.max(box.x, box.x + r.x * sx);
    const y1 = Math.max(box.y, box.y + r.y * sy);
    const x2 = Math.min(box.x + box.width, box.x + (r.x + r.width) * sx);
    const y2 = Math.min(box.y + box.height, box.y + (r.y + r.height) * sy);
    if (x2 > x1 && y2 > y1) out.push({ x: x1, y: y1, width: x2 - x1, height: y2 - y1 });
  }
  return out;
}

let seq = 0;
export const msgId = () => `${Date.now().toString(36)}${(seq++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/**
 * Post `msg` to `target` and resolve with the first matching reply from that window, or
 * `undefined` after `timeoutMs`.
 */
export function ask<R extends FrameMsg>(target: Window, msg: FrameMsg, replyKind: R["kind"], timeoutMs: number): Promise<R | undefined> {
  return new Promise((resolve) => {
    const onMsg = (e: MessageEvent) => {
      if (e.source !== target || !isFrameMsg(e.data) || e.data.kind !== replyKind || e.data.id !== msg.id) return;
      done(e.data as R);
    };
    const timer = setTimeout(() => done(undefined), timeoutMs);
    function done(v: R | undefined) {
      clearTimeout(timer);
      window.removeEventListener("message", onMsg, true);
      resolve(v);
    }
    window.addEventListener("message", onMsg, true);
    try {
      target.postMessage(msg, "*");
    } catch {
      done(undefined);
    }
  });
}

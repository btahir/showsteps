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

import type { Rect } from "@stepsnap/core";

export const TAG = "__showsteps";

export type FrameMsg =
  | { [TAG]: 1; kind: "scan"; id: string }
  | { [TAG]: 1; kind: "scan-reply"; id: string; rects: Rect[] }
  | { [TAG]: 1; kind: "offset"; id: string }
  | { [TAG]: 1; kind: "offset-reply"; id: string; x: number; y: number; metrics?: unknown };

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

/** Content-box origin of a frame element, given its border-box rect. */
export function contentBox(frame: Element, border: Rect): Rect {
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
  return {
    x: border.x + bl + pl,
    y: border.y + bt + pt,
    width: Math.max(0, border.width - bl - br - pl - pr),
    height: Math.max(0, border.height - bt - bb - pt - pb),
  };
}

/** Shift frame-local rects into the parent's space and clip them to the frame's box. */
export function offsetInto(rects: Rect[], box: Rect): Rect[] {
  const out: Rect[] = [];
  for (const r of rects) {
    const x1 = Math.max(box.x, box.x + r.x);
    const y1 = Math.max(box.y, box.y + r.y);
    const x2 = Math.min(box.x + box.width, box.x + r.x + r.width);
    const y2 = Math.min(box.y + box.height, box.y + r.y + r.height);
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

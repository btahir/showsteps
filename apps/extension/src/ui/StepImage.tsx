// Live preview of a step screenshot with its highlight, redactions and crop drawn as overlays
// (the real pixels are only rewritten at export). In "blur" or "crop" mode the user drags a
// rectangle on the image; the result is reported in image pixels.
import { useRef, useState } from "react";
import type { PointerEvent as RPointerEvent } from "react";
import type { Rect, Step } from "@stepsnap/core";
import { displayRectToImage } from "../lib/rect";

export type DrawMode = "none" | "blur" | "crop";

interface Props {
  step: Step;
  src: string | undefined;
  number?: number;
  mode?: DrawMode;
  onDraw?: (rect: Rect, mode: Exclude<DrawMode, "none">) => void;
  showHighlight?: boolean;
  compact?: boolean;
  alt: string;
}

const pct = (v: number, of: number) => `${(v / of) * 100}%`;

function boxStyle(r: Rect, w: number, h: number) {
  return { left: pct(r.x, w), top: pct(r.y, h), width: pct(r.width, w), height: pct(r.height, h) };
}

export function StepImage({ step, src, number, mode = "none", onDraw, showHighlight = true, compact, alt }: Props) {
  const sh = step.screenshot;
  const wrap = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);

  if (!sh) {
    return (
      <div className={`shot shot-empty${compact ? " shot-compact" : ""}`} role="img" aria-label={alt}>
        <span>{step.action.type === "note" ? "Note" : "No screenshot"}</span>
      </div>
    );
  }
  const W = sh.width;
  const H = sh.height;

  const local = (e: RPointerEvent) => {
    const b = wrap.current!.getBoundingClientRect();
    return { x: Math.min(Math.max(0, e.clientX - b.left), b.width), y: Math.min(Math.max(0, e.clientY - b.top), b.height) };
  };

  const drawing = mode !== "none";
  const onDown = (e: RPointerEvent) => {
    if (!drawing) return;
    e.preventDefault();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    const p = local(e);
    setDrag({ x0: p.x, y0: p.y, x1: p.x, y1: p.y });
  };
  const onMove = (e: RPointerEvent) => {
    if (!drag) return;
    const p = local(e);
    setDrag({ ...drag, x1: p.x, y1: p.y });
  };
  const onUp = () => {
    if (!drag || !wrap.current) return;
    const dw = wrap.current.getBoundingClientRect().width;
    const r = displayRectToImage({ x: drag.x0, y: drag.y0, width: drag.x1 - drag.x0, height: drag.y1 - drag.y0 }, dw, { width: W, height: H });
    setDrag(null);
    if (r && r.width >= 4 && r.height >= 4 && mode !== "none") onDraw?.(r, mode);
  };

  const dragRect = drag && {
    left: Math.min(drag.x0, drag.x1),
    top: Math.min(drag.y0, drag.y1),
    width: Math.abs(drag.x1 - drag.x0),
    height: Math.abs(drag.y1 - drag.y0),
  };

  return (
    <div
      ref={wrap}
      className={`shot${compact ? " shot-compact" : ""}${drawing ? ` shot-drawing shot-${mode}` : ""}`}
      style={{ aspectRatio: `${W} / ${H}` }}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={() => setDrag(null)}
    >
      {src ? <img src={src} alt={alt} draggable={false} /> : <div className="shot-loading" aria-label={alt} role="img" />}
      {(sh.redactions ?? []).map((r, i) => (
        <div key={i} className={`shot-redact shot-redact-${r.style}`} style={boxStyle(r.rect, W, H)} aria-hidden />
      ))}
      {showHighlight && sh.highlight && (
        <div className="shot-hl" style={boxStyle(sh.highlight, W, H)} aria-hidden>
          {number !== undefined && <span className="shot-marker">{number}</span>}
        </div>
      )}
      {sh.crop && (
        <div className="shot-crop" style={boxStyle(sh.crop, W, H)} aria-hidden />
      )}
      {dragRect && <div className={`shot-drag shot-drag-${mode}`} style={dragRect} aria-hidden />}
    </div>
  );
}

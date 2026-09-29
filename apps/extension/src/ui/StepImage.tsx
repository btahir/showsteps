// Live preview of a step screenshot. The flag highlight is drawn with the brand's own
// drawFlagHighlight on a canvas over the image (same geometry as exports); manual redactions and
// the crop are overlays (real pixels are only rewritten at export; auto redactions are already
// burnt into the stored image). In "blur" or "crop" mode the user drags a rectangle on the image.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { PointerEvent as RPointerEvent } from "react";
import type { Rect, Step } from "@stepsnap/core";
import { drawFlagHighlight, highlight as flag, highlightScale } from "@stepsnap/brand";
import { displayRectToImage } from "../lib/rect";

export type DrawMode = "none" | "blur" | "crop";

interface Props {
  step: Step;
  src: string | undefined;
  number?: number;
  mode?: DrawMode;
  onDraw?: (rect: Rect, mode: Exclude<DrawMode, "none">) => void;
  showRedactionOutlines?: boolean;
  /** "thumb": fixed-size flag for small previews (side panel); "large": export proportions. */
  size?: "thumb" | "large";
  color?: string;
  alt: string;
}

const pct = (v: number, of: number) => `${(v / of) * 100}%`;
const boxStyle = (r: Rect, w: number, h: number) => ({ left: pct(r.x, w), top: pct(r.y, h), width: pct(r.width, w), height: pct(r.height, h) });

function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [w, setW] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setW(el.getBoundingClientRect().width);
    const ro = new ResizeObserver(([e]) => setW(e!.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

export function StepImage({ step, src, number, mode = "none", onDraw, showRedactionOutlines, size = "thumb", color, alt }: Props) {
  const sh = step.screenshot;
  const [wrap, width] = useWidth<HTMLDivElement>();
  const canvas = useRef<HTMLCanvasElement>(null);
  const [drag, setDrag] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const [fontsReady, setFontsReady] = useState(false);

  useEffect(() => {
    void document.fonts?.load('750 16px "Rethink Sans"').finally(() => setFontsReady(true));
  }, []);

  // Draw the flag at display resolution.
  useEffect(() => {
    const c = canvas.current;
    if (!c || !sh || !width) return;
    const dpr = window.devicePixelRatio || 1;
    const view = sh.crop ?? { x: 0, y: 0, width: sh.width, height: sh.height };
    const cssH = (width * view.height) / view.width;
    c.width = Math.round(width * dpr);
    c.height = Math.round(cssH * dpr);
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, c.width, c.height);
    if (!sh.highlight) return;
    const s = c.width / view.width;
    const target = { x: (sh.highlight.x - view.x) * s, y: (sh.highlight.y - view.y) * s, width: sh.highlight.width * s, height: sh.highlight.height * s };
    const thumbScale = (2.5 / flag.ringWidth) * dpr;
    const exportScale = highlightScale(sh.viewport.width, sh.width / Math.max(1, sh.viewport.width)) * s;
    drawFlagHighlight(ctx as unknown as Parameters<typeof drawFlagHighlight>[0], {
      target,
      n: number ?? "",
      imageWidth: c.width,
      imageHeight: c.height,
      scale: size === "thumb" ? thumbScale : Math.max(thumbScale, exportScale),
      color: color ?? flag.color,
      dim: size === "thumb" ? flag.spotlightDimThumb : flag.spotlightDim,
    });
  }, [sh, width, number, size, color, fontsReady]);

  if (!sh) {
    return (
      <div className="shot shot-empty" role="img" aria-label={alt}>
        <span>{step.action.type === "note" ? "Note" : "No screenshot for this step"}</span>
      </div>
    );
  }

  const view = mode === "crop" ? { x: 0, y: 0, width: sh.width, height: sh.height } : sh.crop ?? { x: 0, y: 0, width: sh.width, height: sh.height };
  const drawing = mode !== "none";

  const local = (e: RPointerEvent) => {
    const b = wrap.current!.getBoundingClientRect();
    return { x: Math.min(Math.max(0, e.clientX - b.left), b.width), y: Math.min(Math.max(0, e.clientY - b.top), b.height) };
  };
  const onDown = (e: RPointerEvent) => {
    if (!drawing) return;
    e.preventDefault();
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
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
    const local = displayRectToImage({ x: drag.x0, y: drag.y0, width: drag.x1 - drag.x0, height: drag.y1 - drag.y0 }, dw, { width: view.width, height: view.height });
    setDrag(null);
    if (local && local.width >= 4 && local.height >= 4 && mode !== "none") onDraw?.({ ...local, x: local.x + view.x, y: local.y + view.y }, mode);
  };

  const dragRect = drag && {
    left: Math.min(drag.x0, drag.x1),
    top: Math.min(drag.y0, drag.y1),
    width: Math.abs(drag.x1 - drag.x0),
    height: Math.abs(drag.y1 - drag.y0),
  };
  // Image positioned so that `view` fills the frame.
  const imgStyle = {
    width: pct(sh.width, view.width),
    left: pct(-view.x, view.width),
    top: pct(-view.y, view.height),
  };
  const inView = (r: Rect) => boxStyle({ ...r, x: r.x - view.x, y: r.y - view.y }, view.width, view.height);

  return (
    <div
      ref={wrap}
      className={`shot shot-${size}${drawing ? ` shot-drawing shot-${mode}` : ""}`}
      style={{ aspectRatio: `${view.width} / ${view.height}` }}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={() => setDrag(null)}
    >
      {src ? <img src={src} alt={alt} draggable={false} style={imgStyle} /> : <div className="shot-loading" role="img" aria-label={alt} />}
      {(sh.redactions ?? []).map((r, i) =>
        r.auto && !showRedactionOutlines ? null : (
          <div key={i} className={`shot-redact${r.auto ? " shot-redact-auto" : ` shot-redact-${r.style}`}`} style={inView(r.rect)} aria-hidden />
        ),
      )}
      {mode !== "crop" && <canvas ref={canvas} className="shot-flag" aria-hidden />}
      {mode === "crop" && sh.crop && <div className="shot-crop" style={inView(sh.crop)} aria-hidden />}
      {dragRect && <div className={`shot-drag shot-drag-${mode}`} style={dragRect} aria-hidden />}
    </div>
  );
}

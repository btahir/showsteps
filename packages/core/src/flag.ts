// Geometry of the Showsteps "Flag" highlight (spotlight dim, keyline ring, numbered tab), shared by
// the pixel renderer (raster.ts) and the vector renderers (PDF). Same numbers as packages/brand/tokens.ts.

import { FLAG } from "./geometry";
import type { Rect, TabCorner } from "./schema";

export interface FlagLayout {
  /** The ring's centre line: target grown by the padding. */
  ring: { x: number; y: number; w: number; h: number; radii: [number, number, number, number] };
  /** Stroke widths in image px. */
  sw: number;
  halo: number;
  /** Present when a step number is drawn. */
  tab?: {
    /** Corner of the ring the tab grows out of. */
    top: boolean;
    right: boolean;
    /** Anchor: the outer corner of the ring stroke. Local (dx, dy) maps to (ax + sx*dx, ay + sy*dy). */
    ax: number;
    ay: number;
    sx: 1 | -1;
    sy: 1 | -1;
    /** Tab width and height, free-corner radius, fillet radius, font size, digit advance. */
    tw: number;
    th: number;
    rt: number;
    f: number;
    fs: number;
    advance: number;
  };
}

export interface FlagLayoutInput {
  target: Rect;
  /** Step number; omit for a ring without a tab. */
  n?: number;
  /** Image pixels per highlight CSS px (`highlightScale`). */
  scale: number;
  imageWidth: number;
  imageHeight: number;
  rtl?: boolean;
  /** Corner the recorder chose at capture (least text underneath); edge rules still apply. */
  corner?: TabCorner;
  /**
   * Box of the control's `<label>` (checkbox, radio, switch), image px. When the control alone is smaller than
   * the minimum ring, the ring goes around the control and its label together.
   */
  labelRect?: Rect;
}

function unionOf(a: Rect, b: Rect): Rect {
  const x1 = Math.min(a.x, b.x), y1 = Math.min(a.y, b.y), x2 = Math.max(a.x + a.width, b.x + b.width), y2 = Math.max(a.y + a.height, b.y + b.height);
  return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
}

/**
 * Smallest ring box that can carry the tab without the tab or its fillet leaving the ring: width at least
 * tab width + 2 x radius + 4 CSS px, height at least 0.75 x tab height, grown symmetrically around `box`
 * (or toward one side, see `growToward`).
 */
export function minRingBox(box: Rect, tabW: number, tabH: number, radius: number, scale: number, growToward?: "left" | "right"): Rect {
  const w = Math.max(box.width, tabW + 2 * radius + 4 * scale);
  const h = Math.max(box.height, 0.75 * tabH);
  const dx = w - box.width;
  // Symmetric by default. With `growToward` all the extra width goes to that side: the side the recorder
  // found free of text, so a widened ring never cuts through a label next to a small control.
  const x = growToward === "right" ? box.x : growToward === "left" ? box.x - dx : box.x - dx / 2;
  return { x, y: box.y - (h - box.height) / 2, width: w, height: h };
}

export function flagLayout(o: FlagLayoutInput): FlagLayout {
  const k = o.scale;
  const pad = FLAG.pad * k;
  const sw = FLAG.ringWidth * k;
  const halo = FLAG.haloWidth * k;
  const T = FLAG.tab;
  const th = T.height * k, fs = th * T.fontSizeRatio, rt = T.cornerRadius * k, f = T.fillet * k;
  const digits = o.n === undefined ? "" : String(Math.max(0, Math.floor(o.n)));
  const advance = fs * 0.6;
  const tw = digits ? Math.max(T.minWidth * k, digits.length * advance + T.paddingX * 2 * k) : 0;
  const grow = (r: Rect): Rect => ({ x: r.x - pad, y: r.y - pad, width: r.width + pad * 2, height: r.height + pad * 2 });
  let padded = grow(o.target);
  const tooSmall = (r: Rect): boolean => r.width < tw + 2 * FLAG.radius * k + 4 * k || r.height < 0.75 * th;
  if (digits && o.labelRect && tooSmall(padded)) padded = grow(unionOf(o.target, o.labelRect)); // ring the control and its label together
  const box = digits ? minRingBox(padded, tw, th, FLAG.radius * k, k, o.corner ? (o.corner.endsWith("right") ? "right" : "left") : undefined) : padded;
  const { x, y } = box, w = box.width, h = box.height;
  const rad = Math.min(FLAG.radius * k, h / 2, w / 2);
  const radii: [number, number, number, number] = [rad, rad, rad, rad];
  const layout: FlagLayout = { ring: { x, y, w, h, radii }, sw, halo };
  if (!digits) return layout;

  // brand tabCorner(): the stored corner if any, else top-right (top-left for RTL); the tab stays inside the image
  let top = o.corner ? o.corner.startsWith("top") : true;
  if (top && y - th < 0) top = false;
  let right = o.corner ? o.corner.endsWith("right") : !o.rtl;
  if (right && x + w + tw * 0.25 > o.imageWidth) right = false;
  if (!right && x - tw * 0.25 < 0) right = true;
  radii[top ? (right ? 1 : 0) : right ? 2 : 3] = 0;
  layout.tab = {
    top,
    right,
    ax: right ? x + w + sw / 2 : x - sw / 2,
    ay: top ? y + sw / 2 : y + h - sw / 2,
    sx: right ? 1 : -1,
    sy: top ? 1 : -1,
    tw, th, rt, f, fs, advance,
  };
  return layout;
}

const num = (n: number): string => String(Math.round(n * 100) / 100);

/** SVG path of the ring's centre line (per-corner radii; the tab's corner is square). */
export function flagRingPath(l: FlagLayout): string {
  const { x, y, w, h, radii: [tl, tr, br, bl] } = l.ring;
  const arc = (r: number, ex: number, ey: number): string => (r > 0 ? `A${num(r)} ${num(r)} 0 0 1 ${num(ex)} ${num(ey)}` : "");
  return (
    `M${num(x + tl)} ${num(y)}H${num(x + w - tr)}${arc(tr, x + w, y + tr)}V${num(y + h - br)}${arc(br, x + w - br, y + h)}` +
    `H${num(x + bl)}${arc(bl, x, y + h - bl)}V${num(y + tl)}${arc(tl, x + tl, y)}Z`
  );
}

/** SVG path of the numbered tab, or undefined when the layout has none. */
export function flagTabPath(l: FlagLayout): string | undefined {
  const t = l.tab;
  if (!t) return undefined;
  const P = (dx: number, dy: number): string => `${num(t.ax + t.sx * dx)} ${num(t.ay + t.sy * dy)}`;
  const flip = t.sx * t.sy < 0 ? 1 : 0; // one reflection reverses the arc direction
  const ccw = flip; // counter-clockwise on screen = sweep 0 unless mirrored
  const cw = 1 - flip;
  return (
    `M${P(0, 0)}L${P(0, -(t.th - t.rt))}A${num(t.rt)} ${num(t.rt)} 0 0 ${ccw} ${P(-t.rt, -t.th)}` +
    `L${P(-(t.tw - t.rt), -t.th)}A${num(t.rt)} ${num(t.rt)} 0 0 ${ccw} ${P(-t.tw, -(t.th - t.rt))}` +
    `L${P(-t.tw, -t.f)}A${num(t.f)} ${num(t.f)} 0 0 ${cw} ${P(-(t.tw + t.f), 0)}Z`
  );
}

/** Centre of the tab, for the numeral. */
export function flagTabCenter(l: FlagLayout): { x: number; y: number } | undefined {
  const t = l.tab;
  return t ? { x: t.ax + t.sx * (-t.tw / 2), y: t.ay + t.sy * (-t.th / 2) } : undefined;
}

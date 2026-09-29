// Geometry of the Showsteps "Flag" highlight (spotlight dim, keyline ring, numbered tab), shared by
// the pixel renderer (raster.ts) and the vector renderers (PDF). Same numbers as packages/brand/tokens.ts.

import { FLAG } from "./geometry";
import type { Rect } from "./schema";

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
}

export function flagLayout(o: FlagLayoutInput): FlagLayout {
  const k = o.scale;
  const pad = FLAG.pad * k;
  const sw = FLAG.ringWidth * k;
  const halo = FLAG.haloWidth * k;
  const x = o.target.x - pad, y = o.target.y - pad, w = o.target.width + pad * 2, h = o.target.height + pad * 2;
  const rad = Math.min(FLAG.radius * k, h / 2, w / 2);
  const radii: [number, number, number, number] = [rad, rad, rad, rad];
  const layout: FlagLayout = { ring: { x, y, w, h, radii }, sw, halo };
  if (o.n === undefined) return layout;

  const T = FLAG.tab;
  const th = T.height * k, fs = th * T.fontSizeRatio, rt = T.cornerRadius * k, f = T.fillet * k;
  const digits = String(Math.max(0, Math.floor(o.n)));
  const advance = fs * 0.6;
  const tw = Math.max(T.minWidth * k, digits.length * advance + T.paddingX * 2 * k);
  // brand tabCorner(): flip below near the top edge; to the left near the right edge (or for RTL)
  const top = !(y - th < 0);
  let right = !o.rtl;
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

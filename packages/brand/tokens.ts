// Showsteps brand tokens for code that draws pixels (exporters, canvas, OffscreenCanvas, Node).
// Same values as tokens.css. No DOM types: `drawFlagHighlight` takes any 2D context with the
// standard path API, so it runs in the extension, a worker, or a Node canvas.

export const colors = {
  light: {
    bg: "#F4F2EE", surface: "#FFFFFF", surface2: "#ECE9E4", ink: "#1F1C19", ink2: "#57514B", ink3: "#736B63",
    line: "#E0DCD6", line2: "#D2CDC6", accent: "#EB4E26", accentStrong: "#D13F19", accentInk: "#B63A14",
    accentSoft: "#FCE6DD", onAccent: "#FFFFFF", ok: "#217A4F", okSoft: "#E1F2E8", rec: "#E5341B",
  },
  dark: {
    bg: "#141312", surface: "#1C1A18", surface2: "#25221F", ink: "#F3EFEA", ink2: "#B9B0A6", ink3: "#8F867C",
    line: "#2F2B28", line2: "#3D3935", accent: "#FF6337", accentStrong: "#FF6337", accentInk: "#FF8D6A",
    accentSoft: "#3A1F16", onAccent: "#1A0B05", ok: "#5BC98C", okSoft: "#173024", rec: "#FF5A3F",
  },
} as const;

export const fonts = {
  ui: '"Rethink Sans", ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif',
  mono: '"Fragment Mono", ui-monospace, "SF Mono", Menlo, Consolas, monospace',
} as const;

/** The signature highlight. Lengths are CSS px of the captured page; multiply by `scale` from `highlightScale`. */
export const highlight = {
  /** Default ring + tab colour. `guide.settings.highlightColor` overrides it. */
  color: "#EB4E26",
  /** Numeral colour on the tab. Use `#1A0B05` only if a user picks a light highlight colour (luminance > 0.45). */
  numeralColor: "#FFFFFF",
  /** White keyline around ring and tab so the mark reads on dark, busy or same-coloured UI. */
  haloColor: "rgba(255,255,255,0.96)",
  ringWidth: 3,
  haloWidth: 2,
  /** Gap between the element's box and the ring's centre line. */
  pad: 4,
  /** Ring corner radius, clamped to half the ring's height/width. */
  radius: 8,
  /** Spotlight: everything outside the ring is dimmed with this colour. 0 alpha disables it. */
  spotlightDim: "rgba(28,18,12,0.12)",
  /** Stronger dim for thumbnails under ~480 CSS px wide (side panel). */
  spotlightDimThumb: "rgba(28,18,12,0.16)",
  tab: {
    height: 24,
    /** Tab width = max(minWidth, numeral advance + 2 * paddingX). */
    minWidth: 27,
    paddingX: 8.5,
    /** Radius of the tab's two free corners. */
    cornerRadius: 7,
    /** Concave fillet where the tab's inner side meets the ring. */
    fillet: 7,
    fontFamily: fonts.ui,
    fontWeight: 750,
    /** Numeral size as a fraction of tab height. Tabular figures. */
    fontSizeRatio: 0.6,
  },
  /** Blur for redactions (auto and manual): Gaussian sigma in CSS px, never below 6. */
  redactBlurSigma: 8,
  redactSolidColor: "#1F1C19",
} as const;

/**
 * Scale for highlight lengths, in image pixels per CSS px of highlight token.
 * Exported guides are read at ~760-960 CSS px wide, so wide captures get proportionally bolder marks.
 *   scale = devicePixelRatio * clamp(viewportCssWidth / 960, 1, 2)
 */
export function highlightScale(viewportCssWidth: number, devicePixelRatio: number): number {
  const s = Math.min(2, Math.max(1, viewportCssWidth / 960));
  return devicePixelRatio * s;
}

export interface Box { x: number; y: number; width: number; height: number }
export type Corner = "top-right" | "top-left" | "bottom-right" | "bottom-left";

/**
 * Where the numbered tab goes. Default top-right: in left-to-right UIs, labels and headings sit
 * top-left of controls, so the top-right corner is usually empty. Flip below when the tab would leave
 * the image at the top; move to the left side when the ring reaches the right edge of the image.
 */
export function tabCorner(ring: Box, tabW: number, tabH: number, imageW: number, rtl = false, stored?: Corner): Corner {
  // `stored` is the corner the recorder picked at capture (least text under the tab). Edge rules still win:
  // the tab must stay inside the image.
  let vertical: "top" | "bottom" = stored ? (stored.startsWith("top") ? "top" : "bottom") : "top";
  if (vertical === "top" && ring.y - tabH < 0) vertical = "bottom";
  let side: "left" | "right" = stored ? (stored.endsWith("left") ? "left" : "right") : rtl ? "left" : "right";
  if (side === "right" && ring.x + ring.width + tabW * 0.25 > imageW) side = "left";
  if (side === "left" && ring.x - tabW * 0.25 < 0) side = "right";
  return `${vertical}-${side}` as Corner;
}

/**
 * Smallest ring box that can carry the tab without the tab or its fillet leaving the ring: width at least
 * tab width + 2 x radius + 4 CSS px, height at least 0.75 x tab height. Grown symmetrically around `box`.
 */
export function minRingBox(box: Box, tabW: number, tabH: number, radius: number, scale: number, growToward?: "left" | "right"): Box {
  const minW = tabW + 2 * radius + 4 * scale;
  const minH = 0.75 * tabH;
  const w = Math.max(box.width, minW), h = Math.max(box.height, minH);
  // Symmetric by default; with `growToward` all the extra width goes to that side (the side free of text).
  const dx = w - box.width;
  const x = growToward === "right" ? box.x : growToward === "left" ? box.x - dx : box.x - dx / 2;
  return { x, y: box.y - (h - box.height) / 2, width: w, height: h };
}

/** Minimal 2D context shape (CanvasRenderingContext2D, OffscreenCanvasRenderingContext2D, @napi-rs/canvas). */
export interface Ctx2D {
  save(): void; restore(): void; beginPath(): void; closePath(): void;
  moveTo(x: number, y: number): void; lineTo(x: number, y: number): void;
  arcTo(x1: number, y1: number, x2: number, y2: number, r: number): void;
  rect(x: number, y: number, w: number, h: number): void;
  fill(rule?: "nonzero" | "evenodd"): void; stroke(): void;
  fillText(text: string, x: number, y: number): void;
  measureText(text: string): { width: number };
  fillStyle: unknown; strokeStyle: unknown; lineWidth: number; lineJoin: string;
  font: string; textAlign: string; textBaseline: string;
}

export interface FlagOptions {
  /** Target box in image pixels (Step.screenshot.highlight). */
  target: Box;
  /** Step number shown on the tab. */
  n: number | string;
  imageWidth: number;
  imageHeight: number;
  /** From highlightScale(). */
  scale: number;
  color?: string;
  /** Override the dim (e.g. highlight.spotlightDimThumb) or pass "transparent" to disable. */
  dim?: string;
  rtl?: boolean;
  /** Corner stored at capture (`screenshot.highlight.corner`); the tab uses it when present. */
  corner?: Corner;
  /** Box of the control's <label> in image px. A control smaller than the minimum ring is ringed together with it. */
  labelRect?: Box;
}

/** Rounded rectangle with per-corner radii, clockwise from top-left. */
function roundRect(ctx: Ctx2D, x: number, y: number, w: number, h: number, r: [number, number, number, number]) {
  const [tl, tr, br, bl] = r;
  ctx.moveTo(x + tl, y);
  ctx.lineTo(x + w - tr, y); if (tr) ctx.arcTo(x + w, y, x + w, y + tr, tr); else ctx.lineTo(x + w, y);
  ctx.lineTo(x + w, y + h - br); if (br) ctx.arcTo(x + w, y + h, x + w - br, y + h, br); else ctx.lineTo(x + w, y + h);
  ctx.lineTo(x + bl, y + h); if (bl) ctx.arcTo(x, y + h, x, y + h - bl, bl); else ctx.lineTo(x, y + h);
  ctx.lineTo(x, y + tl); if (tl) ctx.arcTo(x, y, x + tl, y, tl); else ctx.lineTo(x, y);
  ctx.closePath();
}

/**
 * Reference drawing of the Showsteps highlight: spotlight dim, haloed ring, and the numbered tab.
 * Call after drawing the screenshot and redactions. Pure path maths; no DOM.
 */
export function drawFlagHighlight(ctx: Ctx2D, o: FlagOptions): void {
  const H = highlight, k = o.scale, color = o.color ?? H.color;
  const pad = H.pad * k, sw = H.ringWidth * k, halo = H.haloWidth * k;
  const th = H.tab.height * k, fs = th * H.tab.fontSizeRatio, rt = H.tab.cornerRadius * k, f = H.tab.fillet * k;
  const label = String(o.n);

  ctx.save();
  ctx.font = `${H.tab.fontWeight} ${fs}px ${H.tab.fontFamily}`;
  const tw = Math.max(H.tab.minWidth * k, ctx.measureText(label).width + H.tab.paddingX * 2 * k);
  // The ring is the target plus padding, grown if needed so the tab always fits on it (small targets such as checkboxes).
  const grow = (r: Box): Box => ({ x: r.x - pad, y: r.y - pad, width: r.width + pad * 2, height: r.height + pad * 2 });
  let padded = grow(o.target);
  if (o.labelRect && (padded.width < tw + 2 * H.radius * k + 4 * k || padded.height < 0.75 * th)) {
    const l = o.labelRect, t = o.target;
    const x1 = Math.min(t.x, l.x), y1 = Math.min(t.y, l.y), x2 = Math.max(t.x + t.width, l.x + l.width), y2 = Math.max(t.y + t.height, l.y + l.height);
    padded = grow({ x: x1, y: y1, width: x2 - x1, height: y2 - y1 }); // control and label together
  }
  const ringBox = minRingBox(padded, tw, th, H.radius * k, k, o.corner ? (o.corner.endsWith("right") ? "right" : "left") : undefined);
  const x = ringBox.x, y = ringBox.y, w = ringBox.width, h = ringBox.height;
  const rad = Math.min(H.radius * k, h / 2, w / 2);
  const corner = tabCorner({ x, y, width: w, height: h }, tw, th, o.imageWidth, o.rtl, o.corner);
  const top = corner.startsWith("top"), right = corner.endsWith("right");

  // 1. spotlight dim with the ring's box cut out
  const dim = o.dim ?? H.spotlightDim;
  if (dim !== "transparent") {
    ctx.beginPath();
    ctx.rect(0, 0, o.imageWidth, o.imageHeight);
    roundRect(ctx, x, y, w, h, [rad, rad, rad, rad]);
    ctx.fillStyle = dim;
    ctx.fill("evenodd");
  }

  // 2. ring path: the flagged corner is square so the tab grows out of it
  const radii: [number, number, number, number] = [rad, rad, rad, rad];
  radii[top ? (right ? 1 : 0) : right ? 2 : 3] = 0;
  const ring = () => { ctx.beginPath(); roundRect(ctx, x, y, w, h, radii); };

  // 3. tab path, drawn for top-right and mirrored with sx/sy
  const sx = right ? 1 : -1, sy = top ? 1 : -1;
  const ax = right ? x + w + sw / 2 : x - sw / 2;
  const ay = top ? y + sw / 2 : y + h - sw / 2;
  const P = (dx: number, dy: number): [number, number] => [ax + sx * dx, ay + sy * dy];
  const tab = () => {
    ctx.beginPath();
    ctx.moveTo(...P(0, 0));
    ctx.lineTo(...P(0, -(th - rt)));
    ctx.arcTo(...P(0, -th), ...P(-rt, -th), rt);
    ctx.lineTo(...P(-(tw - rt), -th));
    ctx.arcTo(...P(-tw, -th), ...P(-tw, -(th - rt)), rt);
    ctx.lineTo(...P(-tw, -f));
    ctx.arcTo(...P(-tw, 0), ...P(-(tw + f), 0), f);
    ctx.closePath();
  };

  ctx.lineJoin = "round";
  // halo under everything coloured
  ring(); ctx.strokeStyle = H.haloColor; ctx.lineWidth = sw + halo * 2; ctx.stroke();
  tab(); ctx.fillStyle = H.haloColor; ctx.fill(); ctx.lineWidth = halo * 2; ctx.stroke();
  // colour
  ring(); ctx.strokeStyle = color; ctx.lineWidth = sw; ctx.stroke();
  tab(); ctx.fillStyle = color; ctx.fill();
  // numeral
  const [cx, cy] = P(-tw / 2, -th / 2);
  ctx.fillStyle = H.numeralColor;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, cx, cy + fs * 0.04);
  ctx.restore();
}

export const radii = { xs: 4, sm: 7, md: 10, lg: 14, xl: 20 } as const;
export const motion = {
  easeOut: "cubic-bezier(.2,.8,.2,1)", easeInOut: "cubic-bezier(.6,0,.3,1)", easeFlag: "cubic-bezier(.34,1.4,.64,1)",
  fast: 120, base: 180, slow: 280, flag: 420,
} as const;

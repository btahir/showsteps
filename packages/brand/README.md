# @stepsnap/brand

The Showsteps look in one place: design tokens for CSS and canvas, the logo and icons, and the self-hosted fonts. The design rationale and full component spec live in the gitignored `docs/design/` (`DECISION.md`, `SPEC.md`).

## The signature

Every exported screenshot gets **the flag**: a persimmon ring around the clicked element, with a folder tab growing out of its top-right corner that carries the step number, plus a soft 16% dim around it. Don't redraw it by hand. Call `drawFlagHighlight` so the side panel, HTML, PDF, DOCX and Markdown images all match.

```ts
import { drawFlagHighlight, highlightScale, highlight } from "@stepsnap/brand";

// after drawing the screenshot and its redactions onto ctx
drawFlagHighlight(ctx, {
  target: { x: 576, y: 772, width: 1344, height: 80 }, // step.screenshot.highlight (image px)
  n: 2,                                                 // position among exported steps
  imageWidth: bitmap.width,
  imageHeight: bitmap.height,
  scale: highlightScale(step.screenshot.viewport.width, step.screenshot.devicePixelRatio),
  color: guide.settings?.highlightColor,               // optional, default #EB4E26
  // dim: "transparent",                                // when "Dim around the highlight" is off
});
```

It works with `CanvasRenderingContext2D`, `OffscreenCanvasRenderingContext2D` or any object with the standard 2D path API (the `Ctx2D` type). Wait for Rethink Sans to load before drawing so the numeral uses it. `tabCorner()` holds the placement rule: top-right by default, below when there is no room above, and the left side for RTL or when the ring meets the right edge.

## CSS

```css
@import "@stepsnap/brand/tokens.css";
body { background: var(--ss-bg); color: var(--ss-ink); font-family: var(--ss-font-ui); }
.primary { background: var(--ss-accent-strong); color: var(--ss-on-accent); border-radius: var(--ss-radius-md); }
.step-marker { background: var(--ss-accent); color: #fff; border-radius: var(--ss-radius-flag); }
```

- The theme follows `prefers-color-scheme`. Force it with `<html data-theme="light">` or `data-theme="dark"`.
- Token groups: type (`--ss-font-*`, `--ss-text-*`, `--ss-lh-*`), space (`--ss-space-*`), radii (`--ss-radius-*`), motion (`--ss-ease-*`, `--ss-dur-*`, zeroed for reduced motion), highlight (`--ss-highlight*`, `--ss-spotlight-*`), and colour (`--ss-bg`, `--ss-surface`, `--ss-ink*`, `--ss-line*`, `--ss-accent*`, `--ss-ok*`, `--ss-warn*`, `--ss-danger*`, `--ss-rec`).
- Persimmon is used only for the highlight, step markers, the one primary action per view, and focus. Use `--ss-accent-ink` for accent-coloured text and `--ss-accent-strong` for filled buttons (both pass AA).
- Font URLs in `tokens.css` are relative (`./fonts/...`), so bundlers (WXT/Vite, Astro) copy the files. If you inline the CSS somewhere else, copy `fonts/` next to it.

## Files

| File | Use |
|---|---|
| `tokens.css` | CSS custom properties plus `@font-face` rules |
| `tokens.ts` | The same values for code: `colors`, `fonts`, `highlight`, `radii`, `motion`, `highlightScale`, `tabCorner`, `drawFlagHighlight` |
| `icon.svg` | App icon on a 128 grid (ring, tab and "1" on a persimmon squircle). Use for 32, 48 and 128. |
| `icon-16.svg` | 16 px toolbar and favicon variant (heavier ring, no numeral) |
| `icon-store.svg` | 128 px with 16 px padding for the Chrome Web Store |
| `logo.svg`, `logo-on-dark.svg` | Icon plus the outlined "Showsteps" wordmark for light and dark grounds |
| `mark.svg` | Persimmon ring and tab without the squircle, for display sizes of 64 px and up: the "1" numeral is cut out of the tab and the ring stroke is about 20% thinner (9 instead of 11 units) |
| `mark-small.svg` | The same mark with the heavy ring and no numeral, for sizes under 64 px |
| `fonts/` | Rethink Sans (variable) and Fragment Mono woff2, with OFL texts. See `FONTS.md`. |

Rasterise PNG icons at build time (for example `sharp` or a Playwright screenshot of the SVG at 16, 32, 48 and 128). Don't commit rasters here.

`pnpm --filter @stepsnap/brand typecheck` checks that `Ctx2D` accepts real canvas contexts.

Licence: MIT for the code and SVGs. The fonts are under OFL-1.1 (see `FONTS.md`).

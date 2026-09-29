# @showsteps/core

The headless core of Showsteps: the guide format, validation, step-title writing, screenshot rendering (redaction, highlight, crop) and every exporter. Pure TypeScript with no DOM and no Node-only APIs in `src/`, so the same code runs in the Chrome extension (page and service worker), in Node (CLI, MCP server, tests) and in any bundler. Dependencies: `fflate` (zip and PNG deflate), `pdf-lib` and `@pdf-lib/fontkit` (PDF), `docx` (DOCX). All MIT.

The file formats are documented in [`docs/schema.md`](../../docs/schema.md).

```ts
import {
  validateGuide, migrateGuide, generateStepTitle, regenerateTitles, applyAutoRedactions,
  exportMarkdown, exportHtml, exportPlaywright, exportAgentSkill, exportPdf, exportDocx,
  packBundle, unpackBundle,
} from "@showsteps/core";
```

## Guide: validate and migrate

```ts
const res = validateGuide(JSON.parse(text));
if (!res.ok) console.error(res.errors);      // ["guide.steps[3].screenshot.highlight: is outside the image (...)"]
else use(res.guide);

const guide = migrateGuide(json);            // upgrades old versions; throws GuideValidationError (.errors) if unusable
```

`validateGuide` never throws and returns one readable string per problem. It rejects among other things duplicate step ids, a masked `type` step that carries a real value, screenshot paths outside `images/`, rectangles outside their image, non-finite numbers, oversized titles, `__proto__` keys and non-JSON values. Full list in the schema doc.

## Step titles

```ts
generateStepTitle({ action: { type: "click" }, target: saveButton, page })
// "Click **Save**"
generateStepTitle({ action: { type: "type", value: "", masked: true }, target: passwordField, page })
// "Enter your password"      (masked and sensitive values never appear)
generateStepTitle({ action: { type: "select", value: "m", optionText: "Monthly" }, target: period, page })
// "Select **Monthly** in **Billing period**"
generateStepTitle({ action: { type: "navigate", url }, page: { url, title: "Reports – Acme Books" } }, { previousPage })
// "Go to **Reports**" (adds " on Acme Books" when the site differs from the previous step's)
defaultGuideTitle("Sign in – Acme Books", url)   // "Acme Books: Sign in"

const fresh = regenerateTitles(guide);        // pure; keeps titleEdited titles and note steps
```

Titles are one line and at most 160 characters. Names are picked from accessible name, label, text and placeholder in the order that suits the control (text fields never use `text`, which can be what was typed). Plain-text and inline-Markdown helpers: `plainTitle`, `parseInline`, `escapeInline`, `formatKey`.

## Redaction and geometry

```ts
const guide2 = applyAutoRedactions(guide);    // sensitive targets get an automatic "mask" (field background + dots) over their highlight box
autoRedactions(step);                         // Redaction[] for one step ([] when already covered)

focusFrame(highlight, { width, height }, scale)   // 16:10 window around the ring for thumbnails and phone detail images
cssToImageRect(rect, { devicePixelRatio: 2 })                       // outward-rounded image pixels
cssToImageRect(rect, { devicePixelRatio: 2, scrollX, scrollY, origin: "document" })
imageToCssRect(imageRect, space); clampRect(r, {width, height}); scaleRect(r, sx, sy);
highlightPath(rect, pad, radius)              // SVG path "d" of the rounded highlight box
flagLayout / flagRingPath / flagTabPath       // geometry of the brand highlight (ring, keyline, numbered tab)
```

## Rendering screenshots without a canvas

`renderStepImage(png, step.screenshot, opts)` returns PNG bytes with the redactions burnt in (mask, solid, pixelate or blur), the crop applied and then the brand highlight drawn (12% spotlight dim, persimmon ring, white keyline, numbered tab; the ring grows to carry the tab on small targets, and the tab uses `highlight.corner` or flips below near the top edge and to the left for right-to-left pages). If a redaction is needed and the bytes cannot be rewritten (a JPEG), it throws `RenderError` instead of leaking pixels. A 2880x1800 image takes about 0.4 s.

`renderGuideImages(guide, images, opts)` does it for every visible step and returns an `ImageSource` (`Record<path, Uint8Array>`). The exporters call it for you. If your own renderer already did the work (the extension draws on a canvas), pass `imagesPrerendered: true` and the bytes pass through untouched.

## Exporters

Every exporter skips steps marked `skipped`, numbers the rest 1..n, and is deterministic: the same guide gives the same bytes, in any time zone, regardless of key order.

```ts
// Markdown: guide.md + images/<id>.png (rendered). Without `images` it returns only guide.md but still links images/…
const { files } = exportMarkdown(guide, { images });          // options: includeUrls, imageLinks, branding (credit, off by default), imagesPrerendered

// HTML: one self-contained file. Images inlined, brand fonts embedded, print CSS, no scripts, no network.
const html = exportHtml(guide, images);                        // options: includeUrls, branding, theme, css, embedFonts, detailImages, lang

// Playwright: an idiomatic @playwright/test file
const spec = exportPlaywright(guide);                          // replay.spec.ts; see docs/schema.md for the replay rules

// Agent skill: SKILL.md + steps.json + replay.spec.ts (+ images/ if you pass them)
const skill = exportAgentSkill(guide, { images });            // { files }

// PDF and DOCX are async
const pdf = await exportPdf(guide, images, { pageSize: "A4", now });   // Uint8Array
const docx = await exportDocx(guide, images, { pageSize: "Letter" });  // Uint8Array
```

PDF and DOCX options: `pageSize` (`"A4"` or `"Letter"`), `highlight`, `redactionsBaked`, `imagesPrerendered`, `branding`, `now` (creation and modification date; default the guide's own dates), `onWarning` (called when a glyph no font has was replaced with `?`). The PDF also takes `font` to replace the default Source Sans 3.

Secrets: a masked or sensitive field is never written to any export. The Playwright script reads it from `process.env.SHOWSTEPS_SECRET_<n>` and skips the test when the variable is missing.

## Project files

```ts
const bytes = packBundle(guide, images);       // .showsteps zip, byte-stable
const { guide, images } = unpackBundle(bytes); // typed errors (BundleError, GuideValidationError), never a partial result
```

## Tests

```bash
pnpm --filter @showsteps/core test         # vitest, about 500 tests
pnpm --filter @showsteps/core typecheck
UPDATE_GOLDEN=1 pnpm --filter @showsteps/core test   # rewrite golden files in test/golden, then review the diff
```

Fixtures: `test/fixtures/guide.ts` (10 steps across 2 tabs with a password field, a select, a checkbox, an iframe button and an icon-only button; tiny PNGs drawn in code) and `test/fixtures/sample11.ts` (the 11-step guide from `sample-11.guide.json`, with 2880x1800 synthetic screenshots). Goldens cover titles (`titles.golden.json`, 90+ cases), Markdown, HTML, the Playwright script, the agent skill and the bundle hash.

## Licence

MIT. Fonts embedded in exports are SIL OFL 1.1 (see `assets/fonts/` and the root `CREDITS.md`).

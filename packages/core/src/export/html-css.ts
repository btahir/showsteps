// Stylesheet of the exported HTML guide. Colours, type and radii are CSS variables named like
// packages/brand/tokens.css (`--ss-*`), so brand values drop in unchanged: pass extra CSS via
// `exportHtml(..., { css })` (for example the contents of tokens.css) and it wins over these defaults.

import { FRAGMENT_MONO_LATIN_B64, RETHINK_SANS_LATIN_B64, RETHINK_SANS_LATIN_EXT_B64 } from "../../assets/fonts/brand-fonts";

/** Brand fonts as data URIs (Rethink Sans, Fragment Mono; SIL OFL 1.1). Same unicode ranges as brand tokens.css. */
export const HTML_FONT_FACES = `@font-face { font-family: "Rethink Sans"; src: url(data:font/woff2;base64,${RETHINK_SANS_LATIN_B64}) format("woff2"); font-weight: 400 800; font-style: normal; font-display: swap; unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD; }
@font-face { font-family: "Rethink Sans"; src: url(data:font/woff2;base64,${RETHINK_SANS_LATIN_EXT_B64}) format("woff2"); font-weight: 400 800; font-style: normal; font-display: swap; unicode-range: U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF; }
@font-face { font-family: "Fragment Mono"; src: url(data:font/woff2;base64,${FRAGMENT_MONO_LATIN_B64}) format("woff2"); font-weight: 400; font-style: normal; font-display: swap; unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD; }
`;

export const HTML_TOKENS_LIGHT = `--ss-font-ui: "Rethink Sans", ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
  --ss-font-mono: "Fragment Mono", ui-monospace, "SF Mono", Menlo, Consolas, monospace;
  --ss-bg: #F4F2EE; --ss-surface: #FFFFFF; --ss-surface-2: #ECE9E4;
  --ss-ink: #1F1C19; --ss-ink-2: #57514B; --ss-ink-3: #736B63;
  --ss-line: #E0DCD6; --ss-line-2: #D2CDC6;
  --ss-accent: #EB4E26; --ss-accent-strong: #D13F19; --ss-accent-ink: #B63A14; --ss-accent-soft: #FCE6DD; --ss-on-accent: #FFFFFF;
  --ss-ok: #217A4F; --ss-ok-soft: #E1F2E8;
  --ss-radius-md: 10px; --ss-radius-lg: 14px;
  --ss-shadow-2: 0 1px 2px rgba(31, 28, 25, .06), 0 8px 24px -8px rgba(31, 28, 25, .18);
  --ss-guide-measure: 820px;`;

export const HTML_TOKENS_DARK = `--ss-bg: #141312; --ss-surface: #1C1A18; --ss-surface-2: #25221F;
  --ss-ink: #F3EFEA; --ss-ink-2: #B9B0A6; --ss-ink-3: #8F867C;
  --ss-line: #2F2B28; --ss-line-2: #3D3935;
  --ss-accent: #FF6337; --ss-accent-strong: #FF6337; --ss-accent-ink: #FF8D6A; --ss-accent-soft: #3A1F16; --ss-on-accent: #1A0B05;
  --ss-ok: #5BC98C; --ss-ok-soft: #173024;
  --ss-shadow-2: 0 1px 2px rgba(0, 0, 0, .4), 0 10px 30px -10px rgba(0, 0, 0, .6);`;

export const HTML_CSS = `
:root { ${HTML_TOKENS_LIGHT} color-scheme: light; }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { ${HTML_TOKENS_DARK} color-scheme: dark; } }
:root[data-theme="dark"] { ${HTML_TOKENS_DARK} color-scheme: dark; }

*, *::before, *::after { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; }
body { margin: 0; background: var(--ss-bg); color: var(--ss-ink); font: 400 16px/1.55 var(--ss-font-ui); -webkit-font-smoothing: antialiased; text-rendering: optimizeLegibility; }
main { max-width: var(--ss-guide-measure); margin: 0 auto; padding: 72px 24px 96px; }
b, strong { font-weight: 650; }
a { color: var(--ss-accent-ink); text-underline-offset: 2px; }
code { font-family: var(--ss-font-mono); font-size: .9em; background: var(--ss-surface-2); padding: .1em .35em; border-radius: 5px; }
pre { font-family: var(--ss-font-mono); font-size: 13px; background: var(--ss-surface-2); padding: 12px 14px; border-radius: var(--ss-radius-md); overflow-x: auto; white-space: pre-wrap; }
pre code { background: none; padding: 0; }
blockquote { margin: 12px 0; padding: 2px 0 2px 14px; border-left: 3px solid var(--ss-line-2); color: var(--ss-ink-2); }
.mono { font-family: var(--ss-font-mono); font-size: 12px; letter-spacing: -.01em; }

.flag { display: inline-grid; place-items: center; min-width: 36px; height: 32px; padding: 0 9px; background: var(--ss-accent-strong); color: var(--ss-on-accent);
  font: 700 17px/1 var(--ss-font-ui); font-variant-numeric: tabular-nums; border-radius: 9px 9px 9px 3px; }
.flag.sm { min-width: 20px; height: 20px; padding: 0 5px; font-size: 11px; border-radius: 6px 6px 6px 2px; }

.eyebrow { display: flex; gap: 10px; align-items: center; color: var(--ss-ink-3); text-transform: uppercase; }
h1 { margin: 18px 0 0; font: 750 44px/1.08 var(--ss-font-ui); letter-spacing: -.03em; text-wrap: balance; max-width: 20ch; overflow-wrap: anywhere; }
.lede { margin-top: 16px; font-size: 18px; line-height: 1.55; color: var(--ss-ink-2); max-width: 60ch; }
.lede p { margin: 0 0 .6em; }
.facts { margin-top: 28px; display: flex; flex-wrap: wrap; gap: 8px 28px; padding: 14px 0; border-top: 1px solid var(--ss-line); border-bottom: 1px solid var(--ss-line); font-size: 13.5px; color: var(--ss-ink-2); }
.facts b { display: block; color: var(--ss-ink); font-weight: 650; font-size: 14px; }

ol.steps { list-style: none; padding: 0; margin: 56px 0 0; display: flex; flex-direction: column; gap: 64px; }
.step { display: grid; grid-template-columns: 52px minmax(0, 1fr); column-gap: 8px; }
.step .flag { margin-top: 2px; align-self: start; justify-self: start; }
.step h2 { margin: 0; font: 600 22px/1.3 var(--ss-font-ui); letter-spacing: -.015em; overflow-wrap: anywhere; }
.step h2 b { font-weight: 750; }
.desc { margin-top: 6px; color: var(--ss-ink-2); font-size: 16px; }
.desc p { margin: 6px 0 0; }
.desc ul, .desc ol { margin: 6px 0 0; padding-left: 1.3em; }
figure { grid-column: 1 / -1; margin: 18px 0 0; }
.frame { border-radius: 12px; overflow: hidden; border: 1px solid var(--ss-line); box-shadow: var(--ss-shadow-2); line-height: 0; background: #fff; }
.frame img { display: block; width: 100%; height: auto; }
figcaption { margin-top: 10px; display: flex; gap: 8px; align-items: center; color: var(--ss-ink-3); min-width: 0; }
figcaption svg { width: 14px; height: 14px; flex: none; stroke: currentColor; fill: none; stroke-width: 1.6; stroke-linecap: round; stroke-linejoin: round; }
figcaption .mono { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
figcaption a { color: inherit; text-decoration: none; }
figcaption a:hover { text-decoration: underline; }
.step.note h2 { font-weight: 600; }
.step.note .flag { background: var(--ss-surface-2); color: var(--ss-ink-2); }

.done { margin-top: 64px; display: grid; grid-template-columns: 52px minmax(0, 1fr); column-gap: 8px; align-items: center; }
.done .tick { display: inline-grid; place-items: center; width: 36px; height: 32px; border-radius: 9px 9px 9px 3px; background: var(--ss-ok-soft); color: var(--ss-ok); }
.done .tick svg { width: 18px; height: 18px; stroke: currentColor; fill: none; stroke-width: 2.2; stroke-linecap: round; stroke-linejoin: round; }
.done h2 { margin: 0; font: 600 22px/1.3 var(--ss-font-ui); }

.toc { display: none; }
@media (min-width: 1100px) {
  main:has(.with-toc) { max-width: 1160px; }
  .cols.with-toc { display: grid; grid-template-columns: 220px minmax(0, 1fr); gap: 48px; align-items: start; }
  .cols.with-toc .toc { display: block; position: sticky; top: 32px; max-height: calc(100vh - 64px); overflow: auto; font-size: 13px; line-height: 1.35; }
  .toc ol { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 2px; }
  .toc a { display: grid; grid-template-columns: 24px 1fr; gap: 6px; padding: 5px 8px; border-radius: 8px; color: var(--ss-ink-2); text-decoration: none; }
  .toc a:hover { background: var(--ss-surface-2); color: var(--ss-ink); }
  .toc .n { font: 500 12px/1.4 var(--ss-font-mono); color: var(--ss-ink-3); font-variant-numeric: tabular-nums; }
}

footer { margin-top: 72px; padding-top: 18px; border-top: 1px solid var(--ss-line); color: var(--ss-ink-3); font-size: 13px; display: flex; flex-wrap: wrap; gap: 4px 16px; justify-content: space-between; }
footer a { color: inherit; }

@media (max-width: 600px) {
  main { padding: 40px 16px 64px; }
  h1 { font-size: 32px; }
  .step { grid-template-columns: 28px minmax(0, 1fr); column-gap: 12px; }
  .step .flag { min-width: 28px; height: 26px; padding: 0 6px; font-size: 14px; border-radius: 8px 8px 8px 2.5px; }
  .step h2 { font-size: 19px; }
  .done { grid-template-columns: 28px minmax(0, 1fr); column-gap: 12px; }
  .done .tick { width: 28px; height: 26px; }
  .done h2 { font-size: 19px; }
}

@media print {
  :root { ${HTML_TOKENS_LIGHT} --ss-bg: #fff; --ss-shadow-2: none; color-scheme: light; }
  @page { margin: 16mm 14mm; }
  html, body { background: #fff; }
  body { font-size: 11pt; line-height: 1.45; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  main { max-width: none; padding: 0; }
  h1 { font-size: 26pt; max-width: none; }
  .lede { font-size: 12pt; }
  ol.steps { margin-top: 22pt; gap: 22pt; }
  .step { break-inside: avoid; page-break-inside: avoid; }
  .step h2 { font-size: 14pt; break-after: avoid; page-break-after: avoid; }
  figure { break-inside: avoid; page-break-inside: avoid; margin-top: 10pt; }
  .frame { box-shadow: none; }
  .frame img { max-height: 200mm; width: auto; max-width: 100%; margin: 0 auto; }
  .facts, .eyebrow { break-after: avoid; }
  .toc { display: none !important; }
  .cols.with-toc { display: block !important; }
  .done { break-inside: avoid; }
  a { color: inherit; text-decoration: none; }
  footer { margin-top: 28pt; break-inside: avoid; }
}
`;

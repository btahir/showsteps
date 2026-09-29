# Fonts

Both families are self-hosted from `fonts/`, so nothing is fetched at runtime and the extension works offline. They are licensed under the SIL Open Font License 1.1, which allows bundling and redistribution with software (including MIT software) as long as the licence travels with the fonts and the fonts aren't sold on their own. The licence texts are in `fonts/`.

| Family | Use | Files | Licence | Source |
|---|---|---|---|---|
| Rethink Sans (variable, weights 400–800, upright) | All UI, headings, step numerals on the highlight tab, wordmark (outlined in `logo.svg`) | `fonts/RethinkSans-Variable-latin.woff2`, `fonts/RethinkSans-Variable-latin-ext.woff2` | OFL-1.1, `fonts/OFL-RethinkSans.txt`, Copyright 2022 The Rethink Sans Project Authors | github.com/hans-thiessen/Rethink-Sans, via Fontsource (`@fontsource-variable/rethink-sans`), fetched 2026-09-28 |
| Fragment Mono (400) | URLs, keyboard keys, file names, small uppercase counters only | `fonts/FragmentMono-Regular-latin.woff2`, `fonts/FragmentMono-Regular-latin-ext.woff2` | OFL-1.1, `fonts/OFL-FragmentMono.txt`, Copyright 2022 The Fragment-Mono Project Authors | github.com/weiweihuanghuang/fragment-mono, via Fontsource (`@fontsource/fragment-mono`), fetched 2026-09-28 |

Notes:
- The subsets are latin and latin-ext, split with `unicode-range` in `tokens.css`. For other scripts, the system font stack in `--ss-font-ui` takes over.
- **Canvas and PDF:** wait for `document.fonts.load("750 20px 'Rethink Sans'")` before drawing highlight numerals. pdf-lib needs a TTF or OTF: get the static TTFs from the upstream repo (same OFL) and embed with `@pdf-lib/fontkit`.
- **DOCX:** reference "Rethink Sans" with a Calibri fallback. Don't embed the fonts in the DOCX.
- The OFL's Reserved Font Name clause means that if we ever modify the font files (not just subset them), we must rename them. Subsetting for the web is fine.
- Rejected on purpose because sibling projects use them: Figtree, Bricolage Grotesque, Geist, Outfit, Atkinson Hyperlegible, Instrument Serif and Sans, DM Sans, Fraunces, Newsreader, Inter and JetBrains Mono.

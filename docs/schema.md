# Showsteps file formats

Everything Showsteps reads and writes is plain JSON or a zip of plain JSON and PNGs, so a person, a script or an agent can create or edit a guide and open it in the extension. This page is the reference. The TypeScript types live in `packages/core/src/schema.ts`; the checks in `packages/core/src/validate.ts`; the JSON Schema for `steps.json` in `packages/core/schema/steps.schema.json`.

Versioning: `guide.json` carries `schemaVersion` (now `1`). Additive changes (new optional fields) keep the version; a breaking change bumps it and ships a migration. Readers ignore fields they do not know. Software that meets a newer version than it understands says so and refuses to open the file.

## 1. The project file: `.showsteps`

A `.showsteps` file is a zip. Older builds called it `.stepsnap`; the contents are the same.

```
guide.json              the guide (section 2)
images/<stepId>.png     one screenshot per step that has one
```

Rules for writing (`packBundle`):

- Byte-stable: the same guide and images always give the same bytes, on every machine and in every time zone. Entries are sorted (`guide.json` first, then `images/...` by name), every entry has the fixed DOS timestamp 1980-01-01 00:00:00, and `guide.json` is written with object keys sorted, two-space indent and a trailing newline.
- Only screenshots the guide references are stored. Images are stored, not deflated (PNG is already compressed).
- The guide must validate and every referenced screenshot must be supplied, otherwise packing fails with a typed error.

Rules for reading (`unpackBundle`): every failure is a typed error (`BundleError`, or `GuideValidationError` for a bad `guide.json`), never a partial result. It rejects:

- entries whose name is not a safe relative path (`..`, absolute paths, backslashes, drive letters, empty segments),
- more than 2000 entries, any entry over 256 MB, or more than 512 MB unpacked in total,
- an entry whose size or CRC-32 does not match the zip's central directory,
- a missing or non-UTF-8 or non-JSON `guide.json`, or one that fails validation,
- screenshots the guide references that are missing from the zip (the error lists the paths).

Entries other than `guide.json` and `images/...` are ignored. Older schema versions are migrated on the way in.

## 2. `guide.json` (schema version 1)

```jsonc
{
  "schemaVersion": 1,
  "id": "g_ab12",                       // string, unique per guide
  "title": "Update billing settings",   // plain text, at most 2000 characters
  "description": "Markdown paragraph",  // optional
  "createdAt": "2026-09-28T10:00:00Z",  // ISO 8601
  "updatedAt": "2026-09-28T10:04:00Z",  // ISO 8601, not before createdAt
  "app": { "name": "showsteps", "version": "0.1.0" },   // optional; "stepsnap" is read as the old name
  "settings": {                                          // optional
    "highlightColor": "#EB4E26",        // CSS colour, default is the brand persimmon
    "redactStyle": "blur",              // manual redactions: "blur" | "pixelate" | "solid" (automatic ones are always "mask")
    "includeUrls": true                 // show page URLs in human exports (default true)
  },
  "steps": [ /* at most 5000 */ ]
}
```

### Step

```jsonc
{
  "id": "s_email",                        // url-safe ([A-Za-z0-9_-]+), unique in the guide
  "action": { "type": "type", "value": "jane@example.com" },
  "target": { /* ElementDescriptor, absent for navigate, note and scroll */ },
  "title": "Type \"jane@example.com\" in **Email**",   // Markdown inline; at most 2000 characters
  "titleEdited": false,                   // true once a person edited it; regeneration keeps it
  "description": "Optional Markdown",
  "page": { "url": "https://app.acme.test/login", "title": "Sign in", "tabId": 101, "dir": "ltr" },
  "screenshot": { /* section below, optional */ },
  "timestamp": "2026-09-28T10:00:04Z",    // ISO 8601
  "skipped": false                        // hidden from every export, kept in the file
}
```

`page.tabId` groups steps by browser tab (any number; the order of first appearance is what matters). `page.dir` (`"ltr"` or `"rtl"`, optional) tells the renderers to flip the highlight tab to the left for right-to-left pages.

### Actions

| `type` | fields | notes |
|---|---|---|
| `navigate` | `url` | |
| `click` | `button?` (`left`, `right`, `middle`), `double?` | |
| `type` | `value`, `masked?` | A masked step must have `value` `""` or `"•••"`: the real value is never stored. `validateGuide` rejects anything else. |
| `select` | `value`, `optionText?` | |
| `check` | `checked` | checkbox, radio or switch |
| `press` | `key` | `Enter`, `Control+K`, `Meta+Shift+P` |
| `scroll` | `x`, `y` | scroll deltas; not recorded by the extension, allowed in agent-written guides |
| `hover` | | |
| `note` | | a human-only step |

### Element descriptor (`target`)

```jsonc
{
  "tag": "input",
  "role": "textbox", "name": "Email", "label": "Email", "text": "", "placeholder": "you@company.com",
  "inputType": "email", "href": null,
  "sensitive": false,                     // password, card, OTP, SSN-like, or user-marked
  "locators": [                           // at least one, best first
    { "kind": "testid", "value": "email" },
    { "kind": "role", "role": "textbox", "name": "Email" },
    { "kind": "label", "value": "Email" },
    { "kind": "placeholder", "value": "you@company.com" },
    { "kind": "text", "value": "Sign in", "exact": true },
    { "kind": "css", "value": "form input[type=email]" },
    { "kind": "xpath", "value": "//form//input[1]" }
  ],
  "frame": ["iframe[name=\"card-frame\"]"],   // iframe selectors, outermost first
  "shadow": ["my-app", "app-toolbar"]          // shadow-host selectors, outermost first
}
```

### Screenshot

```jsonc
{
  "image": "images/s_email.png",          // must start with images/; no "..", no absolute path, no backslash
  "width": 2880, "height": 1800,          // image pixels (at least 1)
  "devicePixelRatio": 2,                  // greater than 0
  "viewport": { "width": 1440, "height": 900, "scrollX": 0, "scrollY": 0 },   // CSS px
  "highlight": { "x": 960, "y": 600, "width": 960, "height": 88, "corner": "top-right" },   // target box in image px, drawn at export, never baked in; `corner` (optional): where the recorder found the least text for the numbered tab; `labelRect` (optional): the box of a checkbox, radio or switch's `<label>`, so a control smaller than the minimum ring is ringed together with its label, and a label sitting right above a text field is kept clear of the ring
  "redactions": [ { "rect": { "x": 944, "y": 584, "width": 992, "height": 120 }, "style": "mask", "auto": true, "label": "Password" } ],   // style: blur | pixelate | solid | mask; label: what was covered
  "crop": { "x": 0, "y": 0, "width": 2880, "height": 1200 }   // optional export crop, image px
}
```

Every rectangle must lie inside the image (`0 <= x`, `x + width <= width`, same for y). `redactions` with `"auto": true` are already burnt into the stored PNG when they come from the extension; exporters bake all redactions again anyway, which is harmless. Manual redactions (no `auto`) are metadata until export.

### What `validateGuide` checks

It returns `{ ok: true, guide }` or `{ ok: false, errors }` with one readable string per problem, each starting with a path such as `guide.steps[3].screenshot.highlight`. It never throws. Beyond the shapes above it rejects: a missing or unsupported `schemaVersion`, duplicate or unsafe step ids, unknown action or locator kinds, an empty `locators` array, non-finite numbers, rectangles outside their image, screenshot paths outside `images/`, `updatedAt` before `createdAt`, titles over 2000 characters, more than 5000 steps, `__proto__` keys, nesting deeper than 40 levels, and values that JSON cannot hold (functions, class instances such as `Date`). Unknown extra fields are allowed and kept. `migrateGuide` upgrades old versions, validates, and throws `GuideValidationError` (with `.errors`) if the result is not usable.

### Step titles

`generateStepTitle` writes one line of natural English per step, element names in `**bold**`: `Click **Save**`, `Type "jane@example.com" in **Email**`, `Select **Monthly** in **Billing period**`, `Check **Remember me**`, `Press **Enter**`, `Go to **Settings** on Acme`. A page title is split on ` – `, ` — `, ` | `, ` - ` or ` · `: the first part is the page name and the last part the site; `on <site>` is added only when the site differs from the previous step's (`generateStepTitle(step, { previousPage })`). `defaultGuideTitle(pageTitle, url)` turns "Sign in – Acme Books" into "Acme Books: Sign in" (no date). Masked or sensitive values never appear (`Enter your password`, `Fill in **Card number**`). Titles are at most 160 characters. `regenerateTitles` rewrites every title except those with `titleEdited: true` and note steps.

## 3. The agent skill: `SKILL.md`, `steps.json`, `replay.spec.ts`

`exportAgentSkill` writes a folder an agent (or Playwright) can use. Optionally an `images/` folder with the rendered screenshots.

### `SKILL.md`

YAML frontmatter with two keys, then plain Markdown:

```markdown
---
name: "update-billing-settings-in-acme"
description: "Replay or walk through the \"Update billing settings in Acme\" workflow recorded in a browser (10 steps, starting at app.acme.test). Use when the user wants to do this task, check that it still works, or run it with Playwright."
---
```

`name` is lowercase letters, digits and single hyphens, at most 64 characters, never containing `claude` or `anthropic`. `description` is one line, at most 1024 characters, and says what the skill does and when to use it. The body explains how to replay, lists the environment variables for masked fields, and numbers every step with its locator hint, tab and page.

### `steps.json` (format `showsteps-steps`, version 1)

Written with sorted keys. Validate it with `packages/core/schema/steps.schema.json` (JSON Schema 2020-12, also exported as `STEPS_JSON_SCHEMA`). It never contains image data or a masked value.

```jsonc
{
  "format": "showsteps-steps",
  "version": 1,
  "generator": { "name": "Showsteps", "url": "https://showsteps.vercel.app" },
  "guide": { "id": "g_ab12", "title": "…", "description": "…", "createdAt": "…", "stepCount": 10, "tabCount": 2 },
  "startUrl": "https://app.acme.test/login",
  "viewport": { "width": 1440, "height": 900 },
  "secrets": [ { "env": "SHOWSTEPS_SECRET_1", "step": 3, "field": "Password" } ],
  "steps": [
    {
      "index": 2,                          // 1-based among exported (non-skipped) steps
      "id": "s_email",
      "title": "Type \"jane@example.com\" in Email",           // plain text
      "titleMarkdown": "Type \"jane@example.com\" in **Email**",
      "action": { "type": "type", "value": "jane@example.com" },   // masked: { "type": "type", "masked": true, "secret": "SHOWSTEPS_SECRET_1" }
      "locators": [ { "kind": "label", "value": "Email" } ],       // best first; [] when the step has no element
      "frame": [], "shadow": [],
      "element": { "tag": "input", "role": "textbox", "label": "Email", "inputType": "email" },   // `text` is left out for text fields
      "page": { "url": "https://app.acme.test/login", "title": "Sign in", "tabIndex": 1 },
      "replay": { "replayable": true, "playwright": "await page.getByLabel(\"Email\").fill(\"jane@example.com\");" },
      "screenshot": "images/s_email.png"   // only when images were exported
    }
  ]
}
```

Steps that cannot be replayed (a note, an element with no locator, a character typed into a password field) have `replay.replayable: false` and a `replay.note` that says why.

### `replay.spec.ts`

An idiomatic `@playwright/test` file. Replay semantics:

- Locators: the first usable entry of `locators`: `getByTestId`, `getByRole(role, { name })`, `getByLabel`, `getByPlaceholder`, `getByText` (with `exact: true` when the locator says so), then `locator(css)` or `locator("xpath=...")`. Role, label and placeholder use Playwright's default matching (the recorder checked they are unique). A role Playwright does not know, or a role without a name, is skipped in favour of the next locator. XPath is never used inside a shadow root.
- Frames become `frameLocator(selector)` chains; shadow hosts become `locator(host)` chains.
- The first tab is `context.newPage()`. When a step belongs to a tab no earlier step used, the previous step's action is wrapped as `[pageN] = await Promise.all([context.waitForEvent("page"), <previous action>])`; when it belongs to a tab already seen, the script calls `bringToFront()`. Steps with no `tabId` share one page. If nothing preceded a new tab (a guide written by an agent), the script opens it with `context.newPage()` and goes to its page.
- A `navigate` step in the first tab, or in a tab that already exists, is `page.goto(url)`; in a tab the previous action just opened there is no `goto`, only `waitForLoadState("domcontentloaded")`. Every navigate step is followed by `await expect(page).toHaveURL(...)` on origin and path only (query and fragment are ignored). If the recording did not begin with a navigation, the script opens the first page before step 1.
- Values: literal for ordinary fields. `select` uses `selectOption({ label })` (or the value), `check` uses `setChecked(checked)`, `press` uses `press(key)` on the target or `page.keyboard.press(key)`.
- Secrets: a masked or sensitive `type` step fills from `process.env.SHOWSTEPS_SECRET_<n>` (`n` counts the masked steps from 1). The test starts with `test.skip(!process.env.SHOWSTEPS_SECRET_<n>, "set SHOWSTEPS_SECRET_<n>")`, so a missing variable skips the replay instead of failing it. No generated file ever contains the secret, even if the guide held one by mistake.
- `test.use({ viewport })` restores the recorded viewport; each step is a `test.step` named after its title.

## 4. Human exports

| Export | Files | Notes |
|---|---|---|
| Markdown | `guide.md`, `images/<id>.png` | `## N. Title`, description, image, page link. Skipped steps are left out and the rest renumbered. URLs are shown without query string or fragment. |
| HTML | one `.html` | Images inlined as data URIs, brand fonts embedded, print CSS for a clean "Save as PDF", no scripts, no network requests. A sticky table of contents (over 8 steps, wide screens), a "That's it" end marker, and on phones a zoomed detail image per step (`<picture>`). The URL caption is shown only when the page changes. |
| PDF | one `.pdf` | pdf-lib; two landscape steps per page; no cover page (page 1 has the step count, the title, the description and step 1), the highlight drawn as vectors, Rethink Sans (static instances), Fragment Mono for URLs, Source Sans 3 for Cyrillic and Greek. |
| DOCX | one `.docx` | `docx`; numbered headings, screenshots with the highlight baked in. |

All of them render screenshots the same way: redactions burnt into the pixels (mask, solid, pixelate or blur), then the crop, then the click target highlighted with a persimmon ring, a white keyline and a numbered tab, everything else dimmed by 12 percent. A `mask` redaction replaces a form field with its own background colour, rounded like a field, with a row of eight dots. The ring grows if needed so the tab always fits on it (a 16 px checkbox), and the tab grows out of `highlight.corner` when present (otherwise top-right, top-left for right-to-left pages), staying inside the image. The Showsteps credit ("Made with Showsteps") is off by default in every export; pass `branding: true` to add it. Exports are deterministic: the same guide gives the same bytes. PDF and DOCX take their creation date from the guide's own dates unless the caller passes `now`.

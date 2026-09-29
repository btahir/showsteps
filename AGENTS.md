# Stepsnap for agents

Stepsnap turns a recorded browser task into a step-by-step guide. A person records it in the Chrome extension; you (an agent) can read, fix, export and create guides from files, with no network, no account and no API key.

What you can do:

- Validate and inspect a guide file.
- Rewrite step titles and descriptions, hide steps, regenerate titles.
- Export Markdown, self-contained HTML, PDF, DOCX, a Playwright script, or a replayable agent skill.
- Create a guide from steps you write (no screenshots needed), then hand the file to a person to open in the extension.

Everything below works offline on local files. Passwords and other sensitive fields are never stored in a guide: typed values in those fields are masked as `•••` and no tool prints them.

## Files

A guide is either:

- `something.stepsnap`: a zip with `guide.json` and `images/<stepId>.png`, or
- a bare `guide.json` (screenshots are picked up from an `images/` folder next to it, if present).

Every command and tool accepts both. Schema (versioned, v1): [docs/schema.md](docs/schema.md). Key fields: `title`, `steps[]` with `id`, `action`, `target` (name, role, locators), `title`, `description`, `page.url`, `skipped`.

## CLI

```sh
npx -y @stepsnap/cli --help
# or, from a checkout: pnpm --filter @stepsnap/cli build && node packages/cli/dist/stepsnap.js --help
```

| Command | What it does |
| --- | --- |
| `stepsnap validate <file> [--json]` | Checks the file against the schema. Exit 1 lists every problem. |
| `stepsnap info <file> [--json]` | Title, step counts, actions, pages, sensitive steps, screenshot counts. |
| `stepsnap steps <file> [--json]` | Steps with id, title, action, target, skipped and sensitive flags. |
| `stepsnap edit-step <file> --id <id> [--title T] [--description D] [--skip\|--unskip] [--out F]` | Edit one step. Overwrites `<file>` unless `--out` is given. |
| `stepsnap regen-titles <file> [--out F]` | Regenerate generated titles. Hand-edited titles are kept. |
| `stepsnap export <file> --format md\|html\|pdf\|docx\|playwright\|skill\|all --out <dir> [--json]` | Write exports. Comma lists work: `--format md,pdf`. |
| `stepsnap new --from-steps <steps.json> --out <file.stepsnap> [--title T]` | Create a guide from a step list. |

Rules an agent can rely on:

- `--json` prints exactly one JSON object on stdout and nothing else. It always has `"ok": true|false`. Failures look like `{"ok": false, "error": {"code": "invalid|usage|io", "message": "...", "errors": [...]}}`.
- Human messages and errors go to stderr.
- Exit codes: `0` ok, `1` invalid input (bad guide, unknown step id, bad steps file), `2` usage error (unknown flag, missing argument), `3` file error (missing or unwritable path).
- Relative paths resolve against the current directory.
- `SOURCE_DATE_EPOCH` fixes timestamps written by `new` and by edits, for reproducible output.

### Export layout

`--out <dir>` receives:

| Format | Files |
| --- | --- |
| `md` | `guide.md`, `images/*.png` |
| `html` | `guide.html` (one file, images inlined, print-ready) |
| `pdf` | `guide.pdf` |
| `docx` | `guide.docx` |
| `playwright` | `replay.spec.ts` |
| `skill` | `skill/SKILL.md`, `skill/steps.json`, `skill/replay.spec.ts` |

`--json` returns `{"ok": true, "files": ["/abs/path", ...]}`. Steps with `skipped: true` are left out of every export.

### Worked example: fix wording, then export

```sh
stepsnap info onboarding.stepsnap --json
stepsnap steps onboarding.stepsnap --json          # find the step ids
stepsnap edit-step onboarding.stepsnap --id s4 \
  --title "Open **Billing** in the sidebar" \
  --description "You need the Admin role to see this." --out reviewed.stepsnap
stepsnap export reviewed.stepsnap --format md,pdf,skill --out ./out --json
```

### Worked example: write a guide from scratch

`steps.json` (an array, or `{ "title": ..., "steps": [...] }`):

```json
{
  "title": "Reset your password",
  "steps": [
    { "action": "navigate", "url": "https://app.example.com/login" },
    { "action": "click", "target": "Forgot password" },
    { "action": "type", "target": "Email", "value": "jane@example.com" },
    { "action": "type", "target": "New password", "masked": true },
    { "action": "click", "target": "Reset password" },
    { "action": "note", "title": "Check your inbox for the confirmation email." }
  ]
}
```

```sh
stepsnap new --from-steps steps.json --out reset-password.stepsnap --json
stepsnap export reset-password.stepsnap --format skill --out ./skill --json
```

Step fields: `action` (`navigate`, `click`, `type`, `select`, `check`, `press`, `scroll`, `hover`, `note`), `title` (generated when omitted, required for `note`), `description`, `target` (element name, or `{role, name, label, text, placeholder}`), `url`, `value`, `optionText`, `key`, `checked`, `masked`, `page` (`{url, title}`), `skipped`. Later steps inherit the last URL. Guide-level: `title`, `description`, `id`, `startUrl`. Titles you give are treated as hand-edited and survive `regen-titles`. Every problem in the file is reported at once, so fix them in one pass.

Guides made this way have no screenshots. Exports still work; a person can open the file in the extension to review it.

## MCP server

`stepsnap-mcp` speaks MCP over stdio. It needs no network and no keys. Files are passed by absolute path.

Claude Code:

```sh
claude mcp add stepsnap -- npx -y @stepsnap/mcp
```

Claude Desktop (`claude_desktop_config.json`) and Cursor (`.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "stepsnap": { "command": "npx", "args": ["-y", "@stepsnap/mcp"] }
  }
}
```

From a checkout, build first (`pnpm --filter @stepsnap/mcp build`) and use `"command": "node", "args": ["/abs/path/to/stepsnap/packages/mcp/dist/stepsnap-mcp.js"]`.

| Tool | Inputs | Returns |
| --- | --- | --- |
| `validate_guide` | `path` | `{valid, steps}` or `{valid: false, errors}` |
| `guide_info` | `path` | title, counts, actions, pages, sensitive steps |
| `list_steps` | `path`, `include_skipped?` | ordered steps with ids |
| `edit_step` | `path`, `step_id`, `title?`, `description?`, `skipped?`, `out_path?` | updated step and changed fields |
| `regenerate_titles` | `path`, `out_path?` | number of titles changed |
| `export_guide` | `path`, `format`, `out_dir` | absolute paths written |
| `create_guide_from_steps` | `out_path`, `title`, `steps[]`, `description?`, `start_url?` | path, id, step count |

Results are JSON in both the text content and `structuredContent`. Invalid guide content is reported as data by `validate_guide`; everything else that fails (missing file, unknown step id, relative path, malformed steps) returns `isError: true` with `error.code` of `invalid`, `usage` or `io` and the list of problems.

`edit_step` and `regenerate_titles` overwrite the file unless you pass `out_path`. Prefer `out_path` when a person has not asked you to change the original.

## Working with people

The recording is a human's account of a task. Suggested split: you fix wording, structure and exports; the person reviews screenshots and redactions in the extension (`.stepsnap` files open there directly) before sharing. Send them the file path, not the contents.

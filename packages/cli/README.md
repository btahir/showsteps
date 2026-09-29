# @stepsnap/cli

Command line for [Showsteps](../../README.md) guides: validate, inspect, edit and export. Local only, no network, no account. Made for people and for agents (`--json`, stable exit codes).

```sh
npx -y @stepsnap/cli export onboarding.showsteps --format md,pdf --out ./out
```

Requires Node 20 or newer. From a checkout: `pnpm --filter @stepsnap/cli build`, then `node packages/cli/dist/showsteps.js`.

## Commands

```
showsteps validate <file> [--json]
showsteps info <file> [--json]
showsteps steps <file> [--json]
showsteps edit-step <file> --id <id> [--title T] [--description D] [--skip | --unskip] [--out F] [--json]
showsteps regen-titles <file> [--out F] [--json]
showsteps export <file> --format md|html|pdf|docx|playwright|skill|all --out <dir> [--no-images] [--skill-name N] [--skill-description D] [--json]
showsteps new --from-steps <steps.json> --out <file.showsteps|file.json> [--title T] [--json]
```

`<file>` is a `.showsteps` bundle or a bare `guide.json`.

## Output and exit codes

| Code | Meaning |
| --- | --- |
| 0 | ok |
| 1 | invalid input: guide fails validation, unknown step id, bad steps file |
| 2 | usage error: unknown command or option, missing argument |
| 3 | file error: missing, unreadable or unwritable path |

With `--json`, stdout carries exactly one JSON object with `"ok": true|false`; failures add `"error": {"code", "message", "errors"?}`. Errors and human messages go to stderr.

Example:

```
$ showsteps validate onboarding.showsteps --json
{"ok":true,"file":"/work/onboarding.showsteps","valid":true,"format":"bundle","schemaVersion":1,"steps":6}
```

## Export layout

| Format | Written to `--out` |
| --- | --- |
| `md` | `guide.md`, `images/` |
| `html` | `guide.html`, one self-contained file |
| `pdf` | `guide.pdf` |
| `docx` | `guide.docx` |
| `playwright` | `replay.spec.ts` |
| `skill` | `skill/SKILL.md`, `skill/steps.json`, `skill/replay.spec.ts`, `skill/images/` |

`--format all` writes everything; a comma list (`md,pdf`) writes several. Skipped steps are omitted. Screenshots are re-rendered with redactions baked in; raw screenshots are never written. `--no-images` leaves them out of `md` and `skill`. With `skill`, `--json` also returns `skill.name` and `skill.dir`. Values typed into sensitive fields are never stored; the skill names an environment variable per field (`SHOWSTEPS_SECRET_1`, ...) to set before replaying.

## Creating a guide from steps

See the step fields and a full example in [AGENTS.md](../../AGENTS.md#worked-example-write-a-guide-from-scratch).

## Library use

`@stepsnap/cli/ops` exports the same operations the commands use (`guideInfo`, `listSteps`, `editStep`, `createGuideFromSteps`, `exportGuideFiles`, and more). The MCP server is built on it.

## Development

```sh
pnpm --filter @stepsnap/cli test        # vitest: golden output, exit codes, built binary
pnpm --filter @stepsnap/cli typecheck
pnpm --filter @stepsnap/cli build       # dist/showsteps.js, core bundled in
```

MIT. Free forever; if it saves you time, support it at https://showsteps.vercel.app/support/

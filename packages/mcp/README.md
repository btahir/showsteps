# @stepsnap/mcp

[Model Context Protocol](https://modelcontextprotocol.io) server (stdio) for [Showsteps](../../README.md) guides. Lets an agent validate, inspect, edit and export step-by-step guides, and create new ones from a step list. Fully local: no network, no keys. Files are passed by absolute path.

Requires Node 20 or newer.

## Configure

Claude Code:

```sh
claude mcp add showsteps -- npx -y @stepsnap/mcp
```

Claude Desktop (`claude_desktop_config.json`) or Cursor (`.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "showsteps": { "command": "npx", "args": ["-y", "@stepsnap/mcp"] }
  }
}
```

From a checkout: `pnpm --filter @stepsnap/mcp build`, then point `command` at `node` with `args: ["/abs/path/to/stepsnap/packages/mcp/dist/showsteps-mcp.js"]`.

## Tools

| Tool | Inputs | Result |
| --- | --- | --- |
| `validate_guide` | `path` | `{valid: true, steps}` or `{valid: false, errors}` |
| `guide_info` | `path` | title, step counts, action counts, pages, sensitive steps, screenshot counts |
| `list_steps` | `path`, `include_skipped` (default true) | steps with id, index, title, action, target, page URL, flags |
| `edit_step` | `path`, `step_id`, `title?`, `description?`, `skipped?`, `out_path?` | `{out, changed, step}` |
| `regenerate_titles` | `path`, `out_path?` | `{out, changed, steps}` |
| `export_guide` | `path`, `format` (`md`, `html`, `pdf`, `docx`, `playwright`, `skill`, `all`), `out_dir`, `include_images?`, `credit?`, `skill_name?`, `skill_description?` | `{files: [absolute paths], skill?: {name, dir}}` |
| `create_guide_from_steps` | `out_path`, `title`, `steps[]`, `description?`, `start_url?` | `{out, id, title, steps}` |

Each result is JSON in the text content and in `structuredContent`. A guide that fails validation is data for `validate_guide`. Other failures (missing file, unknown step id, relative path, malformed steps) come back with `isError: true` and `error.code` of `invalid`, `usage` or `io`.

`edit_step` and `regenerate_titles` overwrite `path` unless `out_path` is set. Sensitive values (passwords, codes) are stored masked as `•••` and never returned.

Step format, export layout and worked examples: [AGENTS.md](../../AGENTS.md).

## Development

```sh
pnpm --filter @stepsnap/mcp test        # spawns the built server, drives it with the SDK client
pnpm --filter @stepsnap/mcp typecheck
pnpm --filter @stepsnap/mcp build       # dist/showsteps-mcp.js, core bundled in
```

MIT. Free forever; if it saves you time, support it at https://showsteps.vercel.app/support/

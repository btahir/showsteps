import { KEYWORD_PAGES } from "../data/keyword-pages";
import { SITE_NAME, SITE_URL, GITHUB_URL, abs } from "../config/site";
import { SUMMARY } from "../data/markdown";

export function GET() {
  const body = `# ${SITE_NAME}

> ${SUMMARY}

Showsteps records a click-through in Chrome and produces an annotated step-by-step guide (PDF, HTML, Markdown, DOCX) and a replayable agent skill (SKILL.md, steps.json, Playwright replay.spec.ts). Everything is stored locally; there is no account, no analytics and no network access after install. A CLI and a local MCP server let agents inspect, edit and export guides.

## For agents

- [Agents guide: CLI and MCP](${abs("/docs/agents/")}): commands, JSON output, exit codes, MCP tools, file format, worked examples
- [AGENTS.md](${GITHUB_URL}/blob/main/AGENTS.md): the same content in the repository
- [Full text of this site](${abs("/llms-full.txt")}): every page in one Markdown file

## CLI and MCP

Run \`npx -y @showsteps/cli <command>\` (binary: showsteps). Every command takes a .showsteps file or a guide.json, and \`--json\` prints one JSON object with "ok" true or false. Exit codes: 0 ok, 1 invalid input, 2 usage, 3 file error.

- \`showsteps validate <file>\`: check a guide against the schema
- \`showsteps info <file>\`: title, step counts, actions, pages, sensitive steps
- \`showsteps steps <file>\`: list steps with ids
- \`showsteps edit-step <file> --id <id> [--title T] [--description D] [--skip|--unskip] [--out F]\`
- \`showsteps regen-titles <file>\`: regenerate generated titles, keep edited ones
- \`showsteps export <file> --format md|html|pdf|docx|playwright|skill|all --out <dir>\`
- \`showsteps new --from-steps <steps.json> --out <file.showsteps>\`: create a guide from a step list

MCP server: \`showsteps-mcp\` (stdio, no network, no keys; \`claude mcp add showsteps -- npx -y @showsteps/mcp\`). Tools: validate_guide, guide_info, list_steps, edit_step, regenerate_titles, export_guide, create_guide_from_steps. Files are passed by absolute path.

Schema: the steps.json written by the skill export follows ${abs("/schema/steps.schema.json")} (JSON Schema 2020-12). The .showsteps project is a zip with guide.json and images/<stepId>.png; guide.json carries a schema version (v1).

## Guides

${KEYWORD_PAGES.map((p) => `- [${p.label}](${abs(`/${p.slug}/`)}): ${p.description}`).join("\n")}

## Project

- [Privacy](${abs("/privacy/")}): what is stored, what leaves the device, every permission
- [About](${abs("/about/")})
- [Changelog](${abs("/changelog/")})
- [Support](${abs("/support/")}): optional donations; every feature is free
- [Source](${GITHUB_URL}): MIT licence
- [Sitemap](${SITE_URL}/sitemap.xml)
`;
  return new Response(body, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
}

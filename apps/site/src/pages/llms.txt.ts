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

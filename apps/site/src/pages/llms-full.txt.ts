import { KEYWORD_PAGES } from "../data/keyword-pages";
import { SITE_NAME, abs } from "../config/site";
import { SUMMARY, agentsMd, pageMd } from "../data/markdown";
import { LANDING_FAQ } from "../data/samples";
import { md, compareMd } from "../data/markdown";

export function GET() {
  const parts = [
    `# ${SITE_NAME}: full site text`,
    `> ${SUMMARY}`,
    `## Frequently asked questions\n\n${LANDING_FAQ.map((f) => `**${md(f.q)}**\n${md(f.a)}`).join("\n\n")}`,
    `## Comparison with Mimik, Scribe and Tango\n\n${compareMd()}`,
    `## Privacy\n\nNo server, no account, no analytics, no network requests after install. Guides and screenshots are stored in the browser's IndexedDB. Password and card fields are detected while recording; typed values are never saved and screenshots are blurred over the field. Permissions: activeTab, scripting, storage, sidePanel, unlimitedStorage, and optional access to all sites requested only when recording starts. Full page: ${abs("/privacy/")}`,
    `## Agents guide (mirrors AGENTS.md)\n\n${agentsMd()}`,
    ...KEYWORD_PAGES.map(pageMd),
  ];
  return new Response(parts.join("\n\n---\n\n") + "\n", { headers: { "Content-Type": "text/plain; charset=utf-8" } });
}

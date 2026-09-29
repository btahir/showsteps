import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { COMPARE_ROWS, COMPARE_DATE } from "./compare";
import type { Block, KeywordPage } from "./keyword-pages";
import { GITHUB_URL, SITE_DESCRIPTION, SITE_URL, SUPPORT_URL, abs, fill } from "../config/site";

const ENT: Record<string, string> = { "&ldquo;": '"', "&rdquo;": '"', "&rsquo;": "'", "&lsquo;": "'", "&amp;": "&", "&lt;": "<", "&gt;": ">", "&mdash;": "-" };

/** Convert the small HTML subset used in content strings to Markdown. */
export function md(html: string): string {
  let s = fill(html);
  s = s.replace(/<a [^>]*href="([^"]+)"[^>]*>(.*?)<\/a>/g, (_, href: string, text: string) => `[${text}](${href.startsWith("/") ? abs(href) : href})`);
  s = s.replace(/<(strong|b)>(.*?)<\/\1>/g, "**$2**").replace(/<(em|i)>(.*?)<\/\1>/g, "*$2*").replace(/<code>(.*?)<\/code>/g, "`$1`");
  s = s.replace(/<[^>]+>/g, "");
  return s.replace(/&[a-z]+;/g, (m) => ENT[m] ?? m);
}

function table(head: string[], rows: string[][]): string {
  const h = head.map((c) => c || " ");
  return [`| ${h.join(" | ")} |`, `|${h.map(() => "---").join("|")}|`, ...rows.map((r) => `| ${r.map((c) => md(c).replace(/\|/g, "/")).join(" | ")} |`)].join("\n");
}

export function compareMd(): string {
  return [
    table(["", "Showsteps", "Mimik", "Scribe", "Tango"], COMPARE_ROWS.map((r) => [r.feature, r.showsteps, r.mimik, r.scribe, r.tango])),
    `\nCompetitor details are from each vendor's own pages (Mimik: its README) as of ${COMPARE_DATE}. Plans and prices change.`,
  ].join("\n");
}

function blockMd(b: Block): string {
  if ("p" in b) return md(b.p);
  if ("ul" in b) return b.ul.map((x) => `- ${md(x)}`).join("\n");
  if ("ol" in b) return b.ol.map((x, i) => `${i + 1}. ${md(x)}`).join("\n");
  if ("code" in b) return "```\n" + b.code + "\n```";
  if ("callout" in b) return `> ${md(b.callout)}`;
  if ("table" in b) return table(b.table.head, b.table.rows);
  if ("compare" in b) return compareMd();
  return "";
}

export function pageMd(p: KeywordPage): string {
  const out = [`## ${p.h1}`, `URL: ${abs(`/${p.slug}/`)}`, "", md(p.lede)];
  for (const s of p.sections) out.push("", `### ${s.h2}`, "", ...s.blocks.map((b) => blockMd(b) + "\n"));
  out.push("", "### Questions", "");
  for (const f of p.faq) out.push(`**${md(f.q)}**`, md(f.a), "");
  return out.join("\n");
}

export function agentsMd(): string {
  const file = resolve(process.cwd(), "../../AGENTS.md");
  if (existsSync(file)) return readFileSync(file, "utf8");
  return `See ${abs("/docs/agents/")}`;
}

export const SUMMARY = `${SITE_DESCRIPTION} Chrome only; records browser tabs, not desktop or mobile apps. MIT licensed. Site: ${SITE_URL}. Source: ${GITHUB_URL}. Support (optional, everything is free): ${abs(SUPPORT_URL)}.`;

import { escapeHtml, parseInline } from "./text";

/**
 * Tiny, safe Markdown to HTML for guide and step descriptions. Supports paragraphs (newlines become
 * `<br>`), `-`/`*` and `1.` lists, `>` quotes, fenced code, `#` headings (rendered as bold lines so
 * the page outline stays clean), `---`, and inline bold/italic/code/links. Everything is escaped;
 * only http, https and mailto links are kept. Pure, no DOM.
 */

const SAFE_HREF = /^(https?:\/\/|mailto:)/i;

export function renderInlineHtml(md: string): string {
  return parseInline(md)
    .map((r) => {
      let html = escapeHtml(r.text);
      if (r.code) html = `<code>${html}</code>`;
      if (r.italic) html = `<em>${html}</em>`;
      if (r.bold) html = `<b>${html}</b>`;
      if (r.href !== undefined && SAFE_HREF.test(r.href)) {
        html = `<a href="${escapeHtml(r.href)}" rel="noopener noreferrer">${html}</a>`;
      }
      return html;
    })
    .join("");
}

export function renderMarkdownHtml(md: string): string {
  const lines = md.replace(/\r\n?/g, "\n").split("\n");
  const out: string[] = [];
  let para: string[] = [];
  const flushPara = (): void => {
    if (para.length) {
      out.push(`<p>${para.map(renderInlineHtml).join("<br>")}</p>`);
      para = [];
    }
  };
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] as string;
    if (/^\s*$/.test(line)) {
      flushPara();
      i++;
    } else if (/^\s*```/.test(line)) {
      flushPara();
      const code: string[] = [];
      i++;
      while (i < lines.length && !/^\s*```/.test(lines[i] as string)) code.push(lines[i++] as string);
      i++; // closing fence
      out.push(`<pre><code>${escapeHtml(code.join("\n"))}</code></pre>`);
    } else if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      flushPara();
      out.push("<hr>");
      i++;
    } else if (/^#{1,6}\s+/.test(line)) {
      flushPara();
      out.push(`<p><b>${renderInlineHtml(line.replace(/^#{1,6}\s+/, ""))}</b></p>`);
      i++;
    } else if (/^\s*>\s?/.test(line)) {
      flushPara();
      const q: string[] = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i] as string)) q.push((lines[i++] as string).replace(/^\s*>\s?/, ""));
      out.push(`<blockquote>${renderMarkdownHtml(q.join("\n"))}</blockquote>`);
    } else if (/^\s*([-*+])\s+/.test(line) || /^\s*\d+[.)]\s+/.test(line)) {
      flushPara();
      const ordered = /^\s*\d+[.)]\s+/.test(line);
      const re = ordered ? /^\s*\d+[.)]\s+/ : /^\s*([-*+])\s+/;
      const items: string[] = [];
      while (i < lines.length && re.test(lines[i] as string)) {
        let item = (lines[i++] as string).replace(re, "");
        while (i < lines.length && /^\s{2,}\S/.test(lines[i] as string) && !re.test(lines[i] as string)) item += "\n" + (lines[i++] as string).trim();
        items.push(item);
      }
      const tag = ordered ? "ol" : "ul";
      out.push(`<${tag}>${items.map((it) => `<li>${it.split("\n").map(renderInlineHtml).join("<br>")}</li>`).join("")}</${tag}>`);
    } else {
      para.push(line.trim());
      i++;
    }
  }
  flushPara();
  return out.join("\n");
}

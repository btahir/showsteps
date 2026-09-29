import type { Guide, Step } from "../schema";
import { PRODUCT_NAME, SITE_URL } from "../brand";
import { renderInlineHtml, renderMarkdownHtml } from "../markdown-html";
import { pngSize } from "../png";
import { bytesToBase64, escapeHtml, plainTitle } from "../text";
import type { ImageSource } from "../types";
import { HTML_CSS, HTML_FONT_FACES } from "./html-css";
import { displayUrl, formatDate, renderGuideImages, resolveIncludeUrls, sniffImageMime, visibleSteps, type ImageRenderOptions } from "./shared";

export interface HtmlOptions extends ImageRenderOptions {
  /** Show the page URL under each screenshot. Default: `guide.settings.includeUrls`, else true. */
  includeUrls?: boolean;
  /** "Made with Showsteps" footer. Default true. */
  branding?: boolean;
  /** `auto` follows the reader's system theme (print is always light). Default "auto". */
  theme?: "auto" | "light" | "dark";
  /** Extra CSS appended after the built-in stylesheet, e.g. brand tokens. */
  css?: string;
  /** `lang` attribute of the page. Default "en". */
  lang?: string;
  /** Embed Rethink Sans and Fragment Mono (about 100 KB). Default true; false falls back to system fonts. */
  embedFonts?: boolean;
}

const LINK_ICON =
  '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M8.5 11.5a3 3 0 004.2 0l3-3a3 3 0 00-4.2-4.2l-1 1M11.5 8.5a3 3 0 00-4.2 0l-3 3a3 3 0 004.2 4.2l1-1"/></svg>';

function minutes(stepCount: number): string {
  const m = Math.max(1, Math.ceil(stepCount / 3));
  return m === 1 ? "ABOUT 1 MINUTE" : `ABOUT ${m} MINUTES`;
}

function stepHtml(step: Step, n: number, images: ImageSource, includeUrls: boolean): string {
  const shot = step.screenshot;
  const bytes = shot ? images[shot.image] : undefined;
  const parts: string[] = [];
  parts.push(`<li class="step${step.action.type === "note" ? " note" : ""}" id="step-${n}">`);
  parts.push(`<span class="flag" aria-hidden="true">${n}</span>`);
  parts.push(`<div><h2>${renderInlineHtml(step.title.trim() || "Step", { smartQuotes: true })}</h2>`);
  if (step.description?.trim()) parts.push(`<div class="desc">${renderMarkdownHtml(step.description, { smartQuotes: true })}</div>`);
  parts.push("</div>");
  const showUrl = includeUrls && !!step.page.url;
  if (bytes || showUrl) {
    parts.push("<figure>");
    if (bytes && shot) {
      const size = pngSize(bytes) ?? { width: shot.crop?.width ?? shot.width, height: shot.crop?.height ?? shot.height };
      const alt = `Screenshot of step ${n}: ${plainTitle(step.title)}`;
      parts.push(
        `<div class="frame"><img src="data:${sniffImageMime(bytes)};base64,${bytesToBase64(bytes)}" width="${Math.round(size.width)}" height="${Math.round(size.height)}" alt="${escapeHtml(alt)}" decoding="async"></div>`,
      );
    }
    if (showUrl) {
      const u = displayUrl(step.page.url);
      // Plain text on purpose: the file makes no requests and links to nothing but what the author wrote.
      parts.push(`<figcaption>${LINK_ICON}<span class="mono">${escapeHtml(u)}</span></figcaption>`);
    }
    parts.push("</figure>");
  }
  parts.push("</li>");
  return parts.join("");
}

/**
 * One self-contained HTML file: screenshots inlined as data URIs (redactions baked in, highlight
 * drawn), no scripts, no network, print CSS that makes "Save as PDF" come out clean.
 */
export function exportHtml(guide: Guide, images: ImageSource, opts: HtmlOptions = {}): string {
  const steps = visibleSteps(guide);
  const includeUrls = resolveIncludeUrls(guide, opts.includeUrls);
  const rendered = renderGuideImages(guide, images, opts);
  const title = guide.title.trim() || "Untitled guide";
  const theme = opts.theme && opts.theme !== "auto" ? ` data-theme="${opts.theme}"` : "";
  const plainDesc = guide.description ? plainTitle(guide.description).replace(/\s+/g, " ").trim().slice(0, 300) : "";

  const facts: string[] = [];
  const firstUrl = steps.find((s) => s.page.url)?.page.url;
  if (includeUrls && firstUrl) {
    const host = /^https?:\/\/([^/?#]+)/i.exec(firstUrl)?.[1];
    if (host) facts.push(`<div><b>Starts at</b>${escapeHtml(host)}</div>`);
  }
  if (guide.createdAt) facts.push(`<div><b>Created</b>${escapeHtml(formatDate(guide.createdAt))}</div>`);

  const html: string[] = [];
  html.push("<!doctype html>");
  html.push(`<html lang="${escapeHtml(opts.lang ?? "en")}"${theme}>`);
  html.push("<head>");
  html.push('<meta charset="utf-8">');
  html.push('<meta name="viewport" content="width=device-width, initial-scale=1">');
  html.push('<meta name="color-scheme" content="light dark">');
  html.push(`<meta name="generator" content="${PRODUCT_NAME}">`);
  if (plainDesc) html.push(`<meta name="description" content="${escapeHtml(plainDesc)}">`);
  html.push(`<title>${escapeHtml(title)}</title>`);
  html.push(`<style>${opts.embedFonts === false ? "" : HTML_FONT_FACES}${HTML_CSS}${opts.css ? "\n" + opts.css : ""}</style>`);
  html.push("</head>");
  html.push("<body>");
  html.push("<main>");
  html.push("<header>");
  html.push(`<div class="eyebrow"><span class="flag sm" aria-hidden="true">${steps.length}</span><span class="mono">${steps.length === 1 ? "STEP" : "STEPS"} · ${minutes(steps.length)}</span></div>`);
  html.push(`<h1>${escapeHtml(title)}</h1>`);
  if (guide.description?.trim()) html.push(`<div class="lede">${renderMarkdownHtml(guide.description, { smartQuotes: true })}</div>`);
  if (facts.length) html.push(`<div class="facts">${facts.join("")}</div>`);
  html.push("</header>");
  html.push('<ol class="steps">');
  steps.forEach((s, i) => html.push(stepHtml(s, i + 1, rendered, includeUrls)));
  html.push("</ol>");
  if (opts.branding !== false) {
    html.push(`<footer><span>Made with ${PRODUCT_NAME} · ${escapeHtml(SITE_URL.replace(/^https?:\/\//, ""))}</span><span class="mono">${escapeHtml(formatDate(guide.updatedAt || guide.createdAt))}</span></footer>`);
  }
  html.push("</main>");
  html.push("</body>");
  html.push("</html>");
  return html.join("\n") + "\n";
}

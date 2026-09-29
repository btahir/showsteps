// Small pure text helpers shared by titles and exporters. No DOM, no Node APIs.

/** Collapse all runs of whitespace (including newlines) to single spaces and trim. */
export function collapse(s: string): string {
  return s.replace(/[\s ​]+/g, " ").trim();
}

/** Truncate to `max` characters, preferring a word boundary, adding an ellipsis. */
export function truncate(s: string, max: number): string {
  const chars = Array.from(s);
  if (chars.length <= max) return s;
  const cut = chars.slice(0, max - 1).join("");
  const lastSpace = cut.lastIndexOf(" ");
  const base = lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut;
  return base.replace(/[\s.,;:!?-]+$/, "") + "…";
}

/** Escape Markdown inline metacharacters so `s` renders literally inside `**...**` or a sentence. */
export function escapeInline(s: string): string {
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const ch = s[i] as string;
    if (ch === "\\" || ch === "*" || ch === "`" || ch === "[" || ch === "]" || ch === "<" || ch === "~") {
      out += "\\" + ch;
    } else if (ch === "_") {
      const prev = s[i - 1] ?? "";
      const next = s[i + 1] ?? "";
      const intraword = /[\p{L}\p{N}]/u.test(prev) && /[\p{L}\p{N}]/u.test(next);
      out += intraword ? ch : "\\_";
    } else {
      out += ch;
    }
  }
  return out;
}

export interface InlineRun {
  text: string;
  bold?: boolean;
  italic?: boolean;
  code?: boolean;
  /** Only set for `[text](url)` links. */
  href?: string;
}

/**
 * Parse the small Markdown-inline subset used in step titles and descriptions
 * (`**bold**`, `*italic*`, `` `code` ``, `[text](url)`, backslash escapes) into flat runs.
 * Anything else is kept as literal text. Never throws.
 */
export function parseInline(src: string): InlineRun[] {
  const runs: InlineRun[] = [];
  let buf = "";
  let bold = false;
  let italic = false;
  const flush = (): void => {
    if (buf) {
      const r: InlineRun = { text: buf };
      if (bold) r.bold = true;
      if (italic) r.italic = true;
      runs.push(r);
      buf = "";
    }
  };
  let i = 0;
  while (i < src.length) {
    const ch = src[i] as string;
    if (ch === "\\" && i + 1 < src.length && /[\\`*_{}[\]()#+\-.!<>~|"]/.test(src[i + 1] as string)) {
      buf += src[i + 1];
      i += 2;
    } else if (ch === "`") {
      const end = src.indexOf("`", i + 1);
      if (end > i) {
        flush();
        const r: InlineRun = { text: src.slice(i + 1, end), code: true };
        if (bold) r.bold = true;
        runs.push(r);
        i = end + 1;
      } else {
        buf += ch;
        i++;
      }
    } else if (ch === "*" && src[i + 1] === "*") {
      if (bold || src.indexOf("**", i + 2) > i + 1) {
        flush();
        bold = !bold;
        i += 2;
      } else {
        buf += "**";
        i += 2;
      }
    } else if (ch === "*") {
      if (italic || src.indexOf("*", i + 1) > i) {
        flush();
        italic = !italic;
        i++;
      } else {
        buf += ch;
        i++;
      }
    } else if (ch === "[") {
      const m = /^\[([^\]]*)\]\(([^)\s]*)\)/.exec(src.slice(i));
      if (m) {
        flush();
        const r: InlineRun = { text: m[1] as string, href: m[2] as string };
        if (bold) r.bold = true;
        if (italic) r.italic = true;
        runs.push(r);
        i += m[0].length;
      } else {
        buf += ch;
        i++;
      }
    } else {
      buf += ch;
      i++;
    }
  }
  flush();
  return runs;
}

/** Title without Markdown markup: `Click **Save**` becomes `Click Save`. */
export function plainTitle(title: string): string {
  return parseInline(title)
    .map((r) => r.text)
    .join("");
}

const OPENERS = /[\s(\[{<*\u2014\u2013\u2018\u201c]/;

/**
 * Typographic quotes for display: `"a"` becomes \u201ca\u201d and `it's` becomes it\u2019s. Generated titles keep
 * straight quotes on purpose (they are what the BRIEF grammar and every plain-text export use, and the
 * plain-text form is easy to search and diff), but fonts such as Rethink Sans draw the straight quote as a
 * slanted closing mark, so anything that shows a title to a person (HTML, PDF, DOCX, the editor) should run it
 * through this. `prev` is the character before `s` when `s` is a fragment of a longer text.
 */
export function typographicQuotes(s: string, prev = ""): string {
  let out = "";
  let before = prev.slice(-1);
  for (const ch of s) {
    if (ch === '"') out += before === "" || OPENERS.test(before) ? "\u201c" : "\u201d";
    else if (ch === "'") out += before === "" || OPENERS.test(before) ? "\u2018" : "\u2019";
    else out += ch;
    before = ch;
  }
  return out;
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/** Standard base64 for bytes (no btoa and no Node byte-buffer class: works everywhere and on big inputs). */
export function bytesToBase64(bytes: Uint8Array): string {
  const parts: string[] = [];
  let chunk = "";
  const n = bytes.length;
  let i = 0;
  for (; i + 2 < n; i += 3) {
    const v = ((bytes[i] as number) << 16) | ((bytes[i + 1] as number) << 8) | (bytes[i + 2] as number);
    chunk += B64[(v >> 18) & 63]! + B64[(v >> 12) & 63]! + B64[(v >> 6) & 63]! + B64[v & 63]!;
    if (chunk.length >= 8192) {
      parts.push(chunk);
      chunk = "";
    }
  }
  if (i < n) {
    const a = bytes[i] as number;
    const b = i + 1 < n ? (bytes[i + 1] as number) : 0;
    const v = (a << 16) | (b << 8);
    chunk += B64[(v >> 18) & 63]! + B64[(v >> 12) & 63]! + (i + 1 < n ? B64[(v >> 6) & 63]! : "=") + "=";
  }
  parts.push(chunk);
  return parts.join("");
}

/** Lowercase ASCII slug: letters, digits, single hyphens. */
export function slugify(s: string, max = 60): string {
  const base = s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return base.slice(0, max).replace(/-+$/g, "");
}

export function hostnameOf(url: string): string | undefined {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host ? host.replace(/^www\./, "") : undefined;
  } catch {
    return undefined;
  }
}

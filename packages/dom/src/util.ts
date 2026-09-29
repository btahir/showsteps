// Small DOM-agnostic helpers. Nothing here uses `instanceof HTMLElement` so it works across
// frames, shadow roots and happy-dom.

export type RootNode = Document | ShadowRoot;

export function norm(s: string | null | undefined): string {
  return (s ?? "").replace(/\s+/g, " ").trim();
}

/** Trim, collapse whitespace and cut to `max` characters (no ellipsis, so substring locators still match). */
export function clip(s: string | null | undefined, max = 80): string {
  const n = norm(s);
  return n.length > max ? n.slice(0, max).trim() : n;
}

export function isElement(n: unknown): n is Element {
  return !!n && (n as Node).nodeType === 1;
}

export function isShadowRoot(n: unknown): n is ShadowRoot {
  return !!n && (n as Node).nodeType === 11 && "host" in (n as object);
}

export function rootOf(el: Node): RootNode {
  const r = el.getRootNode?.() as Node | undefined;
  if (r && (r.nodeType === 9 || isShadowRoot(r))) return r as RootNode;
  return (el.ownerDocument ?? (el as Document)) as Document;
}

/** Parent element, crossing shadow boundaries upwards (light DOM parent, else shadow host). */
export function composedParent(el: Element): Element | null {
  if (el.parentElement) return el.parentElement;
  const p = el.parentNode as Node | null;
  if (p && isShadowRoot(p)) return p.host;
  return null;
}

export function byId(root: RootNode, id: string): Element | null {
  const r = root as unknown as { getElementById?: (i: string) => Element | null };
  if (typeof r.getElementById === "function") {
    const hit = r.getElementById(id);
    if (hit) return hit;
  }
  try {
    return root.querySelector(`[id="${id.replace(/["\\]/g, "\\$&")}"]`);
  } catch {
    return null;
  }
}

/** CSS.escape polyfill (CSSOM spec algorithm), used for identifiers. */
export function cssEscape(value: string): string {
  const s = String(value);
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const ch = s.charCodeAt(i);
    const c = s.charAt(i);
    if (ch === 0) out += "\uFFFD";
    else if ((ch >= 1 && ch <= 0x1f) || ch === 0x7f) out += `\\${ch.toString(16)} `;
    else if (i === 0 && ch >= 0x30 && ch <= 0x39) out += `\\${ch.toString(16)} `;
    else if (i === 1 && ch >= 0x30 && ch <= 0x39 && s.charCodeAt(0) === 0x2d) out += `\\${ch.toString(16)} `;
    else if (i === 0 && ch === 0x2d && s.length === 1) out += `\\${c}`;
    else if (ch >= 0x80 || ch === 0x2d || ch === 0x5f || (ch >= 0x30 && ch <= 0x39) || (ch >= 0x41 && ch <= 0x5a) || (ch >= 0x61 && ch <= 0x7a)) out += c;
    else out += `\\${c}`;
  }
  return out;
}

export function attrValue(v: string): string {
  return `"${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\a ")}"`;
}

export function xpathString(v: string): string {
  if (!v.includes('"')) return `"${v}"`;
  if (!v.includes("'")) return `'${v}'`;
  return `concat(${v.split('"').map((p) => `"${p}"`).join(`, '"', `)})`;
}

export function winOf(el: Node): (Window & typeof globalThis) | null {
  return (el.ownerDocument?.defaultView ?? (el as Document).defaultView ?? null) as (Window & typeof globalThis) | null;
}

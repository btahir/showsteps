// Locator generation. Every locator emitted is checked to resolve to exactly this element within its
// scope: the element's own root (document, or shadow root plus everything nested below it), inside its
// own frame. Playwright locators pierce open shadow roots, so nested shadow content counts too.
import type { Locator } from "@stepsnap/core";
import { accessibleName, getRole, isHidden, isLabelable, labelElements, visibleText } from "./aria";
import { attrValue, byId, clip, cssEscape, isElement, isShadowRoot, norm, rootOf, xpathString, type RootNode } from "./util";

/** Attributes Playwright's getByTestId understands by default. */
const TESTID_ATTR = "data-testid";
/** Other test hooks: emitted as attribute CSS, because getByTestId would not find them. */
const OTHER_TEST_ATTRS = ["data-test-id", "data-test", "data-qa", "data-cy"];

export class Scope {
  readonly root: RootNode;
  private _all?: Element[];
  private _roots?: RootNode[];
  private names = new WeakMap<Element, string>();

  constructor(root: RootNode) {
    this.root = root;
  }

  get roots(): RootNode[] {
    if (!this._roots) this.collect();
    return this._roots!;
  }

  get all(): Element[] {
    if (!this._all) this.collect();
    return this._all!;
  }

  private collect(): void {
    const roots: RootNode[] = [];
    const all: Element[] = [];
    const visit = (r: RootNode) => {
      roots.push(r);
      for (const el of Array.from(r.querySelectorAll("*"))) {
        all.push(el);
        const sr = (el as Element & { shadowRoot: ShadowRoot | null }).shadowRoot;
        if (sr) visit(sr);
      }
    };
    visit(this.root);
    this._roots = roots;
    this._all = all;
  }

  query(selector: string): Element[] {
    const out: Element[] = [];
    for (const r of this.roots) {
      try {
        out.push(...Array.from(r.querySelectorAll(selector)));
      } catch {
        return [];
      }
    }
    return out;
  }

  nameOf(el: Element): string {
    let n = this.names.get(el);
    if (n === undefined) {
      n = accessibleName(el);
      this.names.set(el, n);
    }
    return n;
  }
}

const lc = (s: string) => norm(s).toLowerCase();

function isUniqueCss(scope: Scope, el: Element, selector: string): boolean {
  const hits = scope.query(selector);
  return hits.length === 1 && hits[0] === el;
}

export function stableId(id: string | null): id is string {
  if (!id || /\s/.test(id)) return false;
  if (/^\d/.test(id) || id.includes(":")) return false; // React useId, numeric ids
  if (/\d{4,}/.test(id) || /[0-9a-f]{8,}/i.test(id)) return false; // generated
  if (/^(radix|headlessui|react-select|mui|rc|ember|__)/i.test(id)) return false;
  return true;
}

function stableClass(c: string): boolean {
  if (!c || c.length > 30) return false;
  if (/^(css|sc|jsx|svelte|astro|_|js-)-?/i.test(c) && /[0-9a-z]{5,}/i.test(c) && /^(css|sc|jsx|svelte|astro)-/i.test(c)) return false;
  if (/\d{3,}/.test(c) || /[0-9a-f]{7,}/i.test(c)) return false;
  return /^[A-Za-z][\w-]*$/.test(c) && !/^(active|open|show|hover|focus|selected|disabled|is-|has-)/.test(c);
}

function nthOfType(el: Element): number {
  let n = 1;
  for (let s = el.previousElementSibling; s; s = s.previousElementSibling) if (s.localName === el.localName) n++;
  return n;
}

function sameTagSiblings(el: Element): number {
  const p = el.parentNode as ParentNode | null;
  if (!p) return 1;
  let n = 0;
  for (const c of Array.from(p.children)) if (c.localName === el.localName) n++;
  return n;
}

/** Short CSS selector unique in `scope`, or a structural path when nothing shorter works. */
export function cssFor(el: Element, scope: Scope): string {
  const tag = el.localName;
  const own: string[] = [];
  const id = el.getAttribute("id");
  if (stableId(id)) own.push(`#${cssEscape(id)}`);
  const tid = el.getAttribute(TESTID_ATTR);
  if (tid) own.push(`[${TESTID_ATTR}=${attrValue(tid)}]`);
  for (const a of OTHER_TEST_ATTRS) {
    const v = el.getAttribute(a);
    if (v) own.push(`[${a}=${attrValue(v)}]`);
  }
  const name = el.getAttribute("name");
  const type = el.getAttribute("type");
  if (name) {
    own.push(`${tag}[name=${attrValue(name)}]`);
    if (type) own.push(`${tag}[type=${attrValue(type)}][name=${attrValue(name)}]`);
    if (tag === "input" && (type === "radio" || type === "checkbox") && el.getAttribute("value") !== null)
      own.push(`${tag}[name=${attrValue(name)}][value=${attrValue(el.getAttribute("value")!)}]`);
  }
  for (const a of ["aria-label", "placeholder", "title", "alt", "for", "href", "src", "role", "type"]) {
    const v = el.getAttribute(a);
    if (v && v.length <= 80 && !(a === "href" && v.startsWith("javascript:"))) own.push(`${tag}[${a}=${attrValue(v)}]`);
  }
  const classes = Array.from(el.classList ?? []).filter(stableClass);
  if (classes.length) {
    own.push(`${tag}.${classes.slice(0, 1).map(cssEscape).join(".")}`);
    if (classes.length > 1) own.push(`${tag}.${classes.slice(0, 2).map(cssEscape).join(".")}`);
  }
  for (const c of own) if (isUniqueCss(scope, el, c)) return c;

  // Structural path, climbing until unique. Segments carry :nth-of-type only when needed.
  const seg = (e: Element): string => {
    const eid = e.getAttribute("id");
    if (stableId(eid)) return `#${cssEscape(eid)}`;
    const etid = e.getAttribute(TESTID_ATTR);
    if (etid) return `[${TESTID_ATTR}=${attrValue(etid)}]`;
    let s = e.localName;
    const ec = Array.from(e.classList ?? []).filter(stableClass);
    if (ec.length && sameTagSiblings(e) > 1) s += `.${cssEscape(ec[0]!)}`;
    if (sameTagSiblings(e) > 1 && !isUniqueAmongSiblings(e, s)) s += `:nth-of-type(${nthOfType(e)})`;
    return s;
  };
  const parts: string[] = [];
  let cur: Element | null = el;
  while (cur) {
    parts.unshift(seg(cur));
    const sel = parts.join(" > ");
    const anchored = parts[0]!.startsWith("#") || parts[0]!.startsWith("[");
    const atRoot = !cur.parentElement; // html, or top-level element of a shadow root
    if (anchored || atRoot || parts.length >= 6) {
      if (isUniqueCss(scope, el, sel)) return sel;
      if (atRoot) break;
    } else if (isUniqueCss(scope, el, sel)) {
      return sel;
    }
    cur = cur.parentElement;
  }
  // Fall back to a fully positional path from the root.
  const full: string[] = [];
  for (let e: Element | null = el; e; e = e.parentElement) full.unshift(`${e.localName}:nth-of-type(${nthOfType(e)})`);
  return full.join(" > ");
}

function isUniqueAmongSiblings(e: Element, s: string): boolean {
  const p = e.parentNode as ParentNode | null;
  if (!p) return true;
  let n = 0;
  for (const c of Array.from(p.children)) if (c.matches(s)) n++;
  return n === 1;
}

/** Absolute or id-anchored XPath. Not available inside shadow roots (XPath cannot cross them). */
export function xpathFor(el: Element): string | undefined {
  if (isShadowRoot(rootOf(el))) return undefined;
  const parts: string[] = [];
  let cur: Element | null = el;
  while (cur) {
    const id = cur.getAttribute("id");
    if (stableId(id) && cur !== el) {
      return `//*[@id=${xpathString(id)}]/${parts.join("/")}`;
    }
    if (stableId(id) && cur === el) return `//*[@id=${xpathString(id)}]`;
    const n = sameTagSiblings(cur);
    parts.unshift(n > 1 ? `${cur.localName}[${nthOfType(cur)}]` : cur.localName);
    cur = cur.parentElement;
  }
  return `/${parts.join("/")}`;
}

function textOfNode(el: Element): string {
  return visibleText(el);
}

function isTextControl(el: Element): boolean {
  const t = el.localName;
  if (t === "input" || t === "textarea" || t === "select") return true;
  const ce = el.getAttribute("contenteditable");
  return ce !== null && ce.toLowerCase() !== "false";
}

export interface LocatorInput {
  el: Element;
  role?: string;
  name?: string;
  label?: string;
  placeholder?: string;
  text?: string;
  textFull: boolean; // text is not truncated
  sensitive?: boolean;
}

export function buildLocators(input: LocatorInput, scope = new Scope(rootOf(input.el))): Locator[] {
  const { el } = input;
  const out: Locator[] = [];

  // 1. test ids
  const tid = el.getAttribute(TESTID_ATTR);
  if (tid && isUniqueCss(scope, el, `[${TESTID_ATTR}=${attrValue(tid)}]`)) out.push({ kind: "testid", value: tid });
  for (const a of OTHER_TEST_ATTRS) {
    const v = el.getAttribute(a);
    if (v && isUniqueCss(scope, el, `[${a}=${attrValue(v)}]`)) {
      out.push({ kind: "css", value: `[${a}=${attrValue(v)}]` });
      break;
    }
  }

  // 2. role + accessible name, unique among visible elements with that role (Playwright's default
  //    non-exact, case-insensitive substring match, so an exact replay is unique too)
  if (input.role && input.name) {
    const want = lc(input.name);
    const hits = scope.all.filter((e) => {
      if (getRole(e) !== input.role) return false;
      if (!lc(scope.nameOf(e)).includes(want)) return false;
      return e === el || !isHidden(e, true);
    });
    if (hits.length === 1 && hits[0] === el) out.push({ kind: "role", role: input.role, name: input.name });
  }

  // 3. label
  const labelValue = input.label ?? (isTextControl(el) ? clip(el.getAttribute("aria-label")) : "");
  if (labelValue) {
    const want = lc(labelValue);
    const hits = scope.all.filter((e) => {
      const texts: string[] = [];
      if (isLabelable(e)) for (const l of labelElements(e)) texts.push(lc(visibleText(l)));
      const al = e.getAttribute("aria-label");
      if (al) texts.push(lc(al));
      const lb = e.getAttribute("aria-labelledby");
      if (lb) {
        const root = rootOf(e);
        for (const id of norm(lb).split(" ")) {
          const r = byId(root, id);
          if (r) texts.push(lc(visibleText(r)));
        }
      }
      return texts.some((t) => t.includes(want));
    });
    if (hits.length === 1 && hits[0] === el) out.push({ kind: "label", value: labelValue });
  }

  // 4. placeholder
  if (input.placeholder) {
    const want = lc(input.placeholder);
    const hits = scope.all.filter((e) => lc(e.getAttribute("placeholder") ?? "").includes(want) && e.hasAttribute("placeholder"));
    if (hits.length === 1 && hits[0] === el) out.push({ kind: "placeholder", value: input.placeholder });
  }

  // 5. visible text (smallest element containing it)
  if (input.text && input.textFull && !input.sensitive && !isTextControl(el)) {
    const want = lc(input.text);
    const containing = scope.all.filter((e) => !isHidden(e) && lc(textOfNode(e)).includes(want));
    const smallest = containing.filter((e) => !Array.from(e.children).some((c) => containing.includes(c)));
    if (smallest.length === 1 && smallest[0] === el) {
      out.push({ kind: "text", value: input.text });
    } else {
      const exactHits = smallest.filter((e) => norm(textOfNode(e)) === input.text);
      if (exactHits.length === 1 && exactHits[0] === el) out.push({ kind: "text", value: input.text, exact: true });
    }
  }

  // 6. short unique CSS (always present)
  const css = cssFor(el, scope);
  if (!out.some((l) => l.kind === "css" && l.value === css)) out.push({ kind: "css", value: css });

  // 7. XPath
  const xp = xpathFor(el);
  if (xp) out.push({ kind: "xpath", value: xp });

  return out;
}

/** CSS chain of shadow hosts, outermost first (each unique within its own root). */
export function shadowChain(el: Element): string[] | undefined {
  const chain: string[] = [];
  let root = rootOf(el);
  let guard = 0;
  while (isShadowRoot(root) && guard++ < 16) {
    const host = root.host;
    const scope = new Scope(rootOf(host));
    const tag = host.localName;
    const sel = tag.includes("-") && isUniqueCss(scope, host, tag) ? tag : cssFor(host, scope);
    chain.unshift(sel);
    root = rootOf(host);
  }
  return chain.length ? chain : undefined;
}

/** CSS chain of same-origin iframes, outermost first. Undefined for the top frame or cross-origin parents. */
export function frameChain(el: Element): string[] | undefined {
  const chain: string[] = [];
  let doc: Document | null = el.ownerDocument;
  for (let guard = 0; doc && guard < 16; guard++) {
    let fe: Element | null = null;
    try {
      fe = doc.defaultView?.frameElement ?? null;
    } catch {
      fe = null;
    }
    if (!isElement(fe)) break;
    const scope = new Scope(rootOf(fe));
    const tid = fe.getAttribute(TESTID_ATTR);
    let sel: string | undefined;
    if (tid && isUniqueCss(scope, fe, `[${TESTID_ATTR}=${attrValue(tid)}]`)) sel = `[${TESTID_ATTR}=${attrValue(tid)}]`;
    else sel = cssFor(fe, scope);
    chain.unshift(sel);
    doc = fe.ownerDocument;
  }
  return chain.length ? chain : undefined;
}

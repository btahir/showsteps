// Roles (explicit + implicit per ARIA in HTML) and accessible names (accname essentials).
import { byId, clip, composedParent, isElement, norm, rootOf, winOf, type RootNode } from "./util";

const KNOWN_ROLES = new Set(
  ("alert alertdialog application article banner blockquote button caption cell checkbox code columnheader combobox complementary " +
    "contentinfo definition deletion dialog directory document emphasis feed figure form grid gridcell group heading img insertion " +
    "link list listbox listitem log main marquee math menu menubar menuitem menuitemcheckbox menuitemradio meter navigation none note " +
    "option paragraph presentation progressbar radio radiogroup region row rowgroup rowheader scrollbar search searchbox separator " +
    "slider spinbutton status strong subscript superscript switch tab table tablist tabpanel term textbox time timer toolbar tooltip " +
    "tree treegrid treeitem generic").split(" "),
);

/** Roles whose name may come from their descendants' text. */
const NAME_FROM_CONTENT = new Set(
  "button cell checkbox columnheader gridcell heading link menuitem menuitemcheckbox menuitemradio option radio row rowheader switch tab tooltip treeitem".split(" "),
);

const INLINE_TAGS = new Set(
  "a abbr b bdi bdo cite code data dfn em i kbd label mark q s samp small span strong sub sup time u var svg text tspan font".split(" "),
);
const SKIP_TAGS = new Set(["script", "style", "noscript", "template", "head", "link", "meta"]);

export function explicitRole(el: Element): string | undefined {
  const raw = el.getAttribute("role");
  if (!raw) return undefined;
  for (const tok of raw.trim().toLowerCase().split(/\s+/)) if (KNOWN_ROLES.has(tok)) return tok;
  return undefined;
}

function isNativelyFocusable(el: Element): boolean {
  const t = el.localName;
  if (t === "a" || t === "area") return el.hasAttribute("href");
  return ["button", "input", "select", "textarea", "summary"].includes(t) || el.hasAttribute("tabindex");
}

function hasAncestor(el: Element, tags: string[]): boolean {
  for (let p = composedParent(el); p; p = composedParent(p)) if (tags.includes(p.localName)) return true;
  return false;
}

function inputRole(el: Element): string | undefined {
  const type = (el.getAttribute("type") ?? "text").trim().toLowerCase();
  switch (type) {
    case "button":
    case "submit":
    case "reset":
    case "image":
    case "file":
      return "button";
    case "checkbox":
      return "checkbox";
    case "radio":
      return "radio";
    case "range":
      return "slider";
    case "number":
      return "spinbutton";
    case "search":
      return el.hasAttribute("list") ? "combobox" : "searchbox";
    case "hidden":
    case "password":
    case "color":
    case "date":
    case "datetime-local":
    case "month":
    case "time":
    case "week":
      return undefined;
    default:
      // email, tel, text, url and unknown types behave as text
      return el.hasAttribute("list") ? "combobox" : "textbox";
  }
}

export function implicitRole(el: Element): string | undefined {
  switch (el.localName) {
    case "a":
    case "area":
      return el.hasAttribute("href") ? "link" : undefined;
    case "button":
      return "button";
    case "input":
      return inputRole(el);
    case "select":
      return el.hasAttribute("multiple") || Number(el.getAttribute("size") ?? 0) > 1 ? "listbox" : "combobox";
    case "textarea":
      return "textbox";
    case "h1": case "h2": case "h3": case "h4": case "h5": case "h6":
      return "heading";
    case "img":
      return el.getAttribute("alt") === "" ? undefined : "img";
    case "nav":
      return "navigation";
    case "main":
      return "main";
    case "aside":
      return "complementary";
    case "header":
      return hasAncestor(el, ["article", "aside", "main", "nav", "section"]) ? undefined : "banner";
    case "footer":
      return hasAncestor(el, ["article", "aside", "main", "nav", "section"]) ? undefined : "contentinfo";
    case "form":
      return norm(el.getAttribute("aria-label")) || el.hasAttribute("aria-labelledby") ? "form" : undefined;
    case "section":
      return norm(el.getAttribute("aria-label")) || el.hasAttribute("aria-labelledby") ? "region" : undefined;
    case "article": return "article";
    case "dialog": return "dialog";
    case "ul": case "ol": case "menu": return "list";
    case "li": return "listitem";
    case "table": return "table";
    case "caption": return "caption";
    case "thead": case "tbody": case "tfoot": return "rowgroup";
    case "tr": return "row";
    case "td": return "cell";
    case "th": return el.getAttribute("scope") === "row" ? "rowheader" : "columnheader";
    case "option": return "option";
    case "datalist": return "listbox";
    case "optgroup": case "fieldset": case "details": return "group";
    case "progress": return "progressbar";
    case "meter": return "meter";
    case "output": return "status";
    case "hr": return "separator";
    case "figure": return "figure";
    case "p": return "paragraph";
    case "blockquote": return "blockquote";
    case "code": return "code";
    case "em": return "emphasis";
    case "strong": return "strong";
    case "search": return "search";
    case "time": return "time";
    case "dfn": case "dt": return "term";
    case "dd": return "definition";
    default:
      return undefined;
  }
}

/** Effective ARIA role, or undefined for generic / presentational elements. */
export function getRole(el: Element): string | undefined {
  const ex = explicitRole(el);
  if (ex && ex !== "generic") {
    if ((ex === "presentation" || ex === "none") && isNativelyFocusable(el)) return implicitRole(el);
    if (ex === "presentation" || ex === "none") return undefined;
    return ex;
  }
  return implicitRole(el);
}

export function isHidden(el: Element, deep = false): boolean {
  for (let cur: Element | null = el; cur; cur = deep ? composedParent(cur) : null) {
    if (cur.hasAttribute("hidden") || cur.getAttribute("aria-hidden") === "true") return true;
    if (cur.localName === "input" && (cur.getAttribute("type") ?? "").toLowerCase() === "hidden") return true;
    const w = winOf(cur);
    if (w) {
      try {
        const cs = w.getComputedStyle(cur);
        if (cs.display === "none") return true;
        if (cur === el && (cs.visibility === "hidden" || cs.visibility === "collapse")) return true;
      } catch {
        /* no computed style available */
      }
    }
    if (!deep) break;
  }
  return false;
}

// ---------------------------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------------------------

const LABELABLE = new Set(["button", "input", "meter", "output", "progress", "select", "textarea"]);

export function isLabelable(el: Element): boolean {
  if (!LABELABLE.has(el.localName)) return false;
  return !(el.localName === "input" && (el.getAttribute("type") ?? "").toLowerCase() === "hidden");
}

/** <label> elements associated with a labelable control (label[for], wrapping label). */
export function labelElements(el: Element): Element[] {
  if (!isLabelable(el)) return [];
  const out: Element[] = [];
  const id = el.getAttribute("id");
  const root = rootOf(el);
  if (id) {
    for (const l of Array.from(root.querySelectorAll("label"))) if (l.getAttribute("for") === id) out.push(l);
  }
  const wrap = el.closest("label");
  if (wrap && !out.includes(wrap)) {
    const forAttr = wrap.getAttribute("for");
    if (!forAttr) {
      const first = Array.from(wrap.querySelectorAll("*")).find((d) => isLabelable(d));
      if (first === el) out.push(wrap);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Accessible name
// ---------------------------------------------------------------------------------------------

interface Trav {
  inLabelledby: boolean; // currently following aria-labelledby (do not follow again)
  recursive: boolean; // computing a descendant's contribution
  embedded: boolean; // inside a label/labelledby traversal (embedded controls contribute values)
  skip?: Element; // the control whose own label we are computing
  depth: number;
}

function selectedOptionText(el: Element): string {
  const opts = Array.from(el.querySelectorAll("option"));
  const sel = opts.filter((o) => (o as HTMLOptionElement).selected);
  const chosen = sel.length ? sel : opts.slice(0, 1);
  return chosen.map((o) => norm(o.textContent)).join(" ");
}

function embeddedValue(el: Element): string | undefined {
  const role = getRole(el);
  if (el.localName === "select") return selectedOptionText(el);
  if (role === "textbox" || role === "searchbox" || role === "spinbutton" || role === "slider") {
    return String((el as HTMLInputElement).value ?? "");
  }
  return undefined;
}

function childrenText(el: Element, t: Trav): string {
  let out = "";
  const kids = Array.from(el.childNodes);
  for (const k of kids) {
    if (k.nodeType === 3) {
      out += (k as Text).data;
    } else if (isElement(k)) {
      if (k === t.skip) continue;
      const s = nameOf(k, { ...t, recursive: true, depth: t.depth + 1 });
      if (!s) continue;
      out += INLINE_TAGS.has(k.localName) ? s : ` ${s} `;
    }
  }
  return out;
}

function nativeName(el: Element, t: Trav): string {
  const tag = el.localName;
  if (tag === "input") {
    const type = (el.getAttribute("type") ?? "text").toLowerCase();
    if (type === "button") return norm(el.getAttribute("value"));
    if (type === "submit") return norm(el.getAttribute("value")) || "Submit";
    if (type === "reset") return norm(el.getAttribute("value")) || "Reset";
    if (type === "image") return norm(el.getAttribute("alt")) || norm(el.getAttribute("value")) || "Submit";
  }
  if (tag === "img" || tag === "area") {
    const alt = el.getAttribute("alt");
    if (alt !== null) return norm(alt);
  }
  if (isLabelable(el)) {
    const labels = labelElements(el);
    const parts = labels.map((l) => norm(nameOfLabel(l, el))).filter(Boolean);
    if (parts.length) return parts.join(" ");
  }
  if (tag === "fieldset") {
    const legend = Array.from(el.children).find((c) => c.localName === "legend");
    if (legend) return norm(nameOf(legend, { inLabelledby: false, recursive: true, embedded: false, depth: t.depth + 1 }));
  }
  if (tag === "table") {
    const cap = Array.from(el.children).find((c) => c.localName === "caption");
    if (cap) return norm(nameOf(cap, { inLabelledby: false, recursive: true, embedded: false, depth: t.depth + 1 }));
  }
  if (tag === "figure") {
    const cap = Array.from(el.children).find((c) => c.localName === "figcaption");
    if (cap) return norm(nameOf(cap, { inLabelledby: false, recursive: true, embedded: false, depth: t.depth + 1 }));
  }
  if (tag === "svg") {
    const title = Array.from(el.children).find((c) => c.localName === "title");
    if (title) return norm(title.textContent);
  }
  return "";
}

function nameOfLabel(label: Element, control: Element): string {
  return nameOf(label, { inLabelledby: true, recursive: true, embedded: true, skip: control, depth: 1 });
}

function nameOf(el: Element, t: Trav): string {
  if (t.depth > 40 || SKIP_TAGS.has(el.localName)) return "";
  // Hidden content is skipped, except a node referenced directly by aria-labelledby / a wrapping label.
  if (t.recursive && !(t.inLabelledby && t.depth <= 1) && isHidden(el)) return "";

  // 2B aria-labelledby
  if (!t.inLabelledby) {
    const ids = norm(el.getAttribute("aria-labelledby")).split(" ").filter(Boolean);
    if (ids.length) {
      const root = rootOf(el);
      const parts: string[] = [];
      for (const id of ids) {
        const ref = byId(root, id);
        if (ref) parts.push(norm(nameOf(ref, { inLabelledby: true, recursive: true, embedded: true, depth: t.depth + 1 })));
      }
      const joined = norm(parts.filter(Boolean).join(" "));
      if (joined) return joined;
    }
  }

  // 2C aria-label
  const ariaLabel = norm(el.getAttribute("aria-label"));
  if (ariaLabel) return ariaLabel;

  // 2D native host-language label
  const native = nativeName(el, t);
  if (native) return native;

  // 2E embedded control
  if (t.embedded && t.recursive) {
    const v = embeddedValue(el);
    if (v !== undefined) return v;
  }

  // 2F name from content
  const role = getRole(el);
  if (t.recursive || (role && NAME_FROM_CONTENT.has(role)) || el.localName === "summary") {
    if (el.localName !== "input" && el.localName !== "textarea" && el.localName !== "select" && el.localName !== "img") {
      const c = norm(childrenText(el, t));
      if (c) return c;
    }
  }

  // 2I tooltip, then placeholder as last resort for text controls
  const title = norm(el.getAttribute("title"));
  if (title) return title;
  if ((el.localName === "input" || el.localName === "textarea") && !t.recursive) {
    const ph = norm(el.getAttribute("placeholder"));
    if (ph) return ph;
  }
  return "";
}

/** Accessible name, whitespace-collapsed, not clipped. Empty string when there is none. */
export function accessibleName(el: Element): string {
  return norm(nameOf(el, { inLabelledby: false, recursive: false, embedded: false, depth: 0 }));
}

/** Text of the associated <label> (or aria-labelledby) for a form control, clipped. */
export function labelText(el: Element): string {
  const labels = labelElements(el);
  const parts = labels.map((l) => norm(nameOfLabel(l, el))).filter(Boolean);
  if (parts.length) return clip(parts.join(" "));
  if (isLabelable(el) || getRole(el)) {
    const ids = norm(el.getAttribute("aria-labelledby")).split(" ").filter(Boolean);
    if (ids.length) {
      const root: RootNode = rootOf(el);
      const p = ids
        .map((id) => byId(root, id))
        .filter((r): r is Element => !!r)
        .map((r) => norm(nameOf(r, { inLabelledby: true, recursive: true, embedded: true, depth: 1 })))
        .filter(Boolean);
      if (p.length) return clip(p.join(" "));
    }
  }
  return "";
}

/** Text a person sees on the element (no aria-label substitution). Clipped separately by the caller. */
export function visibleText(el: Element): string {
  let out = "";
  const walk = (n: Node, depth: number) => {
    if (depth > 40) return;
    for (const k of Array.from(n.childNodes)) {
      if (k.nodeType === 3) out += (k as Text).data;
      else if (isElement(k)) {
        if (SKIP_TAGS.has(k.localName) || isHidden(k)) continue;
        if (k.localName === "title" && k.parentElement?.localName === "svg") continue;
        if (k.localName === "input" || k.localName === "textarea" || k.localName === "select") continue;
        const inline = INLINE_TAGS.has(k.localName);
        if (!inline) out += " ";
        walk(k, depth + 1);
        if (!inline) out += " ";
      }
    }
  };
  walk(el, 0);
  return norm(out);
}

import { getRole } from "./aria";
import { isElement, winOf } from "./util";

const INTERACTIVE_ROLES = new Set(
  "button link checkbox radio switch menuitem menuitemcheckbox menuitemradio tab option combobox textbox searchbox slider spinbutton treeitem".split(" "),
);
const INTERACTIVE_TAGS = new Set(["button", "select", "textarea", "summary", "option", "input"]);

function isEditableHost(el: Element): boolean {
  const ce = el.getAttribute("contenteditable");
  return ce !== null && ce.toLowerCase() !== "false";
}

function isActionable(el: Element): boolean {
  const tag = el.localName;
  if (INTERACTIVE_TAGS.has(tag)) return !(tag === "input" && (el.getAttribute("type") ?? "").toLowerCase() === "hidden");
  if ((tag === "a" || tag === "area") && el.hasAttribute("href")) return true;
  if (tag === "label") return true;
  if (isEditableHost(el)) return true;
  const role = el.getAttribute("role")?.trim().split(/\s+/)[0]?.toLowerCase();
  if (role && INTERACTIVE_ROLES.has(role)) return true;
  if (el.hasAttribute("onclick")) return true;
  const implicit = getRole(el);
  return !!implicit && INTERACTIVE_ROLES.has(implicit) && el.hasAttribute("tabindex");
}

function pointerCursor(el: Element): boolean {
  const w = winOf(el);
  if (!w) return false;
  try {
    return w.getComputedStyle(el).cursor === "pointer";
  } catch {
    return false;
  }
}

/**
 * The element a person meant to act on. Walks up from the deepest event target (svg, span, icon) to the
 * nearest actionable ancestor, using composedPath so open shadow roots resolve to their inner element.
 * A click on a <label> resolves to its control. Falls back to the innermost element.
 */
export function resolveTarget(event: Event): Element {
  const path: Element[] = [];
  const cp = typeof event.composedPath === "function" ? event.composedPath() : [];
  for (const n of cp) if (isElement(n)) path.push(n);
  if (!path.length && isElement(event.target)) {
    for (let cur: Element | null = event.target; cur; cur = cur.parentElement) path.push(cur);
  }
  if (!path.length) {
    const t = event.target as Node | null;
    const doc = (t as Document | null)?.nodeType === 9 ? (t as Document) : t?.ownerDocument;
    if (t && t.parentElement) return t.parentElement;
    if (doc?.documentElement) return doc.documentElement;
    throw new Error("resolveTarget: event has no element target");
  }
  const innermost = path[0]!;

  for (const el of path) {
    if (el.localName === "body" || el.localName === "html") break;
    if (!isActionable(el)) continue;
    if (el.localName === "label") {
      const ctl = (el as HTMLLabelElement).control as Element | null | undefined;
      if (ctl && !path.includes(ctl)) return ctl;
      // label that wraps its control and was clicked on the control itself is handled by the path check above
      return el;
    }
    if (el.localName === "option") return el.closest("select") ?? el;
    return el;
  }

  // Custom clickable widgets: cursor is inherited, so take the outermost element of the contiguous
  // pointer region that contains the innermost target (bounded, stopping at body).
  if (pointerCursor(innermost)) {
    let best = innermost;
    for (let i = 1; i < path.length && i <= 8; i++) {
      const el = path[i]!;
      if (el.localName === "body" || el.localName === "html" || !pointerCursor(el)) break;
      best = el;
    }
    return best;
  }
  return innermost;
}

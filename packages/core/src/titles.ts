import type { ElementDescriptor, Guide, Step, StepAction } from "./schema";
import { collapse, escapeInline, hostnameOf, truncate } from "./text";

/**
 * Natural-English step titles. Element names are wrapped in Markdown bold (`**Save**`);
 * literal text is escaped so a title can be rendered by any Markdown renderer.
 * Masked and sensitive values are never included.
 */

type Kind =
  | "button"
  | "link"
  | "checkbox"
  | "radio"
  | "switch"
  | "select"
  | "textbox"
  | "textarea"
  | "editable"
  | "search"
  | "menuitem"
  | "tab"
  | "option"
  | "slider"
  | "image"
  | "generic";

/** Character budgets; `generateStepTitle` retries with smaller ones if a title would pass MAX_TITLE. */
interface Limits {
  name: number;
  value: number;
}
const DEFAULT_LIMITS: Limits = { name: 60, value: 50 };
const TIGHT_LIMITS: Limits = { name: 32, value: 24 };
const TINY_LIMITS: Limits = { name: 14, value: 10 };
let LIM: Limits = DEFAULT_LIMITS;
/** No generated title is longer than this many characters. */
export const MAX_TITLE_LENGTH = 160;

const SENSITIVE_NAME_RE =
  /pass(word|code|phrase)|\bpin\b|\bcvv\b|\bcvc\b|security code|\bssn\b|social security|secret|api[ _-]?key|token|one[- ]time|\botp\b|verification code|\b2fa\b|card number|credit card|iban/i;

const TEXT_INPUT_TYPES = new Set(["", "text", "email", "tel", "url", "number", "password", "search", "date", "time", "datetime-local", "month", "week"]);

const GLYPH_NAMES: Record<string, string> = {
  "×": "Close",
  "✕": "Close",
  "✖": "Close",
  "✗": "Close",
  "☰": "Menu",
  "≡": "Menu",
  "…": "More options",
  "⋯": "More options",
  "⋮": "More options",
};

function kindOf(t: ElementDescriptor | undefined): Kind | undefined {
  if (!t) return undefined;
  const tag = t.tag.toLowerCase();
  const role = (t.role ?? "").toLowerCase();
  const type = (t.inputType ?? "").toLowerCase();
  switch (role) {
    case "button":
      return "button";
    case "link":
      return "link";
    case "checkbox":
    case "menuitemcheckbox":
      return "checkbox";
    case "radio":
    case "menuitemradio":
      return role === "radio" ? "radio" : "menuitem";
    case "switch":
      return "switch";
    case "menuitem":
      return "menuitem";
    case "tab":
      return "tab";
    case "option":
      return "option";
    case "slider":
      return "slider";
    case "img":
    case "image":
      return "image";
    case "searchbox":
      return "search";
    case "combobox":
    case "listbox":
      return tag === "input" ? "textbox" : "select";
    case "textbox":
      if (tag === "textarea") return "textarea";
      if (tag === "input") return type === "search" ? "search" : "textbox";
      return "editable";
    default:
      break;
  }
  if (tag === "button") return "button";
  if (tag === "a") return "link";
  if (tag === "select") return "select";
  if (tag === "textarea") return "textarea";
  if (tag === "img" || tag === "svg") return "image";
  if (tag === "input") {
    if (type === "checkbox") return "checkbox";
    if (type === "radio") return "radio";
    if (type === "range") return "slider";
    if (type === "search") return "search";
    if (["button", "submit", "reset", "image", "file", "color"].includes(type)) return "button";
    if (TEXT_INPUT_TYPES.has(type)) return "textbox";
    return "textbox";
  }
  if (type === "contenteditable") return "editable";
  return "generic";
}

const isTextKind = (k: Kind | undefined): boolean => k === "textbox" || k === "textarea" || k === "editable" || k === "search";

function clean(s: string | undefined): string | undefined {
  if (!s) return undefined;
  let c = collapse(s);
  if (!c) return undefined;
  const glyph = GLYPH_NAMES[c];
  if (glyph) return glyph;
  // A name made only of punctuation or symbols tells the reader nothing.
  if (!/[\p{L}\p{N}]/u.test(c)) return undefined;
  c = truncate(c, LIM.name);
  return c;
}

/** Best human name for the element, or undefined for anonymous ones. */
function nameOf(t: ElementDescriptor | undefined, kind: Kind | undefined): string | undefined {
  if (!t) return undefined;
  // For text fields `text` can be the typed content itself (contenteditable), so never use it there.
  const candidates = isTextKind(kind)
    ? [t.label, t.name, t.placeholder]
    : kind === "checkbox" || kind === "radio" || kind === "switch" || kind === "select" || kind === "slider"
      ? [t.label, t.name, t.text, t.placeholder]
      : [t.name, t.text, t.label, t.placeholder];
  for (const c of candidates) {
    const v = clean(c);
    if (v) return v;
  }
  return undefined;
}

const bold = (name: string): string => `**${escapeInline(name)}**`;

function isBullets(v: string): boolean {
  return v.length > 0 && /^[•*●·•●·\s]+$/.test(v);
}

function looksLikeCardNumber(v: string): boolean {
  const digits = v.replace(/[\s-]/g, "");
  return /^\d{13,19}$/.test(digits);
}

/** True when the step types into, or acts on, a password/card/OTP-like field, or its value is masked. */
export function isSensitiveStep(step: Pick<Step, "action" | "target">): boolean {
  const t = step.target;
  if (t?.sensitive || (t?.inputType ?? "").toLowerCase() === "password") return true;
  const a = step.action;
  if (a.type === "type") return isSecretTyping(a, t, nameOf(t, kindOf(t)));
  return false;
}

function isSecretTyping(a: Extract<StepAction, { type: "type" }>, t: ElementDescriptor | undefined, name: string | undefined): boolean {
  if (a.masked) return true;
  if (t?.sensitive) return true;
  if ((t?.inputType ?? "").toLowerCase() === "password") return true;
  if (isBullets(a.value)) return true;
  if (looksLikeCardNumber(a.value)) return true;
  const hay = [t?.label, t?.name, t?.placeholder, name].filter(Boolean).join(" ");
  return a.value !== "" && SENSITIVE_NAME_RE.test(hay);
}

const KEY_NAMES: Record<string, string> = {
  control: "Ctrl",
  ctrl: "Ctrl",
  meta: "Cmd",
  cmd: "Cmd",
  command: "Cmd",
  controlormeta: "Ctrl/Cmd",
  alt: "Alt",
  option: "Alt",
  shift: "Shift",
  escape: "Esc",
  esc: "Esc",
  enter: "Enter",
  return: "Enter",
  tab: "Tab",
  " ": "Space",
  space: "Space",
  spacebar: "Space",
  backspace: "Backspace",
  delete: "Delete",
  arrowup: "Up Arrow",
  arrowdown: "Down Arrow",
  arrowleft: "Left Arrow",
  arrowright: "Right Arrow",
  pageup: "Page Up",
  pagedown: "Page Down",
  home: "Home",
  end: "End",
  insert: "Insert",
};

const MODIFIER_ORDER = ["Ctrl/Cmd", "Ctrl", "Alt", "Shift", "Cmd"];

/** `Control+K` becomes `Ctrl+K`, `ArrowDown` becomes `Down Arrow`. Exported for exporters. */
export function formatKey(key: string): string {
  let parts: string[];
  if (key === "+") parts = ["+"];
  else if (key.endsWith("++")) parts = [...key.slice(0, -2).split("+"), "+"];
  else parts = key.split("+");
  const mapped = parts.map((p) => {
    const named = KEY_NAMES[p.toLowerCase()];
    if (named) return named;
    if (p.length === 1) return p.toUpperCase();
    if (/^f\d{1,2}$/i.test(p)) return p.toUpperCase();
    return p;
  });
  const last = mapped[mapped.length - 1] as string;
  const mods = mapped.slice(0, -1).sort((a, b) => MODIFIER_ORDER.indexOf(a) - MODIFIER_ORDER.indexOf(b));
  return [...mods, last].join("+");
}

const KIND_NOUN: Record<Kind, string> = {
  button: "button",
  link: "link",
  checkbox: "checkbox",
  radio: "radio button",
  switch: "toggle",
  select: "dropdown",
  textbox: "text field",
  textarea: "text area",
  editable: "editor",
  search: "search field",
  menuitem: "menu item",
  tab: "tab",
  option: "option",
  slider: "slider",
  image: "image",
  generic: "highlighted area",
};

/** Noun used after a bold name, when it differs from the anonymous noun ("the **Email** field"). */
const NAMED_NOUN: Partial<Record<Kind, string>> = { textbox: "field", textarea: "field" };

function clickTitle(a: Extract<StepAction, { type: "click" }>, t: ElementDescriptor | undefined): string {
  const kind = kindOf(t);
  const name = nameOf(t, kind);
  const plain = !a.double && (a.button ?? "left") === "left";
  const verb = a.double ? "Double-click" : a.button === "right" ? "Right-click" : a.button === "middle" ? "Middle-click" : "Click";

  if (!t || !kind) return `${verb} the highlighted area`;

  if (plain) {
    switch (kind) {
      case "radio":
      case "option":
        return name ? `Select ${bold(name)}` : `Select the ${KIND_NOUN[kind]}`;
      case "menuitem":
        return name ? `Select ${bold(name)} from the menu` : "Select a menu item";
      case "tab":
        return name ? `Open the ${bold(name)} tab` : "Open the tab";
      case "select":
        return name ? `Open the ${bold(name)} dropdown` : "Open the dropdown";
      default:
        break;
    }
  }
  switch (kind) {
    case "button":
    case "link":
    case "generic":
      if (name) return `${verb} ${bold(name)}`;
      return kind === "generic" ? `${verb} the highlighted area` : `${verb} the ${KIND_NOUN[kind]}`;
    case "textbox":
    case "textarea":
    case "editable":
    case "search":
    case "checkbox":
    case "switch":
    case "select":
    case "slider":
    case "image":
    case "radio":
    case "menuitem":
    case "tab":
    case "option":
      return name ? `${verb} the ${bold(name)} ${NAMED_NOUN[kind] ?? KIND_NOUN[kind]}` : `${verb} the ${KIND_NOUN[kind]}`;
  }
}

function typeTitle(a: Extract<StepAction, { type: "type" }>, t: ElementDescriptor | undefined): string {
  const kind = kindOf(t);
  const name = nameOf(t, kind);
  const where = name ? `in ${bold(name)}` : `in the ${kind && isTextKind(kind) ? KIND_NOUN[kind] : "text field"}`;
  const isPassword = (t?.inputType ?? "").toLowerCase() === "password";

  if (isSecretTyping(a, t, name)) {
    if (isPassword) {
      if (!name || /^(new |current |confirm )?password$/i.test(name)) return "Enter your password";
      return `Enter your password ${where}`;
    }
    return name ? `Fill in ${bold(name)}` : "Fill in the highlighted field";
  }

  const value = truncate(collapse(a.value), LIM.value);
  if (value === "") return name ? `Clear ${bold(name)}` : "Clear the field";
  const shown = escapeInline(value);
  if (kind === "search") return `Search for "${shown}"`;
  return `Type "${shown}" ${where}`;
}

function selectTitle(a: Extract<StepAction, { type: "select" }>, t: ElementDescriptor | undefined): string {
  const kind = kindOf(t);
  const name = nameOf(t, kind);
  const sensitive = !!t?.sensitive;
  const option = sensitive ? "" : (clean(a.optionText) ?? clean(a.value) ?? "");
  const where = name ? `in ${bold(name)}` : "from the dropdown";
  if (!option) return name ? `Choose an option in ${bold(name)}` : "Choose an option from the dropdown";
  return `Select ${bold(option)} ${where}`;
}

function checkTitle(a: Extract<StepAction, { type: "check" }>, t: ElementDescriptor | undefined): string {
  const kind = kindOf(t);
  const name = nameOf(t, kind);
  if (kind === "radio") return name ? `Select ${bold(name)}` : "Select the radio button";
  if (kind === "switch") {
    const verb = a.checked ? "Turn on" : "Turn off";
    return name ? `${verb} ${bold(name)}` : `${verb} the toggle`;
  }
  const verb = a.checked ? "Check" : "Uncheck";
  return name ? `${verb} ${bold(name)}` : `${verb} the checkbox`;
}

function pressTitle(a: Extract<StepAction, { type: "press" }>, t: ElementDescriptor | undefined): string {
  const kind = kindOf(t);
  const name = nameOf(t, kind);
  const secret = !!t?.sensitive || (t?.inputType ?? "").toLowerCase() === "password";
  // Never echo a character key pressed inside a secret field.
  const printable = Array.from(a.key).length === 1 && a.key !== " ";
  if (secret && printable) return name ? `Press a key in ${bold(name)}` : "Press a key";
  const key = bold(formatKey(collapse(a.key) || a.key));
  if (kind === "search" && a.key.toLowerCase() === "enter") return `Press ${key} to search`;
  if (name && isTextKind(kind)) return `Press ${key} in ${bold(name)}`;
  if (name && kind && kind !== "generic") return `Press ${key} on ${bold(name)}`;
  return `Press ${key}`;
}

function scrollTitle(a: Extract<StepAction, { type: "scroll" }>): string {
  const { x, y } = a;
  if (Math.abs(y) >= Math.abs(x) && y !== 0) return y > 0 ? "Scroll down" : "Scroll up";
  if (x !== 0) return x > 0 ? "Scroll right" : "Scroll left";
  return "Scroll the page";
}

function navigateTitle(a: Extract<StepAction, { type: "navigate" }>, page: Step["page"]): string {
  const title = clean(page?.title);
  if (title) return `Go to ${bold(title)}`;
  const host = hostnameOf(a.url) ?? hostnameOf(page?.url ?? "") ?? clean(a.url);
  return host ? `Go to ${bold(truncate(host, LIM.name))}` : "Go to the page";
}

function build(step: Pick<Step, "action" | "target" | "page">): string {
  const a = step.action;
  const t = step.target;
  switch (a.type) {
    case "navigate":
      return navigateTitle(a, step.page);
    case "click":
      return clickTitle(a, t);
    case "type":
      return typeTitle(a, t);
    case "select":
      return selectTitle(a, t);
    case "check":
      return checkTitle(a, t);
    case "press":
      return pressTitle(a, t);
    case "scroll":
      return scrollTitle(a);
    case "hover": {
      const kind = kindOf(t);
      const name = nameOf(t, kind);
      return name ? `Hover over ${bold(name)}` : "Hover over the highlighted area";
    }
    case "note":
      return "Note";
  }
}

/**
 * Title for a step: natural English, element names in Markdown bold, never a masked or sensitive
 * value, one line, at most `MAX_TITLE_LENGTH` characters. Pure and deterministic.
 */
export function generateStepTitle(step: Pick<Step, "action" | "target" | "page">): string {
  const saved = LIM;
  try {
    for (const limits of [DEFAULT_LIMITS, TIGHT_LIMITS, TINY_LIMITS]) {
      LIM = limits;
      const title = build(step);
      if (title.length <= MAX_TITLE_LENGTH) return title;
    }
    LIM = TINY_LIMITS;
    return truncate(build(step), MAX_TITLE_LENGTH);
  } finally {
    LIM = saved;
  }
}

/** Regenerate every title except the ones a human edited (`titleEdited`) and note steps. Pure. */
export function regenerateTitles(guide: Guide): Guide {
  return {
    ...guide,
    steps: guide.steps.map((s) => {
      if (s.titleEdited || s.action.type === "note") return s;
      const title = generateStepTitle(s);
      return title === s.title ? s : { ...s, title };
    }),
  };
}

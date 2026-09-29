// Sensitivity detection: password / card / OTP / SSN-like fields and user-marked elements.
import { composedParent } from "./util";

export const SENSITIVE_ATTR = "data-stepsnap-sensitive";

/** Whole-word tokens (after camelCase / punctuation splitting) that mark a field name or id as sensitive. */
const NAME_TOKENS = new Set([
  "ssn", "cvv", "cvc", "cvn", "iban", "otp", "totp", "pin", "passcode", "passwd", "password", "pwd",
  "secret", "token", "apikey", "creditcard", "cardnumber", "ccnum", "routing",
]);

/** Phrases (joined tokens) in labels / placeholders / aria-labels that mark a field as sensitive. */
const PHRASES = [
  /\bpass(word|code)\b/i,
  /\bcard (number|no)\b/i,
  /\b(credit|debit) card\b/i,
  /\bsecurity code\b/i,
  /\b(cvv|cvc|iban|ssn|otp)\b/i,
  /\bsocial security\b/i,
  /\bone[- ]time (code|password)\b/i,
  /\b(verification|authenticator|2fa|mfa) code\b/i,
  /\bapi[ _-]?key\b/i,
  /\bsecret\b/i,
];

const AUTOCOMPLETE = /^(cc-.*|one-time-code|new-password|current-password)$/;

function tokens(v: string): string[] {
  return v
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

function nameLooksSensitive(v: string | null): boolean {
  if (!v) return false;
  const t = tokens(v);
  if (t.some((x) => NAME_TOKENS.has(x))) return true;
  // adjacent pairs: "card number", "card num", "credit card", "security code", "social security"
  for (let i = 0; i < t.length - 1; i++) {
    const a = t[i], b = t[i + 1];
    if (a === "card" && (b === "number" || b === "num" || b === "no" || b === "nr")) return true;
    if (a === "credit" && b === "card") return true;
    if (a === "security" && (b === "code" || b === "number")) return true;
    if (a === "api" && b === "key") return true;
  }
  return false;
}

function isFormField(el: Element): boolean {
  const t = el.localName;
  if (t === "input") {
    const type = (el.getAttribute("type") ?? "text").toLowerCase();
    return !["button", "submit", "reset", "image", "checkbox", "radio", "hidden", "range", "color", "file"].includes(type);
  }
  if (t === "textarea" || t === "select") return true;
  const ce = el.getAttribute("contenteditable");
  if (ce !== null && ce.toLowerCase() !== "false") return true;
  const role = el.getAttribute("role");
  return role === "textbox" || role === "searchbox" || role === "spinbutton";
}

/** Explicit user marking: closest `data-stepsnap-sensitive` (crossing shadow hosts). "false" opts out. */
function marked(el: Element): boolean | undefined {
  for (let cur: Element | null = el; cur; cur = composedParent(cur)) {
    const v = cur.getAttribute(SENSITIVE_ATTR);
    if (v !== null) return v.trim().toLowerCase() !== "false";
  }
  return undefined;
}

/**
 * True when the element (or anything it stands for) may hold a secret. Conservative on purpose:
 * a needless blur costs a click, a leaked password costs much more.
 * Options `labelText` lets describeElement pass label text without recomputing it.
 */
export function isSensitive(el: Element, extra?: { labelText?: string }): boolean {
  const m = marked(el);
  if (m !== undefined) return m;

  if (!isFormField(el)) return false;

  if (el.localName === "input") {
    const type = (el.getAttribute("type") ?? "text").toLowerCase();
    if (type === "password") return true;
  }
  const ac = (el.getAttribute("autocomplete") ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  if (ac.some((tok) => AUTOCOMPLETE.test(tok))) return true;

  if (nameLooksSensitive(el.getAttribute("name")) || nameLooksSensitive(el.getAttribute("id"))) return true;

  const texts = [el.getAttribute("aria-label"), el.getAttribute("placeholder"), extra?.labelText];
  return texts.some((s) => !!s && PHRASES.some((re) => re.test(s)));
}

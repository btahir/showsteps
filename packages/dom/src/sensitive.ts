// Sensitivity detection: password / card / OTP / SSN-like fields and user-marked elements.
// Redaction is on by default in the product, so this is deliberately conservative and reaches into
// shadow roots (marker lookup crosses hosts) and same-origin iframes (marker lookup crosses frames;
// `findSensitiveElements` scans them).
import { composedParent, isElement, winOf } from "./util";

/** User marker: add to any element (or an ancestor) to have it blurred in guides. */
export const SENSITIVE_ATTR = "data-showsteps-sensitive";
/** Legacy spelling, still honoured. */
export const LEGACY_SENSITIVE_ATTR = "data-stepsnap-sensitive";
const MARKERS = [SENSITIVE_ATTR, LEGACY_SENSITIVE_ATTR];

/** Whole-word tokens (after camelCase / punctuation splitting) that mark a field name or id as sensitive. */
const NAME_TOKENS = new Set([
  "ssn", "cvv", "cvc", "cvn", "csc", "iban", "otp", "totp", "hotp", "pin", "passcode", "passwd", "password", "pwd", "pass",
  "passphrase", "passport", "secret", "token", "apikey", "creditcard", "debitcard", "cardnumber", "cardnum", "ccnum", "ccnumber",
  "routing", "sortcode", "taxid", "tin", "itin",
]);

/** Phrases in labels / placeholders / aria-labels that mark a field as sensitive. */
const PHRASES = [
  /\bpass(word|code|phrase)\b/i,
  /\bcard (number|no\.?|num)\b/i,
  /\b(credit|debit|payment) card\b/i,
  /\bsecurity code\b/i,
  /\b(cvv|cvc|csc|iban|ssn|otp|tin|itin)\b/i,
  /\b(social security|tax id|national id|sort code|routing number|account number)\b/i,
  /\bone[- ]time (code|password|passcode)\b/i,
  /\b(verification|authenticat(or|ion)|security|2fa|mfa|sms) code\b/i,
  /\bapi[ _-]?(key|secret)\b/i,
  /\b(secret|private) key\b/i,
  /\bsecret\b/i,
  /\brecovery (code|phrase)\b/i,
  /\bseed phrase\b/i,
];

const AUTOCOMPLETE = /^(cc-.*|one-time-code|new-password|current-password)$/;

/** Payment / secure-field vendors whose iframes hold card data (cross-origin: we can only blur the frame). */
const SENSITIVE_FRAME_SRC = /(js|m|checkout|hooks)\.stripe\.com|braintreegateway|hostedfields|hosted-fields|adyen(cdn)?\.com|checkoutshopper|securepay|pay\.google\.com|cardconnect|elements-inner|secure-?fields|recaptcha-?never/i;

function tokens(v: string): string[] {
  return v
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

const PAIRS: Record<string, string[]> = {
  card: ["number", "num", "no", "nr", "code", "cvv", "cvc", "expiry", "exp"],
  cc: ["number", "num", "no", "csc", "cvc", "cvv", "exp", "expiry"],
  credit: ["card"],
  debit: ["card"],
  security: ["code", "number", "answer"],
  api: ["key", "secret"],
  social: ["security"],
  tax: ["id"],
  national: ["id"],
  sort: ["code"],
  account: ["number"],
  routing: ["number"],
  recovery: ["code", "phrase"],
  seed: ["phrase"],
  one: ["time"],
  private: ["key"],
  auth: ["code", "token"],
  verification: ["code"],
};

function nameLooksSensitive(v: string | null): boolean {
  if (!v) return false;
  const t = tokens(v);
  if (t.some((x) => NAME_TOKENS.has(x))) return true;
  for (let i = 0; i < t.length - 1; i++) {
    const nexts = PAIRS[t[i]!];
    if (nexts && nexts.includes(t[i + 1]!)) return true;
  }
  return false;
}

function phraseSensitive(...texts: (string | null | undefined)[]): boolean {
  return texts.some((s) => !!s && PHRASES.some((re) => re.test(s)));
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
  return role === "textbox" || role === "searchbox" || role === "spinbutton" || role === "combobox";
}

function markerValue(el: Element): boolean | undefined {
  for (const a of MARKERS) {
    const v = el.getAttribute(a);
    if (v !== null) return v.trim().toLowerCase() !== "false";
  }
  return undefined;
}

/** Explicit user marking: nearest marker up the tree, crossing shadow hosts and same-origin frames. "false" opts out. */
function marked(el: Element): boolean | undefined {
  let cur: Element | null = el;
  for (let guard = 0; cur && guard < 12; guard++) {
    for (let e: Element | null = cur; e; e = composedParent(e)) {
      const v = markerValue(e);
      if (v !== undefined) return v;
    }
    // continue into the embedding page when this document lives in a same-origin iframe
    let fe: Element | null = null;
    try {
      fe = winOf(cur)?.frameElement ?? null;
    } catch {
      fe = null;
    }
    cur = isElement(fe) ? fe : null;
  }
  return undefined;
}

function iframeSensitive(el: Element): boolean {
  if (nameLooksSensitive(el.getAttribute("name")) || nameLooksSensitive(el.getAttribute("id"))) return true;
  if (phraseSensitive(el.getAttribute("title"), el.getAttribute("aria-label"))) return true;
  const src = el.getAttribute("src") ?? "";
  if (SENSITIVE_FRAME_SRC.test(src) || SENSITIVE_FRAME_SRC.test(el.getAttribute("name") ?? "")) return true;
  const allow = el.getAttribute("allow") ?? "";
  return /payment/i.test(allow) && /card|pay/i.test(el.getAttribute("title") ?? "");
}

/**
 * True when the element (or anything it stands for) may hold a secret. Conservative on purpose:
 * a needless blur costs a click, a leaked password costs much more.
 * `extra.labelText` lets describeElement pass label text without recomputing it.
 */
export function isSensitive(el: Element, extra?: { labelText?: string }): boolean {
  const m = marked(el);
  if (m !== undefined) return m;

  if (el.localName === "iframe" || el.localName === "frame") return iframeSensitive(el);
  if (!isFormField(el)) return false;

  if (el.localName === "input") {
    const type = (el.getAttribute("type") ?? "text").toLowerCase();
    if (type === "password") return true;
  }
  const ac = (el.getAttribute("autocomplete") ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  if (ac.some((tok) => AUTOCOMPLETE.test(tok))) return true;

  if (nameLooksSensitive(el.getAttribute("name")) || nameLooksSensitive(el.getAttribute("id"))) return true;
  if (nameLooksSensitive(el.getAttribute("data-testid")) || nameLooksSensitive(el.getAttribute("data-qa"))) return true;

  return phraseSensitive(el.getAttribute("aria-label"), el.getAttribute("placeholder"), extra?.labelText, el.getAttribute("title"));
}

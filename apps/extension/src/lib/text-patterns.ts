// Secrets that show up as plain text on a page (PLAN §3.7): card numbers (Luhn-checked), US
// social security numbers, IBANs (mod-97 checked), API tokens and JWTs, long random tokens, and
// (off by default) email addresses. Pure string matching; the recorder maps matches to screen
// rectangles with Range.getClientRects and the worker burns them into the screenshot.
//
// Accepted false positives: 40-hex git SHAs and other long random strings are treated as
// secrets. Not flagged: Luhn-failing digit runs (order numbers), 13-digit epoch milliseconds,
// dates, UUIDs, phone numbers, ordinary prose.

export type SecretKind = "card" | "ssn" | "iban" | "token" | "email";

export interface SecretMatch {
  kind: SecretKind;
  start: number;
  end: number;
}

export interface PatternOptions {
  /** Also match email addresses (default off). */
  emails?: boolean;
}

/** Luhn checksum over the digits of `s` (separators ignored). */
export function luhnValid(s: string): boolean {
  const digits = s.replace(/\D/g, "");
  if (!digits) return false;
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

/**
 * Card numbers: 13 to 19 digits in groups separated by single spaces or dashes, Luhn-valid,
 * starting with a digit a card network uses (2 to 6). The first-digit rule keeps epoch
 * milliseconds (1...) out; the Luhn rule keeps most order and invoice numbers out.
 */
const CARD = /(?<![\d-])[2-6]\d{3}(?:[ -]?\d){9,15}(?![\d-])/g;

export function isCardNumber(s: string): boolean {
  const digits = s.replace(/[ -]/g, "");
  if (!/^\d{13,19}$/.test(digits) || !/^[2-6]/.test(digits)) return false;
  // One separator style per number ("4242 4242-4242" is not how cards are written).
  if (/ /.test(s) && /-/.test(s)) return false;
  // Grouped the way cards are printed: 4 digits first, then groups of 3 to 6 (4-4-4-4, 4-6-5, 4-4-4-4-3).
  if (/[ -]/.test(s) && !/^\d{4}(?:[ -]\d{3,6})+$/.test(s)) return false;
  // All one digit ("4444 4444 4444 4444" passes Luhn) is a placeholder, not a number.
  if (/^(\d)\1+$/.test(digits)) return false;
  return luhnValid(digits);
}

/**
 * US SSN `ddd-dd-dddd`. Areas 000, 666 and 900-999, group 00 and serial 0000 are never issued.
 * `555-01xx` is the prefix reserved for fictional phone numbers, so `555-01-0199` is left alone.
 */
const SSN = /(?<![\d-])(\d{3})-(\d{2})-(\d{4})(?![\d-])/g;

function isSsn(area: string, group: string, serial: string): boolean {
  if (area === "000" || area === "666" || area[0] === "9") return false;
  if (group === "00" || serial === "0000") return false;
  if (area === "555" && group === "01") return false;
  return true;
}

/** IBAN: country code, 2 check digits, 11 to 30 more characters, optionally in groups of 4. */
const IBAN = /\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){2,7}(?: ?[A-Z0-9]{1,4})?\b/g;

export function isIban(s: string): boolean {
  const compact = s.replace(/ /g, "");
  if (compact.length < 15 || compact.length > 34) return false;
  const rearranged = compact.slice(4) + compact.slice(0, 4);
  let rem = 0;
  for (const ch of rearranged) {
    const code = ch.charCodeAt(0);
    const v = code >= 65 ? String(code - 55) : ch;
    for (const d of v) rem = (rem * 10 + (d.charCodeAt(0) - 48)) % 97;
  }
  return rem === 1;
}

/** Well-known secret prefixes and three-part JWTs. */
const TOKEN_PREFIXED = new RegExp(
  [
    String.raw`\b(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]{8,}`, // Stripe
    String.raw`\bsk-[A-Za-z0-9_-]{20,}`, // OpenAI-style
    String.raw`\bgh[pousr]_[A-Za-z0-9]{30,}`, // GitHub tokens
    String.raw`\bgithub_pat_[A-Za-z0-9_]{30,}`,
    String.raw`\bglpat-[A-Za-z0-9_-]{20,}`, // GitLab
    String.raw`\bxox[abprs]-[A-Za-z0-9-]{10,}`, // Slack
    String.raw`\bAKIA[0-9A-Z]{16}\b`, // AWS access key id
    String.raw`\bAIza[0-9A-Za-z_-]{35}`, // Google API key
    String.raw`\bnpm_[A-Za-z0-9]{36}`,
    String.raw`\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}`, // JWT
  ].join("|"),
  "g",
);

/** Long hex runs (32+) and long base64/base64url runs (32+) that look random. */
const LONG_HEX = /(?<![A-Za-z0-9_+/-])[0-9a-fA-F]{32,}(?![A-Za-z0-9_+/-])/g;
const LONG_B64 = /(?<![A-Za-z0-9_+/-])[A-Za-z0-9_+/-]{32,}={0,2}(?![A-Za-z0-9_+/-])/g;

export function looksRandom(s: string): boolean {
  const body = s.replace(/=+$/, "");
  if ((body.match(/[0-9]/g)?.length ?? 0) < 2 || !/[a-z]/.test(body) || !/[A-Z]/.test(body)) return false;
  // Paths and dashed-words: long letter runs separated by / or - are not tokens.
  if (/[/-]/.test(body) && body.split(/[/-]/).every((part) => /^[A-Za-z]*\d{0,4}$/.test(part))) return false;
  return new Set(body).size >= 12;
}

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;

/** Cheap test before any real matching: could `text` contain a secret at all? */
export function mightContainSecret(text: string, opts: PatternOptions = {}): boolean {
  if (text.length < 9) return false;
  if (/\d{3}-\d{2}-\d{4}|\d{4}[ -]?\d{4}[ -]?\d{4}|\d{13}|[A-Za-z0-9_+/=-]{20,}|[A-Z]{2}\d{2}/.test(text)) return true;
  return !!opts.emails && text.includes("@");
}

function overlaps(list: SecretMatch[], start: number, end: number): boolean {
  return list.some((m) => start < m.end && end > m.start);
}

/** Every secret in `text`, as non-overlapping [start, end) ranges sorted by position. */
export function findSecrets(text: string, opts: PatternOptions = {}): SecretMatch[] {
  if (!mightContainSecret(text, opts)) return [];
  const out: SecretMatch[] = [];
  const add = (kind: SecretKind, start: number, end: number) => {
    if (end > start && !overlaps(out, start, end)) out.push({ kind, start, end });
  };
  for (const m of text.matchAll(TOKEN_PREFIXED)) add("token", m.index!, m.index! + m[0].length);
  for (const m of text.matchAll(CARD)) {
    // The greedy run may include a trailing group that is not part of the card; try shorter prefixes.
    const raw = m[0];
    for (let len = raw.length; len >= 13; len--) {
      const cand = raw.slice(0, len);
      if (/[ -]$/.test(cand)) continue;
      if (isCardNumber(cand)) {
        add("card", m.index!, m.index! + len);
        break;
      }
    }
  }
  for (const m of text.matchAll(SSN)) if (isSsn(m[1]!, m[2]!, m[3]!)) add("ssn", m.index!, m.index! + m[0].length);
  for (const m of text.matchAll(IBAN)) if (isIban(m[0])) add("iban", m.index!, m.index! + m[0].length);
  for (const m of text.matchAll(LONG_HEX)) add("token", m.index!, m.index! + m[0].length);
  for (const m of text.matchAll(LONG_B64)) if (looksRandom(m[0])) add("token", m.index!, m.index! + m[0].length);
  if (opts.emails) for (const m of text.matchAll(EMAIL)) add("email", m.index!, m.index! + m[0].length);
  return out.sort((a, b) => a.start - b.start);
}

/** Human label for the auto-redaction chip ("Card number blurred"). */
export const KIND_LABEL: Record<SecretKind, string> = {
  card: "Card number",
  ssn: "Social security number",
  iban: "Bank account number",
  token: "Access token",
  email: "Email address",
};

import { describe, expect, it } from "vitest";
import { findSecrets, isCardNumber, isIban, luhnValid } from "../src/lib/text-patterns";

const kinds = (text: string, opts = {}) => findSecrets(text, opts).map((m) => [m.kind, text.slice(m.start, m.end)]);

describe("luhn and validators", () => {
  it("checks Luhn", () => {
    expect(luhnValid("4242424242424242")).toBe(true);
    expect(luhnValid("4242424242424241")).toBe(false);
    expect(luhnValid("378282246310005")).toBe(true);
  });
  it("accepts published test cards in print groupings", () => {
    for (const c of ["4242 4242 4242 4242", "4111-1111-1111-1111", "378282246310005", "3782 822463 10005", "5555555555554444", "6011111111111117"]) {
      expect(isCardNumber(c), c).toBe(true);
    }
  });
  it("rejects Luhn failures, epoch ms, odd groupings and placeholders", () => {
    for (const c of ["1234 5678 9012 3456", "1727539200000", "4242 42 4242424242", "4444 4444 4444 4444", "4242 4242-4242 4242"]) {
      expect(isCardNumber(c), c).toBe(false);
    }
  });
  it("checks IBAN mod 97", () => {
    expect(isIban("GB82 WEST 1234 5698 7654 32")).toBe(true);
    expect(isIban("DE89370400440532013000")).toBe(true);
    expect(isIban("GB82 WEST 1234 5698 7654 33")).toBe(false);
  });
});

describe("findSecrets: flagged (ACCEPTANCE C4)", () => {
  const cases: [string, string, string][] = [
    ["Card on file: 4242 4242 4242 4242.", "card", "4242 4242 4242 4242"],
    ["Visa 4111-1111-1111-1111 expires", "card", "4111-1111-1111-1111"],
    ["amex 378282246310005", "card", "378282246310005"],
    ["SSN 123-45-6789 on record", "ssn", "123-45-6789"],
    ["key sk_live_51HxxxxxxxxxxxxxxxxxxxxxxxxxxTEST here", "token", "sk_live_51HxxxxxxxxxxxxxxxxxxxxxxxxxxTEST"],
    ["ghp_" + "a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8", "token", "ghp_a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8"],
    ["slack xoxb-1234567890-abcdefghij", "token", "xoxb-1234567890-abcdefghij"],
    ["aws AKIAIOSFODNN7EXAMPLE", "token", "AKIAIOSFODNN7EXAMPLE"],
    ["iban GB82 WEST 1234 5698 7654 32 (GBP)", "iban", "GB82 WEST 1234 5698 7654 32"],
    ["openai sk-proj-Abc123def456GHI789jkl012", "token", "sk-proj-Abc123def456GHI789jkl012"],
    ["commit 9fceb02d0ae598e95dc970b74767f19372d61af8", "token", "9fceb02d0ae598e95dc970b74767f19372d61af8"],
    ["base64 dGhpcyBpcyBhIHNlY3JldCB0b2tlbiAxMjM0NTY3ODkw", "token", "dGhpcyBpcyBhIHNlY3JldCB0b2tlbiAxMjM0NTY3ODkw"],
  ];
  for (const [text, kind, match] of cases) {
    it(`${kind}: ${match.slice(0, 24)}`, () => expect(kinds(text)).toContainEqual([kind, match]));
  }
  it("a three-part JWT", () => {
    const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U";
    expect(kinds(`Bearer ${jwt}`)).toEqual([["token", jwt]]);
  });
});

describe("findSecrets: not flagged", () => {
  const clean = [
    "Order 1234 5678 9012 3456 shipped",
    "Created at 1727539200000 ms",
    "Due 2026-09-28",
    "id 123e4567-e89b-12d3-a456-426614174000",
    "Call 555-01-0199 for help",
    "Passenger name and compass heading are fine.",
    "Contact jane@example.com today",
    "/Users/Someone/Downloads/Project2026/Reports/Quarterly",
    "Invoice INV-2026-000123 total 1,234.56",
    "Area 000-12-3456 and 900-12-3456 are never issued",
  ];
  for (const t of clean) it(t, () => expect(kinds(t)).toEqual([]));
});

describe("email preset", () => {
  it("is off by default and on when asked", () => {
    expect(kinds("mail jane@example.com")).toEqual([]);
    expect(kinds("mail jane@example.com", { emails: true })).toEqual([["email", "jane@example.com"]]);
  });
});

describe("ranges", () => {
  it("returns sorted, non-overlapping ranges", () => {
    const t = "a 123-45-6789 b 4242424242424242 c";
    const m = findSecrets(t);
    expect(m.map((x) => x.kind)).toEqual(["ssn", "card"]);
    expect(t.slice(m[1]!.start, m[1]!.end)).toBe("4242424242424242");
  });
});

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
    ["key sk_" + "live_51HxxxxxxxxxxxxxxxxxxxxxxxxxxTEST here", "token", "sk_" + "live_51HxxxxxxxxxxxxxxxxxxxxxxxxxxTEST"],
    ["ghp_" + "a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8", "token", "ghp_" + "a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8"],
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

describe("IP, MAC and phone presets (coordinator ruling: IP and MAC on, phones off)", () => {
  it("IPv4 and IPv6 are found by default", () => {
    expect(kinds("server 192.168.10.24 is up")).toEqual([["ip", "192.168.10.24"]]);
    expect(kinds("gateway 10.0.0.1")).toEqual([["ip", "10.0.0.1"]]);
    expect(kinds("v6 2001:db8:85a3::8a2e:370:7334 ok")).toEqual([["ip", "2001:db8:85a3::8a2e:370:7334"]]);
    expect(kinds("full 2001:0db8:0000:0000:0000:ff00:0042:8329")).toEqual([["ip", "2001:0db8:0000:0000:0000:ff00:0042:8329"]]);
    expect(kinds("link fe80::1ff:fe23:4567:890a%eth0")).toContainEqual(["ip", "fe80::1ff:fe23:4567:890a"]);
    expect(kinds("mapped ::ffff:192.0.2.128")).toContainEqual(["ip", "::ffff:192.0.2.128"]);
  });
  it("MAC addresses are found by default, in every common notation", () => {
    expect(kinds("nic 00:1A:2b:3C:4d:5E")).toEqual([["mac", "00:1A:2b:3C:4d:5E"]]);
    expect(kinds("nic 00-1A-2B-3C-4D-5E")).toEqual([["mac", "00-1A-2B-3C-4D-5E"]]);
    expect(kinds("cisco 001a.2b3c.4d5e")).toEqual([["mac", "001a.2b3c.4d5e"]]);
  });
  it("switching IP and MAC off stops them", () => {
    expect(kinds("server 192.168.10.24 nic 00:1A:2B:3C:4D:5E", { ips: false, macs: false })).toEqual([]);
  });
  it("phone numbers only with the preset", () => {
    expect(kinds("call +31 20 794 6000 now")).toEqual([]);
    expect(kinds("call +31 20 794 6000 now", { phones: true })).toEqual([["phone", "+31 20 794 6000"]]);
    expect(kinds("us (415) 555-2671", { phones: true })).toEqual([["phone", "(415) 555-2671"]]);
    expect(kinds("uk 020 7946 0958", { phones: true })).toEqual([["phone", "020 7946 0958"]]);
  });
  it("leaves times, dates, versions, UUIDs and order numbers alone, even with every preset on", () => {
    const all = { emails: true, phones: true, ips: true, macs: true };
    for (const t of ["at 10:30:15 today", "on 2026-10-14", "version 2.14.3", "v1.2.3.4.5 build", "id 550e8400-e29b-41d4-a716-446655440000", "order 1234 5678 9012 3456", "ratio 16:9 and 4:3", "std::vector<int>"]) {
      expect(kinds(t, all), t).toEqual([]);
    }
  });
});

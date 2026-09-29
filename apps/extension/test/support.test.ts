import { describe, expect, it } from "vitest";
import { shouldShowSupport } from "../src/lib/support";

describe("support moment frequency", () => {
  it("shows on the 1st, 3rd, 10th, then every 15th export", () => {
    const shown = Array.from({ length: 60 }, (_, i) => i + 1).filter((n) => shouldShowSupport({ exports: n, notNow: 0 }));
    expect(shown).toEqual([1, 3, 10, 25, 40, 55]);
  });
  it("never before a successful export, and never after three 'Not now'", () => {
    expect(shouldShowSupport({ exports: 0, notNow: 0 })).toBe(false);
    expect(shouldShowSupport({ exports: 3, notNow: 2 })).toBe(true);
    expect(shouldShowSupport({ exports: 3, notNow: 3 })).toBe(false);
  });
});

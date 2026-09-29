import { describe, expect, it } from "vitest";
import { CAUSED_BY_ACTION_MS, createNavTracker, isRecordableUrl, noteAction, shouldRecordNavigation } from "../src/lib/nav";

describe("navigation steps", () => {
  it("skips navigations caused by a recorded click, records typed ones", () => {
    const t = createNavTracker();
    t.lastUrl.set(1, "http://localhost:4517/");
    noteAction(t, 1, 1000);
    expect(shouldRecordNavigation(t, 1, "http://localhost:4517/dashboard", 1500)).toBe(false);
    expect(shouldRecordNavigation(t, 1, "http://localhost:4517/help.html", 1000 + CAUSED_BY_ACTION_MS + 1)).toBe(true);
  });

  it("ignores duplicate URL reports and non-web pages", () => {
    const t = createNavTracker();
    t.lastUrl.set(1, "https://a.test/x");
    expect(shouldRecordNavigation(t, 1, "https://a.test/x", 99_999)).toBe(false);
    expect(shouldRecordNavigation(t, 1, "chrome://newtab/", 99_999)).toBe(false);
    expect(isRecordableUrl("about:blank")).toBe(false);
    expect(isRecordableUrl("file:///tmp/x.html")).toBe(true);
  });

  it("records the first real page of a new tab even right after a click", () => {
    const t = createNavTracker();
    noteAction(t, 2, 1000);
    expect(shouldRecordNavigation(t, 2, "about:blank", 1001)).toBe(false);
    expect(shouldRecordNavigation(t, 2, "https://a.test/checkout", 1002, { isNewTab: true })).toBe(true);
  });
});

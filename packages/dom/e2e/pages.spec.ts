import { assertLocatorsResolve, checkGolden, describeTarget, expect, test, type Target } from "./harness";

const login: Target[] = [
  { key: "email", selector: "#email" },
  { key: "password", selector: "#password" },
  { key: "remember", selector: "#remember" },
  { key: "sign-in", selector: "#sign-in" },
  { key: "forgot", selector: "#forgot" },
  { key: "heading", selector: "h1" },
];

const dashboard: Target[] = [
  { key: "brand", selector: ".brand" },
  { key: "nav-reports", selector: "#nav-reports" },
  { key: "search-icon-button", selector: "#search-btn" },
  { key: "notifications-icon-button", selector: "#notifications-btn" },
  { key: "add-book-icon-button", selector: "#add-book" },
  { key: "settings-icon-link", selector: "#settings-link" },
  { key: "edit-first-row", selector: "tbody tr:first-child .edit" },
  { key: "edit-last-row", selector: "tbody tr:last-child .edit" },
  { key: "book-cell", selector: "tbody tr:nth-child(2) td:first-child" },
  { key: "stat-with-testid", selector: '[data-testid="stat-overdue"]' },
  { key: "help-link-new-tab", selector: "#help-link" },
  { key: "export-csv-slow", selector: "#export-csv" },
];

const settings: Target[] = [
  { key: "full-name", selector: "#full-name" },
  { key: "email-testid", selector: "#settings-email" },
  { key: "billing-period-select", selector: "#billing-period" },
  { key: "plan-group", selector: "#plan-group" },
  { key: "plan-pro-radio", selector: "#plan-pro" },
  { key: "email-invoices-checkbox", selector: "#email-invoices" },
  { key: "notes-textarea", selector: "#notes" },
  { key: "signature-contenteditable", selector: "#signature" },
  { key: "card-number", selector: "#card-number" },
  { key: "card-expiry", selector: "#card-expiry" },
  { key: "card-cvc", selector: "#card-cvc" },
  { key: "confirm-iframe-element", selector: "#confirm-frame" },
  { key: "frame-confirm-button", selector: "#frame-confirm", frame: "/frame.html" },
  { key: "frame-verification-code", selector: "#frame-code", frame: "/frame.html" },
  { key: "shadow-tip-button", selector: "#tip-btn", hosts: ["#tip-host"] },
  { key: "shadow-backup-pin", selector: "#tip-pin", hosts: ["#tip-host"] },
  { key: "cancel-no-testid", selector: "#cancel" },
  { key: "save-testid", selector: "#save" },
];

const help: Target[] = [
  { key: "help-search", selector: "#help-search" },
  { key: "contact-support", selector: "#contact-support" },
  { key: "article-link", selector: "#articles li:nth-child(2) a" },
];

async function run(page: import("@playwright/test").Page, golden: string, targets: Target[]) {
  const out: Record<string, unknown> = {};
  const problems: string[] = [];
  for (const t of targets) {
    const d = await describeTarget(page, t);
    out[t.key] = d;
    problems.push(...(await assertLocatorsResolve(page, t, d)));
  }
  expect(problems, "every emitted locator resolves to exactly the target in real Playwright").toEqual([]);
  checkGolden(golden, out);
  return out as Record<string, import("@stepsnap/core").ElementDescriptor>;
}

test("login page descriptors", async ({ page }) => {
  await page.goto("/index.html");
  const d = await run(page, "login", login);
  expect(d.password!.sensitive).toBe(true);
  expect(d.email!.sensitive).toBeUndefined();
});

test("dashboard descriptors (icon buttons, slow button, SPA view)", async ({ page }) => {
  await page.goto("/dashboard.html");
  await page.waitForSelector("#export-csv"); // the slow-loading button appears after ~1.2 s
  const d = await run(page, "dashboard", dashboard);
  expect(d["add-book-icon-button"]!.name).toBe("Add book");
  expect(d["export-csv-slow"]!.locators[0]).toMatchObject({ kind: "role", role: "button", name: "Export CSV" });

  // SPA route change through history.pushState keeps working with the same descriptor code
  await page.click("#nav-reports");
  await expect(page).toHaveURL(/\/dashboard\/reports$/);
  await expect(page).toHaveTitle("Reports – Acme Books");
  const r = await run(page, "dashboard-reports", [{ key: "download-report", selector: "#download-report" }]);
  expect(r["download-report"]!.locators[0]).toEqual({ kind: "testid", value: "download-report" });
});

test("settings page descriptors (forms, iframe, shadow DOM, card fields)", async ({ page }) => {
  await page.goto("/settings.html");
  await page.waitForSelector("acme-tip");
  const d = await run(page, "settings", settings);
  for (const k of ["card-number", "card-expiry", "card-cvc", "frame-verification-code", "shadow-backup-pin"]) {
    expect(d[k]!.sensitive, k).toBe(true);
  }
  expect(d["full-name"]!.sensitive).toBeUndefined();
  expect(d["frame-confirm-button"]!.frame).toEqual(["#confirm-frame"]);
  expect(d["shadow-tip-button"]!.shadow).toEqual(["acme-tip"]);
  expect(d["signature-contenteditable"]!.text).toBeUndefined();
});

test("help page descriptors", async ({ page }) => {
  await page.goto("/help.html");
  await run(page, "help", help);
});

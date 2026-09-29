// Visual pass: records a short flow, then screenshots the side panel (400 px) and the full-tab
// editor in light and dark, plus the export sheet and the support moment. Output:
// e2e/.artifacts/screens/*.png (look at them; they are not pixel-compared).
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { ARTIFACTS, extUrl, FIXTURES, launch } from "./harness";
import type { Harness } from "./harness";

const SHOTS = join(ARTIFACTS, "screens");
let h: Harness;

test.beforeAll(async () => {
  mkdirSync(SHOTS, { recursive: true });
  h = await launch();
});
test.afterAll(async () => {
  await h?.close();
});

async function both(page: Page, name: string, fn?: () => Promise<void>) {
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await fn?.();
    await page.waitForTimeout(250);
    await page.screenshot({ path: join(SHOTS, `${name}-${scheme}.png`), fullPage: false });
  }
}

test("side panel and editor, light and dark", async () => {
  const { context } = h;
  const main = await context.newPage();
  await main.goto(`${FIXTURES}/index.html`);
  // Empty state in its own tab (viewport emulation on a tab in the recording window would
  // disturb captureVisibleTab in headless mode, so sizes are only set outside the recording).
  const first = await context.newPage();
  await first.setViewportSize({ width: 400, height: 900 });
  await first.goto(extUrl(h, "sidepanel.html"));
  await both(first, "panel-empty");
  await first.close();
  const panel = await context.newPage();
  await panel.goto(extUrl(h, "sidepanel.html"));

  await main.bringToFront();
  await panel.getByRole("button", { name: /start recording/i }).click();
  await main.waitForTimeout(1500);
  const act = async (fn: () => Promise<unknown>) => {
    await main.mouse.move(5, 5);
    await main.waitForTimeout(1400);
    await fn();
    await main.waitForTimeout(900);
  };
  await act(async () => {
    await main.click("#email");
    await main.locator("#email").pressSequentially("jane@example.com", { delay: 20 });
  });
  await act(async () => {
    await main.click("#password");
    await main.locator("#password").pressSequentially("Correct-Horse-9", { delay: 20 });
  });
  await act(() => main.click("#sign-in"));
  await main.waitForURL("**/dashboard.html");
  await act(() => main.click("#settings-link"));
  await main.waitForURL("**/settings.html");
  await act(() => main.selectOption("#billing-period", "yearly"));
  await main.waitForTimeout(1200);
  await panel.setViewportSize({ width: 400, height: 900 });
  await both(panel, "panel-recording");

  await panel.getByRole("button", { name: /stop and review/i }).click();
  const editor = await context.waitForEvent("page", { predicate: (p) => p.url().includes("editor.html") });
  await editor.waitForLoadState();
  await editor.setViewportSize({ width: 1280, height: 860 });
  await editor.waitForTimeout(800);
  await both(editor, "editor");

  // Panel: select step 2 (the masked password) to show the expanded card.
  await panel.bringToFront();
  await panel.waitForTimeout(500);
  await panel.getByRole("button", { name: /^step 3:/i }).first().click();
  await both(panel, "panel-guide");

  await panel.getByRole("button", { name: /^export/i }).click();
  await expect(panel.locator("dialog.export")).toBeVisible();
  await both(panel, "panel-export");
  await panel.locator('[data-format="html"]').click();
  await Promise.all([panel.waitForEvent("download"), panel.getByTestId("export-go").click()]);
  await expect(panel.getByRole("link", { name: /support showsteps/i })).toBeVisible();
  await both(panel, "panel-support");
  await panel.getByRole("button", { name: "Close" }).click();

  // Narrow panel (review #8), settings, library.
  await panel.setViewportSize({ width: 320, height: 800 });
  await both(panel, "panel-narrow-320");
  await panel.setViewportSize({ width: 400, height: 900 });
  await panel.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(panel.getByRole("switch", { name: /blur email addresses/i })).toBeVisible();
  await both(panel, "panel-settings");
  await panel.getByRole("button", { name: "Settings", exact: true }).click();
  await both(panel, "panel-library");
});

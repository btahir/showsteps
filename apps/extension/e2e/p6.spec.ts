// ACCEPTANCE P6: permission behaviour. The store build holds no host access until Record, and the
// panel asks for it only inside the Record click (Chrome's prompt itself is not automatable, so
// only the request is observed). With access withdrawn mid-recording, recording stops cleanly and
// the panel says why.
import { expect, test } from "@playwright/test";
import { ctl, extUrl, FIXTURES, launch, STORE_DIR } from "./harness";

test("P6 store build: no <all_urls> before Record; permissions.request only runs inside the Record click (user activation)", async () => {
  const h = await launch({ extDir: STORE_DIR });
  try {
    const panel = await h.context.newPage();
    await panel.addInitScript(() => {
      const calls: { active: boolean }[] = [];
      (globalThis as any).__permCalls = calls;
      const orig = chrome.permissions.request.bind(chrome.permissions);
      (chrome.permissions as any).request = (p: chrome.permissions.Permissions) => {
        calls.push({ active: (navigator as any).userActivation?.isActive === true });
        return orig(p);
      };
    });
    await panel.goto(extUrl(h, "sidepanel.html"));
    expect(await panel.evaluate(() => chrome.permissions.contains({ origins: ["<all_urls>"] }))).toBe(false);
    // Moving around the panel (library, settings) never asks.
    await panel.getByRole("button", { name: "Settings", exact: true }).click();
    await expect(panel.getByRole("button", { name: "Allow" })).toBeVisible();
    await panel.getByRole("button", { name: "Settings", exact: true }).click();
    await panel.waitForTimeout(500);
    expect(await panel.evaluate(() => (globalThis as any).__permCalls.length)).toBe(0);
    // Record asks, from inside the click.
    await panel.getByRole("button", { name: /start recording/i }).click();
    await expect.poll(() => panel.evaluate(() => (globalThis as any).__permCalls.length)).toBe(1);
    expect(await panel.evaluate(() => (globalThis as any).__permCalls[0].active)).toBe(true);
  } finally {
    await h.close();
  }
});

test("P6 access withdrawn mid-recording: recording stops cleanly, the panel says why, no exception", async () => {
  const h = await launch();
  const errors: string[] = [];
  h.worker.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  try {
    const main = await h.context.newPage();
    await main.goto(`${FIXTURES}/index.html`);
    const panel = await h.context.newPage();
    await panel.goto(extUrl(h, "sidepanel.html"));
    await main.bringToFront();
    const r = await ctl(panel, { type: "ctl:start" });
    expect(r.ok, r.error).toBe(true);
    await main.waitForTimeout(1200);
    const removed = await panel.evaluate(() => chrome.permissions.remove({ origins: ["<all_urls>"] }).then(String, (e) => `error: ${e?.message ?? e}`));
    test.skip(removed !== "true", `Chrome would not withdraw <all_urls> here (${removed}); covered by the manual checklist`);
    const status = () => panel.evaluate(() => chrome.storage.session.get("session").then((x) => (x.session as { status: string } | undefined)?.status));
    await expect.poll(status).toBe("idle");
    await expect(panel.getByText(/site access was turned off/i)).toBeVisible();
    expect(await panel.evaluate(() => chrome.scripting.getRegisteredContentScripts())).toEqual([]);
    expect(errors).toEqual([]);
  } finally {
    await h.close();
  }
});

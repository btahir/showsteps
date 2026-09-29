// Manifest facts from notes/permissions.md (checks P1–P6): exact permissions, optional <all_urls>,
// no static content scripts, no web-accessible resources, and the e2e build differs only by
// host_permissions. Needs both builds: pnpm build && pnpm build:e2e.
import { expect, test } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const out = join(dirname(fileURLToPath(import.meta.url)), "../.output");
const read = (dir: string) => JSON.parse(readFileSync(join(out, dir, "manifest.json"), "utf8"));

test("store manifest is minimal and the e2e manifest differs only by host access", () => {
  test.skip(!existsSync(join(out, "chrome-mv3-production/manifest.json")), "run pnpm build first");
  const prod = read("chrome-mv3-production");
  expect([...prod.permissions].sort()).toEqual(["activeTab", "scripting", "sidePanel", "storage", "unlimitedStorage"]);
  expect(prod.optional_host_permissions).toEqual(["<all_urls>"]);
  for (const k of ["host_permissions", "content_scripts", "web_accessible_resources", "externally_connectable", "content_security_policy"]) {
    expect(prod[k], k).toBeUndefined();
  }
  expect(prod.action.default_popup).toBeUndefined();
  expect(prod.side_panel.default_path).toBe("sidepanel.html");
  expect(Object.keys(prod.commands).sort()).toEqual(["stop-recording", "toggle-pause"]);
  expect(prod.minimum_chrome_version).toBe("120");
  expect(prod.icons).toMatchObject({ 16: expect.any(String), 128: expect.any(String) });

  test.skip(!existsSync(join(out, "chrome-mv3-e2e/manifest.json")), "run pnpm build:e2e first");
  const e2e = read("chrome-mv3-e2e");
  expect(e2e.host_permissions).toEqual(["<all_urls>"]);
  const strip = (m: Record<string, unknown>) => {
    const { host_permissions: _h, optional_host_permissions: _o, ...rest } = m;
    return rest;
  };
  expect(strip(e2e)).toEqual(strip(prod));
});

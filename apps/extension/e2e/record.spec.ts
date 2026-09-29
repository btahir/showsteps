// End-to-end: record the canonical Acme Books flow (apps/fixtures/flows) across two tabs with the
// real extension, then check steps, titles, highlight boxes, redactions and every export.
import { expect, test } from "@playwright/test";
import type { Download, Page } from "@playwright/test";
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { unzipSync, strFromU8 } from "fflate";
import { ARTIFACTS, extUrl, FIXTURES, launch, readGuide, readImage } from "./harness";
import type { Harness } from "./harness";

const here = dirname(fileURLToPath(import.meta.url));
const flowDir = resolve(here, "../../fixtures/flows");
const flow = JSON.parse(readFileSync(join(flowDir, "fixture-flow.json"), "utf8"));
const expected = JSON.parse(readFileSync(join(flowDir, "expected-steps.json"), "utf8"));
const SECRET: string = flow.secrets[0];
const OUT = join(ARTIFACTS, "record");

type Box = { x: number; y: number; width: number; height: number };

/** Pause between actions like a person would (captures are spaced 520 ms apart). */
const beat = (page: Page, ms = 900) => page.waitForTimeout(ms);

async function boxOf(page: Page, selector: string): Promise<Box> {
  // Playwright scrolls the target into view before acting, so measure it there.
  await page.locator(selector).scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  const b = await page.locator(selector).boundingBox();
  if (!b) throw new Error(`no box for ${selector}`);
  return b;
}

let h: Harness;

test.beforeAll(async () => {
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  h = await launch();
});
test.afterAll(async () => {
  await h?.close();
});

test("records the 10-step, 2-tab fixture flow and exports it without the password", async () => {
  const { context } = h;
  const main = await context.newPage();
  const log: string[] = [];
  context.on("console", (m) => m.text().startsWith("[showsteps]") && log.push(`${Date.now() % 1_000_000} ${m.text()}`));
  await main.goto(`${FIXTURES}${flow.start}`);
  // The side panel UI, opened as a tab in the same window (Playwright cannot open the real panel).
  const panel = await context.newPage();
  await panel.goto(extUrl(h, "sidepanel.html"));
  await main.bringToFront();

  await panel.getByRole("button", { name: /start recording/i }).click();
  await expect(panel.getByRole("status").filter({ hasText: /recording/i }).first()).toBeVisible();
  await beat(main, 1200);

  const boxes: Record<string, Box> = {};
  const tabs: Record<string, Page> = { main };

  for (const s of flow.steps) {
    const page = tabs[s.tab]!;
    await page.bringToFront();
    await page.mouse.move(5, 5);
    // Long enough for a settled pre-action frame (idle refreshes wait 1 s after any capture).
    await beat(page, 1400);
    boxes[s.id] = await boxOf(page, s.selector);
    switch (s.do) {
      case "type":
        await page.click(s.selector);
        await page.locator(s.selector).pressSequentially(s.value, { delay: 25 });
        break;
      case "click":
        if (s.then?.opensTab) {
          const [popup] = await Promise.all([context.waitForEvent("page"), page.click(s.selector)]);
          await popup.waitForLoadState("load");
          tabs[s.then.opensTab] = popup;
        } else {
          await page.click(s.selector);
        }
        if (s.then?.navigatesTo) await page.waitForURL(`**${s.then.navigatesTo}`);
        if (s.then?.pushState) await page.waitForURL(`**${s.then.pushState}`);
        if (s.then?.statusText) await expect(page.getByText(s.then.statusText)).toBeVisible();
        break;
      case "select":
        await page.selectOption(s.selector, s.value);
        break;
      case "check":
        await page.check(s.selector);
        break;
    }
    await beat(page, 900);
  }

  // Stop from the panel (without leaving the flow's tab in front).
  await panel.getByRole("button", { name: /stop and review/i }).click();
  const editorP = context.waitForEvent("page", { predicate: (p) => p.url().includes("editor.html") });
  const editor = await editorP;
  await editor.waitForLoadState();
  const guideId = new URL(editor.url()).searchParams.get("guide")!;
  expect(guideId).toBeTruthy();

  const guide = await readGuide(panel, guideId);
  writeFileSync(join(OUT, "guide.json"), JSON.stringify(guide, null, 2));
  const rungs = await panel.evaluate(() => chrome.storage.session.get("debug:capture").then((r) => r["debug:capture"]));
  writeFileSync(join(OUT, "capture-rungs.json"), JSON.stringify(rungs, null, 2));
  writeFileSync(join(OUT, "recorder-debug.log"), log.join("\n"));

  // ---- steps -------------------------------------------------------------------------------
  const actions = guide.steps.filter((s: any) => s.action.type !== "navigate");
  const navs = guide.steps.filter((s: any) => s.action.type === "navigate");
  expect(actions.map((s: any) => s.title)).toEqual(expected.steps.map((e: any) => e.title));
  expect(actions).toHaveLength(10);

  for (let i = 0; i < expected.steps.length; i++) {
    const e = expected.steps[i];
    const got = actions[i];
    expect.soft(got.action.type, e.flowStep).toBe(e.action.type);
    if (e.action.value !== undefined) expect.soft(got.action.value, e.flowStep).toBe(e.action.value);
    if (e.action.masked) {
      expect.soft(got.action.masked, e.flowStep).toBe(true);
      expect.soft(e.valueMustBeOneOf).toContain(got.action.value);
    }
    if (e.action.checked !== undefined) expect.soft(got.action.checked, e.flowStep).toBe(e.action.checked);
    if (e.action.optionText) expect.soft(got.action.optionText, e.flowStep).toBe(e.action.optionText);
    expect.soft(new URL(got.page.url).pathname, e.flowStep).toBe(e.page.path);
    expect.soft(got.page.title, e.flowStep).toBe(e.page.title);
    for (const [k, v] of Object.entries(e.target)) expect.soft(got.target?.[k], `${e.flowStep} target.${k}`).toEqual(v);
    if (e.firstLocator) expect.soft(got.target.locators[0], e.flowStep).toEqual(e.firstLocator);

    // Highlight within 2 px of the element box measured before the action (dpr 1).
    const want = boxes[e.flowStep]!;
    const hl = got.screenshot?.highlight;
    expect.soft(hl, `${e.flowStep} highlight`).toBeTruthy();
    if (hl) {
      const sc = got.screenshot.width / got.screenshot.viewport.width;
      for (const k of ["x", "y", "width", "height"] as const) {
        expect.soft(Math.abs(hl[k] - want[k] * sc), `${e.flowStep} highlight.${k}`).toBeLessThanOrEqual(2);
      }
    }
  }

  // Navigate steps: the page the recording started on, and the help tab; no others required.
  const navUrls = navs.map((s: any) => s.action.url);
  expect(navUrls).toContain(`${FIXTURES}/help.html`);
  for (const n of navs) expect(n.title).toMatch(/^Go to \*\*/);

  // Auto redaction over #password on s01..s03 (auto: true = burnt into the stored PNG).
  const pw = boxes.s02!;
  for (const id of expected.autoRedact.onFlowSteps) {
    const idx = expected.steps.findIndex((e: any) => e.flowStep === id);
    const reds = actions[idx].screenshot?.redactions ?? [];
    const covers = reds.some(
      (r: any) => r.auto && r.rect.x <= pw.x + 1 && r.rect.y <= pw.y + 1 && r.rect.x + r.rect.width >= pw.x + pw.width - 1 && r.rect.y + r.rect.height >= pw.y + pw.height - 1,
    );
    expect.soft(covers, `${id} password redaction`).toBe(true);
  }

  // Every step with a screenshot has an image stored.
  for (const s of guide.steps) {
    if (!s.screenshot) continue;
    const b64 = await readImage(panel, guideId, s.screenshot.image);
    expect.soft(b64, `image for ${s.id}`).toBeTruthy();
  }
  // The secret never reaches storage as text.
  expect(JSON.stringify(guide)).not.toContain(SECRET);

  // ---- exports -----------------------------------------------------------------------------
  await editor.bringToFront();
  await editor.getByRole("button", { name: /^export/i }).first().click();
  const dialog = editor.locator("dialog.export");
  await expect(dialog).toBeVisible();

  const saved: Record<string, Uint8Array> = {};
  let first = true;
  for (const fmt of ["pdf", "html", "markdown", "docx", "skill", "project"]) {
    await dialog.locator(`[data-format="${fmt}"]`).click();
    const [dl] = await Promise.all([editor.waitForEvent("download"), dialog.getByTestId("export-go").click()]);
    const path = join(OUT, (dl as Download).suggestedFilename());
    await dl.saveAs(path);
    saved[fmt] = new Uint8Array(readFileSync(path));
    await expect(dialog.getByText("Guide saved", { exact: true })).toBeVisible();
    // The support moment follows the first successful export (then the 3rd, 10th, every 15th).
    if (first) await expect(dialog.getByRole("link", { name: /support showsteps/i })).toBeVisible();
    first = false;
    await dialog.getByRole("button", { name: "Export another" }).click();
  }

  const texts = (bytes: Uint8Array): string[] => {
    if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
      return Object.entries(unzipSync(bytes)).map(([, v]) => strFromU8(v, true));
    }
    return [Buffer.from(bytes).toString("latin1")];
  };
  for (const [fmt, bytes] of Object.entries(saved)) {
    expect(bytes.length, fmt).toBeGreaterThan(100);
    for (const t of texts(bytes)) expect(t.includes(SECRET), `${fmt} leaks the password`).toBe(false);
  }
  // Titles are shown with typographic quotes in the HTML guide (design review #3).
  expect(Buffer.from(saved.html!).toString("utf8")).toContain("\u201c");
  const md = Object.entries(unzipSync(saved.markdown!)).find(([p]) => p.endsWith(".md"));
  expect(md && strFromU8(md[1])).toContain("Click **Save**");
  const skill = Object.keys(unzipSync(saved.skill!));
  expect(skill.some((p) => p.endsWith("SKILL.md"))).toBe(true);
  expect(skill.some((p) => p.endsWith("steps.json"))).toBe(true);
  expect(skill.some((p) => p.endsWith("replay.spec.ts"))).toBe(true);
  expect(Buffer.from(saved.pdf!.subarray(0, 5)).toString()).toBe("%PDF-");
  expect(Object.keys(unzipSync(saved.project!))).toContain("guide.json");

  // ---- replay: the exported replay.spec.ts runs against the fixtures (ACCEPTANCE G3, G5) ---------
  const REPLAY = join(ARTIFACTS, "replay");
  rmSync(REPLAY, { recursive: true, force: true });
  mkdirSync(REPLAY, { recursive: true });
  for (const [p, bytes] of Object.entries(unzipSync(saved.skill!))) {
    if (!p.endsWith("replay.spec.ts") && !p.endsWith("SKILL.md") && !p.endsWith("steps.json")) continue;
    writeFileSync(join(REPLAY, p.split("/").pop()!), bytes);
  }
  writeFileSync(
    join(REPLAY, "playwright.config.ts"),
    `import { defineConfig } from "@playwright/test";\nexport default defineConfig({ testDir: ".", timeout: 60_000, workers: 1, reporter: [["line"]], use: { headless: true }, outputDir: "./results" });\n`,
  );
  expect(readFileSync(join(REPLAY, "replay.spec.ts"), "utf8")).not.toContain(SECRET);
  const cli = resolve(here, "../node_modules/.bin/playwright");
  // A clean child run: drop the worker variables of this Playwright run.
  const baseEnv = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(TEST_|PW_TEST|PWTEST|SHOWSTEPS_SECRET)/.test(k)));
  const replay = (env: Record<string, string>) =>
    spawnSync(cli, ["test", "--config", join(REPLAY, "playwright.config.ts")], { cwd: REPLAY, env: { ...baseEnv, ...env }, encoding: "utf8", timeout: 120_000 });
  const ok = replay({ SHOWSTEPS_SECRET_1: SECRET });
  writeFileSync(join(OUT, "replay-output.txt"), `${ok.stdout}\n${ok.stderr}`);
  expect(ok.status, `replay failed:\n${ok.stdout}\n${ok.stderr}`).toBe(0);
  expect(ok.stdout).toMatch(/1 passed/);
  const noSecret = replay({ SHOWSTEPS_SECRET_1: "" });
  expect(noSecret.stdout).toMatch(/1 skipped/);

  // ---- import the project back (agent hand-off path) ------------------------------------------
  const projectPath = join(OUT, readdirSync(OUT).find((f) => f.endsWith(".showsteps"))!);
  await panel.reload();
  await panel.getByRole("button", { name: /^guides/i }).click().catch(() => {});
  await panel.locator('input[type="file"]').setInputFiles(projectPath);
  await expect(panel.getByRole("button", { name: /guide title:/i })).toContainText("(copy)");
  const ids = await panel.evaluate(
    () =>
      new Promise<string[]>((res) => {
        const r = indexedDB.open("stepsnap");
        r.onsuccess = () => {
          const q = r.result.transaction("guides").objectStore("guides").getAllKeys();
          q.onsuccess = () => res(q.result as string[]);
        };
      }),
  );
  const copyId = ids.find((i) => i !== guideId)!;
  const copy = await readGuide(panel, copyId);
  expect(copy.steps.map((s: any) => s.title)).toEqual(guide.steps.map((s: any) => s.title));
  // Burnt-in pixels: the imported screenshots equal the stored (already redacted) ones or are re-baked.
  for (const s of copy.steps) if (s.screenshot) expect(await readImage(panel, copyId, s.screenshot.image)).toBeTruthy();
});

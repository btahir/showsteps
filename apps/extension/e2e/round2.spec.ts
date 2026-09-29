// Round-2 features against the real extension: text-pattern redaction burnt into stored pixels,
// the in-page recording bar (never in a screenshot, drivable, accessible), typing amends, auto-blur
// Undo from in-memory originals, highlight handles, starting on a blocked page, and DPR 2 mapping.
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { ARTIFACTS, ctl, extUrl, FIXTURES, launch, readGuide, regionStats } from "./harness";
import type { Harness } from "./harness";

const SHOTS = join(ARTIFACTS, "screens");
type Box = { x: number; y: number; width: number; height: number };

test.describe.configure({ mode: "serial" });

let h: Harness;
test.beforeAll(async () => {
  mkdirSync(SHOTS, { recursive: true });
  h = await launch();
  if (process.env.SHOW_CONSOLE) {
    h.worker.on("console", (m) => console.log("SW", m.type(), m.text()));
    h.context.on("console", (m) => m.type() !== "debug" && console.log("PAGE", m.type(), m.text()));
  }
});
test.afterAll(async () => {
  await h?.close();
});

/** A settled pre-action frame needs a quiet second after the pointer arrives. */
async function settle(page: Page, ms = 1400) {
  await page.mouse.move(5, 5);
  await page.waitForTimeout(ms);
}

async function panelPage(): Promise<Page> {
  const p = await h.context.newPage();
  await p.goto(extUrl(h, "sidepanel.html"));
  return p;
}

async function startOn(panel: Page, page: Page) {
  await page.bringToFront();
  const r = await ctl(panel, { type: "ctl:start" });
  expect(r.ok, r.error).toBe(true);
  await page.waitForTimeout(1500);
  return r;
}

async function stop(panel: Page) {
  const r = await ctl(panel, { type: "ctl:stop", openEditor: false });
  expect(r.ok).toBe(true);
  return r.state.guideId ?? (await panel.evaluate(() => chrome.storage.session.get("lastGuideId").then((x) => x.lastGuideId as string)));
}

/** Text rects of an element's contents (CSS px, viewport). */
async function textBoxes(page: Page, sel: string): Promise<Box[]> {
  return page.evaluate((s) => {
    const el = document.querySelector(s)!;
    if (el instanceof HTMLInputElement) {
      const r = el.getBoundingClientRect();
      return [{ x: r.x, y: r.y, width: r.width, height: r.height }];
    }
    const range = document.createRange();
    range.selectNodeContents(el);
    return Array.from(range.getClientRects()).map((r) => ({ x: r.x, y: r.y, width: r.width, height: r.height }));
  }, sel);
}

const scaleBox = (b: Box, k: number): Box => ({ x: b.x * k, y: b.y * k, width: b.width * k, height: b.height * k });
const covers = (outer: Box, inner: Box, tol = 4) =>
  outer.x <= inner.x + tol && outer.y <= inner.y + tol && outer.x + outer.width >= inner.x + inner.width - tol && outer.y + outer.height >= inner.y + inner.height - tol;
const intersects = (a: Box, b: Box) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

test("R-TEXT secrets shown as text are blurred into the stored screenshot; emails only with the preset", async () => {
  const page = await h.context.newPage();
  await page.goto(`${FIXTURES}/patterns.html`);
  const panel = await panelPage();
  await startOn(panel, page);
  await page.waitForTimeout(700); // the token row arrives 600 ms after load
  await settle(page);
  const ref = (await page.screenshot()).toString("base64");
  await page.click("#refresh");
  await page.waitForTimeout(1200);

  // Email preset on, then one more click.
  await panel.evaluate(() => chrome.storage.local.set({ "settings:redact": { emails: true } }));
  await settle(page);
  await page.click("#refresh");
  await page.waitForTimeout(1200);
  await panel.evaluate(() => chrome.storage.local.set({ "settings:redact": { emails: false } }));

  const secrets: Record<string, Box[]> = {};
  for (const id of ["#card", "#ssn", "#iban", "#jwt", "#token", "#notes"]) secrets[id] = await textBoxes(page, id);
  const neutral: Record<string, Box[]> = {};
  for (const id of ["#order", "#epoch", "#date", "#uuid", "#phone"]) neutral[id] = await textBoxes(page, id);
  const email = await textBoxes(page, "#email");

  const guideId = await stop(panel);
  const guide = await readGuide(panel, guideId);
  const clicks = guide.steps.filter((s: any) => s.action.type === "click");
  expect(clicks).toHaveLength(2);
  const [first, second] = clicks;
  const k = first.screenshot.width / first.screenshot.viewport.width;
  const reds = (s: any): Box[] => (s.screenshot.redactions ?? []).filter((r: any) => r.auto).map((r: any) => r.rect);

  for (const [id, boxes] of Object.entries(secrets)) {
    for (const b of boxes) {
      const want = scaleBox(b, k);
      expect.soft(reds(first).some((r) => covers(r, want)), `${id} covered by an auto redaction`).toBe(true);
      // Burnt in: the stored pixels there lost their texture (glyphs) compared with a plain capture.
      const [stored] = await regionStats(panel, { guideId, path: first.screenshot.image }, [want]);
      const [plain] = await regionStats(panel, { png: ref }, [want]);
      expect.soft(stored!.texture, `${id} texture in the stored image vs plain ${plain!.texture.toFixed(1)}`).toBeLessThanOrEqual(plain!.texture * 0.2 + 0.5);
    }
  }
  for (const [id, boxes] of Object.entries(neutral)) {
    for (const b of boxes) expect.soft(reds(first).some((r) => intersects(r, scaleBox(b, k))), `${id} must not be blurred`).toBe(false);
  }
  for (const b of email) {
    expect.soft(reds(first).some((r) => intersects(r, scaleBox(b, k))), "email not blurred by default").toBe(false);
    expect.soft(reds(second).some((r) => covers(r, scaleBox(b, k))), "email blurred with the preset on").toBe(true);
  }
  // The chip names what was found.
  const meta = await panel.evaluate(
    ({ id, p }) =>
      new Promise<any>((res) => {
        const r = indexedDB.open("showsteps");
        r.onsuccess = () => {
          const q = r.result.transaction("images").objectStore("images").get(`${id}/${p}`);
          q.onsuccess = () => res({ kinds: q.result.kinds, review: q.result.review });
        };
      }),
    { id: guideId, p: first.screenshot.image },
  );
  expect(meta.kinds).toEqual(expect.arrayContaining(["card", "ssn", "iban", "token"]));
  expect(JSON.stringify(guide)).not.toContain("4242 4242");
  await page.close();
  await panel.close();
});

test("BAR the recording bar is visible, drivable and accessible, and never in a stored screenshot", async () => {
  const page = await h.context.newPage();
  await page.goto(`${FIXTURES}/index.html`);
  const panel = await panelPage();
  await startOn(panel, page);

  const bar = page.getByRole("toolbar", { name: "Showsteps recording" });
  await expect(bar).toBeVisible();
  await expect(bar.getByRole("button", { name: "Pause recording" })).toBeVisible();
  await expect(bar.getByRole("button", { name: "Discard this recording" })).toBeVisible();
  await expect(bar.getByRole("button", { name: "Stop and review" })).toBeVisible();
  await expect(bar.getByRole("status")).toHaveAttribute("aria-label", /Recording, \d+ steps?/);
  const barBox = (await page.locator("showsteps-recording-bar").evaluate((host) => {
    const r = (host.shadowRoot!.querySelector(".bar") as HTMLElement).getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  })) as Box;
  // Positive control: a plain page screenshot does show the ink pill there.
  const withBar = (await page.screenshot()).toString("base64");
  const [control] = await regionStats(panel, { png: withBar }, [barBox]);
  expect(control!.ink).toBeGreaterThan(0.4);
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.screenshot({ path: join(SHOTS, `bar-${scheme}.png`), clip: { x: barBox.x - 40, y: barBox.y - 40, width: barBox.width + 80, height: barBox.height + 80 } });
  }
  await page.emulateMedia({ colorScheme: "light" });

  // A few steps: settled frames, live captures and a typing step.
  await settle(page);
  await page.click("#email");
  await page.locator("#email").pressSequentially("jane@example.com", { delay: 30 });
  await page.waitForTimeout(400);
  await settle(page);
  await page.click("#remember");
  await page.waitForTimeout(300);
  await page.click("#password"); // live capture right after the previous one
  await page.locator("#password").pressSequentially("Correct-Horse-9", { delay: 30 });
  await settle(page, 900);

  // Pause and resume from the bar: no steps come from clicking our own bar.
  await bar.getByRole("button", { name: "Pause recording" }).click();
  await expect(bar.getByRole("button", { name: "Resume recording" })).toBeVisible();
  const paused = (await ctl(panel, { type: "ctl:state" })).state;
  expect(paused.status).toBe("paused");
  await bar.getByRole("button", { name: "Resume recording" }).click();
  await expect(bar.getByRole("button", { name: "Pause recording" })).toBeVisible();
  await page.waitForTimeout(600);
  expect((await ctl(panel, { type: "ctl:state" })).state.stepCount, "clicks on the bar are not steps").toBe(paused.stepCount);
  // Keyboard: Tab reaches the bar's buttons and the grip moves it.
  await bar.getByRole("button", { name: /move the recording bar/i }).focus();
  await page.keyboard.press("ArrowUp");
  // Discard asks first; "Keep recording" goes back.
  await bar.getByRole("button", { name: "Discard this recording" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Discard this recording?" })).toBeVisible();
  await bar.getByRole("button", { name: "Keep recording" }).click();
  await expect(bar.getByRole("button", { name: "Stop and review" })).toBeVisible();

  // Stop from the bar opens the editor.
  const editorP = h.context.waitForEvent("page", { predicate: (p) => p.url().includes("editor.html") });
  await bar.getByRole("button", { name: "Stop and review" }).click();
  const editor = await editorP;
  await expect(bar).toBeHidden();
  const guideId = new URL(editor.url()).searchParams.get("guide")!;
  const guide = await readGuide(panel, guideId);
  const shots = guide.steps.filter((s: any) => s.screenshot);
  expect(shots.length).toBeGreaterThanOrEqual(4);
  for (const s of shots) {
    const k = s.screenshot.width / s.screenshot.viewport.width;
    const [st] = await regionStats(panel, { guideId, path: s.screenshot.image }, [scaleBox(barBox, k)]);
    expect.soft(st!.ink, `bar ink in stored screenshot of "${s.title}"`).toBeLessThan(0.02);
    expect.soft(st!.dot, `recording dot in stored screenshot of "${s.title}"`).toBe(0);
  }
  await editor.close();
  await page.close();
  await panel.close();
});

test("E2b typing, pausing and typing again in the same field is one step (amend)", async () => {
  const page = await h.context.newPage();
  await page.goto(`${FIXTURES}/index.html`);
  const panel = await panelPage();
  await startOn(panel, page);
  await settle(page);
  await page.click("#email");
  await page.locator("#email").pressSequentially("ab", { delay: 40 });
  await page.waitForTimeout(2000); // past the 1.5 s idle commit
  await page.locator("#email").pressSequentially("cd", { delay: 40 });
  await page.waitForTimeout(2000);
  // Another field in between: the next typing in #email is a new step.
  await page.click("#password");
  await page.locator("#password").pressSequentially("x", { delay: 40 });
  await page.waitForTimeout(1800);
  await page.click("#email");
  await page.locator("#email").pressSequentially("e", { delay: 40 });
  await page.waitForTimeout(1800);
  const guideId = await stop(panel);
  const guide = await readGuide(panel, guideId);
  const types = guide.steps.filter((s: any) => s.action.type === "type");
  expect(types.map((s: any) => s.action.value)).toEqual(["abcd", "", "abcde"]);
  await page.close();
  await panel.close();
});

test("UNDO auto-blur: Undo shows the original, Ctrl+Z blurs again, and a reopened editor cannot undo", async () => {
  const page = await h.context.newPage();
  await page.goto(`${FIXTURES}/index.html`);
  const panel = await panelPage();
  await startOn(panel, page);
  await settle(page);
  await page.click("#password");
  await page.locator("#password").pressSequentially("Correct-Horse-9", { delay: 30 });
  await settle(page);
  await page.click("#remember");
  await page.waitForTimeout(1200);
  // Stop opens the editor, which claims the originals; then the panel closes, so only the editor holds them.
  const editorP = h.context.waitForEvent("page", { predicate: (p) => p.url().includes("editor.html") });
  expect((await ctl(panel, { type: "ctl:stop" })).ok).toBe(true);
  const editor = await editorP;
  await editor.waitForLoadState();
  const guideId = new URL(editor.url()).searchParams.get("guide")!;
  await panel.close();
  const g0 = await readGuide(editor, guideId);
  const idx = g0.steps.findIndex((s: any) => s.action.type === "type" && s.action.masked);
  const step = g0.steps[idx];
  expect(step.screenshot.redactions.some((r: any) => r.auto)).toBe(true);
  const rect = step.screenshot.redactions.find((r: any) => r.auto).rect;
  const [burnt] = await regionStats(editor, { guideId, path: step.screenshot.image }, [rect]);

  await editor.getByRole("button", { name: new RegExp(`^Step ${idx + 1}:`) }).first().click();
  const chip = editor.getByTestId("redaction-chip");
  await expect(chip).toContainText("Password blurred");
  for (const scheme of ["light", "dark"] as const) {
    await editor.emulateMedia({ colorScheme: scheme });
    await editor.waitForTimeout(200);
    await editor.screenshot({ path: join(SHOTS, `editor-chip-undo-${scheme}.png`) });
  }
  await editor.emulateMedia({ colorScheme: "light" });
  await chip.getByRole("button", { name: /undo/i }).click();
  await expect.poll(async () => (await readGuide(editor, guideId)).steps[idx].screenshot.redactions?.some((r: any) => r.auto) ?? false).toBe(false);
  await expect
    .poll(async () => (await regionStats(editor, { guideId, path: step.screenshot.image }, [rect]))[0]!.texture, { message: "original pixels are back" })
    .toBeGreaterThan(burnt!.texture + 1);

  // Ctrl+Z restores the blur, burnt into the stored pixels again.
  await editor.locator("body").click({ position: { x: 5, y: 5 } });
  await editor.keyboard.press("Control+z");
  await expect.poll(async () => (await readGuide(editor, guideId)).steps[idx].screenshot.redactions?.some((r: any) => r.auto) ?? false).toBe(true);
  await expect.poll(async () => (await regionStats(editor, { guideId, path: step.screenshot.image }, [rect]))[0]!.texture).toBeLessThanOrEqual(burnt!.texture + 1);

  // Closing the editor drops the original (after a 2 s hand-over grace): a new editor says why there is no Undo.
  await editor.close();
  await page.waitForTimeout(2600);
  const again = await h.context.newPage();
  await again.goto(extUrl(h, `editor.html?guide=${guideId}`));
  await again.getByRole("button", { name: new RegExp(`^Step ${idx + 1}:`) }).first().click();
  await expect(again.getByTestId("redaction-chip")).toContainText("Blurred at capture for safety");
  await expect(again.getByTestId("redaction-chip").getByRole("button", { name: /undo/i })).toHaveCount(0);
  for (const scheme of ["light", "dark"] as const) {
    await again.emulateMedia({ colorScheme: scheme });
    await again.waitForTimeout(200);
    await again.screenshot({ path: join(SHOTS, `editor-chip-safety-${scheme}.png`) });
  }

  // Highlight handles: drag the bottom-right corner, then nudge with the keyboard.
  const clickIdx = g0.steps.findIndex((s: any) => s.action.type === "check" && s.screenshot?.highlight);
  await again.emulateMedia({ colorScheme: "light" });
  await again.getByRole("button", { name: new RegExp(`^Step ${clickIdx + 1}:`) }).first().click();
  await again.getByRole("toolbar", { name: /tools/ }).getByRole("button", { name: "Highlight" }).click();
  const hl0 = (await readGuide(again, guideId)).steps[clickIdx].screenshot.highlight;
  const se = again.getByRole("button", { name: /bottom right corner/ });
  const b = (await se.boundingBox())!;
  await again.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await again.mouse.down();
  await again.mouse.move(b.x + 40, b.y + 25, { steps: 5 });
  await again.mouse.up();
  await expect.poll(async () => (await readGuide(again, guideId)).steps[clickIdx].screenshot.highlight.width).toBeGreaterThan(hl0.width + 10);
  const mover = again.getByRole("button", { name: /move the highlight/i });
  await mover.focus();
  const before = (await readGuide(again, guideId)).steps[clickIdx].screenshot.highlight;
  await again.keyboard.press("ArrowRight");
  await again.keyboard.press("ArrowRight");
  await again.keyboard.press("Shift+ArrowDown");
  await expect.poll(async () => (await readGuide(again, guideId)).steps[clickIdx].screenshot.highlight.x).toBeGreaterThan(before.x);
  const after = (await readGuide(again, guideId)).steps[clickIdx].screenshot.highlight;
  expect(after.y).toBeGreaterThan(before.y);
  expect(after.width).toBe(before.width);
  for (const scheme of ["light", "dark"] as const) {
    await again.emulateMedia({ colorScheme: scheme });
    await again.waitForTimeout(200);
    await again.screenshot({ path: join(SHOTS, `editor-highlight-handles-${scheme}.png`) });
  }
  await again.close();
  await page.close();
});

test("E11 starting on a page Chrome blocks explains why and saves no empty guide", async () => {
  const page = await h.context.newPage();
  await page.goto("chrome://version");
  const panel = await panelPage();
  const guidesBefore = await panel.evaluate(() => new Promise<number>((res) => {
    const r = indexedDB.open("showsteps");
    r.onsuccess = () => {
      const q = r.result.transaction("guides").objectStore("guides").count();
      q.onsuccess = () => res(q.result);
    };
  }));
  // Library view (not the last guide), whose footer has "Start recording".
  await panel.evaluate(() => chrome.storage.session.remove("lastGuideId"));
  await panel.reload();
  await page.bringToFront();
  await panel.getByRole("button", { name: /start recording/i }).first().click();
  await expect(panel.getByText("Chrome doesn't let extensions record this page. Switch to a normal tab to keep going.")).toBeVisible();
  await panel.setViewportSize({ width: 400, height: 700 });
  for (const scheme of ["light", "dark"] as const) {
    await panel.emulateMedia({ colorScheme: scheme });
    await panel.waitForTimeout(200);
    await panel.screenshot({ path: join(SHOTS, `panel-blocked-${scheme}.png`) });
  }
  const r = await ctl(panel, { type: "ctl:stop", openEditor: false });
  expect(r.ok).toBe(true);
  const guidesAfter = await panel.evaluate(() => new Promise<number>((res) => {
    const r = indexedDB.open("showsteps");
    r.onsuccess = () => {
      const q = r.result.transaction("guides").objectStore("guides").count();
      q.onsuccess = () => res(q.result);
    };
  }));
  expect(guidesAfter).toBe(guidesBefore);
  await page.close();
  await panel.close();
});

test("E1b DPR 2: image is 2x the viewport and highlights land within 2 px", async () => {
  const h2 = await launch({ deviceScaleFactor: 2 });
  try {
    const page = await h2.context.newPage();
    await page.goto(`${FIXTURES}/index.html`);
    const panel = await h2.context.newPage();
    await panel.goto(extUrl(h2, "sidepanel.html"));
    await page.bringToFront();
    expect((await ctl(panel, { type: "ctl:start" })).ok).toBe(true);
    await page.waitForTimeout(1500);
    const boxes: Box[] = [];
    for (const sel of ["#remember", "#forgot"]) {
      await settle(page);
      boxes.push((await page.locator(sel).boundingBox())!);
      await page.click(sel);
      await page.waitForTimeout(900);
    }
    await page.waitForTimeout(800);
    const r = await ctl(panel, { type: "ctl:stop", openEditor: false });
    const guideId = r.state.guideId ?? (await panel.evaluate(() => chrome.storage.session.get("lastGuideId").then((x) => x.lastGuideId as string)));
    const guide = await readGuide(panel, guideId);
    const acts = guide.steps.filter((s: any) => s.action.type !== "navigate");
    const vw = await page.evaluate(() => innerWidth);
    expect(acts.length).toBe(2);
    for (let i = 0; i < 2; i++) {
      const sh = acts[i].screenshot;
      expect(Math.abs(sh.width - vw * 2)).toBeLessThanOrEqual(1);
      const want = scaleBox(boxes[i]!, sh.width / sh.viewport.width);
      for (const k of ["x", "y", "width", "height"] as const) expect.soft(Math.abs(sh.highlight[k] - want[k]), `${acts[i].title} ${k}`).toBeLessThanOrEqual(2);
    }
  } finally {
    await h2.close();
  }
});

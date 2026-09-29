// ACCEPTANCE §E and §R on the edge fixture pages (apps/fixtures/site/edge/): typing intents,
// capture before the action, tabs and origins, pause, lifecycle, frames, shadow DOM, SPA,
// performance, capture rungs, and redaction in frames, tabs, late text, routes, neutral and heavy
// pages. Real Playwright input only; recording driven by the control messages (ctl:*).
// Every test title starts with its check id, so `-g "E7"` selects one.
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { gzipSync } from "node:zlib";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ctl, EXT_DIR, extUrl, FIXTURES, launch, readGuide } from "./harness";
import type { Harness } from "./harness";

type Box = { x: number; y: number; width: number; height: number };
const EDGE = `${FIXTURES}/edge`;
const LOCAL = "http://localhost:4517/edge";

// One worker, in file order; a failure restarts the browser for the next test (not serial: every check reports).

let h: Harness;
let panel: Page;
const swErrors: string[] = [];
const pageLog: string[] = [];

test.beforeAll(async () => {
  h = await launch();
  h.worker.on("console", (m) => {
    if (m.type() === "error") swErrors.push(m.text());
  });
  h.context.on("console", (m) => {
    if (m.text().startsWith("[showsteps]")) pageLog.push(m.text());
  });
  panel = await h.context.newPage();
  await panel.goto(extUrl(h, "sidepanel.html"));
});
test.afterAll(async () => {
  await h?.close();
});

// ---- helpers ------------------------------------------------------------------------------------

async function open(url: string): Promise<Page> {
  const page = await h.context.newPage();
  await page.goto(url);
  return page;
}

async function start(page: Page): Promise<void> {
  await page.bringToFront();
  const r = await ctl(panel, { type: "ctl:start" });
  expect(r.ok, r.error).toBe(true);
  await page.waitForTimeout(1300);
}

async function stop(): Promise<{ guide: any; debug: any[]; guideId: string }> {
  const r = await ctl(panel, { type: "ctl:stop", openEditor: false });
  expect(r.ok, r.error).toBe(true);
  const guideId: string = await panel.evaluate(() => chrome.storage.session.get("lastGuideId").then((x) => x.lastGuideId as string));
  const guide = await readGuide(panel, guideId);
  const debug = (await panel.evaluate(() => chrome.storage.session.get("debug:capture").then((x) => x["debug:capture"] ?? []))) as any[];
  return { guide, debug, guideId };
}

/** Steps of the recording that are not navigate steps. */
const acts = (g: any) => (g?.steps ?? []).filter((s: any) => s.action.type !== "navigate");
/** Debug entries of this recording only (the key accumulates across recordings of one worker). */
const debugOf = (debug: any[], guide: any) => {
  const ids = new Set((guide?.steps ?? []).map((s: any) => s.id));
  return debug.filter((d) => ids.has(d.stepId));
};

/** A settled pre-action frame needs the pointer to arrive and a quiet second. */
async function settle(page: Page, ms = 1300) {
  await page.mouse.move(3, 3);
  await page.waitForTimeout(ms);
}

async function closeAll(...pages: Page[]) {
  for (const p of pages) await p.close().catch(() => {});
}

/** Box of `sel` in top-level viewport CSS px (through frames when `frames` are given). */
async function boxOf(page: Page, sel: string, frames: string[] = []): Promise<Box> {
  let loc: any = page;
  for (const f of frames) loc = loc.frameLocator(f);
  const b = await loc.locator(sel).boundingBox();
  if (!b) throw new Error(`no box for ${sel}`);
  return b;
}

const scale = (b: Box, k: number): Box => ({ x: b.x * k, y: b.y * k, width: b.width * k, height: b.height * k });
const edgeErr = (a: Box, b: Box) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y), Math.abs(a.x + a.width - b.x - b.width), Math.abs(a.y + a.height - b.y - b.height));
const covers = (outer: Box, inner: Box, tol = 4) =>
  outer.x <= inner.x + tol && outer.y <= inner.y + tol && outer.x + outer.width >= inner.x + inner.width - tol && outer.y + outer.height >= inner.y + inner.height - tol;
const autoRects = (s: any): Box[] => (s.screenshot?.redactions ?? []).filter((r: any) => r.auto).map((r: any) => r.rect);
const kOf = (s: any) => s.screenshot.width / s.screenshot.viewport.width;

/** RGB of one pixel of a stored screenshot. */
async function pixel(guideId: string, path: string, x: number, y: number): Promise<[number, number, number]> {
  return panel.evaluate(
    async ({ id, p, x, y }) => {
      const blob = await new Promise<Blob>((res, rej) => {
        const r = indexedDB.open("showsteps");
        r.onerror = () => rej(r.error);
        r.onsuccess = () => {
          const q = r.result.transaction("images").objectStore("images").get(`${id}/${p}`);
          q.onsuccess = () => (q.result ? res(q.result.blob) : rej(new Error("no image")));
        };
      });
      const bmp = await createImageBitmap(blob);
      const c = new OffscreenCanvas(bmp.width, bmp.height);
      const ctx = c.getContext("2d")!;
      ctx.drawImage(bmp, 0, 0);
      const d = ctx.getImageData(x, y, 1, 1).data;
      return [d[0]!, d[1]!, d[2]!] as [number, number, number];
    },
    { id: guideId, p: path, x, y },
  );
}

function hue([r, g, b]: [number, number, number]): number {
  const R = r / 255, G = g / 255, B = b / 255;
  const max = Math.max(R, G, B), min = Math.min(R, G, B);
  const d = max - min;
  if (d === 0) return 0;
  let hh = max === R ? ((G - B) / d) % 6 : max === G ? (B - R) / d + 2 : (R - G) / d + 4;
  hh *= 60;
  return hh < 0 ? hh + 360 : hh;
}
const hueDiff = (a: number, b: number) => Math.min(Math.abs(a - b), 360 - Math.abs(a - b));

// ---- E2 typing: one step per intent ---------------------------------------------------------

test("E2a 12 characters typed 50 ms apart are one type step with the exact value", async () => {
  const page = await open(`${EDGE}/editors.html`);
  await start(page);
  await page.click("#other");
  await page.locator("#other").pressSequentially("hello world!", { delay: 50 });
  const { guide } = await stop();
  const types = acts(guide).filter((s: any) => s.action.type === "type");
  expect(types.map((s: any) => s.action.value)).toEqual(["hello world!"]);
  await closeAll(page);
});

test("E2b ab, 2 s pause, cd is one step with abcd", async () => {
  const page = await open(`${EDGE}/editors.html`);
  await start(page);
  await page.click("#other");
  await page.keyboard.type("ab", { delay: 40 });
  await page.waitForTimeout(2000);
  await page.keyboard.type("cd", { delay: 40 });
  const { guide } = await stop();
  expect(acts(guide).filter((s: any) => s.action.type === "type").map((s: any) => s.action.value)).toEqual(["abcd"]);
  await closeAll(page);
});

test("E2c typing in A, clicking B and typing there are two steps, A first", async () => {
  const page = await open(`${EDGE}/editors.html`);
  await start(page);
  await page.click("#other");
  await page.keyboard.type("first", { delay: 30 });
  await page.click("#ta");
  await page.keyboard.type("second", { delay: 30 });
  const { guide } = await stop();
  const types = acts(guide).filter((s: any) => s.action.type === "type");
  expect(types.map((s: any) => s.action.value)).toEqual(["first", "second"]);
  expect(acts(guide).filter((s: any) => s.action.type === "click")).toHaveLength(0);
  await closeAll(page);
});

test("E2d textarea, contenteditable, ProseMirror- and Lexical-style editors each give exactly one step with the exact text", async () => {
  const page = await open(`${EDGE}/editors.html`);
  await start(page);
  for (const sel of ["#ta", "#ce", "#pm", "#lx"]) {
    await page.click(sel);
    await page.keyboard.type("Quarterly report", { delay: 30 });
    await page.waitForTimeout(200);
  }
  await page.click("#other");
  const { guide } = await stop();
  const types = acts(guide).filter((s: any) => s.action.type === "type");
  expect(types.map((s: any) => s.action.value)).toEqual(["Quarterly report", "Quarterly report", "Quarterly report", "Quarterly report"]);
  await closeAll(page);
});

test("E2e typing then Enter in a text input is a type step and a press Enter step, no implicit-submit click", async () => {
  const page = await open(`${FIXTURES}/index.html`);
  await start(page);
  await page.click("#email");
  await page.keyboard.type("jane@example.com", { delay: 20 });
  await page.keyboard.press("Enter");
  await page.waitForTimeout(600);
  const { guide } = await stop();
  expect(acts(guide).map((s: any) => [s.action.type, s.action.value ?? s.action.key])).toEqual([
    ["type", "jane@example.com"],
    ["press", "Enter"],
  ]);
  await closeAll(page);
});

test("E2f Enter or Space on a focused button is one click step and no press", async () => {
  const page = await open(`${EDGE}/select.html`);
  await start(page);
  await page.focus("#dbl");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(700);
  await page.focus("#ctx");
  await page.keyboard.press("Space");
  await page.waitForTimeout(600);
  const { guide } = await stop();
  const a = acts(guide);
  expect(a.map((s: any) => s.action.type)).toEqual(["click", "click"]);
  await closeAll(page);
});

test("E2g clicking a checkbox's label is one check step with the right state", async () => {
  const page = await open(`${EDGE}/select.html`);
  await start(page);
  await page.click("label[for=news] span");
  await page.waitForTimeout(600);
  await page.click("text=I agree to the terms");
  await page.waitForTimeout(600);
  const { guide } = await stop();
  const a = acts(guide);
  expect(a.map((s: any) => [s.action.type, s.action.checked])).toEqual([
    ["check", true],
    ["check", true],
  ]);
  await closeAll(page);
});

test("E2h a double click is one step with double: true", async () => {
  const page = await open(`${EDGE}/select.html`);
  await start(page);
  await page.dblclick("#dbl");
  await page.waitForTimeout(800);
  const { guide } = await stop();
  const a = acts(guide);
  expect(a).toHaveLength(1);
  expect(a[0].action).toMatchObject({ type: "click", double: true });
  await closeAll(page);
});

test("E2i a mouse drag that selects text is no step", async () => {
  const page = await open(`${EDGE}/select.html`);
  await start(page);
  const b = await boxOf(page, "#drag-text");
  await page.mouse.move(b.x + 4, b.y + b.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + 200, b.y + b.height / 2, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(600);
  const { guide } = await stop();
  expect(acts(guide)).toHaveLength(0);
  await closeAll(page);
});

test("E2j a right click is one step with button right", async () => {
  const page = await open(`${EDGE}/select.html`);
  await start(page);
  await page.click("#ctx", { button: "right" });
  await page.waitForTimeout(600);
  const { guide } = await stop();
  const a = acts(guide);
  expect(a).toHaveLength(1);
  expect(a[0].action).toMatchObject({ type: "click", button: "right" });
  await closeAll(page);
});

test("E2k choosing a native select option is one select step with value and optionText", async () => {
  const page = await open(`${EDGE}/select.html`);
  await start(page);
  await page.selectOption("#country", "pt");
  await page.waitForTimeout(600);
  const { guide } = await stop();
  const a = acts(guide);
  expect(a).toHaveLength(1);
  expect(a[0].action).toMatchObject({ type: "select", value: "pt", optionText: "Portugal" });
  await closeAll(page);
});

test("E2l Control+K is one press step; Control+C inside a textarea is none", async () => {
  const page = await open(`${EDGE}/editors.html`);
  await start(page);
  await page.click("h1");
  await page.waitForTimeout(300);
  await page.keyboard.press("Control+K");
  await page.waitForTimeout(400);
  await page.click("#ta");
  await page.keyboard.type("copy me", { delay: 20 });
  await page.keyboard.press("Control+A");
  await page.keyboard.press("Control+C");
  await page.waitForTimeout(400);
  const { guide } = await stop();
  const presses = acts(guide).filter((s: any) => s.action.type === "press");
  expect(presses.map((s: any) => s.action.key)).toEqual(["Control+K"]);
  await closeAll(page);
});

// ---- E3 capture before the action and the 2 per second limit --------------------------------

test("E3a E3e a 20-click burst: 20 steps in order, every one accounted for, captures never over 2 per second", async () => {
  const page = await open(`${EDGE}/burst.html`);
  await start(page);
  await settle(page);
  const b = await boxOf(page, "#burst");
  for (let i = 0; i < 20; i++) {
    await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
    await page.waitForTimeout(100);
  }
  await page.waitForTimeout(1500);
  const { guide, debug } = await stop();
  const a = acts(guide);
  expect(a).toHaveLength(20);
  const d = debugOf(debug, guide).filter((x) => x.title && !/^Go to/.test(x.title));
  expect(d).toHaveLength(20);
  for (const x of d) expect(["settled", "live", "earlier", "late", "none"]).toContain(x.rung);
  expect(d.filter((x) => x.rung === "settled" || x.rung === "live").length).toBeGreaterThanOrEqual(2);
  const calls = (await panel.evaluate(() => chrome.storage.session.get("debug:captures").then((x) => x["debug:captures"] ?? []))) as number[];
  const from = Date.parse(guide.createdAt) - 5000;
  const run = calls.filter((t) => t >= from).sort((x, y) => x - y);
  let maxIn1s = 0;
  for (let i = 0; i < run.length; i++) maxIn1s = Math.max(maxIn1s, run.filter((t) => t >= run[i]! && t < run[i]! + 1000).length);
  expect(maxIn1s).toBeLessThanOrEqual(2);
  const errors = (await panel.evaluate(() => chrome.storage.session.get("debug:capture-errors").then((x) => x["debug:capture-errors"] ?? []))) as string[];
  expect(errors.filter((e) => /quota/i.test(e))).toEqual([]);
  expect(swErrors.filter((e) => /unhandled|quota/i.test(e))).toEqual([]);
  await closeAll(page);
});

test("E3b at human pace (700 ms) every click has a pre-action frame showing the counter before it", async () => {
  const page = await open(`${EDGE}/burst.html`);
  await start(page);
  await settle(page);
  const b = await boxOf(page, "#burst");
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.waitForTimeout(1300);
  for (let i = 0; i < 10; i++) {
    await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
    await page.waitForTimeout(700);
  }
  await page.waitForTimeout(800);
  const { guide, debug, guideId } = await stop();
  const a = acts(guide);
  expect(a).toHaveLength(10);
  const d = debugOf(debug, guide).filter((x) => !/^Go to/.test(x.title));
  expect(d.filter((x) => x.rung === "settled" || x.rung === "live").length, JSON.stringify(d.map((x) => x.rung))).toBe(10);
  for (let k = 1; k <= 10; k++) {
    const s = a[k - 1];
    expect(s.screenshot, `click ${k} has a screenshot`).toBeTruthy();
    const got = hue(await pixel(guideId, s.screenshot.image, 4, 4));
    const want = ((k - 1) * 30) % 360;
    expect.soft(hueDiff(got, want), `click ${k}: hue ${got.toFixed(0)} want ${want}`).toBeLessThanOrEqual(6);
  }
  await closeAll(page);
});

test("E3c a button that removes itself on pointerdown is still in 9 of 10 screenshots", async () => {
  const page = await open(`${EDGE}/pointerdown-remove.html`);
  pageLog.length = 0;
  await start(page);
  let ok = 0;
  const notes: string[] = [];
  for (let t = 0; t < 10; t++) {
    if (t > 0) await page.reload();
    await settle(page);
    const b = await boxOf(page, "#vanish");
    await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
    await page.waitForTimeout(700);
    notes.push(JSON.stringify(b));
  }
  const { guide, guideId, debug } = await stop();
  const a = acts(guide);
  expect(a.length).toBe(10);
  const seen: string[] = [];
  for (const s of a) {
    if (!s.screenshot) continue;
    const k = kOf(s);
    const r = s.screenshot.highlight ?? scale({ x: 24, y: 80, width: 220, height: 80 }, k);
    // Left of the centred label, clear of the rounded corners: button green, or the banner if it was already gone.
    const [R, G, B] = await pixel(guideId, s.screenshot.image, Math.round(r.x + 16 * k), Math.round(r.y + r.height / 2));
    seen.push(`${R},${G},${B} ${debugOf(debug, guide).find((d) => d.stepId === s.id)?.rung}`);
    if (Math.abs(R - 0x0a) <= 12 && Math.abs(G - 0x8f) <= 12 && Math.abs(B - 0x3c) <= 12) ok++;
  }
  expect(ok, `${seen.join(" | ")}\n${pageLog.filter((l) => / pre |dirty|settled/.test(l)).slice(-60).join("\n")}`).toBeGreaterThanOrEqual(9);
  await closeAll(page);
});

test("E3d a link that navigates on click (sync and setTimeout 0): 20 of 20 screenshots show page A (red)", async () => {
  const page = await open(`${EDGE}/banner-a.html`);
  await start(page);
  for (const sel of ["#sync-link", "#timeout-link"]) {
    for (let t = 0; t < 10; t++) {
      if (!page.url().endsWith("banner-a.html")) await page.goto(`${EDGE}/banner-a.html`);
      await settle(page);
      await page.click(sel);
      await page.waitForURL("**/banner-b.html");
      await page.waitForTimeout(300);
    }
  }
  const { guide, guideId } = await stop();
  const clicks = acts(guide).filter((s: any) => s.action.type === "click");
  expect(clicks).toHaveLength(20);
  let red = 0;
  for (const s of clicks) {
    if (!s.screenshot) continue;
    const [R, G, B] = await pixel(guideId, s.screenshot.image, 10, 10);
    if (R > 180 && G < 60 && B < 60) red++;
  }
  expect(red).toBe(20);
  await closeAll(page);
});

// ---- the tab-opening race (verification E-4) ------------------------------------------------

test("E13 E1c a click that opens a new tab keeps its screenshot at zoom 125% even with no settled frame", async () => {
  const page = await open(`${EDGE}/newtab.html`);
  await panel.evaluate(async (u) => {
    const [t] = await chrome.tabs.query({ url: u });
    await chrome.tabs.setZoom(t!.id!, 1.25);
  }, `${EDGE}/newtab.html`);
  await start(page);
  const shots: boolean[] = [];
  for (let t = 0; t < 5; t++) {
    await page.bringToFront();
    await page.reload();
    // Scroll and click quickly: no settled frame of this state exists yet.
    await page.locator("#blank-link").hover();
    await page.waitForTimeout(300);
    const [popup] = await Promise.all([h.context.waitForEvent("page"), page.click("#blank-link")]);
    await popup.waitForLoadState("load");
    await popup.waitForTimeout(700);
    await popup.close();
  }
  const { guide, debug } = await stop();
  await panel.evaluate(async (u) => {
    const [t] = await chrome.tabs.query({ url: u });
    if (t) await chrome.tabs.setZoom(t.id!, 0);
  }, `${EDGE}/newtab.html`);
  const clicks = acts(guide).filter((s: any) => s.action.type === "click");
  expect(clicks).toHaveLength(5);
  for (const s of clicks) shots.push(!!s.screenshot);
  expect(shots, JSON.stringify(debugOf(debug, guide))).toEqual([true, true, true, true, true]);
  // The ring is on the link in the page the click came from.
  for (const s of clicks) expect(s.page.url).toContain("newtab.html");
  await closeAll(page);
});

// ---- E4 tabs and origins --------------------------------------------------------------------

test("E4b following a link to another origin needs no new gesture; the click there is recorded with a screenshot", async () => {
  const page = await open(`${EDGE}/banner-a.html`);
  await start(page);
  await settle(page);
  await page.click("#xorigin-link");
  await page.waitForURL(`${LOCAL}/banner-b.html`);
  await settle(page, 1600);
  await page.click("#b-button");
  await page.waitForTimeout(800);
  const { guide } = await stop();
  const last = acts(guide).at(-1);
  expect(last.page.url).toBe(`${LOCAL}/banner-b.html`);
  expect(last.screenshot).toBeTruthy();
  expect(last.screenshot.highlight).toBeTruthy();
  await closeAll(page);
});

test("E4c E4d a window.open popup records with its own tabId; switching tabs adds no step and the next step has the right tab", async () => {
  const page = await open(`${EDGE}/newtab.html`);
  await start(page);
  await settle(page);
  const [popup] = await Promise.all([h.context.waitForEvent("page"), page.click("#popup")]);
  await popup.waitForLoadState("load");
  await settle(popup, 1500);
  await popup.click("#b-button");
  await popup.waitForTimeout(600);
  const before = acts((await readGuide(panel, await panel.evaluate(() => chrome.storage.session.get("lastGuideId").then((x) => x.lastGuideId as string))))).length;
  await page.bringToFront();
  await page.waitForTimeout(800);
  await popup.bringToFront();
  await page.bringToFront();
  await page.waitForTimeout(800);
  const midGuide = await readGuide(panel, await panel.evaluate(() => chrome.storage.session.get("lastGuideId").then((x) => x.lastGuideId as string)));
  expect(acts(midGuide).length, "tab switches add no step").toBe(before);
  await settle(page);
  await page.click("#blank-link").catch(() => {});
  await page.waitForTimeout(800);
  const { guide } = await stop();
  const a = acts(guide);
  const [openClick, popupClick, back] = a;
  expect(openClick.page.url).toContain("newtab.html");
  expect(popupClick.page.url).toContain("banner-b.html");
  expect(popupClick.page.tabId).not.toBe(openClick.page.tabId);
  expect(back.page.tabId).toBe(openClick.page.tabId);
  await closeAll(...h.context.pages().filter((p) => p !== panel));
});

test("E4e closing a tab while typing still records the typed value", async () => {
  const page = await open(`${EDGE}/editors.html`);
  const other = await open(`${EDGE}/editors.html`);
  await start(other);
  await other.click("#other");
  await other.keyboard.type("closing soon", { delay: 20 });
  await other.close({ runBeforeUnload: false });
  await page.waitForTimeout(800);
  const { guide } = await stop();
  expect(acts(guide).filter((s: any) => s.action.type === "type").map((s: any) => s.action.value)).toContain("closing soon");
  await closeAll(page);
});

// ---- E5 pause and resume, E6 lifecycle ------------------------------------------------------

test("E5 pause: badge II and nothing recorded; resume records again; Stop while paused works", async () => {
  const page = await open(`${EDGE}/select.html`);
  await start(page);
  expect((await ctl(panel, { type: "ctl:pause" })).ok).toBe(true);
  expect(await panel.evaluate(() => chrome.action.getBadgeText({}))).toBe("II");
  expect(await panel.evaluate(() => chrome.storage.session.get("session").then((x) => (x.session as { status: string }).status))).toBe("paused");
  for (let i = 0; i < 3; i++) await page.click("#dbl");
  await page.keyboard.press("Control+K");
  await page.keyboard.press("Control+J");
  await page.waitForTimeout(600);
  expect((await ctl(panel, { type: "ctl:resume" })).ok).toBe(true);
  const badge = await panel.evaluate(() => chrome.action.getBadgeText({}));
  expect(badge === "REC" || /^\d+$/.test(badge), `badge ${badge}`).toBe(true);
  expect(await panel.evaluate(() => chrome.storage.session.get("session").then((x) => (x.session as { status: string }).status))).toBe("recording");
  await settle(page);
  await page.click("#ctx");
  await page.waitForTimeout(600);
  expect((await ctl(panel, { type: "ctl:pause" })).ok).toBe(true);
  const { guide } = await stop();
  expect(acts(guide)).toHaveLength(1);
  expect(await panel.evaluate(() => chrome.action.getBadgeText({}))).toBe("");
  await closeAll(page);
});

test("E6 after Stop no content script stays registered, clicks add nothing, a second recording is a second guide, Record while recording is refused", async () => {
  const page = await open(`${EDGE}/select.html`);
  await start(page);
  const again = await ctl(panel, { type: "ctl:start" });
  expect(again.ok).toBe(false);
  expect(again.error).toMatch(/already recording/i);
  await settle(page);
  await page.click("#dbl");
  await page.waitForTimeout(600);
  const first = await stop();
  expect(await panel.evaluate(() => chrome.scripting.getRegisteredContentScripts())).toEqual([]);
  expect(await panel.evaluate(() => chrome.action.getBadgeText({}))).toBe("");
  await page.click("#ctx");
  await page.waitForTimeout(600);
  expect(acts(await readGuide(panel, first.guideId))).toHaveLength(1);
  await start(page);
  await settle(page);
  await page.click("#dbl");
  await page.waitForTimeout(600);
  const second = await stop();
  expect(second.guideId).not.toBe(first.guideId);
  await closeAll(page);
});

// ---- E7 frames ------------------------------------------------------------------------------

/**
 * Box of `sel` inside a single (possibly transformed, cross-origin) iframe, from the iframe's own
 * box in the top page and the element's box in the frame: Playwright's boundingBox does not apply
 * CSS transforms of out-of-process frames.
 */
async function boxInFrame(page: Page, frame: string, sel: string): Promise<Box> {
  const f = await page.locator(frame).evaluate((el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, ow: el.offsetWidth, cl: el.clientLeft, ct: el.clientTop };
  });
  const inner = await page.frameLocator(frame).locator(sel).evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  });
  const k = f.w / f.ow;
  return { x: f.x + (f.cl + inner.x) * k, y: f.y + (f.ct + inner.y) * k, width: inner.width * k, height: inner.height * k };
}

async function frameStep(url: string, frames: string[], sel: string) {
  const page = await open(url);
  await page.waitForTimeout(500);
  await start(page);
  await settle(page, 1500);
  const want = frames.length === 1 ? await boxInFrame(page, frames[0]!, sel) : await boxOf(page, sel, frames);
  await page.mouse.move(want.x + want.width / 2, want.y + want.height / 2);
  await page.waitForTimeout(400);
  await page.mouse.click(want.x + want.width / 2, want.y + want.height / 2);
  await page.waitForTimeout(1000);
  const out = await stop();
  const step = acts(out.guide).find((s: any) => s.action.type === "click");
  return { page, step, want, ...out };
}

test("E7a a click in a same-origin iframe has a frame chain of length 1", async () => {
  const page = await open(`${FIXTURES}/settings.html`);
  await start(page);
  await page.frameLocator("#confirm-frame").locator("#frame-confirm").scrollIntoViewIfNeeded();
  await settle(page, 1500);
  const want = await boxOf(page, "#frame-confirm", ["#confirm-frame"]);
  await page.frameLocator("#confirm-frame").locator("#frame-confirm").click();
  await page.waitForTimeout(900);
  const { guide } = await stop();
  const s = acts(guide).find((x: any) => x.action.type === "click");
  expect(s.target.frame).toHaveLength(1);
  expect(edgeErr(s.screenshot.highlight, scale(want, kOf(s)))).toBeLessThanOrEqual(2);
  await closeAll(page);
});

test("E7b a click in a cross-origin iframe: chain of 1 from the handshake, highlight within 2 px", async () => {
  const { page, step, want } = await frameStep(`${EDGE}/xorigin-frame.html`, ["#pay-frame"], "#inner-button");
  expect(step.target.frame).toEqual(["#pay-frame"]);
  expect(edgeErr(step.screenshot.highlight, scale(want, kOf(step)))).toBeLessThanOrEqual(2);
  await closeAll(page);
});

test("E7c nested frames (same-origin middle, cross-origin inner): chain of 2, highlight within 2 px", async () => {
  const { page, step, want } = await frameStep(`${EDGE}/nested-frame.html`, ["#mid-frame", "#inner-frame"], "#inner-button");
  expect(step.target.frame).toHaveLength(2);
  expect(edgeErr(step.screenshot.highlight, scale(want, kOf(step)))).toBeLessThanOrEqual(2);
  await closeAll(page);
});

test("E7d frames drawn at scale(0.5) with a border: highlight within 3 px (same origin and cross origin)", async () => {
  for (const [url, frame] of [
    [`${EDGE}/scaled-frame.html`, "#scaled"],
    [`${EDGE}/xorigin-scaled.html`, "#scaled-x"],
  ] as const) {
    const { page, step, want } = await frameStep(url, [frame], "#inner-button");
    expect.soft(edgeErr(step.screenshot.highlight, scale(want, kOf(step))), url).toBeLessThanOrEqual(3);
    await closeAll(page);
  }
});

test("E7e typing in a cross-origin iframe field is one step", async () => {
  const page = await open(`${EDGE}/xorigin-frame.html`);
  await page.waitForTimeout(500);
  await start(page);
  const f = page.frameLocator("#pay-frame");
  await f.locator("#inner-note").click();
  await f.locator("#inner-note").pressSequentially("gift wrap", { delay: 30 });
  await page.waitForTimeout(300);
  const { guide } = await stop();
  expect(acts(guide).filter((s: any) => s.action.type === "type").map((s: any) => s.action.value)).toEqual(["gift wrap"]);
  await closeAll(page);
});

test("E7f R10 a parent that blocks messages: the frame's step is recorded without highlight and flagged for review", async () => {
  const page = await open(`${EDGE}/blocked-messages.html`);
  await page.waitForTimeout(500);
  await start(page);
  await settle(page, 1500);
  await page.frameLocator("#blocked-frame").locator("#inner-button").click();
  await page.waitForTimeout(1200);
  await settle(page);
  await page.click("h1");
  await page.waitForTimeout(600);
  const { guide, debug, guideId } = await stop();
  const s = acts(guide).find((x: any) => x.action.type === "click" && x.target?.name === "Pay in frame");
  expect(s, "frame click recorded").toBeTruthy();
  expect(s.screenshot?.highlight).toBeUndefined();
  const d = debugOf(debug, guide).find((x) => x.stepId === s.id);
  expect(d.needsReview).toBe("frame-handshake");
  expect(d.review).toBe(true);
  // The editor shows the review chip for it.
  const editor = await h.context.newPage();
  await editor.goto(extUrl(h, `editor.html?guide=${encodeURIComponent(guideId)}`));
  await expect(editor.getByText(/could not be scanned/i).first()).toBeVisible();
  await closeAll(page, editor);
});

// ---- E8 shadow DOM, E9 SPA ------------------------------------------------------------------

test("E8 open roots record their host chain (1 and 2 deep); a closed root records the host; typing inside a closed root is one step", async () => {
  const page = await open(`${EDGE}/shadow-open.html`);
  await start(page);
  await settle(page);
  await page.click("#s-save");
  await page.waitForTimeout(700);
  await settle(page);
  await page.click("#deep-button");
  await page.waitForTimeout(700);
  const open1 = await stop();
  const [save, deep] = acts(open1.guide);
  expect(save.target.shadow).toHaveLength(1);
  expect(deep.target.shadow).toHaveLength(2);
  const css = (s: any) => s.target.locators.find((l: any) => l.kind === "css")?.value;
  let loc: any = page;
  for (const host of save.target.shadow) loc = loc.locator(host);
  await expect(loc.locator(css(save))).toHaveCount(1);
  await closeAll(page);

  const closed = await open(`${EDGE}/shadow-closed.html`);
  await start(closed);
  await settle(closed);
  const hostBox = await boxOf(closed, "#closed-host");
  await closed.mouse.click(hostBox.x + 60, hostBox.y + 150);
  await closed.waitForTimeout(600);
  await closed.mouse.click(hostBox.x + 60, hostBox.y + 45);
  await closed.keyboard.type("Jane D", { delay: 30 });
  await closed.waitForTimeout(300);
  const c = await stop();
  const a = acts(c.guide);
  expect(a.length).toBeGreaterThanOrEqual(2);
  const click = a.find((s: any) => s.action.type === "click");
  expect(click.target.tag).toBe("closed-profile");
  expect(click.screenshot).toBeTruthy();
  expect(a.filter((s: any) => s.action.type === "type").map((s: any) => s.action.value)).toEqual(["Jane D"]);
  await closeAll(closed);
});

test("E9 SPA: pushState after a click adds no navigate step, Back adds one, a hashchange with no action adds one", async () => {
  const page = await open(`${EDGE}/spa.html`);
  await start(page);
  await settle(page);
  await page.click("#nav-orders");
  await page.waitForTimeout(3500);
  await page.goBack();
  await page.waitForTimeout(3500);
  await page.evaluate(() => (location.hash = "details"));
  await page.waitForTimeout(3500);
  const { guide } = await stop();
  const kinds = guide.steps.map((s: any) => (s.action.type === "navigate" ? `nav ${new URL(s.action.url).search}${new URL(s.action.url).hash}` : s.action.type));
  expect(kinds).toEqual(["nav ", "click", "nav ", "nav #details"]);
  for (let i = 1; i < guide.steps.length; i++) {
    const a = guide.steps[i - 1], b = guide.steps[i];
    if (a.action.type === "navigate" && b.action.type === "navigate") expect(a.action.url).not.toBe(b.action.url);
  }
  await closeAll(page);
});

// ---- E12 performance, E13 rungs -------------------------------------------------------------

test("E12 pointerdown handler p95 <= 5 ms, pointerdown-to-stored p95 <= 1500 ms at human pace, bundle budgets", async () => {
  const page = await open(`${EDGE}/burst.html`);
  pageLog.length = 0;
  await start(page);
  await settle(page);
  const b = await boxOf(page, "#burst");
  const pressed: number[] = [];
  for (let i = 0; i < 30; i++) {
    pressed.push(Date.now());
    await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
    await page.waitForTimeout(700);
  }
  const gid = await panel.evaluate(() => chrome.storage.session.get("lastGuideId").then((x) => x.lastGuideId as string));
  const g = await readGuide(panel, gid);
  const latency = acts(g).map((s: any, i: number) => Date.parse(s.timestamp) - pressed[i]!);
  await stop();
  const ms = pageLog.filter((l) => l.includes("pointerdown-ms")).map((l) => Number(l.split(" ").pop()));
  expect(ms.length).toBeGreaterThanOrEqual(30);
  const p95 = (xs: number[]) => [...xs].sort((x, y) => x - y)[Math.ceil(xs.length * 0.95) - 1]!;
  expect(p95(ms), `pointerdown handler ms ${JSON.stringify(ms)}`).toBeLessThanOrEqual(5);
  expect(p95(latency.map((x: number) => Math.abs(x)))).toBeLessThanOrEqual(1500);
  const gz = (f: string) => gzipSync(readFileSync(join(EXT_DIR, f))).length / 1024;
  expect(gz("recorder.js")).toBeLessThanOrEqual(60);
  expect(gz("background.js")).toBeLessThanOrEqual(250);
  await closeAll(page);
});

// ---- R redaction ----------------------------------------------------------------------------

async function fieldCovered(page: Page, step: any, sel: string, frames: string[] = []) {
  const want = scale(await boxOf(page, sel, frames), kOf(step));
  return autoRects(step).some((r) => covers(r, want));
}

test("R3 password fields in a cross-origin frame, nested frames, an open and a closed shadow root are redacted", async () => {
  for (const [url, frames] of [
    [`${EDGE}/xorigin-frame.html`, ["#pay-frame"]],
    [`${EDGE}/nested-frame.html`, ["#mid-frame", "#inner-frame"]],
  ] as const) {
    const page = await open(url);
    await page.waitForTimeout(600);
    await start(page);
    await settle(page, 1500);
    await page.click("h1");
    await page.waitForTimeout(900);
    const { guide } = await stop();
    const s = acts(guide).find((x: any) => x.action.type === "click");
    expect.soft(await fieldCovered(page, s, "#inner-password", [...frames]), `${url} password`).toBe(true);
    expect.soft(await fieldCovered(page, s, "#inner-card", [...frames]), `${url} card`).toBe(true);
    await closeAll(page);
  }
  for (const url of [`${EDGE}/shadow-open.html`, `${EDGE}/shadow-closed.html`]) {
    const page = await open(url);
    await start(page);
    await settle(page);
    await page.click("h1");
    await page.waitForTimeout(800);
    const { guide } = await stop();
    const s = acts(guide).find((x: any) => x.action.type === "click");
    // The password box, measured from the page (a closed root needs the host's own coordinates).
    const want = await page.evaluate(() => {
      const host = document.querySelector("#host, #closed-host")!;
      const root = (host as any).shadowRoot as ShadowRoot | null;
      const el = root?.getElementById("s-pass");
      const r = (el ?? host).getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height, known: !!el };
    });
    if (want.known) expect.soft(autoRects(s).some((r) => covers(r, scale(want, kOf(s)))), `${url}`).toBe(true);
    else {
      // Closed root: the page cannot measure inside it; the password row sits 2 fields down in the host.
      const hb = scale(await boxOf(page, "#closed-host"), kOf(s));
      expect.soft(autoRects(s).some((r) => r.y > hb.y && r.y < hb.y + hb.height && r.x >= hb.x - 4), `${url}`).toBe(true);
    }
    await closeAll(page);
  }
});

test("R4 a secret field in the second tab is redacted on that tab's steps", async () => {
  const page = await open(`${EDGE}/newtab.html`);
  await start(page);
  const second = await h.context.newPage();
  await second.goto(`${EDGE}/sensitive.html`);
  await second.waitForTimeout(900);
  await settle(second, 1500);
  await second.click("#refresh");
  await second.waitForTimeout(900);
  const { guide } = await stop();
  const s = acts(guide).find((x: any) => x.page.url.includes("sensitive.html"));
  expect(s.page.tabId).not.toBe(guide.steps[0].page.tabId);
  expect(await fieldCovered(second, s, "#cur-password")).toBe(true);
  await closeAll(page, second);
});

test("R5 R6 text that appears later and a password field added by a route change are redacted on the next step", async () => {
  const page = await open(`${EDGE}/sensitive.html`);
  await start(page);
  await page.waitForTimeout(700);
  await settle(page);
  await page.click("#refresh");
  await page.waitForTimeout(900);
  await settle(page);
  await page.click("#change-password");
  await page.waitForTimeout(900);
  await settle(page);
  await page.click("#refresh");
  await page.waitForTimeout(900);
  const { guide } = await stop();
  const clicks = acts(guide).filter((s: any) => s.action.type === "click");
  const [first, , third] = clicks;
  const textBox = async (sel: string) =>
    page.evaluate((s) => {
      const r = document.createRange();
      r.selectNodeContents(document.querySelector(s)!);
      const b = r.getBoundingClientRect();
      return { x: b.x, y: b.y, width: b.width, height: b.height };
    }, sel);
  for (const sel of ["#ssn", "#token", "#card2"]) {
    const want = scale(await textBox(sel), kOf(first));
    expect.soft(autoRects(first).some((r) => covers(r, want)), `R5 ${sel}`).toBe(true);
  }
  expect.soft(await fieldCovered(page, first, "#cc"), "R5 cc-number field").toBe(true);
  expect.soft(await fieldCovered(page, first, "#cur-password"), "password").toBe(true);
  expect.soft(await fieldCovered(page, third, "#new-password"), "R6 new password after the route change").toBe(true);
  await closeAll(page);
});

test("R8 nothing on the neutral page is redacted and its image is stored as captured", async () => {
  const page = await open(`${EDGE}/neutral.html`);
  await start(page);
  await settle(page);
  await page.click("#confirm");
  await page.waitForTimeout(800);
  const { guide, debug } = await stop();
  for (const s of guide.steps) expect(s.screenshot?.redactions ?? [], `${s.title}: ${JSON.stringify(s.screenshot?.redactions)}`).toEqual([]);
  for (const d of debugOf(debug, guide)) expect(d.baked).toBe(false);
  await closeAll(page);
});

test("R9 on a 50,000-node page the scan stops at its budget, the capture completes, and the step asks for a review; normal pages scan in 15 ms", async () => {
  // Normal pages first: a dozen clicks on the neutral and burst pages.
  const normalPage = await open(`${EDGE}/neutral.html`);
  await start(normalPage);
  for (let i = 0; i < 12; i++) {
    await normalPage.mouse.move(3, 3 + i);
    await normalPage.waitForTimeout(250);
    await normalPage.click(i % 2 ? "#confirm" : "h1");
    await normalPage.waitForTimeout(350);
  }
  const normalRun = await stop();
  await closeAll(normalPage);
  const page = await open(`${EDGE}/heavy.html`);
  await start(page);
  await settle(page, 1500);
  await page.click("#heavy-button");
  await page.waitForTimeout(1200);
  const { guide, debug, guideId } = await stop();
  const s = acts(guide).find((x: any) => x.action.type === "click");
  expect(s.screenshot).toBeTruthy();
  const d = debugOf(debug, guide).find((x) => x.stepId === s.id);
  expect(d.review).toBe(true);
  expect(d.scanMs).toBeLessThanOrEqual(60);
  const editor = await h.context.newPage();
  await editor.goto(extUrl(h, `editor.html?guide=${encodeURIComponent(guideId)}`));
  await expect(editor.getByText(/could not be scanned/i).first()).toBeVisible();
  const normal = debugOf(normalRun.debug, normalRun.guide).filter((x) => typeof x.scanMs === "number").map((x) => x.scanMs as number);
  expect(normal.length).toBeGreaterThan(10);
  const p95 = [...normal].sort((a, b) => a - b)[Math.ceil(normal.length * 0.95) - 1]!;
  expect(p95).toBeLessThanOrEqual(15);
  await closeAll(page, editor);
});

test("E13 a mixed run (typing, clicks, a navigation, a new tab): every step has a screenshot or a logged reason, at least 9 of 10 at rung 1 or 2, no worker errors", async () => {
  swErrors.length = 0;
  const page = await open(`${FIXTURES}/index.html`);
  await start(page);
  const act = async (fn: () => Promise<unknown>) => {
    await settle(page);
    await fn();
    await page.waitForTimeout(800);
  };
  await act(async () => {
    await page.click("#email");
    await page.keyboard.type("jane@example.com", { delay: 15 });
  });
  await act(async () => {
    await page.click("#password");
    await page.keyboard.type("Correct-Horse-9", { delay: 15 });
  });
  await act(() => page.click("#sign-in"));
  await page.waitForURL("**/dashboard.html");
  await act(() => page.click("#nav-reports"));
  await act(() => page.click("#settings-link"));
  await page.waitForURL("**/settings.html");
  await act(() => page.selectOption("#billing-period", "yearly"));
  await act(() => page.check("#email-invoices"));
  await act(() => page.click("#save"));
  await page.waitForTimeout(600);
  const { guide, debug } = await stop();
  const d = debugOf(debug, guide);
  expect(d.length).toBe(guide.steps.length);
  for (const s of guide.steps) {
    const entry = d.find((x) => x.stepId === s.id);
    expect(!!s.screenshot || entry?.rung === "none", `${s.title}: ${JSON.stringify(entry)}`).toBe(true);
  }
  const actions = d.filter((x) => x.rung !== "nav");
  expect(actions.filter((x) => x.rung === "settled" || x.rung === "live").length / actions.length, JSON.stringify(actions.map((x) => x.rung))).toBeGreaterThanOrEqual(0.9);
  expect(guide.steps.filter((s: any) => !s.screenshot)).toEqual([]);
  expect(swErrors).toEqual([]);
  await closeAll(page);
});

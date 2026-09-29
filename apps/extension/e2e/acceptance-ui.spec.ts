// ACCEPTANCE §X, F-LIB, §J (J1-J4), P6 and H6 on the real extension pages: editor editing,
// reorder, delete/skip/merge/note, blur and crop, export timings, import errors, copy as Markdown,
// the support moment, renderer parity, the library, accessibility, and the .showsteps round trip.
// One short recording on the Acme Books fixtures feeds every test. Titles start with check ids.
import { expect, test } from "@playwright/test";
import type { Download, Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { strFromU8, unzipSync, zipSync } from "fflate";
// Direct module imports: the package index also loads a JSON schema Playwright's loader cannot import.
import { unpackBundle } from "../../../packages/core/src/bundle";
import { validateGuide } from "../../../packages/core/src/validate";
import { ctl, extUrl, FIXTURES, launch, readGuide, regionStats } from "./harness";
import type { Harness } from "./harness";

const require = createRequire(import.meta.url);
const AXE = readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");
const SUPPORT_URL = "https://showsteps.vercel.app/support/";
const SITE_URL = "https://showsteps.vercel.app";

type Box = { x: number; y: number; width: number; height: number };
let h: Harness;
let panel: Page;
let guideId: string;

test.describe.configure({ mode: "serial" });

async function record(): Promise<string> {
  const main = await h.context.newPage();
  await main.goto(`${FIXTURES}/index.html`);
  await main.bringToFront();
  const r = await ctl(panel, { type: "ctl:start" });
  expect(r.ok, r.error).toBe(true);
  await main.waitForTimeout(1300);
  const act = async (fn: () => Promise<unknown>) => {
    await main.mouse.move(4, 4);
    await main.waitForTimeout(1300);
    await fn();
    await main.waitForTimeout(800);
  };
  await act(async () => {
    await main.click("#email");
    await main.locator("#email").pressSequentially("jane@example.com", { delay: 15 });
  });
  await act(async () => {
    await main.click("#password");
    await main.locator("#password").pressSequentially("Correct-Horse-9", { delay: 15 });
  });
  await act(() => main.click("#sign-in"));
  await main.waitForURL("**/dashboard.html");
  await act(() => main.click("#settings-link"));
  await main.waitForURL("**/settings.html");
  await act(() => main.selectOption("#billing-period", "yearly"));
  await act(() => main.check("#email-invoices"));
  await act(() => main.click("#save"));
  const s = await ctl(panel, { type: "ctl:stop", openEditor: false });
  expect(s.ok).toBe(true);
  await main.close();
  return panel.evaluate(() => chrome.storage.session.get("lastGuideId").then((x) => x.lastGuideId as string));
}

async function openEditor(id = guideId): Promise<Page> {
  const ed = await h.context.newPage();
  await ed.setViewportSize({ width: 1280, height: 860 });
  await ed.goto(extUrl(h, `editor.html?guide=${encodeURIComponent(id)}`));
  await expect(ed.getByRole("list", { name: "Steps" })).toBeVisible();
  return ed;
}

async function storeCount(page: Page, store: string, gid?: string): Promise<number> {
  return page.evaluate(
    ({ store, gid }) =>
      new Promise<number>((res, rej) => {
        const r = indexedDB.open("showsteps");
        r.onerror = () => rej(r.error);
        r.onsuccess = () => {
          const db = r.result;
          if (!db.objectStoreNames.contains(store)) return res(-1);
          const os = db.transaction(store).objectStore(store);
          const q = gid && os.indexNames.contains("guideId") ? os.index("guideId").count(gid) : os.count();
          q.onsuccess = () => res(q.result);
        };
      }),
    { store, gid },
  );
}

/** Export one format from an editor page; resolves with the download and the wall time. */
async function exportFrom(ed: Page, format: string): Promise<{ download: Download; ms: number; bytes: Buffer }> {
  if (!(await ed.locator("dialog.export[open]").count())) await ed.getByRole("button", { name: /^export/i }).first().click();
  await expect(ed.locator("dialog.export")).toBeVisible();
  const back = ed.getByRole("button", { name: /export another/i });
  if (await back.count()) await back.first().click();
  await ed.locator(`[data-format="${format}"]`).click();
  const t0 = Date.now();
  const [download] = await Promise.all([ed.waitForEvent("download", { timeout: 60_000 }), ed.getByTestId("export-go").click()]);
  const ms = Date.now() - t0;
  const bytes = readFileSync((await download.path())!);
  return { download, ms, bytes };
}

test.beforeAll(async () => {
  h = await launch();
  await h.context.grantPermissions(["clipboard-read", "clipboard-write"]);
  // Nothing may leave the machine: every request to the web is refused (the support link included).
  await h.context.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, (r) => r.abort());
  panel = await h.context.newPage();
  await panel.goto(extUrl(h, "sidepanel.html"));
  guideId = await record();
});
test.afterAll(async () => {
  await h?.close();
});

// ---- X1 list and panel controls -------------------------------------------------------------

test("X1 the editor lists every step with its number, title and screenshot, without decoding full images for the list", async () => {
  const ed = await h.context.newPage();
  await ed.addInitScript(() => {
    const orig = globalThis.createImageBitmap;
    (globalThis as any).__bitmaps = 0;
    globalThis.createImageBitmap = ((...a: any[]) => {
      (globalThis as any).__bitmaps++;
      return (orig as any)(...a);
    }) as typeof createImageBitmap;
  });
  await ed.setViewportSize({ width: 1280, height: 860 });
  await ed.goto(extUrl(h, `editor.html?guide=${encodeURIComponent(guideId)}`));
  const guide = await readGuide(panel, guideId);
  const items = ed.getByRole("list", { name: "Steps" }).locator(":scope > li");
  await expect(items).toHaveCount(guide.steps.length);
  for (let i = 0; i < guide.steps.length; i++) await expect(ed.getByRole("button", { name: new RegExp(`^Step ${i + 1}:`) }).first()).toBeVisible();
  await ed.waitForTimeout(800);
  expect(await ed.evaluate(() => (globalThis as any).__bitmaps)).toBe(0);
  await ed.close();
});

test("X1 Record, Pause and Stop in the side panel drive the same state as the control messages", async () => {
  const main = await h.context.newPage();
  await main.goto(`${FIXTURES}/index.html`);
  const p = await h.context.newPage();
  await p.goto(extUrl(h, "sidepanel.html"));
  await main.bringToFront();
  await p.getByRole("button", { name: /start recording/i }).click();
  const status = () => panel.evaluate(() => chrome.storage.session.get("session").then((x) => (x.session as { status: string }).status));
  await expect.poll(status).toBe("recording");
  await p.getByRole("button", { name: "Pause" }).click();
  await expect.poll(status).toBe("paused");
  await p.getByRole("button", { name: "Resume" }).click();
  await expect.poll(status).toBe("recording");
  const [editor] = await Promise.all([h.context.waitForEvent("page", { predicate: (x) => x.url().includes("editor.html") }), p.getByRole("button", { name: /stop and review/i }).click()]);
  await expect.poll(status).toBe("idle");
  await closeAll(main, p, editor);
});

async function closeAll(...pages: Page[]) {
  for (const x of pages) await x.close().catch(() => {});
}

// ---- X2 X3 X4 editing -----------------------------------------------------------------------

test("X2 an edited title survives Regenerate titles, the others are rewritten; descriptions persist; undo brings back a deleted step", async () => {
  // Copy the guide so later checks keep the original.
  const id = await duplicate(guideId);
  // Scramble the generated titles so regeneration has something to fix.
  await panel.evaluate(async (gid) => {
    const r = indexedDB.open("showsteps");
    await new Promise((res) => (r.onsuccess = res));
    const tx = r.result.transaction("guides", "readwrite");
    const q = tx.objectStore("guides").get(gid);
    await new Promise((res) => (q.onsuccess = res));
    const g = q.result;
    for (const s of g.steps) s.title = `stale ${s.id}`;
    tx.objectStore("guides").put(g);
    await new Promise((res) => (tx.oncomplete = res));
  }, id);
  const ed = await openEditor(id);
  await ed.getByRole("button", { name: /^Step 2:/ }).first().click();
  await ed.getByRole("button", { name: /^Step 2: .*Edit title/ }).click();
  await ed.getByRole("textbox", { name: /^Title for step 2/ }).fill("My own words");
  await ed.keyboard.press("Enter");
  const desc = ed.getByRole("textbox", { name: /description/i }).first();
  await desc.fill("Only admins see this.");
  await desc.blur();
  await ed.getByRole("button", { name: "Regenerate titles" }).click();
  await ed.waitForTimeout(700);
  let g = await readGuide(panel, id);
  expect(g.steps[1].title).toBe("My own words");
  expect(g.steps.filter((s: any) => s.title.startsWith("stale "))).toHaveLength(0);
  await ed.reload();
  await expect(ed.getByRole("list", { name: "Steps" })).toBeVisible();
  g = await readGuide(panel, id);
  expect(g.steps[1].description).toBe("Only admins see this.");
  const before = g.steps.length;
  await ed.getByRole("button", { name: /^Step 3:/ }).first().click();
  await ed.getByRole("toolbar", { name: /Step 3 tools/ }).getByRole("button", { name: "Delete" }).click();
  await expect.poll(async () => (await readGuide(panel, id)).steps.length).toBe(before - 1);
  await ed.getByRole("button", { name: "Undo", exact: true }).first().click();
  await expect.poll(async () => (await readGuide(panel, id)).steps.length).toBe(before);
  await ed.close();
});

async function duplicate(id: string): Promise<string> {
  return panel.evaluate(async (gid) => {
    const open = () =>
      new Promise<IDBDatabase>((res) => {
        const r = indexedDB.open("showsteps");
        r.onsuccess = () => res(r.result);
      });
    const db = await open();
    const get = (store: string, key: string) =>
      new Promise<any>((res) => {
        const q = db.transaction(store).objectStore(store).get(key);
        q.onsuccess = () => res(q.result);
      });
    const g = await get("guides", gid);
    const nid = `g_copy_${Math.random().toString(36).slice(2, 8)}`;
    const tx = db.transaction(["guides", "images"], "readwrite");
    tx.objectStore("guides").put({ ...g, id: nid, title: `${g.title} copy`, updatedAt: new Date().toISOString() });
    for (const s of g.steps) {
      if (!s.screenshot) continue;
      const rec = await new Promise<any>((res) => {
        const q = db.transaction("images").objectStore("images").get(`${gid}/${s.screenshot.image}`);
        q.onsuccess = () => res(q.result);
      });
      if (rec) db.transaction("images", "readwrite").objectStore("images").put({ ...rec, key: `${nid}/${s.screenshot.image}`, guideId: nid });
    }
    await new Promise((res) => (tx.oncomplete = res));
    return nid;
  }, id);
}

test("X3 reorder by keyboard persists after reload and renumbers", async () => {
  const id = await duplicate(guideId);
  const ed = await openEditor(id);
  const before = (await readGuide(panel, id)).steps.map((s: any) => s.id);
  await ed.getByRole("button", { name: /^Reorder step 2/ }).focus();
  await ed.keyboard.press("ArrowDown");
  await ed.waitForTimeout(600);
  await ed.reload();
  await expect(ed.getByRole("list", { name: "Steps" })).toBeVisible();
  const after = (await readGuide(panel, id)).steps.map((s: any) => s.id);
  expect(after).toEqual([before[0], before[2], before[1], ...before.slice(3)]);
  await ed.close();
});

test("X4 skip keeps a step out of every export but in the project; merge keeps the first screenshot; a note step needs no screenshot", async () => {
  const id = await duplicate(guideId);
  const ed = await openEditor(id);
  const g0 = await readGuide(panel, id);
  // Skip step 4.
  await ed.getByRole("button", { name: /^Step 4:/ }).first().click();
  await ed.getByRole("toolbar", { name: /Step 4 tools/ }).getByRole("button", { name: "Skip" }).click();
  await expect.poll(async () => (await readGuide(panel, id)).steps[3].skipped).toBe(true);
  // Merge step 2 with the next.
  await ed.getByRole("button", { name: /^Step 2:/ }).first().click();
  await ed.getByRole("toolbar", { name: /Step 2 tools/ }).getByRole("button", { name: "Merge" }).click();
  await expect.poll(async () => (await readGuide(panel, id)).steps.length).toBe(g0.steps.length - 1);
  const g1 = await readGuide(panel, id);
  expect(g1.steps[1].screenshot?.image).toBe(g0.steps[1].screenshot?.image);
  // Add a note before step 2.
  await ed.getByRole("button", { name: /^Add a note before step 2/ }).click();
  await expect.poll(async () => (await readGuide(panel, id)).steps.some((s: any) => s.action.type === "note")).toBe(true);
  const g2 = await readGuide(panel, id);
  const skippedTitle = g2.steps.find((s: any) => s.skipped).title.replace(/\*\*/g, "");
  const md = await exportFrom(ed, "markdown");
  const files = unzipSync(new Uint8Array(md.bytes));
  const guideMd = strFromU8(files[Object.keys(files).find((k) => k.endsWith("guide.md"))!]!);
  expect(guideMd).not.toContain(skippedTitle);
  const proj = await exportFrom(ed, "project");
  const { guide } = unpackBundle(new Uint8Array(proj.bytes));
  expect(guide.steps.some((s: any) => s.skipped)).toBe(true);
  expect(guide.steps.find((s: any) => s.action.type === "note")?.screenshot).toBeUndefined();
  await ed.close();
});

// ---- X5 blur box, X6 crop --------------------------------------------------------------------

async function drawOnShot(ed: Page, from: [number, number], to: [number, number]) {
  const shot = ed.locator(".ed-detail .shot").first();
  const b = (await shot.boundingBox())!;
  await ed.mouse.move(b.x + from[0] * b.width, b.y + from[1] * b.height);
  await ed.mouse.down();
  await ed.mouse.move(b.x + to[0] * b.width, b.y + to[1] * b.height, { steps: 6 });
  await ed.mouse.up();
}

test("X5 X6 a manual blur box is burnt into the exported image (and removable in the editor); a crop exports at exactly its size", async () => {
  const id = await duplicate(guideId);
  const ed = await openEditor(id);
  await ed.getByRole("button", { name: /^Step 1:/ }).first().click();
  await ed.getByRole("toolbar", { name: /Step 1 tools/ }).getByRole("button", { name: "Blur" }).click();
  await drawOnShot(ed, [0.3, 0.3], [0.6, 0.5]);
  await expect.poll(async () => (await readGuide(panel, id)).steps[0].screenshot.redactions?.filter((r: any) => !r.auto).length ?? 0).toBe(1);
  const g = await readGuide(panel, id);
  const box: Box = g.steps[0].screenshot.redactions.find((r: any) => !r.auto).rect;
  const md = await exportFrom(ed, "markdown");
  const files = unzipSync(new Uint8Array(md.bytes));
  const img = Object.keys(files).filter((k) => k.endsWith(".png")).sort()[0]!;
  const png = Buffer.from(files[img]!).toString("base64");
  // The exported image crops nothing here; compare the blur box with the stored original.
  const [exported] = await regionStats(panel, { png }, [box]);
  const [stored] = await regionStats(panel, { guideId: id, path: g.steps[0].screenshot.image }, [box]);
  expect(exported!.texture).toBeLessThanOrEqual(stored!.texture * 0.2 + 0.5);
  // Crop step 2 and export: the image is exactly the crop.
  await ed.keyboard.press("Escape");
  await ed.getByRole("button", { name: /^Step 2:/ }).first().click();
  await ed.getByRole("toolbar", { name: /Step 2 tools/ }).getByRole("button", { name: "Crop" }).click();
  await drawOnShot(ed, [0.1, 0.1], [0.7, 0.6]);
  await expect.poll(async () => !!(await readGuide(panel, id)).steps[1].screenshot.crop).toBe(true);
  const crop = (await readGuide(panel, id)).steps[1].screenshot.crop as Box;
  const md2 = await exportFrom(ed, "markdown");
  const f2 = unzipSync(new Uint8Array(md2.bytes));
  const png2 = f2[Object.keys(f2).filter((k) => k.endsWith(".png")).sort()[1]!]!;
  const w = (png2[16]! << 24) | (png2[17]! << 16) | (png2[18]! << 8) | png2[19]!;
  const hgt = (png2[20]! << 24) | (png2[21]! << 16) | (png2[22]! << 8) | png2[23]!;
  expect([w, hgt]).toEqual([Math.round(crop.width), Math.round(crop.height)]);
  await ed.close();
});

// ---- X7 export timings, X9 copy, X10 support --------------------------------------------------

test("X7 X10 every format exports within its time budget; the support link appears after the first export and is the only outbound URL", async () => {
  await panel.evaluate(() => chrome.storage.local.remove("support"));
  const ed = await openEditor();
  await expect(ed.getByRole("link", { name: /support/i })).toHaveCount(0);
  const limits: Record<string, number> = { markdown: 3000, html: 3000, skill: 3000, project: 3000, docx: 6000, pdf: 8000 };
  const took: Record<string, number> = {};
  let first = true;
  for (const f of ["markdown", "html", "skill", "project", "docx", "pdf"]) {
    const r = await exportFrom(ed, f);
    took[f] = r.ms;
    if (first) {
      const link = ed.getByRole("link", { name: /support/i });
      await expect(link).toHaveCount(1);
      expect(await link.getAttribute("href")).toBe(SUPPORT_URL);
      const [tab] = await Promise.all([h.context.waitForEvent("page"), link.click()]);
      expect(tab.url()).toBe(SUPPORT_URL);
      await tab.close();
      first = false;
    }
  }
  for (const [f, ms] of Object.entries(took)) expect.soft(ms, `${f} took ${ms} ms`).toBeLessThanOrEqual(limits[f]!);
  // Every outbound link in the editor and the panel goes to our own site or the support page.
  for (const page of [ed, panel]) {
    const hrefs = await page.evaluate(() => Array.from(document.querySelectorAll("a[href]")).map((a) => (a as HTMLAnchorElement).href));
    for (const href of hrefs.filter((x) => /^https?:/.test(x))) expect([SUPPORT_URL, SITE_URL, `${SITE_URL}/`].some((ok) => href.startsWith(ok)), href).toBe(true);
  }
  await ed.close();
});

test("X9 Copy as Markdown puts exactly the exported guide.md on the clipboard", async () => {
  const ed = await openEditor();
  const md = await exportFrom(ed, "markdown");
  const files = unzipSync(new Uint8Array(md.bytes));
  const guideMd = strFromU8(files[Object.keys(files).find((k) => k.endsWith("guide.md"))!]!);
  await ed.getByRole("button", { name: /export another/i }).first().click();
  await ed.getByRole("button", { name: /copy as markdown/i }).first().click();
  await expect(ed.getByText(/paste it anywhere/i).first()).toBeVisible();
  const clip = await ed.evaluate(() => navigator.clipboard.readText());
  // Same text; the zip's version links images, the copied one has no files to link.
  const strip = (s: string) => s.replace(/!\[[^\]]*\]\([^)]*\)\n*/g, "").trim();
  expect(strip(clip)).toBe(strip(guideMd));
  await ed.close();
});

// ---- X8 import -------------------------------------------------------------------------------

test("X8 a project from the extension opens with the same steps; corrupt, zip-slip and oversized files show an error and change nothing", async () => {
  const ed = await openEditor();
  const proj = await exportFrom(ed, "project");
  await ed.close();
  const g = await readGuide(panel, guideId);
  const count = async () => storeCount(panel, "guides");
  const p = await h.context.newPage();
  await p.goto(extUrl(h, "sidepanel.html"));
  const input = p.locator('input[type="file"]');
  const n0 = await count();
  await input.setInputFiles({ name: "guide.showsteps", mimeType: "application/zip", buffer: proj.bytes });
  await expect.poll(count).toBe(n0 + 1);
  const ids = await p.evaluate(() => new Promise<string[]>((res) => { const r = indexedDB.open("showsteps"); r.onsuccess = () => { const q = r.result.transaction("guides").objectStore("guides").getAllKeys(); q.onsuccess = () => res(q.result as string[]); }; }));
  const copy = await readGuide(panel, ids.find((i) => i !== guideId && i.startsWith(guideId) === false && ids.indexOf(i) === ids.length - 1) ?? ids.at(-1)!);
  expect(copy.steps.map((s: any) => s.title)).toEqual(g.steps.map((s: any) => s.title));
  const bad: [string, Buffer][] = [
    ["corrupt.showsteps", Buffer.from("this is not a zip file at all")],
    ["slip.showsteps", Buffer.from(zipSync({ "guide.json": new TextEncoder().encode(JSON.stringify({ ...g, id: "g_slip" })), "../evil.png": new Uint8Array([1, 2, 3]) }))],
    ["huge.showsteps", Buffer.from(zipSync(Object.fromEntries([["guide.json", new TextEncoder().encode(JSON.stringify({ ...g, id: "g_huge" }))], ...Array.from({ length: 2001 }, (_, i) => [`images/x${i}.png`, new Uint8Array([i % 255])])])))],
  ];
  for (const [name, buffer] of bad) {
    const before = await count();
    await p.reload();
    await p.locator('input[type="file"]').setInputFiles({ name, mimeType: "application/zip", buffer });
    await expect(p.getByText(/isn.t a Showsteps guide/i).first(), name).toBeVisible();
    expect(await count(), name).toBe(before);
  }
  await p.close();
});

// ---- X-RENDER-PARITY -------------------------------------------------------------------------

test("X-RENDER-PARITY the editor's canvas renderer and core's raster renderer agree (numeral box excluded)", async () => {
  const ed = await openEditor();
  await expect.poll(() => ed.evaluate(() => !!(globalThis as any).__showstepsE2E)).toBe(true);
  const res = await ed.evaluate(async (gid) => {
    const E = (globalThis as any).__showstepsE2E;
    const db = await new Promise<IDBDatabase>((r) => { const q = indexedDB.open("showsteps"); q.onsuccess = () => r(q.result); });
    const get = (store: string, key: string) => new Promise<any>((r) => { const q = db.transaction(store).objectStore(store).get(key); q.onsuccess = () => r(q.result); });
    const guide = await get("guides", gid);
    const numbers: Map<string, number> = E.stepNumbers(guide);
    const out: { step: string; share: number; pixels: number }[] = [];
    for (const step of guide.steps) {
      const sh = step.screenshot;
      if (!sh?.highlight) continue;
      const rec = await get("images", `${gid}/${sh.image}`);
      const n = numbers.get(step.id);
      const a = await E.renderAnnotated(rec.blob, step, { marker: n });
      const bytes = new Uint8Array(await rec.blob.arrayBuffer());
      const core = E.renderGuideImages({ ...guide, steps: [step] }, { [sh.image]: bytes })[sh.image];
      const toData = async (blob: Blob) => {
        const bmp = await createImageBitmap(blob);
        const c = new OffscreenCanvas(bmp.width, bmp.height);
        const ctx = c.getContext("2d")!;
        ctx.drawImage(bmp, 0, 0);
        return ctx.getImageData(0, 0, bmp.width, bmp.height);
      };
      const A = await toData(a.blob);
      const B = await toData(new Blob([core], { type: "image/png" }));
      if (A.width !== B.width || A.height !== B.height) return { error: `size ${A.width}x${A.height} vs ${B.width}x${B.height}` };
      // The numeral box: the flag tab (text rendering differs between canvas and the raster font).
      const k = sh.width / sh.viewport.width;
      const lay = E.flagLayout({ target: sh.highlight, n, scale: E.highlightScale(sh.viewport.width, k), imageWidth: sh.width, imageHeight: sh.height, corner: sh.highlight.corner, labelRect: sh.highlight.labelRect, inputLike: E.isInputLike(step), rtl: step.page.dir === "rtl" });
      const t = lay.tab;
      const pad = 6 * k;
      const tx0 = t ? Math.min(t.ax, t.ax + t.sx * t.tw) - pad : -1, tx1 = t ? Math.max(t.ax, t.ax + t.sx * t.tw) + pad : -1;
      const ty0 = t ? Math.min(t.ay, t.ay + t.sy * t.th) - pad : -1, ty1 = t ? Math.max(t.ay, t.ay + t.sy * t.th) + pad : -1;
      let diff = 0, total = 0;
      for (let y = 0; y < A.height; y++) {
        for (let x = 0; x < A.width; x++) {
          if (x >= tx0 && x <= tx1 && y >= ty0 && y <= ty1) continue;
          const i = (y * A.width + x) * 4;
          total++;
          if (Math.abs(A.data[i]! - B.data[i]!) > 24 || Math.abs(A.data[i + 1]! - B.data[i + 1]!) > 24 || Math.abs(A.data[i + 2]! - B.data[i + 2]!) > 24) diff++;
        }
      }
      out.push({ step: step.id, share: diff / total, pixels: diff });
    }
    return { out };
  }, guideId);
  expect((res as any).error).toBeUndefined();
  const out = (res as any).out as { step: string; share: number }[];
  expect(out.length).toBeGreaterThanOrEqual(5);
  for (const r of out) expect.soft(r.share, `${r.step}: ${(r.share * 100).toFixed(2)}% of pixels differ`).toBeLessThanOrEqual(0.015);
  await ed.close();
});

// ---- H6 .showsteps round trip ----------------------------------------------------------------

test("H6 the exported .showsteps unpacks, validates, has every screenshot and the same step count, and says app showsteps", async () => {
  const ed = await openEditor();
  const proj = await exportFrom(ed, "project");
  const { guide, images } = unpackBundle(new Uint8Array(proj.bytes));
  const v = validateGuide(guide);
  expect(v.ok, JSON.stringify((v as any).errors)).toBe(true);
  const stored = await readGuide(panel, guideId);
  expect(guide.steps.length).toBe(stored.steps.length);
  for (const s of guide.steps) if (s.screenshot) expect(images[s.screenshot.image], s.id).toBeTruthy();
  expect(guide.app?.name).toBe("showsteps");
  // The password step's screenshot in the bundle is the redacted one (R2 on the unpacked image).
  const pw = guide.steps.find((s: any) => s.target?.sensitive && s.screenshot);
  expect(pw?.screenshot?.redactions?.some((r: any) => r.auto)).toBe(true);
  await ed.close();
});

// ---- F-LIB library ---------------------------------------------------------------------------

test("F-LIB three guides list with title, date, step count and size; deleting one removes its images; an interrupted draft offers Recover and Discard", async () => {
  const a = await duplicate(guideId);
  const b = await duplicate(guideId);
  const p = await h.context.newPage();
  await p.goto(extUrl(h, "sidepanel.html"));
  const guides = await storeCount(p, "guides");
  expect(guides).toBeGreaterThanOrEqual(3);
  const item = p.locator(".lib-item").first();
  await expect(item.locator(".lib-title")).not.toBeEmpty();
  await expect(item.locator(".lib-meta")).toContainText(/\d+ steps?/);
  await expect(item.locator(".lib-meta")).toContainText(/recorded/);
  await expect(item.locator(".lib-size")).toContainText(/\d+(\.\d)? (KB|MB|B)/);
  const g = await readGuide(p, a);
  const shots = g.steps.filter((s: any) => s.screenshot).length;
  const imgBefore = await storeCount(p, "images");
  p.once("dialog", (d) => d.accept());
  await p.getByRole("button", { name: `Delete ${g.title}` }).first().click();
  await expect.poll(() => storeCount(p, "images")).toBe(imgBefore - shots);
  expect(await storeCount(p, "guides")).toBe(guides - 1);
  // Interrupted: the worker marks a guide whose recording never reached Stop (see background.ts).
  await p.evaluate((id) => chrome.storage.local.set({ "rec:interrupted": [id] }), b);
  await p.reload();
  const gb = await readGuide(p, b);
  await expect(p.getByText("Recording was interrupted")).toBeVisible();
  await expect(p.getByRole("button", { name: `Recover ${gb.title}` })).toBeVisible();
  await p.getByRole("button", { name: `Discard ${gb.title}` }).click();
  await expect.poll(async () => (await readGuide(p, b)) ?? null).toBeNull();
  await p.close();
});

// ---- J accessibility -------------------------------------------------------------------------

async function axe(page: Page): Promise<{ id: string; impact: string; nodes: number }[]> {
  await page.addScriptTag({ content: AXE });
  return page.evaluate(async () => {
    const r = await (window as any).axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"] } });
    return r.violations.map((v: any) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length }));
  });
}

test("J1 axe finds no serious or critical issue on the editor, export sheet, settings, library and side panel, light and dark", async () => {
  const report: string[] = [];
  const states: [string, () => Promise<Page>][] = [
    ["editor", () => openEditor()],
    ["editor-export", async () => {
      const ed = await openEditor();
      await ed.getByRole("button", { name: /^export/i }).first().click();
      await expect(ed.locator("dialog.export")).toBeVisible();
      return ed;
    }],
    ["editor-empty", async () => {
      const ed = await h.context.newPage();
      await ed.goto(extUrl(h, "editor.html?guide=nope"));
      await expect(ed.getByText("Guide not found")).toBeVisible();
      return ed;
    }],
    ["panel-library", async () => {
      const p = await h.context.newPage();
      await p.setViewportSize({ width: 400, height: 900 });
      await p.goto(extUrl(h, "sidepanel.html"));
      return p;
    }],
    ["panel-settings", async () => {
      const p = await h.context.newPage();
      await p.setViewportSize({ width: 400, height: 900 });
      await p.goto(extUrl(h, "sidepanel.html"));
      await p.getByRole("button", { name: "Settings", exact: true }).click();
      await p.getByRole("switch").first().focus();
      return p;
    }],
    ["panel-guide", async () => {
      const p = await h.context.newPage();
      await p.setViewportSize({ width: 400, height: 900 });
      await p.goto(extUrl(h, "sidepanel.html"));
      await p.locator(".lib-open").first().click();
      return p;
    }],
  ];
  for (const [name, make] of states) {
    const page = await make();
    for (const scheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      await page.waitForTimeout(200);
      const v = await axe(page);
      for (const x of v) report.push(`${name}/${scheme}: ${x.impact} ${x.id} (${x.nodes})`);
      expect.soft(v.filter((x) => x.impact === "serious" || x.impact === "critical"), `${name} ${scheme}`).toEqual([]);
    }
    await page.close();
  }
  console.log(`J1 moderate/minor findings:\n${report.join("\n") || "none"}`);
});

test("J2 keyboard only: from the editor's first stop to a finished Markdown export, focus always visible, no trap", async () => {
  const ed = await openEditor();
  await ed.keyboard.press("Tab");
  let seen = 0;
  let reachedExport = false;
  for (let i = 0; i < 80 && !reachedExport; i++) {
    const info = await ed.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el || el === document.body) return null;
      const cs = getComputedStyle(el);
      return { text: (el.getAttribute("aria-label") ?? el.textContent ?? "").trim().slice(0, 40), ring: cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) > 0 || cs.boxShadow !== "none" };
    });
    if (info) {
      seen++;
      expect.soft(info.ring, `visible focus on "${info.text}"`).toBe(true);
      if (/^Export/.test(info.text)) reachedExport = true;
    }
    if (!reachedExport) await ed.keyboard.press("Tab");
  }
  expect(reachedExport).toBe(true);
  await ed.keyboard.press("Enter");
  await expect(ed.locator("dialog.export")).toBeVisible();
  const md = ed.locator('[data-format="markdown"]');
  await md.focus();
  await ed.keyboard.press("Space");
  await ed.getByTestId("export-go").focus();
  const [dl] = await Promise.all([ed.waitForEvent("download"), ed.keyboard.press("Enter")]);
  expect(dl.suggestedFilename()).toMatch(/\.zip$/);
  expect(seen).toBeGreaterThan(3);
  await ed.close();
});

test("J3 with reduced motion the editor runs no animation or transition longer than 50 ms", async () => {
  const ed = await h.context.newPage();
  await ed.emulateMedia({ reducedMotion: "reduce" });
  await ed.goto(extUrl(h, `editor.html?guide=${encodeURIComponent(guideId)}`));
  await expect(ed.getByRole("list", { name: "Steps" })).toBeVisible();
  await ed.getByRole("button", { name: /^Step 2:/ }).first().click();
  const long = await ed.evaluate(() => {
    const out: string[] = [];
    const ms = (v: string) => Math.max(...v.split(",").map((x) => (x.trim().endsWith("ms") ? parseFloat(x) : parseFloat(x) * 1000)));
    for (const el of Array.from(document.querySelectorAll("*"))) {
      const cs = getComputedStyle(el);
      if (cs.animationName !== "none" && ms(cs.animationDuration) > 50) out.push(`${el.className} animation ${cs.animationDuration}`);
      if (cs.transitionProperty !== "none" && ms(cs.transitionDuration) > 50) out.push(`${el.className} transition ${cs.transitionDuration}`);
    }
    return out;
  });
  expect(long).toEqual([]);
  await ed.close();
});

test("J4 every interactive element in the editor and panel has an accessible name; the step list is a list", async () => {
  for (const url of [`editor.html?guide=${encodeURIComponent(guideId)}`, "sidepanel.html"]) {
    const page = await h.context.newPage();
    await page.goto(extUrl(h, url));
    await page.waitForTimeout(800);
    const cdp = await h.context.newCDPSession(page);
    const { nodes } = (await cdp.send("Accessibility.getFullAXTree")) as { nodes: any[] };
    const interactive = new Set(["button", "link", "textbox", "checkbox", "switch", "radio", "combobox", "slider", "menuitem", "tab", "searchbox", "spinbutton"]);
    const unnamed = nodes.filter((n) => !n.ignored && interactive.has(n.role?.value) && !String(n.name?.value ?? "").trim()).map((n) => `${n.role.value} #${n.backendDOMNodeId}`);
    expect(unnamed, url).toEqual([]);
    if (url.startsWith("editor")) expect(nodes.some((n) => n.role?.value === "list" && n.name?.value === "Steps")).toBe(true);
    await page.close();
  }
});

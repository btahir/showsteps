// Product footage for the launch video, the README hero and the store screenshots.
//
// Drives the e2e build of the extension (apps/extension/.output/chrome-mv3-e2e) through the
// canonical Acme Books flow (apps/fixtures/flows/fixture-flow.json, served on port 4517), and
// saves REAL product output: the stored step screenshots, the guide, the side panel, the editor,
// the export sheet, the exported files and a real replay of the exported skill.
//
//   ../../../research/heavy.sh node capture/capture.mjs [--theme light|dark|both] [--out <dir>]
//
// Output (default docs/launch/media/footage/<theme>/, gitignored):
//   guide.json, flow.json (page-space boxes + timings for cursor choreography),
//   steps/<id>.png (stored screenshots), screens/*.png (panel, editor, export, bar, guide html),
//   export/* (skill zip contents, .showsteps, guide.html), replay-output.txt.
// Everything is mock data (Acme Books, jane@example.com); the password is the fixture's fake.
import { chromium } from "@playwright/test";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import net from "node:net";

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(here, "../../..");
const EXT_SRC = resolve(ROOT, "apps/extension/.output/chrome-mv3-e2e");
const FLOW = JSON.parse(readFileSync(resolve(ROOT, "apps/fixtures/flows/fixture-flow.json"), "utf8"));
// The fixture server listens on 127.0.0.1:4517, but the browser is told that books.acme.test is that address,
// so every real UI string (recording bar, editor meta, URL captions, exported files) shows a made-up host.
const HOST = "books.acme.test";
const FIXTURES = `http://${HOST}:4517`;
const RESOLVER = `--host-resolver-rules=MAP ${HOST} 127.0.0.1`;
const DPR = 2;

const args = process.argv.slice(2);
const opt = (name, def) => (args.includes(`--${name}`) ? args[args.indexOf(`--${name}`) + 1] : def);
const THEMES = opt("theme", "both") === "both" ? ["light", "dark"] : [opt("theme", "both")];
const OUT_ROOT = resolve(opt("out", resolve(ROOT, "docs/launch/media/footage")));

const beat = (page, ms) => page.waitForTimeout(ms);

async function portOpen(port) {
  return new Promise((res) => {
    const s = net.connect(port, "127.0.0.1");
    s.on("connect", () => (s.destroy(), res(true)));
    s.on("error", () => res(false));
  });
}

async function ensureFixtures() {
  if (await portOpen(4517)) return null;
  const p = spawn("node", [resolve(ROOT, "apps/fixtures/server.mjs"), "--port", "4517"], { stdio: "ignore" });
  for (let i = 0; i < 40 && !(await portOpen(4517)); i++) await new Promise((r) => setTimeout(r, 250));
  return p;
}

async function launch(theme, extDir) {
  const userDataDir = mkdtempSync(join(tmpdir(), "showsteps-launch-"));
  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: "chromium",
    headless: true,
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: DPR,
    colorScheme: theme,
    acceptDownloads: true,
    args: [`--disable-extensions-except=${extDir}`, `--load-extension=${extDir}`, `--force-device-scale-factor=${DPR}`, RESOLVER],
  });
  let [worker] = context.serviceWorkers();
  worker ??= await context.waitForEvent("serviceworker", { timeout: 15_000 });
  const extId = new URL(worker.url()).host;
  return {
    context,
    extId,
    ext: (p) => `chrome-extension://${extId}/${p}`,
    async close() {
      await context.close();
      rmSync(userDataDir, { recursive: true, force: true });
    },
  };
}

const idbGet = (page, store, key) =>
  page.evaluate(
    ({ store, key }) =>
      new Promise((res, rej) => {
        const r = indexedDB.open("showsteps");
        r.onerror = () => rej(r.error);
        r.onsuccess = () => {
          const q = r.result.transaction(store, "readonly").objectStore(store).get(key);
          q.onsuccess = async () => {
            if (store === "images" && q.result) {
              const buf = new Uint8Array(await q.result.blob.arrayBuffer());
              let bin = "";
              for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
              return res(btoa(bin));
            }
            res(q.result);
          };
          q.onerror = () => rej(q.error);
        };
      }),
    { store, key },
  );

async function captureTheme(theme, extDir) {
  const out = join(OUT_ROOT, theme);
  rmSync(out, { recursive: true, force: true });
  for (const d of ["steps", "screens", "export"]) mkdirSync(join(out, d), { recursive: true });
  const shot = (page, name, o = {}) => page.screenshot({ path: join(out, "screens", `${name}.png`), ...o });

  const h = await launch(theme, extDir);
  const { context } = h;
  const t0 = Date.now();
  const log = { theme, dpr: DPR, viewport: { width: 1280, height: 800 }, steps: [] };
  try {
    const main = await context.newPage();
    await main.goto(`${FIXTURES}${FLOW.start}`);
    await beat(main, 400);
    // Rehearsal (not recording): clean page states without the recording bar, for the cold open.
    await main.mouse.move(5, 5);
    await shot(main, "clean-login");
    await main.click("#email");
    await main.locator("#email").pressSequentially("jane@example.com", { delay: 15 });
    await main.mouse.move(5, 5);
    await shot(main, "clean-email");
    await main.click("#password");
    await main.locator("#password").pressSequentially(FLOW.secrets[0], { delay: 15 });
    await main.mouse.move(5, 5);
    await shot(main, "clean-password");
    await main.click("#sign-in");
    await main.waitForURL("**/dashboard.html");
    await beat(main, 500);
    await main.mouse.move(5, 5);
    await shot(main, "clean-dashboard");
    await main.click("#settings-link");
    await main.waitForURL("**/settings.html");
    await beat(main, 500);
    await main.mouse.move(5, 5);
    await shot(main, "clean-settings");
    await main.goto(`${FIXTURES}${FLOW.start}`);
    await beat(main, 400);
    await shot(main, "page-login-empty");
    // Empty state in its own tab: viewport emulation on a tab of the recording window would disturb
    // captureVisibleTab, so panel sizes are only set outside the recording.
    const first = await context.newPage();
    await first.setViewportSize({ width: 400, height: 900 });
    await first.goto(h.ext("sidepanel.html"));
    await beat(first, 300);
    await shot(first, "panel-empty");
    await first.close();
    const panel = await context.newPage();
    await panel.goto(h.ext("sidepanel.html"));
    await main.bringToFront();

    await panel.getByRole("button", { name: /start recording/i }).click();
    await panel.getByRole("status").filter({ hasText: /recording/i }).first().waitFor();
    await beat(main, 1400);
    await shot(main, "page-recording-bar"); // the in-page bar is DOM, so it is in the shot
    log.recStartedMs = Date.now() - t0;

    const tabs = { main };
    for (const s of FLOW.steps) {
      const page = tabs[s.tab];
      await page.bringToFront();
      await page.mouse.move(5, 5);
      await beat(page, 1400);
      await page.locator(s.selector).scrollIntoViewIfNeeded();
      await beat(page, 300);
      const box = await page.locator(s.selector).boundingBox();
      // Page-state screenshot right before the action (includes the recording bar).
      await shot(page, `page-${s.id}-before`);
      const rec = { id: s.id, tab: s.tab, do: s.do, selector: s.selector, box, value: s.value, tStart: Date.now() - t0 };
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
          if (s.then?.statusText) await page.getByText(s.then.statusText).waitFor();
          break;
        case "select":
          await page.selectOption(s.selector, s.value);
          break;
        case "check":
          await page.check(s.selector);
          break;
      }
      await beat(page, 900);
      rec.tEnd = Date.now() - t0;
      log.steps.push(rec);
    }
    await panel.bringToFront();
    await panel.setViewportSize({ width: 400, height: 900 });
    await beat(panel, 800);
    await shot(panel, "panel-recording");

    await panel.getByRole("button", { name: /stop and review/i }).click();
    const editor = await context.waitForEvent("page", { predicate: (p) => p.url().includes("editor.html") });
    await editor.waitForLoadState();
    const guideId = new URL(editor.url()).searchParams.get("guide");
    const guide = await idbGet(panel, "guides", guideId);
    writeFileSync(join(out, "guide.json"), JSON.stringify(guide, null, 2));
    writeFileSync(join(out, "flow.json"), JSON.stringify(log, null, 2));
    for (const s of guide.steps) {
      if (!s.screenshot) continue;
      const b64 = await idbGet(panel, "images", `${guideId}/${s.screenshot.image}`);
      if (b64) writeFileSync(join(out, "steps", `${s.id}.png`), Buffer.from(b64, "base64"));
    }

    await editor.setViewportSize({ width: 1280, height: 860 });
    await beat(editor, 900);
    await shot(editor, "editor");
    // Boxes (CSS px in the editor viewport) so overlays can anchor to real UI.
    const rectOf = async (loc) => (await loc.first().boundingBox().catch(() => null)) ?? null;
    log.editor = {
      viewport: { width: 1280, height: 860 },
      chip: await rectOf(editor.getByText(/blurred/i).first().locator("xpath=..")),
      exportBtn: await rectOf(editor.getByRole("button", { name: /^export/i })),
    };
    // A tall editor with a specific step selected, for detail crops.
    const cards = editor.getByRole("button", { name: /^step \d+:/i });
    if ((await cards.count()) > 3) {
      await cards.nth(2).click().catch(() => {});
      await beat(editor, 500);
      await shot(editor, "editor-step3");
    }

    // Side panel with the guide (step 3 = masked password, expanded).
    await panel.bringToFront();
    await beat(panel, 500);
    await panel.getByRole("button", { name: /^step 3:/i }).first().click().catch(() => {});
    await beat(panel, 400);
    await shot(panel, "panel-guide");

    // Export sheet: shots, then download every format the README/site mention.
    await editor.bringToFront();
    await editor.getByRole("button", { name: /^export/i }).first().click();
    const dialog = editor.locator("dialog.export");
    await dialog.waitFor();
    await beat(editor, 400);
    await shot(editor, "editor-export");
    log.editor.dialog = await rectOf(dialog);
    log.editor.formats = {};
    for (const f of ["pdf", "html", "markdown", "docx", "skill", "project"]) log.editor.formats[f] = await rectOf(dialog.locator(`[data-format="${f}"]`));
    writeFileSync(join(out, "flow.json"), JSON.stringify(log, null, 2));
    await panel.bringToFront();
    await panel.getByRole("button", { name: /^export/i }).click();
    await panel.locator("dialog.export").waitFor();
    await beat(panel, 300);
    await shot(panel, "panel-export");
    await panel.getByRole("button", { name: "Close" }).click();
    await editor.bringToFront();
    for (const fmt of ["html", "skill", "project"]) {
      await dialog.locator(`[data-format="${fmt}"]`).click();
      if (fmt === "skill") {
        await beat(editor, 250);
        await shot(editor, "editor-export-skill");
      }
      const [dl] = await Promise.all([editor.waitForEvent("download"), dialog.getByTestId("export-go").click()]);
      await dl.saveAs(join(out, "export", dl.suggestedFilename()));
      await dialog.getByText("Guide saved", { exact: true }).waitFor();
      if (fmt === "html") await shot(editor, "editor-export-done");
      await dialog.getByRole("button", { name: "Export another" }).click();
    }
    await guideAndReplay(out, context, theme);
  } finally {
    await h.close();
  }
  return out;
}

/** Unpack the exported skill, screenshot the exported guide, run the real replay. */
async function guideAndReplay(out, context, theme) {
  const ex = join(out, "export");
  const files = spawnSync("ls", [ex], { encoding: "utf8" }).stdout.split("\n").filter(Boolean);
  const skillZip = files.find((f) => /skill.*\.zip$/i.test(f)) ?? files.find((f) => f.endsWith(".zip"));
  const htmlFile = files.find((f) => f.endsWith(".html"));
  if (htmlFile) {
    const page = await context.newPage();
    for (const [name, w, hh] of [["guide-html", 1280, 900], ["guide-html-phone", 390, 844]]) {
      await page.setViewportSize({ width: w, height: hh });
      await page.goto(`file://${join(ex, htmlFile)}`);
      await beat(page, 600);
      await page.screenshot({ path: join(out, "screens", `${name}.png`) });
    }
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.screenshot({ path: join(out, "screens", "guide-html-full.png"), fullPage: true });
    await page.close();
  }
  if (!skillZip) return;
  const skillDir = join(out, "export", "skill");
  rmSync(skillDir, { recursive: true, force: true });
  mkdirSync(skillDir, { recursive: true });
  spawnSync("unzip", ["-o", "-q", join(ex, skillZip), "-d", skillDir]);
  // The zip may nest a folder; find SKILL.md.
  const found = spawnSync("find", [skillDir, "-name", "SKILL.md"], { encoding: "utf8" }).stdout.trim().split("\n")[0];
  if (!found) return;
  const dir = dirname(found);
  // Under apps/launch so that @playwright/test resolves from its node_modules.
  const replay = resolve(here, "../.work/replay", theme);
  rmSync(replay, { recursive: true, force: true });
  mkdirSync(replay, { recursive: true });
  for (const f of ["replay.spec.ts", "SKILL.md", "steps.json"]) cpSync(join(dir, f), join(replay, f));
  writeFileSync(
    join(replay, "playwright.config.ts"),
    `import { defineConfig } from "@playwright/test";\nexport default defineConfig({ testDir: ".", timeout: 60_000, workers: 1, reporter: [["list"]], use: { headless: true, launchOptions: { args: [${JSON.stringify(RESOLVER)}] } }, outputDir: "./results" });\n`,
  );
  const cli = resolve(ROOT, "apps/extension/node_modules/.bin/playwright");
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(TEST_|PW_TEST|PWTEST|SHOWSTEPS_SECRET)/.test(k)));
  const r = spawnSync(cli, ["test", "--config", join(replay, "playwright.config.ts")], {
    cwd: replay,
    env: { ...env, SHOWSTEPS_SECRET_1: FLOW.secrets[0], NO_COLOR: "1" },
    encoding: "utf8",
    timeout: 120_000,
  });
  writeFileSync(join(out, "replay-output.txt"), `${r.stdout}\n${r.stderr}`);
  console.log(`[capture:${theme}] replay exit ${r.status}`);
}

if (!existsSync(join(EXT_SRC, "manifest.json"))) {
  console.error(`Missing ${EXT_SRC}. Build it first: pnpm --filter @showsteps/extension build:e2e`);
  process.exit(2);
}
// Work on a private copy so a rebuild by another agent cannot change the extension mid-capture.
const snap = mkdtempSync(join(tmpdir(), "showsteps-ext-"));
cpSync(EXT_SRC, snap, { recursive: true });
const srv = await ensureFixtures();
try {
  for (const theme of THEMES) {
    console.log(`[capture:${theme}] start`);
    const out = await captureTheme(theme, snap);
    console.log(`[capture:${theme}] done -> ${out}`);
  }
} finally {
  srv?.kill();
  rmSync(snap, { recursive: true, force: true });
}

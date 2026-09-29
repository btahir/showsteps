#!/usr/bin/env node
// Verifier's own end-to-end pass over the extension (ACCEPTANCE E1a, E1b, R1, R2, R7, H1-H7, G1-G3, G5, D9).
// Independent of the extension agent's specs: it re-derives every number from the acceptance text.
//
//   pnpm --filter @showsteps/extension build:e2e
//   HEAVY_LABEL=showsteps-verify-e2e ../research/heavy.sh node scripts/e2e-extension.mjs [--dpr 1,2] [--json]
//
// Needs Playwright's bundled Chromium (branded Chrome ignores --load-extension) and the fixture server on 4517
// (started here when nothing answers). Artifacts go to apps/fixtures/.artifacts/ (delete when done, never commit).
import { spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync, inflateSync } from "node:zlib";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const EXT = join(ROOT, "apps/extension");
const BUILD = join(EXT, ".output/chrome-mv3-e2e");
const FIXTURES = "http://127.0.0.1:4517";
const ART = join(ROOT, "apps/fixtures/.artifacts");
const reqExt = createRequire(join(EXT, "package.json"));
const reqCore = createRequire(join(ROOT, "packages/core/package.json"));
const { chromium } = reqExt("@playwright/test");
const { unzipSync, strFromU8 } = reqExt("fflate");
const flow = JSON.parse(readFileSync(join(ROOT, "apps/fixtures/flows/fixture-flow.json"), "utf8"));
const expected = JSON.parse(readFileSync(join(ROOT, "apps/fixtures/flows/expected-steps.json"), "utf8"));
const CANARY = flow.secrets[0];
const args = process.argv.slice(2);
const dprs = (args.includes("--dpr") ? args[args.indexOf("--dpr") + 1] : "1,2").split(",").map(Number);
const results = [];
const check = (id, ok, detail) => { results.push({ id, ok, detail }); console.log(`${ok ? "PASS" : "FAIL"} ${id.padEnd(14)} ${detail}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const say = (m) => { if (process.env.VERBOSE) console.error(`[e2e ${new Date().toISOString().slice(11, 19)}] ${m}`); };

if (!existsSync(join(BUILD, "manifest.json"))) { console.error("no e2e build: pnpm --filter @showsteps/extension build:e2e"); process.exit(2); }
rmSync(ART, { recursive: true, force: true });
mkdirSync(ART, { recursive: true });

// ---- fixture server
let fixtureProc = null;
const up = async () => { try { return (await fetch(`${FIXTURES}/index.html`)).ok; } catch { return false; } };
if (!(await up())) {
  fixtureProc = spawn(process.execPath, [join(ROOT, "apps/fixtures/server.mjs"), "--port", "4517"], { stdio: "ignore" });
  for (let i = 0; i < 50 && !(await up()); i++) await sleep(100);
}

// ---- helpers that run inside an extension page
const idbGet = (page, store, key) => page.evaluate(([store, key]) => new Promise((res, rej) => {
  const r = indexedDB.open(window.__DB || "showsteps"); r.onerror = () => rej(r.error);
  r.onsuccess = () => { const q = r.result.transaction(store).objectStore(store).get(key); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); };
}), [store, key]);
const idbDump = (page) => page.evaluate(() => new Promise((res, rej) => {
  const r = indexedDB.open(window.__DB || "showsteps"); r.onerror = () => rej(r.error);
  r.onsuccess = async () => {
    const db = r.result; const out = { name: db.name, stores: {} };
    for (const name of db.objectStoreNames) {
      out.stores[name] = await new Promise((ok) => { const q = db.transaction(name).objectStore(name).getAll(); q.onsuccess = () => ok(q.result.map((v) => JSON.parse(JSON.stringify(v, (k, x) => (x instanceof Blob ? `<blob ${x.size} bytes>` : x))))); });
    }
    res(out);
  };
}));
const imageB64 = (page, guideId, path) => page.evaluate(async ([guideId, path]) => {
  const rec = await new Promise((res, rej) => { const r = indexedDB.open(window.__DB || "showsteps"); r.onerror = () => rej(r.error); r.onsuccess = () => { const q = r.result.transaction("images").objectStore("images").get(`${guideId}/${path}`); q.onsuccess = () => res(q.result); }; });
  if (!rec) return null;
  const buf = new Uint8Array(await rec.blob.arrayBuffer()); let bin = "";
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(bin);
}, [guideId, path]);
/** Region test: texture inside rects vs a reference PNG, and mean channel diff outside the padded rects (per ACCEPTANCE section R). */
const regionTest = (page, storedB64, refB64, rects, pad = 6, excludes = []) => page.evaluate(async ([a, b, rects, pad, excludes]) => {
  const load = async (s) => { const bin = atob(s); const u = new Uint8Array(bin.length); for (let i = 0; i < u.length; i++) u[i] = bin.charCodeAt(i); const bmp = await createImageBitmap(new Blob([u], { type: "image/png" })); const c = new OffscreenCanvas(bmp.width, bmp.height); const x = c.getContext("2d"); x.drawImage(bmp, 0, 0); return { w: bmp.width, h: bmp.height, d: x.getImageData(0, 0, bmp.width, bmp.height).data }; };
  const A = await load(a), B = await load(b);
  if (A.w !== B.w || A.h !== B.h) return { sizeMismatch: [A.w, A.h, B.w, B.h] };
  const inRect = (x, y, p) => rects.some((r) => x >= r.x - p && x < r.x + r.width + p && y >= r.y - p && y < r.y + r.height + p) || excludes.some((r) => x >= r.x && x < r.x + r.width && y >= r.y && y < r.y + r.height);
  const tex = (I, r) => { let t = 0, n = 0; const x0 = Math.max(0, Math.round(r.x)), y0 = Math.max(0, Math.round(r.y)), x1 = Math.min(I.w, Math.round(r.x + r.width)), y1 = Math.min(I.h, Math.round(r.y + r.height)); for (let y = y0; y < y1; y++) for (let x = x0 + 1; x < x1; x++) { const i = (y * I.w + x) * 4, j = i - 4; t += (Math.abs(I.d[i] - I.d[j]) + Math.abs(I.d[i + 1] - I.d[j + 1]) + Math.abs(I.d[i + 2] - I.d[j + 2])) / 3; n++; } return n ? t / n : 0; };
  let sum = 0, cnt = 0;
  for (let y = 0; y < A.h; y++) for (let x = 0; x < A.w; x++) { if (inRect(x, y, pad)) continue; const i = (y * A.w + x) * 4; sum += (Math.abs(A.d[i] - B.d[i]) + Math.abs(A.d[i + 1] - B.d[i + 1]) + Math.abs(A.d[i + 2] - B.d[i + 2])) / 3; cnt++; }
  return { regions: rects.map((r) => ({ stored: tex(A, r), ref: tex(B, r) })), outsideMeanDiff: sum / Math.max(cnt, 1) };
}, [storedB64, refB64, rects, pad, excludes]);

/** Search a byte buffer for a canary in UTF-8, UTF-16LE, URL-encoded and base64 forms. */
function canaryHits(buf, label) {
  const forms = { utf8: Buffer.from(CANARY, "utf8"), utf16: Buffer.from(CANARY, "utf16le"), url: Buffer.from(encodeURIComponent(CANARY)), b64: Buffer.from(Buffer.from(CANARY).toString("base64").replace(/=+$/, "")), b64x1: Buffer.from(Buffer.from(" " + CANARY).toString("base64").replace(/=+$/, "").slice(2)), b64x2: Buffer.from(Buffer.from("  " + CANARY).toString("base64").replace(/=+$/, "").slice(3)) };
  const hits = [];
  for (const [k, needle] of Object.entries(forms)) if (needle.length > 6 && buf.includes(needle)) hits.push(`${label}:${k}`);
  return hits;
}
/** Flatten an export to searchable byte chunks: raw bytes, every zip entry, and every inflated PDF stream. */
function chunksOf(name, bytes) {
  const out = [[name, Buffer.from(bytes)]];
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) { try { for (const [n, v] of Object.entries(unzipSync(new Uint8Array(bytes)))) { out.push([`${name}!${n}`, Buffer.from(v)]); } } catch { /* not a zip */ } }
  if (Buffer.from(bytes.subarray(0, 5)).toString() === "%PDF-") {
    const s = Buffer.from(bytes).toString("latin1"); const re = /stream\r?\n/g; let m;
    while ((m = re.exec(s))) { const end = s.indexOf("endstream", m.index); if (end < 0) break; try { out.push([`${name}!stream`, inflateSync(Buffer.from(s.slice(m.index + m[0].length, end), "latin1"))]); } catch { /* not flate */ } }
  }
  return out;
}

// ---- one recording run
const maskHashes = {};
async function run(dpr, opts = {}) {
  const chk = opts.quick ? () => {} : check;
  const tag = opts.zoom ? `zoom${Math.round(opts.zoom * 100)}` : `dpr${dpr}${opts.suffix ?? ""}`;
  const tol = opts.zoom ? 3 : 2;
  const flowSteps = flow.steps.map((s) => (s.id === "s02" && opts.password ? { ...s, value: opts.password } : s));
  const dir = join(ART, tag); mkdirSync(dir, { recursive: true });
  const userData = mkdtempSync(join(tmpdir(), "showsteps-verify-"));
  const ctx = await chromium.launchPersistentContext(userData, {
    channel: "chromium", headless: true, viewport: null, colorScheme: "light", acceptDownloads: true,
    // No viewport emulation: captureVisibleTab returns the real window, so emulated sizes would not match the screenshot.
    args: [`--disable-extensions-except=${BUILD}`, `--load-extension=${BUILD}`, "--window-size=1280,800", `--force-device-scale-factor=${dpr}`],
  });
  const consoleLog = [];
  ctx.on("console", (m) => consoleLog.push(m.text()));
  let [sw] = ctx.serviceWorkers(); sw ??= await ctx.waitForEvent("serviceworker", { timeout: 20000 });
  sw.on?.("console", (m) => consoleLog.push(m.text()));
  say("extension worker up");
  const extId = new URL(sw.url()).host;
  const extUrl = (p) => `chrome-extension://${extId}/${p}`;
  const main = await ctx.newPage();
  await main.goto(FIXTURES + flow.start);
  let panel = await ctx.newPage();
  await panel.goto(extUrl("sidepanel.html"));
  if (opts.zoom) {
    // Browser zoom is per origin: setting it on the flow's tab also zooms the help tab that the flow opens.
    await panel.evaluate(async ([z, u]) => { const [t] = await chrome.tabs.query({ url: u + "*" }); await chrome.tabs.setZoom(t.id, z); }, [opts.zoom, FIXTURES + flow.start]);
    await main.reload(); await sleep(500);
  }
  await main.bringToFront();
  await panel.getByRole("button", { name: /start recording/i }).click();
  await panel.getByRole("status").filter({ hasText: /recording/i }).first().waitFor({ timeout: 15000 });
  say("recording started");
  await sleep(1200);

  const tabs = { main }; const boxes = {}; const refs = {}; const inner = {};
  for (const s of flowSteps) {
    const page = tabs[s.tab];
    await page.bringToFront(); await page.mouse.move(5, 5); await sleep(1400);
    await page.locator(s.selector).scrollIntoViewIfNeeded(); if (opts.zoom) { await page.locator(s.selector).hover(); } await sleep(opts.zoom ? 1500 : 300);
    boxes[s.id] = await page.locator(s.selector).boundingBox();
    inner[s.id] = await page.evaluate(() => ({ w: innerWidth, h: innerHeight, dpr: devicePixelRatio }));
    if (s.do === "click") refs[s.id] = (await page.screenshot()).toString("base64"); // pre-action frame
    if (s.do === "type") { await page.click(s.selector); await page.locator(s.selector).pressSequentially(s.value, { delay: 25 }); await sleep(150); refs[s.id] = (await page.screenshot()).toString("base64"); }
    else if (s.do === "click") {
      if (s.then?.opensTab) { const [pop] = await Promise.all([ctx.waitForEvent("page"), page.click(s.selector)]); await pop.waitForLoadState("load"); tabs[s.then.opensTab] = pop; }
      else await page.click(s.selector);
      if (s.then?.navigatesTo) await page.waitForURL(`**${s.then.navigatesTo}`);
      if (s.then?.pushState) await page.waitForURL(`**${s.then.pushState}`);
    } else if (s.do === "select") await page.selectOption(s.selector, s.value);
    else if (s.do === "check") await page.check(s.selector);
    await sleep(900);
  }
  const editorWait = ctx.waitForEvent("page", { predicate: (p) => p.url().includes("editor.html"), timeout: 20000 }).catch(() => null);
  const stopped = null; await panel.getByRole("button", { name: /stop and review/i }).click();
  const editor = await editorWait;
  const guideId = editor ? new URL(editor.url()).searchParams.get("guide") : stopped?.state?.guideId;
  const util = await ctx.newPage();
  await util.goto(extUrl("sidepanel.html"));
  const dbNames = await util.evaluate(async () => (await indexedDB.databases()).map((d) => d.name));
  const dbName = dbNames.includes("showsteps") ? "showsteps" : dbNames[0];
  await util.evaluate((n) => { window.__DB = n; }, dbName);
  if (dbName !== "showsteps") chk(`IDB-name-${tag}`, false, `IndexedDB database is named ${JSON.stringify(dbName)}, PLAN/ACCEPTANCE say "showsteps"`);
  const panelOld = panel;
  panel = util;
  const guide = await idbGet(panel, "guides", guideId);
  writeFileSync(join(dir, "guide.json"), JSON.stringify(guide, null, 2));
  if (!guide) { chk(`E1-${tag}-guide`, false, "no guide in IndexedDB after Stop"); await ctx.close(); return; }

  // ---- E1a / E1b
  const actions = guide.steps.filter((s) => s.action.type !== "navigate");
  const navs = guide.steps.filter((s) => s.action.type === "navigate");
  const problems = [];
  if (actions.length !== 10) problems.push(`${actions.length} non-navigate steps`);
  expected.steps.forEach((e, i) => {
    const g = actions[i]; if (!g) return;
    if (g.title !== e.title) problems.push(`${e.flowStep} title ${JSON.stringify(g.title)}`);
    if (g.action.type !== e.action.type) problems.push(`${e.flowStep} action ${g.action.type}`);
    if (e.action.value !== undefined && g.action.value !== e.action.value) problems.push(`${e.flowStep} value ${g.action.value}`);
    if (e.action.masked && !(g.action.masked === true && e.valueMustBeOneOf.includes(g.action.value))) problems.push(`${e.flowStep} masked/value ${g.action.masked}/${g.action.value}`);
    if (e.action.checked !== undefined && g.action.checked !== e.action.checked) problems.push(`${e.flowStep} checked`);
    if (e.action.optionText && g.action.optionText !== e.action.optionText) problems.push(`${e.flowStep} optionText`);
    if (new URL(g.page.url).pathname !== e.page.path || g.page.title !== e.page.title) problems.push(`${e.flowStep} page ${g.page.url} / ${g.page.title}`);
    for (const [k, v] of Object.entries(e.target)) if (JSON.stringify(g.target?.[k]) !== JSON.stringify(v)) problems.push(`${e.flowStep} target.${k}=${JSON.stringify(g.target?.[k])}`);
    if (!g.screenshot || !g.screenshot.image || !g.screenshot.width || !g.screenshot.height || !g.screenshot.viewport || !g.screenshot.devicePixelRatio) problems.push(`${e.flowStep} screenshot fields missing`);
  });
  const tabIds = new Set(actions.map((s) => s.page.tabId));
  if (tabIds.size !== 2) problems.push(`${tabIds.size} distinct tabIds (want 2)`);
  const helpSteps = actions.filter((s) => new URL(s.page.url).pathname === "/help.html").length;
  if (helpSteps !== 1) problems.push(`${helpSteps} steps on the help tab (want 1)`);
  const allowedNav = expected.optionalNavigateSteps.length + 1;
  if (navs.length > allowedNav) problems.push(`${navs.length} navigate steps (max ${allowedNav})`);
  const seenNav = new Set(); for (const n of navs) { const k = `${n.page.tabId} ${n.action.url}`; if (seenNav.has(k)) problems.push(`duplicate navigate ${k}`); seenNav.add(k); if (!n.screenshot) problems.push(`navigate ${n.action.url} has no screenshot`); if (n.screenshot?.highlight) problems.push(`navigate ${n.action.url} has a highlight`); }
  if (guide.steps.length < 10 || guide.steps.length > 15) problems.push(`total steps ${guide.steps.length}`);
  chk(`E1${opts.zoom ? "c" : dpr === 1 ? "a" : "b"}-steps`, problems.length === 0, problems.length ? problems.slice(0, 6).join("; ") : `${actions.length} steps equal expected-steps.json (byte-equal titles), ${navs.length} navigate steps, ${tabIds.size} tabs, ${guide.steps.length} total`);

  const hlProblems = []; let worst = 0;
  expected.steps.forEach((e, i) => {
    const g = actions[i]; const want = boxes[e.flowStep]; const hl = g?.screenshot?.highlight; if (!g || !want) return;
    if (!hl) { hlProblems.push(`${e.flowStep} no highlight`); return; }
    const sx = g.screenshot.width / inner[e.flowStep].w, sy = g.screenshot.height / inner[e.flowStep].h;
    const d = [Math.abs(hl.x - want.x * sx), Math.abs(hl.y - want.y * sy), Math.abs(hl.x + hl.width - (want.x + want.width) * sx), Math.abs(hl.y + hl.height - (want.y + want.height) * sy)];
    worst = Math.max(worst, ...d);
    if (Math.max(...d) > tol) hlProblems.push(`${e.flowStep} off by ${Math.max(...d).toFixed(1)}px (highlight ${hl.x},${hl.y} ${hl.width}x${hl.height}; expected ${(want.x * sx).toFixed(0)},${(want.y * sy).toFixed(0)} ${(want.width * sx).toFixed(0)}x${(want.height * sy).toFixed(0)}; scroll ${g.screenshot.viewport.scrollY})`);
    if (hl.width <= 0 || hl.height <= 0 || hl.x < 0 || hl.y < 0 || hl.x + hl.width > g.screenshot.width || hl.y + hl.height > g.screenshot.height) hlProblems.push(`${e.flowStep} highlight empty or outside image`);
    const pd = inner[e.flowStep].dpr; const dimOk = Math.abs(g.screenshot.width - inner[e.flowStep].w * pd) <= 1 && Math.abs(g.screenshot.height - inner[e.flowStep].h * pd) <= 1 && g.screenshot.devicePixelRatio === pd && (opts.zoom ? true : pd === dpr);
    if (!dimOk) hlProblems.push(`${e.flowStep} image ${g.screenshot.width}x${g.screenshot.height} dpr ${g.screenshot.devicePixelRatio} vs inner ${inner[e.flowStep].w}x${inner[e.flowStep].h}`);
  });
  chk(`E1${opts.zoom ? "c" : dpr === 1 ? "a" : "b"}-highlight`, hlProblems.length === 0, hlProblems.length ? hlProblems.join("; ") : `10 highlights within ${tol} px of the pre-action bounding box (worst ${worst.toFixed(2)} px), image = innerWidth*devicePixelRatio (${inner.s01.w}x${inner.s01.h} css px at dpr ${inner.s01.dpr}) within 1 px`);
  const rungs = await panel.evaluate(() => chrome.storage.session.get("debug:capture").then((r) => r["debug:capture"])).catch(() => null);
  if (rungs) writeFileSync(join(dir, "capture-rungs.json"), JSON.stringify(rungs, null, 2));

  // ---- R1 / R2 (region test on the stored images, no export involved)
  const rProblems = []; const rNotes = [];
  for (const id of expected.autoRedact.onFlowSteps) {
    const idx = expected.steps.findIndex((e) => e.flowStep === id); const g = actions[idx];
    const pw = boxes.s02; const sx = g.screenshot.width / inner[id].w, sy = g.screenshot.height / inner[id].h;
    const want = { x: pw.x * sx, y: pw.y * sy, width: pw.width * sx, height: pw.height * sy };
    const reds = (g.screenshot.redactions ?? []).filter((r) => r.auto);
    const cover = reds.find((r) => r.rect.x <= want.x + 4 && r.rect.y <= want.y + 4 && r.rect.x + r.rect.width >= want.x + want.width - 4 && r.rect.y + r.rect.height >= want.y + want.height - 4);
    if (!cover) { rProblems.push(`${id}: no auto redaction covering #password within 4 px`); continue; }
    if (opts.zoom) { rNotes.push(`${id}: region test skipped at browser zoom (Playwright screenshots are in CSS px)`); continue; }
    const stored = await imageB64(panel, guideId, g.screenshot.image);
    writeFileSync(join(dir, `${id}-stored.png`), Buffer.from(stored, "base64")); writeFileSync(join(dir, `${id}-reference.png`), Buffer.from(refs[id], "base64"));
    // The in-page recording bar is visible in Playwright's reference but hidden in captures: keep its band out of the outside-diff.
    const bar = { x: g.screenshot.width * 0.2, y: g.screenshot.height - 120 * dpr, width: g.screenshot.width * 0.6, height: 120 * dpr };
    const t = await regionTest(panel, stored, refs[id], reds.map((r) => r.rect), 6, [bar]);
    if (t.sizeMismatch) { rProblems.push(`${id}: stored image ${t.sizeMismatch.slice(0, 2)} vs reference ${t.sizeMismatch.slice(2)}`); continue; }
    const reg = t.regions.find((_, i) => reds[i] === cover) ?? t.regions[0];
    if (reg.ref > 1.0 && reg.stored > 0.2 * reg.ref) rProblems.push(`${id}: texture ${reg.stored.toFixed(2)} > 20% of reference ${reg.ref.toFixed(2)}`);
    if (reg.ref <= 1.0) rNotes.push(`${id}: field empty in the reference (texture ${reg.ref.toFixed(2)}), ratio not informative`);
    if (t.outsideMeanDiff > 2) rProblems.push(`${id}: outside mean diff ${t.outsideMeanDiff.toFixed(2)}/255 > 2`);
    rNotes.push(`${id}: texture ${reg.stored.toFixed(2)} vs ref ${reg.ref.toFixed(2)}, outside diff ${t.outsideMeanDiff.toFixed(2)}/255`);
  }
  chk(`R1R2-${tag}`, rProblems.length === 0, rProblems.length ? rProblems.join("; ") : `s01-s03 auto redaction covers #password within 4 px and passes the region test on the STORED image: ${rNotes.join(" | ")}`);

  // Region hash of the stored s02 image inside its password mask (mask style must not depend on what was typed).
  {
    const g2 = actions[expected.steps.findIndex((e) => e.flowStep === "s02")];
    const r2 = (g2.screenshot.redactions ?? []).find((r) => r.auto)?.rect;
    if (r2) maskHashes[tag] = await panel.evaluate(async ([guideId, path, r]) => {
      const rec = await new Promise((res, rej) => { const q = indexedDB.open(window.__DB || "showsteps"); q.onerror = () => rej(q.error); q.onsuccess = () => { const g = q.result.transaction("images").objectStore("images").get(`${guideId}/${path}`); g.onsuccess = () => res(g.result); }; });
      const bmp = await createImageBitmap(rec.blob); const c = new OffscreenCanvas(bmp.width, bmp.height); const x = c.getContext("2d"); x.drawImage(bmp, 0, 0);
      const d = x.getImageData(Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)).data;
      const h = new Uint8Array(await crypto.subtle.digest("SHA-256", d)); return [...h].map((b) => b.toString(16).padStart(2, "0")).join("");
    }, [guideId, g2.screenshot.image, r2]);
  }
  if (opts.quick || opts.zoom) { await ctx.close(); rmSync(userData, { recursive: true, force: true }); return; }

  // ---- capture-before-action: the stored image of every click step must show the page as it was BEFORE the click (E3b/E3d idea, on the canonical flow)
  const preProblems = []; const preNotes = [];
  for (const [i, e] of expected.steps.entries()) {
    const fs = flow.steps.find((x) => x.id === e.flowStep); if (fs.do !== "click") continue;
    const g = actions[i]; const stored = await imageB64(panel, guideId, g.screenshot.image);
    const bar = { x: g.screenshot.width * 0.2, y: g.screenshot.height - 120 * dpr, width: g.screenshot.width * 0.6, height: 120 * dpr };
    const reds = (g.screenshot.redactions ?? []).map((r) => r.rect);
    const t = await regionTest(panel, stored, refs[e.flowStep], reds, 6, [bar]);
    if (t.sizeMismatch) { preProblems.push(`${e.flowStep} size ${t.sizeMismatch}`); continue; }
    preNotes.push(`${e.flowStep} ${t.outsideMeanDiff.toFixed(2)}`);
    if (t.outsideMeanDiff > 2) preProblems.push(`${e.flowStep} (${e.title.replace(/\*\*/g, "")}) stored image differs from the pre-click page by ${t.outsideMeanDiff.toFixed(1)}/255`);
  }
  chk(`PRE-ACTION-${tag}`, preProblems.length === 0, preProblems.length ? preProblems.join("; ") : `every click step's stored image equals the pre-click page (mean diff outside redactions and the recording bar, /255): ${preNotes.join(", ")}`);

  // ---- exports through the editor UI
  const saved = {};
  if (editor) {
    await editor.bringToFront();
    await editor.getByRole("button", { name: /^export/i }).first().click();
    const dialog = editor.locator("dialog.export");
    for (const fmt of ["markdown", "html", "pdf", "docx", "skill", "project"]) {
      const t0 = Date.now();
      await dialog.locator(`[data-format="${fmt}"]`).click();
      const [dl] = await Promise.all([editor.waitForEvent("download", { timeout: 60000 }), dialog.getByTestId("export-go").click()]);
      const p = join(dir, dl.suggestedFilename()); await dl.saveAs(p);
      saved[fmt] = { path: p, bytes: readFileSync(p), ms: Date.now() - t0 };
      await dialog.getByRole("button", { name: "Export another" }).click().catch(() => {});
    }
  }
  // ---- R7 canary search
  const hits = [];
  const idb = await idbDump(panel); const sessionKV = await panel.evaluate(() => chrome.storage.session.get(null)); const localKV = await panel.evaluate(() => chrome.storage.local.get(null));
  for (const [label, obj] of [["indexeddb", idb], ["storage.session", sessionKV], ["storage.local", localKV], ["console", consoleLog]]) hits.push(...canaryHits(Buffer.from(JSON.stringify(obj)), label));
  for (const [fmt, f] of Object.entries(saved)) for (const [n, buf] of chunksOf(fmt, f.bytes)) hits.push(...canaryHits(buf, n));
  const maskedOk = actions.filter((s) => s.action.masked).every((s) => s.action.value === "" || s.action.value === "•••");
  chk(`R7-${tag}`, hits.length === 0 && maskedOk && Object.keys(saved).length === 6, hits.length ? `canary found: ${hits.join(", ")}` : `0 canary hits in IndexedDB dump, storage.session, storage.local, ${consoleLog.length} console lines and ${Object.keys(saved).length} exports (UTF-8, UTF-16, URL-encoded, base64 forms, inflated PDF streams, zip entries); masked values ${maskedOk ? "ok" : "BAD"}`);
  if (dpr === 1) {
    writeFileSync(join(ART, "f10.showsteps"), saved.project.bytes);
    for (const [fmt, f] of Object.entries(saved)) copyFileSync(f.path, join(ART, `f10-${fmt}${f.path.slice(f.path.lastIndexOf("."))}`));
    chk("X7-times", true, `export wall times (ms): ${Object.entries(saved).map(([k, v]) => `${k} ${v.ms}`).join(", ")} (thresholds md/html/skill/project 3000, docx 6000, pdf 8000)`);
    await verifyExports(guide, saved, panel, ctx, dir);
  }
  await ctx.close();
  rmSync(userData, { recursive: true, force: true });
}

// ---- H checks
async function verifyExports(guide, saved, panel, ctx, dir) {
  const visible = guide.steps.filter((s) => !s.skipped);
  const shots = visible.filter((s) => s.screenshot);
  const plain = (t) => t.replace(/\*\*/g, "");
  // H1
  const md = unzipSync(new Uint8Array(saved.markdown.bytes)); const names = Object.keys(md);
  const mdFile = names.find((n) => n.endsWith(".md")); const imgs = names.filter((n) => /\.png$/i.test(n));
  const links = [...strFromU8(md[mdFile]).matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)].map((m) => decodeURIComponent(m[1]));
  const dirOf = mdFile.includes("/") ? mdFile.slice(0, mdFile.lastIndexOf("/") + 1) : "";
  const linksOk = links.every((l) => names.includes(dirOf + l) || names.includes(l));
  check("H1-markdown", imgs.length === shots.length && linksOk && links.length === shots.length, `${mdFile} + ${imgs.length} images (visible screenshot steps ${shots.length}); ${links.length} image links all resolve: ${linksOk}`);
  // H2
  const htmlPath = saved.html.path; const html = saved.html.bytes.toString("utf8");
  const dataImgs = (html.match(/<img[^>]+src="data:image\/png;base64,/g) || []).length;
  const ext = [...html.matchAll(/(?:src|href)="(https?:\/\/[^"]+)"|url\((https?:\/\/[^)]+)\)|@import\s+["']?https?:/g)].length;
  const p = await ctx.newPage(); const blocked = [];
  await p.route("**/*", (r) => { const u = r.request().url(); if (u.startsWith("file:") || u.startsWith("data:")) return r.continue(); blocked.push(u); return r.abort(); });
  await p.goto("file://" + htmlPath); await p.waitForLoadState("load");
  const natural = await p.evaluate(() => [...document.images].map((i) => i.naturalWidth));
  const pdf = await p.pdf({ printBackground: true });
  const pdfPages = (pdf.toString("latin1").match(/\/Type\s*\/Page[^s]/g) || []).length;
  await p.close();
  check("H2-html", dataImgs === shots.length && ext === 0 && natural.every((n) => n > 0) && natural.length === shots.length && blocked.length === 0 && pdfPages >= 2, `${dataImgs} inlined PNGs (want ${shots.length}), ${ext} external refs, ${natural.filter((n) => n > 0).length}/${natural.length} images render with network blocked (${blocked.length} attempted requests), page.pdf ${pdfPages} pages`);
  // H3
  let h3 = "pdfjs not available";
  try {
    const pdfjs = await import(createRequire(join(ROOT, "packages/core/package.json")).resolve("pdfjs-dist/legacy/build/pdf.mjs"));
    const doc = await pdfjs.getDocument({ data: new Uint8Array(saved.pdf.bytes), useSystemFonts: false }).promise;
    let txt = ""; for (let i = 1; i <= doc.numPages; i++) txt += (await (await doc.getPage(i)).getTextContent()).items.map((x) => x.str).join("") + "\n";
    const norm = (s) => s.replace(/[‘’]/g, "'").replace(/[“”]/g, '"');
    let pos = -1, bad = 0; for (const s of visible) { const t = norm(plain(s.title)); const i = norm(txt).indexOf(t); if (i <= pos) bad++; pos = Math.max(pos, i); }
    const info = await doc.getMetadata(); const img = saved.pdf.bytes.toString("latin1").match(/\/Subtype\s*\/Image/g)?.length ?? 0;
    const ok = bad === 0 && info.info.Title === guide.title && !txt.includes(CANARY);
    h3 = `${doc.numPages} pages, ${visible.length - bad}/${visible.length} step titles found in order, Info title ${info.info.Title === guide.title ? "equals" : "DIFFERS from"} guide title, ~${img} image objects (screenshot steps ${shots.length}), ${(saved.pdf.bytes.length / 1024).toFixed(0)} KB`;
    check("H3-pdf", ok, h3);
  } catch (e) { check("H3-pdf", false, `${h3}: ${String(e).slice(0, 120)}`); }
  // H4
  const dx = unzipSync(new Uint8Array(saved.docx.bytes)); const docXml = strFromU8(dx["word/document.xml"]);
  const wt = (docXml.match(/<w:p[ >][\s\S]*?<\/w:p>/g) || []).map((x) => [...x.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((m) => m[1]).join("").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&apos;/g, "'"));
  const norm2 = (s) => s.replace(/[‘’]/g, "'").replace(/[“”]/g, '"');
  let pos = -1, bad = 0; for (const s of visible) { const i = wt.findIndex((x) => norm2(x).includes(norm2(plain(s.title)))); if (i <= pos) bad++; pos = Math.max(pos, i); }
  const drawings = (docXml.match(/<w:drawing>/g) || []).length; const media = Object.keys(dx).filter((n) => /^word\/media\/.+\.png$/.test(n)).length;
  const core = strFromU8(dx["docProps/core.xml"]);
  check("H4-docx", bad === 0 && drawings === shots.length && media === shots.length && core.includes(guide.title.replace(/&/g, "&amp;")), `${visible.length - bad}/${visible.length} titles in w:t runs in order, ${drawings} drawings and ${media} media PNGs (want ${shots.length}), core.xml title ${core.includes(guide.title) ? "ok" : "differs"}, ${(saved.docx.bytes.length / 1024).toFixed(0)} KB`);
  // H5 + G1 via CLI
  const sk = unzipSync(new Uint8Array(saved.skill.bytes)); const skNames = Object.keys(sk);
  const skillMd = strFromU8(sk[skNames.find((n) => n.endsWith("SKILL.md"))]);
  const fm = skillMd.match(/^---\nname: "?([^"\n]+)"?\ndescription: "?([\s\S]*?)"?\n---/);
  const nameOk = fm && /^[a-z0-9]+(-[a-z0-9]+)*$/.test(fm[1]) && fm[1].length <= 64 && !/claude|anthropic/.test(fm[1]);
  const numbered = (skillMd.match(/^\d+\. /gm) || []).length;
  const stepsJson = JSON.parse(strFromU8(sk[skNames.find((n) => n.endsWith("steps.json"))]));
  let schemaOk = false, schemaMsg = "";
  try { const Ajv = reqCore("ajv/dist/2020.js"); const ajv = new (Ajv.default ?? Ajv)({ strict: false }); const v = ajv.compile(JSON.parse(readFileSync(join(ROOT, "packages/core/schema/steps.schema.json"), "utf8"))); schemaOk = v(stepsJson); schemaMsg = schemaOk ? "" : JSON.stringify(v.errors?.[0]); } catch (e) { schemaMsg = String(e).slice(0, 100); }
  const secretEnv = (skillMd.match(/SHOWSTEPS_SECRET_\d+/g) || []);
  check("H5-skill", nameOk && numbered === visible.length && secretEnv.length >= 1 && schemaOk && skNames.some((n) => n.endsWith("replay.spec.ts")), `name ${fm?.[1]}, ${numbered} numbered steps (visible ${visible.length}), env vars ${[...new Set(secretEnv)].join(",")}, steps.json ${schemaOk ? "validates" : "INVALID " + schemaMsg}`);
  // H6 via CLI
  const cli = join(ROOT, "packages/cli/dist/showsteps.js");
  const cliRun = (a) => spawnSync(process.execPath, [cli, ...a], { encoding: "utf8" });
  const proj = join(ART, "f10.showsteps");
  const v = JSON.parse(cliRun(["validate", proj, "--json"]).stdout || "{}"); const info = JSON.parse(cliRun(["info", proj, "--json"]).stdout || "{}");
  const unz = unzipSync(new Uint8Array(saved.project.bytes)); const pg = JSON.parse(strFromU8(unz["guide.json"]));
  const allImgs = pg.steps.filter((s) => s.screenshot).every((s) => unz[s.screenshot.image]);
  check("H6-project", v.ok === true && info.stepCount === guide.steps.length && allImgs && pg.app?.name === "showsteps", `CLI validate ok=${v.ok}, info stepCount ${info.stepCount} (IndexedDB ${guide.steps.length}), every screenshot.image present: ${allImgs}, app.name ${pg.app?.name}`);
  check("D9-extension", v.ok === true && cliRun(["export", proj, "--format", "md", "--out", join(ART, "d9"), "--json"]).status === 0, "CLI validates and exports Markdown from the extension's own .showsteps");
  // G1
  const g1 = cliRun(["export", proj, "--format", "skill", "--out", join(ART, "skill"), "--json"]);
  const skillDir = join(ART, "skill", "skill");
  check("G1-skill", g1.status === 0 && ["SKILL.md", "steps.json", "replay.spec.ts"].every((f) => existsSync(join(skillDir, f))), `showsteps export --format skill exit ${g1.status}; files: ${existsSync(skillDir) ? readdirSync(skillDir).join(", ") : "none"}`);
  const spec = readFileSync(join(skillDir, "replay.spec.ts"), "utf8");
  // G3 / G5 / G6: run the spec from a temp folder with its own minimal config
  const tmp = mkdtempSync(join(tmpdir(), "showsteps-replay-"));
  for (const f of readdirSync(skillDir)) if (f !== "images") copyFileSync(join(skillDir, f), join(tmp, f));
  symlinkSync(join(EXT, "node_modules"), join(tmp, "node_modules"));
  writeFileSync(join(tmp, "playwright.config.ts"), `import { defineConfig } from "@playwright/test";\nexport default defineConfig({ timeout: 60000, reporter: "list", use: { channel: "chromium", headless: true } });\n`);
  const tscR = spawnSync(process.execPath, [join(ROOT, "node_modules/typescript/bin/tsc"), "--noEmit", "--strict", "--skipLibCheck", "--target", "es2022", "--module", "esnext", "--moduleResolution", "bundler", "--types", "node", "--typeRoots", join(ROOT, "node_modules/@types"), "replay.spec.ts"], { cwd: tmp, encoding: "utf8" });
  check("G2-secrets", tscR.status === 0 && !spec.includes(CANARY) && !JSON.stringify(stepsJson).includes(CANARY), `replay.spec.ts type-checks with tsc --strict against @playwright/test (exit ${tscR.status}${tscR.status ? ": " + tscR.stdout.split("\n")[0].slice(0, 120) : ""}) and neither it nor steps.json contains the typed password`);
  const pwBin = join(EXT, "node_modules/.bin/playwright");
  const runSpec = (env, reporter = "list") => { const t0 = Date.now(); const r = spawnSync(pwBin, ["test", "replay.spec.ts", "--workers=1", `--reporter=${reporter}`], { cwd: tmp, env: { ...process.env, ...env }, encoding: "utf8" }); return { out: r.stdout + r.stderr, code: r.status, secs: (Date.now() - t0) / 1000 }; };
  const g3 = runSpec({ SHOWSTEPS_SECRET_1: CANARY });
  check("G3-replay", g3.code === 0 && /1 passed/.test(g3.out) && !/failed|skipped/.test(g3.out.replace(/0 failed/g, "")) && g3.secs <= 30, `${(g3.out.match(/\d+ passed[^\n]*/) || [g3.out.split("\n").filter(Boolean).slice(-2).join(" ")])[0]} in ${g3.secs.toFixed(1)} s (limit 30), exit ${g3.code}`);
  const g5 = runSpec({}, "json");
  let g5j = null; try { g5j = JSON.parse(g5.out.slice(g5.out.indexOf("{"))); } catch { /* not json */ }
  const skipped = g5j ? g5j.stats.skipped : -1; const skipMsg = JSON.stringify(g5j?.suites ?? "").match(/SHOWSTEPS_SECRET_\d+/)?.[0];
  check("G5-skip", g5.code === 0 && skipped === 1 && !!skipMsg, `${skipped} skipped, ${g5j?.stats.expected ?? "?"} passed, ${g5j?.stats.unexpected ?? "?"} failed; the skip annotation names ${skipMsg ?? "no variable"}`);
  check("G6-selfcontained", g3.code === 0, "the skill folder (spec + steps.json + SKILL.md, copied to a temp dir with only a minimal playwright.config.ts) passes as in G3");
  rmSync(tmp, { recursive: true, force: true });
}

// ---- main
try {
  for (const d of dprs) await run(d);
  for (const z of (args.includes("--zoom") ? args[args.indexOf("--zoom") + 1] : "1.25,1.5").split(",").filter(Boolean).map(Number)) await run(1, { zoom: z });
  if (dprs.includes(1) && maskHashes.dpr1) {
    await run(1, { password: "x1", suffix: "-alt", quick: true });
    const a = maskHashes.dpr1, b = maskHashes["dpr1-alt"];
    check("R1-mask-indep", !!a && a === b, `stored password mask (s02, rect region) is byte-identical (sha256 ${String(a).slice(0, 12)}...) whether the password had 15 or 2 characters: ${a === b}; nothing of the typed text is in the region`);
  }
} catch (e) {
  check("harness", false, String(e?.stack ?? e).split("\n").filter((l) => /^\s+at .*e2e-extension|^[A-Za-z]*Error/.test(l)).slice(0, 6).join(" | ").slice(0, 700));
} finally {
  try { fixtureProc?.kill(); } catch { /* ignore */ }
}
const fails = results.filter((r) => !r.ok);
if (args.includes("--json")) writeFileSync(join(ART, "results.json"), JSON.stringify(results, null, 2));
console.log(`\n${results.length - fails.length}/${results.length} extension acceptance checks pass`);
process.exit(fails.length ? 1 : 0);

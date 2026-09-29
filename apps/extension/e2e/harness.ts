// Launches Chromium with the unpacked extension and exposes the pieces tests need.
import { chromium } from "@playwright/test";
import type { BrowserContext, Page, Worker } from "@playwright/test";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
export const EXT_DIR = resolve(here, "../.output/chrome-mv3-e2e");
export const ARTIFACTS = resolve(here, ".artifacts");
export const FIXTURES = "http://127.0.0.1:4517";

export interface Harness {
  context: BrowserContext;
  worker: Worker;
  extId: string;
  close(): Promise<void>;
}

export async function launch(opts: { colorScheme?: "light" | "dark" } = {}): Promise<Harness> {
  if (!existsSync(join(EXT_DIR, "manifest.json"))) throw new Error(`Build the e2e extension first: pnpm build:e2e (missing ${EXT_DIR})`);
  const userDataDir = mkdtempSync(join(tmpdir(), "showsteps-e2e-"));
  const channel = process.env.SHOWSTEPS_E2E_CHANNEL ?? "chromium";
  const context = await chromium.launchPersistentContext(userDataDir, {
    channel,
    headless: process.env.HEADED ? false : true,
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1,
    colorScheme: opts.colorScheme ?? "light",
    acceptDownloads: true,
    args: [`--disable-extensions-except=${EXT_DIR}`, `--load-extension=${EXT_DIR}`],
  });
  let [worker] = context.serviceWorkers();
  worker ??= await context.waitForEvent("serviceworker", { timeout: 15_000 });
  const extId = new URL(worker.url()).host;
  return {
    context,
    worker,
    extId,
    async close() {
      await context.close();
      rmSync(userDataDir, { recursive: true, force: true });
    },
  };
}

export function extUrl(h: Harness, path: string): string {
  return `chrome-extension://${h.extId}/${path.replace(/^\//, "")}`;
}

/** Read one guide straight from the extension's IndexedDB (via an extension page). */
export async function readGuide(page: Page, guideId: string): Promise<any> {
  return page.evaluate(
    (id) =>
      new Promise((res, rej) => {
        const r = indexedDB.open("stepsnap");
        r.onerror = () => rej(r.error);
        r.onsuccess = () => {
          const tx = r.result.transaction("guides", "readonly");
          const q = tx.objectStore("guides").get(id);
          q.onsuccess = () => res(q.result);
          q.onerror = () => rej(q.error);
        };
      }),
    guideId,
  );
}

/** Stored screenshot bytes (base64) for a step image. */
export async function readImage(page: Page, guideId: string, path: string): Promise<string | undefined> {
  return page.evaluate(
    ({ id, p }) =>
      new Promise<string | undefined>((res, rej) => {
        const r = indexedDB.open("stepsnap");
        r.onerror = () => rej(r.error);
        r.onsuccess = () => {
          const q = r.result.transaction("images", "readonly").objectStore("images").get(`${id}/${p}`);
          q.onsuccess = async () => {
            if (!q.result) return res(undefined);
            const buf = new Uint8Array(await (q.result.blob as Blob).arrayBuffer());
            let bin = "";
            for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
            res(btoa(bin));
          };
          q.onerror = () => rej(q.error);
        };
      }),
    { id: guideId, p: path },
  );
}

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

export async function launch(opts: { colorScheme?: "light" | "dark"; deviceScaleFactor?: number } = {}): Promise<Harness> {
  if (!existsSync(join(EXT_DIR, "manifest.json"))) throw new Error(`Build the e2e extension first: pnpm build:e2e (missing ${EXT_DIR})`);
  const userDataDir = mkdtempSync(join(tmpdir(), "showsteps-e2e-"));
  const channel = process.env.SHOWSTEPS_E2E_CHANNEL ?? "chromium";
  const context = await chromium.launchPersistentContext(userDataDir, {
    channel,
    headless: process.env.HEADED ? false : true,
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: opts.deviceScaleFactor ?? 1,
    colorScheme: opts.colorScheme ?? "light",
    acceptDownloads: true,
    // Emulated deviceScaleFactor alone changes devicePixelRatio but not the pixels captureVisibleTab
    // returns; a real 2x screen needs the browser itself at scale 2.
    args: [
      `--disable-extensions-except=${EXT_DIR}`,
      `--load-extension=${EXT_DIR}`,
      ...(opts.deviceScaleFactor && opts.deviceScaleFactor !== 1 ? [`--force-device-scale-factor=${opts.deviceScaleFactor}`] : []),
    ],
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

/** Send a control message to the worker from an extension page (same path as the panel buttons). */
export async function ctl(extPage: Page, msg: Record<string, unknown>): Promise<any> {
  return extPage.evaluate(async (m) => {
    if (m.type === "ctl:start" && m.windowId === undefined) m.windowId = (await chrome.windows.getCurrent()).id;
    return chrome.runtime.sendMessage(m);
  }, msg);
}

export interface RegionStats {
  /** Mean absolute difference between horizontal neighbours (texture; low = blurred). */
  texture: number;
  /** Share of pixels close to the recording bar's ink (#1F1C19). */
  ink: number;
  /** Share of pixels close to the recording dot (#FF5A3F). */
  dot: number;
}

/**
 * Pixel statistics for rects (image px) of a stored screenshot or of a base64 PNG, computed in
 * an extension page with OffscreenCanvas (no image library needed in Node).
 */
export async function regionStats(extPage: Page, src: { guideId: string; path: string } | { png: string }, rects: { x: number; y: number; width: number; height: number }[]): Promise<RegionStats[]> {
  return extPage.evaluate(
    async ({ src, rects }) => {
      let blob: Blob;
      if ("png" in src) {
        const bin = atob(src.png);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        blob = new Blob([bytes], { type: "image/png" });
      } else {
        blob = await new Promise<Blob>((res, rej) => {
          const r = indexedDB.open("stepsnap");
          r.onerror = () => rej(r.error);
          r.onsuccess = () => {
            const q = r.result.transaction("images").objectStore("images").get(`${src.guideId}/${src.path}`);
            q.onsuccess = () => (q.result ? res(q.result.blob) : rej(new Error("no image")));
          };
        });
      }
      const bmp = await createImageBitmap(blob);
      const c = new OffscreenCanvas(bmp.width, bmp.height);
      const ctx = c.getContext("2d")!;
      ctx.drawImage(bmp, 0, 0);
      return rects.map((r) => {
        const x = Math.max(0, Math.round(r.x));
        const y = Math.max(0, Math.round(r.y));
        const w = Math.max(1, Math.min(bmp.width - x, Math.round(r.width)));
        const h = Math.max(1, Math.min(bmp.height - y, Math.round(r.height)));
        const d = ctx.getImageData(x, y, w, h).data;
        let tex = 0;
        let n = 0;
        let ink = 0;
        let dot = 0;
        for (let yy = 0; yy < h; yy++) {
          for (let xx = 0; xx < w; xx++) {
            const i = (yy * w + xx) * 4;
            const [R, G, B] = [d[i]!, d[i + 1]!, d[i + 2]!];
            if (Math.abs(R - 31) + Math.abs(G - 28) + Math.abs(B - 25) < 30) ink++;
            if (Math.abs(R - 255) + Math.abs(G - 90) + Math.abs(B - 63) < 40) dot++;
            if (xx > 0) {
              const j = i - 4;
              tex += (Math.abs(R - d[j]!) + Math.abs(G - d[j + 1]!) + Math.abs(B - d[j + 2]!)) / 3;
              n++;
            }
          }
        }
        return { texture: n ? tex / n : 0, ink: ink / (w * h), dot: dot / (w * h) };
      });
    },
    { src, rects },
  );
}

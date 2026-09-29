// IndexedDB storage: guides (schema JSON) and their screenshots (Blobs).
// Shared by the service worker and every extension page (same origin, same database).

import { openDB } from "idb";
import type { DBSchema, IDBPDatabase } from "idb";
import type { Guide, Rect } from "@stepsnap/core";

export interface ImageRecord {
  key: string; // `${guideId}/${path}`
  guideId: string;
  path: string; // e.g. images/s_ab12.png
  blob: Blob;
  /** Highlight as first recorded, so the editor can switch it back on after hiding it. */
  highlight?: Rect;
}

interface StepsnapDB extends DBSchema {
  guides: { key: string; value: Guide; indexes: { updatedAt: string } };
  images: { key: string; value: ImageRecord; indexes: { guideId: string } };
}

export interface GuideSummary {
  id: string;
  title: string;
  updatedAt: string;
  createdAt: string;
  stepCount: number;
  firstImage?: string;
}

let dbp: Promise<IDBPDatabase<StepsnapDB>> | undefined;

export function db(): Promise<IDBPDatabase<StepsnapDB>> {
  dbp ??= openDB<StepsnapDB>("stepsnap", 1, {
    upgrade(d) {
      const g = d.createObjectStore("guides", { keyPath: "id" });
      g.createIndex("updatedAt", "updatedAt");
      const i = d.createObjectStore("images", { keyPath: "key" });
      i.createIndex("guideId", "guideId");
    },
  });
  return dbp;
}

export const imageKey = (guideId: string, path: string) => `${guideId}/${path}`;

export async function listGuides(): Promise<GuideSummary[]> {
  const all = await (await db()).getAll("guides");
  return all
    .map((g) => ({
      id: g.id,
      title: g.title,
      updatedAt: g.updatedAt,
      createdAt: g.createdAt,
      stepCount: g.steps.filter((s) => !s.skipped).length,
      firstImage: g.steps.find((s) => s.screenshot && !s.skipped)?.screenshot?.image,
    }))
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
}

export async function getGuide(id: string): Promise<Guide | undefined> {
  return (await db()).get("guides", id);
}

export async function putGuide(g: Guide): Promise<void> {
  await (await db()).put("guides", g);
}

/** Atomic read-modify-write. `fn` must be synchronous (IndexedDB transactions close on await). */
export async function mutateGuide(id: string, fn: (g: Guide) => Guide): Promise<Guide | undefined> {
  const tx = (await db()).transaction("guides", "readwrite");
  const g = await tx.store.get(id);
  if (!g) {
    await tx.done;
    return undefined;
  }
  const next = fn(g);
  if (next !== g) await tx.store.put(next);
  await tx.done;
  return next;
}

export async function deleteGuide(id: string): Promise<void> {
  const d = await db();
  const tx = d.transaction(["guides", "images"], "readwrite");
  await tx.objectStore("guides").delete(id);
  const keys = await tx.objectStore("images").index("guideId").getAllKeys(id);
  for (const k of keys) await tx.objectStore("images").delete(k);
  await tx.done;
}

export async function putImage(guideId: string, path: string, blob: Blob, highlight?: Rect): Promise<void> {
  const rec: ImageRecord = { key: imageKey(guideId, path), guideId, path, blob };
  if (highlight) rec.highlight = highlight;
  await (await db()).put("images", rec);
}

export async function getImage(guideId: string, path: string): Promise<ImageRecord | undefined> {
  return (await db()).get("images", imageKey(guideId, path));
}

export async function getImages(guideId: string): Promise<Record<string, Blob>> {
  const recs = await (await db()).getAllFromIndex("images", "guideId", guideId);
  return Object.fromEntries(recs.map((r) => [r.path, r.blob]));
}

export async function deleteImage(guideId: string, path: string): Promise<void> {
  await (await db()).delete("images", imageKey(guideId, path));
}

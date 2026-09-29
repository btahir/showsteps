// Unredacted originals for "Undo" on the auto-blur chip (SPEC §4), kept in memory only.
//
// The worker burns automatic redactions into the stored screenshot at capture time, so nothing
// unredacted is ever written to IndexedDB. It keeps the pre-blur capture of the current recording
// in memory; an open editor (side panel or tab) claims them over a port and holds them for its
// own lifetime. When the last editor of that guide closes, the worker drops them too. A worker
// restart loses them: the chip then says "Blurred at capture for safety" and offers no Undo.
//
// Undo is the person's explicit decision that the blurred area is not secret: the editor writes
// the original pixels back and removes the automatic redactions from the step. Undoing the Undo
// (⌘Z) re-bakes from the same in-memory original.

import type { Redaction, Step } from "@showsteps/core";

export const PORT_NAME = "showsteps:originals";

export interface OriginalEntry {
  blob: Blob;
  /** The step's timestamp when captured: an amended step gets a new one, so stale originals are ignored. */
  token: string;
}

/** Bounded in-memory store: guideId → stepId → original. Oldest entries go first. */
export class OriginalStore {
  private byGuide = new Map<string, Map<string, OriginalEntry>>();
  constructor(private readonly maxPerGuide = 60) {}

  set(guideId: string, stepId: string, entry: OriginalEntry): void {
    let m = this.byGuide.get(guideId);
    if (!m) this.byGuide.set(guideId, (m = new Map()));
    m.delete(stepId);
    m.set(stepId, entry);
    while (m.size > this.maxPerGuide) m.delete(m.keys().next().value!);
  }

  get(guideId: string, stepId: string): OriginalEntry | undefined {
    return this.byGuide.get(guideId)?.get(stepId);
  }

  entries(guideId: string): [string, OriginalEntry][] {
    return [...(this.byGuide.get(guideId) ?? new Map<string, OriginalEntry>()).entries()];
  }

  drop(guideId: string): void {
    this.byGuide.delete(guideId);
  }

  clear(): void {
    this.byGuide.clear();
  }

  get size(): number {
    let n = 0;
    for (const m of this.byGuide.values()) n += m.size;
    return n;
  }
}

/** Messages on the originals port. */
export type OriginalsPortMsg =
  | { type: "claim"; guideId: string }
  | { type: "original"; guideId: string; stepId: string; token: string; data: string; mime: string };

export async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

export function base64ToBlob(b64: string, mime = "image/png"): Blob {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

export const autoRedactionsOf = (step: Step): Redaction[] => step.screenshot?.redactions?.filter((r) => r.auto) ?? [];

/**
 * What the stored pixels of each step should be, for steps whose original this editor holds:
 * "burnt" while the step still lists automatic redactions, "original" once they were removed.
 * Returns only the steps whose stored state differs from `current` (what was last written).
 */
export function pendingImageWrites(
  steps: readonly Step[],
  originals: ReadonlyMap<string, OriginalEntry>,
  current: ReadonlyMap<string, "burnt" | "original">,
): { stepId: string; want: "burnt" | "original" }[] {
  const out: { stepId: string; want: "burnt" | "original" }[] = [];
  for (const s of steps) {
    const o = originals.get(s.id);
    if (!o || o.token !== s.timestamp || !s.screenshot) continue;
    const want = autoRedactionsOf(s).length ? "burnt" : "original";
    if ((current.get(s.id) ?? "burnt") !== want) out.push({ stepId: s.id, want });
  }
  return out;
}

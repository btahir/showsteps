// Screenshots, per-image facts and in-memory originals for the guide an editor shows.
//
// Originals (auto-blur Undo): the editor claims the pre-blur captures of this guide from the
// worker over a port and keeps them in this page's memory only. When the person removes a step's
// automatic redactions (the chip's Undo), the original pixels are written back; when they come
// back (⌘Z), they are burnt in again from the same original. Closing the editor drops everything.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Step } from "@showsteps/core";
import { getImageMeta, replaceImageBlob } from "../lib/db";
import type { ImageMeta } from "../lib/db";
import { autoRedactionsOf, base64ToBlob, pendingImageWrites, PORT_NAME } from "../lib/originals";
import type { OriginalEntry, OriginalsPortMsg } from "../lib/originals";
import { bakeRedactions } from "../lib/render";
import { useImageUrls } from "./hooks";
import type { GuideEditor } from "./useGuideEditor";

export interface GuideAssets {
  urls: Record<string, string>;
  meta: Record<string, ImageMeta>;
  hasOriginal(step: Step): boolean;
}

export function useGuideAssets(ed: GuideEditor, guideId: string | undefined): GuideAssets {
  const originals = useRef(new Map<string, OriginalEntry>());
  const written = useRef(new Map<string, "burnt" | "original">());
  const [origVersion, setOrigVersion] = useState(0);
  const [imgVersion, setImgVersion] = useState(0);
  const [meta, setMeta] = useState<Record<string, ImageMeta>>({});
  const writes = useRef<Promise<void>>(Promise.resolve());
  const steps = ed.guide?.steps;

  // Claim this guide's originals from the worker (memory only, for this page's lifetime).
  useEffect(() => {
    if (!guideId) return;
    let port: chrome.runtime.Port | undefined;
    try {
      port = chrome.runtime.connect({ name: PORT_NAME });
    } catch {
      return;
    }
    port.onMessage.addListener((m: OriginalsPortMsg) => {
      if (m?.type !== "original" || m.guideId !== guideId) return;
      originals.current.set(m.stepId, { blob: base64ToBlob(m.data, m.mime), token: m.token });
      setOrigVersion((v) => v + 1);
    });
    port.postMessage({ type: "claim", guideId } satisfies OriginalsPortMsg);
    return () => {
      port?.disconnect();
      originals.current.clear();
      written.current.clear();
    };
  }, [guideId]);

  // Keep stored pixels in line with the step: burnt while it lists automatic redactions,
  // the original once the person removed them.
  useEffect(() => {
    if (!guideId || !steps) return;
    const todo = pendingImageWrites(steps, originals.current, written.current);
    if (!todo.length) return;
    for (const t of todo) written.current.set(t.stepId, t.want);
    writes.current = writes.current.then(async () => {
      for (const t of todo) {
        const step = steps.find((s) => s.id === t.stepId);
        const o = originals.current.get(t.stepId);
        if (!step?.screenshot || !o) continue;
        try {
          const blob =
            t.want === "original"
              ? o.blob
              : await bakeRedactions(o.blob, { ...step, screenshot: { ...step.screenshot, redactions: autoRedactionsOf(step) } });
          await replaceImageBlob(guideId, step.screenshot.image, blob);
        } catch (e) {
          console.warn("Showsteps: could not update the screenshot", e);
          written.current.delete(t.stepId);
        }
      }
      setImgVersion((v) => v + 1);
    });
  }, [guideId, steps, origVersion]);

  const imageKey = useMemo(() => (steps ? `${steps.length}:${steps.map((s) => s.timestamp).join(",")}:${imgVersion}` : ""), [steps, imgVersion]);
  const urls = useImageUrls(guideId, imageKey);

  useEffect(() => {
    if (!guideId) return;
    let cancelled = false;
    void getImageMeta(guideId).then((m) => !cancelled && setMeta(m));
    return () => {
      cancelled = true;
    };
  }, [guideId, imageKey]);

  const hasOriginal = useCallback(
    (step: Step) => {
      const o = originals.current.get(step.id);
      return !!o && o.token === step.timestamp;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [origVersion],
  );

  return { urls, meta, hasOriginal };
}

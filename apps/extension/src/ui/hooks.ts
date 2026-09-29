// React hooks shared by the side panel and the editor.
import { useCallback, useEffect, useRef, useState } from "react";
import type { Guide } from "@stepsnap/core";
import type { Broadcast, ControlMessage, ControlReply } from "../lib/messages";
import type { SessionState } from "../lib/session";
import { IDLE } from "../lib/session";
import { getGuide, getImages, listGuides } from "../lib/db";
import type { GuideSummary } from "../lib/db";

export function send(msg: ControlMessage): Promise<ControlReply> {
  return chrome.runtime.sendMessage(msg) as Promise<ControlReply>;
}

/** Subscribe to worker broadcasts. */
export function useBroadcast(fn: (m: Broadcast) => void): void {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    const l = (m: unknown) => {
      if (m && typeof m === "object" && "type" in m && String((m as Broadcast).type).startsWith("bc:")) ref.current(m as Broadcast);
    };
    chrome.runtime.onMessage.addListener(l);
    return () => chrome.runtime.onMessage.removeListener(l);
  }, []);
}

export function useSession(): SessionState {
  const [state, setState] = useState<SessionState>(IDLE);
  useEffect(() => {
    void send({ type: "ctl:state" }).then((r) => r?.state && setState(r.state)).catch(() => {});
  }, []);
  useBroadcast((m) => {
    if (m.type === "bc:session") setState(m.state);
  });
  return state;
}

export function useGuide(id: string | undefined): { guide: Guide | undefined; reload: () => Promise<void>; loading: boolean } {
  const [guide, setGuide] = useState<Guide>();
  const [loading, setLoading] = useState(!!id);
  const reload = useCallback(async () => {
    if (!id) {
      setGuide(undefined);
      setLoading(false);
      return;
    }
    setGuide(await getGuide(id));
    setLoading(false);
  }, [id]);
  useEffect(() => {
    setLoading(!!id);
    void reload();
  }, [reload, id]);
  useBroadcast((m) => {
    if (m.type === "bc:guide" && m.guideId === id) void reload();
  });
  return { guide, reload, loading };
}

export function useLibrary(): { guides: GuideSummary[]; reload: () => Promise<void> } {
  const [guides, setGuides] = useState<GuideSummary[]>([]);
  const reload = useCallback(async () => setGuides(await listGuides()), []);
  useEffect(() => {
    void reload();
  }, [reload]);
  useBroadcast((m) => {
    if (m.type === "bc:guide" || m.type === "bc:session") void reload();
  });
  return { guides, reload };
}

/**
 * Object URLs for a guide's screenshots, keyed by image path. Revoked on unmount.
 * `version` forces a refresh (e.g. new steps arrived while recording).
 */
export function useImageUrls(guideId: string | undefined, version: unknown): Record<string, string> {
  const [urls, setUrls] = useState<Record<string, string>>({});
  const cache = useRef<Map<string, { blob: Blob; url: string }>>(new Map());
  useEffect(() => {
    let cancelled = false;
    if (!guideId) return;
    void getImages(guideId).then((blobs) => {
      if (cancelled) return;
      const next: Record<string, string> = {};
      for (const [path, blob] of Object.entries(blobs)) {
        const hit = cache.current.get(path);
        if (hit && hit.blob.size === blob.size) next[path] = hit.url;
        else {
          if (hit) URL.revokeObjectURL(hit.url);
          const url = URL.createObjectURL(blob);
          cache.current.set(path, { blob, url });
          next[path] = url;
        }
      }
      setUrls(next);
    });
    return () => {
      cancelled = true;
    };
  }, [guideId, version]);
  useEffect(
    () => () => {
      for (const { url } of cache.current.values()) URL.revokeObjectURL(url);
      cache.current.clear();
    },
    [],
  );
  return urls;
}

export function useToast(): [string | undefined, (msg: string) => void] {
  const [msg, setMsg] = useState<string>();
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const show = useCallback((m: string) => {
    setMsg(m);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setMsg(undefined), 2600);
  }, []);
  return [msg, show];
}

/** Opens the full-tab editor for a guide (reuses an open editor tab for the same guide). */
export async function openEditor(guideId: string, opts: { export?: boolean } = {}): Promise<void> {
  const url = chrome.runtime.getURL(`/editor.html?guide=${encodeURIComponent(guideId)}${opts.export ? "&export=1" : ""}`);
  const base = chrome.runtime.getURL("/editor.html");
  const tabs = await chrome.tabs.query({ url: `${base}*` }).catch(() => [] as chrome.tabs.Tab[]);
  const existing = tabs.find((t) => t.url?.includes(`guide=${encodeURIComponent(guideId)}`));
  if (existing?.id !== undefined) {
    await chrome.tabs.update(existing.id, { active: true, ...(opts.export ? { url } : {}) });
    if (existing.windowId !== undefined) await chrome.windows.update(existing.windowId, { focused: true });
    return;
  }
  await chrome.tabs.create({ url });
}

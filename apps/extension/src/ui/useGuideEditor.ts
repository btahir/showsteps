// Editing state for one guide, shared by the side panel and the full-tab editor: local copy,
// undo/redo, debounced atomic saves that merge in steps the recorder adds meanwhile, and a
// toast with Undo after every change.
import { useCallback, useEffect, useRef, useState } from "react";
import type { Guide } from "@showsteps/core";
import { getGuide, mutateGuide } from "../lib/db";
import { mergeRemote } from "../lib/guide-ops";
import { useBroadcast } from "./hooks";

const HISTORY_LIMIT = 80;

export interface EditToast {
  message: string;
  undo: boolean;
  id: number;
}

export interface GuideEditor {
  guide: Guide | undefined;
  missing: boolean;
  saveState: "saved" | "saving" | "unsaved";
  apply(fn: (g: Guide) => Guide, opts?: { announce?: string; coalesce?: string; toast?: boolean }): void;
  undo(): void;
  redo(): void;
  canUndo: boolean;
  canRedo: boolean;
  save(): Promise<void>;
  announce: string;
  toast: EditToast | undefined;
  dismissToast(): void;
  /** Ids of steps that arrived after the editor opened (for the flag-drop animation). */
  fresh: ReadonlySet<string>;
}

export function useGuideEditor(guideId: string | undefined): GuideEditor {
  const [guide, setGuide] = useState<Guide>();
  const [missing, setMissing] = useState(false);
  const [past, setPast] = useState<Guide[]>([]);
  const [future, setFuture] = useState<Guide[]>([]);
  const [saveState, setSaveState] = useState<GuideEditor["saveState"]>("saved");
  const [announce, setAnnounce] = useState("");
  const [toast, setToast] = useState<EditToast>();
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const latest = useRef<Guide | undefined>(undefined);
  const dirty = useRef(false);
  const deleted = useRef(new Set<string>());
  const saveTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const toastTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const lastEdit = useRef<{ key?: string; at: number }>({ at: 0 });
  latest.current = guide;

  useEffect(() => {
    setGuide(undefined);
    setMissing(false);
    setPast([]);
    setFuture([]);
    deleted.current.clear();
    if (!guideId) return;
    void getGuide(guideId).then((g) => (g ? setGuide(g) : setMissing(true)));
  }, [guideId]);

  const save = useCallback(async () => {
    clearTimeout(saveTimer.current);
    const local = latest.current;
    if (!local || !dirty.current) return;
    dirty.current = false;
    setSaveState("saving");
    let merged: Guide | undefined;
    await mutateGuide(local.id, (remote) => {
      merged = mergeRemote(local, remote, deleted.current);
      return merged;
    });
    if (merged && merged !== local && latest.current === local) setGuide(merged);
    setSaveState(dirty.current ? "unsaved" : "saved");
    chrome.runtime.sendMessage({ type: "bc:guide", guideId: local.id }).catch(() => {});
  }, []);

  const schedule = useCallback(() => {
    dirty.current = true;
    setSaveState("unsaved");
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => void save(), 400);
  }, [save]);

  const showToast = useCallback((message: string, undo: boolean) => {
    clearTimeout(toastTimer.current);
    setToast({ message, undo, id: Date.now() });
    toastTimer.current = setTimeout(() => setToast(undefined), 6000);
  }, []);

  const apply = useCallback<GuideEditor["apply"]>(
    (fn, opts = {}) => {
      const g = latest.current;
      if (!g) return;
      const next = fn(g);
      if (next === g) return;
      for (const s of g.steps) if (!next.steps.some((n) => n.id === s.id)) deleted.current.add(s.id);
      // Typing into one field is one undo step, not one per keystroke.
      const now = Date.now();
      const same = opts.coalesce !== undefined && lastEdit.current.key === opts.coalesce && now - lastEdit.current.at < 1500;
      lastEdit.current = { key: opts.coalesce, at: now };
      if (!same) setPast((p) => [...p.slice(-HISTORY_LIMIT + 1), g]);
      setFuture([]);
      latest.current = next;
      setGuide(next);
      schedule();
      if (opts.announce) {
        setAnnounce(opts.announce);
        if (opts.toast !== false) showToast(opts.announce, true);
      }
    },
    [schedule, showToast],
  );

  const restore = useCallback(
    (to: Guide, from: Guide, dir: "undo" | "redo") => {
      if (dir === "undo") {
        setPast((p) => p.slice(0, -1));
        setFuture((f) => [from, ...f]);
      } else {
        setFuture((f) => f.slice(1));
        setPast((p) => [...p, from]);
      }
      for (const s of to.steps) deleted.current.delete(s.id);
      for (const s of from.steps) if (!to.steps.some((n) => n.id === s.id)) deleted.current.add(s.id);
      latest.current = to;
      setGuide(to);
      schedule();
      const msg = dir === "undo" ? "Change undone" : "Change redone";
      setAnnounce(msg);
      showToast(msg, false);
    },
    [schedule, showToast],
  );

  const undo = useCallback(() => {
    const prev = past[past.length - 1];
    if (prev && guide) restore(prev, guide, "undo");
  }, [past, guide, restore]);
  const redo = useCallback(() => {
    const next = future[0];
    if (next && guide) restore(next, guide, "redo");
  }, [future, guide, restore]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const typing = !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "z" || typing) return;
      e.preventDefault();
      if (e.shiftKey) redo();
      else undo();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo]);

  useEffect(() => {
    const flush = () => void save();
    window.addEventListener("pagehide", flush);
    return () => window.removeEventListener("pagehide", flush);
  }, [save]);

  // Steps recorded (or edits made elsewhere) while this view is open.
  useBroadcast((m) => {
    if (m.type !== "bc:guide" || m.guideId !== guideId) return;
    void getGuide(m.guideId).then((remote) => {
      const local = latest.current;
      if (!remote) return;
      setMissing(false);
      if (!local || (!dirty.current && !past.length)) {
        if (local) {
          const known = new Set(local.steps.map((s) => s.id));
          const added = remote.steps.filter((s) => !known.has(s.id)).map((s) => s.id);
          if (added.length) setFresh((f) => new Set([...f, ...added]));
        }
        latest.current = remote;
        setGuide(remote);
        return;
      }
      const merged = mergeRemote(local, remote, deleted.current);
      if (merged !== local) {
        const known = new Set(local.steps.map((s) => s.id));
        setFresh((f) => new Set([...f, ...merged.steps.filter((s) => !known.has(s.id)).map((s) => s.id)]));
        latest.current = merged;
        setGuide(merged);
      }
    });
  });

  return {
    guide,
    missing,
    saveState,
    apply,
    undo,
    redo,
    canUndo: past.length > 0,
    canRedo: future.length > 0,
    save,
    announce,
    toast,
    dismissToast: () => setToast(undefined),
    fresh,
  };
}

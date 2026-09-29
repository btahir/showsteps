import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DragEvent, KeyboardEvent as RKeyboardEvent } from "react";
import type { Guide, Rect, Step } from "@stepsnap/core";
import { getGuide, getImage, mutateGuide } from "../../lib/db";
import {
  addNote,
  addRedaction,
  deleteStep,
  mergeRemote,
  mergeWithNext,
  moveStep,
  moveStepBy,
  removeRedaction,
  setCrop,
  setHighlight,
  toggleSkip,
  updateStep,
} from "../../lib/guide-ops";
import { APP_NAME, SUPPORT_URL } from "../../config";
import { useBroadcast, useImageUrls, useToast } from "../../ui/hooks";
import { ExportDialog, MdInline, plain, Toast } from "../../ui/components";
import { StepImage } from "../../ui/StepImage";
import type { DrawMode } from "../../ui/StepImage";
import {
  BrandMark,
  IconBlur,
  IconClose,
  IconCrop,
  IconDown,
  IconDownload,
  IconGrip,
  IconHeart,
  IconHighlight,
  IconMerge,
  IconNote,
  IconRedo,
  IconSkip,
  IconTrash,
  IconUndo,
  IconUp,
} from "../../ui/icons";

const params = new URLSearchParams(location.search);
const GUIDE_ID = params.get("guide") ?? undefined;
const OPEN_EXPORT = params.get("export") === "1";
const HISTORY_LIMIT = 80;

type Tool = { stepId: string; mode: Exclude<DrawMode, "none"> } | null;

function isTyping(el: EventTarget | null): boolean {
  const e = el as HTMLElement | null;
  return !!e && (e.tagName === "INPUT" || e.tagName === "TEXTAREA" || e.isContentEditable);
}

export function App() {
  const [guide, setGuide] = useState<Guide>();
  const [missing, setMissing] = useState(false);
  const [past, setPast] = useState<Guide[]>([]);
  const [future, setFuture] = useState<Guide[]>([]);
  const [saveState, setSaveState] = useState<"saved" | "saving" | "unsaved">("saved");
  const [tool, setTool] = useState<Tool>(null);
  const [exportOpen, setExportOpen] = useState(OPEN_EXPORT);
  const [announce, setAnnounce] = useState("");
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const [toast, showToast] = useToast();
  const deleted = useRef(new Set<string>());
  const saveTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const latest = useRef<Guide | undefined>(undefined);
  const dirty = useRef(false);
  const focusGrip = useRef<string | null>(null);
  const lastEdit = useRef<{ key?: string; at: number }>({ at: 0 });
  const urls = useImageUrls(GUIDE_ID, guide?.steps.length);

  latest.current = guide;

  useEffect(() => {
    if (!GUIDE_ID) {
      setMissing(true);
      return;
    }
    void getGuide(GUIDE_ID).then((g) => {
      if (!g) setMissing(true);
      else {
        setGuide(g);
        document.title = `${g.title} · ${APP_NAME}`;
      }
    });
  }, []);

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

  /** Apply an edit: record history, update state, schedule a save. */
  const apply = useCallback(
    (fn: (g: Guide) => Guide, opts: { announce?: string; coalesce?: string } = {}) => {
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
      dirty.current = true;
      setSaveState("unsaved");
      clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => void save(), 400);
      if (opts.announce) setAnnounce(opts.announce);
    },
    [save],
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
      dirty.current = true;
      setSaveState("unsaved");
      clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => void save(), 400);
      setAnnounce(dir === "undo" ? "Undone" : "Redone");
    },
    [save],
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
      if (e.key === "Escape" && tool) {
        setTool(null);
        return;
      }
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "z" || isTyping(e.target)) return;
      e.preventDefault();
      if (e.shiftKey) redo();
      else undo();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo, tool]);

  useEffect(() => {
    const flush = () => void save();
    window.addEventListener("pagehide", flush);
    return () => window.removeEventListener("pagehide", flush);
  }, [save]);

  // Steps recorded while this editor is open.
  useBroadcast((m) => {
    if (m.type !== "bc:guide" || m.guideId !== GUIDE_ID || !m.stepId) return;
    void getGuide(GUIDE_ID).then((remote) => {
      const local = latest.current;
      if (!remote || !local) return;
      const merged = mergeRemote(local, remote, deleted.current);
      if (merged !== local) {
        latest.current = merged;
        setGuide(merged);
      }
    });
  });

  useEffect(() => {
    if (!focusGrip.current) return;
    const el = document.querySelector<HTMLElement>(`[data-grip="${focusGrip.current}"]`);
    focusGrip.current = null;
    el?.focus();
  });

  const numbers = useMemo(() => {
    const map = new Map<string, number>();
    let n = 0;
    for (const s of guide?.steps ?? []) if (!s.skipped) map.set(s.id, ++n);
    return map;
  }, [guide]);

  if (missing) {
    return (
      <main className="editor-missing">
        <BrandMark />
        <h1>Guide not found</h1>
        <p className="muted">It may have been deleted. Open {APP_NAME} from the toolbar to see your guides.</p>
      </main>
    );
  }
  if (!guide) return <main className="editor-loading" aria-busy="true" />;

  const steps = guide.steps;
  const total = steps.length;
  const visibleCount = numbers.size;

  const move = (s: Step, delta: number) => {
    const i = steps.findIndex((x) => x.id === s.id);
    const to = Math.max(0, Math.min(total - 1, i + delta));
    if (to === i) return;
    focusGrip.current = s.id;
    apply((g) => moveStepBy(g, s.id, delta), { announce: `Moved to position ${to + 1} of ${total}` });
  };

  const onGripKey = (e: RKeyboardEvent, s: Step) => {
    if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault();
      move(s, e.key === "ArrowUp" ? -1 : 1);
    } else if (e.key === "Home" || e.key === "End") {
      e.preventDefault();
      focusGrip.current = s.id;
      apply((g) => moveStep(g, s.id, e.key === "Home" ? 0 : total - 1), { announce: `Moved to position ${e.key === "Home" ? 1 : total} of ${total}` });
    }
  };

  const onDragStart = (e: DragEvent, s: Step) => {
    setDragId(s.id);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", s.id);
  };
  const onDragOver = (e: DragEvent, index: number) => {
    if (!dragId) return;
    e.preventDefault();
    const box = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setDropIndex(e.clientY < box.top + box.height / 2 ? index : index + 1);
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    if (dragId && dropIndex !== null) {
      const from = steps.findIndex((s) => s.id === dragId);
      const to = dropIndex > from ? dropIndex - 1 : dropIndex;
      apply((g) => moveStep(g, dragId, to), { announce: `Moved to position ${to + 1} of ${total}` });
    }
    setDragId(null);
    setDropIndex(null);
  };

  const toggleHighlight = async (s: Step) => {
    const sh = s.screenshot;
    if (!sh) return;
    if (sh.highlight) {
      apply((g) => setHighlight(g, s.id, undefined), { announce: "Highlight hidden" });
      return;
    }
    const rec = await getImage(guide.id, sh.image);
    if (rec?.highlight) apply((g) => setHighlight(g, s.id, rec.highlight), { announce: "Highlight shown" });
    else showToast("This step has no recorded click target");
  };

  const onDraw = (s: Step, rect: Rect, mode: "blur" | "crop") => {
    if (mode === "blur") apply((g) => addRedaction(g, s.id, { rect, style: "blur" }), { announce: "Area blurred" });
    else {
      apply((g) => setCrop(g, s.id, rect), { announce: "Screenshot cropped" });
      setTool(null);
    }
  };

  return (
    <div className="editor" onDragEnd={() => (setDragId(null), setDropIndex(null))}>
      <header className="ed-bar">
        <div className="ed-bar-inner">
          <span className="brand">
            <BrandMark /> {APP_NAME}
          </span>
          <span className="ed-save muted" role="status" aria-live="polite">
            {saveState === "saved" ? "Saved on this device" : saveState === "saving" ? "Saving…" : "Unsaved changes"}
          </span>
          <div className="ed-bar-actions">
            <button type="button" className="icon-btn" onClick={undo} disabled={!past.length} aria-label="Undo" title="Undo (Ctrl+Z)">
              <IconUndo />
            </button>
            <button type="button" className="icon-btn" onClick={redo} disabled={!future.length} aria-label="Redo" title="Redo (Ctrl+Shift+Z)">
              <IconRedo />
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => {
                void save();
                setExportOpen(true);
              }}
            >
              <IconDownload /> Export
            </button>
          </div>
        </div>
      </header>

      <main className="ed-main">
        <section className="ed-intro" aria-label="Guide details">
          <label className="sr-only" htmlFor="guide-title">
            Guide title
          </label>
          <input
            id="guide-title"
            className="ed-title"
            value={guide.title}
            onChange={(e) => apply((g) => ({ ...g, title: e.target.value, updatedAt: new Date().toISOString() }), { coalesce: "guide-title" })}
            placeholder="Untitled guide"
          />
          <label className="sr-only" htmlFor="guide-desc">
            Guide description
          </label>
          <textarea
            id="guide-desc"
            className="field ed-desc"
            value={guide.description ?? ""}
            placeholder="What does this guide help someone do? (optional)"
            rows={2}
            onChange={(e) => apply((g) => ({ ...g, description: e.target.value, updatedAt: new Date().toISOString() }), { coalesce: "guide-desc" })}
          />
          <p className="muted small ed-meta">
            {visibleCount} {visibleCount === 1 ? "step" : "steps"}
            {total !== visibleCount ? ` · ${total - visibleCount} skipped` : ""} · Drag steps or use the grip with <kbd className="kbd">↑</kbd>{" "}
            <kbd className="kbd">↓</kbd> to reorder
          </p>
        </section>

        {total === 0 && (
          <div className="ed-empty">
            <p>No steps yet.</p>
            <button type="button" className="btn" onClick={() => apply((g) => addNote(g, null), { announce: "Note added" })}>
              <IconNote /> Add a note
            </button>
          </div>
        )}

        <ol className="ed-steps" aria-label="Steps" onDrop={onDrop} onDragOver={(e) => dragId && e.preventDefault()}>
          {steps.map((s, i) => {
            const n = numbers.get(s.id);
            const label = n ? `Step ${n}` : "Skipped step";
            const activeTool = tool?.stepId === s.id ? tool.mode : "none";
            return (
              <li
                key={s.id}
                className={`ed-step${s.skipped ? " is-skipped" : ""}${dragId === s.id ? " is-dragging" : ""}${dropIndex === i ? " drop-before" : ""}${
                  dropIndex === i + 1 && i === total - 1 ? " drop-after" : ""
                }`}
                onDragOver={(e) => onDragOver(e, i)}
                aria-label={`${label}: ${plain(s.title)}`}
              >
                <div className="ed-rail">
                  <button
                    type="button"
                    className="icon-btn grip"
                    draggable
                    data-grip={s.id}
                    onDragStart={(e) => onDragStart(e, s)}
                    onKeyDown={(e) => onGripKey(e, s)}
                    aria-label={`Reorder ${label.toLowerCase()}. Press up or down arrow to move.`}
                    aria-roledescription="sortable"
                    title="Drag to reorder, or focus and use arrow keys"
                  >
                    <IconGrip />
                  </button>
                  <span className={`ed-num${s.action.type === "note" ? " ed-num-note" : ""}`} aria-hidden>
                    {n ?? "–"}
                  </span>
                </div>

                <div className="ed-body">
                  <TitleEditor step={s} label={label} onCommit={(title) => apply((g) => updateStep(g, s.id, { title }))} />
                  <label className="sr-only" htmlFor={`desc-${s.id}`}>
                    Description for {label.toLowerCase()}
                  </label>
                  <textarea
                    id={`desc-${s.id}`}
                    className="field ed-step-desc"
                    rows={1}
                    placeholder={s.action.type === "note" ? "Write the note" : "Add detail (optional)"}
                    value={s.description ?? ""}
                    onChange={(e) => apply((g) => updateStep(g, s.id, { description: e.target.value }), { coalesce: `desc-${s.id}` })}
                  />

                  <div className="ed-tools" role="toolbar" aria-label={`${label} tools`}>
                    <button type="button" className="icon-btn" onClick={() => move(s, -1)} disabled={i === 0} aria-label="Move up" title="Move up">
                      <IconUp />
                    </button>
                    <button type="button" className="icon-btn" onClick={() => move(s, 1)} disabled={i === total - 1} aria-label="Move down" title="Move down">
                      <IconDown />
                    </button>
                    <span className="ed-sep" aria-hidden />
                    {s.screenshot && (
                      <>
                        <button
                          type="button"
                          className="icon-btn"
                          aria-pressed={!!s.screenshot.highlight}
                          onClick={() => void toggleHighlight(s)}
                          aria-label="Highlight click target"
                          title="Highlight the click target"
                        >
                          <IconHighlight />
                        </button>
                        <button
                          type="button"
                          className="icon-btn"
                          aria-pressed={activeTool === "blur"}
                          onClick={() => setTool(activeTool === "blur" ? null : { stepId: s.id, mode: "blur" })}
                          aria-label="Blur an area"
                          title="Blur an area: drag over the screenshot"
                        >
                          <IconBlur />
                        </button>
                        <button
                          type="button"
                          className="icon-btn"
                          aria-pressed={activeTool === "crop" || !!s.screenshot.crop}
                          onClick={() => {
                            if (s.screenshot?.crop && activeTool !== "crop") apply((g) => setCrop(g, s.id, undefined), { announce: "Crop removed" });
                            else setTool(activeTool === "crop" ? null : { stepId: s.id, mode: "crop" });
                          }}
                          aria-label={s.screenshot.crop ? "Remove crop" : "Crop screenshot"}
                          title={s.screenshot.crop ? "Remove crop" : "Crop: drag over the screenshot"}
                        >
                          <IconCrop />
                        </button>
                        <span className="ed-sep" aria-hidden />
                      </>
                    )}
                    <button
                      type="button"
                      className="icon-btn"
                      aria-pressed={!!s.skipped}
                      onClick={() => apply((g) => toggleSkip(g, s.id), { announce: s.skipped ? "Step included" : "Step skipped in exports" })}
                      aria-label="Skip in exports"
                      title="Skip: keep the step but leave it out of exports"
                    >
                      <IconSkip />
                    </button>
                    <button
                      type="button"
                      className="icon-btn"
                      onClick={() => apply((g) => addNote(g, s.id), { announce: "Note added below" })}
                      aria-label="Add a note below"
                      title="Add a note below"
                    >
                      <IconNote />
                    </button>
                    <button
                      type="button"
                      className="icon-btn"
                      onClick={() => apply((g) => mergeWithNext(g, s.id), { announce: "Merged with the next step" })}
                      disabled={i === total - 1}
                      aria-label="Merge with next step"
                      title="Merge with the next step"
                    >
                      <IconMerge />
                    </button>
                    <button
                      type="button"
                      className="icon-btn ed-del"
                      onClick={() => apply((g) => deleteStep(g, s.id), { announce: "Step deleted. Press Ctrl+Z to undo." })}
                      aria-label="Delete step"
                      title="Delete step (undo with Ctrl+Z)"
                    >
                      <IconTrash />
                    </button>
                  </div>

                  {activeTool !== "none" && (
                    <p className="ed-tool-hint" role="note">
                      {activeTool === "blur" ? "Drag over the screenshot to blur an area." : "Drag over the screenshot to keep only that area."}{" "}
                      <button type="button" className="btn btn-sm btn-ghost" onClick={() => setTool(null)}>
                        Done
                      </button>
                    </p>
                  )}

                  {(s.screenshot || s.action.type !== "note") && (
                    <StepImage
                      step={s}
                      src={s.screenshot ? urls[s.screenshot.image] : undefined}
                      number={n}
                      mode={activeTool}
                      onDraw={(r, m) => onDraw(s, r, m)}
                      alt={`Screenshot for ${label.toLowerCase()}`}
                    />
                  )}

                  {!!s.screenshot?.redactions?.length && (
                    <ul className="ed-chips" aria-label="Blurred areas">
                      {s.screenshot.redactions.map((r, ri) => (
                        <li key={ri} className="chip">
                          Blur {ri + 1}
                          {r.auto ? " · sensitive field" : ""}
                          <button
                            type="button"
                            className="chip-x"
                            aria-label={`Remove blur ${ri + 1}`}
                            onClick={() => apply((g) => removeRedaction(g, s.id, ri), { announce: "Blur removed" })}
                          >
                            <IconClose />
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                  {s.page.url && s.action.type !== "note" && (
                    <p className="ed-url muted" title={s.page.url}>
                      {s.page.url}
                    </p>
                  )}
                </div>
              </li>
            );
          })}
        </ol>

        {total > 0 && (
          <div className="ed-foot">
            <button type="button" className="btn" onClick={() => apply((g) => addNote(g, steps[total - 1]!.id), { announce: "Note added at the end" })}>
              <IconNote /> Add a note at the end
            </button>
            <a className="btn btn-ghost" href={SUPPORT_URL} target="_blank" rel="noopener noreferrer">
              <IconHeart /> Support {APP_NAME}
            </a>
          </div>
        )}
      </main>

      <div className="sr-only" aria-live="polite">
        {announce}
      </div>
      <ExportDialog open={exportOpen} guide={guide} onClose={() => setExportOpen(false)} beforeExport={save} toast={showToast} />
      <Toast message={toast} />
    </div>
  );
}

function TitleEditor({ step, label, onCommit }: { step: Step; label: string; onCommit: (t: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(step.title);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (editing) input.current?.select();
  }, [editing]);

  if (editing) {
    const commit = () => {
      setEditing(false);
      const t = draft.trim();
      if (t && t !== step.title) onCommit(t);
    };
    return (
      <div className="ed-title-edit">
        <label className="sr-only" htmlFor={`title-${step.id}`}>
          Title for {label.toLowerCase()}. Wrap words in two asterisks for bold.
        </label>
        <input
          ref={input}
          id={`title-${step.id}`}
          className="field ed-step-title-input"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            if (e.key === "Escape") {
              setDraft(step.title);
              setEditing(false);
            }
          }}
        />
      </div>
    );
  }
  return (
    <h2 className="ed-step-title">
      <button
        type="button"
        className="ed-title-view"
        onClick={() => {
          setDraft(step.title);
          setEditing(true);
        }}
        aria-label={`${label}: ${plain(step.title)}. Edit title`}
      >
        <MdInline text={step.title} />
      </button>
    </h2>
  );
}

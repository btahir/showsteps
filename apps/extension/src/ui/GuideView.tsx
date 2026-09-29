// The guide editor used by both the side panel (one column) and the full-tab editor (list on
// the left, the selected step large on the right). Spec: docs/design/SPEC.md §2, §4, §5.
import { localIso } from "../lib/time";
import { useEffect, useMemo, useRef, useState } from "react";
import type { DragEvent, KeyboardEvent as RKeyboardEvent, ReactNode } from "react";
import { regenerateTitles } from "@showsteps/core";
import type { Guide, Rect, Step } from "@showsteps/core";
import { getImage } from "../lib/db";
import {
  addNote,
  addRedaction,
  deleteStep,
  mergeWithNext,
  moveStep,
  moveStepBy,
  removeAutoRedactions,
  setCrop,
  setHighlight,
  toggleSkip,
  updateStep,
} from "../lib/guide-ops";
import type { GuideEditor } from "./useGuideEditor";
import type { GuideAssets } from "./useGuideAssets";
import { redactionChip, reviewChip } from "../lib/chip";
import { StepImage } from "./StepImage";
import type { DrawMode } from "./StepImage";
import { MdInline, plain } from "./components";
import { IconBlur, IconCheck, IconCrop, IconEye, IconEyeOff, IconGrip, IconHighlight, IconLock, IconMerge, IconPlus, IconTrash } from "./icons";

type Layout = "panel" | "tab";
type Tool = { stepId: string; mode: Exclude<DrawMode, "none"> } | null;

export function relTime(iso: string | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} h ago`;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function domainOf(g: Guide): string | undefined {
  for (const s of g.steps) {
    try {
      const h = new URL(s.page.url).hostname;
      if (h) return h;
    } catch {
      /* next */
    }
  }
  return undefined;
}

/** The auto-blur chip ("Password blurred · Undo") and, when the scan did not finish, a review chip. */
function RedactionChips({ step, assets, onUndo }: { step: Step; assets: GuideAssets; onUndo: () => void }) {
  const facts = step.screenshot ? assets.meta[step.screenshot.image] : undefined;
  const chip = redactionChip(step, facts, assets.hasOriginal(step));
  const review = reviewChip(facts);
  if (!chip && !review) return null;
  return (
    <>
      {chip && (
        <p className="chip-ok" data-testid="redaction-chip">
          <IconCheck /> <span>{chip.text}</span>
          {chip.canUndo ? (
            <button type="button" className="chip-link" onClick={onUndo} aria-label={`Undo: ${chip.text.replace(/ blurred$/, "")} no longer blurred`}>
              Undo
            </button>
          ) : (
            <span className="chip-note" title="The unblurred screenshot was never saved, so this blur cannot be undone.">
              <IconLock /> {chip.note}
            </span>
          )}
        </p>
      )}
      {review && (
        <p className="chip-warn" role="note">
          {review}
        </p>
      )}
    </>
  );
}

export function GuideView({
  ed,
  assets,
  layout,
  recording,
  header,
}: {
  ed: GuideEditor;
  assets: GuideAssets;
  layout: Layout;
  recording?: boolean;
  header?: ReactNode;
}) {
  const urls = assets.urls;
  const guide = ed.guide!;
  const steps = guide.steps;
  const [selected, setSelected] = useState<string | null>(null);
  const [tool, setTool] = useState<Tool>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const focusId = useRef<string | null>(null);
  const listEnd = useRef<HTMLLIElement>(null);

  const numbers = useMemo(() => {
    const map = new Map<string, number>();
    let n = 0;
    // Same numbering as the exporters (core stepNumbers): every step that is not hidden, notes included.
    for (const s of steps) if (!s.skipped) map.set(s.id, ++n);
    return map;
  }, [steps]);

  // Full-tab editor: always show one step on the right.
  useEffect(() => {
    if (layout === "tab" && !selected && steps[0]) setSelected(steps[0].id);
    if (selected && !steps.some((s) => s.id === selected)) setSelected(steps[0]?.id ?? null);
  }, [layout, selected, steps]);

  // Recording: keep the newest step in view.
  useEffect(() => {
    if (recording) listEnd.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [recording, steps.length]);

  useEffect(() => {
    if (!focusId.current) return;
    document.querySelector<HTMLElement>(`[data-step-button="${focusId.current}"]`)?.focus();
    focusId.current = null;
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setTool(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const total = steps.length;
  const sel = steps.find((s) => s.id === selected);

  const move = (s: Step, delta: number) => {
    const i = steps.findIndex((x) => x.id === s.id);
    const to = Math.max(0, Math.min(total - 1, i + delta));
    if (to === i) return;
    focusId.current = s.id;
    ed.apply((g) => moveStepBy(g, s.id, delta), { announce: `Moved to position ${to + 1} of ${total}`, toast: false });
  };

  const remove = (s: Step) => ed.apply((g) => deleteStep(g, s.id), { announce: "Step deleted" });

  const onListKey = (e: RKeyboardEvent, s: Step) => {
    const i = steps.findIndex((x) => x.id === s.id);
    if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
      e.preventDefault();
      move(s, e.key === "ArrowUp" ? -1 : 1);
    } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault();
      const next = steps[i + (e.key === "ArrowUp" ? -1 : 1)];
      if (next) {
        setSelected(next.id);
        focusId.current = next.id;
      }
    } else if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      if (confirm(`Delete step ${numbers.get(s.id) ?? ""}: ${plain(s.title)}?`)) remove(s);
    }
  };

  const toggleHighlight = async (s: Step) => {
    const sh = s.screenshot;
    if (!sh) return;
    if (sh.highlight) return ed.apply((g) => setHighlight(g, s.id, undefined), { announce: "Highlight hidden" });
    const rec = await getImage(guide.id, sh.image);
    // The recorded box, or a centred one when the step never had a target.
    const fallback = { x: Math.round(sh.width * 0.4), y: Math.round(sh.height * 0.42), width: Math.round(sh.width * 0.2), height: Math.round(sh.height * 0.08) };
    ed.apply((g) => setHighlight(g, s.id, rec?.highlight ?? fallback), { announce: "Highlight shown" });
  };

  const onHighlight = (s: Step, rect: Rect, via: "pointer" | "key") =>
    ed.apply((g) => setHighlight(g, s.id, rect), { announce: via === "key" ? undefined : "Highlight moved", coalesce: via === "key" ? `hl-${s.id}` : undefined, toast: false });

  const undoBlur = (s: Step) => ed.apply((g) => removeAutoRedactions(g, s.id), { announce: "Blur removed" });

  const onDraw = (s: Step, rect: Rect, mode: "blur" | "crop") => {
    if (mode === "blur") ed.apply((g) => addRedaction(g, s.id, { rect, style: "blur" }), { announce: "Area blurred" });
    else {
      ed.apply((g) => setCrop(g, s.id, rect), { announce: "Screenshot cropped" });
      setTool(null);
    }
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
      ed.apply((g) => moveStep(g, dragId, to), { announce: `Moved to position ${to + 1} of ${total}`, toast: false });
    }
    setDragId(null);
    setDropIndex(null);
  };

  const tools = (s: Step) => (
    <StepTools
      step={s}
      label={labelOf(s)}
      tool={tool?.stepId === s.id ? tool.mode : "none"}
      layout={layout}
      canMerge={steps.findIndex((x) => x.id === s.id) < total - 1}
      onToggleHighlight={() => void toggleHighlight(s)}
      onTool={(m) => {
        if (m === "crop" && s.screenshot?.crop && tool?.mode !== "crop") {
          ed.apply((g) => setCrop(g, s.id, undefined), { announce: "Crop removed" });
          return;
        }
        setTool(tool?.stepId === s.id && tool.mode === m ? null : { stepId: s.id, mode: m });
      }}
      onSkip={() => ed.apply((g) => toggleSkip(g, s.id), { announce: s.skipped ? "Step shown in exports" : "Step hidden from exports" })}
      onDelete={() => remove(s)}
      onMerge={() => ed.apply((g) => mergeWithNext(g, s.id), { announce: "Merged with the next step" })}
    />
  );

  const labelOf = (s: Step) => {
    const n = numbers.get(s.id);
    if (!n) return "Hidden step";
    return s.action.type === "note" ? `Step ${n} (note)` : `Step ${n}`;
  };

  const list = (
    <ol className={`steps steps-${layout}`} aria-label="Steps" onDrop={onDrop} onDragOver={(e) => dragId && e.preventDefault()}>
      {steps.map((s, i) => {
        const n = numbers.get(s.id);
        const isSel = s.id === selected;
        const label = labelOf(s);
        const activeTool = tool?.stepId === s.id ? tool.mode : "none";
        return (
          <li
            key={s.id}
            className={`step${isSel ? " is-selected" : ""}${s.skipped ? " is-skipped" : ""}${dragId === s.id ? " is-dragging" : ""}${
              dropIndex === i ? " drop-before" : ""
            }${dropIndex === i + 1 && i === total - 1 ? " drop-after" : ""}`}
            onDragOver={(e) => onDragOver(e, i)}
          >
            {i > 0 && !recording && (
              <div className="insert" aria-hidden={false}>
                <button
                  type="button"
                  className="insert-btn"
                  aria-label={`Add a note before ${label.toLowerCase()}`}
                  title="Add a note here"
                  onClick={() => ed.apply((g) => addNote(g, steps[i - 1]!.id), { announce: "Note added" })}
                >
                  <IconPlus />
                </button>
              </div>
            )}
            <div className="step-row">
              <span className={`flag${s.skipped ? " flag-skipped" : s.action.type === "note" ? " flag-note" : ""}${ed.fresh.has(s.id) ? " flag-new" : ""}`} aria-hidden>
                {s.skipped ? <IconEyeOff /> : n}
              </span>
              {isSel ? (
                <TitleEditor step={s} label={label} onCommit={(title) => ed.apply((g) => updateStep(g, s.id, { title }), { announce: "Title changed", toast: false })} />
              ) : (
                <button
                  type="button"
                  className="step-title"
                  data-step-button={s.id}
                  aria-label={`${label}: ${plain(s.title)}${s.skipped ? " (hidden from exports)" : ""}`}
                  aria-expanded={layout === "panel" ? false : undefined}
                  aria-current={layout === "tab" && isSel ? "step" : undefined}
                  onClick={() => {
                    setSelected(s.id);
                    setTool(null);
                  }}
                  onKeyDown={(e) => onListKey(e, s)}
                >
                  <MdInline text={s.title} />
                </button>
              )}
              <button
                type="button"
                className="icon-btn grip"
                draggable
                onDragStart={(e) => {
                  setDragId(s.id);
                  e.dataTransfer.effectAllowed = "move";
                  e.dataTransfer.setData("text/plain", s.id);
                }}
                onDragEnd={() => (setDragId(null), setDropIndex(null))}
                onKeyDown={(e) => {
                  if (e.key === "ArrowUp" || e.key === "ArrowDown") {
                    e.preventDefault();
                    move(s, e.key === "ArrowUp" ? -1 : 1);
                    requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-grip="${s.id}"]`)?.focus());
                  }
                }}
                data-grip={s.id}
                aria-label={`Reorder ${label.toLowerCase()}. Use the up and down arrow keys.`}
                aria-roledescription="sortable"
                title="Drag to reorder"
              >
                <IconGrip />
              </button>
            </div>

            {layout === "panel" && isSel && (
              <div className="step-detail">
                <DescriptionField ed={ed} step={s} label={label} />
                <RedactionChips step={s} assets={assets} onUndo={() => undoBlur(s)} />
                {tools(s)}
                {activeTool !== "none" && <ToolHint mode={activeTool} step={s} onToggleHighlight={() => void toggleHighlight(s)} onDone={() => setTool(null)} />}
              </div>
            )}

            {layout === "panel" && (s.screenshot || s.action.type !== "note") && (
              <div className="step-thumb" onClick={() => !isSel && setSelected(s.id)}>
                <StepImage
                  step={s}
                  src={s.screenshot ? urls[s.screenshot.image] : undefined}
                  number={n}
                  mode={isSel ? activeTool : "none"}
                  frame={isSel ? "full" : "focus"}
                  onDraw={(r, m) => onDraw(s, r, m)}
                  onHighlight={(r, via) => onHighlight(s, r, via)}
                  showRedactionOutlines={isSel}
                  color={guide.settings?.highlightColor}
                  alt={`Screenshot for ${label.toLowerCase()}`}
                />
              </div>
            )}
            {layout === "panel" && s.action.type === "note" && !isSel && s.description && <p className="note-body">{s.description}</p>}
            {layout === "tab" && s.screenshot && (
              <div className="step-thumb step-thumb-small" onClick={() => setSelected(s.id)} aria-hidden>
                <StepImage step={s} src={urls[s.screenshot.image]} number={n} alt="" frame="focus" color={guide.settings?.highlightColor} />
              </div>
            )}
          </li>
        );
      })}
      {recording && (
        <li className="step step-waiting" aria-live="polite">
          <span className="ring-placeholder" aria-hidden />
          <span className="muted">{steps.length ? "Keep going. New steps appear here." : "Click anything on the page. Steps appear here."}</span>
        </li>
      )}
      {/* Scroll anchor for new steps; an <li> so the list holds only list items (axe "list"). */}
      <li ref={listEnd} className="list-end" aria-hidden="true" />
    </ol>
  );

  if (layout === "panel") {
    return (
      <>
        {header}
        {list}
        <div className="sr-only" aria-live="polite">
          {ed.announce}
        </div>
      </>
    );
  }

  const activeTool = sel && tool?.stepId === sel.id ? tool.mode : "none";
  return (
    <div className="ed-columns">
      <aside className="ed-list" aria-label="Step list">
        {header}
        {list}
      </aside>
      <section className="ed-detail" aria-label={sel ? `${labelOf(sel)} details` : "Step details"}>
        {sel ? (
          <>
            <div className="ed-detail-bar">{tools(sel)}</div>
            {activeTool !== "none" && <ToolHint mode={activeTool} step={sel} onToggleHighlight={() => void toggleHighlight(sel)} onDone={() => setTool(null)} />}
            <div className="ed-detail-head">
              <span className={`flag flag-lg${sel.skipped ? " flag-skipped" : sel.action.type === "note" ? " flag-note" : ""}`} aria-hidden>
                {sel.skipped ? <IconEyeOff /> : numbers.get(sel.id)}
              </span>
              <TitleEditor
                step={sel}
                label={labelOf(sel)}
                big
                onCommit={(title) => ed.apply((g) => updateStep(g, sel.id, { title }), { announce: "Title changed", toast: false })}
              />
            </div>
            <DescriptionField ed={ed} step={sel} label={labelOf(sel)} />
            <RedactionChips step={sel} assets={assets} onUndo={() => undoBlur(sel)} />
            {(sel.screenshot || sel.action.type !== "note") && (
              <StepImage
                step={sel}
                src={sel.screenshot ? urls[sel.screenshot.image] : undefined}
                number={numbers.get(sel.id)}
                mode={activeTool}
                onDraw={(r, m) => onDraw(sel, r, m)}
                onHighlight={(r, via) => onHighlight(sel, r, via)}
                showRedactionOutlines
                size="large"
                color={guide.settings?.highlightColor}
                alt={`Screenshot for ${labelOf(sel).toLowerCase()}`}
              />
            )}
            {sel.page.url && sel.action.type !== "note" && (
              <p className="mono muted ed-url" title={sel.page.url}>
                {sel.page.url}
              </p>
            )}
          </>
        ) : (
          <p className="muted">Select a step to edit it.</p>
        )}
      </section>
      <div className="sr-only" aria-live="polite">
        {ed.announce}
      </div>
    </div>
  );
}

function ToolHint({ mode, step, onToggleHighlight, onDone }: { mode: Exclude<DrawMode, "none">; step: Step; onToggleHighlight: () => void; onDone: () => void }) {
  if (mode === "highlight") {
    const shown = !!step.screenshot?.highlight;
    return (
      <p className="tool-hint" role="note">
        <span>{shown ? "Drag the box or its corners. Arrow keys nudge the focused handle." : "This step has no highlight."}</span>
        <span className="tool-hint-actions">
          <button type="button" className="btn btn-ghost" onClick={onToggleHighlight}>
            {shown ? "Hide highlight" : "Show highlight"}
          </button>
          <button type="button" className="btn btn-ghost" onClick={onDone}>
            Done
          </button>
        </span>
      </p>
    );
  }
  return (
    <p className="tool-hint" role="note">
      {mode === "blur" ? "Drag over the screenshot to blur an area." : "Drag over the screenshot to keep only that area."}
      <button type="button" className="btn btn-ghost" onClick={onDone}>
        Done
      </button>
    </p>
  );
}

function DescriptionField({ ed, step, label }: { ed: GuideEditor; step: Step; label: string }) {
  return (
    <>
      <label className="sr-only" htmlFor={`desc-${step.id}`}>
        Description for {label.toLowerCase()}
      </label>
      <textarea
        id={`desc-${step.id}`}
        className="field step-desc"
        rows={1}
        placeholder={step.action.type === "note" ? "Write the note" : "Add a description (optional)"}
        value={step.description ?? ""}
        onChange={(e) => ed.apply((g) => updateStep(g, step.id, { description: e.target.value }), { coalesce: `desc-${step.id}` })}
      />
    </>
  );
}

function StepTools({
  step,
  label,
  tool,
  layout,
  canMerge,
  onToggleHighlight: _onToggleHighlight,
  onTool,
  onSkip,
  onDelete,
  onMerge,
}: {
  step: Step;
  label: string;
  tool: DrawMode;
  layout: Layout;
  canMerge: boolean;
  onToggleHighlight: () => void;
  onTool: (m: "blur" | "crop" | "highlight") => void;
  onSkip: () => void;
  onDelete: () => void;
  onMerge: () => void;
}) {
  const shot = !!step.screenshot;
  return (
    <div className="seg" role="toolbar" aria-label={`${label} tools`}>
      <button type="button" className="seg-btn" aria-pressed={tool === "highlight"} disabled={!shot} onClick={() => onTool("highlight")}>
        <IconHighlight />
        <span>Highlight</span>
      </button>
      <button type="button" className="seg-btn" aria-pressed={tool === "blur"} disabled={!shot} onClick={() => onTool("blur")}>
        <IconBlur />
        <span>Blur</span>
      </button>
      <button type="button" className="seg-btn" aria-pressed={tool === "crop" || !!step.screenshot?.crop} disabled={!shot} onClick={() => onTool("crop")}>
        <IconCrop />
        <span>{step.screenshot?.crop && tool !== "crop" ? "Uncrop" : "Crop"}</span>
      </button>
      <span className="seg-sep" aria-hidden />
      {layout === "tab" && (
        <button type="button" className="seg-btn" disabled={!canMerge} onClick={onMerge}>
          <IconMerge />
          <span>Merge</span>
        </button>
      )}
      <button type="button" className="seg-btn seg-state" aria-pressed={!!step.skipped} onClick={onSkip}>
        {step.skipped ? <IconEye /> : <IconEyeOff />}
        <span>{step.skipped ? "Show" : "Skip"}</span>
      </button>
      <button type="button" className="seg-btn seg-danger" onClick={onDelete}>
        <IconTrash />
        <span>Delete</span>
      </button>
    </div>
  );
}

function TitleEditor({ step, label, onCommit, big }: { step: Step; label: string; onCommit: (t: string) => void; big?: boolean }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(step.title);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (editing) input.current?.select();
  }, [editing]);
  useEffect(() => setEditing(false), [step.id]);

  if (editing) {
    const commit = () => {
      setEditing(false);
      const t = draft.trim();
      if (t && t !== step.title) onCommit(t);
    };
    return (
      <span className="title-edit">
        <label className="sr-only" htmlFor={`title-${step.id}`}>
          Title for {label.toLowerCase()}. Wrap words in two asterisks to make them bold.
        </label>
        <input
          ref={input}
          id={`title-${step.id}`}
          className="field"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            if (e.key === "Escape") {
              e.stopPropagation();
              setDraft(step.title);
              setEditing(false);
            }
          }}
        />
      </span>
    );
  }
  return (
    <button
      type="button"
      className={`step-title is-editable${big ? " step-title-big" : ""}`}
      data-step-button={step.id}
      onClick={() => {
        setDraft(step.title);
        setEditing(true);
      }}
      aria-label={`${label}: ${plain(step.title)}. Edit title`}
    >
      <MdInline text={step.title} />
    </button>
  );
}

export function GuideHeader({ ed, extra }: { ed: GuideEditor; extra?: ReactNode }) {
  const g = ed.guide!;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(g.title);
  const count = g.steps.filter((s) => !s.skipped).length;
  const domain = domainOf(g);
  const commit = () => {
    setEditing(false);
    const t = draft.trim();
    if (t && t !== g.title) ed.apply((x) => ({ ...x, title: t, updatedAt: localIso() }), { announce: "Title changed", toast: false });
  };
  return (
    <header className="guide-head">
      {editing ? (
        <>
          <label className="sr-only" htmlFor="guide-title">
            Guide title
          </label>
          <input
            id="guide-title"
            className="field guide-title-input"
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === "Enter") commit();
              if (e.key === "Escape") setEditing(false);
            }}
          />
        </>
      ) : (
        <h1 className="guide-title">
          <button
            type="button"
            className="guide-title-btn"
            onClick={() => {
              setDraft(g.title);
              setEditing(true);
            }}
            aria-label={`Guide title: ${g.title}. Edit`}
          >
            {g.title}
          </button>
        </h1>
      )}
      <p className="guide-meta">
        <span className="num">
          {count} {count === 1 ? "step" : "steps"}
        </span>
        <span className="dot" aria-hidden />
        <span>recorded {relTime(g.createdAt)}</span>
        {domain && (
          <>
            <span className="dot" aria-hidden />
            <span className="mono">{domain}</span>
          </>
        )}
        <span className="dot" aria-hidden />
        <button
          type="button"
          className="link-btn meta-action"
          title="Write the titles again from the recorded actions. Titles you edited stay as they are."
          onClick={() => ed.apply((x) => ({ ...regenerateTitles(x), updatedAt: localIso() }), { announce: "Titles regenerated" })}
        >
          Regenerate titles
        </button>
      </p>
      {extra}
    </header>
  );
}

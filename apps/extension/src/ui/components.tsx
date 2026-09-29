// Shared UI pieces: inline-Markdown titles, the export sheet with the post-export support
// moment (SPEC §6, §8), and the edit toast.
import { useEffect, useRef, useState } from "react";
import { typographicQuotes } from "@stepsnap/core";
import type { Guide } from "@stepsnap/core";
import { FORMATS } from "../lib/formats";
import type { ExportFormat } from "../lib/formats";
import { getImages } from "../lib/db";
import { recordExport, recordNotNow } from "../lib/support";
import { SUPPORT_BODY, SUPPORT_HEADING, SUPPORT_URL } from "../config";
import { IconClose, IconCode, IconCopy, IconDownload } from "./icons";
import type { EditToast } from "./useGuideEditor";

/** Renders `**bold**` (the only inline Markdown step titles use) without HTML injection. */
export function MdInline({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g).filter(Boolean);
  // Titles are stored with straight quotes; show typographic ones (Rethink Sans slants the ASCII quote).
  let prev = "";
  return (
    <>
      {parts.map((p, i) => {
        const bold = p.startsWith("**") && p.endsWith("**") && p.length > 4;
        const raw = bold ? p.slice(2, -2) : p;
        const shown = typographicQuotes(raw, prev);
        prev = raw;
        return bold ? <strong key={i}>{shown}</strong> : <span key={i}>{shown}</span>;
      })}
    </>
  );
}

export function plain(text: string): string {
  return text.replace(/\*\*([^*]+)\*\*/g, "$1");
}

/** The five export swatches (SPEC §1). */
export const SWATCHES = [
  { name: "Persimmon", value: "#EB4E26" },
  { name: "Saffron", value: "#E0A100" },
  { name: "Green", value: "#1F9D6B" },
  { name: "Blue", value: "#2F6FEB" },
  { name: "Ink", value: "#1F1C19" },
] as const;

const TILE_TEXT: Record<ExportFormat, { name: string; line: string; short: string; verb: string }> = {
  pdf: { name: "PDF", line: "Print-ready, A4 or Letter", short: "PDF", verb: "PDF" },
  html: { name: "Web page", line: "One .html file, works offline", short: "HTML", verb: "web page" },
  markdown: { name: "Markdown", line: ".md and images, zipped", short: "MD", verb: "Markdown" },
  docx: { name: "Word", line: ".docx you can keep editing", short: "DOCX", verb: "Word" },
  skill: { name: "Agent skill", line: "SKILL.md, steps, Playwright", short: "SKILL", verb: "agent skill" },
  project: { name: "Showsteps file", line: "Reopen and edit later", short: "FILE", verb: "file" },
};

const PREFS_KEY = "exportPrefs";
interface Prefs {
  format: ExportFormat;
  color: string;
  dim: boolean;
  urls: boolean;
  hidden: boolean;
}
const DEFAULT_PREFS: Prefs = { format: "pdf", color: SWATCHES[0].value, dim: true, urls: true, hidden: false };

function Switch({ id, label, checked, onChange }: { id: string; label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="opt-row">
      <span id={id}>{label}</span>
      <button type="button" role="switch" className="switch" aria-checked={checked} aria-labelledby={id} onClick={() => onChange(!checked)} />
    </div>
  );
}

interface ExportSheetProps {
  open: boolean;
  guide: Guide | undefined;
  onClose: () => void;
  /** Save pending edits before exporting. */
  beforeExport?: () => Promise<void>;
  /** "sheet" slides up from the bottom (side panel); "dialog" is centred (editor tab). */
  variant?: "sheet" | "dialog";
}

type Phase =
  | { kind: "choose" }
  | { kind: "busy"; done: number; total: number }
  | { kind: "saved"; filename: string; format: ExportFormat | "copy"; support: boolean };

export function ExportSheet({ open, guide, onClose, beforeExport, variant = "dialog" }: ExportSheetProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const [prefs, setPrefs] = useState<Prefs>(DEFAULT_PREFS);
  const [phase, setPhase] = useState<Phase>({ kind: "choose" });
  const [error, setError] = useState<string>();

  useEffect(() => {
    void chrome.storage.local.get(PREFS_KEY).then((r) => r[PREFS_KEY] && setPrefs({ ...DEFAULT_PREFS, ...(r[PREFS_KEY] as Partial<Prefs>) }));
  }, []);
  const update = (p: Partial<Prefs>) => {
    const next = { ...prefs, ...p };
    setPrefs(next);
    void chrome.storage.local.set({ [PREFS_KEY]: next });
  };

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      setError(undefined);
      setPhase({ kind: "choose" });
      d.showModal();
    } else if (!open && d.open) d.close();
  }, [open]);

  const run = async (format: ExportFormat | "copy") => {
    if (!guide || phase.kind === "busy") return;
    setError(undefined);
    setPhase({ kind: "busy", done: 0, total: 0 });
    try {
      await beforeExport?.();
      // The exporters (pdf-lib, docx) load only when someone exports.
      const { download, exportGuide, markdownText } = await import("../lib/export");
      let filename: string;
      if (format === "copy") {
        await navigator.clipboard.writeText(await markdownText(guide));
        filename = "Paste it anywhere Markdown works";
      } else {
        const blobs = await getImages(guide.id);
        const file = await exportGuide(format, guide, blobs, {
          color: prefs.color,
          dim: prefs.dim,
          includeUrls: prefs.urls,
          includeHidden: prefs.hidden,
          onProgress: (done, total) => setPhase({ kind: "busy", done, total }),
        });
        download(file);
        filename = file.filename;
      }
      const support = await recordExport().catch(() => false);
      setPhase({ kind: "saved", filename, format, support });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPhase({ kind: "choose" });
    }
  };

  const tile = TILE_TEXT[prefs.format];
  const busy = phase.kind === "busy";

  return (
    <dialog ref={ref} className={`export export-${variant}`} aria-labelledby="export-title" onClose={onClose} onCancel={onClose}>
      <div className="export-head">
        <h2 id="export-title">Export guide</h2>
        <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
          <IconClose />
        </button>
      </div>

      {phase.kind === "saved" ? (
        <div className="export-body" aria-live="polite">
          <div className="saved-row">
            <span className="file-glyph mono" aria-hidden>
              {phase.format === "copy" ? "MD" : TILE_TEXT[phase.format].short}
            </span>
            <div className="saved-text">
              <strong>{phase.format === "copy" ? "Markdown copied" : "Guide saved"}</strong>
              <span className="mono muted">{phase.filename}</span>
            </div>
            <button type="button" className="btn" onClick={() => setPhase({ kind: "choose" })}>
              Export another
            </button>
          </div>
          {phase.support && (
            <section className="support-card" aria-labelledby="support-h">
              <h3 id="support-h">{SUPPORT_HEADING}</h3>
              <p>{SUPPORT_BODY}</p>
              <div className="support-actions">
                <a className="btn btn-primary" href={SUPPORT_URL} target="_blank" rel="noopener noreferrer">
                  Support Showsteps
                </a>
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => {
                    void recordNotNow();
                    setPhase({ ...phase, support: false });
                  }}
                >
                  Not now
                </button>
              </div>
            </section>
          )}
          <ul className="next-actions">
            {phase.format !== "copy" && (
              <li>
                <button type="button" onClick={() => void run("copy")}>
                  <IconCopy /> Copy the guide as Markdown
                </button>
              </li>
            )}
            {phase.format !== "skill" && (
              <li>
                <button type="button" onClick={() => void run("skill")}>
                  <IconCode /> Also export as an agent skill
                </button>
              </li>
            )}
          </ul>
        </div>
      ) : (
        <div className="export-body">
          <div className="tiles" role="radiogroup" aria-label="Format">
            {FORMATS.map((f) => {
              const t = TILE_TEXT[f.id];
              const on = prefs.format === f.id;
              return (
                <button
                  key={f.id}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  className="tile"
                  data-format={f.id}
                  onClick={() => update({ format: f.id })}
                  disabled={busy}
                >
                  <span className="tile-name">{t.name}</span>
                  <span className="tile-line">{t.line}</span>
                  {on && <span className="tile-dot" aria-hidden />}
                </button>
              );
            })}
          </div>

          <div className="opts">
            <div className="opt-row">
              <span id="swatch-label">Highlight</span>
              <div className="swatches" role="radiogroup" aria-labelledby="swatch-label">
                {SWATCHES.map((s) => (
                  <button
                    key={s.value}
                    type="button"
                    role="radio"
                    aria-checked={prefs.color === s.value}
                    aria-label={s.name}
                    className="swatch"
                    style={{ background: s.value }}
                    onClick={() => update({ color: s.value })}
                  />
                ))}
              </div>
            </div>
            <Switch id="opt-dim" label="Dim around the highlight" checked={prefs.dim} onChange={(dim) => update({ dim })} />
            <Switch id="opt-urls" label="Show page addresses" checked={prefs.urls} onChange={(urls) => update({ urls })} />
            <Switch id="opt-hidden" label="Include hidden steps" checked={prefs.hidden} onChange={(hidden) => update({ hidden })} />
          </div>

          {error && (
            <p className="error" role="alert">
              Export failed: {error}
            </p>
          )}

          <div className="export-foot">
            <button type="button" className="btn" onClick={() => void run("copy")} disabled={busy || !guide}>
              Copy as Markdown
            </button>
            <button type="button" className="btn btn-primary export-go" data-testid="export-go" onClick={() => void run(prefs.format)} disabled={busy || !guide}>
              {busy ? (
                <>
                  <span className="progress" aria-hidden>
                    <span style={{ width: phase.total ? `${(phase.done / phase.total) * 100}%` : "8%" }} />
                  </span>
                  <span role="status">{phase.total ? `Rendering ${phase.done} of ${phase.total}` : "Preparing…"}</span>
                </>
              ) : (
                <>
                  Export {tile.verb} <IconDownload />
                </>
              )}
            </button>
          </div>
        </div>
      )}
    </dialog>
  );
}

export function EditToastView({ toast, onUndo, onDismiss }: { toast?: EditToast; onUndo: () => void; onDismiss: () => void }) {
  return (
    <div role="status" aria-live="polite">
      {toast && (
        <div className="toast" key={toast.id}>
          <span>{toast.message}</span>
          {toast.undo && (
            <button
              type="button"
              onClick={() => {
                onUndo();
                onDismiss();
              }}
            >
              Undo
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export function SimpleToast({ message }: { message?: string }) {
  return (
    <div role="status" aria-live="polite">
      {message && <div className="toast">{message}</div>}
    </div>
  );
}

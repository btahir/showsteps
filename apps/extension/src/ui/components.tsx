// Shared UI pieces: inline-Markdown title, export dialog, support moment.
import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { Guide } from "@stepsnap/core";
import { FORMATS } from "../lib/formats";
import type { ExportFormat } from "../lib/formats";
import { getImages } from "../lib/db";
import { SUPPORT_PITCH, SUPPORT_URL } from "../config";
import { IconClose, IconCopy, IconHeart } from "./icons";

/** Renders `**bold**` (the only inline Markdown step titles use) without HTML injection. */
export function MdInline({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g).filter(Boolean);
  return (
    <>
      {parts.map((p, i) =>
        p.startsWith("**") && p.endsWith("**") && p.length > 4 ? <strong key={i}>{p.slice(2, -2)}</strong> : <span key={i}>{p}</span>,
      )}
    </>
  );
}

export function plain(text: string): string {
  return text.replace(/\*\*([^*]+)\*\*/g, "$1");
}

export function SupportMoment({ onClose }: { onClose: () => void }) {
  return (
    <section className="support-moment" aria-labelledby="support-title">
      <p id="support-title">
        <strong>Export saved.</strong> {SUPPORT_PITCH}
      </p>
      <div className="row">
        <a className="btn btn-primary" href={SUPPORT_URL} target="_blank" rel="noopener noreferrer">
          <IconHeart /> Support Showsteps
        </a>
        <button type="button" className="btn btn-ghost" onClick={onClose}>
          Not now
        </button>
      </div>
    </section>
  );
}

interface ExportDialogProps {
  open: boolean;
  guide: Guide | undefined;
  onClose: () => void;
  /** Called before exporting so pending edits are saved. */
  beforeExport?: () => Promise<void>;
  toast?: (m: string) => void;
}

export function ExportDialog({ open, guide, onClose, beforeExport, toast }: ExportDialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const [busy, setBusy] = useState<ExportFormat | "copy" | null>(null);
  const [error, setError] = useState<string>();
  const [support, setSupport] = useState(false);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      setError(undefined);
      setSupport(false);
      d.showModal();
    } else if (!open && d.open) d.close();
  }, [open]);

  const run = async (format: ExportFormat | "copy") => {
    if (!guide || busy) return;
    setBusy(format);
    setError(undefined);
    setSupport(false);
    try {
      await beforeExport?.();
      // The exporters (pdf-lib, docx) load only when someone exports.
      const { download, exportGuide, markdownText } = await import("../lib/export");
      if (format === "copy") {
        await navigator.clipboard.writeText(await markdownText(guide));
        toast?.("Markdown copied");
      } else {
        const blobs = await getImages(guide.id);
        const file = await exportGuide(format, guide, blobs);
        download(file);
        toast?.(`Saved ${file.filename}`);
      }
      // One support moment per successful export.
      setSupport(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const visible = guide ? guide.steps.filter((s) => !s.skipped).length : 0;

  return (
    <dialog ref={ref} className="modal" aria-labelledby="export-title" onClose={onClose} onCancel={onClose}>
      <div className="modal-head">
        <h2 id="export-title">Export guide</h2>
        <button type="button" className="icon-btn" onClick={onClose} aria-label="Close export dialog">
          <IconClose />
        </button>
      </div>
      <div className="modal-body">
        <p className="muted" style={{ margin: 0 }}>
          {visible} {visible === 1 ? "step" : "steps"}. Blurred areas are burned into the exported pixels.
        </p>
        <div className="format-grid" role="group" aria-label="Export formats">
          {FORMATS.map((f) => (
            <button
              key={f.id}
              type="button"
              className="format"
              onClick={() => void run(f.id)}
              disabled={!!busy || !guide}
              aria-busy={busy === f.id}
              data-format={f.id}
            >
              <strong>
                {f.label} <span aria-hidden>{f.ext}</span>
              </strong>
              <span>{busy === f.id ? "Preparing…" : f.hint}</span>
            </button>
          ))}
          <button type="button" className="format" onClick={() => void run("copy")} disabled={!!busy || !guide} data-format="copy">
            <strong>
              <IconCopy width={14} height={14} style={{ verticalAlign: "-2px" }} /> Copy as Markdown
            </strong>
            <span>{busy === "copy" ? "Copying…" : "Paste into docs or a ticket"}</span>
          </button>
        </div>
        {error && (
          <p className="error" role="alert">
            Export failed: {error}
          </p>
        )}
        <div aria-live="polite">{support && <SupportMoment onClose={() => setSupport(false)} />}</div>
      </div>
    </dialog>
  );
}

export function Toast({ message }: { message?: string }) {
  return (
    <div aria-live="polite" role="status">
      {message && <div className="toast">{message}</div>}
    </div>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <strong>{title}</strong>
      {children}
    </div>
  );
}


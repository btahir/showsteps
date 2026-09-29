// Full-tab editor (SPEC §5): the same components as the side panel, with the step list on the
// left and the selected step's screenshot large on the right.
import { useEffect, useState } from "react";
import { APP_NAME } from "../../config";
import { useLibrary, useSession } from "../../ui/hooks";
import { relTime } from "../../ui/GuideView";
import { useGuideAssets } from "../../ui/useGuideAssets";
import { useGuideEditor } from "../../ui/useGuideEditor";
import { GuideHeader, GuideView } from "../../ui/GuideView";
import { EditToastView, ExportSheet } from "../../ui/components";
import { useTheme } from "../../ui/theme";
import { BrandIcon, BrandMark, IconDownload, IconRedo, IconUndo } from "../../ui/icons";

const params = new URLSearchParams(location.search);
const GUIDE_ID = params.get("guide") ?? undefined;
const OPEN_EXPORT = params.get("export") === "1";

export function App() {
  useTheme();
  const ed = useGuideEditor(GUIDE_ID);
  const session = useSession();
  const assets = useGuideAssets(ed, GUIDE_ID);
  const [exportOpen, setExportOpen] = useState(OPEN_EXPORT);
  const recording = session.guideId === GUIDE_ID && (session.status === "recording" || session.status === "paused");

  useEffect(() => {
    if (ed.guide) document.title = `${ed.guide.title} · ${APP_NAME}`;
  }, [ed.guide?.title]);

  if (!GUIDE_ID || ed.missing) return <MissingGuide />;
  if (!ed.guide) return <main className="editor-loading" aria-busy="true" />;

  return (
    <div className="editor">
      <header className="ed-bar">
        <span className="ed-brand">
          <BrandIcon size={24} /> {APP_NAME}
        </span>
        <span className="ed-save muted" role="status" aria-live="polite">
          {recording ? "Recording…" : ed.saveState === "saved" ? "Saved on this computer" : ed.saveState === "saving" ? "Saving…" : "Unsaved changes"}
        </span>
        <span className="spacer" />
        <button type="button" className="icon-btn" onClick={ed.undo} disabled={!ed.canUndo} aria-label="Undo" title="Undo (Ctrl+Z)" aria-keyshortcuts="Control+Z Meta+Z">
          <IconUndo />
        </button>
        <button type="button" className="icon-btn" onClick={ed.redo} disabled={!ed.canRedo} aria-label="Redo" title="Redo (Ctrl+Shift+Z)" aria-keyshortcuts="Control+Shift+Z Meta+Shift+Z">
          <IconRedo />
        </button>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => {
            void ed.save();
            setExportOpen(true);
          }}
          disabled={!ed.guide.steps.length}
        >
          Export <IconDownload />
        </button>
      </header>
      <GuideView ed={ed} assets={assets} layout="tab" recording={recording} header={<GuideHeader ed={ed} />} />
      <ExportSheet open={exportOpen} guide={ed.guide} onClose={() => setExportOpen(false)} beforeExport={ed.save} />
      <EditToastView toast={ed.toast} onUndo={ed.undo} onDismiss={ed.dismissToast} />
    </div>
  );
}

/** No guide id, or it was deleted: say so, and offer the library right here (review #31). */
function MissingGuide() {
  const { guides } = useLibrary();
  const [open, setOpen] = useState(false);
  return (
    <main className="editor-missing">
      <BrandMark size={72} />
      <h1>Guide not found</h1>
      <p className="muted">It may have been deleted, or this link is from another browser.</p>
      {!open ? (
        <button type="button" className="btn btn-primary" onClick={() => setOpen(true)} disabled={!guides.length}>
          {guides.length ? "See your guides" : "No guides yet"}
        </button>
      ) : (
        <ul className="missing-list" aria-label="Your guides">
          {guides.map((g) => (
            <li key={g.id}>
              <a href={`editor.html?guide=${encodeURIComponent(g.id)}`}>
                <span className="missing-title">{g.title}</span>
                <span className="muted small num">
                  {g.stepCount} {g.stepCount === 1 ? "step" : "steps"} · recorded {relTime(g.createdAt)}
                  {g.domain ? ` · ${g.domain}` : ""}
                </span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

import { useEffect, useRef, useState } from "react";
import type { Step } from "@stepsnap/core";
import { deleteGuide, mutateGuide } from "../../lib/db";
import { deleteStep } from "../../lib/guide-ops";
import { APP_NAME, PROJECT_EXT, SITE_URL, SUPPORT_URL } from "../../config";
import { openEditor, send, useGuide, useImageUrls, useLibrary, useSession, useToast } from "../../ui/hooks";
import { ExportDialog, MdInline, plain, Toast } from "../../ui/components";
import { StepImage } from "../../ui/StepImage";
import {
  BrandMark,
  IconEdit,
  IconExternal,
  IconHeart,
  IconLock,
  IconPause,
  IconPlay,
  IconRecord,
  IconStop,
  IconTrash,
  IconUpload,
} from "../../ui/icons";

const ALL_URLS = { origins: ["<all_urls>"] };

function relTime(iso: string): string {
  const d = new Date(iso);
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} h ago`;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function App() {
  const session = useSession();
  const [lastGuideId, setLastGuideId] = useState<string>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [toast, showToast] = useToast();
  const recordingGuide = session.status !== "idle" ? session.guideId : undefined;
  const activeId = recordingGuide ?? lastGuideId;

  useEffect(() => {
    chrome.storage.session
      .get("lastGuideId")
      .then((r) => typeof r.lastGuideId === "string" && setLastGuideId(r.lastGuideId))
      .catch(() => {});
  }, [session.status]);

  const record = async () => {
    setError(undefined);
    setBusy(true);
    try {
      // Must run inside the click: Chrome only shows the permission prompt for a user gesture.
      const granted = (await chrome.permissions.contains(ALL_URLS)) || (await chrome.permissions.request(ALL_URLS));
      if (!granted) {
        setError(`${APP_NAME} needs to see the pages you record to take screenshots. Nothing leaves this device.`);
        return;
      }
      const win = await chrome.windows.getCurrent();
      const r = await send({ type: "ctl:start", windowId: win.id! });
      if (!r?.ok) setError(r?.error ?? "Could not start recording");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const stop = async () => {
    setBusy(true);
    const id = session.guideId;
    try {
      await send({ type: "ctl:stop" });
      if (id) setLastGuideId(id);
    } finally {
      setBusy(false);
    }
  };

  const status = session.status;
  const isRec = status === "recording" || status === "paused" || status === "stopping";

  return (
    <div className="panel">
      <header className="panel-head">
        <span className="brand">
          <BrandMark /> {APP_NAME}
        </span>
        {isRec && (
          <span className={`rec-pill rec-${status}`} role="status">
            <span className="rec-dot" aria-hidden /> {status === "paused" ? "Paused" : status === "stopping" ? "Finishing…" : "Recording"}
          </span>
        )}
      </header>

      {isRec ? (
        <section className="controls" aria-label="Recording controls">
          {status === "paused" ? (
            <button type="button" className="btn btn-lg btn-record" onClick={() => void send({ type: "ctl:resume" })} disabled={busy}>
              <IconPlay /> Resume
            </button>
          ) : (
            <button type="button" className="btn btn-lg" onClick={() => void send({ type: "ctl:pause" })} disabled={busy || status === "stopping"}>
              <IconPause /> Pause
            </button>
          )}
          <button type="button" className="btn btn-lg btn-primary" onClick={() => void stop()} disabled={busy || status === "stopping"}>
            <IconStop /> Stop
          </button>
        </section>
      ) : (
        <section className="controls controls-idle" aria-label="Start">
          <button type="button" className="btn btn-lg btn-record record-main" onClick={() => void record()} disabled={busy}>
            <IconRecord /> Record a guide
          </button>
          <p className="muted hint">
            Click through your task in this window, across as many tabs as you need. Each click, entry and page becomes a step.
          </p>
        </section>
      )}

      {error && (
        <p className="error panel-error" role="alert">
          {error}
        </p>
      )}

      {activeId && (
        <CurrentGuide
          guideId={activeId}
          recording={isRec}
          paused={status === "paused"}
          onExport={() => setExportOpen(true)}
          onDismiss={() => {
            setLastGuideId(undefined);
            void chrome.storage.session.remove("lastGuideId");
          }}
        />
      )}

      {!isRec && <Library currentId={activeId} toast={showToast} onDeleted={(id) => id === lastGuideId && setLastGuideId(undefined)} />}

      {!isRec && <Settings />}

      <ExportGuideDialog guideId={activeId} open={exportOpen} onClose={() => setExportOpen(false)} toast={showToast} />
      <Toast message={toast} />
    </div>
  );
}

function ExportGuideDialog({ guideId, open, onClose, toast }: { guideId?: string; open: boolean; onClose: () => void; toast: (m: string) => void }) {
  const { guide } = useGuide(open ? guideId : undefined);
  return <ExportDialog open={open && !!guide} guide={guide} onClose={onClose} toast={toast} />;
}

function CurrentGuide({
  guideId,
  recording,
  paused,
  onExport,
  onDismiss,
}: {
  guideId: string;
  recording: boolean;
  paused: boolean;
  onExport: () => void;
  onDismiss: () => void;
}) {
  const { guide, reload } = useGuide(guideId);
  const urls = useImageUrls(guideId, guide?.updatedAt);
  const listRef = useRef<HTMLOListElement>(null);
  const count = guide?.steps.length ?? 0;

  useEffect(() => {
    if (recording) listRef.current?.lastElementChild?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [count, recording]);

  if (!guide) return null;
  const steps = guide.steps;

  const remove = async (s: Step) => {
    await mutateGuide(guideId, (g) => deleteStep(g, s.id));
    await reload();
    chrome.runtime.sendMessage({ type: "bc:guide", guideId }).catch(() => {});
  };

  return (
    <section className="current" aria-labelledby="current-title">
      <div className="current-head">
        <div>
          <h2 id="current-title" className="current-title">
            {guide.title}
          </h2>
          <p className="muted small" aria-live="polite">
            {count} {count === 1 ? "step" : "steps"}
            {recording ? (paused ? " · paused, actions are not recorded" : " · recording") : ""}
          </p>
        </div>
        {!recording && (
          <button type="button" className="icon-btn" aria-label="Close this guide" title="Close" onClick={onDismiss}>
            <span aria-hidden>×</span>
          </button>
        )}
      </div>
      {!recording && count > 0 && (
        <div className="current-actions">
          <button type="button" className="btn btn-primary" onClick={() => void openEditor(guideId)}>
            <IconEdit /> Edit guide
          </button>
          <button type="button" className="btn" onClick={onExport}>
            Export…
          </button>
        </div>
      )}
      {count === 0 ? (
        <p className="muted empty-steps">{recording ? "Waiting for your first click…" : "No steps were recorded."}</p>
      ) : (
        <ol className="live-steps" ref={listRef} aria-label="Recorded steps">
          {steps.map((s, i) => (
            <li key={s.id} className={`live-step${s.skipped ? " is-skipped" : ""}`}>
              <div className="live-thumb">
                <StepImage step={s} src={s.screenshot ? urls[s.screenshot.image] : undefined} compact alt={`Screenshot for step ${i + 1}`} />
              </div>
              <div className="live-text">
                <span className="live-num">{i + 1}</span>
                <span className="title-md">
                  <MdInline text={s.title} />
                </span>
              </div>
              <button
                type="button"
                className="icon-btn live-del"
                aria-label={`Delete step ${i + 1}: ${plain(s.title)}`}
                title="Delete step"
                onClick={() => void remove(s)}
              >
                <IconTrash />
              </button>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function Library({ currentId, toast, onDeleted }: { currentId?: string; toast: (m: string) => void; onDeleted: (id: string) => void }) {
  const { guides, reload } = useLibrary();
  const fileRef = useRef<HTMLInputElement>(null);
  const others = guides.filter((g) => g.id !== currentId);

  const onImport = async (file: File | undefined) => {
    if (!file) return;
    try {
      const { importProject } = await import("../../lib/import");
      const id = await importProject(file);
      await reload();
      toast("Project imported");
      await openEditor(id);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Import failed");
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const remove = async (id: string, title: string) => {
    if (!confirm(`Delete "${title}"? This removes it from this browser.`)) return;
    await deleteGuide(id);
    onDeleted(id);
    await reload();
    toast("Guide deleted");
  };

  return (
    <section className="library" aria-labelledby="library-title">
      <div className="section-head">
        <h2 id="library-title">Your guides</h2>
        <button type="button" className="btn btn-sm btn-ghost" onClick={() => fileRef.current?.click()}>
          <IconUpload /> Import
        </button>
        <input
          ref={fileRef}
          type="file"
          accept={`${PROJECT_EXT},.stepsnap,.zip`}
          className="sr-only"
          aria-label={`Import a ${PROJECT_EXT} project`}
          tabIndex={-1}
          onChange={(e) => void onImport(e.target.files?.[0])}
        />
      </div>
      {others.length === 0 ? (
        <p className="muted small">Guides you record or import are kept here, in this browser only.</p>
      ) : (
        <ul className="lib-list">
          {others.map((g) => (
            <li key={g.id} className="lib-item">
              <button type="button" className="lib-open" onClick={() => void openEditor(g.id)}>
                <span className="lib-title">{g.title}</span>
                <span className="muted small">
                  {g.stepCount} {g.stepCount === 1 ? "step" : "steps"} · {relTime(g.updatedAt)}
                </span>
              </button>
              <button type="button" className="icon-btn" aria-label={`Delete guide ${g.title}`} title="Delete guide" onClick={() => void remove(g.id, g.title)}>
                <IconTrash />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Settings() {
  const version = chrome.runtime.getManifest().version;
  return (
    <details className="settings">
      <summary>Settings and privacy</summary>
      <div className="settings-body">
        <p className="privacy">
          <IconLock /> Screenshots and guides stay in this browser. {APP_NAME} makes no network requests and has no account.
        </p>
        <p className="muted small">
          Password, card, one-time-code and similar fields are blurred automatically, including inside frames and shadow DOM. Mark
          any element with <code>data-showsteps-sensitive</code> to blur it too.
        </p>
        <div className="settings-links">
          <a className="btn btn-sm" href={SUPPORT_URL} target="_blank" rel="noopener noreferrer">
            <IconHeart /> Support {APP_NAME}
          </a>
          <a className="btn btn-sm btn-ghost" href={SITE_URL} target="_blank" rel="noopener noreferrer">
            Website <IconExternal />
          </a>
        </div>
        <p className="muted small">Version {version}</p>
      </div>
    </details>
  );
}


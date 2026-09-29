// Side panel (SPEC §2, §3, §7): library, the guide being recorded or reviewed, settings.
import { useEffect, useRef, useState } from "react";
import { deleteGuide, getImage } from "../../lib/db";
import type { GuideSummary } from "../../lib/db";
import { APP_NAME, PROJECT_EXT, SITE_URL, SUPPORT_URL } from "../../config";
import { openEditor, send, useLibrary, useSession, useToast } from "../../ui/hooks";
import { useGuideAssets } from "../../ui/useGuideAssets";
import { useGuideEditor } from "../../ui/useGuideEditor";
import { GuideHeader, GuideView, relTime } from "../../ui/GuideView";
import { EditToastView, ExportSheet, SimpleToast } from "../../ui/components";
import { useTheme } from "../../ui/theme";
import { loadRedactPrefs, saveRedactPrefs } from "../../lib/prefs";
import type { RedactPrefs } from "../../lib/prefs";
import type { ThemePref } from "../../ui/theme";
import {
  BrandIcon,
  BrandMark,
  IconChevron,
  IconClose,
  IconCopy,
  IconDownload,
  IconExternal,
  IconHeart,
  IconLock,
  IconPause,
  IconPlay,
  IconSettings,
  IconTrash,
  IconUpload,
} from "../../ui/icons";

const ALL_URLS = { origins: ["<all_urls>"] };

type View = { kind: "library" } | { kind: "guide"; id: string } | { kind: "settings" };

export function App() {
  const session = useSession();
  const { guides, reload } = useLibrary();
  const [view, setView] = useState<View>();
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [toast, showToast] = useToast();
  useTheme();
  const recording = session.status === "recording" || session.status === "paused" || session.status === "stopping";

  // Pick the first view: the recording, the guide just recorded, or the library.
  useEffect(() => {
    if (recording && session.guideId) {
      setView({ kind: "guide", id: session.guideId });
      return;
    }
    if (view) return;
    void chrome.storage.session
      .get("lastGuideId")
      .then((r) => setView(typeof r.lastGuideId === "string" ? { kind: "guide", id: r.lastGuideId } : { kind: "library" }))
      .catch(() => setView({ kind: "library" }));
  }, [recording, session.guideId, view]);

  const record = async (appendTo?: string) => {
    setError(undefined);
    setNotice(undefined);
    setBusy(true);
    try {
      // First awaited call in the click handler, so Chrome still sees the user gesture.
      let allSites = false;
      try {
        allSites = await chrome.permissions.request(ALL_URLS);
      } catch {
        allSites = false;
      }
      const win = await chrome.windows.getCurrent();
      const r = await send({ type: "ctl:start", windowId: win.id!, guideId: appendTo });
      if (!r?.ok) setError(r?.error ?? "Could not start recording.");
      else if (!allSites) setNotice("Recording this tab only. Allow all sites to follow you across tabs and sites.");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const openFile = useRef<HTMLInputElement>(null);
  const onImport = async (file: File | undefined) => {
    if (!file) return;
    try {
      const { importProject } = await import("../../lib/import");
      const id = await importProject(file);
      await reload();
      showToast("Guide opened");
      setView({ kind: "guide", id });
    } catch (e) {
      showToast(e instanceof Error ? e.message : "That file could not be opened.");
    } finally {
      if (openFile.current) openFile.current.value = "";
    }
  };

  const topBar = (
    <nav className="topbar" aria-label="Panel">
      <BrandIcon size={22} />
      {view?.kind !== "library" && !recording ? (
        <button type="button" className="crumb" onClick={() => setView({ kind: "library" })}>
          Guides <IconChevron />
        </button>
      ) : (
        <span className="crumb crumb-static">{recording ? APP_NAME : "Guides"}</span>
      )}
      <span className="spacer" />
      {view?.kind === "guide" && !recording && (
        <button type="button" className="icon-btn" aria-label="Open in the full editor" title="Open in the full editor" onClick={() => void openEditor(view.id)}>
          <IconExternal />
        </button>
      )}
      {!recording && (
        <button
          type="button"
          className="icon-btn"
          aria-label="Settings"
          aria-pressed={view?.kind === "settings"}
          onClick={() => setView(view?.kind === "settings" ? { kind: "library" } : { kind: "settings" })}
        >
          <IconSettings />
        </button>
      )}
    </nav>
  );

  const fileInput = (
    <input
      ref={openFile}
      type="file"
      accept={`${PROJECT_EXT},.stepsnap,.zip`}
      className="sr-only"
      tabIndex={-1}
      aria-label={`Open a ${PROJECT_EXT} file`}
      onChange={(e) => void onImport(e.target.files?.[0])}
    />
  );

  let body: React.ReactNode = null;
  if (!view) body = null;
  else if (view.kind === "settings") body = <Settings />;
  else if (view.kind === "guide")
    body = (
      <GuidePane
        key={view.id}
        guideId={view.id}
        session={session}
        busy={busy}
        onRecordMore={() => void record(view.id)}
        onMissing={() => setView({ kind: "library" })}
        showToast={showToast}
      />
    );
  else if (guides.length === 0)
    body = (
      <section className="empty" aria-labelledby="empty-title">
        <BrandMark size={88} />
        <h1 id="empty-title">Show it once</h1>
        <p>Press Record and do the task the way you always do. Every click becomes a step with its own marked screenshot.</p>
        <button type="button" className="btn btn-primary btn-lg btn-block" onClick={() => void record()} disabled={busy}>
          <span className="rec-ring" aria-hidden /> Start recording
        </button>
        <p className="muted small">
          While recording, <kbd className="kbd">Alt</kbd> <kbd className="kbd">Shift</kbd> <kbd className="kbd">P</kbd> pauses and{" "}
          <kbd className="kbd">Alt</kbd> <kbd className="kbd">Shift</kbd> <kbd className="kbd">S</kbd> stops
        </p>
        <p className="small">
          Have a {PROJECT_EXT} file?{" "}
          <button type="button" className="link-btn" onClick={() => openFile.current?.click()}>
            Open it
          </button>
        </p>
        <p className="privacy-line">
          <IconLock /> Screenshots never leave this computer.
        </p>
      </section>
    );
  else
    body = (
      <Library
        guides={guides}
        onOpen={(id) => setView({ kind: "guide", id })}
        onDeleted={async () => {
          await reload();
          showToast("Guide deleted");
        }}
        onRecord={() => void record()}
        onImport={() => openFile.current?.click()}
        busy={busy}
      />
    );

  return (
    <div className="panel">
      {topBar}
      {error && (
        <p className="panel-alert error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="panel-alert notice-warn" role="status">
          {notice}
        </p>
      )}
      {body}
      {fileInput}
      <SimpleToast message={toast} />
    </div>
  );
}

function GuidePane({
  guideId,
  session,
  busy,
  onRecordMore,
  onMissing,
  showToast,
}: {
  guideId: string;
  session: ReturnType<typeof useSession>;
  busy: boolean;
  onRecordMore: () => void;
  onMissing: () => void;
  showToast: (m: string) => void;
}) {
  const ed = useGuideEditor(guideId);
  const assets = useGuideAssets(ed, guideId);
  const [exportOpen, setExportOpen] = useState(false);
  const isThis = session.guideId === guideId;
  const recording = isThis && (session.status === "recording" || session.status === "paused" || session.status === "stopping");

  useEffect(() => {
    if (ed.missing) onMissing();
  }, [ed.missing, onMissing]);
  if (!ed.guide) return <div className="loading" aria-busy="true" />;

  const copy = async () => {
    const { markdownText } = await import("../../lib/export");
    await ed.save();
    await navigator.clipboard.writeText(await markdownText(ed.guide!));
    showToast("Markdown copied");
  };

  return (
    <>
      <main className="guide-pane">
        <GuideView ed={ed} assets={assets} layout="panel" recording={recording} header={<GuideHeader ed={ed} />} />
      </main>
      <footer className="panel-foot">
        {recording ? (
          <RecordingControls session={session} />
        ) : (
          <>
            <button type="button" className="btn" onClick={onRecordMore} disabled={busy}>
              <span className="rec-ring" aria-hidden /> Record more
            </button>
            <span className="spacer" />
            <button type="button" className="btn btn-ghost" onClick={() => void copy()} disabled={!ed.guide.steps.length}>
              <IconCopy /> Copy
            </button>
            <button type="button" className="btn btn-primary" onClick={() => setExportOpen(true)} disabled={!ed.guide.steps.length}>
              Export <IconDownload />
            </button>
          </>
        )}
      </footer>
      <ExportSheet open={exportOpen} guide={ed.guide} onClose={() => setExportOpen(false)} beforeExport={ed.save} variant="sheet" />
      <EditToastView toast={ed.toast} onUndo={ed.undo} onDismiss={ed.dismissToast} />
    </>
  );
}

function RecordingControls({ session }: { session: ReturnType<typeof useSession> }) {
  const paused = session.status === "paused";
  const stopping = session.status === "stopping";
  return (
    <div className="rec-controls">
      <span className={`rec-status${paused ? " is-paused" : ""}`} role="status">
        <span className="rec-dot" aria-hidden />
        {stopping ? "Finishing…" : paused ? "Paused" : "Recording"}
        <span className="flag flag-mini num" aria-label={`${session.stepCount} steps`}>
          {session.stepCount}
        </span>
      </span>
      <span className="spacer" />
      <button
        type="button"
        className="btn btn-ghost"
        aria-label={paused ? "Resume" : "Pause"}
        onClick={() => void send({ type: paused ? "ctl:resume" : "ctl:pause" })}
        disabled={stopping}
        aria-keyshortcuts="Alt+Shift+P"
      >
        {paused ? <IconPlay /> : <IconPause />} <span className="btn-label">{paused ? "Resume" : "Pause"}</span>
      </button>
      <button
        type="button"
        className="icon-btn"
        aria-label="Discard this recording"
        title="Discard"
        disabled={stopping}
        onClick={() => {
          if (confirm("Discard this recording? Its steps and screenshots will be deleted.")) void send({ type: "ctl:discard" });
        }}
      >
        <IconClose />
      </button>
      <button type="button" className="btn btn-primary" onClick={() => void send({ type: "ctl:stop" })} disabled={stopping} aria-keyshortcuts="Alt+Shift+S">
        Stop and review
      </button>
    </div>
  );
}

function LibraryThumb({ g }: { g: GuideSummary }) {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    let u: string | undefined;
    if (g.firstImage)
      void getImage(g.id, g.firstImage).then((r) => {
        if (r) setUrl((u = URL.createObjectURL(r.blob)));
      });
    return () => {
      if (u) URL.revokeObjectURL(u);
    };
  }, [g.id, g.firstImage]);
  return (
    <span className="lib-thumb" aria-hidden>
      {url && <img src={url} alt="" />}
      <span className="flag flag-mini">1</span>
    </span>
  );
}

function Library({
  guides,
  onOpen,
  onDeleted,
  onRecord,
  onImport,
  busy,
}: {
  guides: GuideSummary[];
  onOpen: (id: string) => void;
  onDeleted: () => Promise<void>;
  onRecord: () => void;
  onImport: () => void;
  busy: boolean;
}) {
  const [q, setQ] = useState("");
  const shown = q ? guides.filter((g) => g.title.toLowerCase().includes(q.toLowerCase())) : guides;
  return (
    <>
      <main className="library">
        <div className="lib-head">
          <h1>Guides</h1>
          <button type="button" className="btn btn-ghost" onClick={onImport}>
            <IconUpload /> Open file
          </button>
        </div>
        {guides.length >= 6 && (
          <>
            <label className="sr-only" htmlFor="lib-search">
              Search guides
            </label>
            <input id="lib-search" className="field" type="search" placeholder="Search guides" value={q} onChange={(e) => setQ(e.target.value)} />
          </>
        )}
        <ul className="lib-list">
          {shown.map((g) => (
            <li key={g.id} className="lib-item">
              <button type="button" className="lib-open" onClick={() => onOpen(g.id)}>
                <LibraryThumb g={g} />
                <span className="lib-text">
                  <span className="lib-title">{g.title}</span>
                  <span className="muted small num">
                    {g.stepCount} {g.stepCount === 1 ? "step" : "steps"} · {relTime(g.updatedAt)}
                  </span>
                </span>
              </button>
              <button
                type="button"
                className="icon-btn lib-del"
                aria-label={`Delete ${g.title}`}
                title="Delete"
                onClick={async () => {
                  if (!confirm(`Delete "${g.title}"? This removes it from this browser.`)) return;
                  await deleteGuide(g.id);
                  await onDeleted();
                }}
              >
                <IconTrash />
              </button>
            </li>
          ))}
        </ul>
      </main>
      <footer className="panel-foot">
        <span className="spacer" />
        <button type="button" className="btn btn-primary" onClick={onRecord} disabled={busy}>
          <span className="rec-ring" aria-hidden /> Start recording
        </button>
      </footer>
    </>
  );
}

function Settings() {
  const [theme, setTheme] = useTheme();
  const [allSites, setAllSites] = useState<boolean>();
  const [prefs, setPrefs] = useState<RedactPrefs>();
  useEffect(() => {
    void chrome.permissions.contains(ALL_URLS).then(setAllSites);
    void loadRedactPrefs().then(setPrefs);
  }, []);
  const version = chrome.runtime.getManifest().version;
  return (
    <main className="settings">
      <h1>Settings</h1>
      <div className="set-row">
        <span id="theme-label">Theme</span>
        <div className="seg seg-inline" role="radiogroup" aria-labelledby="theme-label">
          {(["system", "light", "dark"] as ThemePref[]).map((t) => (
            <button key={t} type="button" role="radio" className="seg-btn" aria-checked={theme === t} onClick={() => setTheme(t)}>
              <span>{t[0]!.toUpperCase() + t.slice(1)}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="set-row">
        <span>
          Access to all sites
          <span className="muted small block">{allSites ? "Allowed: recording follows you across tabs and sites." : "Not allowed: recording stays in one tab."}</span>
        </span>
        {allSites && (
          <button
            type="button"
            className="btn"
            onClick={async () => {
              await chrome.permissions.remove(ALL_URLS).catch(() => false);
              setAllSites(await chrome.permissions.contains(ALL_URLS));
            }}
          >
            Revoke
          </button>
        )}
      </div>
      <div className="set-row">
        <span>
          <span id="blur-emails-label">Blur email addresses</span>
          <span className="muted small block" id="blur-emails-hint">
            Card numbers, bank accounts, social security numbers and access tokens are always blurred. Emails are off because guides often need them.
          </span>
        </span>
        <button
          type="button"
          role="switch"
          className="switch"
          aria-labelledby="blur-emails-label"
          aria-describedby="blur-emails-hint"
          aria-checked={!!prefs?.emails}
          disabled={!prefs}
          onClick={async () => {
            const next = { emails: !prefs?.emails };
            setPrefs(next);
            await saveRedactPrefs(next);
          }}
        />
      </div>
      <p className="privacy-line">
        <IconLock /> Screenshots and guides stay in this browser. {APP_NAME} makes no network requests and has no account.
      </p>
      <p className="muted small">
        Password, card, one-time-code and similar fields are blurred automatically, including inside frames and shadow DOM. Mark any element with{" "}
        <code>data-showsteps-sensitive</code> to blur it too.
      </p>
      <a className="set-link" href={SUPPORT_URL} target="_blank" rel="noopener noreferrer">
        <IconHeart /> Support {APP_NAME}
      </a>
      <a className="set-link" href={SITE_URL} target="_blank" rel="noopener noreferrer">
        <IconExternal /> Website and help
      </a>
      <p className="muted small mono">Version {version}</p>
    </main>
  );
}

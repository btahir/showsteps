// Side panel (SPEC §2, §3, §7): library, the guide being recorded or reviewed, settings.
import { useEffect, useRef, useState } from "react";
import { deleteGuide, getImage, setInterrupted } from "../../lib/db";
import type { GuideSummary } from "../../lib/db";
import { APP_NAME, PROJECT_EXT, SITE_URL, SUPPORT_URL } from "../../config";
import { openEditor, send, useLibrary, useSession, useToast } from "../../ui/hooks";
import { useGuideAssets } from "../../ui/useGuideAssets";
import { useGuideEditor } from "../../ui/useGuideEditor";
import { GuideHeader, GuideView, relTime } from "../../ui/GuideView";
import { StepImage } from "../../ui/StepImage";
import { EditToastView, ExportSheet, SimpleToast } from "../../ui/components";
import { useTheme } from "../../ui/theme";
import { loadExportPrefs, loadRedactPrefs, saveExportPrefs, saveRedactPrefs } from "../../lib/prefs";
import type { ExportPrefs, RedactPrefs } from "../../lib/prefs";
import type { ThemePref } from "../../ui/theme";

/** "840 KB", "1.2 MB": the library's size column. */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Redaction presets in Settings (PLAN §3.7). IP and MAC addresses are on by default, phones and emails off. */
const REDACT_SWITCHES: { key: keyof RedactPrefs; label: string; hint: string }[] = [
  { key: "ips", label: "Blur IP addresses", hint: "IPv4 and IPv6 addresses shown on the page. On by default." },
  { key: "macs", label: "Blur MAC addresses", hint: "Network hardware addresses. On by default." },
  { key: "phones", label: "Blur phone numbers", hint: "Off by default: support numbers are often part of a guide." },
  { key: "emails", label: "Blur email addresses", hint: "Off by default because guides often need them." },
];
import {
  BrandIcon,
  BrandMark,
  IconChevronLeft,
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
const BLOCKED_NOTICE = "Chrome doesn't let extensions record this page. Switch to a normal tab to keep going.";
const WAITING = "Waiting for Chrome…";

type View = { kind: "library" } | { kind: "guide"; id: string } | { kind: "settings" };

export function App() {
  const session = useSession();
  const { guides, reload } = useLibrary();
  const [view, setView] = useState<View>();
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [busy, setBusy] = useState(false);
  /** Chrome's "allow on all sites" prompt is open (Record was pressed without the permission). */
  const [asking, setAsking] = useState(false);
  const [toast, showToast] = useToast();
  useTheme();
  const recording = session.status === "recording" || session.status === "paused" || session.status === "stopping";

  // Pick the first view: the recording, the guide just recorded, or the library.
  useEffect(() => {
    if (recording && session.guideId) {
      // Same view object when nothing changed, or this effect would loop.
      if (view?.kind !== "guide" || view.id !== session.guideId) setView({ kind: "guide", id: session.guideId });
      return;
    }
    if (view) return;
    void chrome.storage.session
      .get("lastGuideId")
      .then((r) => setView(typeof r.lastGuideId === "string" ? { kind: "guide", id: r.lastGuideId } : { kind: "library" }))
      .catch(() => setView({ kind: "library" }));
  }, [recording, session.guideId, view]);

  // Recording ended without Stop (site access withdrawn): the worker leaves one line saying why.
  useEffect(() => {
    const show = (v: unknown) => {
      if (typeof v !== "string" || !v) return;
      setNotice(v);
      void chrome.storage.session.remove("stopNotice").catch(() => {});
    };
    void chrome.storage.session.get("stopNotice").then((r) => show(r.stopNotice), () => {});
    const onChange = (c: Record<string, chrome.storage.StorageChange>, area: string) => area === "session" && c.stopNotice && show(c.stopNotice.newValue);
    chrome.storage.onChanged.addListener(onChange);
    return () => chrome.storage.onChanged.removeListener(onChange);
  }, []);

  // The "can't record this page" notice goes away once a step lands or recording ends.
  useEffect(() => {
    if (!recording || session.stepCount > 0) setNotice((n) => (n === BLOCKED_NOTICE ? undefined : n));
  }, [recording, session.stepCount]);

  const record = async (appendTo?: string) => {
    setError(undefined);
    setNotice(undefined);
    setBusy(true);
    // Only say "waiting" when Chrome actually shows its prompt (it answers at once if already allowed).
    const askTimer = setTimeout(() => setAsking(true), 200);
    try {
      // First awaited call in the click handler, so Chrome still sees the user gesture.
      let allSites = false;
      try {
        allSites = await chrome.permissions.request(ALL_URLS);
      } catch {
        allSites = false;
      } finally {
        clearTimeout(askTimer);
        setAsking(false);
      }
      const win = await chrome.windows.getCurrent();
      const r = await send({ type: "ctl:start", windowId: win.id!, guideId: appendTo });
      if (!r?.ok) setError(r?.error ?? "Could not start recording.");
      else if (r.blocked) setNotice(BLOCKED_NOTICE);
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
      // Plain words in the toast; the technical reason goes to the console (review #30).
      console.warn("Showsteps: import failed", e);
      showToast(`That file isn't a ${APP_NAME} guide. Choose a ${PROJECT_EXT} file you exported.`);
    } finally {
      if (openFile.current) openFile.current.value = "";
    }
  };

  const topBar = (
    <nav className="topbar" aria-label="Panel">
      <BrandIcon size={22} />
      {recording ? (
        <span className="crumb crumb-static">Recording</span>
      ) : view && view.kind !== "library" ? (
        // A back link: chevron first (review #27). On the library itself the H1 says "Guides".
        <button type="button" className="crumb" onClick={() => setView({ kind: "library" })}>
          <IconChevronLeft /> Guides
        </button>
      ) : null}
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
        asking={asking}
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
          {asking ? WAITING : <><span className="rec-ring" aria-hidden /> Start recording</>}
        </button>
        {/* Two rows, each chord kept on one line (review #29). */}
        <dl className="shortcuts muted small" aria-label="Shortcuts while recording">
          <dt>Pause</dt>
          <dd>
            <kbd className="kbd">Alt</kbd> <kbd className="kbd">Shift</kbd> <kbd className="kbd">P</kbd>
          </dd>
          <dt>Stop</dt>
          <dd>
            <kbd className="kbd">Alt</kbd> <kbd className="kbd">Shift</kbd> <kbd className="kbd">S</kbd>
          </dd>
        </dl>
        <p className="small">
          Have a <span className="mono">{PROJECT_EXT}</span> file?{" "}
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
        asking={asking}
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
      {asking && (
        <p className="panel-alert panel-ask" role="status">
          Chrome is asking to let {APP_NAME} follow you across tabs. Choose Allow, or Deny to record just this tab.
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
  asking,
  onRecordMore,
  onMissing,
  showToast,
}: {
  guideId: string;
  session: ReturnType<typeof useSession>;
  busy: boolean;
  asking: boolean;
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
    // While recording, the guide appears with its first step; until then there is nothing to show.
    if (ed.missing && !recording) onMissing();
  }, [ed.missing, recording, onMissing]);
  if (!ed.guide) {
    if (!recording) return <div className="loading" aria-busy="true" />;
    return (
      <>
        <main className="guide-pane">
          <ol className="steps steps-panel" aria-label="Steps">
            <li className="step step-waiting" aria-live="polite">
              <span className="ring-placeholder" aria-hidden />
              <span className="muted">Click anything on the page. Steps appear here.</span>
            </li>
          </ol>
        </main>
        <footer className="panel-foot">
          <RecordingControls session={session} />
        </footer>
      </>
    );
  }

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
            <button type="button" className="btn btn-record-more" onClick={onRecordMore} disabled={busy} aria-label={asking ? WAITING : "Record more"}>
              {asking ? WAITING : <><span className="rec-ring" aria-hidden /> <span className="btn-label">Record more</span></>}
            </button>
            <span className="spacer" />
            <button type="button" className="btn btn-ghost btn-copy" onClick={() => void copy()} disabled={!ed.guide.steps.length} aria-label="Copy as Markdown">
              <IconCopy /> <span className="btn-label">Copy</span>
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
      {g.firstStep ? <StepImage step={g.firstStep} src={url} number={g.firstNumber} size="mini" frame="focus" alt="" /> : null}
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
  asking,
}: {
  guides: GuideSummary[];
  onOpen: (id: string) => void;
  onDeleted: () => Promise<void>;
  onRecord: () => void;
  onImport: () => void;
  busy: boolean;
  asking: boolean;
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
                  <span className="lib-meta muted small num">
                    <span>
                      {g.stepCount} {g.stepCount === 1 ? "step" : "steps"}
                    </span>
                    <span className="dot" aria-hidden />
                    <span>recorded {relTime(g.createdAt)}</span>
                    <span className="dot" aria-hidden />
                    <span className="lib-size">{formatSize(g.sizeBytes)}</span>
                    {g.domain && (
                      <>
                        <span className="dot" aria-hidden />
                        <span className="mono lib-domain">{g.domain}</span>
                      </>
                    )}
                  </span>
                  {g.interrupted && <span className="lib-interrupted small">Recording was interrupted</span>}
                </span>
              </button>
              {g.interrupted && (
                <span className="lib-recover">
                  <button
                    type="button"
                    className="btn btn-ghost"
                    aria-label={`Recover ${g.title}`}
                    onClick={async () => {
                      await setInterrupted(g.id, false);
                      await onDeleted();
                      onOpen(g.id);
                    }}
                  >
                    Recover
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    aria-label={`Discard ${g.title}`}
                    onClick={async () => {
                      await deleteGuide(g.id);
                      await onDeleted();
                    }}
                  >
                    Discard
                  </button>
                </span>
              )}
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
          {asking ? WAITING : <><span className="rec-ring" aria-hidden /> Start recording</>}
        </button>
      </footer>
    </>
  );
}

function Settings() {
  const [theme, setTheme] = useTheme();
  const [allSites, setAllSites] = useState<boolean>();
  const [prefs, setPrefs] = useState<RedactPrefs>();
  const [exportPrefs, setExportPrefs] = useState<ExportPrefs>();
  useEffect(() => {
    void chrome.permissions.contains(ALL_URLS).then(setAllSites);
    void loadRedactPrefs().then(setPrefs);
    void loadExportPrefs().then(setExportPrefs);
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
        {allSites ? (
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
        ) : (
          allSites === false && (
            <button
              type="button"
              className="btn"
              onClick={async () => {
                // A click is a user gesture, so Chrome can show its prompt.
                await chrome.permissions.request(ALL_URLS).catch(() => false);
                setAllSites(await chrome.permissions.contains(ALL_URLS));
              }}
            >
              Allow
            </button>
          )
        )}
      </div>
      <p className="muted small" id="blur-always">
        Passwords, card numbers, bank accounts, social security numbers and access tokens are always blurred.
      </p>
      {REDACT_SWITCHES.map((sw) => (
        <div className="set-row" key={sw.key}>
          <span>
            <span id={`blur-${sw.key}-label`}>{sw.label}</span>
            <span className="muted small block" id={`blur-${sw.key}-hint`}>
              {sw.hint}
            </span>
          </span>
          <button
            type="button"
            role="switch"
            className="switch"
            aria-labelledby={`blur-${sw.key}-label`}
            aria-describedby={`blur-${sw.key}-hint`}
            aria-checked={!!prefs?.[sw.key]}
            disabled={!prefs}
            onClick={async () => {
              if (!prefs) return;
              const next = { ...prefs, [sw.key]: !prefs[sw.key] };
              setPrefs(next);
              await saveRedactPrefs(next);
            }}
          />
        </div>
      ))}
      <div className="set-row">
        <span>
          <span id="credit-label">Add a small {APP_NAME} credit</span>
          <span className="muted small block" id="credit-hint">
            A “Made with {APP_NAME}” line at the end of exported guides. Off by default.
          </span>
        </span>
        <button
          type="button"
          role="switch"
          className="switch"
          aria-labelledby="credit-label"
          aria-describedby="credit-hint"
          aria-checked={!!exportPrefs?.credit}
          disabled={!exportPrefs}
          onClick={async () => {
            const next = { credit: !exportPrefs?.credit };
            setExportPrefs(next);
            await saveExportPrefs(next);
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

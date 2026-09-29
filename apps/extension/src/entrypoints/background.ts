// Service worker: owns the recording session, captures screenshots (rate-limited), turns
// recorder drafts into steps and stores them. Everything stays in this browser profile.

import { acceptsSteps, IDLE, isActive, reduceSession, shouldJoin } from "../lib/session";
import type { SessionEvent, SessionState } from "../lib/session";
import { CaptureQueue } from "../lib/capture-queue";
import { buildStep, newGuide, titleFromPage } from "../lib/steps";
import type { FrameInfo, StepDraft } from "../lib/steps";
import { appendStep, newId } from "../lib/guide-ops";
import { deleteGuide, getGuide, mutateGuide, putGuide, putImage } from "../lib/db";
import { bakeRedactions } from "../lib/render";
import { createNavTracker, forgetTab, isRecordableUrl, noteAction, shouldRecordNavigation } from "../lib/nav";
import type { AnyMessage, Broadcast, ControlReply, HelloReply, ScanReply, WorkerToTab } from "../lib/messages";

const RECORDER_ID = "showsteps-recorder";
const RECORDER_FILE = "recorder.js";
const ALL_URLS = { origins: ["<all_urls>"] };

interface Frame extends FrameInfo {
  blob: Blob;
  at: number;
}

export default defineBackground(() => {
  let state: SessionState = IDLE;
  // One capture at a time, at least 520 ms apart: inside Chrome's 2-per-second quota.
  const queue = new CaptureQueue({ maxCalls: 1, windowMs: 520, marginMs: 0 });
  const frames = new Map<string, { at: number; frame: Promise<Frame | null>; settled: boolean }>();
  // e2e builds log which capture rung each step used (PLAN §3.4), in storage.session["debug:capture"].
  const DEBUG = import.meta.env.MODE === "e2e";
  const debugLog: { title: string; rung: string }[] = [];
  const nav = createNavTracker();
  const newTabs = new Set<number>();
  const pendingNav = new Map<number, { url: string; timer: ReturnType<typeof setTimeout> }>();
  let chain: Promise<unknown> = Promise.resolve();

  // ---- state ----------------------------------------------------------------------------------

  const ready = chrome.storage.session
    .get("session")
    .then((r) => {
      if (r.session && typeof r.session === "object") state = r.session as SessionState;
      if (state.status === "stopping") state = IDLE;
      if (!isActive(state)) void unregisterRecorder();
    })
    .catch(() => {});

  async function dispatch(e: SessionEvent): Promise<SessionState> {
    const next = reduceSession(state, e);
    if (next === state) return state;
    state = next;
    await chrome.storage.session.set({ session: state }).catch(() => {});
    void updateBadge();
    broadcast({ type: "bc:session", state });
    return state;
  }

  function broadcast(msg: Broadcast): void {
    chrome.runtime.sendMessage(msg).catch(() => {});
  }

  async function updateBadge(): Promise<void> {
    const text = state.status === "recording" ? String(state.stepCount || "REC") : state.status === "paused" ? "II" : "";
    await chrome.action.setBadgeText({ text }).catch(() => {});
    if (text) await chrome.action.setBadgeBackgroundColor({ color: state.status === "recording" ? "#d93a16" : "#6b6258" }).catch(() => {});
    await chrome.action
      .setTitle({ title: state.status === "recording" ? "Showsteps: recording" : state.status === "paused" ? "Showsteps: paused" : "Showsteps" })
      .catch(() => {});
  }

  function sendToTab(tabId: number, msg: WorkerToTab, timeoutMs = 800): Promise<unknown> {
    return Promise.race([
      chrome.tabs.sendMessage(tabId, msg).catch(() => undefined),
      new Promise((r) => setTimeout(r, timeoutMs)),
    ]);
  }

  // ---- recorder injection -------------------------------------------------------------------

  async function registerRecorder(): Promise<void> {
    await unregisterRecorder();
    await chrome.scripting.registerContentScripts([
      {
        id: RECORDER_ID,
        js: [RECORDER_FILE],
        matches: ["<all_urls>"],
        runAt: "document_start",
        allFrames: true,
        matchOriginAsFallback: true,
        persistAcrossSessions: false,
      },
    ]);
  }

  async function unregisterRecorder(): Promise<void> {
    await chrome.scripting.unregisterContentScripts({ ids: [RECORDER_ID] }).catch(() => {});
  }

  async function inject(tabId: number): Promise<void> {
    await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, files: [RECORDER_FILE] }).catch(() => {});
  }

  // ---- capture ------------------------------------------------------------------------------

  function pruneFrames(): void {
    const now = Date.now();
    for (const [id, f] of frames) if (now - f.at > 60_000) frames.delete(id);
  }

  async function grab(tabId: number): Promise<Frame | null> {
    const tab = await chrome.tabs.get(tabId).catch(() => undefined);
    if (!tab?.active || tab.windowId === undefined) return null; // captureVisibleTab only sees the active tab
    const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" });
    const blob = await (await fetch(dataUrl)).blob();
    const bmp = await createImageBitmap(blob);
    const frame = { blob, width: bmp.width, height: bmp.height, at: Date.now() };
    bmp.close();
    return frame;
  }

  /**
   * Live capture (for a step) or, with `settled`, a low-priority refresh of the page's
   * "settled frame" that is skipped when it would get in the way of a real capture.
   */
  function requestCapture(captureId: string, tabId: number, windowId: number | undefined, settled = false): void {
    pruneFrames();
    const key = `w${windowId ?? tabId}`;
    const job = settled ? queue.scheduleIdle(key, () => grab(tabId)) : queue.schedule(key, () => grab(tabId));
    const frame = job.catch((e) => {
      console.warn("Showsteps: capture failed", e);
      return null;
    });
    frames.set(captureId, { at: Date.now(), frame, settled });
  }

  /** The frame a step asked for, or a live capture when that one never happened. */
  type Rung = "settled" | "live" | "earlier" | "late" | "nav" | "none";
  interface Shot {
    frame: Frame | null;
    rung: Rung;
  }

  /** The frame a step asked for, or a live capture when that one never happened. */
  async function frameFor(captureId: string | undefined, tabId: number, windowId: number | undefined, fallbackId?: string): Promise<Shot> {
    const entry = captureId ? frames.get(captureId) : undefined;
    const f = entry ? await entry.frame : null;
    if (f) return { frame: f, rung: entry!.settled ? "settled" : "live" };
    // An earlier frame of the same document (e.g. a click that opened a new tab before the
    // live capture ran) beats a capture of whatever is in front now.
    const older = fallbackId ? await frames.get(fallbackId)?.frame : null;
    if (older) return { frame: older, rung: "earlier" };
    const fallback = `fallback_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    requestCapture(fallback, tabId, windowId);
    const late = (await frames.get(fallback)?.frame) ?? null;
    return { frame: late, rung: late ? "late" : "none" };
  }

  function addStep(tabId: number, draft: StepDraft, shotP: Promise<Shot> | undefined): Promise<void> {
    const guideId = state.guideId;
    const run = async () => {
      if (!guideId || !acceptsSteps(state) || state.guideId !== guideId) return;
      const shot = shotP ? await shotP : { frame: null, rung: "none" as Rung };
      const frame = shot.frame;
      const id = newId("s");
      const step = buildStep(id, { ...draft, page: { ...draft.page, tabId } }, frame ?? undefined);
      if (frame && step.screenshot) {
        // Automatic redactions are burnt into the stored pixels now (auto: true = already burnt);
        // the unredacted capture is never written anywhere.
        let blob = frame.blob;
        if (step.screenshot.redactions?.length) {
          try {
            blob = await bakeRedactions(frame.blob, step);
          } catch (e) {
            console.warn("Showsteps: redaction failed, screenshot dropped", e);
            delete step.screenshot;
          }
        }
        if (step.screenshot) await putImage(guideId, step.screenshot.image, blob, step.screenshot.highlight);
      }
      if (DEBUG) {
        debugLog.push({ title: step.title, rung: shot.rung });
        await chrome.storage.session.set({ "debug:capture": debugLog }).catch(() => {});
      }
      const saved = await mutateGuide(guideId, (g) => appendStep(g, step));
      if (!saved) return;
      await dispatch({ type: "step-added" });
      broadcast({ type: "bc:guide", guideId, stepId: id });
    };
    const next = chain.then(run, run);
    chain = next.catch((e) => console.warn("Showsteps: step failed", e));
    return chain as Promise<void>;
  }

  async function navigateStep(tabId: number, url: string): Promise<void> {
    const tab = await chrome.tabs.get(tabId).catch(() => undefined);
    if (!tab) return;
    const captureId = `nav_${tabId}_${Date.now()}`;
    requestCapture(captureId, tabId, tab.windowId);
    const frameP = frames.get(captureId)!.frame;
    // Ask the page for its metrics and sensitive fields so the screenshot is redacted like any other.
    const scan = (await sendToTab(tabId, { type: "tab:scan" }, 600)) as ScanReply | undefined;
    const frame = await frameP;
    const vw = tab.width ?? frame?.width ?? 0;
    const vh = tab.height ?? frame?.height ?? 0;
    const fallback = frame ? { devicePixelRatio: vw ? frame.width / vw : 1, viewport: { width: vw, height: vh, scrollX: 0, scrollY: 0 } } : undefined;
    const draft: StepDraft = {
      action: { type: "navigate", url },
      page: { url, title: tab.title || undefined },
      at: new Date().toISOString(),
      metrics: scan?.metrics ?? fallback,
      sensitiveRects: scan?.sensitiveRects,
    };
    await addStep(tabId, draft, frameP.then((frame) => ({ frame, rung: frame ? "nav" : "none" })));
  }

  function scheduleNavigate(tabId: number, url: string): void {
    const prev = pendingNav.get(tabId);
    if (prev) clearTimeout(prev.timer);
    // Wait for the load to finish (or give up waiting after a while: SPA navigations may not report it).
    const timer = setTimeout(() => flushNavigate(tabId), 2500);
    pendingNav.set(tabId, { url, timer });
  }

  function flushNavigate(tabId: number): void {
    const p = pendingNav.get(tabId);
    if (!p) return;
    clearTimeout(p.timer);
    pendingNav.delete(tabId);
    // A short pause lets the page paint before the screenshot.
    setTimeout(() => void navigateStep(tabId, p.url), 300);
  }

  // ---- session control ----------------------------------------------------------------------

  /** The side panel shrinks the page (and can flip it to a mobile layout): hide it while recording. */
  async function closePanel(windowId: number): Promise<void> {
    const sp = chrome.sidePanel as typeof chrome.sidePanel & { close?: (o: { windowId: number }) => Promise<void> };
    await sp.close?.({ windowId }).catch(() => {});
  }

  async function start(windowId: number, tabId?: number, appendTo?: string): Promise<ControlReply> {
    await ready;
    if (state.status !== "idle") return { ok: false, state, error: "Already recording" };
    const allSites = await chrome.permissions.contains(ALL_URLS);
    const tabs = await chrome.tabs.query({ windowId });
    const active = tabs.find((t) => (tabId !== undefined ? t.id === tabId : t.active)) ?? tabs.find((t) => t.active);
    // Without <all_urls> we can still record the tab Record was pressed for, through activeTab.
    const scope = allSites ? "window" : "tab";
    const scoped = allSites ? tabs : tabs.filter((t) => t.id === active?.id);
    const now = new Date();
    const existing = appendTo ? await getGuide(appendTo) : undefined;
    const guideId = existing?.id ?? newId("g");
    if (!existing) {
      await putGuide(newGuide(guideId, now.toISOString(), chrome.runtime.getManifest().version, titleFromPage(active && { url: active.url ?? "", title: active.title }, now)));
    }
    const tabIds = scoped.map((t) => t.id).filter((id): id is number => id !== undefined);
    for (const t of scoped) if (t.id !== undefined) nav.lastUrl.set(t.id, t.url ?? "");
    await dispatch({ type: "start", guideId, windowId, tabIds, at: now.toISOString(), scope });
    await chrome.storage.session.set({ lastGuideId: guideId }).catch(() => {});
    if (allSites) await registerRecorder().catch((e) => console.warn("Showsteps: register failed", e));
    await Promise.all(scoped.filter((t) => t.id !== undefined && isRecordableUrl(t.url)).map((t) => inject(t.id!)));
    await closePanel(windowId);
    // First step: where the task starts.
    if (active?.id !== undefined && isRecordableUrl(active.url)) await navigateStep(active.id, active.url);
    return { ok: true, state };
  }

  async function stop(opts: { openEditor?: boolean } = {}): Promise<ControlReply> {
    await ready;
    if (!isActive(state)) return { ok: false, state, error: "Not recording" };
    const tabIds = state.tabIds.slice();
    // Let pending typing reach us while we still accept steps.
    if (state.status === "paused") await dispatch({ type: "resume", now: Date.now() });
    await Promise.all(tabIds.map((t) => sendToTab(t, { type: "tab:flush" })));
    await new Promise((r) => setTimeout(r, 250));
    for (const [tabId] of pendingNav) flushNavigate(tabId);
    await new Promise((r) => setTimeout(r, 350));
    await chain;
    await dispatch({ type: "stop" });
    await chain;
    await unregisterRecorder();
    await Promise.all(tabIds.map((t) => sendToTab(t, { type: "tab:state", recording: false })));
    for (const t of tabIds) forgetTab(nav, t);
    newTabs.clear();
    frames.clear();
    const guideId = state.guideId;
    const windowId = state.windowId;
    await dispatch({ type: "stopped" });
    // Straight to the editor, where the guide gets reviewed.
    if (guideId && opts.openEditor !== false) {
      await chrome.tabs.create({ url: chrome.runtime.getURL(`/editor.html?guide=${encodeURIComponent(guideId)}`), windowId }).catch(() => {});
    }
    return { ok: true, state };
  }

  async function pause(): Promise<ControlReply> {
    await ready;
    if (state.status !== "recording") return { ok: false, state };
    await Promise.all(state.tabIds.map((t) => sendToTab(t, { type: "tab:flush" })));
    await new Promise((r) => setTimeout(r, 150));
    await chain;
    await dispatch({ type: "pause", now: Date.now() });
    await Promise.all(state.tabIds.map((t) => sendToTab(t, { type: "tab:state", recording: false })));
    return { ok: true, state };
  }

  async function resume(): Promise<ControlReply> {
    await ready;
    if (state.status !== "paused") return { ok: false, state };
    await dispatch({ type: "resume", now: Date.now() });
    // Whatever happened while paused is not a step: re-seed URLs so it is not replayed as navigation.
    for (const t of state.tabIds) {
      const tab = await chrome.tabs.get(t).catch(() => undefined);
      if (tab) nav.lastUrl.set(t, tab.url ?? "");
    }
    await Promise.all(state.tabIds.map((t) => sendToTab(t, { type: "tab:state", recording: true })));
    return { ok: true, state };
  }

  // ---- events -------------------------------------------------------------------------------

  chrome.runtime.onInstalled.addListener(() => {
    void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
  });
  chrome.runtime.onStartup.addListener(() => {
    void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
  });

  chrome.runtime.onMessage.addListener((raw, sender, reply) => {
    const msg = raw as AnyMessage;
    const tabId = sender.tab?.id;
    switch (msg.type) {
      case "rec:hello":
        void ready.then(() => {
          const inSession = tabId !== undefined && isActive(state) && (state.tabIds.includes(tabId) || shouldJoin(state, { windowId: sender.tab?.windowId }));
          if (inSession && tabId !== undefined && !state.tabIds.includes(tabId)) void dispatch({ type: "tab-joined", tabId });
          reply({ recording: inSession && acceptsSteps(state) } satisfies HelloReply);
        });
        return true;
      case "rec:capture":
        if (tabId === undefined) return false;
        if (!msg.settled) noteAction(nav, tabId, Date.now());
        void ready.then(async () => {
          if (!acceptsSteps(state) || !state.tabIds.includes(tabId)) return reply({ captured: false });
          requestCapture(msg.captureId, tabId, sender.tab?.windowId, msg.settled);
          // Settled frames report back, so the page only relies on frames that exist.
          reply({ captured: !!(await frames.get(msg.captureId)?.frame) });
        });
        return true;
      case "rec:step":
        if (tabId === undefined) return false;
        noteAction(nav, tabId, Date.now());
        void ready.then(() => {
          if (!acceptsSteps(state) || !state.tabIds.includes(tabId)) return;
          const draft = { ...(msg.draft as StepDraft) };
          if (sender.frameId) {
            // Steps from a cross-origin frame: the page is the tab's top document.
            draft.page = { url: sender.tab?.url ?? draft.page.url, title: sender.tab?.title || undefined };
            if (!draft.metrics && sender.tab?.width && sender.tab.height) {
              draft.metrics = { devicePixelRatio: 1, viewport: { width: sender.tab.width, height: sender.tab.height, scrollX: 0, scrollY: 0 } };
            }
          }
          void addStep(tabId, draft, frameFor(msg.captureId, tabId, sender.tab?.windowId, msg.fallbackCaptureId));
        });
        return false;
      case "ctl:discard":
        void (async () => {
          const id = state.guideId;
          const r = await stop({ openEditor: false });
          if (id) await deleteGuide(id);
          await chrome.storage.session.remove("lastGuideId").catch(() => {});
          return r;
        })().then(reply, (e) => reply({ ok: false, state, error: String(e?.message ?? e) }));
        return true;
      case "ctl:start":
        void start(msg.windowId, msg.tabId, msg.guideId).then(reply, (e) => reply({ ok: false, state, error: String(e?.message ?? e) }));
        return true;
      case "ctl:stop":
        void stop({ openEditor: msg.openEditor }).then(reply, (e) => reply({ ok: false, state, error: String(e?.message ?? e) }));
        return true;
      case "ctl:pause":
        void pause().then(reply);
        return true;
      case "ctl:resume":
        void resume().then(reply);
        return true;
      case "ctl:state":
        void ready.then(() => reply({ ok: true, state } satisfies ControlReply));
        return true;
      default:
        return false;
    }
  });

  chrome.tabs.onCreated.addListener((tab) => {
    void ready.then(() => {
      if (tab.id === undefined || !shouldJoin(state, tab)) return;
      newTabs.add(tab.id);
      void dispatch({ type: "tab-joined", tabId: tab.id });
    });
  });

  chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
    void ready.then(() => {
      if (!isActive(state) || !state.tabIds.includes(tabId)) return;
      if (info.url) {
        const isNewTab = newTabs.has(tabId) && isRecordableUrl(info.url);
        if (isNewTab) newTabs.delete(tabId);
        const record = shouldRecordNavigation(nav, tabId, info.url, Date.now(), { isNewTab });
        if (record && acceptsSteps(state)) scheduleNavigate(tabId, info.url);
      }
      if (info.status === "complete") {
        if (pendingNav.has(tabId)) flushNavigate(tabId);
        // Pages loaded before registration (or restored from bfcache) get the recorder now.
        if (isRecordableUrl(tab.url)) void inject(tabId);
      }
    });
  });

  chrome.tabs.onRemoved.addListener((tabId, info) => {
    void ready.then(async () => {
      forgetTab(nav, tabId);
      if (!state.tabIds.includes(tabId)) return;
      await dispatch({ type: "tab-closed", tabId });
      if (info.isWindowClosing && info.windowId === state.windowId) await stop({ openEditor: false });
    });
  });

  chrome.windows.onRemoved.addListener((windowId) => {
    void ready.then(() => {
      if (isActive(state) && state.windowId === windowId) void stop({ openEditor: false });
    });
  });

  // Keyboard shortcuts work while the side panel is closed.
  chrome.commands?.onCommand.addListener((command) => {
    void ready.then(() => {
      if (command === "toggle-pause") void (state.status === "paused" ? resume() : pause());
      else if (command === "stop-recording") void stop();
    });
  });

  // Access withdrawn mid-recording (Settings, or the user's site-access menu): stop cleanly.
  chrome.permissions.onRemoved.addListener((p) => {
    void ready.then(() => {
      if (isActive(state) && state.scope === "window" && p.origins?.includes("<all_urls>")) void stop();
    });
  });

  void updateBadge();
});

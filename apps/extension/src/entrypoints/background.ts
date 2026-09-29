// Service worker: owns the recording session, captures screenshots (rate-limited), turns
// recorder drafts into steps and stores them. Everything stays in this browser profile.

import { localIso } from "../lib/time";
import { acceptsSteps, IDLE, isActive, reduceSession, shouldJoin } from "../lib/session";
import type { SessionEvent, SessionState } from "../lib/session";
import { CaptureQueue } from "../lib/capture-queue";
import { buildStep, newGuide, safeTitle, titleFromPage } from "../lib/steps";
import type { FrameInfo, StepDraft } from "../lib/steps";
import { amendStep, appendStep, indexOfStep, newId } from "../lib/guide-ops";
import { ACTIVE_KEY, deleteGuide, getGuide, mutateGuide, putGuide, putImage, setInterrupted } from "../lib/db";
import { bakeRedactions } from "../lib/render";
import { createNavTracker, forgetTab, isRecordableUrl, noteAction, shouldRecordNavigation } from "../lib/nav";
import { blobToBase64, OriginalStore, PORT_NAME } from "../lib/originals";
import type { OriginalsPortMsg } from "../lib/originals";
import { draftForFrame, viewOf } from "../lib/frame-pick";
import type { FrameScan, FrameView } from "../lib/frame-pick";
import type { AnyMessage, BarState, Broadcast, ControlReply, HelloReply, ScanReply, WorkerToTab } from "../lib/messages";

const RECORDER_ID = "showsteps-recorder";
const RECORDER_FILE = "recorder.js";
const ALL_URLS = { origins: ["<all_urls>"] };
/** How long unredacted originals outlive the last editor that held them (memory only). */
const ORIGINALS_GRACE_MS = 2000;

interface Frame extends FrameInfo {
  blob: Blob;
  at: number;
  /** Date.now() right before captureVisibleTab ran, and right after it returned. */
  startedAt?: number;
  doneAt?: number;
  /** Tab URL right after the capture, and whether a navigation was already under way. */
  url?: string;
  leaving?: boolean;
}

export default defineBackground(() => {
  let state: SessionState = IDLE;
  // One capture at a time, at least 520 ms apart: inside Chrome's 2-per-second quota.
  const queue = new CaptureQueue({ maxCalls: 1, windowMs: 520, marginMs: 0 });
  /**
   * Every capture of this recording by id: which tab, how the page was scrolled when it was asked
   * for, and (worker-side navigate captures) the redaction scan made with it.
   */
  interface FrameEntry {
    at: number;
    frame: Promise<Frame | null>;
    settled: boolean;
    tabId: number;
    view?: FrameView;
    scan?: FrameScan;
  }
  const frames = new Map<string, FrameEntry>();
  /** Capture ids per tab, newest last: fallbacks when a step's own capture came back empty. */
  const tabFrames = new Map<number, string[]>();
  // e2e builds log which capture rung each step used (PLAN §3.4), in storage.session["debug:capture"].
  const DEBUG = import.meta.env.MODE === "e2e";
  const captureCalls: number[] = [];
  const captureErrors: string[] = [];
  const debugLog: { title: string; rung: string; amend?: boolean; stepId?: string; review?: boolean; needsReview?: string; scanMs?: number; highlight?: boolean; baked?: boolean; tabId?: number }[] = [];
  const nav = createNavTracker();
  const newTabs = new Set<number>();
  const pendingNav = new Map<number, { url: string; timer: ReturnType<typeof setTimeout> }>();
  let chain: Promise<unknown> = Promise.resolve();
  /** Last step committed per tab and the recorder draft it came from (for typing amends). */
  const lastByTab = new Map<number, { cid?: string; stepId: string }>();
  /** Pre-blur captures of this recording, in memory only (auto-blur Undo). */
  const originals = new OriginalStore();
  const originalPorts = new Map<string, Set<chrome.runtime.Port>>();

  // ---- state ----------------------------------------------------------------------------------

  const ready = chrome.storage.session
    .get("session")
    .then((r) => {
      if (r.session && typeof r.session === "object") state = r.session as SessionState;
      if (state.status === "stopping") state = IDLE;
      if (!isActive(state)) void unregisterRecorder();
    })
    .catch(() => {})
    .then(recoverInterrupted);

  /**
   * A recording that never reached Stop (the browser closed or crashed: storage.session is gone,
   * the storage.local marker is not) becomes an "interrupted" draft the library offers to Recover
   * or Discard (PLAN §3.3.6).
   */
  async function recoverInterrupted(): Promise<void> {
    if (isActive(state)) return;
    const r = await chrome.storage.local.get(ACTIVE_KEY).catch(() => ({}) as Record<string, unknown>);
    const id = r[ACTIVE_KEY];
    if (typeof id !== "string") return;
    await chrome.storage.local.remove(ACTIVE_KEY).catch(() => {});
    if (await getGuide(id)) await setInterrupted(id, true).catch(() => {});
  }

  async function dispatch(e: SessionEvent): Promise<SessionState> {
    const next = reduceSession(state, e);
    if (next === state) return state;
    const before = state.tabIds;
    state = next;
    await chrome.storage.session.set({ session: state }).catch(() => {});
    void updateBadge();
    broadcast({ type: "bc:session", state });
    syncBars([...new Set([...before, ...state.tabIds])]);
    return state;
  }

  const barState = (): BarState => ({ status: state.status, stepCount: state.stepCount });

  /** The in-page recording bar mirrors the session (top frame only). */
  function syncBars(tabIds: number[]): void {
    const msg: WorkerToTab = { type: "tab:bar", ...barState() };
    for (const t of tabIds) chrome.tabs.sendMessage(t, msg, { frameId: 0 }).catch(() => {});
  }

  /**
   * Hide the recording bar before a capture. Resolves true when the page confirmed a painted
   * frame without it, or when no recorder runs there (so there is no bar); false when the page
   * did not answer in time (then the capture is skipped rather than risk the bar in the image).
   */
  function hideBar(tabId: number): Promise<boolean> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve(false), 400);
      chrome.tabs.sendMessage(tabId, { type: "tab:bar-hide" } satisfies WorkerToTab, { frameId: 0 }).then(
        () => (clearTimeout(timer), resolve(true)),
        () => (clearTimeout(timer), resolve(true)),
      );
    });
  }

  function showBar(tabId: number): void {
    chrome.tabs.sendMessage(tabId, { type: "tab:bar-show" } satisfies WorkerToTab, { frameId: 0 }).catch(() => {});
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
    for (const [t, ids] of tabFrames) {
      const live = ids.filter((id) => frames.has(id));
      if (live.length) tabFrames.set(t, live);
      else tabFrames.delete(t);
    }
  }

  async function grab(tabId: number): Promise<Frame | null> {
    const tab = await chrome.tabs.get(tabId).catch(() => undefined);
    if (!tab?.active || tab.windowId === undefined) return null; // captureVisibleTab only sees the active tab
    // The recording bar must never be in a screenshot: hide it, capture, show it again (hiding
    // changes opacity only, so the bar stays clickable for the few milliseconds it is invisible).
    // A busy page (heavy load, a fresh tab still parsing) gets a second chance before the capture is skipped.
    if (!(await hideBar(tabId)) && !(await hideBar(tabId))) {
      showBar(tabId);
      if (DEBUG) console.warn("Showsteps: bar did not hide in time, capture skipped");
      return null;
    }
    let dataUrl: string;
    const startedAt = Date.now();
    if (DEBUG) {
      // E3e: every captureVisibleTab call, to check the 2-per-second window from outside.
      captureCalls.push(startedAt);
      void chrome.storage.session.set({ "debug:captures": captureCalls.slice(-400) }).catch(() => {});
    }
    let doneAt: number;
    try {
      dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" });
      doneAt = Date.now();
    } catch (e) {
      if (DEBUG) {
        captureErrors.push(String((e as Error)?.message ?? e));
        void chrome.storage.session.set({ "debug:capture-errors": captureErrors.slice(-50) }).catch(() => {});
      }
      throw e;
    } finally {
      showBar(tabId);
    }
    // A link click may already be loading the next page: note it, so the step can prefer the
    // frame taken before the click (design review R2-1: a ring around nothing on the new page).
    const after = await chrome.tabs.get(tabId).catch(() => undefined);
    // captureVisibleTab shows whatever tab is in front of the window. If ours lost the front while
    // the capture ran (a link opening a new tab), the image may be the other tab: never use it.
    if (!after?.active || after.windowId !== tab.windowId) {
      if (DEBUG) console.warn("Showsteps: tab left the front during capture, frame dropped");
      return null;
    }
    const blob = await (await fetch(dataUrl)).blob();
    const bmp = await createImageBitmap(blob);
    const frame: Frame = { blob, width: bmp.width, height: bmp.height, at: Date.now(), startedAt, doneAt, url: after?.url, leaving: !!after?.pendingUrl || (!!after?.url && after.url !== tab.url) };
    bmp.close();
    return frame;
  }

  const sameDoc = (a: string | undefined, b: string | undefined) => !a || !b || a === b;

  /**
   * Live capture (for a step) or, with `settled`, a low-priority refresh of the page's
   * "settled frame" that is skipped when it would get in the way of a real capture.
   */
  function requestCapture(captureId: string, tabId: number, windowId: number | undefined, settled = false, view?: FrameView): void {
    pruneFrames();
    const key = `w${windowId ?? tabId}`;
    const job = settled ? queue.scheduleIdle(key, () => grab(tabId)) : queue.schedule(key, () => grab(tabId));
    const frame = job.catch((e) => {
      console.warn("Showsteps: capture failed", e);
      return null;
    });
    frames.set(captureId, { at: Date.now(), frame, settled, tabId, view });
    const ids = tabFrames.get(tabId) ?? [];
    ids.push(captureId);
    if (ids.length > 8) ids.shift();
    tabFrames.set(tabId, ids);
  }

  type Rung = "settled" | "live" | "earlier" | "late" | "nav" | "none";
  interface Shot {
    frame: Frame | null;
    rung: Rung;
    /** How the page was scrolled when the frame was asked for, and the scan that came with it. */
    view?: FrameView;
    scan?: FrameScan;
  }

  /**
   * The frame a step asked for; else the newest earlier frame of the same document (the recorder's
   * own, then any other capture of this tab, such as the navigate capture of this page); else a
   * late live capture. Frames that show another page are never used.
   */
  async function frameFor(
    captureId: string | undefined,
    tabId: number,
    windowId: number | undefined,
    fallbackIds: string[] = [],
    pageUrl?: string,
    prefer: { ids: string[]; actionAt?: number } = { ids: [] },
  ): Promise<Shot> {
    // A frame taken while the page was already leaving (or after its URL changed) shows the
    // destination, not what was clicked (design review R2-1): never use it for this step.
    const stale = (f: Frame) => !!f.leaving || !sameDoc(f.url, pageUrl);
    // A settled refresh that was already on its way when the user pressed: if its capture had
    // finished before the press, it is the exact page before the action. (Finished, not started:
    // the pixels come from a compositor frame produced while the call runs, which may already
    // show what the press changed.)
    if (prefer.actionAt !== undefined) {
      for (const id of prefer.ids) {
        const e = frames.get(id);
        const pf = e && e.tabId === tabId ? await e.frame : null;
        if (pf && !stale(pf) && pf.doneAt !== undefined && pf.doneAt <= prefer.actionAt) return { frame: pf, rung: "settled", view: e!.view, scan: e!.scan };
      }
    }
    const entry = captureId ? frames.get(captureId) : undefined;
    const f = entry ? await entry.frame : null;
    if (f && !stale(f)) return { frame: f, rung: entry!.settled ? "settled" : "live", view: entry!.view, scan: entry!.scan };
    // The newest earlier frame of the same document that still shows it (e.g. the frame taken
    // right after the last keystroke, or, when a click opened a new tab before its own capture
    // could run, the settled or navigate frame of this page). The tab-wide list is what makes the
    // tab-opening click deterministic: its own capture loses to the new tab whenever the rate
    // limit delays it past the tab switch (E-4 at zoom 125%).
    const tried = new Set<string>([captureId ?? ""]);
    const tabIds = (tabFrames.get(tabId) ?? []).slice().reverse();
    for (const id of [...fallbackIds, ...tabIds]) {
      if (tried.has(id)) continue;
      tried.add(id);
      const e = frames.get(id);
      if (!e || e.tabId !== tabId || (entry && e.at > entry.at)) continue;
      const older = await e.frame;
      if (older && !stale(older)) return { frame: older, rung: "earlier", view: e.view, scan: e.scan };
    }
    // Only the destination is on screen, and it was never scanned for secrets: no screenshot
    // rather than a wrong one (the step keeps its title; the editor can re-capture).
    if (f) return { frame: null, rung: "none" };
    const fallback = `fallback_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    requestCapture(fallback, tabId, windowId);
    const late = (await frames.get(fallback)?.frame) ?? null;
    return late && !stale(late) ? { frame: late, rung: "late" } : { frame: null, rung: "none" };
  }

  function addStep(tabId: number, draftIn: StepDraft, shotP: Promise<Shot> | undefined): Promise<void> {
    let draft = draftIn;
    const guideId = state.guideId;
    const run = async () => {
      if (!guideId || !acceptsSteps(state) || state.guideId !== guideId) return;
      const shot: Shot = shotP ? await shotP : { frame: null, rung: "none" };
      const frame = shot.frame;
      // An earlier frame may show the page scrolled differently: re-place the target and the blur.
      if (frame && shot.rung === "earlier") draft = draftForFrame(draft, shot.view, shot.scan);
      // Typing that continues the previous step of this tab (nothing else committed in between)
      // replaces that step instead of adding another (PLAN §3.6).
      const last = lastByTab.get(tabId);
      const amendId = draft.amends && last && last.cid === draft.amends ? last.stepId : undefined;
      const id = amendId ?? newId("s");
      const { amends: _a, cid: _c, sensitiveKinds, scanIncomplete, needsReview, scanMs, ...clean } = draft;
      const step = buildStep(id, { ...clean, page: { ...draft.page, tabId } }, frame ?? undefined);
      if (frame && step.screenshot) {
        // Automatic redactions are burnt into the stored pixels now (auto: true = already burnt);
        // the unredacted capture is only kept in memory, for Undo in an open editor.
        let blob = frame.blob;
        if (step.screenshot.redactions?.length) {
          try {
            blob = await bakeRedactions(frame.blob, step);
            rememberOriginal(guideId, id, frame.blob, step.timestamp);
          } catch (e) {
            console.warn("Showsteps: redaction failed, screenshot dropped", e);
            delete step.screenshot;
          }
        }
        if (step.screenshot) await putImage(guideId, step.screenshot.image, blob, step.screenshot.highlight, { kinds: sensitiveKinds, review: scanIncomplete });
      }
      if (DEBUG) {
        debugLog.push({
          title: step.title,
          rung: shot.rung,
          stepId: id,
          ...(amendId ? { amend: true } : {}),
          ...(scanIncomplete ? { review: true } : {}),
          ...(needsReview ? { needsReview } : {}),
          ...(scanMs !== undefined ? { scanMs } : {}),
          highlight: !!step.screenshot?.highlight,
          baked: !!step.screenshot?.redactions?.length,
          tabId,
        });
        await chrome.storage.session.set({ "debug:capture": debugLog }).catch(() => {});
      }
      await ensureGuide(guideId, step.page);
      let amended = false;
      const saved = await mutateGuide(guideId, (g) => {
        const at = amendId ? indexOfStep(g, amendId) : -1;
        // Navigate titles name the site only when it changed since the previous step.
        const prev = (at >= 0 ? g.steps[at - 1] : g.steps[g.steps.length - 1])?.page;
        step.title = safeTitle(step, prev);
        if (at >= 0) {
          amended = true;
          return amendStep(g, amendId!, step);
        }
        return appendStep(g, step);
      });
      if (!saved) return;
      lastByTab.set(tabId, { cid: draft.cid, stepId: id });
      if (!amended) await dispatch({ type: "step-added" });
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
    const navEntry = frames.get(captureId);
    if (navEntry && scan) {
      // Later steps of this page may fall back to this frame: keep how it was scrolled and what was blurred.
      navEntry.view = viewOf(scan.metrics);
      if (!scan.scanIncomplete) navEntry.scan = { rects: scan.sensitiveRects, labels: scan.sensitiveLabels };
    }
    const frame = await frameP;
    const vw = tab.width ?? frame?.width ?? 0;
    const vh = tab.height ?? frame?.height ?? 0;
    const fallback = frame ? { devicePixelRatio: vw ? frame.width / vw : 1, viewport: { width: vw, height: vh, scrollX: 0, scrollY: 0 } } : undefined;
    const draft: StepDraft = {
      action: { type: "navigate", url },
      page: { url, title: tab.title || undefined },
      at: localIso(),
      metrics: scan?.metrics ?? fallback,
      sensitiveRects: scan?.sensitiveRects,
      sensitiveLabels: scan?.sensitiveLabels,
      sensitiveKinds: scan?.sensitiveKinds,
      // No answer from the page: nothing was scanned, so ask for a review rather than pass it as clean.
      scanIncomplete: scan ? !!scan.scanIncomplete : isRecordableUrl(url),
    };
    await addStep(tabId, draft, frameP.then((frame) => ({ frame, rung: frame ? "nav" : "none" })));
  }

  function rememberOriginal(guideId: string, stepId: string, blob: Blob, token: string): void {
    originals.set(guideId, stepId, { blob, token });
    // Editors already open on this guide get it right away.
    const ports = originalPorts.get(guideId);
    if (ports?.size) void sendOriginal([...ports], guideId, stepId);
  }

  async function sendOriginal(ports: chrome.runtime.Port[], guideId: string, stepId: string): Promise<void> {
    const o = originals.get(guideId, stepId);
    if (!o) return;
    const msg: OriginalsPortMsg = { type: "original", guideId, stepId, token: o.token, data: await blobToBase64(o.blob), mime: o.blob.type || "image/png" };
    for (const p of ports) {
      try {
        p.postMessage(msg);
      } catch {
        /* closed */
      }
    }
  }

  // Editors claim the originals of the guide they show; when the last one closes they are dropped.
  chrome.runtime.onConnect.addListener((port) => {
    // Extension pages only (never a content script).
    if (port.name !== PORT_NAME || port.sender?.id !== chrome.runtime.id || !port.sender?.url?.startsWith(chrome.runtime.getURL(""))) return;
    let claimed: string | undefined;
    port.onMessage.addListener((raw: OriginalsPortMsg) => {
      if (raw?.type !== "claim" || typeof raw.guideId !== "string") return;
      claimed = raw.guideId;
      let set = originalPorts.get(claimed);
      if (!set) originalPorts.set(claimed, (set = new Set()));
      set.add(port);
      void (async () => {
        for (const [stepId] of originals.entries(raw.guideId)) await sendOriginal([port], raw.guideId, stepId);
      })();
    });
    port.onDisconnect.addListener(() => {
      if (!claimed) return;
      const set = originalPorts.get(claimed);
      set?.delete(port);
      if (!set?.size) {
        originalPorts.delete(claimed);
        // Closing the last editor drops them, unless this guide is still being recorded. A short
        // grace period lets the next view take over (panel closing as the editor tab opens).
        const g = claimed;
        setTimeout(() => {
          if (!originalPorts.get(g)?.size && !(isActive(state) && state.guideId === g)) originals.drop(g);
        }, ORIGINALS_GRACE_MS);
      }
    });
  });

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
    // The guide record is created when its first step lands (ensureGuide), so starting on a page
    // Chrome does not let us record leaves no empty guide behind.
    const guideId = existing?.id ?? newId("g");
    const tabIds = scoped.map((t) => t.id).filter((id): id is number => id !== undefined);
    for (const t of scoped) if (t.id !== undefined) nav.lastUrl.set(t.id, t.url ?? "");
    // A new recording: originals of earlier ones are no longer needed by anyone new.
    if (!originalPorts.size) originals.clear();
    lastByTab.clear();
    await dispatch({ type: "start", guideId, windowId, tabIds, at: localIso(now), scope });
    await chrome.storage.local.set({ [ACTIVE_KEY]: guideId }).catch(() => {});
    await chrome.storage.session.set({ lastGuideId: guideId }).catch(() => {});
    if (allSites) await registerRecorder().catch((e) => console.warn("Showsteps: register failed", e));
    await Promise.all(scoped.filter((t) => t.id !== undefined && isRecordableUrl(t.url)).map((t) => inject(t.id!)));
    await closePanel(windowId);
    // First step: where the task starts.
    const blocked = !(active?.id !== undefined && isRecordableUrl(active.url));
    if (!blocked) await navigateStep(active!.id!, active!.url!);
    return { ok: true, state, blocked };
  }

  /** Create the guide on its first step, titled from that step's page. */
  async function ensureGuide(guideId: string, page: { url: string; title?: string }): Promise<void> {
    if (await getGuide(guideId)) return;
    const created = state.startedAt ?? localIso();
    await putGuide(newGuide(guideId, created, chrome.runtime.getManifest().version, titleFromPage(page)));
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
    tabFrames.clear();
    const guideId = state.guideId;
    const windowId = state.windowId;
    await dispatch({ type: "stopped" });
    await chrome.storage.local.remove(ACTIVE_KEY).catch(() => {});
    // Straight to the editor, where the guide gets reviewed (if anything was recorded).
    if (guideId && opts.openEditor !== false && (await getGuide(guideId))) {
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
          reply({ recording: inSession && acceptsSteps(state), bar: inSession ? barState() : undefined } satisfies HelloReply);
        });
        return true;
      case "rec:capture":
        if (tabId === undefined) return false;
        if (!msg.settled) noteAction(nav, tabId, Date.now());
        void ready.then(async () => {
          if (!acceptsSteps(state) || !state.tabIds.includes(tabId)) return reply({ captured: false });
          // Settled refreshes only for the tab in front (a background tab would use up the idle slot).
          if (msg.settled && !(await chrome.tabs.get(tabId).then((t) => t.active, () => false))) return reply({ captured: false });
          requestCapture(msg.captureId, tabId, sender.tab?.windowId, msg.settled, msg.view);
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
          void addStep(
            tabId,
            draft,
            frameFor(msg.captureId, tabId, sender.tab?.windowId, msg.fallbackCaptureIds ?? (msg.fallbackCaptureId ? [msg.fallbackCaptureId] : []), draft.page.url, {
              ids: msg.preferCaptureIds ?? [],
              actionAt: msg.actionAt,
            }),
          );
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

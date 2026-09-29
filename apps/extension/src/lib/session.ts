// Recording session state machine. Pure: the service worker persists the state in
// chrome.storage.session and feeds events through `reduceSession`.

export type SessionStatus = "idle" | "recording" | "paused" | "stopping";

export interface SessionState {
  status: SessionStatus;
  guideId?: string;
  /** The window being recorded. Tabs opened in it (or popups opened from it) join. */
  windowId?: number;
  /** Tabs that belong to the session. */
  tabIds: number[];
  startedAt?: string;
  /** Steps accepted so far (live counter for the UI). */
  stepCount: number;
  /** Total ms spent paused, and when the current pause began. */
  pausedMs: number;
  pausedAt?: number;
}

export type SessionEvent =
  | { type: "start"; guideId: string; windowId: number; tabIds: number[]; at: string }
  | { type: "pause"; now: number }
  | { type: "resume"; now: number }
  | { type: "stop" }
  | { type: "stopped" }
  | { type: "tab-joined"; tabId: number }
  | { type: "tab-closed"; tabId: number }
  | { type: "window-closed"; windowId: number }
  | { type: "step-added" }
  | { type: "step-removed" };

export const IDLE: SessionState = Object.freeze({ status: "idle", tabIds: [], stepCount: 0, pausedMs: 0 }) as SessionState;

/** Returns the next state. Invalid transitions return the same object, so callers can compare by identity. */
export function reduceSession(s: SessionState, e: SessionEvent): SessionState {
  switch (e.type) {
    case "start":
      if (s.status !== "idle") return s;
      return {
        status: "recording",
        guideId: e.guideId,
        windowId: e.windowId,
        tabIds: [...new Set(e.tabIds)],
        startedAt: e.at,
        stepCount: 0,
        pausedMs: 0,
      };
    case "pause":
      if (s.status !== "recording") return s;
      return { ...s, status: "paused", pausedAt: e.now };
    case "resume":
      if (s.status !== "paused") return s;
      return { ...s, status: "recording", pausedMs: s.pausedMs + Math.max(0, e.now - (s.pausedAt ?? e.now)), pausedAt: undefined };
    case "stop":
      if (s.status !== "recording" && s.status !== "paused") return s;
      return { ...s, status: "stopping" };
    case "stopped":
      if (s.status === "idle") return s;
      return { ...IDLE, tabIds: [] };
    case "tab-joined":
      if (!isActive(s) || s.tabIds.includes(e.tabId)) return s;
      return { ...s, tabIds: [...s.tabIds, e.tabId] };
    case "tab-closed":
      if (!s.tabIds.includes(e.tabId)) return s;
      return { ...s, tabIds: s.tabIds.filter((t) => t !== e.tabId) };
    case "window-closed":
      if (!isActive(s) || s.windowId !== e.windowId) return s;
      return { ...s, status: "stopping" };
    case "step-added":
      if (s.status === "idle") return s;
      return { ...s, stepCount: s.stepCount + 1 };
    case "step-removed":
      if (s.status === "idle" || s.stepCount === 0) return s;
      return { ...s, stepCount: s.stepCount - 1 };
  }
}

/** Recording or paused: the session exists and tabs are tracked. */
export function isActive(s: SessionState): boolean {
  return s.status === "recording" || s.status === "paused";
}

/** Only a running (not paused) session turns page events into steps. */
export function acceptsSteps(s: SessionState): boolean {
  return s.status === "recording";
}

/** Should a newly created tab join? Same window, or opened by a session tab (popup windows). */
export function shouldJoin(s: SessionState, tab: { windowId?: number; openerTabId?: number }): boolean {
  if (!isActive(s)) return false;
  if (tab.windowId !== undefined && tab.windowId === s.windowId) return true;
  return tab.openerTabId !== undefined && s.tabIds.includes(tab.openerTabId);
}

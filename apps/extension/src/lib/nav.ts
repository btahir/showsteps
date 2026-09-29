// Decides when a URL change in a recorded tab becomes its own "Go to …" step.
// A navigation caused by a recorded click or Enter is already explained by that step,
// so it is skipped. Address-bar navigations, back/forward, reloads to a new URL and
// the first page of a newly opened tab become navigate steps.

export interface NavTracker {
  /** Last time a step was recorded in each tab (ms). */
  lastActionAt: Map<number, number>;
  /** Last URL seen per tab, to ignore duplicate onUpdated events. */
  lastUrl: Map<number, string>;
}

export const CAUSED_BY_ACTION_MS = 3000;

export function createNavTracker(): NavTracker {
  return { lastActionAt: new Map(), lastUrl: new Map() };
}

export function noteAction(t: NavTracker, tabId: number, now: number): void {
  t.lastActionAt.set(tabId, now);
}

export function isRecordableUrl(url: string | undefined): url is string {
  return !!url && /^(https?|file):/i.test(url);
}

/**
 * Called when a tab's URL changes. Returns true when a navigate step should be recorded.
 * `opener` is the tab that opened this one (if known); an action there also explains the
 * new tab, but a new tab's first page is still shown as its own step so readers know
 * where they are.
 */
export function shouldRecordNavigation(t: NavTracker, tabId: number, url: string, now: number, opts: { isNewTab?: boolean } = {}): boolean {
  const prev = t.lastUrl.get(tabId);
  t.lastUrl.set(tabId, url);
  if (!isRecordableUrl(url)) return false;
  if (prev === url) return false;
  if (opts.isNewTab || prev === undefined) return true;
  const last = t.lastActionAt.get(tabId);
  if (last !== undefined && now - last < CAUSED_BY_ACTION_MS) return false;
  return true;
}

export function forgetTab(t: NavTracker, tabId: number): void {
  t.lastActionAt.delete(tabId);
  t.lastUrl.delete(tabId);
}

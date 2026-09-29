// Redaction presets (Settings), in chrome.storage.local so they survive worker and browser
// restarts and the recorder in every page can read them. Emails are off by default (PLAN §3.7).
export const REDACT_PREFS_KEY = "settings:redact";

export interface RedactPrefs {
  emails: boolean;
}

export function parseRedactPrefs(v: unknown): RedactPrefs {
  return { emails: !!(v && typeof v === "object" && (v as { emails?: unknown }).emails === true) };
}

export async function loadRedactPrefs(): Promise<RedactPrefs> {
  const r = await chrome.storage.local.get(REDACT_PREFS_KEY).catch(() => ({}) as Record<string, unknown>);
  return parseRedactPrefs(r[REDACT_PREFS_KEY]);
}

export async function saveRedactPrefs(p: RedactPrefs): Promise<void> {
  await chrome.storage.local.set({ [REDACT_PREFS_KEY]: p });
}

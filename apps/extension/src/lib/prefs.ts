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

/** Export options kept across exports: the small "Made with Showsteps" credit is off by default (SPEC §9). */
export const EXPORT_PREFS_KEY = "settings:export";

export interface ExportPrefs {
  credit: boolean;
}

export function parseExportPrefs(v: unknown): ExportPrefs {
  return { credit: !!(v && typeof v === "object" && (v as { credit?: unknown }).credit === true) };
}

export async function loadExportPrefs(): Promise<ExportPrefs> {
  try {
    const r = await chrome.storage.local.get(EXPORT_PREFS_KEY);
    return parseExportPrefs(r[EXPORT_PREFS_KEY]);
  } catch {
    return { credit: false };
  }
}

export async function saveExportPrefs(p: ExportPrefs): Promise<void> {
  await chrome.storage.local.set({ [EXPORT_PREFS_KEY]: p });
}

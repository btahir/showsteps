// Redaction presets (Settings), in chrome.storage.local so they survive worker and browser
// restarts and the recorder in every page can read them. Presets (PLAN §3.7, coordinator ruling
// 2026-09-29): IPv4/IPv6 and MAC addresses on by default; phone numbers and emails off.
export const REDACT_PREFS_KEY = "settings:redact";

export interface RedactPrefs {
  emails: boolean;
  phones: boolean;
  ips: boolean;
  macs: boolean;
}

export const DEFAULT_REDACT_PREFS: RedactPrefs = { emails: false, phones: false, ips: true, macs: true };

export function parseRedactPrefs(v: unknown): RedactPrefs {
  const o = v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  const pick = (k: keyof RedactPrefs) => (typeof o[k] === "boolean" ? (o[k] as boolean) : DEFAULT_REDACT_PREFS[k]);
  return { emails: pick("emails"), phones: pick("phones"), ips: pick("ips"), macs: pick("macs") };
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

// When to show the post-export support card (docs/design/SPEC.md §8): on the 1st, 3rd and 10th
// successful export, then every 15th; never again after "Not now" three times.

export interface SupportState {
  exports: number; // successful exports so far, including the one just made
  notNow: number; // times the user pressed "Not now"
}

export function shouldShowSupport(s: SupportState): boolean {
  if (s.notNow >= 3 || s.exports < 1) return false;
  if (s.exports === 1 || s.exports === 3 || s.exports === 10) return true;
  return s.exports > 10 && (s.exports - 10) % 15 === 0;
}

const KEY = "support";

/** Count one successful export and say whether to show the card (chrome.storage.local). */
export async function recordExport(): Promise<boolean> {
  const cur = ((await chrome.storage.local.get(KEY))[KEY] as SupportState | undefined) ?? { exports: 0, notNow: 0 };
  const next = { ...cur, exports: cur.exports + 1 };
  await chrome.storage.local.set({ [KEY]: next });
  return shouldShowSupport(next);
}

export async function recordNotNow(): Promise<void> {
  const cur = ((await chrome.storage.local.get(KEY))[KEY] as SupportState | undefined) ?? { exports: 0, notNow: 0 };
  await chrome.storage.local.set({ [KEY]: { ...cur, notNow: cur.notNow + 1 } });
}

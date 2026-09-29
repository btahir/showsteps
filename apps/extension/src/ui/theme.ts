// Theme preference (SPEC §0): System follows prefers-color-scheme; Light/Dark set <html data-theme>.
import { useCallback, useEffect, useState } from "react";

export type ThemePref = "system" | "light" | "dark";
const KEY = "theme";

function applyTheme(p: ThemePref): void {
  if (p === "system") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = p;
}

export function useTheme(): [ThemePref, (p: ThemePref) => void] {
  const [pref, setPref] = useState<ThemePref>("system");
  useEffect(() => {
    void chrome.storage.local.get(KEY).then((r) => {
      const p = (r[KEY] as ThemePref | undefined) ?? "system";
      setPref(p);
      applyTheme(p);
    });
    const onChange = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === "local" && changes[KEY]) {
        const p = (changes[KEY].newValue as ThemePref | undefined) ?? "system";
        setPref(p);
        applyTheme(p);
      }
    };
    chrome.storage.onChanged.addListener(onChange);
    return () => chrome.storage.onChanged.removeListener(onChange);
  }, []);
  const set = useCallback((p: ThemePref) => {
    setPref(p);
    applyTheme(p);
    void chrome.storage.local.set({ [KEY]: p });
  }, []);
  return [pref, set];
}

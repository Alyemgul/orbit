export const THEME_STORAGE_KEY = "orbit-theme";
export const THEME_PREFERENCES = ["system", "light", "dark"] as const;
export type ThemePreference = (typeof THEME_PREFERENCES)[number];

/**
 * Runs inline in <head> before first paint so the page never flashes the
 * wrong theme. Kept dependency-free and wrapped in try/catch because storage
 * can throw in private windows.
 */
export const THEME_INIT_SCRIPT = `(function(){var d=document.documentElement;var m=window.matchMedia("(prefers-color-scheme: dark)").matches;var p="system";try{p=localStorage.getItem("${THEME_STORAGE_KEY}")||"system"}catch(e){}d.dataset.theme=p==="dark"||(p==="system"&&m)?"dark":"light"})()`;

export function readThemePreference(): ThemePreference {
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    return (THEME_PREFERENCES as readonly string[]).includes(stored ?? "")
      ? (stored as ThemePreference)
      : "system";
  } catch {
    return "system";
  }
}

export function applyThemePreference(preference: ThemePreference): void {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, preference);
  } catch {
    // Storage unavailable: the choice still applies for this page view.
  }
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  const dark = preference === "dark" || (preference === "system" && prefersDark);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
}

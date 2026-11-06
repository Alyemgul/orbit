export const THEME_STORAGE_KEY = "orbit-theme";
/** Lets the server bucket activity by the user's own days (set by the init script). */
export const TIME_ZONE_COOKIE = "orbit-tz";
export const THEME_PREFERENCES = ["system", "light", "dark"] as const;
export type ThemePreference = (typeof THEME_PREFERENCES)[number];

/**
 * Runs inline in <head> before first paint so the page never flashes the
 * wrong theme. Also records the device time zone for activity stats. Kept dependency-free and wrapped in try/catch because storage
 * can throw in private windows.
 */
export const THEME_INIT_SCRIPT = `(function(){var d=document.documentElement;var m=window.matchMedia("(prefers-color-scheme: dark)").matches;var p="system";try{p=localStorage.getItem("${THEME_STORAGE_KEY}")||"system"}catch(e){}d.dataset.theme=p==="dark"||(p==="system"&&m)?"dark":"light";try{document.cookie="${TIME_ZONE_COOKIE}="+encodeURIComponent(Intl.DateTimeFormat().resolvedOptions().timeZone)+";path=/;max-age=31536000;samesite=lax"}catch(e){}})()`;

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

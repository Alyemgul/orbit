"use client";

import { Monitor, Moon, Sun, type LucideIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { applyThemePreference, readThemePreference, type ThemePreference } from "@/lib/theme";
import { cn } from "@/lib/utils";

const OPTIONS: { value: ThemePreference; label: string; icon: LucideIcon }[] = [
  { value: "system", label: "System", icon: Monitor },
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
];

/** Segmented control for light / dark / system theme. */
export function ThemeSwitcher({ showLabels = false }: { showLabels?: boolean }) {
  // null until mounted: the server cannot know the stored preference.
  const [preference, setPreference] = useState<ThemePreference | null>(null);

  useEffect(() => {
    setPreference(readThemePreference());
  }, []);

  // Follow OS changes while the preference is "system".
  useEffect(() => {
    if (preference !== "system") return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => applyThemePreference("system");
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [preference]);

  function select(next: ThemePreference) {
    setPreference(next);
    applyThemePreference(next);
  }

  return (
    <div role="radiogroup" aria-label="Theme" className="inline-flex rounded-lg border bg-surface-2 p-0.5">
      {OPTIONS.map(({ value, label, icon: Icon }) => {
        const active = preference === value;
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={showLabels ? undefined : label}
            title={label}
            onClick={() => select(value)}
            className={cn(
              "inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-xs font-medium text-muted transition-colors",
              active && "bg-surface text-text shadow-card",
            )}
          >
            <Icon className="size-3.5" aria-hidden />
            {showLabels ? label : null}
          </button>
        );
      })}
    </div>
  );
}

import { cn } from "@/lib/utils";

/** Orbit mark: a ring with a satellite, plus the wordmark. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={cn("size-7", className)} aria-hidden>
      <rect width="32" height="32" rx="9" className="fill-accent" />
      <circle cx="16" cy="16" r="7.5" fill="none" strokeWidth="2.5" className="stroke-accent-fg" />
      <circle cx="23.5" cy="10" r="3" className="fill-accent-fg" />
    </svg>
  );
}

export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2 text-lg font-semibold tracking-tight", className)}>
      <LogoMark />
      Orbit
    </span>
  );
}

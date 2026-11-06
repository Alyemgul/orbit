import { LogOut } from "lucide-react";

interface UserFooterProps {
  email: string | null;
}

/** Signed-in identity plus sign-out. Renders a preview label when signed out. */
export function UserFooter({ email }: UserFooterProps) {
  const initials = email ? email.slice(0, 2).toUpperCase() : "—";

  return (
    <div className="flex items-center gap-2.5">
      <div className="grid size-8 shrink-0 place-items-center rounded-full bg-accent-soft text-xs font-semibold text-accent">
        {initials}
      </div>
      <p className="min-w-0 flex-1 truncate text-sm" title={email ?? undefined}>
        {email ?? <span className="text-muted">Preview mode</span>}
      </p>
      {email ? (
        <form action="/auth/signout" method="post">
          <button
            type="submit"
            aria-label="Sign out"
            title="Sign out"
            className="grid size-8 place-items-center rounded-lg text-muted hover:bg-surface-2 hover:text-text"
          >
            <LogOut className="size-4" aria-hidden />
          </button>
        </form>
      ) : null}
    </div>
  );
}

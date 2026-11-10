import Link from "next/link";
import type { ReactNode } from "react";
import { Logo } from "@/components/brand/logo";
import { OfflineBanner } from "@/components/pwa/offline-banner";
import { ToastProvider } from "@/components/ui/toast";
import { BottomTabs } from "./bottom-tabs";
import { SideNav } from "./side-nav";

interface AppShellProps {
  email: string | null;
  /** False when Supabase env vars are missing; shows a setup banner. */
  backendConfigured: boolean;
  children: ReactNode;
}

export function AppShell({ email, backendConfigured, children }: AppShellProps) {
  return (
    <ToastProvider>
    <div className="min-h-dvh">
      <a
        href="#main"
        className="sr-only z-50 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-fg focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
      >
        Skip to content
      </a>
      <SideNav email={email} />

      {/* Mobile top bar */}
      <header className="sticky top-0 z-20 flex h-14 items-center border-b bg-surface/90 px-4 pt-[env(safe-area-inset-top)] backdrop-blur-md md:hidden">
        <Link href="/discover" aria-label="Orbit home">
          <Logo />
        </Link>
      </header>

      <div className="md:pl-60">
        <OfflineBanner />
        {!backendConfigured ? (
          <div role="status" className="border-b bg-warning-soft px-4 py-2.5 text-sm text-warning md:px-8">
            <strong className="font-semibold">Preview mode.</strong> Supabase isn&apos;t connected, so sign-in and
            saving are off. Add your keys to <code className="font-mono">apps/web/.env.local</code> to turn them on.
          </div>
        ) : null}
        <main id="main" tabIndex={-1} className="mx-auto w-full max-w-7xl px-4 pt-6 pb-28 outline-none md:px-8 md:pt-10 md:pb-12">{children}</main>
      </div>

      <BottomTabs />
    </div>
    </ToastProvider>
  );
}

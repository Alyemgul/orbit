import { WifiOff } from "lucide-react";
import type { Metadata } from "next";
import { Logo } from "@/components/brand/logo";

export const metadata: Metadata = { title: "Offline" };
export const dynamic = "force-static";

/** Shown by the service worker when a page isn't saved and there's no connection. */
export default function OfflinePage() {
  return (
    <main className="grid min-h-dvh place-items-center px-4">
      <div className="flex max-w-sm flex-col items-center gap-4 text-center">
        <Logo className="text-2xl" />
        <span className="grid size-14 place-items-center rounded-2xl bg-surface-2">
          <WifiOff className="size-7 text-muted" aria-hidden />
        </span>
        <h1 className="text-xl font-semibold">You&apos;re offline</h1>
        <p className="text-sm text-muted">
          This page hasn&apos;t been saved on this device yet. Pages you&apos;ve opened before still work offline. Orbit will
          pick up where you left off when you reconnect.
        </p>
        <a href="/discover" className="text-sm font-medium text-accent underline underline-offset-2 hover:decoration-2">
          Try again
        </a>
      </div>
    </main>
  );
}

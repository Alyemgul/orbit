import type { Metadata } from "next";
import Link from "next/link";
import { Logo } from "@/components/brand/logo";
import { ClearOnSignedOut } from "@/components/pwa/clear-on-signed-out";
import { Card, CardContent } from "@/components/ui/card";
import { isSupabaseConfigured } from "@/lib/env";
import { safeRedirectPath } from "@/lib/safe-redirect";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

const ERROR_MESSAGES: Record<string, string> = {
  link: "That sign-in link is invalid or has expired. Request a new one.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const next = safeRedirectPath(params.next);
  const errorKey = typeof params.error === "string" ? params.error : undefined;
  const linkError = errorKey ? ERROR_MESSAGES[errorKey] : undefined;
  const configured = isSupabaseConfigured();
  const deleted = params.deleted === "1";

  return (
    <main className="grid min-h-dvh place-items-center px-4 py-10">
      <ClearOnSignedOut />
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-3 text-center">
          <h1 className="sr-only">Sign in to Orbit</h1>
          <Logo className="text-2xl" />
          <p className="text-sm text-muted">Swipe right. Orbit tailors, applies and tracks.</p>
        </div>

        <Card>
          <CardContent className="p-6">
            {deleted ? (
              <p role="status" className="mb-4 rounded-lg bg-success-soft px-3 py-2 text-sm text-success">
                Your account and all its data were deleted.
              </p>
            ) : null}
            {linkError ? (
              <p role="alert" className="mb-4 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
                {linkError}
              </p>
            ) : null}
            {!configured ? (
              <p className="mb-4 rounded-lg bg-warning-soft px-3 py-2 text-sm text-warning">
                Supabase isn&apos;t connected yet, so sign-in is off.{" "}
                <Link href="/discover" className="font-medium underline underline-offset-2">
                  Explore in preview mode
                </Link>
                .
              </p>
            ) : null}
            <LoginForm next={next} disabled={!configured} />
          </CardContent>
        </Card>

        <p className="mt-6 text-center text-xs text-muted">No passwords. We email you a one-time link.</p>
      </div>
    </main>
  );
}

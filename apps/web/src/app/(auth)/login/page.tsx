import type { Metadata } from "next";
import Link from "next/link";
import { Logo } from "@/components/brand/logo";
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

  return (
    <main className="grid min-h-dvh place-items-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-3 text-center">
          <Logo className="text-2xl" />
          <p className="text-sm text-muted">Swipe right. Orbit tailors, applies and tracks.</p>
        </div>

        <Card>
          <CardContent className="p-6">
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

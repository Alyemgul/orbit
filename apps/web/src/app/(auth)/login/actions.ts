"use server";

import { headers } from "next/headers";
import { z } from "zod";
import { isSupabaseConfigured } from "@/lib/env";
import { isEmailAllowed } from "@/lib/env.server";
import { safeRedirectPath } from "@/lib/safe-redirect";
import { createClient } from "@/lib/supabase/server";

export type LoginState =
  | { status: "idle" }
  | { status: "sent"; email: string }
  | { status: "error"; message: string };

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email address."),
  next: z.string().optional(),
});

async function resolveSiteUrl(): Promise<string> {
  const configured = process.env.NEXT_PUBLIC_SITE_URL;
  if (configured) return configured.replace(/\/$/, "");
  const h = await headers();
  const origin = h.get("origin");
  if (origin) return origin;
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

/** Sends a passwordless sign-in link. Orbit never handles passwords. */
export async function requestMagicLink(_prev: LoginState, formData: FormData): Promise<LoginState> {
  if (!isSupabaseConfigured()) {
    return { status: "error", message: "Sign-in is off in preview mode. Connect Supabase first." };
  }

  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    next: formData.get("next") ?? undefined,
  });
  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const { email } = parsed.data;
  if (!isEmailAllowed(email)) {
    return { status: "error", message: "This email isn't on the invite list. Ask the owner to add you." };
  }

  const next = safeRedirectPath(parsed.data.next);
  const siteUrl = await resolveSiteUrl();
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: `${siteUrl}/auth/callback?next=${encodeURIComponent(next)}`,
      shouldCreateUser: true,
    },
  });

  if (error) {
    console.error("signInWithOtp failed:", error.status, error.message);
    if (error.status === 429) {
      return { status: "error", message: "Too many sign-in emails. Wait a minute and try again." };
    }
    return { status: "error", message: "Couldn't send the sign-in link. Try again shortly." };
  }

  return { status: "sent", email };
}

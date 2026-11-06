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
    // Same response as success: don't reveal the invite list.
    return { status: "sent", email };
  }

  const next = safeRedirectPath(parsed.data.next);
  const siteUrl = await resolveSiteUrl();
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: `${siteUrl}/auth/callback?next=${encodeURIComponent(next)}`,
      // Invite-only: accounts are created by the owner in the Supabase dashboard.
      // Public sign-up is also disabled there, so this is enforced server-side too.
      shouldCreateUser: false,
    },
  });

  if (error) {
    if (error.status === 429) {
      return { status: "error", message: "Too many sign-in emails. Wait a minute and try again." };
    }
    // Unknown email: answer exactly as for a known one, so the form can't be
    // used to discover who has an account.
    if (error.code === "otp_disabled" || error.code === "signup_disabled" || error.code === "user_not_found") {
      return { status: "sent", email };
    }
    console.error("signInWithOtp failed:", error.status, error.code, error.message);
    return { status: "error", message: "Couldn't send the sign-in link. Try again shortly." };
  }

  return { status: "sent", email };
}

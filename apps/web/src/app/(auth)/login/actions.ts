"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { isSupabaseConfigured } from "@/lib/env";
import { isEmailAllowed } from "@/lib/env.server";
import { safeRedirectPath } from "@/lib/safe-redirect";
import { createClient } from "@/lib/supabase/server";

export type LoginState =
  | { status: "idle" }
  | { status: "sent"; email: string; next: string; error?: string }
  | { status: "error"; message: string };

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email address."),
  next: z.string().optional(),
});

const codeSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  // Supabase codes are 6 digits by default (up to 10 if changed in the dashboard).
  code: z
    .string()
    .transform((value) => value.replace(/\s+/g, ""))
    .pipe(z.string().regex(/^\d{6,10}$/, "Enter the code from the email.")),
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

/** Sends a one-time sign-in link and code. Orbit never handles passwords. */
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
  const next = safeRedirectPath(parsed.data.next);
  if (!isEmailAllowed(email)) {
    // Same response as success: don't reveal the invite list. The owner can
    // still see why in the server logs (without the address itself).
    console.warn("Sign-in skipped: that email is not in ALLOWED_EMAILS.");
    return { status: "sent", email, next };
  }

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
      return { status: "error", message: "Too many sign-in emails. Wait a while and try again." };
    }
    // Unknown email: answer exactly as for a known one, so the form can't be
    // used to discover who has an account.
    if (error.code === "otp_disabled" || error.code === "signup_disabled" || error.code === "user_not_found") {
      console.warn("Sign-in skipped: no Supabase user with that email (add it in Authentication → Users).");
      return { status: "sent", email, next };
    }
    console.error("signInWithOtp failed:", error.status, error.code, error.message);
    return { status: "error", message: "Couldn't send the sign-in email. Try again shortly." };
  }

  return { status: "sent", email, next };
}

/**
 * Signs in with the code from the email. Unlike the link, this works on any
 * device or browser, including the installed app on a phone.
 */
export async function verifyEmailCode(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const raw = {
    email: formData.get("email"),
    code: formData.get("code"),
    next: formData.get("next") ?? undefined,
  };
  const email = typeof raw.email === "string" ? raw.email : "";
  const fallbackNext = safeRedirectPath(raw.next);

  if (!isSupabaseConfigured()) {
    return { status: "error", message: "Sign-in is off in preview mode. Connect Supabase first." };
  }
  const parsed = codeSchema.safeParse(raw);
  if (!parsed.success) {
    return { status: "sent", email, next: fallbackNext, error: parsed.error.issues[0]?.message ?? "Invalid code." };
  }

  const next = safeRedirectPath(parsed.data.next);
  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({
    email: parsed.data.email,
    token: parsed.data.code,
    type: "email",
  });
  if (error) {
    if (error.status === 429) {
      return { status: "sent", email, next, error: "Too many tries. Wait a minute and try again." };
    }
    return { status: "sent", email, next, error: "That code is wrong or has expired. Check it or request a new one." };
  }

  redirect(next);
}

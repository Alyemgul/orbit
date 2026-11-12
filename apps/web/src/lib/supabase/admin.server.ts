import "server-only";

import type { Database } from "@orbit/core";
import { createClient } from "@supabase/supabase-js";
import { getSupabaseEnv } from "@/lib/env";

/**
 * Server-only admin client, used for one thing: creating the account of an
 * invited email the first time it signs in. Needs SUPABASE_SECRET_KEY (the
 * secret / service_role key) as a *secret* environment variable on the host.
 * Never import this from client code.
 */
function adminClient() {
  const env = getSupabaseEnv();
  const secret = process.env.SUPABASE_SECRET_KEY?.trim();
  if (!env || !secret) return null;
  return createClient<Database>(env.url, secret, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function canCreateAccounts(): boolean {
  return adminClient() !== null;
}

/**
 * Makes sure an invited email has an account, so the sign-in code can be
 * sent. Public sign-up stays off in Supabase: only the server, after
 * checking ALLOWED_EMAILS, can add people.
 */
export async function ensureInvitedAccount(email: string): Promise<"created" | "exists" | "unavailable"> {
  const admin = adminClient();
  if (!admin) return "unavailable";
  const { error } = await admin.auth.admin.createUser({ email, email_confirm: true });
  if (!error) return "created";
  if (error.code === "email_exists" || error.code === "user_already_exists" || error.status === 422) return "exists";
  console.error("Creating invited account failed:", error.status, error.code, error.message);
  return "unavailable";
}

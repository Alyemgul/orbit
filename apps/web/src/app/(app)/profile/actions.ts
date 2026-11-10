"use server";

import { encodeConnection } from "@orbit/core";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { ActionResult } from "@/app/(app)/discover/actions";
import { getSupabaseEnv } from "@/lib/env";
import { gmailScript } from "@/lib/gmail-script";
import { createClient, getCurrentUser } from "@/lib/supabase/server";

const capSchema = z.number().int().min(0).max(200);

export async function updateApplyCap(cap: unknown): Promise<ActionResult<number>> {
  const parsed = capSchema.safeParse(cap);
  if (!parsed.success) return { ok: false, error: "Pick a number from 0 to 200." };
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Your session expired. Sign in again." };

  const supabase = await createClient();
  const { error } = await supabase.from("profiles").update({ daily_apply_cap: parsed.data }).eq("user_id", user.id);
  if (error) {
    console.error(`[orbit] update apply cap: ${error.code} ${error.message}`);
    return { ok: false, error: "Couldn't save the limit." };
  }
  revalidatePath("/discover");
  revalidatePath("/profile");
  return { ok: true, data: parsed.data };
}

const kindSchema = z.enum(["extension", "gmail"]);

/**
 * Creates a new connection (revoking the previous one of that kind) and
 * returns what to paste: the extension's connection code, or the Gmail
 * script with the token filled in. Shown once; only a hash is stored.
 */
export async function createConnection(kind: unknown): Promise<ActionResult<{ code: string }>> {
  const parsed = kindSchema.safeParse(kind);
  const env = getSupabaseEnv();
  if (!parsed.success || !env) return { ok: false, error: "Invalid request." };

  const supabase = await createClient();
  const { data: token, error } = await supabase.rpc("create_connection_token", { p_kind: parsed.data });
  if (error || !token) {
    console.error(`[orbit] create token: ${error?.code} ${error?.message}`);
    return { ok: false, error: "Couldn't create a connection. Did you run migration 0007?" };
  }
  const values = { url: env.url.replace(/\/$/, ""), anonKey: env.anonKey, token };
  revalidatePath("/profile");
  return { ok: true, data: { code: parsed.data === "extension" ? encodeConnection(values) : gmailScript(values) } };
}

export async function revokeConnection(kind: unknown): Promise<ActionResult> {
  const parsed = kindSchema.safeParse(kind);
  if (!parsed.success) return { ok: false, error: "Invalid request." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("revoke_connection_token", { p_kind: parsed.data });
  if (error) return { ok: false, error: "Couldn't revoke it." };
  revalidatePath("/profile");
  return { ok: true, data: undefined };
}

const settingsSchema = z.object({ review: z.boolean(), acceptPrivacy: z.boolean() });

export async function updateAutopilotSettings(settings: unknown): Promise<ActionResult> {
  const parsed = settingsSchema.safeParse(settings);
  if (!parsed.success) return { ok: false, error: "Invalid request." };
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Your session expired. Sign in again." };
  const supabase = await createClient();
  const { data: profile } = await supabase.from("profiles").select("preferences").eq("user_id", user.id).maybeSingle();
  const preferences = {
    ...(profile?.preferences && typeof profile.preferences === "object" && !Array.isArray(profile.preferences) ? profile.preferences : {}),
    autopilot_accept_privacy: parsed.data.acceptPrivacy,
  };
  const { error } = await supabase
    .from("profiles")
    .update({ review_before_send: parsed.data.review, preferences })
    .eq("user_id", user.id);
  if (error) return { ok: false, error: "Couldn't save the settings." };
  revalidatePath("/profile");
  return { ok: true, data: undefined };
}

/** Deletes the account and everything in it, then signs out. Irreversible. */
export async function deleteAccount(confirmation: unknown): Promise<ActionResult> {
  if (confirmation !== "delete my account") return { ok: false, error: 'Type "delete my account" to confirm.' };
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Your session expired. Sign in again." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("delete_my_account");
  if (error) {
    console.error(`[orbit] delete account: ${error.code} ${error.message}`);
    return { ok: false, error: "Couldn't delete your account. Did you run migration 0008?" };
  }
  await supabase.auth.signOut().catch(() => undefined);
  return { ok: true, data: undefined };
}

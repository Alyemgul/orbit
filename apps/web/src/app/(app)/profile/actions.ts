"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { ActionResult } from "@/app/(app)/discover/actions";
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

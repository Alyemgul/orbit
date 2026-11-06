"use server";

import { APPLICATION_STATUSES, STATUS_LABELS } from "@orbit/core";
import { z } from "zod";
import type { ActionResult } from "@/app/(app)/discover/actions";
import { createClient } from "@/lib/supabase/server";

const moveSchema = z.object({ id: z.uuid(), status: z.enum(APPLICATION_STATUSES) });

/** Move an application; the database trigger enforces the state machine. */
export async function moveApplication(id: unknown, status: unknown): Promise<ActionResult> {
  const parsed = moveSchema.safeParse({ id, status });
  if (!parsed.success) return { ok: false, error: "Invalid request." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("applications")
    .update({ status: parsed.data.status, updated_by: "user" })
    .eq("id", parsed.data.id)
    .select("id");
  if (error) {
    console.error(`[orbit] move application: ${error.code} ${error.message}`);
    return {
      ok: false,
      error:
        error.code === "23514"
          ? `Can't move this application to ${STATUS_LABELS[parsed.data.status]} from where it is.`
          : "Couldn't move that application.",
    };
  }
  if (!data?.length) return { ok: false, error: "That application no longer exists." };
  return { ok: true, data: undefined };
}

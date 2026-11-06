"use server";

import { feedCursorSchema, feedFiltersSchema } from "@orbit/core";
import { z } from "zod";
import { fetchFeed } from "@/lib/data.server";
import type { FeedJob } from "@/lib/jobs/feed-job";
import { createClient } from "@/lib/supabase/server";

export type ActionResult<T = undefined> = { ok: true; data: T } | { ok: false; error: string };

const jobIdSchema = z.uuid();
const decisionSchema = z.enum(["skip", "save", "apply"]);

export async function loadMoreJobs(filters: unknown, cursor: unknown): Promise<ActionResult<FeedJob[]>> {
  const parsedFilters = feedFiltersSchema.safeParse(filters);
  const parsedCursor = feedCursorSchema.nullable().safeParse(cursor);
  if (!parsedFilters.success || !parsedCursor.success) return { ok: false, error: "Invalid request." };
  try {
    return { ok: true, data: await fetchFeed(parsedFilters.data, parsedCursor.data) };
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }
}

/** Records a swipe; right and up also create the application (queued or saved). */
export async function swipeJob(jobId: unknown, decision: unknown): Promise<ActionResult<string | null>> {
  const id = jobIdSchema.safeParse(jobId);
  const choice = decisionSchema.safeParse(decision);
  if (!id.success || !choice.success) return { ok: false, error: "Invalid request." };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("record_swipe", { p_job_id: id.data, p_decision: choice.data });
  if (error) {
    console.error(`[orbit] record_swipe: ${error.code} ${error.message}`);
    return { ok: false, error: error.code === "42501" ? "Your session expired. Sign in again." : "Couldn't save that swipe." };
  }
  return { ok: true, data };
}

export async function undoSwipe(jobId: unknown): Promise<ActionResult> {
  const id = jobIdSchema.safeParse(jobId);
  if (!id.success) return { ok: false, error: "Invalid request." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("undo_swipe", { p_job_id: id.data });
  if (error) {
    console.error(`[orbit] undo_swipe: ${error.code} ${error.message}`);
    return { ok: false, error: "Couldn't undo that swipe." };
  }
  return { ok: true, data: undefined };
}

"use server";

import { answerValueSchema, isSensitiveQuestion, questionHash } from "@orbit/core";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { ActionResult } from "@/app/(app)/discover/actions";
import { createClient, getCurrentUser } from "@/lib/supabase/server";

const answersSchema = z
  .array(z.object({ question: z.string().trim().min(1).max(2000), answer: answerValueSchema }))
  .max(30);

async function remember(userId: string, answers: z.infer<typeof answersSchema>) {
  const supabase = await createClient();
  const rows = await Promise.all(
    answers.map(async ({ question, answer }) => ({
      user_id: userId,
      question_hash: await questionHash(question),
      question_text: question,
      answer,
      is_sensitive: isSensitiveQuestion(question),
    })),
  );
  if (!rows.length) return null;
  const { error } = await supabase.from("screening_answers").upsert(rows, { onConflict: "user_id,question_hash" });
  return error;
}

/** Saves the answers to memory and puts the application back in the autopilot's queue. */
export async function answerAndRetry(applicationId: unknown, answers: unknown): Promise<ActionResult> {
  const id = z.uuid().safeParse(applicationId);
  const parsed = answersSchema.safeParse(answers);
  if (!id.success || !parsed.success) return { ok: false, error: "Some answers are too long or empty." };
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Your session expired. Sign in again." };

  const saveError = await remember(user.id, parsed.data);
  if (saveError) {
    console.error(`[orbit] save answers: ${saveError.code} ${saveError.message}`);
    return { ok: false, error: "Couldn't save your answers." };
  }

  const supabase = await createClient();
  const { data: app } = await supabase.from("applications").select("status").eq("id", id.data).maybeSingle();
  if (!app) return { ok: false, error: "That application no longer exists." };
  // needs_input goes back to ready; a failed one goes back to the queue.
  const next = app.status === "needs_input" ? "ready" : app.status === "failed" ? "queued" : null;
  if (next) {
    const { error } = await supabase
      .from("applications")
      .update({ status: next, needs: null, last_error: null, updated_by: "user" })
      .eq("id", id.data);
    if (error) {
      console.error(`[orbit] retry application: ${error.code} ${error.message}`);
      return { ok: false, error: "Saved your answers, but couldn't requeue it." };
    }
  }
  revalidatePath("/inbox");
  revalidatePath("/pipeline");
  return { ok: true, data: undefined };
}

const memoryEditSchema = z.object({ id: z.uuid(), answer: answerValueSchema });

export async function updateMemory(id: unknown, answer: unknown): Promise<ActionResult> {
  const parsed = memoryEditSchema.safeParse({ id, answer });
  if (!parsed.success) return { ok: false, error: "An answer can't be empty." };
  const supabase = await createClient();
  const { error } = await supabase.from("screening_answers").update({ answer: parsed.data.answer }).eq("id", parsed.data.id);
  if (error) return { ok: false, error: "Couldn't update that answer." };
  revalidatePath("/inbox");
  return { ok: true, data: undefined };
}

export async function deleteMemory(id: unknown): Promise<ActionResult> {
  const parsed = z.uuid().safeParse(id);
  if (!parsed.success) return { ok: false, error: "Invalid request." };
  const supabase = await createClient();
  const { error } = await supabase.from("screening_answers").delete().eq("id", parsed.data);
  if (error) return { ok: false, error: "Couldn't delete that answer." };
  revalidatePath("/inbox");
  return { ok: true, data: undefined };
}

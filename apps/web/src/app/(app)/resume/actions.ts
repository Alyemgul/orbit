"use server";

import {
  analyzeJob,
  buildRewriteMessages,
  isResumeEmpty,
  parseRewriteResponse,
  resumeSchema,
  tailorResume,
  type RewriteProposal,
} from "@orbit/core";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { ActionResult } from "@/app/(app)/discover/actions";
import { chatJson, getLlmConfig, LlmError } from "@/lib/llm.server";
import { fetchMasterResume, fetchTailorContext, tailorInputsSchema } from "@/lib/resume.server";
import { createClient } from "@/lib/supabase/server";

const applicationIdSchema = z.uuid();

function sessionError(code: string | undefined, fallback: string): string {
  return code === "42501" ? "Your session expired. Sign in again." : fallback;
}

export async function saveMasterResume(content: unknown): Promise<ActionResult<{ updatedAt: string }>> {
  const parsed = resumeSchema.safeParse(content);
  if (!parsed.success) return { ok: false, error: "Some fields are too long or malformed." };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("save_master_resume", { p_content: parsed.data });
  if (error || !data?.[0]) {
    console.error(`[orbit] save_master_resume: ${error?.code} ${error?.message}`);
    return { ok: false, error: sessionError(error?.code, "Couldn't save your resume.") };
  }
  revalidatePath("/resume");
  return { ok: true, data: { updatedAt: data[0].updated_at } };
}

/** Asks the configured free AI provider for rewordings. Nothing is saved here. */
export async function rewriteWithAi(applicationId: unknown): Promise<ActionResult<RewriteProposal>> {
  const id = applicationIdSchema.safeParse(applicationId);
  if (!id.success) return { ok: false, error: "Invalid request." };

  const config = getLlmConfig();
  if (!config) return { ok: false, error: "AI rewriting isn't set up. The built-in tailoring still works." };

  // Everything sent to the model comes from the database, never from the browser.
  const master = await fetchMasterResume().catch(() => null);
  if (!master || isResumeEmpty(master.resume)) return { ok: false, error: "Add bullets to your master resume first." };
  const context = await fetchTailorContext(id.data, master).catch(() => null);
  if (!context) return { ok: false, error: "That application no longer exists." };

  const supabase = await createClient();
  const { data: allowed, error } = await supabase.rpc("claim_llm_call", { p_kind: "tailor" });
  if (error) {
    console.error(`[orbit] claim_llm_call: ${error.code} ${error.message}`);
    return { ok: false, error: sessionError(error.code, "Couldn't start the rewrite.") };
  }
  if (!allowed) return { ok: false, error: "You've used today's AI rewrites. The built-in tailoring still works." };

  try {
    const analysis = analyzeJob(context.job.title, context.job.description);
    const reply = await chatJson(config, buildRewriteMessages(master.resume, context.job, analysis));
    const proposal = parseRewriteResponse(reply, master.resume);
    if (!proposal) return { ok: false, error: `${config.label} replied in a format Orbit couldn't read. Try again.` };
    return { ok: true, data: proposal };
  } catch (error) {
    if (error instanceof LlmError) {
      console.error(`[orbit] llm: ${error.message}`);
      return { ok: false, error: error.userMessage };
    }
    throw error;
  }
}

const saveInputSchema = tailorInputsSchema.extend({ source: z.enum(["rules", "ai"]).catch("rules") });

/**
 * Saves a tailored version. The browser sends only its choices (which
 * rewrites to keep, which bullets to hide); the server rebuilds the copy
 * from the stored master, so the fact check can't be skipped.
 */
export async function saveTailoredVersion(applicationId: unknown, inputs: unknown): Promise<ActionResult<{ id: string; score: number | null }>> {
  const id = applicationIdSchema.safeParse(applicationId);
  const choice = saveInputSchema.safeParse(inputs);
  if (!id.success || !choice.success) return { ok: false, error: "Invalid request." };

  const master = await fetchMasterResume().catch(() => null);
  if (!master) return { ok: false, error: "Save your master resume first." };
  const context = await fetchTailorContext(id.data, master).catch(() => null);
  if (!context) return { ok: false, error: "That application no longer exists." };

  const analysis = analyzeJob(context.job.title, context.job.description);
  const result = tailorResume(master.resume, analysis, choice.data);
  // Keep only what survived the fact check, so reopening shows the same thing.
  const kept = result.changes.filter((c) => c.status === "rewritten");
  const storedInputs = {
    rewrites: Object.fromEntries(kept.filter((c) => c.id !== "summary").map((c) => [c.id, c.after])),
    summary: kept.find((c) => c.id === "summary")?.after ?? null,
    hidden: choice.data.hidden,
  };
  const diff = result.changes
    .filter((c) => c.status !== "unchanged" || c.hidden)
    .map((c) => ({ id: c.id, status: c.status, hidden: c.hidden, before: c.before, after: c.after }));

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("save_resume_variant", {
    p_application_id: id.data,
    p_content: result.resume,
    p_inputs: storedInputs,
    p_diff: diff,
    p_match_score: result.after.score,
    p_missing_keywords: result.after.missing.map((k) => k.label),
    p_source: kept.length ? choice.data.source : "rules",
  });
  if (error || !data) {
    console.error(`[orbit] save_resume_variant: ${error?.code} ${error?.message}`);
    return { ok: false, error: sessionError(error?.code, "Couldn't save this version.") };
  }
  revalidatePath("/pipeline");
  revalidatePath("/resume");
  return { ok: true, data: { id: data, score: result.after.score } };
}

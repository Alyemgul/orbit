import "server-only";

import type { ApplicationStatus, PendingQuestion } from "@orbit/core";
import { z } from "zod";
import { DataError } from "@/lib/data.server";
import { createClient } from "@/lib/supabase/server";

export interface InboxItem {
  id: string;
  status: Extract<ApplicationStatus, "needs_input" | "failed">;
  title: string;
  company: string;
  applyUrl: string;
  reason: string;
  questions: PendingQuestion[];
  updatedAt: string;
}

export interface MemoryItem {
  id: string;
  question: string;
  answer: string | string[];
  sensitive: boolean;
  updatedAt: string;
}

const questionSchema = z.object({
  text: z.string().max(500),
  type: z.enum(["text", "textarea", "select", "radio", "checkbox", "file", "other"]).catch("text"),
  options: z.array(z.string().max(200)).max(50).optional(),
  required: z.boolean().catch(true),
});
const needsSchema = z.object({
  reason: z.string().max(300).catch(""),
  questions: z.array(questionSchema).max(30).catch([]),
});

export async function fetchInbox(): Promise<InboxItem[]> {
  const supabase = await createClient();
  const { data: apps, error } = await supabase
    .from("applications")
    .select("id, job_id, status, needs, last_error, updated_at")
    .in("status", ["needs_input", "failed"])
    .order("updated_at", { ascending: false })
    .limit(100);
  if (error) throw new DataError("your inbox", error);
  if (!apps?.length) return [];

  const { data: jobs } = await supabase
    .from("jobs")
    .select("id, title, company, apply_url")
    .in("id", [...new Set(apps.map((a) => a.job_id))]);
  const byId = new Map((jobs ?? []).map((j) => [j.id, j]));

  return apps.map((app) => {
    const job = byId.get(app.job_id);
    const needs = needsSchema.safeParse(app.needs ?? {});
    return {
      id: app.id,
      status: app.status as InboxItem["status"],
      title: job?.title ?? "Job",
      company: job?.company ?? "",
      applyUrl: job?.apply_url ?? "",
      reason: (needs.success && needs.data.reason) || app.last_error || "",
      questions: needs.success ? needs.data.questions : [],
      updatedAt: app.updated_at,
    };
  });
}

export async function fetchAnswerMemory(): Promise<MemoryItem[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("screening_answers")
    .select("id, question_text, answer, is_sensitive, updated_at")
    .order("updated_at", { ascending: false })
    .limit(500);
  if (error) throw new DataError("saved answers", error);
  return (data ?? []).flatMap((row) => {
    const answer = row.answer;
    if (typeof answer !== "string" && !(Array.isArray(answer) && answer.every((a) => typeof a === "string"))) return [];
    return [{ id: row.id, question: row.question_text, answer: answer as string | string[], sensitive: row.is_sensitive, updatedAt: row.updated_at }];
  });
}

export interface ConnectionInfo {
  kind: "extension" | "gmail";
  createdAt: string;
  lastUsedAt: string | null;
}

export async function fetchConnections(): Promise<ConnectionInfo[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("connection_tokens")
    .select("kind, created_at, last_used_at")
    .is("revoked_at", null)
    .order("created_at", { ascending: false });
  return (data ?? []).map((row) => ({ kind: row.kind, createdAt: row.created_at, lastUsedAt: row.last_used_at }));
}

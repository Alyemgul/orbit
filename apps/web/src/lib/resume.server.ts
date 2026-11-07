import "server-only";

import { readResume, type ApplicationStatus, type Resume } from "@orbit/core";
import { z } from "zod";
import { DataError } from "@/lib/data.server";
import { createClient } from "@/lib/supabase/server";

export interface MasterResume {
  id: string;
  resume: Resume;
  updatedAt: string;
}

export async function fetchMasterResume(): Promise<MasterResume | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("resumes")
    .select("id, content, updated_at")
    .eq("is_master", true)
    .maybeSingle();
  if (error) throw new DataError("your resume", error);
  if (!data) return null;
  const resume = readResume(data.content);
  return resume ? { id: data.id, resume, updatedAt: data.updated_at } : null;
}

export interface TailorJob {
  title: string;
  company: string;
  location: string;
  description: string;
  applyUrl: string;
}

/** What a saved version was built from, so the editor can reopen it. */
export const tailorInputsSchema = z.object({
  rewrites: z.record(z.string().max(60), z.string().max(600)).catch({}),
  summary: z.string().max(1500).nullable().catch(null),
  hidden: z.array(z.string().max(60)).max(400).catch([]),
});
export type TailorInputs = z.infer<typeof tailorInputsSchema>;

export interface SavedVersion {
  id: string;
  createdAt: string;
  matchScore: number | null;
  source: "rules" | "ai";
  inputs: TailorInputs;
  /** The master changed after this version was saved. */
  outdated: boolean;
}

export interface TailorContext {
  applicationId: string;
  status: ApplicationStatus;
  job: TailorJob;
  latest: SavedVersion | null;
}

export async function fetchTailorContext(applicationId: string, master: MasterResume | null): Promise<TailorContext | null> {
  const supabase = await createClient();
  const { data: application, error } = await supabase
    .from("applications")
    .select("id, job_id, status, resume_variant_id")
    .eq("id", applicationId)
    .maybeSingle();
  if (error) throw new DataError("the application", error);
  if (!application) return null;

  const [job, variant] = await Promise.all([
    supabase.from("jobs").select("title, company, location, description, apply_url").eq("id", application.job_id).maybeSingle(),
    application.resume_variant_id
      ? supabase
          .from("resume_variants")
          .select("id, created_at, match_score, source, inputs, base_updated_at")
          .eq("id", application.resume_variant_id)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);
  if (job.error) throw new DataError("the job", job.error);
  if (!job.data) return null;

  const v = variant.data;
  return {
    applicationId: application.id,
    status: application.status,
    job: {
      title: job.data.title,
      company: job.data.company,
      location: job.data.location,
      description: job.data.description,
      applyUrl: job.data.apply_url,
    },
    latest: v
      ? {
          id: v.id,
          createdAt: v.created_at,
          matchScore: v.match_score === null ? null : Number(v.match_score),
          source: v.source,
          inputs: tailorInputsSchema.parse(v.inputs ?? {}),
          outdated: Boolean(master && v.base_updated_at && v.base_updated_at < master.updatedAt),
        }
      : null,
  };
}

export interface VersionListItem {
  id: string;
  applicationId: string;
  createdAt: string;
  matchScore: number | null;
  source: "rules" | "ai";
  title: string;
  company: string;
}

/** Recent tailored versions with the job each was made for. */
export async function fetchRecentVersions(limit = 20): Promise<VersionListItem[]> {
  const supabase = await createClient();
  const { data: variants, error } = await supabase
    .from("resume_variants")
    .select("id, application_id, created_at, match_score, source")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new DataError("tailored versions", error);
  if (!variants?.length) return [];

  const applicationIds = [...new Set(variants.map((v) => v.application_id))];
  const { data: applications } = await supabase.from("applications").select("id, job_id").in("id", applicationIds);
  const jobIds = [...new Set((applications ?? []).map((a) => a.job_id))];
  const { data: jobs } = jobIds.length
    ? await supabase.from("jobs").select("id, title, company").in("id", jobIds)
    : { data: [] };
  const jobByApplication = new Map(
    (applications ?? []).map((a) => [a.id, (jobs ?? []).find((j) => j.id === a.job_id)]),
  );

  return variants.map((v) => {
    const job = jobByApplication.get(v.application_id);
    return {
      id: v.id,
      applicationId: v.application_id,
      createdAt: v.created_at,
      matchScore: v.match_score === null ? null : Number(v.match_score),
      source: v.source,
      title: job?.title ?? "Job",
      company: job?.company ?? "",
    };
  });
}

export async function fetchLlmUsage(): Promise<{ used: number; limit: number }> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("my_llm_usage");
  const row = data?.[0];
  return { used: row?.used ?? 0, limit: row?.daily_limit ?? 30 };
}

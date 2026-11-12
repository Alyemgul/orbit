import "server-only";

import { analyzeJob, scoreResume, type Database, type Resume } from "@orbit/core";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { unstable_cache } from "next/cache";
import { getSupabaseEnv } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

/** How many of the newest open jobs get scored (one database page). */
export const SCORED_JOB_LIMIT = 1000;

export interface MatchSummary {
  /** Open jobs in the database right now. */
  openJobs: number;
  /** Jobs scored (the newest open ones, up to SCORED_JOB_LIMIT). */
  scored: number;
  /** Posts that name too few skills to score. */
  unscored: number;
  buckets: { min80: number; from70: number; from50: number; below50: number };
  top: { id: string; title: string; company: string; score: number }[];
  computedAt: string;
}

export function summarizeMatches(
  resume: Resume,
  jobs: { id: string; title: string; company: string; description: string }[],
  openJobs: number,
): MatchSummary {
  const buckets = { min80: 0, from70: 0, from50: 0, below50: 0 };
  const scoredJobs: MatchSummary["top"] = [];
  let unscored = 0;
  for (const job of jobs) {
    const { score } = scoreResume(resume, analyzeJob(job.title, job.description));
    if (score === null) {
      unscored++;
      continue;
    }
    if (score >= 80) buckets.min80++;
    else if (score >= 70) buckets.from70++;
    else if (score >= 50) buckets.from50++;
    else buckets.below50++;
    scoredJobs.push({ id: job.id, title: job.title, company: job.company, score });
  }
  scoredJobs.sort((a, b) => b.score - a.score);
  return {
    openJobs: Math.max(openJobs, jobs.length),
    scored: jobs.length,
    unscored,
    buckets,
    top: scoredJobs.slice(0, 5),
    computedAt: new Date().toISOString(),
  };
}

/**
 * Scores the newest open jobs against the master resume. Job descriptions are
 * large, so the result is cached per user and resume version and refreshed
 * every 6 hours (as often as new jobs arrive), to stay inside the free
 * database transfer quota.
 */
export async function fetchMatchSummary(
  userId: string,
  master: { resume: Resume; updatedAt: string },
): Promise<MatchSummary> {
  const env = getSupabaseEnv();
  if (!env) throw new Error("Supabase is not configured");
  // The cookie-bound client can't be used inside the cache, so the work runs
  // with the caller's own access token (row-level security still applies).
  const { data } = await (await createClient()).auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Not signed in");

  const compute = unstable_cache(
    async () => {
      const supabase = createSupabaseClient<Database>(env.url, env.anonKey, {
        global: { headers: { Authorization: `Bearer ${token}` } },
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const [jobs, count] = await Promise.all([
        supabase
          .from("jobs")
          .select("id, title, company, description")
          .is("closed_at", null)
          .order("posted_at", { ascending: false, nullsFirst: false })
          .limit(SCORED_JOB_LIMIT),
        supabase.from("jobs").select("id", { count: "exact", head: true }).is("closed_at", null),
      ]);
      if (jobs.error) throw jobs.error;
      return summarizeMatches(master.resume, jobs.data ?? [], count.count ?? 0);
    },
    ["match-summary", userId, master.updatedAt],
    { revalidate: 6 * 60 * 60 },
  );
  return compute();
}

import "server-only";

import {
  feedArgs,
  type ActivityDay,
  type FeedCursor,
  type FeedFilters,
  type PipelineItem,
} from "@orbit/core";
import { cookies } from "next/headers";
import { toFeedJob, type FeedJob } from "@/lib/jobs/feed-job";
import { createClient } from "@/lib/supabase/server";
import { TIME_ZONE_COOKIE } from "@/lib/theme";

export const FEED_PAGE_SIZE = 20;

/** Data failures surface as a short message; details stay in server logs. */
export class DataError extends Error {
  constructor(what: string, cause: { message: string; code?: string }) {
    super(`Couldn't load ${what}.`);
    this.name = "DataError";
    console.error(`[orbit] ${what}: ${cause.code ?? ""} ${cause.message}`);
  }
}

export async function fetchFeed(filters: FeedFilters, cursor: FeedCursor | null): Promise<FeedJob[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("discover_feed", feedArgs(filters, cursor, FEED_PAGE_SIZE));
  if (error) throw new DataError("jobs", error);
  return (data ?? []).map(toFeedJob);
}

export async function fetchPipeline(): Promise<PipelineItem[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("my_pipeline");
  if (error) throw new DataError("applications", error);
  return data ?? [];
}

/** The device time zone recorded by the init script (falls back to UTC). */
export async function timeZone(): Promise<string> {
  let value = (await cookies()).get(TIME_ZONE_COOKIE)?.value ?? "";
  try {
    value = decodeURIComponent(value);
  } catch {
    value = "";
  }
  // The database falls back to UTC for unknown names; this only rejects junk.
  return /^[A-Za-z][A-Za-z0-9_+\-/]{0,63}$/.test(value) ? value : "UTC";
}

/** Today's date ("YYYY-MM-DD") in the user's time zone. */
export async function todayInTimeZone(): Promise<string> {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: await timeZone() }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

export async function fetchActivity(days = 182): Promise<ActivityDay[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("my_activity", { p_days: days, p_time_zone: await timeZone() });
  if (error) throw new DataError("activity", error);
  return data ?? [];
}

export interface ApplyBudget {
  /** Right swipes in the last 24 hours. */
  used: number;
  cap: number;
}

export async function fetchApplyBudget(userId: string): Promise<ApplyBudget> {
  const supabase = await createClient();
  const since = new Date(Date.now() - 24 * 3_600_000).toISOString();
  const [swipes, profile] = await Promise.all([
    supabase.from("swipes").select("job_id", { count: "exact", head: true }).eq("decision", "apply").gte("created_at", since),
    supabase.from("profiles").select("daily_apply_cap").eq("user_id", userId).maybeSingle(),
  ]);
  return { used: swipes.count ?? 0, cap: profile.data?.daily_apply_cap ?? 15 };
}

export interface SourceHealth {
  lastRunAt: string | null;
  sources: number;
  failing: string[];
}

/** Latest result per source over the last two days of ingest runs. */
export async function fetchSourceHealth(): Promise<SourceHealth> {
  const supabase = await createClient();
  const since = new Date(Date.now() - 48 * 3_600_000).toISOString();
  const { data, error } = await supabase
    .from("source_runs")
    .select("source, status, started_at")
    .gte("started_at", since)
    .order("started_at", { ascending: false })
    .limit(1000);
  if (error || !data) return { lastRunAt: null, sources: 0, failing: [] };
  const latest = new Map<string, string>();
  for (const run of data) if (!latest.has(run.source)) latest.set(run.source, run.status);
  return {
    lastRunAt: data[0]?.started_at ?? null,
    sources: latest.size,
    failing: [...latest].filter(([, status]) => status === "failed").map(([source]) => source),
  };
}

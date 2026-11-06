import type { Database, JobUpsert } from "@orbit/core";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { IngestSink, SourceRunRecord } from "./run";
import type { WatchedBoard } from "./sources";

/** Writes through the service-role-only ingest functions in Postgres. */
export class SupabaseSink implements IngestSink {
  private readonly client: SupabaseClient<Database>;

  constructor(url: string, secretKey: string) {
    this.client = createClient<Database>(url, secretKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }

  async loadWatchedBoards(): Promise<WatchedBoard[]> {
    const { data, error } = await this.client.from("watched_companies").select("ats_type, board_token, company_name");
    if (error) throw new Error(`loading watchlist: ${error.message}`);
    return data.map((row) => ({ atsType: row.ats_type, boardToken: row.board_token, companyName: row.company_name }));
  }

  async upsertJobs(rows: JobUpsert[]): Promise<number> {
    const { data, error } = await this.client.rpc("ingest_upsert_jobs", { p_jobs: rows });
    if (error) throw new Error(error.message);
    return data ?? 0;
  }

  async closeMissing(source: string, seenBefore: Date): Promise<number> {
    const { data, error } = await this.client.rpc("ingest_close_missing", {
      p_source: source,
      p_seen_before: seenBefore.toISOString(),
    });
    if (error) throw new Error(error.message);
    return data ?? 0;
  }

  async recordRun(run: SourceRunRecord): Promise<void> {
    const { error } = await this.client.from("source_runs").insert({
      source: run.source,
      status: run.status,
      started_at: run.startedAt.toISOString(),
      fetched: run.fetched,
      upserted: run.upserted,
      closed: run.closed,
      invalid: run.invalid,
      error: run.error,
    });
    if (error) throw new Error(error.message);
  }

  async prune(retentionDays: number): Promise<number> {
    const { data, error } = await this.client.rpc("ingest_prune", { p_retention_days: retentionDays });
    if (error) throw new Error(error.message);
    return data ?? 0;
  }
}

/** Keeps everything in memory: dry runs write it to a JSON file for inspection. */
export class MemorySink implements IngestSink {
  readonly jobs = new Map<string, JobUpsert>();
  readonly runs: SourceRunRecord[] = [];

  async loadWatchedBoards(): Promise<WatchedBoard[]> {
    return [];
  }

  async upsertJobs(rows: JobUpsert[]): Promise<number> {
    let written = 0;
    for (const row of rows) {
      const existing = this.jobs.get(row.dedupe_hash);
      if (!existing || row.source_priority >= existing.source_priority) {
        this.jobs.set(row.dedupe_hash, row);
        written++;
      }
    }
    return written;
  }

  async closeMissing(): Promise<number> {
    return 0;
  }

  async recordRun(run: SourceRunRecord): Promise<void> {
    this.runs.push(run);
  }

  async prune(): Promise<number> {
    return 0;
  }
}

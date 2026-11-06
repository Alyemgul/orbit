import { scopeDecision, type JobUpsert, type ScopeRule, type SourceRunStatus } from "@orbit/core";
import { ZodError } from "zod";
import { mapLimit, type HttpClient } from "./http";
import { normalizeJob, toUpsertRow } from "./normalize";
import type { WatchedBoard } from "./sources";
import type { Logger, Source } from "./sources/types";

export interface SourceRunRecord {
  source: string;
  status: SourceRunStatus;
  startedAt: Date;
  fetched: number;
  upserted: number;
  closed: number;
  invalid: number;
  /** Valid postings dropped by the scope rule (not stored in the run log). */
  outOfScope: number;
  error: string | null;
}

/** Where ingested jobs go: Supabase in production, memory for dry runs and tests. */
export interface IngestSink {
  loadWatchedBoards(): Promise<WatchedBoard[]>;
  upsertJobs(rows: JobUpsert[]): Promise<number>;
  closeMissing(source: string, seenBefore: Date): Promise<number>;
  recordRun(run: SourceRunRecord): Promise<void>;
  prune(retentionDays: number): Promise<number>;
}

export interface RunOptions {
  sources: readonly Source[];
  sink: IngestSink;
  http: HttpClient;
  log: Logger;
  concurrency: number;
  sourceTimeoutMs: number;
  retentionDays: number;
  /** Which jobs are worth storing; omit to keep everything. */
  scope?: ScopeRule;
  /** Rows per database call; keeps request bodies well under limits. */
  batchSize?: number;
}

export interface IngestSummary {
  runs: SourceRunRecord[];
  pruned: number;
  /** True when at least one source succeeded and every database write worked. */
  healthy: boolean;
}

interface FetchOutcome {
  source: Source;
  startedAt: Date;
  rows: JobUpsert[];
  fetched: number;
  invalid: number;
  outOfScope: number;
  error: string | null;
}

function errorMessage(error: unknown): string {
  // Zod errors serialize as JSON; keep the first issue readable in the run log.
  if (error instanceof ZodError) {
    const issue = error.issues[0];
    return `unexpected response format${issue ? ` at ${issue.path.join(".") || "root"}: ${issue.message}` : ""}`;
  }
  return (error instanceof Error ? error.message : String(error)).slice(0, 500);
}

async function fetchSource(source: Source, options: RunOptions): Promise<FetchOutcome> {
  const startedAt = new Date();
  const controller = new AbortController();
  // Rejects when the budget runs out, even if the connector ignores its signal.
  const deadline = new Promise<never>((_, reject) => {
    controller.signal.addEventListener("abort", () => reject(controller.signal.reason), { once: true });
  });
  const timer = setTimeout(
    () => controller.abort(new Error(`timed out after ${options.sourceTimeoutMs} ms`)),
    options.sourceTimeoutMs,
  );
  try {
    const raw = await Promise.race([
      source.fetchJobs({ http: options.http, signal: controller.signal, log: options.log }),
      deadline,
    ]);
    const rows: JobUpsert[] = [];
    let invalid = 0;
    let outOfScope = 0;
    for (const item of raw) {
      const result = normalizeJob(item, source);
      if (!result.ok) invalid++;
      else if (options.scope && scopeDecision(result.job, options.scope) === "out_of_scope") outOfScope++;
      else rows.push(toUpsertRow(result.job));
    }
    if (invalid > 0) options.log.warn(`${source.id}: skipped ${invalid} invalid posting(s)`);
    return { source, startedAt, rows, fetched: raw.length, invalid, outOfScope, error: null };
  } catch (error) {
    const message = controller.signal.aborted ? errorMessage(controller.signal.reason) : errorMessage(error);
    options.log.error(`${source.id}: ${message}`);
    return { source, startedAt, rows: [], fetched: 0, invalid: 0, outOfScope: 0, error: message };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * One ingest run:
 * 1. fetch every source in parallel, each isolated with its own time budget;
 * 2. de-duplicate across sources (company boards beat aggregators);
 * 3. upsert, then close jobs that successful sources no longer list;
 * 4. log a run record per source and prune long-closed jobs.
 *
 * A failing or empty source never closes its existing jobs, so an API outage
 * can't wipe the feed.
 */
export async function runIngest(options: RunOptions): Promise<IngestSummary> {
  const { sink, log, batchSize = 200 } = options;
  const runStartedAt = new Date();

  const outcomes = await mapLimit(options.sources, options.concurrency, (source) => fetchSource(source, options));

  // Cross-source de-duplication: keep the highest-priority copy of each posting.
  const best = new Map<string, JobUpsert>();
  for (const outcome of outcomes) {
    for (const row of outcome.rows) {
      const existing = best.get(row.dedupe_hash);
      if (!existing || row.source_priority > existing.source_priority) best.set(row.dedupe_hash, row);
    }
  }
  const rowsBySource = new Map<string, JobUpsert[]>();
  for (const row of best.values()) {
    const list = rowsBySource.get(row.source) ?? [];
    list.push(row);
    rowsBySource.set(row.source, list);
  }

  let healthy = outcomes.some((o) => o.error === null);
  const upserted = new Map<string, number>();
  const writeFailed = new Map<string, string>();

  for (const outcome of outcomes) {
    const rows = rowsBySource.get(outcome.source.id) ?? [];
    let count = 0;
    try {
      for (let i = 0; i < rows.length; i += batchSize) {
        count += await sink.upsertJobs(rows.slice(i, i + batchSize));
      }
    } catch (error) {
      healthy = false;
      writeFailed.set(outcome.source.id, `database write failed: ${errorMessage(error)}`);
      log.error(`${outcome.source.id}: ${writeFailed.get(outcome.source.id)}`);
    }
    upserted.set(outcome.source.id, count);
  }

  const runs: SourceRunRecord[] = [];
  for (const outcome of outcomes) {
    const id = outcome.source.id;
    const error = outcome.error ?? writeFailed.get(id) ?? null;
    let closed = 0;
    // Only a clean, non-empty fetch is trusted to say which jobs are gone.
    if (!error && outcome.fetched > 0) {
      try {
        closed = await sink.closeMissing(id, runStartedAt);
      } catch (closeError) {
        healthy = false;
        log.error(`${id}: closing missing jobs failed: ${errorMessage(closeError)}`);
      }
    }
    const status: SourceRunStatus = error ? "failed" : outcome.fetched === 0 ? "empty" : "success";
    const record: SourceRunRecord = {
      source: id,
      status,
      startedAt: outcome.startedAt,
      fetched: outcome.fetched,
      upserted: upserted.get(id) ?? 0,
      closed,
      invalid: outcome.invalid,
      outOfScope: outcome.outOfScope,
      error,
    };
    runs.push(record);
    try {
      await sink.recordRun(record);
    } catch (recordError) {
      healthy = false;
      log.error(`${id}: recording run failed: ${errorMessage(recordError)}`);
    }
  }

  let pruned = 0;
  try {
    pruned = await sink.prune(options.retentionDays);
  } catch (pruneError) {
    healthy = false;
    log.error(`prune failed: ${errorMessage(pruneError)}`);
  }

  return { runs, pruned, healthy };
}

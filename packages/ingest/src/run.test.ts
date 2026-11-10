import type { PGlite } from "@electric-sql/pglite";
import type { JobUpsert } from "@orbit/core";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createMigratedDb } from "./db/test-db";
import type { HttpClient } from "./http";
import type { RawJob } from "./normalize";
import { runIngest, type IngestSink, type SourceRunRecord } from "./run";
import type { WatchedBoard } from "./sources";
import type { Source } from "./sources/types";

/** Sink that calls the real SQL ingest functions in an in-memory Postgres. */
class PgliteSink implements IngestSink {
  constructor(private readonly db: PGlite) {}
  async loadWatchedBoards(): Promise<WatchedBoard[]> {
    return [];
  }
  async upsertJobs(rows: JobUpsert[]): Promise<number> {
    const r = await this.db.query<{ n: number }>("select public.ingest_upsert_jobs($1::jsonb) as n", [JSON.stringify(rows)]);
    return r.rows[0]!.n;
  }
  async closeMissing(source: string, seenBefore: Date): Promise<number> {
    const r = await this.db.query<{ n: number }>("select public.ingest_close_missing($1, $2) as n", [source, seenBefore.toISOString()]);
    return r.rows[0]!.n;
  }
  async recordRun(run: SourceRunRecord): Promise<void> {
    await this.db.query(
      "insert into public.source_runs (source, status, started_at, fetched, upserted, closed, invalid, error) values ($1,$2,$3,$4,$5,$6,$7,$8)",
      [run.source, run.status, run.startedAt.toISOString(), run.fetched, run.upserted, run.closed, run.invalid, run.error],
    );
  }
  async prune(days: number): Promise<number> {
    const r = await this.db.query<{ n: number }>("select public.ingest_prune($1) as n", [days]);
    return r.rows[0]!.n;
  }
}

const unusedHttp: HttpClient = {
  getJson: () => Promise.reject(new Error("no network in tests")),
  postJson: () => Promise.reject(new Error("no network in tests")),
};
const quiet = { info() {}, warn() {}, error() {} };

function job(id: string, title: string, overrides: Partial<RawJob> = {}): RawJob {
  return {
    sourceJobId: id,
    title,
    company: "Acme",
    location: "Berlin, Germany",
    applyUrl: `https://job-boards.greenhouse.io/acme/jobs/${id}`,
    descriptionText: "Build things.",
    postedAt: "2026-11-01T10:00:00Z",
    ...overrides,
  };
}

function source(id: string, priority: number, fetchJobs: () => Promise<RawJob[]>): Source {
  return { id, label: id, priority, fetchJobs };
}

describe("runIngest", () => {
  let db: PGlite;

  beforeAll(async () => {
    db = await createMigratedDb();
  }, 60_000);

  beforeEach(async () => {
    await db.exec("delete from public.jobs; delete from public.source_runs;");
  });

  const run = (sources: Source[]) =>
    runIngest({
      sources,
      sink: new PgliteSink(db),
      http: unusedHttp,
      log: quiet,
      concurrency: 2,
      sourceTimeoutMs: 200,
      retentionDays: 30,
    });

  it("writes jobs, de-duplicates across sources and records each source", async () => {
    const board = source("greenhouse:acme", 10, async () => [job("1", "Backend Engineer"), job("2", "Data Engineer")]);
    const aggregator = source("arbeitnow", 2, async () => [
      job("x", "Backend Engineer (m/w/d)", { applyUrl: "https://arbeitnow.com/jobs/x" }),
      job("y", "Designer", { applyUrl: "https://arbeitnow.com/jobs/y" }),
    ]);
    const summary = await run([board, aggregator]);

    expect(summary.healthy).toBe(true);
    const rows = await db.query<{ title: string; source: string }>("select title, source from public.jobs order by title");
    expect(rows.rows).toEqual([
      { title: "Backend Engineer", source: "greenhouse:acme" },
      { title: "Data Engineer", source: "greenhouse:acme" },
      { title: "Designer", source: "arbeitnow" },
    ]);
    const runs = await db.query<{ source: string; status: string; upserted: number }>(
      "select source, status::text, upserted from public.source_runs order by source",
    );
    expect(runs.rows).toEqual([
      { source: "arbeitnow", status: "success", upserted: 1 },
      { source: "greenhouse:acme", status: "success", upserted: 2 },
    ]);
  });

  it("closes jobs a source stopped listing", async () => {
    await run([source("greenhouse:acme", 10, async () => [job("1", "Backend Engineer"), job("2", "Data Engineer")])]);
    await run([source("greenhouse:acme", 10, async () => [job("1", "Backend Engineer")])]);
    const open = await db.query<{ title: string }>("select title from public.jobs where closed_at is null");
    expect(open.rows).toEqual([{ title: "Backend Engineer" }]);
  });

  it("never closes jobs when a source fails, times out or returns nothing", { timeout: 30_000 }, async () => {
    await run([source("greenhouse:acme", 10, async () => [job("1", "Backend Engineer")])]);

    const summary = await run([
      source("greenhouse:acme", 10, async () => {
        throw new Error("API changed");
      }),
    ]);
    expect(summary.runs[0]).toMatchObject({ status: "failed", error: "API changed" });

    const slow = await run([source("greenhouse:acme", 10, () => new Promise<RawJob[]>(() => {}))]);
    expect(slow.runs[0]).toMatchObject({ status: "failed" });
    expect(slow.runs[0]?.error).toMatch(/timed out/);

    const empty = await run([source("greenhouse:acme", 10, async () => [])]);
    expect(empty.runs[0]).toMatchObject({ status: "empty" });

    const open = await db.query<{ n: number }>("select count(*)::int as n from public.jobs where closed_at is null");
    expect(open.rows[0]?.n).toBe(1);
  });

  it("isolates a broken source from healthy ones and counts invalid postings", async () => {
    const summary = await run([
      source("greenhouse:acme", 10, async () => [job("1", "Backend Engineer"), job("2", "Bad", { applyUrl: "javascript:x" })]),
      source("lever:broken", 10, async () => {
        throw new Error("boom");
      }),
    ]);
    expect(summary.healthy).toBe(true);
    const acme = summary.runs.find((r) => r.source === "greenhouse:acme");
    expect(acme).toMatchObject({ status: "success", fetched: 2, upserted: 1, invalid: 1 });
  });

  it("keeps the rest of a batch when the database rejects one job", async () => {
    // Simulates a database that hasn't run the migration adding the "quant" category.
    class OldSchemaSink extends PgliteSink {
      override async upsertJobs(rows: JobUpsert[]): Promise<number> {
        if (rows.some((r) => r.category === "quant")) throw new Error('invalid input value for enum job_category: "quant"');
        if (rows.some((r) => r.title === "Broken")) throw new Error("value too long");
        return super.upsertJobs(rows);
      }
    }
    const summary = await runIngest({
      sources: [
        source("greenhouse:acme", 10, async () => [
          job("1", "Backend Engineer"),
          job("2", "Quantitative Developer"),
          job("3", "Broken"),
        ]),
      ],
      sink: new OldSchemaSink(db),
      http: unusedHttp,
      log: quiet,
      concurrency: 1,
      sourceTimeoutMs: 200,
      retentionDays: 30,
    });
    expect(summary.healthy).toBe(true);
    const rows = await db.query<{ title: string; category: string }>("select title, category::text from public.jobs order by title");
    expect(rows.rows).toEqual([
      { title: "Backend Engineer", category: "software_engineering" },
      { title: "Quantitative Developer", category: "other" },
    ]);
    expect(summary.runs[0]).toMatchObject({ status: "success", upserted: 2 });
  });

  it("reports unhealthy when every source fails", async () => {
    const summary = await run([
      source("a", 10, async () => {
        throw new Error("x");
      }),
    ]);
    expect(summary.healthy).toBe(false);
  });
});

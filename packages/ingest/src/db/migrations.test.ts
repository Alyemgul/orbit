import type { PGlite } from "@electric-sql/pglite";
import {
  APPLICATION_STATUSES,
  APPLICATION_TRANSITIONS,
  ATS_TYPES,
  EMPLOYMENT_TYPES,
  ENTRY_STATUSES,
  EXPERIENCE_LEVELS,
  JOB_CATEGORIES,
  SALARY_PERIODS,
  VISA_SPONSORSHIP,
  WORKPLACE_TYPES,
} from "@orbit/core";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { asUser, createMigratedDb } from "./test-db";

const ALICE = "11111111-1111-1111-1111-111111111111";
const BOB = "22222222-2222-2222-2222-222222222222";

function jobPayload(overrides: Record<string, unknown> = {}) {
  return {
    dedupe_hash: "hash-1",
    source: "greenhouse:n26",
    source_priority: 10,
    source_job_id: "1",
    source_url: "https://n26.com/careers/1",
    ats_type: "greenhouse",
    company: "N26",
    company_logo_url: null,
    title: "Backend Engineer",
    location: "Berlin, Germany",
    country_codes: ["DE"],
    workplace: "hybrid",
    employment_type: "full_time",
    experience_level: "mid",
    category: "software_engineering",
    salary_min: null,
    salary_max: null,
    salary_currency: null,
    salary_period: null,
    visa_sponsorship: "unknown",
    description: "Build things.",
    apply_url: "https://job-boards.greenhouse.io/n26/jobs/1",
    posted_at: "2026-11-01T10:00:00Z",
    ...overrides,
  };
}

async function upsert(db: PGlite, jobs: unknown[]): Promise<number> {
  const result = await db.query<{ n: number }>("select public.ingest_upsert_jobs($1::jsonb) as n", [
    JSON.stringify(jobs),
  ]);
  return result.rows[0]!.n;
}

async function enumValues(db: PGlite, type: string): Promise<string[]> {
  const result = await db.query<{ v: string }>(
    `select unnest(enum_range(null::public.${type}))::text as v`,
  );
  return result.rows.map((row) => row.v);
}

describe("database migrations", () => {
  let db: PGlite;

  beforeAll(async () => {
    db = await createMigratedDb();
    await db.query("insert into auth.users (id, email) values ($1, 'alice@example.com'), ($2, 'bob@example.com')", [
      ALICE,
      BOB,
    ]);
  }, 60_000);

  beforeEach(async () => {
    await db.exec("delete from public.applications; delete from public.swipes; delete from public.jobs;");
  });

  describe("schema stays in sync with packages/core", () => {
    it.each([
      ["application_status", APPLICATION_STATUSES],
      ["ats_type", ATS_TYPES],
      ["workplace_type", WORKPLACE_TYPES],
      ["employment_type", EMPLOYMENT_TYPES],
      ["experience_level", EXPERIENCE_LEVELS],
      ["job_category", JOB_CATEGORIES],
      ["visa_sponsorship", VISA_SPONSORSHIP],
      ["salary_period", SALARY_PERIODS],
    ] as const)("enum %s", async (type, values) => {
      expect(await enumValues(db, type)).toEqual([...values]);
    });

    it("transition table matches the state machine", async () => {
      const result = await db.query<{ f: string; t: string }>(
        "select from_status::text as f, to_status::text as t from public.application_transitions",
      );
      const inDb = result.rows.map((row) => `${row.f}->${row.t}`).sort();
      const inCore = Object.entries(APPLICATION_TRANSITIONS)
        .flatMap(([from, tos]) => tos.map((to) => `${from}->${to}`))
        .sort();
      expect(inDb).toEqual(inCore);
    });
  });

  it("creates a profile when a user signs up", async () => {
    const result = await db.query<{ email: string }>("select email from public.profiles where user_id = $1", [ALICE]);
    expect(result.rows[0]?.email).toBe("alice@example.com");
  });

  describe("job ingestion", () => {
    it("inserts, then updates in place on a repeat sighting", async () => {
      expect(await upsert(db, [jobPayload()])).toBe(1);
      expect(await upsert(db, [jobPayload({ title: "Backend Engineer", description: "Updated." })])).toBe(1);
      const rows = await db.query<{ description: string; country_codes: string[] }>(
        "select description, country_codes from public.jobs",
      );
      expect(rows.rows).toEqual([{ description: "Updated.", country_codes: ["DE"] }]);
    });

    it("lets the company board win over an aggregator copy", async () => {
      await upsert(db, [jobPayload()]);
      const aggregator = jobPayload({ source: "arbeitnow", source_priority: 2, apply_url: "https://arbeitnow.com/x" });
      expect(await upsert(db, [aggregator])).toBe(0);
      const rows = await db.query<{ source: string }>("select source from public.jobs");
      expect(rows.rows[0]?.source).toBe("greenhouse:n26");
    });

    it("closes jobs a source stopped listing, and reopens them if they return", async () => {
      await upsert(db, [jobPayload(), jobPayload({ dedupe_hash: "hash-2", source_job_id: "2" })]);
      await db.exec("update public.jobs set last_seen_at = now() - interval '1 hour'");
      await upsert(db, [jobPayload()]);

      const closed = await db.query<{ n: number }>(
        "select public.ingest_close_missing('greenhouse:n26', now() - interval '1 minute') as n",
      );
      expect(closed.rows[0]?.n).toBe(1);

      await upsert(db, [jobPayload({ dedupe_hash: "hash-2", source_job_id: "2" })]);
      const open = await db.query<{ n: number }>("select count(*)::int as n from public.jobs where closed_at is null");
      expect(open.rows[0]?.n).toBe(2);
    });

    it("prunes old closed jobs but keeps ones with applications", async () => {
      await upsert(db, [jobPayload(), jobPayload({ dedupe_hash: "hash-2", source_job_id: "2" })]);
      const jobs = await db.query<{ id: string; dedupe_hash: string }>("select id, dedupe_hash from public.jobs");
      const kept = jobs.rows.find((job) => job.dedupe_hash === "hash-1")!;
      await db.query("insert into public.applications (user_id, job_id, status) values ($1, $2, 'applied')", [
        ALICE,
        kept.id,
      ]);
      await db.exec("update public.jobs set closed_at = now() - interval '60 days'");

      const pruned = await db.query<{ n: number }>("select public.ingest_prune(30) as n");
      expect(pruned.rows[0]?.n).toBe(1);
      const left = await db.query<{ dedupe_hash: string }>("select dedupe_hash from public.jobs");
      expect(left.rows).toEqual([{ dedupe_hash: "hash-1" }]);
    });

    it("rejects non-http apply links", async () => {
      await expect(upsert(db, [jobPayload({ apply_url: "javascript:alert(1)" })])).rejects.toThrow();
    });

    it("is not callable by signed-in users", async () => {
      await expect(asUser(db, ALICE, () => upsert(db, [jobPayload()]))).rejects.toThrow(/permission denied/);
    });
  });

  describe("applications", () => {
    async function seedJob(): Promise<string> {
      await upsert(db, [jobPayload()]);
      const result = await db.query<{ id: string }>("select id from public.jobs limit 1");
      return result.rows[0]!.id;
    }

    it("only allows the defined entry states", async () => {
      const jobId = await seedJob();
      for (const status of ENTRY_STATUSES) {
        await db.query("insert into public.applications (user_id, job_id, status) values ($1, $2, $3)", [
          ALICE,
          jobId,
          status,
        ]);
        await db.exec("delete from public.applications");
      }
      await expect(
        db.query("insert into public.applications (user_id, job_id, status) values ($1, $2, 'offer')", [ALICE, jobId]),
      ).rejects.toThrow(/must start as/);
    });

    it("enforces transitions and logs each one with its actor", async () => {
      const jobId = await seedJob();
      const inserted = await db.query<{ id: string }>(
        "insert into public.applications (user_id, job_id, status) values ($1, $2, 'queued') returning id",
        [ALICE, jobId],
      );
      const id = inserted.rows[0]!.id;

      await db.query("update public.applications set status = 'tailoring', updated_by = 'system' where id = $1", [id]);
      await expect(db.query("update public.applications set status = 'offer' where id = $1", [id])).rejects.toThrow(
        /invalid application transition/,
      );

      const events = await db.query<{ type: string; to_status: string; actor: string }>(
        "select type, to_status::text, actor::text from public.application_events where application_id = $1 order by id",
        [id],
      );
      expect(events.rows).toEqual([
        { type: "created", to_status: "queued", actor: "user" },
        { type: "status_changed", to_status: "tailoring", actor: "system" },
      ]);
    });

    it("stamps applied_at when an application is applied", async () => {
      const jobId = await seedJob();
      const result = await db.query<{ applied_at: string | null }>(
        "insert into public.applications (user_id, job_id, status) values ($1, $2, 'applied') returning applied_at",
        [ALICE, jobId],
      );
      expect(result.rows[0]?.applied_at).not.toBeNull();
    });

    it("keeps each user's applications private", async () => {
      const jobId = await seedJob();
      await asUser(db, ALICE, () =>
        db.query("insert into public.applications (job_id, status) values ($1, 'saved')", [jobId]),
      );

      const bobSees = await asUser(db, BOB, () => db.query("select id from public.applications"));
      expect(bobSees.rows).toHaveLength(0);
      const aliceSees = await asUser(db, ALICE, () => db.query("select id from public.applications"));
      expect(aliceSees.rows).toHaveLength(1);

      await expect(
        asUser(db, BOB, () =>
          db.query("insert into public.applications (user_id, job_id, status) values ($1, $2, 'saved')", [
            ALICE,
            jobId,
          ]),
        ),
      ).rejects.toThrow(/row-level security/);
    });

    it("lets users read jobs but not write them", async () => {
      await seedJob();
      const rows = await asUser(db, ALICE, () => db.query("select id from public.jobs"));
      expect(rows.rows).toHaveLength(1);
      const updated = await asUser(db, ALICE, () => db.query("update public.jobs set title = 'x' returning id"));
      expect(updated.rows).toHaveLength(0);
    });
  });
});

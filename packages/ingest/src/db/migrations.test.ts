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
    await db.exec(
      "delete from public.resume_variants; delete from public.resumes; delete from public.llm_calls; delete from public.applications; delete from public.swipes; delete from public.jobs;",
    );
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

  describe("discover feed and swipes", () => {
    async function seedFeed(): Promise<Record<string, string>> {
      await upsert(db, [
        jobPayload({ dedupe_hash: "berlin", source_job_id: "1", title: "Graduate Software Engineer", experience_level: "entry", posted_at: "2026-11-05T10:00:00Z" }),
        jobPayload({ dedupe_hash: "tokyo", source_job_id: "2", title: "Backend Engineer", location: "Tokyo, Japan", country_codes: ["JP"], posted_at: "2026-11-04T10:00:00Z" }),
        jobPayload({ dedupe_hash: "remote-eu", source_job_id: "3", title: "Data Intern", location: "Remote, Europe", country_codes: [], experience_level: "intern", category: "data", posted_at: "2026-11-03T10:00:00Z" }),
        jobPayload({ dedupe_hash: "nyc", source_job_id: "4", title: "Quant Developer", location: "New York, NY", country_codes: ["US"], category: "quant", visa_sponsorship: "yes", posted_at: "2026-11-02T10:00:00Z" }),
      ]);
      const result = await db.query<{ id: string; dedupe_hash: string }>("select id, dedupe_hash from public.jobs");
      return Object.fromEntries(result.rows.map((row) => [row.dedupe_hash, row.id]));
    }

    async function feed(userId: string, args = "", params: unknown[] = []): Promise<string[]> {
      const result = await asUser(db, userId, () =>
        db.query<{ title: string }>(`select title from public.discover_feed(${args})`, params),
      );
      return result.rows.map((row) => row.title);
    }

    it("lists open jobs newest first, filtered by region, level, category and visa", async () => {
      await seedFeed();
      expect(await feed(ALICE)).toEqual(["Graduate Software Engineer", "Backend Engineer", "Data Intern", "Quant Developer"]);
      expect(await feed(ALICE, "p_countries => $1, p_region_word => 'europe'", [["DE", "FR"]])).toEqual([
        "Graduate Software Engineer",
        "Data Intern",
      ]);
      expect(await feed(ALICE, "p_levels => array['entry','intern']::public.experience_level[]")).toEqual([
        "Graduate Software Engineer",
        "Data Intern",
      ]);
      expect(await feed(ALICE, "p_categories => array['quant']::public.job_category[]")).toEqual(["Quant Developer"]);
      expect(await feed(ALICE, "p_visa_only => true")).toEqual(["Quant Developer"]);
      expect(await feed(ALICE, "p_query => 'graduate'")).toEqual(["Graduate Software Engineer"]);
    });

    it("pages with a cursor and caps the page size", async () => {
      await seedFeed();
      const first = await asUser(db, ALICE, () =>
        db.query<{ id: string; posted_at: Date }>("select id, posted_at from public.discover_feed(p_limit => 2)"),
      );
      const last = first.rows[1]!;
      expect(
        await feed(ALICE, "p_cursor_ts => $1, p_cursor_id => $2, p_limit => 10", [last.posted_at, last.id]),
      ).toEqual(["Data Intern", "Quant Developer"]);
      expect(await feed(ALICE, "p_limit => 100000")).toHaveLength(4);
    });

    it("records swipes, creates applications and hides swiped jobs only for that user", async () => {
      const ids = await seedFeed();
      await asUser(db, ALICE, async () => {
        await db.query("select public.record_swipe($1, 'apply')", [ids.berlin]);
        await db.query("select public.record_swipe($1, 'save')", [ids.tokyo]);
        await db.query("select public.record_swipe($1, 'skip')", [ids.nyc]);
      });
      expect(await feed(ALICE)).toEqual(["Data Intern"]);
      expect(await feed(BOB)).toHaveLength(4);

      const board = await asUser(db, ALICE, () =>
        db.query<{ title: string; status: string }>("select title, status::text from public.my_pipeline() order by title"),
      );
      expect(board.rows).toEqual([
        { title: "Backend Engineer", status: "saved" },
        { title: "Graduate Software Engineer", status: "queued" },
      ]);
      const bobBoard = await asUser(db, BOB, () => db.query("select * from public.my_pipeline()"));
      expect(bobBoard.rows).toHaveLength(0);
    });

    it("undoes a fresh swipe, but never removes an application that already moved on", async () => {
      const ids = await seedFeed();
      await asUser(db, ALICE, async () => {
        await db.query("select public.record_swipe($1, 'apply')", [ids.berlin]);
        await db.query("select public.undo_swipe($1)", [ids.berlin]);
      });
      expect(await feed(ALICE)).toHaveLength(4);
      expect((await db.query("select id from public.applications")).rows).toHaveLength(0);

      await asUser(db, ALICE, () => db.query("select public.record_swipe($1, 'apply')", [ids.berlin]));
      await db.query("update public.applications set status = 'tailoring'");
      await asUser(db, ALICE, () => db.query("select public.undo_swipe($1)", [ids.berlin]));
      expect((await db.query("select status::text from public.applications")).rows).toEqual([{ status: "tailoring" }]);
    });

    it("counts activity per day", async () => {
      const ids = await seedFeed();
      await asUser(db, ALICE, async () => {
        await db.query("select public.record_swipe($1, 'skip')", [ids.tokyo]);
        await db.query("select public.record_swipe($1, 'save')", [ids.berlin]);
      });
      await db.query("update public.applications set status = 'applied'");
      const rows = await asUser(db, ALICE, () =>
        db.query<{ swipes: number; applied: number }>("select swipes, applied from public.my_activity(30, 'Europe/Budapest')"),
      );
      expect(rows.rows).toEqual([{ swipes: 2, applied: 1 }]);
      // Unknown time zones fall back to UTC instead of erroring.
      await expect(asUser(db, ALICE, () => db.query("select * from public.my_activity(30, 'Mars/Base')"))).resolves.toBeTruthy();
    });

    it("requires sign-in for swipes", async () => {
      const ids = await seedFeed();
      await expect(db.query("select public.record_swipe($1, 'apply')", [ids.berlin])).rejects.toThrow(/sign in required/);
    });
  });

  describe("resume engine", () => {
    async function queuedApplication(userId: string): Promise<string> {
      await upsert(db, [jobPayload()]);
      const job = (await db.query<{ id: string }>("select id from public.jobs")).rows[0]!.id;
      return asUser(db, userId, async () => {
        await db.query("select public.record_swipe($1, 'apply')", [job]);
        return (await db.query<{ id: string }>("select id from public.applications")).rows[0]!.id;
      });
    }

    function saveVariant(application: string) {
      return db.query<{ id: string }>(
        "select public.save_resume_variant($1, '{\"version\":1}'::jsonb, '{}'::jsonb, '[]'::jsonb, 72.5, array['Kafka'], 'rules') as id",
        [application],
      );
    }

    it("keeps one master resume per user and updates it in place", async () => {
      const first = await asUser(db, ALICE, () => db.query<{ id: string }>("select * from public.save_master_resume('{\"summary\":\"a\"}')"));
      const second = await asUser(db, ALICE, () => db.query<{ id: string }>("select * from public.save_master_resume('{\"summary\":\"b\"}')"));
      expect(second.rows[0]!.id).toBe(first.rows[0]!.id);
      const rows = await db.query<{ content: { summary: string } }>("select content from public.resumes");
      expect(rows.rows).toEqual([{ content: { summary: "b" } }]);
      await expect(asUser(db, ALICE, () => db.query("select * from public.save_master_resume('[1]')"))).rejects.toThrow(/must be an object/);
      await expect(db.query("select * from public.save_master_resume('{}')")).rejects.toThrow(/sign in required/);
    });

    it("saves a tailored version and moves a queued application to ready", async () => {
      const application = await queuedApplication(ALICE);
      await asUser(db, ALICE, () => db.query("select * from public.save_master_resume('{}')"));
      const saved = await asUser(db, ALICE, () => saveVariant(application));
      const row = await db.query<{ status: string; resume_variant_id: string }>("select status::text, resume_variant_id from public.applications");
      expect(row.rows[0]).toEqual({ status: "ready", resume_variant_id: saved.rows[0]!.id });
      const variant = await db.query<{ base_resume_id: string | null; match_score: string }>("select base_resume_id, match_score from public.resume_variants");
      expect(variant.rows[0]!.base_resume_id).not.toBeNull();
      const events = await db.query<{ to_status: string }>(
        "select to_status::text from public.application_events where to_status is not null order by id",
      );
      expect(events.rows.map((e) => e.to_status)).toEqual(["queued", "tailoring", "ready"]);
    });

    it("refuses versions for someone else's application", async () => {
      const application = await queuedApplication(ALICE);
      await expect(asUser(db, BOB, () => saveVariant(application))).rejects.toThrow(/application not found/);
      await expect(
        asUser(db, BOB, () =>
          db.query("insert into public.resume_variants (application_id, content) values ($1, '{}')", [application]),
        ),
      ).rejects.toThrow(/application not found/);
    });

    it("caps AI calls per user per day and blocks direct writes", async () => {
      const claims = await asUser(db, ALICE, async () => {
        const results: boolean[] = [];
        for (let i = 0; i < 31; i++) {
          results.push((await db.query<{ ok: boolean }>("select public.claim_llm_call('tailor') as ok")).rows[0]!.ok);
        }
        return results;
      });
      expect(claims.filter(Boolean)).toHaveLength(30);
      expect(claims[30]).toBe(false);
      expect((await asUser(db, BOB, () => db.query<{ ok: boolean }>("select public.claim_llm_call('tailor') as ok"))).rows[0]!.ok).toBe(true);

      const usage = await asUser(db, ALICE, () => db.query<{ used: number }>("select used from public.my_llm_usage()"));
      expect(usage.rows[0]!.used).toBe(30);
      await expect(
        asUser(db, ALICE, () => db.query("insert into public.llm_calls (user_id, kind) values ($1, 'tailor')", [ALICE])),
      ).rejects.toThrow();
      await expect(asUser(db, ALICE, () => db.query("delete from public.llm_calls"))).resolves.toBeTruthy();
      expect((await db.query("select id from public.llm_calls")).rows).toHaveLength(31);
    });
  });
});

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";
import { MIGRATIONS_DIR, SUPABASE_STUBS, migrationFiles, readMigration } from "./test-db";

const upgradeSql = readFileSync(join(MIGRATIONS_DIR, "..", "upgrade.sql"), "utf8");
const setupSql = readFileSync(join(MIGRATIONS_DIR, "..", "setup.sql"), "utf8");

async function functions(db: PGlite): Promise<string[]> {
  const result = await db.query<{ proname: string }>(
    "select proname from pg_proc where pronamespace = 'public'::regnamespace order by proname",
  );
  return result.rows.map((r) => r.proname);
}

describe("upgrade.sql", () => {
  it("brings a project that stopped after any migration up to date, and can run again", async () => {
    const reference = new PGlite();
    await reference.exec(SUPABASE_STUBS);
    await reference.exec(setupSql);
    const expected = await functions(reference);

    // A project that only ran the first migrations, then a partly applied later one.
    for (const stopAfter of [2, 4, 5]) {
      const db = new PGlite();
      await db.exec(SUPABASE_STUBS);
      for (const file of migrationFiles().slice(0, stopAfter)) await db.exec(readMigration(file));
      await db.exec(upgradeSql);
      await db.exec(upgradeSql);
      expect(await functions(db)).toEqual(expected);
      const claim = await db.query<{ t: string }>(
        "select pg_get_function_result('public.claim_llm_call(text)'::regprocedure) as t",
      );
      expect(claim.rows[0]!.t).toBe("bigint");
    }
  }, 120_000);
});

/**
 * Usage:
 *   npm run ingest                       # write to Supabase (needs env vars)
 *   npm run ingest -- --dry-run          # no database; writes ingest-output.json
 *   npm run ingest -- --dry-run --only greenhouse:n26,amazon
 *   npm run ingest -- --skip-aggregators
 *
 * Env (packages/ingest/.env locally, GitHub secrets in CI):
 *   SUPABASE_URL, SUPABASE_SECRET_KEY, optional ADZUNA_APP_ID / ADZUNA_APP_KEY
 */

import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { DEFAULT_CONFIG } from "./config";
import { createHttpClient } from "./http";
import { runIngest, type IngestSink } from "./run";
import { MemorySink, SupabaseSink } from "./sinks";
import { buildSources, type Logger } from "./sources";

const PACKAGE_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");

const log: Logger = {
  info: (message) => console.log(`[info] ${message}`),
  warn: (message) => console.warn(`[warn] ${message}`),
  error: (message) => console.error(`[error] ${message}`),
};

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing ${name}. Set it in packages/ingest/.env or as a GitHub secret.`);
  return value;
}

async function main(): Promise<number> {
  const { values } = parseArgs({
    options: {
      "dry-run": { type: "boolean", default: false },
      "skip-aggregators": { type: "boolean", default: false },
      only: { type: "string" },
      out: { type: "string", default: "ingest-output.json" },
    },
    strict: true,
  });

  const envFile = join(PACKAGE_DIR, ".env");
  if (existsSync(envFile)) process.loadEnvFile(envFile);

  const dryRun = values["dry-run"] ?? false;
  const memory = new MemorySink();
  const sink: IngestSink = dryRun ? memory : new SupabaseSink(requireEnv("SUPABASE_URL"), requireEnv("SUPABASE_SECRET_KEY"));

  const adzunaId = process.env.ADZUNA_APP_ID?.trim();
  const adzunaKey = process.env.ADZUNA_APP_KEY?.trim();
  const watched = await sink.loadWatchedBoards();

  let sources = buildSources(DEFAULT_CONFIG, {
    watched,
    adzunaCredentials: adzunaId && adzunaKey ? { appId: adzunaId, appKey: adzunaKey } : null,
    includeAggregators: !values["skip-aggregators"],
  });
  if (values.only) {
    const only = new Set(values.only.split(",").map((s) => s.trim()));
    sources = sources.filter((source) => only.has(source.id));
  }
  if (sources.length === 0) {
    log.error("No sources selected.");
    return 1;
  }

  log.info(`Ingesting ${sources.length} source(s)${dryRun ? " (dry run)" : ""}, ${watched.length} from watchlists`);
  const started = Date.now();
  const summary = await runIngest({
    sources,
    sink,
    http: createHttpClient({ userAgent: "OrbitJobs/0.1 (personal job search; +https://github.com/Alyemgul/orbit)" }),
    log,
    concurrency: DEFAULT_CONFIG.concurrency,
    sourceTimeoutMs: DEFAULT_CONFIG.sourceTimeoutMs,
    retentionDays: DEFAULT_CONFIG.retentionDays,
  });

  console.table(
    summary.runs.map((run) => ({
      source: run.source,
      status: run.status,
      fetched: run.fetched,
      upserted: run.upserted,
      closed: run.closed,
      invalid: run.invalid,
      error: run.error?.slice(0, 60) ?? "",
    })),
  );
  const totals = summary.runs.reduce((acc, run) => ({ fetched: acc.fetched + run.fetched, upserted: acc.upserted + run.upserted }), {
    fetched: 0,
    upserted: 0,
  });
  const failed = summary.runs.filter((run) => run.status === "failed").length;
  log.info(
    `Done in ${((Date.now() - started) / 1000).toFixed(1)}s: ${totals.fetched} fetched, ${totals.upserted} written, ${failed} failed source(s), ${summary.pruned} pruned`,
  );

  if (dryRun) {
    const outPath = resolve(process.cwd(), values.out ?? "ingest-output.json");
    await writeFile(outPath, JSON.stringify([...memory.jobs.values()], null, 2));
    log.info(`Wrote ${memory.jobs.size} jobs to ${outPath}`);
  }

  // Partial source failures are expected (APIs change); only fail the job when nothing worked.
  return summary.healthy ? 0 : 1;
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    log.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  },
);

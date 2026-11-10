// Regenerates supabase/setup.sql (a new project) and supabase/upgrade.sql
// (an existing project, any state) from supabase/migrations.
// Run: node supabase/build-sql.mjs
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const files = readdirSync(join(here, "migrations")).filter((f) => f.endsWith(".sql")).sort();
const read = (file) => readFileSync(join(here, "migrations", file), "utf8").trimEnd();
// Adding enum values can't share a transaction with later statements, so that file runs on its own.
const needsOwnTransaction = (sql) => !/alter type .* add value/i.test(sql);

function section(file) {
  const sql = read(file);
  return needsOwnTransaction(sql)
    ? `-- ===== migrations/${file} =====\nbegin;\n\n${sql}\n\ncommit;\n`
    : `-- ===== migrations/${file} =====\n${sql}\n`;
}

writeFileSync(
  join(here, "setup.sql"),
  [
    "-- Orbit database setup for a NEW, empty Supabase project: paste into SQL Editor and Run.",
    "-- Existing projects: run upgrade.sql instead.",
    "-- Generated from supabase/migrations by supabase/build-sql.mjs.",
    "",
    ...files.map(section),
  ].join("\n"),
);

// Everything after the first two migrations is written to be safe to run again,
// so one paste brings any existing project up to date.
const upgradeFiles = files.slice(2);
writeFileSync(
  join(here, "upgrade.sql"),
  [
    "-- Orbit database upgrade for an EXISTING project: paste into SQL Editor and Run.",
    "-- Safe to run more than once, whichever migrations you already ran.",
    `-- Includes: ${upgradeFiles.map((f) => f.replace(/^\d+_|\.sql$/g, "")).join(", ")}.`,
    "-- Generated from supabase/migrations by supabase/build-sql.mjs.",
    "",
    ...upgradeFiles.map(section),
  ].join("\n"),
);

console.log(`setup.sql: ${files.length} migrations; upgrade.sql: ${upgradeFiles.length}`);

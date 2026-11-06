import type { EmploymentType, SalaryPeriod } from "@orbit/core";
import type { HttpClient } from "../http";
import type { RawJob } from "../normalize";

export interface Logger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

export interface SourceContext {
  http: HttpClient;
  /** Aborted when the source exceeds its time budget. */
  signal: AbortSignal;
  log: Logger;
}

export interface Source {
  /** Stable id stored on each job, e.g. "greenhouse:n26" or "remotive". */
  id: string;
  label: string;
  /** Company boards 10, aggregators 1-3: the higher one wins on duplicates. */
  priority: number;
  fetchJobs(ctx: SourceContext): Promise<RawJob[]>;
}

export const PRIORITY = { companyBoard: 10, adzuna: 3, aggregator: 2 } as const;

/** Map a source's free-text employment label ("Full-time", "fulltime_permanent", "FullTime"). */
export function employmentFromLabel(label: string | null | undefined): EmploymentType | null {
  if (!label) return null;
  const value = label.toLowerCase().replace(/[\s_-]/g, "");
  if (value.includes("intern")) return "internship";
  if (value.includes("parttime") || value.includes("werkstudent")) return "part_time";
  if (value.includes("contract") || value.includes("freelance")) return "contract";
  if (value.includes("temporary") || value.includes("fixedterm")) return "temporary";
  if (value.includes("fulltime") || value.includes("permanent") || value.includes("regular")) return "full_time";
  return null;
}

/** Map "1 YEAR", "per-year-salary", "year", "hourly" and similar to a salary period. */
export function periodFromLabel(label: string | null | undefined): SalaryPeriod | null {
  if (!label) return null;
  const value = label.toLowerCase();
  if (value.includes("year") || value.includes("annual")) return "year";
  if (value.includes("month")) return "month";
  if (value.includes("week")) return "week";
  if (value.includes("day") || value.includes("daily")) return "day";
  if (value.includes("hour")) return "hour";
  return null;
}

export function toNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value.replace(/[, ]/g, ""));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

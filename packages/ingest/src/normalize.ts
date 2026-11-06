import { createHash } from "node:crypto";
import {
  MAX_DESCRIPTION_LENGTH,
  canonicalJobKey,
  detectAtsFromUrl,
  detectVisaSponsorship,
  htmlToText,
  inferCategory,
  inferCountryCodes,
  inferEmploymentType,
  inferExperienceLevel,
  inferWorkplace,
  normalizedJobSchema,
  truncateText,
  type EmploymentType,
  type ExperienceLevel,
  type JobUpsert,
  type NormalizedJob,
  type SalaryPeriod,
  type WorkplaceType,
} from "@orbit/core";

/**
 * What a connector extracts from one posting. Only identity, title, company
 * and apply link are required; anything the source states explicitly
 * overrides the rule-based guesses in normalizeJob.
 */
export interface RawJob {
  sourceJobId: string;
  title: string;
  company: string;
  applyUrl: string;
  location?: string | null;
  descriptionHtml?: string | null;
  descriptionText?: string | null;
  sourceUrl?: string | null;
  companyLogoUrl?: string | null;
  postedAt?: string | number | Date | null;
  countryCodes?: readonly string[] | null;
  workplace?: WorkplaceType | null;
  employmentType?: EmploymentType | null;
  experienceLevel?: ExperienceLevel | null;
  salary?: {
    min?: number | null;
    max?: number | null;
    currency?: string | null;
    period?: SalaryPeriod | null;
  } | null;
}

export interface SourceIdentity {
  id: string;
  priority: number;
}

export type NormalizeResult = { ok: true; job: NormalizedJob } | { ok: false; reason: string };

const EARLIEST = Date.UTC(2000, 0, 1);

/** Accepts ISO strings, "YYYY-MM-DD HH:MM:SS UTC", epoch seconds or milliseconds. */
export function toIsoDate(value: RawJob["postedAt"], now = Date.now()): string | null {
  if (value === null || value === undefined || value === "") return null;
  let ms: number;
  if (value instanceof Date) ms = value.getTime();
  else if (typeof value === "number") ms = value < 1e12 ? value * 1000 : value;
  else ms = Date.parse(value.replace(/^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}) UTC$/, "$1T$2Z").replace(/\s+/g, " "));
  // Reject garbage and far-future dates (a two-day margin covers time zones).
  if (!Number.isFinite(ms) || ms < EARLIEST || ms > now + 2 * 86_400_000) return null;
  return new Date(ms).toISOString();
}

function cleanUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function cleanSalary(salary: RawJob["salary"]) {
  const empty = { salaryMin: null, salaryMax: null, salaryCurrency: null, salaryPeriod: null };
  if (!salary) return empty;
  const valid = (n: number | null | undefined) => (typeof n === "number" && Number.isFinite(n) && n > 0 ? n : null);
  let min = valid(salary.min);
  let max = valid(salary.max);
  if (min === null && max === null) return empty;
  if (min !== null && max !== null && min > max) [min, max] = [max, min];
  const currency = salary.currency?.trim().toUpperCase() ?? "";
  return {
    salaryMin: min,
    salaryMax: max,
    salaryCurrency: /^[A-Z]{3}$/.test(currency) ? currency : null,
    salaryPeriod: salary.period ?? null,
  };
}

export function normalizeJob(raw: RawJob, source: SourceIdentity): NormalizeResult {
  const applyUrl = cleanUrl(raw.applyUrl);
  if (!applyUrl) return { ok: false, reason: "missing or non-http apply URL" };

  const title = raw.title.replace(/\s+/g, " ").trim();
  const location = (raw.location ?? "").replace(/\s+/g, " ").trim().slice(0, 300);
  const text = raw.descriptionText?.trim() || (raw.descriptionHtml ? htmlToText(raw.descriptionHtml) : "");
  const description = truncateText(text, MAX_DESCRIPTION_LENGTH);
  const countries = raw.countryCodes?.length ? raw.countryCodes : inferCountryCodes(location);

  const candidate = {
    source: source.id,
    sourcePriority: source.priority,
    sourceJobId: String(raw.sourceJobId).slice(0, 200),
    sourceUrl: cleanUrl(raw.sourceUrl),
    atsType: detectAtsFromUrl(applyUrl),
    company: raw.company.replace(/\s+/g, " ").trim().slice(0, 200),
    companyLogoUrl: cleanUrl(raw.companyLogoUrl),
    title: title.slice(0, 300),
    location,
    countryCodes: [...new Set(countries.map((code) => code.toUpperCase()).filter((code) => /^[A-Z]{2}$/.test(code)))],
    workplace: raw.workplace && raw.workplace !== "unknown" ? raw.workplace : inferWorkplace(location, title),
    employmentType:
      raw.employmentType && raw.employmentType !== "unknown" ? raw.employmentType : inferEmploymentType(title),
    experienceLevel:
      raw.experienceLevel && raw.experienceLevel !== "unknown" ? raw.experienceLevel : inferExperienceLevel(title),
    category: inferCategory(title),
    ...cleanSalary(raw.salary),
    visaSponsorship: detectVisaSponsorship(description),
    description,
    applyUrl,
    postedAt: toIsoDate(raw.postedAt),
  };

  const parsed = normalizedJobSchema.safeParse(candidate);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { ok: false, reason: issue ? `${issue.path.join(".")}: ${issue.message}` : "invalid job" };
  }
  return { ok: true, job: parsed.data };
}

export function dedupeHash(job: Pick<NormalizedJob, "company" | "title" | "location">): string {
  return createHash("sha256").update(canonicalJobKey(job.company, job.title, job.location)).digest("hex");
}

export function toUpsertRow(job: NormalizedJob): JobUpsert {
  return {
    dedupe_hash: dedupeHash(job),
    source: job.source,
    source_priority: job.sourcePriority,
    source_job_id: job.sourceJobId,
    source_url: job.sourceUrl,
    ats_type: job.atsType,
    company: job.company,
    company_logo_url: job.companyLogoUrl,
    title: job.title,
    location: job.location,
    country_codes: job.countryCodes,
    workplace: job.workplace,
    employment_type: job.employmentType,
    experience_level: job.experienceLevel,
    category: job.category,
    salary_min: job.salaryMin,
    salary_max: job.salaryMax,
    salary_currency: job.salaryCurrency,
    salary_period: job.salaryPeriod,
    visa_sponsorship: job.visaSponsorship,
    description: job.description,
    apply_url: job.applyUrl,
    posted_at: job.postedAt,
  };
}

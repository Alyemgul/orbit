import { z } from "zod";

/**
 * The normalized job shape every source connector produces. Enum values
 * mirror the Postgres enums in supabase/migrations (kept in sync by tests).
 */

export const ATS_TYPES = [
  "greenhouse",
  "lever",
  "ashby",
  "smartrecruiters",
  "recruitee",
  "workday",
  "workable",
  "personio",
  "teamtailor",
  "other",
] as const;
export type AtsType = (typeof ATS_TYPES)[number];

export const WORKPLACE_TYPES = ["remote", "hybrid", "onsite", "unknown"] as const;
export type WorkplaceType = (typeof WORKPLACE_TYPES)[number];

export const EMPLOYMENT_TYPES = ["full_time", "part_time", "contract", "internship", "temporary", "unknown"] as const;
export type EmploymentType = (typeof EMPLOYMENT_TYPES)[number];

export const EXPERIENCE_LEVELS = ["intern", "entry", "mid", "senior", "lead", "unknown"] as const;
export type ExperienceLevel = (typeof EXPERIENCE_LEVELS)[number];

export const JOB_CATEGORIES = [
  "software_engineering",
  "data",
  "ml_ai",
  "devops_sre",
  "security",
  "qa",
  "product",
  "design",
  "it_support",
  "other",
] as const;
export type JobCategory = (typeof JOB_CATEGORIES)[number];

export const VISA_SPONSORSHIP = ["yes", "no", "unknown"] as const;
export type VisaSponsorship = (typeof VISA_SPONSORSHIP)[number];

export const SALARY_PERIODS = ["year", "month", "week", "day", "hour"] as const;
export type SalaryPeriod = (typeof SALARY_PERIODS)[number];

/** Descriptions are stored as plain text; this caps row size in the free-tier database. */
export const MAX_DESCRIPTION_LENGTH = 20_000;

const httpUrl = z.url({ protocol: /^https?$/ }).max(2048);

export const normalizedJobSchema = z
  .object({
    source: z.string().min(1).max(120),
    sourcePriority: z.number().int().min(0).max(100),
    sourceJobId: z.string().min(1).max(200),
    sourceUrl: httpUrl.nullable(),
    atsType: z.enum(ATS_TYPES),
    company: z.string().trim().min(1).max(200),
    companyLogoUrl: httpUrl.nullable(),
    title: z.string().trim().min(1).max(300),
    location: z.string().max(300),
    countryCodes: z.array(z.string().regex(/^[A-Z]{2}$/)).max(50),
    workplace: z.enum(WORKPLACE_TYPES),
    employmentType: z.enum(EMPLOYMENT_TYPES),
    experienceLevel: z.enum(EXPERIENCE_LEVELS),
    category: z.enum(JOB_CATEGORIES),
    salaryMin: z.number().nonnegative().nullable(),
    salaryMax: z.number().nonnegative().nullable(),
    salaryCurrency: z.string().regex(/^[A-Z]{3}$/).nullable(),
    salaryPeriod: z.enum(SALARY_PERIODS).nullable(),
    visaSponsorship: z.enum(VISA_SPONSORSHIP),
    description: z.string().max(MAX_DESCRIPTION_LENGTH),
    applyUrl: httpUrl,
    postedAt: z.iso.datetime({ offset: true }).nullable(),
  })
  .refine((job) => job.salaryMin === null || job.salaryMax === null || job.salaryMin <= job.salaryMax, {
    message: "salaryMin must not exceed salaryMax",
    path: ["salaryMin"],
  });

export type NormalizedJob = z.infer<typeof normalizedJobSchema>;

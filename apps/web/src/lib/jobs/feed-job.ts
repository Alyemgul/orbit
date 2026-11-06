import type {
  EmploymentType,
  ExperienceLevel,
  JobCategory,
  JobRow,
  SalaryPeriod,
  VisaSponsorship,
  WorkplaceType,
} from "@orbit/core";
import { formatSalary } from "./format";

/** What the browser gets for a job: no internal columns, description capped. */
export interface FeedJob {
  id: string;
  company: string;
  title: string;
  location: string;
  countryCodes: string[];
  workplace: WorkplaceType;
  employmentType: EmploymentType;
  experienceLevel: ExperienceLevel;
  category: JobCategory;
  salaryMin: number | null;
  salaryMax: number | null;
  salaryCurrency: string | null;
  salaryPeriod: SalaryPeriod | null;
  /** Formatted on the server: Node and browsers disagree on compact currency formats. */
  salaryText: string | null;
  visaSponsorship: VisaSponsorship;
  description: string;
  applyUrl: string;
  /** posted_at, or first_seen_at when the source gives no date. Also the feed cursor. */
  postedAt: string;
  postedAtKnown: boolean;
}

const DESCRIPTION_LIMIT = 6000;

export function toFeedJob(row: JobRow): FeedJob {
  return {
    id: row.id,
    company: row.company,
    title: row.title,
    location: row.location,
    countryCodes: row.country_codes,
    workplace: row.workplace,
    employmentType: row.employment_type,
    experienceLevel: row.experience_level,
    category: row.category,
    salaryMin: row.salary_min === null ? null : Number(row.salary_min),
    salaryMax: row.salary_max === null ? null : Number(row.salary_max),
    salaryCurrency: row.salary_currency,
    salaryPeriod: row.salary_period,
    salaryText: formatSalary(
      row.salary_min === null ? null : Number(row.salary_min),
      row.salary_max === null ? null : Number(row.salary_max),
      row.salary_currency,
      row.salary_period,
    ),
    visaSponsorship: row.visa_sponsorship,
    description:
      row.description.length > DESCRIPTION_LIMIT ? `${row.description.slice(0, DESCRIPTION_LIMIT)}…` : row.description,
    applyUrl: row.apply_url,
    postedAt: new Date(row.posted_at ?? row.first_seen_at).toISOString(),
    postedAtKnown: row.posted_at !== null,
  };
}

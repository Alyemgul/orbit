import type { EmploymentType, ExperienceLevel } from "@orbit/core";
import { z } from "zod";
import type { RawJob } from "../normalize";
import { PRIORITY, type Source } from "./types";

/**
 * MyCareersFuture: the Singapore government's free national job portal
 * (public JSON API). Jobs are posted by employers in Singapore directly, and
 * the data includes salary, seniority and minimum years of experience.
 */

const PAGE_SIZE = 100;

const jobSchema = z.object({
  uuid: z.string(),
  title: z.string(),
  description: z.string().nullish(),
  minimumYearsExperience: z.number().nullish(),
  employmentTypes: z.array(z.object({ employmentType: z.string().nullish() })).nullish(),
  positionLevels: z.array(z.object({ position: z.string().nullish() })).nullish(),
  postedCompany: z.object({ name: z.string().nullish(), logoUploadPath: z.string().nullish() }).nullish(),
  hiringCompany: z.object({ name: z.string().nullish() }).nullish(),
  address: z
    .object({
      isOverseas: z.boolean().nullish(),
      districts: z.array(z.object({ region: z.string().nullish() })).nullish(),
    })
    .nullish(),
  metadata: z
    .object({
      jobDetailsUrl: z.string().nullish(),
      newPostingDate: z.string().nullish(),
      isHideSalary: z.boolean().nullish(),
    })
    .nullish(),
  salary: z
    .object({
      minimum: z.number().nullish(),
      maximum: z.number().nullish(),
      type: z.object({ salaryType: z.string().nullish() }).nullish(),
    })
    .nullish(),
});
const responseSchema = z.object({ results: z.array(jobSchema), total: z.number().nullish() });

function employmentOf(types: { employmentType?: string | null }[] | null | undefined): EmploymentType | null {
  const labels = (types ?? []).map((t) => (t.employmentType ?? "").toLowerCase());
  if (labels.some((l) => l.includes("intern"))) return "internship";
  if (labels.some((l) => l.includes("permanent") || l.includes("full time"))) return "full_time";
  if (labels.some((l) => l.includes("contract") || l.includes("freelance"))) return "contract";
  if (labels.some((l) => l.includes("temporary"))) return "temporary";
  if (labels.some((l) => l.includes("part time"))) return "part_time";
  return null;
}

function levelOf(job: z.infer<typeof jobSchema>): ExperienceLevel | null {
  const positions = (job.positionLevels ?? []).map((p) => (p.position ?? "").toLowerCase());
  if (positions.some((p) => p.includes("fresh") || p.includes("entry"))) return "entry";
  if (positions.some((p) => p.includes("senior management") || p.includes("middle management"))) return "lead";
  if (positions.some((p) => p === "manager")) return "lead";
  if (positions.some((p) => p.includes("senior executive"))) return "senior";
  // No level stated but no experience required: open to new grads.
  if (job.minimumYearsExperience === 0) return "entry";
  return null;
}

export interface MyCareersFutureConfig {
  searches: string[];
  pagesPerSearch: number;
}

export function myCareersFutureSource({ searches, pagesPerSearch }: MyCareersFutureConfig): Source {
  return {
    id: "mycareersfuture",
    label: "MyCareersFuture (Singapore)",
    priority: PRIORITY.aggregator,
    async fetchJobs({ http, signal }) {
      const jobs = new Map<string, RawJob>();
      for (const search of searches) {
        for (let page = 0; page < pagesPerSearch; page++) {
          const params = new URLSearchParams({ search, limit: String(PAGE_SIZE), page: String(page) });
          const body = responseSchema.parse(
            await http.getJson(`https://api.mycareersfuture.gov.sg/v2/jobs?${params}`, { signal }),
          );
          for (const job of body.results) {
            if (jobs.has(job.uuid) || job.address?.isOverseas) continue;
            const url = job.metadata?.jobDetailsUrl ?? `https://www.mycareersfuture.gov.sg/job/${job.uuid}`;
            const showSalary = job.salary && !job.metadata?.isHideSalary;
            const salaryType = (job.salary?.type?.salaryType ?? "").toLowerCase();
            const region = job.address?.districts?.[0]?.region;
            jobs.set(job.uuid, {
              sourceJobId: job.uuid,
              title: job.title,
              company: job.hiringCompany?.name || job.postedCompany?.name || "Unknown company",
              location: region ? `Singapore (${region})` : "Singapore",
              countryCodes: ["SG"],
              descriptionHtml: job.description,
              applyUrl: url,
              sourceUrl: url,
              companyLogoUrl: job.postedCompany?.logoUploadPath,
              employmentType: employmentOf(job.employmentTypes),
              experienceLevel: levelOf(job),
              salary: showSalary
                ? {
                    min: job.salary?.minimum,
                    max: job.salary?.maximum,
                    currency: "SGD",
                    period: salaryType.includes("annual") ? "year" : salaryType.includes("hour") ? "hour" : "month",
                  }
                : null,
              postedAt: job.metadata?.newPostingDate ?? null,
            });
          }
          if (body.results.length < PAGE_SIZE) break;
        }
      }
      return [...jobs.values()];
    },
  };
}

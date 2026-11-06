import { z } from "zod";
import type { RawJob } from "../normalize";
import { PRIORITY, employmentFromLabel, toNumber, type Source } from "./types";

/* ------------------------------------------------------------------------ */
/* Arbeitnow: free EU (mostly Germany) job board API. Terms ask for a link   */
/* back, so each job keeps its Arbeitnow page as sourceUrl.                  */
/* ------------------------------------------------------------------------ */

const arbeitnowSchema = z.object({
  data: z.array(
    z.object({
      slug: z.string(),
      company_name: z.string(),
      title: z.string(),
      description: z.string().nullish(),
      remote: z.boolean().nullish(),
      url: z.string(),
      job_types: z.array(z.string()).nullish(),
      location: z.string().nullish(),
      created_at: z.number().nullish(),
    }),
  ),
  links: z.object({ next: z.string().nullish() }).nullish(),
});

export function arbeitnowSource({ maxPages = 3 }: { maxPages?: number } = {}): Source {
  return {
    id: "arbeitnow",
    label: "Arbeitnow",
    priority: PRIORITY.aggregator,
    async fetchJobs({ http, signal }) {
      const jobs: RawJob[] = [];
      for (let page = 1; page <= maxPages; page++) {
        const body = arbeitnowSchema.parse(
          await http.getJson(`https://www.arbeitnow.com/api/job-board-api?page=${page}`, { signal }),
        );
        for (const job of body.data) {
          jobs.push({
            sourceJobId: job.slug,
            title: job.title,
            company: job.company_name,
            location: job.location ?? "",
            descriptionHtml: job.description,
            applyUrl: job.url,
            sourceUrl: job.url,
            workplace: job.remote ? "remote" : null,
            employmentType: employmentFromLabel(job.job_types?.join(" ")),
            postedAt: job.created_at ?? null,
          });
        }
        if (!body.links?.next || body.data.length === 0) break;
      }
      return jobs;
    },
  };
}

/* ------------------------------------------------------------------------ */
/* Remotive: free remote-jobs API. Terms: credit Remotive with a link back   */
/* and call it at most ~4 times a day (the cron runs every 6 hours, and      */
/* this source makes exactly one request per run).                           */
/* ------------------------------------------------------------------------ */

const remotiveSchema = z.object({
  jobs: z.array(
    z.object({
      id: z.number(),
      url: z.string(),
      title: z.string(),
      company_name: z.string(),
      company_logo: z.string().nullish(),
      category: z.string().nullish(),
      job_type: z.string().nullish(),
      publication_date: z.string().nullish(),
      candidate_required_location: z.string().nullish(),
      description: z.string().nullish(),
    }),
  ),
});

export const REMOTIVE_TECH_CATEGORIES = [
  "Software Development",
  "DevOps / Sysadmin",
  "Data",
  "Data Analysis",
  "QA",
  "Artificial Intelligence",
  "Information Technology",
];

export function remotiveSource({ categories = REMOTIVE_TECH_CATEGORIES }: { categories?: string[] } = {}): Source {
  const wanted = new Set(categories.map((c) => c.toLowerCase()));
  return {
    id: "remotive",
    label: "Remotive",
    priority: PRIORITY.aggregator,
    async fetchJobs({ http, signal }) {
      const { jobs } = remotiveSchema.parse(await http.getJson("https://remotive.com/api/remote-jobs", { signal }));
      return jobs
        .filter((job) => wanted.has((job.category ?? "").toLowerCase()))
        .map(
          (job): RawJob => ({
            sourceJobId: String(job.id),
            title: job.title,
            company: job.company_name,
            location: job.candidate_required_location ? `Remote (${job.candidate_required_location})` : "Remote",
            // "Worldwide"/"Europe" are regions, not countries.
            countryCodes: [],
            descriptionHtml: job.description,
            applyUrl: job.url,
            sourceUrl: job.url,
            companyLogoUrl: job.company_logo,
            workplace: "remote",
            employmentType: employmentFromLabel(job.job_type),
            postedAt: job.publication_date ?? null,
          }),
        );
    },
  };
}

/* ------------------------------------------------------------------------ */
/* Adzuna: free API key (developer.adzuna.com). Optional: skipped unless     */
/* ADZUNA_APP_ID and ADZUNA_APP_KEY are set. Descriptions are snippets.      */
/* ------------------------------------------------------------------------ */

const adzunaSchema = z.object({
  results: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      description: z.string().nullish(),
      redirect_url: z.string(),
      created: z.string().nullish(),
      company: z.object({ display_name: z.string().nullish() }).nullish(),
      location: z.object({ display_name: z.string().nullish() }).nullish(),
      salary_min: z.union([z.number(), z.string()]).nullish(),
      salary_max: z.union([z.number(), z.string()]).nullish(),
      salary_is_predicted: z.union([z.string(), z.number()]).nullish(),
      contract_time: z.string().nullish(),
      contract_type: z.string().nullish(),
    }),
  ),
});

const ADZUNA_CURRENCY: Record<string, string> = {
  gb: "GBP", de: "EUR", fr: "EUR", nl: "EUR", at: "EUR", it: "EUR", es: "EUR", be: "EUR",
  pl: "PLN", ch: "CHF", us: "USD", ca: "CAD", in: "INR", au: "AUD",
};

export interface AdzunaConfig {
  appId: string;
  appKey: string;
  /** Adzuna country codes (lower-case ISO alpha-2, "gb" for the UK). */
  countries: string[];
  what: string;
  pagesPerCountry?: number;
}

export function adzunaSource({ appId, appKey, countries, what, pagesPerCountry = 2 }: AdzunaConfig): Source {
  return {
    id: "adzuna",
    label: "Adzuna",
    priority: PRIORITY.adzuna,
    async fetchJobs({ http, signal }) {
      const jobs: RawJob[] = [];
      for (const country of countries) {
        for (let page = 1; page <= pagesPerCountry; page++) {
          const params = new URLSearchParams({
            app_id: appId,
            app_key: appKey,
            results_per_page: "50",
            what,
            max_days_old: "14",
            "content-type": "application/json",
          });
          const url = `https://api.adzuna.com/v1/api/jobs/${encodeURIComponent(country)}/search/${page}?${params}`;
          const { results } = adzunaSchema.parse(await http.getJson(url, { signal }));
          for (const job of results) {
            const predicted = String(job.salary_is_predicted ?? "0") === "1";
            jobs.push({
              sourceJobId: `${country}:${job.id}`,
              title: job.title,
              company: job.company?.display_name || "Unknown company",
              location: job.location?.display_name ?? "",
              countryCodes: [country === "gb" ? "GB" : country.toUpperCase()],
              descriptionText: job.description,
              applyUrl: job.redirect_url,
              sourceUrl: job.redirect_url,
              employmentType: employmentFromLabel(`${job.contract_time ?? ""} ${job.contract_type ?? ""}`),
              // Adzuna's estimated salaries are guesses; only keep stated ones.
              salary: predicted
                ? null
                : {
                    min: toNumber(job.salary_min),
                    max: toNumber(job.salary_max),
                    currency: ADZUNA_CURRENCY[country] ?? null,
                    period: "year",
                  },
              postedAt: job.created ?? null,
            });
          }
          if (results.length < 50) break;
        }
      }
      return jobs;
    },
  };
}

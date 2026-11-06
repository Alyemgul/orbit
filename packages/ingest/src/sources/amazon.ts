// Approach adapted from career-ops (MIT, (c) 2026 Santiago Fernández de
// Valderrama): the public amazon.jobs search JSON, filtered by facets passed
// in bracket form (normalized_country_code[]=DEU) and paged by offset.

import { z } from "zod";
import type { RawJob } from "../normalize";
import { PRIORITY, employmentFromLabel, type Source } from "./types";

const ORIGIN = "https://www.amazon.jobs";
/** amazon.jobs rejects result_limit above 100. */
const PAGE_SIZE = 100;

const ALPHA3_TO_ALPHA2: Record<string, string> = {
  DEU: "DE", GBR: "GB", IRL: "IE", NLD: "NL", FRA: "FR", ESP: "ES", ITA: "IT", POL: "PL", HUN: "HU",
  AUT: "AT", CHE: "CH", BEL: "BE", LUX: "LU", SWE: "SE", DNK: "DK", FIN: "FI", NOR: "NO", CZE: "CZ",
  ROU: "RO", PRT: "PT", GRC: "GR", USA: "US", CAN: "CA", IND: "IN", ISR: "IL", ARE: "AE",
  SGP: "SG", JPN: "JP", KOR: "KR", HKG: "HK", TWN: "TW", VNM: "VN", MYS: "MY", CHN: "CN", PHL: "PH",
  IDN: "ID", THA: "TH", SAU: "SA",
};

const jobSchema = z.object({
  id_icims: z.string(),
  title: z.string(),
  job_path: z.string(),
  normalized_location: z.string().nullish(),
  location: z.string().nullish(),
  country_code: z.string().nullish(),
  posted_date: z.string().nullish(),
  description: z.string().nullish(),
  basic_qualifications: z.string().nullish(),
  preferred_qualifications: z.string().nullish(),
  job_schedule_type: z.string().nullish(),
  is_intern: z.boolean().nullish(),
});
const responseSchema = z.object({ hits: z.number().nullish(), jobs: z.array(jobSchema) });

export interface AmazonConfig {
  /** Distinguishes several Amazon searches, e.g. "europe" and "asia". */
  id: string;
  /** ISO alpha-3 codes, as amazon.jobs uses them. */
  countries: string[];
  /** amazon.jobs category facets, e.g. "software-development". */
  categories?: string[];
  query?: string;
  max?: number;
}

/** amazon.jobs uses "<br/>" line breaks and "- " bullets inside its HTML. */
function qualificationsHtml(title: string, value: string | null | undefined): string {
  return value ? `<h3>${title}</h3><p>${value}</p>` : "";
}

export function amazonSource({ id, countries, categories = [], query = "", max = 400 }: AmazonConfig): Source {
  return {
    id: `amazon:${id}`,
    label: `Amazon ${id} (amazon.jobs)`,
    priority: PRIORITY.companyBoard,
    async fetchJobs({ http, signal }) {
      const jobs: RawJob[] = [];
      const seen = new Set<string>();
      for (let offset = 0; jobs.length < max; offset += PAGE_SIZE) {
        const params = new URLSearchParams({
          base_query: query,
          loc_query: "",
          sort: "recent",
          result_limit: String(PAGE_SIZE),
          offset: String(offset),
        });
        for (const country of countries) params.append("normalized_country_code[]", country);
        for (const category of categories) params.append("category[]", category);

        const page = responseSchema.parse(await http.getJson(`${ORIGIN}/en/search.json?${params}`, { signal }));
        let fresh = 0;
        for (const job of page.jobs) {
          if (seen.has(job.id_icims) || !job.job_path.startsWith("/")) continue;
          seen.add(job.id_icims);
          fresh++;
          const pageUrl = `${ORIGIN}${job.job_path}`;
          const country = ALPHA3_TO_ALPHA2[job.country_code ?? ""];
          jobs.push({
            sourceJobId: job.id_icims,
            title: job.title,
            company: "Amazon",
            location: job.normalized_location ?? job.location ?? "",
            countryCodes: country ? [country] : null,
            descriptionHtml: [
              job.description ? `<p>${job.description}</p>` : "",
              qualificationsHtml("Basic qualifications", job.basic_qualifications),
              qualificationsHtml("Preferred qualifications", job.preferred_qualifications),
            ].join(""),
            // The job page; amazon.jobs applications need an Amazon candidate account (assisted apply).
            applyUrl: pageUrl,
            sourceUrl: pageUrl,
            employmentType: job.is_intern ? "internship" : employmentFromLabel(job.job_schedule_type),
            experienceLevel: job.is_intern ? "intern" : null,
            postedAt: job.posted_date ?? null,
          });
        }
        // Stop on the last page, or if the API ignored the offset and repeated itself.
        if (page.jobs.length < PAGE_SIZE || fresh === 0) break;
      }
      return jobs.slice(0, max);
    },
  };
}

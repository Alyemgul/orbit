import type { ExperienceLevel } from "@orbit/core";
import { z } from "zod";
import { mapLimit } from "../http";
import type { RawJob } from "../normalize";
import { PRIORITY, employmentFromLabel, type Source } from "./types";

const PAGE_SIZE = 100;

const summarySchema = z.object({
  id: z.string(),
  name: z.string(),
  releasedDate: z.string().nullish(),
  company: z.object({ name: z.string().nullish() }).nullish(),
  location: z
    .object({
      fullLocation: z.string().nullish(),
      city: z.string().nullish(),
      country: z.string().nullish(),
      remote: z.boolean().nullish(),
      hybrid: z.boolean().nullish(),
    })
    .nullish(),
  typeOfEmployment: z.object({ label: z.string().nullish() }).nullish(),
  experienceLevel: z.object({ id: z.string().nullish() }).nullish(),
});
const listSchema = z.object({ totalFound: z.number(), content: z.array(summarySchema) });

const sectionSchema = z.object({ title: z.string().nullish(), text: z.string().nullish() }).nullish();
const detailSchema = z.object({
  postingUrl: z.string().nullish(),
  applyUrl: z.string().nullish(),
  jobAd: z
    .object({
      sections: z
        .object({
          jobDescription: sectionSchema,
          qualifications: sectionSchema,
          additionalInformation: sectionSchema,
        })
        .nullish(),
    })
    .nullish(),
});

const EXPERIENCE: Record<string, ExperienceLevel> = {
  internship: "intern",
  entry_level: "entry",
  associate: "entry",
  mid_senior_level: "mid",
  director: "lead",
  executive: "lead",
};

export interface SmartRecruitersConfig {
  token: string;
  name: string;
  /** Large employers list thousands of jobs; narrow with a keyword and country. */
  query?: string;
  country?: string;
  max?: number;
}

export function smartRecruitersSource({ token, name, query, country, max = 200 }: SmartRecruitersConfig): Source {
  const base = `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(token)}/postings`;
  return {
    id: `smartrecruiters:${token}`,
    label: `${name} (SmartRecruiters)`,
    priority: PRIORITY.companyBoard,
    async fetchJobs({ http, signal }) {
      const summaries: z.infer<typeof summarySchema>[] = [];
      for (let offset = 0; summaries.length < max; offset += PAGE_SIZE) {
        const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset) });
        if (query) params.set("q", query);
        if (country) params.set("country", country.toLowerCase());
        const page = listSchema.parse(await http.getJson(`${base}?${params}`, { signal }));
        summaries.push(...page.content);
        if (page.content.length < PAGE_SIZE || offset + PAGE_SIZE >= page.totalFound) break;
      }

      // The list has no description; fetch details politely, a few at a time.
      return mapLimit(summaries.slice(0, max), 4, async (summary): Promise<RawJob> => {
        const detail = detailSchema.parse(await http.getJson(`${base}/${encodeURIComponent(summary.id)}`, { signal }));
        const sections = detail.jobAd?.sections;
        const html = [sections?.jobDescription, sections?.qualifications, sections?.additionalInformation]
          .filter(Boolean)
          .map((s) => `<h3>${s?.title ?? ""}</h3>${s?.text ?? ""}`)
          .join("");
        const location = summary.location;
        const fallbackUrl = `https://jobs.smartrecruiters.com/${encodeURIComponent(token)}/${encodeURIComponent(summary.id)}`;
        return {
          sourceJobId: summary.id,
          title: summary.name,
          company: summary.company?.name || name,
          location: location?.fullLocation ?? location?.city ?? "",
          countryCodes: location?.country ? [location.country] : null,
          descriptionHtml: html,
          applyUrl: detail.applyUrl ?? detail.postingUrl ?? fallbackUrl,
          sourceUrl: detail.postingUrl ?? fallbackUrl,
          workplace: location?.remote ? "remote" : location?.hybrid ? "hybrid" : null,
          employmentType: employmentFromLabel(summary.typeOfEmployment?.label),
          experienceLevel: EXPERIENCE[summary.experienceLevel?.id ?? ""] ?? null,
          postedAt: summary.releasedDate ?? null,
        };
      });
    },
  };
}

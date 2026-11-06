import type { ExperienceLevel } from "@orbit/core";
import { z } from "zod";
import type { RawJob } from "../normalize";
import { PRIORITY, employmentFromLabel, periodFromLabel, toNumber, type Source } from "./types";

const offerSchema = z.object({
  id: z.number(),
  title: z.string(),
  status: z.string().nullish(),
  location: z.string().nullish(),
  country_code: z.string().nullish(),
  locations: z.array(z.object({ country_code: z.string().nullish() })).nullish(),
  remote: z.boolean().nullish(),
  hybrid: z.boolean().nullish(),
  on_site: z.boolean().nullish(),
  description: z.string().nullish(),
  requirements: z.string().nullish(),
  employment_type_code: z.string().nullish(),
  experience_code: z.string().nullish(),
  careers_url: z.string(),
  careers_apply_url: z.string().nullish(),
  published_at: z.string().nullish(),
  company_name: z.string().nullish(),
  salary: z
    .object({
      min: z.union([z.number(), z.string()]).nullish(),
      max: z.union([z.number(), z.string()]).nullish(),
      currency: z.string().nullish(),
      period: z.string().nullish(),
    })
    .nullish(),
});
const responseSchema = z.object({ offers: z.array(offerSchema) });

const EXPERIENCE: Record<string, ExperienceLevel> = {
  student: "intern",
  entry_level: "entry",
  graduate: "entry",
  mid_level: "mid",
  experienced: "mid",
  senior: "senior",
  manager: "lead",
  executive: "lead",
};

export function recruiteeSource({ token, name }: { token: string; name: string }): Source {
  return {
    id: `recruitee:${token}`,
    label: `${name} (Recruitee)`,
    priority: PRIORITY.companyBoard,
    async fetchJobs({ http, signal }) {
      const url = `https://${encodeURIComponent(token)}.recruitee.com/api/offers/`;
      const { offers } = responseSchema.parse(await http.getJson(url, { signal }));
      return offers
        .filter((offer) => !offer.status || offer.status === "published")
        .map((offer): RawJob => {
          const countries = [offer.country_code, ...(offer.locations ?? []).map((l) => l.country_code)].filter(
            (code): code is string => Boolean(code),
          );
          return {
            sourceJobId: String(offer.id),
            title: offer.title,
            company: offer.company_name || name,
            location: offer.location ?? "",
            countryCodes: countries,
            descriptionHtml: `${offer.description ?? ""}${offer.requirements ?? ""}`,
            applyUrl: offer.careers_apply_url ?? offer.careers_url,
            sourceUrl: offer.careers_url,
            workplace: offer.remote ? "remote" : offer.hybrid ? "hybrid" : offer.on_site ? "onsite" : null,
            employmentType: employmentFromLabel(offer.employment_type_code),
            // Recruitee's generic "experienced" says nothing about seniority; let the title decide.
            experienceLevel:
              offer.experience_code && offer.experience_code !== "experienced"
                ? (EXPERIENCE[offer.experience_code] ?? null)
                : null,
            salary: offer.salary
              ? {
                  min: toNumber(offer.salary.min),
                  max: toNumber(offer.salary.max),
                  currency: offer.salary.currency,
                  period: periodFromLabel(offer.salary.period),
                }
              : null,
            postedAt: offer.published_at ?? null,
          };
        });
    },
  };
}

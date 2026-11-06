import type { WorkplaceType } from "@orbit/core";
import { z } from "zod";
import type { RawJob } from "../normalize";
import { PRIORITY, employmentFromLabel, periodFromLabel, type Source } from "./types";

const postingSchema = z.object({
  id: z.string(),
  text: z.string(),
  hostedUrl: z.string(),
  applyUrl: z.string().nullish(),
  createdAt: z.number().nullish(),
  country: z.string().nullish(),
  workplaceType: z.string().nullish(),
  categories: z
    .object({
      location: z.string().nullish(),
      allLocations: z.array(z.string()).nullish(),
      commitment: z.string().nullish(),
    })
    .nullish(),
  description: z.string().nullish(),
  lists: z.array(z.object({ text: z.string().nullish(), content: z.string().nullish() })).nullish(),
  additional: z.string().nullish(),
  salaryRange: z
    .object({
      min: z.number().nullish(),
      max: z.number().nullish(),
      currency: z.string().nullish(),
      interval: z.string().nullish(),
    })
    .nullish(),
});
const responseSchema = z.array(postingSchema);

const WORKPLACE: Record<string, WorkplaceType> = { remote: "remote", hybrid: "hybrid", "on-site": "onsite" };

export interface LeverConfig {
  token: string;
  name: string;
  /** Lever's EU instance lives on a separate API host. */
  region?: "global" | "eu";
}

export function leverSource({ token, name, region = "global" }: LeverConfig): Source {
  const host = region === "eu" ? "api.eu.lever.co" : "api.lever.co";
  return {
    id: `lever:${token}`,
    label: `${name} (Lever)`,
    priority: PRIORITY.companyBoard,
    async fetchJobs({ http, signal }) {
      const url = `https://${host}/v0/postings/${encodeURIComponent(token)}?mode=json`;
      const postings = responseSchema.parse(await http.getJson(url, { signal }));
      return postings.map((posting): RawJob => {
        const lists = (posting.lists ?? [])
          .map((list) => `<h3>${list.text ?? ""}</h3><ul>${list.content ?? ""}</ul>`)
          .join("");
        const locations = posting.categories?.allLocations?.length
          ? posting.categories.allLocations.join(" · ")
          : (posting.categories?.location ?? "");
        return {
          sourceJobId: posting.id,
          title: posting.text,
          company: name,
          location: locations,
          countryCodes: posting.country ? [posting.country] : null,
          descriptionHtml: `${posting.description ?? ""}${lists}${posting.additional ?? ""}`,
          applyUrl: posting.applyUrl ?? posting.hostedUrl,
          sourceUrl: posting.hostedUrl,
          workplace: WORKPLACE[posting.workplaceType ?? ""] ?? null,
          employmentType: employmentFromLabel(posting.categories?.commitment),
          salary: posting.salaryRange
            ? {
                min: posting.salaryRange.min,
                max: posting.salaryRange.max,
                currency: posting.salaryRange.currency,
                period: periodFromLabel(posting.salaryRange.interval),
              }
            : null,
          postedAt: posting.createdAt ?? null,
        };
      });
    },
  };
}

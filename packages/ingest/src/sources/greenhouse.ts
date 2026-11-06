import { decodeHtmlEntities, inferCountryCodes } from "@orbit/core";
import { z } from "zod";
import type { RawJob } from "../normalize";
import { PRIORITY, employmentFromLabel, type Source } from "./types";

const jobSchema = z.object({
  id: z.number(),
  title: z.string(),
  absolute_url: z.string(),
  updated_at: z.string().nullish(),
  first_published: z.string().nullish(),
  company_name: z.string().nullish(),
  location: z.object({ name: z.string().nullish() }).nullish(),
  offices: z.array(z.object({ name: z.string().nullish(), location: z.string().nullish() })).nullish(),
  metadata: z.array(z.object({ name: z.string().nullish(), value: z.unknown() })).nullish(),
  // HTML, entity-escaped a second time by the API.
  content: z.string().nullish(),
});
const responseSchema = z.object({ jobs: z.array(jobSchema) });

export interface BoardConfig {
  token: string;
  name: string;
}

export function greenhouseSource({ token, name }: BoardConfig): Source {
  return {
    id: `greenhouse:${token}`,
    label: `${name} (Greenhouse)`,
    priority: PRIORITY.companyBoard,
    async fetchJobs({ http, signal }) {
      const url = `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(token)}/jobs?content=true`;
      const { jobs } = responseSchema.parse(await http.getJson(url, { signal }));
      return jobs.map((job): RawJob => {
        const officeText = (job.offices ?? []).map((office) => office.location ?? office.name ?? "").join(" · ");
        const timeType = job.metadata?.find((m) => /time type|employment type/i.test(m.name ?? ""))?.value;
        return {
          sourceJobId: String(job.id),
          title: job.title,
          company: job.company_name || name,
          location: job.location?.name ?? "",
          countryCodes: inferCountryCodes(`${job.location?.name ?? ""} · ${officeText}`),
          descriptionHtml: job.content ? decodeHtmlEntities(job.content) : null,
          // The canonical hosted form; company-site URLs embed this same form.
          applyUrl: `https://job-boards.greenhouse.io/${encodeURIComponent(token)}/jobs/${job.id}`,
          sourceUrl: job.absolute_url,
          employmentType: typeof timeType === "string" ? employmentFromLabel(timeType) : null,
          postedAt: job.first_published ?? job.updated_at ?? null,
        };
      });
    },
  };
}

import { inferCountryCodes, type WorkplaceType } from "@orbit/core";
import { z } from "zod";
import type { RawJob } from "../normalize";
import { PRIORITY, employmentFromLabel, periodFromLabel, type Source } from "./types";

const componentSchema = z.object({
  compensationType: z.string().nullish(),
  interval: z.string().nullish(),
  currencyCode: z.string().nullish(),
  minValue: z.number().nullish(),
  maxValue: z.number().nullish(),
});

const jobSchema = z.object({
  id: z.string(),
  title: z.string(),
  location: z.string().nullish(),
  secondaryLocations: z.array(z.object({ location: z.string().nullish() })).nullish(),
  employmentType: z.string().nullish(),
  workplaceType: z.string().nullish(),
  isRemote: z.boolean().nullish(),
  isListed: z.boolean().nullish(),
  publishedAt: z.string().nullish(),
  jobUrl: z.string(),
  applyUrl: z.string().nullish(),
  descriptionHtml: z.string().nullish(),
  address: z
    .object({ postalAddress: z.object({ addressCountry: z.string().nullish() }).nullish() })
    .nullish(),
  compensation: z
    .object({
      compensationTiers: z.array(z.object({ components: z.array(componentSchema).nullish() })).nullish(),
      summaryComponents: z.array(componentSchema).nullish(),
    })
    .nullish(),
});
const responseSchema = z.object({ jobs: z.array(jobSchema) });

const WORKPLACE: Record<string, WorkplaceType> = { remote: "remote", hybrid: "hybrid", onsite: "onsite" };

function salaryOf(job: z.infer<typeof jobSchema>) {
  const components = [
    ...(job.compensation?.summaryComponents ?? []),
    ...(job.compensation?.compensationTiers ?? []).flatMap((tier) => tier.components ?? []),
  ];
  const salary = components.find((c) => c.compensationType?.toLowerCase() === "salary");
  if (!salary) return null;
  return {
    min: salary.minValue,
    max: salary.maxValue,
    currency: salary.currencyCode,
    period: periodFromLabel(salary.interval),
  };
}

export function ashbySource({ token, name }: { token: string; name: string }): Source {
  return {
    id: `ashby:${token}`,
    label: `${name} (Ashby)`,
    priority: PRIORITY.companyBoard,
    async fetchJobs({ http, signal }) {
      const url = `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(token)}?includeCompensation=true`;
      const { jobs } = responseSchema.parse(await http.getJson(url, { signal }));
      return jobs
        .filter((job) => job.isListed !== false)
        .map((job): RawJob => {
          const location = [job.location, ...(job.secondaryLocations ?? []).map((s) => s.location)]
            .filter(Boolean)
            .join(" · ");
          const country = job.address?.postalAddress?.addressCountry ?? "";
          const workplace =
            WORKPLACE[(job.workplaceType ?? "").toLowerCase()] ?? (job.isRemote ? "remote" : null);
          return {
            sourceJobId: job.id,
            title: job.title,
            company: name,
            location,
            countryCodes: inferCountryCodes(`${location} · ${country}`),
            descriptionHtml: job.descriptionHtml,
            applyUrl: job.applyUrl ?? job.jobUrl,
            sourceUrl: job.jobUrl,
            workplace,
            employmentType: employmentFromLabel(job.employmentType),
            salary: salaryOf(job),
            postedAt: job.publishedAt ?? null,
          };
        });
    },
  };
}

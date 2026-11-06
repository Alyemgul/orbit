import { z } from "zod";
import { mapLimit } from "../http";
import type { RawJob } from "../normalize";
import { PRIORITY, employmentFromLabel, type Source } from "./types";

/** Workday's public career-site API returns at most 20 postings per page. */
const PAGE_SIZE = 20;

const listSchema = z.object({
  total: z.number().nullish(),
  jobPostings: z.array(z.object({ title: z.string(), externalPath: z.string().nullish() })),
});

const detailSchema = z.object({
  jobPostingInfo: z.object({
    id: z.string(),
    title: z.string(),
    jobDescription: z.string().nullish(),
    location: z.string().nullish(),
    startDate: z.string().nullish(),
    timeType: z.string().nullish(),
    externalUrl: z.string(),
    jobReqId: z.string().nullish(),
    jobRequisitionLocation: z
      .object({ country: z.object({ alpha2Code: z.string().nullish() }).nullish() })
      .nullish(),
  }),
});

export interface WorkdayConfig {
  name: string;
  /** e.g. "nvidia.wd5.myworkdayjobs.com" */
  host: string;
  tenant: string;
  site: string;
  searchText?: string;
  max?: number;
}

/**
 * Unofficial but public JSON API behind every Workday careers page. It can
 * change without notice, so failures stay isolated to this source.
 */
export function workdaySource({ name, host, tenant, site, searchText = "", max = 150 }: WorkdayConfig): Source {
  if (!/^[a-z0-9-]+\.wd\d+\.myworkdayjobs\.com$/i.test(host)) {
    throw new Error(`Invalid Workday host for ${name}: ${host}`);
  }
  const base = `https://${host}/wday/cxs/${encodeURIComponent(tenant)}/${encodeURIComponent(site)}`;

  return {
    id: `workday:${tenant}`,
    label: `${name} (Workday)`,
    priority: PRIORITY.companyBoard,
    async fetchJobs({ http, signal }) {
      const paths: string[] = [];
      // Workday reports `total` on the first page only (later pages say 0).
      let total: number | null = null;
      for (let offset = 0; paths.length < max; offset += PAGE_SIZE) {
        const page = listSchema.parse(
          await http.postJson(`${base}/jobs`, { limit: PAGE_SIZE, offset, searchText, appliedFacets: {} }, { signal }),
        );
        if (offset === 0) total = page.total ?? null;
        for (const posting of page.jobPostings) {
          if (posting.externalPath?.startsWith("/job/")) paths.push(posting.externalPath);
        }
        if (page.jobPostings.length < PAGE_SIZE || (total !== null && offset + PAGE_SIZE >= total)) break;
      }

      return mapLimit(paths.slice(0, max), 4, async (path): Promise<RawJob> => {
        const { jobPostingInfo: info } = detailSchema.parse(await http.getJson(`${base}${path}`, { signal }));
        const country = info.jobRequisitionLocation?.country?.alpha2Code;
        return {
          sourceJobId: info.jobReqId ?? info.id,
          title: info.title,
          company: name,
          location: info.location ?? "",
          countryCodes: country ? [country] : null,
          descriptionHtml: info.jobDescription,
          applyUrl: info.externalUrl,
          sourceUrl: info.externalUrl,
          employmentType: employmentFromLabel(info.timeType),
          postedAt: info.startDate ?? null,
        };
      });
    },
  };
}

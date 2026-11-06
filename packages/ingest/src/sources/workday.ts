import { z } from "zod";
import { mapLimit } from "../http";
import type { RawJob } from "../normalize";
import { PRIORITY, employmentFromLabel, type Source } from "./types";

/** Workday's public career-site API returns at most 20 postings per page. */
const PAGE_SIZE = 20;

const listSchema = z.object({
  total: z.number().nullish(),
  // Only the link is needed here; some tenants list entries without a title.
  jobPostings: z.array(z.object({ title: z.string().nullish(), externalPath: z.string().nullish() })),
});

const detailSchema = z.object({
  jobPostingInfo: z.object({
    id: z.string(),
    title: z.string(),
    jobDescription: z.string().nullish(),
    location: z.string().nullish(),
    startDate: z.string().nullish(),
    timeType: z.string().nullish(),
    externalUrl: z.string().nullish(),
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
  /**
   * Keyword searches run one after another; results are merged. Large boards
   * (banks list thousands of roles) are narrowed to the titles we care about.
   */
  searches?: string[];
  /** Cap per search, then overall. */
  maxPerSearch?: number;
  max?: number;
}

/**
 * Unofficial but public JSON API behind every Workday careers page. It can
 * change without notice, so failures stay isolated to this source.
 */
export function workdaySource({
  name,
  host,
  tenant,
  site,
  searches = [""],
  maxPerSearch = 100,
  max = 150,
}: WorkdayConfig): Source {
  if (!/^[a-z0-9-]+\.wd\d+\.myworkdayjobs\.com$/i.test(host)) {
    throw new Error(`Invalid Workday host for ${name}: ${host}`);
  }
  const base = `https://${host}/wday/cxs/${encodeURIComponent(tenant)}/${encodeURIComponent(site)}`;

  return {
    id: `workday:${tenant}`,
    label: `${name} (Workday)`,
    priority: PRIORITY.companyBoard,
    async fetchJobs({ http, signal, log }) {
      const paths = new Set<string>();
      for (const searchText of searches) {
        let found = 0;
        // Workday reports `total` on the first page only (later pages say 0).
        let total: number | null = null;
        for (let offset = 0; found < maxPerSearch && paths.size < max; offset += PAGE_SIZE) {
          const page = listSchema.parse(
            await http.postJson(`${base}/jobs`, { limit: PAGE_SIZE, offset, searchText, appliedFacets: {} }, { signal }),
          );
          if (offset === 0) total = page.total ?? null;
          for (const posting of page.jobPostings) {
            if (posting.externalPath?.startsWith("/job/") && !paths.has(posting.externalPath)) {
              paths.add(posting.externalPath);
              found++;
            }
          }
          if (page.jobPostings.length < PAGE_SIZE || (total !== null && offset + PAGE_SIZE >= total)) break;
        }
        if (paths.size >= max) break;
      }

      // Some tenants rate-limit hard (Barclays): two detail requests at a time, and one
      // bad or blocked page only skips that job. Most pages failing still fails the source.
      const selected = [...paths].slice(0, max);
      let failures = 0;
      const jobs = await mapLimit(selected, 2, async (path): Promise<RawJob | null> => {
        let body: unknown;
        try {
          body = await http.getJson(`${base}${path}`, { signal });
        } catch (error) {
          if (signal.aborted) throw error;
          failures++;
          return null;
        }
        const parsed = detailSchema.safeParse(body);
        if (!parsed.success) {
          failures++;
          return null;
        }
        const info = parsed.data.jobPostingInfo;
        const pageUrl = info.externalUrl ?? `https://${host}/${encodeURIComponent(site)}${path}`;
        const country = info.jobRequisitionLocation?.country?.alpha2Code;
        return {
          sourceJobId: info.jobReqId ?? info.id,
          title: info.title,
          company: name,
          location: info.location ?? "",
          countryCodes: country ? [country] : null,
          descriptionHtml: info.jobDescription,
          applyUrl: pageUrl,
          sourceUrl: pageUrl,
          employmentType: employmentFromLabel(info.timeType),
          postedAt: info.startDate ?? null,
        };
      });
      if (selected.length > 0 && failures > selected.length / 2) {
        throw new Error(`${failures} of ${selected.length} job pages failed to load`);
      }
      if (failures > 0) log.warn(`workday:${tenant}: skipped ${failures} job page(s) that failed to load`);
      return jobs.filter((job): job is RawJob => job !== null);
    },
  };
}

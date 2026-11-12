import { z } from "zod";
import type { DiscoverFeedArgs } from "./database.types";
import type { ExperienceLevel, JobCategory } from "./jobs/job";
import { countriesInRegion } from "./jobs/regions";

/**
 * Discover filters. Every option is a named preset, so the URL stays short
 * and nothing user-typed reaches SQL except the search text (which Postgres
 * parses with websearch_to_tsquery).
 */

export const FEED_REGIONS = {
  europe: { label: "Europe", countries: countriesInRegion("europe"), regionWord: "europe" },
  japan: { label: "Japan", countries: ["JP"], regionWord: null },
  korea: { label: "South Korea", countries: ["KR"], regionWord: null },
  singapore: { label: "Singapore", countries: ["SG"], regionWord: null },
  australia: { label: "Australia & NZ", countries: ["AU", "NZ"], regionWord: "oceania" },
  asia_pacific: {
    label: "All Asia-Pacific",
    countries: [...countriesInRegion("asia"), ...countriesInRegion("oceania")],
    regionWord: "asia",
  },
  visa: { label: "Visa sponsored", countries: null, regionWord: null },
  anywhere: { label: "Everywhere", countries: null, regionWord: null },
} as const satisfies Record<string, { label: string; countries: readonly string[] | null; regionWord: string | null }>;

export type FeedRegion = keyof typeof FEED_REGIONS;

export const FEED_LEVELS = {
  new_grad: { label: "New grad", levels: ["entry"] },
  intern: { label: "Internships", levels: ["intern"] },
  early: { label: "New grad + intern", levels: ["entry", "intern"] },
  // Many postings don't state a level; this keeps them but drops senior roles.
  not_senior: { label: "Not senior", levels: ["intern", "entry", "mid", "unknown"] },
  any: { label: "Any level", levels: null },
} as const satisfies Record<string, { label: string; levels: readonly ExperienceLevel[] | null }>;

export type FeedLevel = keyof typeof FEED_LEVELS;

export const FEED_CATEGORY_GROUPS = {
  software: { label: "Software", categories: ["software_engineering", "devops_sre", "security", "qa"] },
  data_ml: { label: "Data & AI", categories: ["data", "ml_ai"] },
  quant: { label: "Quant & trading", categories: ["quant"] },
  tech_business: { label: "Tech & business", categories: ["tech_business"] },
  product_design: { label: "Product & design", categories: ["product", "design"] },
  // Other fields that use CS skills, kept apart from the computer-science groups.
  finance: { label: "Finance", categories: ["finance"] },
  legal: { label: "Law & compliance", categories: ["legal_compliance"] },
  health: { label: "Health & bio", categories: ["health_bio"] },
  other: { label: "Other", categories: ["it_support", "other"] },
} as const satisfies Record<string, { label: string; categories: readonly JobCategory[] }>;

export type FeedCategoryGroup = keyof typeof FEED_CATEGORY_GROUPS;

const REGION_KEYS = Object.keys(FEED_REGIONS) as [FeedRegion, ...FeedRegion[]];
const LEVEL_KEYS = Object.keys(FEED_LEVELS) as [FeedLevel, ...FeedLevel[]];
const GROUP_KEYS = Object.keys(FEED_CATEGORY_GROUPS) as [FeedCategoryGroup, ...FeedCategoryGroup[]];

export const DEFAULT_CATEGORY_GROUPS: readonly FeedCategoryGroup[] = ["software", "data_ml", "quant", "tech_business"];

export const feedFiltersSchema = z.object({
  region: z.enum(REGION_KEYS).catch("europe"),
  level: z.enum(LEVEL_KEYS).catch("new_grad"),
  groups: z
    .array(z.enum(GROUP_KEYS))
    .max(GROUP_KEYS.length)
    .transform((groups) => [...new Set(groups)])
    .catch([...DEFAULT_CATEGORY_GROUPS]),
  remoteOnly: z.boolean().catch(false),
  query: z
    .string()
    .transform((q) => q.trim().slice(0, 100))
    .catch(""),
});

export type FeedFilters = z.infer<typeof feedFiltersSchema>;

/** Top pick first: Europe new-grad roles that use CS skills. */
export const DEFAULT_FEED_FILTERS: FeedFilters = {
  region: "europe",
  level: "new_grad",
  groups: [...DEFAULT_CATEGORY_GROUPS],
  remoteOnly: false,
  query: "",
};

type SearchParams = Record<string, string | string[] | undefined> | URLSearchParams;

function param(params: SearchParams, key: string): string | undefined {
  if (params instanceof URLSearchParams) return params.get(key) ?? undefined;
  const value = params[key];
  return Array.isArray(value) ? value[0] : value;
}

/** Read filters from the URL; anything unknown falls back to the default. */
export function parseFeedFilters(params: SearchParams): FeedFilters {
  const groups = param(params, "cat");
  return feedFiltersSchema.parse({
    region: param(params, "region") ?? DEFAULT_FEED_FILTERS.region,
    level: param(params, "level") ?? DEFAULT_FEED_FILTERS.level,
    groups: groups === undefined ? DEFAULT_FEED_FILTERS.groups : groups.split(",").filter(Boolean),
    remoteOnly: param(params, "remote") === "1",
    query: param(params, "q") ?? "",
  });
}

/** The URL query for a set of filters; defaults are left out. */
export function feedFiltersToQuery(filters: FeedFilters): string {
  const params = new URLSearchParams();
  if (filters.region !== DEFAULT_FEED_FILTERS.region) params.set("region", filters.region);
  if (filters.level !== DEFAULT_FEED_FILTERS.level) params.set("level", filters.level);
  const sameGroups =
    filters.groups.length === DEFAULT_FEED_FILTERS.groups.length &&
    filters.groups.every((group) => DEFAULT_FEED_FILTERS.groups.includes(group));
  if (!sameGroups) params.set("cat", filters.groups.join(","));
  if (filters.remoteOnly) params.set("remote", "1");
  if (filters.query) params.set("q", filters.query);
  return params.toString();
}

export interface FeedCursor {
  /** coalesce(posted_at, first_seen_at) of the last job shown. */
  ts: string;
  id: string;
}

export const feedCursorSchema = z.object({ ts: z.iso.datetime({ offset: true }), id: z.uuid() });

/** Arguments for the discover_feed() database function. */
export function feedArgs(filters: FeedFilters, cursor: FeedCursor | null, limit = 20): DiscoverFeedArgs {
  const region = FEED_REGIONS[filters.region];
  const levels = FEED_LEVELS[filters.level].levels;
  const allGroups = filters.groups.length === 0 || filters.groups.length === GROUP_KEYS.length;
  return {
    p_countries: region.countries ? [...region.countries] : null,
    p_region_word: region.regionWord,
    p_levels: levels ? [...levels] : null,
    p_categories: allGroups ? null : filters.groups.flatMap((group) => FEED_CATEGORY_GROUPS[group].categories),
    p_workplaces: filters.remoteOnly ? ["remote"] : null,
    p_visa_only: filters.region === "visa",
    p_query: filters.query || null,
    p_cursor_ts: cursor?.ts ?? null,
    p_cursor_id: cursor?.id ?? null,
    p_limit: limit,
  };
}

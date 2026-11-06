import type { VisaSponsorship, WorkplaceType } from "./job";

export const REGIONS = ["europe", "asia", "americas", "oceania", "africa"] as const;
export type Region = (typeof REGIONS)[number];

const COUNTRIES_BY_REGION: Record<Region, readonly string[]> = {
  europe: [
    "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "HU", "IE", "IT", "LV", "LT",
    "LU", "MT", "NL", "PL", "PT", "RO", "SK", "SI", "ES", "SE", "GB", "CH", "NO", "IS", "LI", "RS", "UA",
    "MD", "AL", "BA", "ME", "MK", "XK", "TR", "GE", "AM",
  ],
  asia: [
    "IN", "CN", "JP", "KR", "SG", "HK", "TW", "VN", "TH", "MY", "ID", "PH", "PK", "BD", "LK", "NP",
    "KZ", "UZ", "AE", "IL", "SA", "QA", "BH", "KW", "OM", "JO",
  ],
  americas: ["US", "CA", "MX", "BR", "AR", "CL", "CO", "PE", "UY", "CR", "PA", "EC", "DO", "GT"],
  oceania: ["AU", "NZ"],
  africa: ["ZA", "EG", "NG", "KE", "MA", "TN", "GH", "RW"],
};

const REGION_OF = new Map<string, Region>(
  Object.entries(COUNTRIES_BY_REGION).flatMap(([region, codes]) => codes.map((code) => [code, region as Region])),
);

export function regionOf(countryCode: string): Region | null {
  return REGION_OF.get(countryCode.toUpperCase()) ?? null;
}

/** Remote-job wording that names regions instead of countries. */
const REGION_WORDS: readonly (readonly [RegExp, Region | "anywhere"])[] = [
  [/\b(worldwide|global(ly)?|anywhere|international)\b/i, "anywhere"],
  [/\b(europe(an)?|emea|eu|eea|cet|cest)\b/i, "europe"],
  [/\b(asia|apac|asia[- ]pacific|middle east|mena)\b/i, "asia"],
  [/\b(australia|oceania|anz|new zealand)\b/i, "oceania"],
  [/\b(us|usa|u\.s\.|united states|north america|americas|latam|latin america|canada)\b/i, "americas"],
];

export interface ScopeRule {
  /** Regions the user is searching in. */
  regions: readonly Region[];
  /** Keep jobs elsewhere when the posting says visa sponsorship is offered. */
  keepIfVisaSponsored: boolean;
  /** Keep jobs whose location can't be placed at all (better a few extra than missing ones). */
  keepUnknownLocation: boolean;
}

export interface ScopeInput {
  countryCodes: readonly string[];
  location: string;
  workplace: WorkplaceType;
  visaSponsorship: VisaSponsorship;
}

export type ScopeDecision = "in_region" | "visa_sponsored" | "remote_anywhere" | "unknown_location" | "out_of_scope";

/**
 * Decide whether a job is worth storing for this search. Returns why it was
 * kept, so the feed can explain itself ("visa sponsored", "remote, worldwide").
 */
export function scopeDecision(job: ScopeInput, rule: ScopeRule): ScopeDecision {
  const wanted = new Set<Region>(rule.regions);
  const regions = new Set(job.countryCodes.map(regionOf).filter((r): r is Region => r !== null));

  if ([...regions].some((region) => wanted.has(region))) return "in_region";

  if (regions.size === 0) {
    // No country: look for region words ("Remote, Europe", "Worldwide", "Remote - US").
    const named = REGION_WORDS.filter(([pattern]) => pattern.test(job.location)).map(([, region]) => region);
    if (named.includes("anywhere")) return "remote_anywhere";
    if (named.some((region) => region !== "anywhere" && wanted.has(region))) return "in_region";
    if (named.length === 0) {
      if (rule.keepIfVisaSponsored && job.visaSponsorship === "yes") return "visa_sponsored";
      return rule.keepUnknownLocation ? "unknown_location" : "out_of_scope";
    }
  }

  if (rule.keepIfVisaSponsored && job.visaSponsorship === "yes") return "visa_sponsored";
  return "out_of_scope";
}

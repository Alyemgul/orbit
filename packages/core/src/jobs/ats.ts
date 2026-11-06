import type { AtsType } from "./job";

const HOST_RULES: readonly (readonly [RegExp, AtsType])[] = [
  [/(^|\.)greenhouse\.io$/, "greenhouse"],
  [/^jobs\.(eu\.)?lever\.co$/, "lever"],
  [/^jobs\.ashbyhq\.com$/, "ashby"],
  [/^(jobs|careers)\.smartrecruiters\.com$/, "smartrecruiters"],
  [/\.recruitee\.com$/, "recruitee"],
  [/\.myworkdayjobs\.com$/, "workday"],
  [/^(apply|jobs)\.workable\.com$/, "workable"],
  [/\.jobs\.personio\.(de|com)$/, "personio"],
  [/\.teamtailor\.com$/, "teamtailor"],
];

/**
 * Which applicant-tracking system hosts the application form. The autopilot
 * picks its form adapter from this, so unknown hosts fall back to "other"
 * (assisted/manual apply).
 */
export function detectAtsFromUrl(url: string): AtsType {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return "other";
  }
  const host = parsed.hostname.toLowerCase();
  for (const [pattern, ats] of HOST_RULES) {
    if (pattern.test(host)) return ats;
  }
  // Greenhouse boards embedded on a company domain carry a gh_jid parameter.
  if (parsed.searchParams.has("gh_jid")) return "greenhouse";
  return "other";
}

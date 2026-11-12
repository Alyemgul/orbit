import type { ExperienceLevel, JobCategory, SalaryPeriod, WorkplaceType } from "@orbit/core";

export type Tone = "neutral" | "accent" | "success" | "warning" | "danger" | "info";

/** Level tags read like difficulty: the greener, the earlier in a career. */
export const LEVEL_TAGS: Record<ExperienceLevel, { label: string; tone: Tone }> = {
  intern: { label: "Internship", tone: "info" },
  entry: { label: "New grad", tone: "success" },
  mid: { label: "Mid", tone: "warning" },
  senior: { label: "Senior", tone: "danger" },
  lead: { label: "Lead", tone: "danger" },
  unknown: { label: "Level n/a", tone: "neutral" },
};

export const CATEGORY_LABELS: Record<JobCategory, string> = {
  software_engineering: "Software",
  data: "Data",
  ml_ai: "ML / AI",
  devops_sre: "DevOps / SRE",
  security: "Security",
  qa: "QA",
  product: "Product",
  design: "Design",
  it_support: "IT support",
  other: "Other",
  quant: "Quant",
  tech_business: "Tech & business",
  finance: "Finance",
  legal_compliance: "Law & compliance",
  health_bio: "Health & bio",
};

export const WORKPLACE_LABELS: Record<WorkplaceType, string | null> = {
  remote: "Remote",
  hybrid: "Hybrid",
  onsite: "On-site",
  unknown: null,
};

const RELATIVE = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

export function timeAgo(iso: string, now: number = Date.now()): string {
  const seconds = Math.round((new Date(iso).getTime() - now) / 1000);
  const abs = Math.abs(seconds);
  if (abs < 3600) return RELATIVE.format(Math.round(seconds / 60), "minute");
  if (abs < 86_400) return RELATIVE.format(Math.round(seconds / 3600), "hour");
  if (abs < 86_400 * 30) return RELATIVE.format(Math.round(seconds / 86_400), "day");
  return RELATIVE.format(Math.round(seconds / (86_400 * 30)), "month");
}

const PERIOD_SUFFIX: Record<SalaryPeriod, string> = { year: "/yr", month: "/mo", week: "/wk", day: "/day", hour: "/hr" };

export function formatSalary(
  min: number | null,
  max: number | null,
  currency: string | null,
  period: SalaryPeriod | null,
): string | null {
  if (min === null && max === null) return null;
  const format = (value: number) =>
    new Intl.NumberFormat("en", {
      style: currency ? "currency" : "decimal",
      currency: currency ?? undefined,
      notation: value >= 10_000 ? "compact" : "standard",
      // "€85K", not "€85.0K"; keep one decimal only when it says something ("€6.5M").
      maximumFractionDigits: value >= 10_000 && value % (value >= 1_000_000 ? 1_000_000 : 1_000) !== 0 ? 1 : 0,
    }).format(value);
  const range = min !== null && max !== null && min !== max ? `${format(min)}–${format(max)}` : format((min ?? max)!);
  return `${range}${period ? PERIOD_SUFFIX[period] : ""}`;
}

/** Location text, falling back to country codes. (No flag emoji: Windows renders them as letters.) */
export function locationLine(location: string, countryCodes: readonly string[]): string {
  return location || (countryCodes.length ? countryCodes.join(", ") : "Location not listed");
}

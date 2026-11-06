import type { ExperienceLevel, JobCategory, VisaSponsorship, WorkplaceType } from "@orbit/core";
import { BadgeCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { CATEGORY_LABELS, LEVEL_TAGS, WORKPLACE_LABELS } from "@/lib/jobs/format";
import { cn } from "@/lib/utils";

const AVATAR_TONES = [
  "bg-accent-soft text-accent",
  "bg-success-soft text-success",
  "bg-info-soft text-info",
  "bg-warning-soft text-warning",
  "bg-danger-soft text-danger",
];

/** Initials on a stable color picked from the company name (no third-party logo requests). */
export function CompanyAvatar({ company, className }: { company: string; className?: string }) {
  const clean = company.replace(/[^\p{L}\p{N} ]/gu, "").trim();
  const words = clean.split(/\s+/).filter(Boolean);
  const initials = (words.length > 1 ? `${words[0]![0]}${words[1]![0]}` : clean.slice(0, 2)).toUpperCase() || "?";
  let hash = 0;
  for (const char of company) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return (
    <div
      aria-hidden
      className={cn(
        "grid size-11 shrink-0 place-items-center rounded-xl text-sm font-semibold",
        AVATAR_TONES[hash % AVATAR_TONES.length],
        className,
      )}
    >
      {initials}
    </div>
  );
}

interface JobTagsProps {
  level: ExperienceLevel;
  category: JobCategory;
  workplace: WorkplaceType;
  visa?: VisaSponsorship;
  className?: string;
}

export function JobTags({ level, category, workplace, visa, className }: JobTagsProps) {
  const levelTag = LEVEL_TAGS[level];
  const workplaceLabel = WORKPLACE_LABELS[workplace];
  return (
    <div className={cn("flex flex-wrap gap-1.5", className)}>
      <Badge tone={levelTag.tone}>{levelTag.label}</Badge>
      <Badge tone="accent">{CATEGORY_LABELS[category]}</Badge>
      {workplaceLabel ? <Badge>{workplaceLabel}</Badge> : null}
      {visa === "yes" ? (
        <Badge tone="success">
          <BadgeCheck className="size-3" aria-hidden />
          Visa sponsored
        </Badge>
      ) : null}
    </div>
  );
}

import { cn } from "@/lib/utils";

/** "62% match", colored by how well the master resume covers the post. */
export function MatchBadge({ score, className }: { score: number | null; className?: string }) {
  if (score === null) return null;
  const tone =
    score >= 70 ? "bg-success-soft text-success" : score >= 50 ? "bg-warning-soft text-warning" : "bg-surface-2 text-muted";
  return (
    <span
      className={cn("shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums", tone, className)}
      title="How much of what this post asks for your resume shows"
    >
      {score}% match
    </span>
  );
}

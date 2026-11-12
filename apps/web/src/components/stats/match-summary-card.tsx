import { FileText, Target } from "lucide-react";
import Link from "next/link";
import { MatchBadge } from "@/components/discover/match-badge";
import type { MatchSummary } from "@/lib/match-summary.server";
import { cn } from "@/lib/utils";

const TILES = [
  { key: "min80", label: "80%+", hint: "Near-perfect", tone: "text-success" },
  { key: "from70", label: "70–79%", hint: "Strong", tone: "text-success" },
  { key: "from50", label: "50–69%", hint: "Good, tailor first", tone: "text-warning" },
  { key: "below50", label: "Under 50%", hint: "Weak", tone: "text-muted" },
] as const;

/** How many fetched jobs the master resume matches, by score band. */
export function MatchSummaryCard({ summary, failed = false }: { summary: MatchSummary | null; failed?: boolean }) {
  return (
    <section className="mt-6 rounded-2xl border bg-surface p-5 shadow-card" aria-labelledby="matches-title">
      <div className="mb-4 flex items-start gap-3">
        <div className="grid size-9 shrink-0 place-items-center rounded-xl bg-accent-soft text-accent">
          <Target className="size-5" aria-hidden />
        </div>
        <div>
          <h2 id="matches-title" className="text-base font-semibold">
            Job matches
          </h2>
          <p className="text-sm text-muted">
            {summary ? (
              <>
                Scored the newest <span className="tabular-nums">{summary.scored.toLocaleString("en")}</span> of{" "}
                <span className="tabular-nums">{summary.openJobs.toLocaleString("en")}</span> open jobs against your
                resume. Updates every 6 hours and when you save your resume.
              </>
            ) : failed ? (
              "Couldn't score jobs right now. Reload the page to try again."
            ) : (
              "See how many fetched jobs fit you once your resume is saved."
            )}
          </p>
        </div>
      </div>

      {summary ? (
        <>
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {TILES.map((tile) => (
              <div key={tile.key} className="rounded-xl border bg-surface-2/40 p-3">
                <dt className="text-xs font-medium text-muted">{tile.label}</dt>
                <dd className={cn("mt-1 text-2xl font-semibold tabular-nums", tile.tone)}>
                  {summary.buckets[tile.key].toLocaleString("en")}
                </dd>
                <dd className="text-xs text-muted">{tile.hint}</dd>
              </div>
            ))}
          </dl>
          {summary.unscored > 0 ? (
            <p className="mt-2 text-xs text-muted">
              <span className="tabular-nums">{summary.unscored}</span> posts name too few skills to score.
            </p>
          ) : null}

          {summary.top.length > 0 ? (
            <div className="mt-4">
              <h3 className="mb-2 text-sm font-medium">Best matches</h3>
              <ul className="divide-y rounded-xl border">
                {summary.top.map((job) => (
                  <li key={job.id} className="flex items-center justify-between gap-3 px-3 py-2">
                    <span className="min-w-0 truncate text-sm">
                      <span className="font-medium">{job.title}</span>
                      <span className="text-muted"> · {job.company}</span>
                    </span>
                    <MatchBadge score={job.score} />
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <p className="mt-4 text-sm">
            <Link href="/discover" className="font-medium text-accent underline underline-offset-2 hover:decoration-2">
              Open Discover
            </Link>{" "}
            <span className="text-muted">and set the match filter to 70%+ to swipe only your best fits.</span>
          </p>
        </>
      ) : failed ? null : (
        <Link
          href="/resume"
          className="inline-flex h-9 items-center gap-2 rounded-lg bg-accent px-3 text-sm font-medium text-accent-fg hover:opacity-90"
        >
          <FileText className="size-4" aria-hidden />
          Add your resume
        </Link>
      )}
    </section>
  );
}

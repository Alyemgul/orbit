import { feedFiltersToQuery, parseFeedFilters } from "@orbit/core";
import { AlertTriangle, RadioTower } from "lucide-react";
import type { Metadata } from "next";
import { DiscoverView } from "@/components/discover/discover-view";
import { PageHeader } from "@/components/ui/page-header";
import { fetchApplyBudget, fetchFeed, fetchSourceHealth, type SourceHealth } from "@/lib/data.server";
import { demoFeed } from "@/lib/demo";
import { isSupabaseConfigured } from "@/lib/env";
import { timeAgo } from "@/lib/jobs/format";
import { fetchMasterResume } from "@/lib/resume.server";
import { getCurrentUser } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Discover" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function DiscoverPage({ searchParams }: { searchParams: SearchParams }) {
  const filters = parseFeedFilters(await searchParams);
  const live = isSupabaseConfigured();
  const user = live ? await getCurrentUser() : null;

  const [jobs, budget, health, master] =
    live && user
      ? await Promise.all([
          fetchFeed(filters, null),
          fetchApplyBudget(user.id),
          fetchSourceHealth(),
          fetchMasterResume().catch(() => null),
        ])
      : [demoFeed(filters), { used: 0, cap: 15 }, null, null];

  return (
    <>
      {/* Phones skip the header so the deck fits on one screen; screen readers still get the heading. */}
      <h1 className="sr-only md:hidden">Discover</h1>
      <PageHeader
        className="max-md:hidden"
        title="Discover"
        description={live ? "Fresh postings matched to your filters. Swipe right to apply." : "Sample jobs (preview mode). Swipes stay in this tab."}
        actions={health ? <HealthLine health={health} /> : null}
      />
      {/* A new filter set starts a fresh deck. */}
      <DiscoverView
        key={feedFiltersToQuery(filters)}
        initialJobs={jobs}
        filters={filters}
        mode={live ? "live" : "demo"}
        budget={budget}
        master={master?.resume ?? null}
      />
    </>
  );
}

function HealthLine({ health }: { health: SourceHealth }) {
  if (!health.lastRunAt) {
    return <p className="text-xs text-muted">No job fetch in the last 2 days</p>;
  }
  const failing = health.failing.length;
  return (
    <p
      className="inline-flex items-center gap-1.5 text-xs text-muted"
      title={failing ? `Failing: ${health.failing.join(", ")}` : undefined}
    >
      {failing ? (
        <AlertTriangle className="size-3.5 text-warning" aria-hidden />
      ) : (
        <RadioTower className="size-3.5 text-success" aria-hidden />
      )}
      Updated {timeAgo(health.lastRunAt)} · {health.sources - failing}/{health.sources} sources OK
    </p>
  );
}

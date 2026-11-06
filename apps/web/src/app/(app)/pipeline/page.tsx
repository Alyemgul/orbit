import { Flame, Trophy } from "lucide-react";
import type { Metadata } from "next";
import { PipelineBoard } from "@/components/pipeline/board";
import { ActivityHeatmap, summarizeActivity } from "@/components/stats/activity-heatmap";
import { PageHeader } from "@/components/ui/page-header";
import { fetchActivity, fetchPipeline, todayInTimeZone } from "@/lib/data.server";
import { DEMO_PIPELINE, demoActivity } from "@/lib/demo";
import { isSupabaseConfigured } from "@/lib/env";
import { getCurrentUser } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Pipeline" };

export default async function PipelinePage() {
  const live = isSupabaseConfigured();
  const user = live ? await getCurrentUser() : null;

  const [items, activity, today] =
    live && user
      ? await Promise.all([fetchPipeline(), fetchActivity(365), todayInTimeZone()])
      : [DEMO_PIPELINE, demoActivity(365), new Date().toISOString().slice(0, 10)];
  const summary = summarizeActivity(activity, today);

  return (
    <>
      <PageHeader
        title="Pipeline"
        description={
          live
            ? "Every application in one place. Drag cards as you hear back; autopilot moves them too."
            : "Sample pipeline (preview mode). Moves stay in this tab."
        }
      />

      <PipelineBoard initialItems={items} mode={live ? "live" : "demo"} userId={user?.id ?? null} />

      <section className="mt-6 rounded-2xl border bg-surface p-5 shadow-card" aria-labelledby="activity-title">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 id="activity-title" className="text-base font-semibold">
              <span className="tabular-nums">{summary.total}</span> swipes in the past year
            </h2>
            <p className="text-sm text-muted">
              <span className="tabular-nums">{summary.applied}</span> applied · active on{" "}
              <span className="tabular-nums">{summary.activeDays}</span> days
            </p>
          </div>
          <dl className="flex gap-4 text-sm">
            <div className="flex items-center gap-1.5">
              <Flame className="size-4 text-warning" aria-hidden />
              <dt className="text-muted">Streak</dt>
              <dd className="font-semibold tabular-nums">{summary.currentStreak}d</dd>
            </div>
            <div className="flex items-center gap-1.5">
              <Trophy className="size-4 text-accent" aria-hidden />
              <dt className="text-muted">Best</dt>
              <dd className="font-semibold tabular-nums">{summary.longestStreak}d</dd>
            </div>
          </dl>
        </div>
        <ActivityHeatmap days={activity} today={today} />
      </section>
    </>
  );
}

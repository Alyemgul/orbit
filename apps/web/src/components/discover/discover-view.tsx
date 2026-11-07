"use client";

import { feedFiltersToQuery, type FeedCursor, type FeedFilters, type SwipeDecision } from "@orbit/core";
import { Check, Layers, List, RotateCcw, SearchX, Star, X } from "lucide-react";
import { AnimatePresence, LayoutGroup, motion } from "motion/react";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { loadMoreJobs, swipeJob, undoSwipe } from "@/app/(app)/discover/actions";
import { CompanyAvatar, JobTags } from "@/components/job/job-bits";
import { ProgressRing } from "@/components/stats/rings";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { useToast } from "@/components/ui/toast";
import type { FeedJob } from "@/lib/jobs/feed-job";
import { locationLine, timeAgo } from "@/lib/jobs/format";
import { cn } from "@/lib/utils";
import { FilterBar } from "./filter-bar";
import { JobDetailsDialog } from "./job-details-dialog";
import { SwipeCard, type SwipeDirection } from "./swipe-card";

const DECISION: Record<SwipeDirection, SwipeDecision> = { right: "apply", up: "save", left: "skip" };
const PAGE_SIZE = 20;
const REFILL_AT = 5;

interface DiscoverViewProps {
  initialJobs: FeedJob[];
  filters: FeedFilters;
  /** "demo" keeps everything in this tab (preview mode, no backend). */
  mode: "live" | "demo";
  budget: { used: number; cap: number };
}

interface HistoryEntry {
  job: FeedJob;
  decision: SwipeDecision;
}

function cursorOf(job: FeedJob | undefined): FeedCursor | null {
  return job ? { ts: job.postedAt, id: job.id } : null;
}

export function DiscoverView({ initialJobs, filters, mode, budget: initialBudget }: DiscoverViewProps) {
  const router = useRouter();
  const pathname = usePathname();
  const toast = useToast();
  const [pending, startTransition] = useTransition();

  const [queue, setQueue] = useState(initialJobs);
  // A ref, so callbacks held by toasts always undo the latest swipe.
  const history = useRef<HistoryEntry[]>([]);
  const [historyCount, setHistoryCount] = useState(0);
  const [exitDirection, setExitDirection] = useState<SwipeDirection | null>(null);
  const [view, setView] = useState<"deck" | "list">("deck");
  const [details, setDetails] = useState<FeedJob | null>(null);
  const [budget, setBudget] = useState(initialBudget);
  const [exhausted, setExhausted] = useState(mode === "demo" || initialJobs.length < PAGE_SIZE);
  const [loadingMore, setLoadingMore] = useState(false);
  const cursor = useRef<FeedCursor | null>(cursorOf(initialJobs.at(-1)));
  const seen = useRef(new Set(initialJobs.map((job) => job.id)));

  // Keep the deck topped up as it runs low.
  useEffect(() => {
    if (exhausted || loadingMore || queue.length > REFILL_AT) return;
    setLoadingMore(true);
    loadMoreJobs(filters, cursor.current)
      .then((result) => {
        if (!result.ok) {
          toast({ message: result.error, tone: "danger" });
          setExhausted(true);
          return;
        }
        cursor.current = cursorOf(result.data.at(-1)) ?? cursor.current;
        const fresh = result.data.filter((job) => !seen.current.has(job.id));
        for (const job of fresh) seen.current.add(job.id);
        setQueue((current) => [...current, ...fresh]);
        if (result.data.length < PAGE_SIZE) setExhausted(true);
      })
      .finally(() => setLoadingMore(false));
  }, [exhausted, loadingMore, queue.length, filters, toast]);

  const changeFilters = useCallback(
    (next: FeedFilters) => {
      const query = feedFiltersToQuery(next);
      startTransition(() => router.push(query ? `${pathname}?${query}` : pathname, { scroll: false }));
    },
    [pathname, router],
  );

  const setHistory = useCallback((update: (entries: HistoryEntry[]) => HistoryEntry[]) => {
    history.current = update(history.current);
    setHistoryCount(history.current.length);
  }, []);

  const undo = useCallback(async () => {
    const last = history.current.at(-1);
    if (!last) return;
    setHistory((h) => h.slice(0, -1));
    setExitDirection(null);
    setQueue((q) => [last.job, ...q]);
    if (last.decision === "apply") setBudget((b) => ({ ...b, used: Math.max(0, b.used - 1) }));
    if (mode === "live") {
      const result = await undoSwipe(last.job.id);
      if (!result.ok) toast({ message: result.error, tone: "danger" });
    }
  }, [mode, setHistory, toast]);

  const decide = useCallback(
    async (job: FeedJob, direction: SwipeDirection) => {
      let decision = DECISION[direction];
      // The daily cap protects you from mass-applying; extra right swipes are saved instead.
      if (decision === "apply" && budget.used >= budget.cap) {
        decision = "save";
        toast({ message: `Daily cap of ${budget.cap} reached. Saved it for tomorrow instead.` });
      }

      setDetails(null);
      setExitDirection(decision === "save" ? "up" : direction);
      setQueue((q) => q.filter((j) => j.id !== job.id));
      setHistory((h) => [...h.slice(-49), { job, decision }]);
      if (decision === "apply") setBudget((b) => ({ ...b, used: b.used + 1 }));

      let applicationId: string | null = null;
      if (mode === "live") {
        const result = await swipeJob(job.id, decision);
        if (result.ok) applicationId = result.data;
        if (!result.ok) {
          // Put the card back so nothing is silently lost.
          setQueue((q) => [job, ...q]);
          setHistory((h) => h.filter((entry) => entry.job.id !== job.id));
          if (decision === "apply") setBudget((b) => ({ ...b, used: Math.max(0, b.used - 1) }));
          toast({ message: result.error, tone: "danger" });
          return;
        }
      }

      if (decision === "apply") {
        toast({
          message: applicationId
            ? `Queued ${job.company}. Tailor your CV for it, then apply on the posting.`
            : `Queued ${job.company}. Autopilot isn't connected yet, so apply on the posting for now.`,
          tone: "success",
          action: applicationId ? { label: "Tailor CV", href: `/resume/tailor/${applicationId}` } : { label: "Open", href: job.applyUrl },
          durationMs: 5000,
        });
      } else if (decision === "save") {
        toast({ message: `Saved ${job.company} to your pipeline.`, action: { label: "Undo", onClick: () => void undo() } });
      }
    },
    [budget, mode, setHistory, toast, undo],
  );

  // Keyboard: ← skip, ↑ save, → apply, Z or Backspace undo, Enter details.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (target?.closest("input, textarea, select, dialog, [contenteditable]")) return;
      const top = queue[0];
      const key = event.key;
      if ((key === "z" || key === "Z" || key === "Backspace") && history.current.length) {
        event.preventDefault();
        void undo();
        return;
      }
      if (!top || view !== "deck") return;
      const direction: SwipeDirection | null =
        key === "ArrowRight" ? "right" : key === "ArrowLeft" ? "left" : key === "ArrowUp" ? "up" : null;
      if (direction) {
        event.preventDefault();
        void decide(top, direction);
      } else if (key === "Enter" && target === document.body) {
        setDetails(top);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [queue, view, decide, undo]);

  const top = queue[0];
  const capLeft = Math.max(budget.cap - budget.used, 0);

  return (
    <div className="flex flex-col gap-4 md:gap-5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <ProgressRing
            value={budget.used}
            max={Math.max(budget.cap, 1)}
            tone={capLeft === 0 ? "stroke-warning" : "stroke-success"}
            label={`${budget.used} of ${budget.cap} applications used in the last 24 hours`}
          >
            <span className="text-[11px] font-semibold tabular-nums">{budget.used}</span>
          </ProgressRing>
          <div className="text-sm leading-tight">
            <p className="font-medium tabular-nums">
              {budget.used} / {budget.cap} <span className="max-sm:hidden">applies</span> today
            </p>
            <p className="text-xs text-muted max-sm:hidden">{capLeft === 0 ? "Cap reached: right swipes save" : `${capLeft} left in your daily cap`}</p>
          </div>
        </div>
        <div className="flex rounded-lg border bg-surface p-0.5" role="group" aria-label="View">
          {(
            [
              ["deck", Layers, "Deck"],
              ["list", List, "List"],
            ] as const
          ).map(([value, Icon, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={view === value}
              onClick={() => setView(value)}
              className={cn(
                "inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-sm font-medium sm:px-3",
                view === value ? "bg-accent-soft text-accent" : "text-muted hover:text-text",
              )}
            >
              <Icon className="size-4" aria-hidden />
              <span className="max-sm:sr-only">{label}</span>
            </button>
          ))}
        </div>
      </div>

      <FilterBar key={feedFiltersToQuery(filters)} filters={filters} onChange={changeFilters} pending={pending} />

      {queue.length === 0 && !loadingMore ? (
        <Card>
          <EmptyState
            icon={SearchX}
            title={historyCount ? "You're through this deck" : "No jobs match these filters"}
            description={
              historyCount
                ? "New postings arrive every few hours. Widen the filters to keep going."
                : "Try another region or level, or turn on more categories. Internships and new-grad roles are rarer outside hiring season."
            }
          >
            {historyCount ? (
              <button type="button" onClick={() => void undo()} className="text-sm font-medium text-accent hover:underline">
                Undo last swipe
              </button>
            ) : null}
          </EmptyState>
        </Card>
      ) : view === "deck" ? (
        <div className="mx-auto flex w-full max-w-md flex-col items-center gap-5">
          <div className="relative h-[calc(100dvh-27rem)] min-h-[21rem] md:h-[min(32rem,calc(100dvh-25rem))] w-full">
            <AnimatePresence custom={exitDirection} initial={false}>
              {queue.slice(0, 3).map((job, depth) => (
                <SwipeCard
                  key={job.id}
                  job={job}
                  depth={depth}
                  onSwipe={(direction) => void decide(job, direction)}
                  onDetails={() => setDetails(job)}
                />
              ))}
            </AnimatePresence>
            {queue.length === 0 ? (
              <div className="absolute inset-0 grid place-items-center rounded-3xl border border-dashed text-sm text-muted">
                Loading more jobs…
              </div>
            ) : null}
          </div>

          <div className="flex items-center gap-3" aria-label="Decide on this job">
            <RoundButton label="Undo (Z)" onClick={() => void undo()} disabled={!historyCount} size="sm">
              <RotateCcw />
            </RoundButton>
            <RoundButton label="Skip (←)" tone="danger" onClick={() => top && void decide(top, "left")} disabled={!top}>
              <X />
            </RoundButton>
            <RoundButton label="Save (↑)" tone="accent" onClick={() => top && void decide(top, "up")} disabled={!top} size="sm">
              <Star />
            </RoundButton>
            <RoundButton label="Apply (→)" tone="success" onClick={() => top && void decide(top, "right")} disabled={!top}>
              <Check />
            </RoundButton>
          </div>
          <p className="hidden text-xs text-muted md:block">
            <Kbd>←</Kbd> skip · <Kbd>↑</Kbd> save · <Kbd>→</Kbd> apply · <Kbd>Z</Kbd> undo · <Kbd>Enter</Kbd> details
          </p>
        </div>
      ) : (
        <LayoutGroup>
          <ul className="flex flex-col gap-2">
            <AnimatePresence initial={false}>
              {queue.map((job) => (
                <motion.li
                  key={job.id}
                  layout
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, x: 40, transition: { duration: 0.18 } }}
                  className="flex flex-col gap-3 rounded-2xl border bg-surface p-4 sm:flex-row sm:items-center"
                >
                  <button type="button" onClick={() => setDetails(job)} className="flex min-w-0 flex-1 items-start gap-3 text-left">
                    <CompanyAvatar company={job.company} className="size-10" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{job.title}</span>
                      <span className="block truncate text-sm text-muted" suppressHydrationWarning>
                        {job.company} · {locationLine(job.location, job.countryCodes)} · {timeAgo(job.postedAt)}
                      </span>
                      <JobTags
                        className="mt-2"
                        level={job.experienceLevel}
                        category={job.category}
                        workplace={job.workplace}
                        visa={job.visaSponsorship}
                      />
                    </span>
                  </button>
                  <div className="flex shrink-0 justify-end gap-2">
                    <RoundButton label="Skip" tone="danger" size="sm" onClick={() => void decide(job, "left")}>
                      <X />
                    </RoundButton>
                    <RoundButton label="Save" tone="accent" size="sm" onClick={() => void decide(job, "up")}>
                      <Star />
                    </RoundButton>
                    <RoundButton label="Apply" tone="success" size="sm" onClick={() => void decide(job, "right")}>
                      <Check />
                    </RoundButton>
                  </div>
                </motion.li>
              ))}
            </AnimatePresence>
          </ul>
          {loadingMore ? <p className="text-center text-sm text-muted">Loading more jobs…</p> : null}
        </LayoutGroup>
      )}

      <JobDetailsDialog job={details} onClose={() => setDetails(null)} onDecide={(direction) => details && void decide(details, direction)} />
    </div>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return <kbd className="rounded border bg-surface px-1 font-mono">{children}</kbd>;
}

interface RoundButtonProps {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  tone?: "neutral" | "danger" | "accent" | "success";
  size?: "sm" | "md";
  children: React.ReactNode;
}

const ROUND_TONES = {
  neutral: "text-muted hover:text-text",
  danger: "text-danger hover:bg-danger-soft",
  accent: "text-accent hover:bg-accent-soft",
  success: "text-success hover:bg-success-soft",
};

function RoundButton({ label, onClick, disabled, tone = "neutral", size = "md", children }: RoundButtonProps) {
  return (
    <motion.button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      whileTap={{ scale: 0.88 }}
      whileHover={{ scale: 1.06 }}
      transition={{ type: "spring", stiffness: 500, damping: 25 }}
      className={cn(
        "grid place-items-center rounded-full border bg-surface shadow-card transition-colors disabled:opacity-40",
        size === "md" ? "size-14 [&_svg]:size-6" : "size-11 [&_svg]:size-5",
        ROUND_TONES[tone],
      )}
    >
      {children}
    </motion.button>
  );
}

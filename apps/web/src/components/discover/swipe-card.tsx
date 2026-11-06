"use client";

import { ExternalLink, Info } from "lucide-react";
import { motion, useMotionValue, useReducedMotion, useTransform, type PanInfo } from "motion/react";
import { CompanyAvatar, JobTags } from "@/components/job/job-bits";
import type { FeedJob } from "@/lib/jobs/feed-job";
import { locationLine, timeAgo } from "@/lib/jobs/format";
import { cn } from "@/lib/utils";

export type SwipeDirection = "left" | "right" | "up";

const DISTANCE = 110;
const VELOCITY = 650;

interface SwipeCardProps {
  job: FeedJob;
  /** 0 = top card; deeper cards sit smaller and lower. */
  depth: number;
  onSwipe: (direction: SwipeDirection) => void;
  onDetails: () => void;
}

/** Fly-out target for each direction; `custom` comes from AnimatePresence so buttons animate too. */
const exitVariant = (direction: SwipeDirection | null) => ({
  x: direction === "right" ? 560 : direction === "left" ? -560 : 0,
  y: direction === "up" ? -720 : 0,
  rotate: direction === "right" ? 18 : direction === "left" ? -18 : 0,
  opacity: 0,
  transition: { duration: 0.32, ease: [0.32, 0.72, 0, 1] as const },
});

export function SwipeCard({ job, depth, onSwipe, onDetails }: SwipeCardProps) {
  const reduceMotion = useReducedMotion();
  const isTop = depth === 0;
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const rotate = useTransform(x, [-320, 320], reduceMotion ? [0, 0] : [-14, 14]);
  const applyOpacity = useTransform(x, [24, DISTANCE], [0, 1]);
  const skipOpacity = useTransform(x, [-DISTANCE, -24], [1, 0]);
  const saveOpacity = useTransform(y, [-DISTANCE, -24], [1, 0]);

  function handleDragEnd(_: unknown, info: PanInfo) {
    const { offset, velocity } = info;
    if (offset.y < -DISTANCE * 1.1 && Math.abs(offset.x) < DISTANCE) return onSwipe("up");
    if (velocity.y < -VELOCITY && Math.abs(velocity.x) < VELOCITY) return onSwipe("up");
    if (offset.x > DISTANCE || velocity.x > VELOCITY) return onSwipe("right");
    if (offset.x < -DISTANCE || velocity.x < -VELOCITY) return onSwipe("left");
  }


  return (
    <motion.article
      aria-hidden={!isTop}
      aria-label={isTop ? `${job.title} at ${job.company}` : undefined}
      className={cn(
        "absolute inset-0 flex flex-col overflow-hidden rounded-3xl border bg-surface shadow-card select-none",
        isTop ? "cursor-grab touch-none active:cursor-grabbing" : "pointer-events-none",
      )}
      style={{ x, y, rotate, zIndex: 10 - depth }}
      drag={isTop}
      dragConstraints={{ left: 0, right: 0, top: 0, bottom: 0 }}
      dragElastic={0.9}
      onDragEnd={handleDragEnd}
      initial={{ scale: 0.9, y: 28, opacity: 0 }}
      animate={{ scale: 1 - depth * 0.045, y: depth * 14, opacity: depth > 2 ? 0 : 1 }}
      exit="exit"
      variants={{ exit: exitVariant }}
      transition={{ type: "spring", stiffness: 380, damping: 32 }}
    >
      {/* Decision stamps, faded in by drag distance. */}
      <motion.span
        style={{ opacity: applyOpacity }}
        className="pointer-events-none absolute top-6 left-6 z-10 -rotate-12 rounded-lg border-2 border-success px-3 py-1 text-lg font-bold tracking-widest text-success"
      >
        APPLY
      </motion.span>
      <motion.span
        style={{ opacity: skipOpacity }}
        className="pointer-events-none absolute top-6 right-6 z-10 rotate-12 rounded-lg border-2 border-danger px-3 py-1 text-lg font-bold tracking-widest text-danger"
      >
        SKIP
      </motion.span>
      <motion.span
        style={{ opacity: saveOpacity }}
        className="pointer-events-none absolute bottom-24 left-1/2 z-10 -translate-x-1/2 rounded-lg border-2 border-accent px-3 py-1 text-lg font-bold tracking-widest text-accent"
      >
        SAVE
      </motion.span>

      <div className="flex items-center gap-3 p-5 pb-3">
        <CompanyAvatar company={job.company} />
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium">{job.company}</p>
          <p className="text-xs text-muted" suppressHydrationWarning>
            {job.postedAtKnown ? `Posted ${timeAgo(job.postedAt)}` : `Found ${timeAgo(job.postedAt)}`}
          </p>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-3 px-5">
        <h2 className="line-clamp-3 text-xl leading-snug font-semibold tracking-tight">{job.title}</h2>
        <p className="text-sm text-muted">{locationLine(job.location, job.countryCodes)}</p>
        {job.salaryText ? <p className="text-sm font-medium tabular-nums">{job.salaryText}</p> : null}
        <JobTags level={job.experienceLevel} category={job.category} workplace={job.workplace} visa={job.visaSponsorship} />
        <div className="relative min-h-0 flex-1 overflow-hidden">
          <p className="text-sm leading-relaxed whitespace-pre-line text-muted">{job.description || "No description provided."}</p>
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-surface to-transparent" />
        </div>
      </div>

      <div className="flex items-center justify-between gap-2 border-t px-5 py-3">
        <button
          type="button"
          tabIndex={isTop ? 0 : -1}
          onClick={onDetails}
          onPointerDownCapture={(event) => event.stopPropagation()}
          className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm font-medium text-accent hover:bg-accent-soft"
        >
          <Info className="size-4" aria-hidden />
          Details
        </button>
        <a
          href={job.applyUrl}
          target="_blank"
          rel="noopener noreferrer"
          tabIndex={isTop ? 0 : -1}
          onPointerDownCapture={(event) => event.stopPropagation()}
          className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm text-muted hover:bg-surface-2 hover:text-text"
        >
          Open posting
          <ExternalLink className="size-3.5" aria-hidden />
        </a>
      </div>
    </motion.article>
  );
}

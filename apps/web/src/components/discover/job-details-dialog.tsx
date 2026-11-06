"use client";

import { Check, ExternalLink, Star, X } from "lucide-react";
import { useEffect, useRef } from "react";
import { CompanyAvatar, JobTags } from "@/components/job/job-bits";
import { Button, buttonVariants } from "@/components/ui/button";
import type { FeedJob } from "@/lib/jobs/feed-job";
import { locationLine, timeAgo } from "@/lib/jobs/format";
import { cn } from "@/lib/utils";
import type { SwipeDirection } from "./swipe-card";

interface JobDetailsDialogProps {
  job: FeedJob | null;
  onClose: () => void;
  onDecide: (direction: SwipeDirection) => void;
}

/** Full posting in a native modal dialog (focus trap and Escape come for free). */
export function JobDetailsDialog({ job, onClose, onDecide }: JobDetailsDialogProps) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (job && !dialog.open) dialog.showModal();
    if (!job && dialog.open) dialog.close();
  }, [job]);


  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(event) => {
        if (event.target === ref.current) onClose();
      }}
      aria-labelledby="job-details-title"
      className="m-auto mb-0 max-h-[90dvh] w-full max-w-2xl rounded-t-3xl border bg-surface p-0 text-text shadow-card backdrop:bg-black/50 backdrop:backdrop-blur-sm sm:mb-auto sm:rounded-3xl"
    >
      {job ? (
        <div className="flex max-h-[90dvh] flex-col">
          <header className="flex items-start gap-3 border-b p-5">
            <CompanyAvatar company={job.company} />
            <div className="min-w-0 flex-1">
              <p className="text-sm text-muted">
                {job.company} · {job.postedAtKnown ? "posted" : "found"} {timeAgo(job.postedAt)}
              </p>
              <h2 id="job-details-title" className="mt-0.5 text-lg leading-snug font-semibold">
                {job.title}
              </h2>
              <p className="mt-1 text-sm text-muted">{locationLine(job.location, job.countryCodes)}</p>
              {job.salaryText ? <p className="mt-1 text-sm font-medium tabular-nums">{job.salaryText}</p> : null}
              <JobTags
                className="mt-3"
                level={job.experienceLevel}
                category={job.category}
                workplace={job.workplace}
                visa={job.visaSponsorship}
              />
            </div>
            <Button variant="ghost" size="icon" aria-label="Close" onClick={onClose}>
              <X />
            </Button>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto p-5">
            <p className="text-sm leading-relaxed whitespace-pre-line">{job.description || "No description provided."}</p>
          </div>
          <footer className="flex flex-wrap items-center gap-2 border-t p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
            <a
              href={job.applyUrl}
              target="_blank"
              rel="noopener noreferrer"
              className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "mr-auto")}
            >
              Open posting <ExternalLink />
            </a>
            <Button variant="secondary" size="sm" onClick={() => onDecide("left")}>
              <X /> Skip
            </Button>
            <Button variant="secondary" size="sm" onClick={() => onDecide("up")}>
              <Star /> Save
            </Button>
            <Button size="sm" onClick={() => onDecide("right")}>
              <Check /> Apply
            </Button>
          </footer>
        </div>
      ) : null}
    </dialog>
  );
}

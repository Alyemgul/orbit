"use client";

import {
  analyzeJob,
  isResumeEmpty,
  tailorResume,
  type DiffPart,
  type LineChange,
  type Resume,
} from "@orbit/core";
import { AlertTriangle, ArrowLeft, Check, Download, ExternalLink, RotateCcw, Save, ShieldCheck, Sparkles } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { rewriteWithAi, saveTailoredVersion } from "@/app/(app)/resume/actions";
import { ProgressRing } from "@/components/stats/rings";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { useToast } from "@/components/ui/toast";
import { loadDemoResume } from "@/lib/demo-resume";
import { timeAgo } from "@/lib/jobs/format";
import type { SavedVersion, TailorJob } from "@/lib/resume.server";
import { downloadResumePdf } from "@/lib/download-pdf";
import { cn } from "@/lib/utils";
import { PrintableResume, ResumeDocument } from "./resume-document";

interface TailorViewProps {
  mode: "live" | "demo";
  applicationId: string;
  job: TailorJob;
  master: Resume | null;
  latest: SavedVersion | null;
  /** Provider name when AI rewriting is configured, else null. */
  aiLabel: string | null;
  aiUsage: { used: number; limit: number } | null;
}

export function TailorView({ mode, applicationId, job, master: initialMaster, latest, aiLabel, aiUsage }: TailorViewProps) {
  const toast = useToast();
  const [master, setMaster] = useState(initialMaster);
  const [rewrites, setRewrites] = useState<Record<string, string>>(latest?.inputs.rewrites ?? {});
  const [summary, setSummary] = useState<string | null>(latest?.inputs.summary ?? null);
  const [declined, setDeclined] = useState<Set<string>>(new Set());
  const [hidden, setHidden] = useState<Set<string>>(new Set(latest?.inputs.hidden ?? []));
  const [source, setSource] = useState<"rules" | "ai">(latest?.source ?? "rules");
  const [busy, setBusy] = useState<"ai" | "save" | null>(null);
  const [saved, setSaved] = useState(latest);
  const [dirty, setDirty] = useState(!latest);
  const [view, setView] = useState<"changes" | "preview">("changes");
  const [used, setUsed] = useState(aiUsage?.used ?? 0);

  useEffect(() => {
    if (mode === "demo") setMaster(loadDemoResume());
  }, [mode]);

  const analysis = useMemo(() => analyzeJob(job.title, job.description), [job]);
  const result = useMemo(() => {
    if (!master) return null;
    const accepted = Object.fromEntries(Object.entries(rewrites).filter(([id]) => !declined.has(id)));
    return tailorResume(master, analysis, {
      rewrites: accepted,
      summary: declined.has("summary") ? null : summary,
      hidden: [...hidden],
    });
  }, [master, analysis, rewrites, summary, declined, hidden]);

  if (!master || isResumeEmpty(master) || !result) {
    return (
      <EmptyState
        icon={Sparkles}
        title="Add your master resume first"
        description="Tailoring starts from your master resume: it reorders and rewords what you wrote, and never adds anything."
      >
        <Link href="/resume" className="text-sm font-medium text-accent underline underline-offset-2 hover:decoration-2">Go to Resume</Link>
      </EmptyState>
    );
  }

  async function runAi(fresh = false) {
    setBusy("ai");
    const response = await rewriteWithAi(applicationId, fresh);
    setBusy(null);
    if (!response.ok) return toast({ message: response.error, tone: "danger" });
    const count = Object.keys(response.data.rewrites).length + (response.data.summary ? 1 : 0);
    setRewrites(response.data.rewrites);
    setSummary(response.data.summary);
    setDeclined(new Set());
    setSource("ai");
    setDirty(true);
    if (!response.data.cached) setUsed((n) => n + 1);
    const what = count ? `${count} rewordings, each fact-checked` : "no changes";
    toast({
      message: response.data.cached
        ? `Loaded earlier suggestions (${what}). No quota used.`
        : `${aiLabel} (${response.data.model}) suggested ${what}.`,
      tone: "success",
      ...(response.data.cached ? { action: { label: "Ask again", onClick: () => void runAi(true) } } : {}),
    });
  }

  async function save() {
    if (mode === "demo") return toast({ message: "Preview mode: versions aren't saved. Sign in to keep them." });
    setBusy("save");
    const accepted = Object.fromEntries(Object.entries(rewrites).filter(([id]) => !declined.has(id)));
    const response = await saveTailoredVersion(applicationId, {
      rewrites: accepted,
      summary: declined.has("summary") ? null : summary,
      hidden: [...hidden],
      source,
    });
    setBusy(null);
    if (!response.ok) return toast({ message: response.error, tone: "danger" });
    setDirty(false);
    setSaved({ id: response.data.id, createdAt: new Date().toISOString(), matchScore: response.data.score, source, inputs: { rewrites: accepted, summary, hidden: [...hidden] }, outdated: false });
    toast({ message: "Version saved. It's attached to this application.", tone: "success", action: { label: "Pipeline", href: "/pipeline" } });
  }

  const toggleHidden = (id: string) => {
    setHidden((all) => {
      const next = new Set(all);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setDirty(true);
  };
  const toggleDeclined = (id: string) => {
    setDeclined((all) => {
      const next = new Set(all);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setDirty(true);
  };

  const { before, after } = result;
  const changesById = new Map(result.changes.map((c) => [c.id, c]));
  const rewritten = result.changes.filter((c) => c.status === "rewritten").length;
  const blocked = result.changes.filter((c) => c.status === "reverted").length;
  const aiLeft = aiUsage ? Math.max(0, aiUsage.limit - used) : null;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
        <Link href="/pipeline" className="inline-flex items-center gap-1 text-muted hover:text-text">
          <ArrowLeft className="size-4" aria-hidden /> Pipeline
        </Link>
        <a href={job.applyUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-muted hover:text-text">
          Posting <ExternalLink className="size-3.5" aria-hidden />
        </a>
        {saved ? (
          <span className="ml-auto text-xs text-muted" suppressHydrationWarning>
            {dirty ? "Unsaved changes" : `Saved ${timeAgo(saved.createdAt)}`}
          </span>
        ) : null}
      </div>

      {saved?.outdated && !dirty ? (
        <p className="flex items-start gap-2 rounded-xl border border-warning/40 bg-warning-soft p-3 text-sm text-warning">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
          Your master resume changed after this version was saved. Save again to bring it up to date.
        </p>
      ) : null}

      <section className="grid gap-4 rounded-2xl border bg-surface p-4 shadow-card sm:p-5 md:grid-cols-[auto_minmax(0,1fr)]" aria-label="Match">
        <div className="flex items-center gap-4">
          <ScoreRing label="Master" score={before.score} muted />
          <ScoreRing label="Tailored" score={after.score} />
        </div>
        <div className="min-w-0">
          <h2 className="text-base font-semibold">{job.title}</h2>
          <p className="text-sm text-muted">{[job.company, job.location].filter(Boolean).join(" · ")}</p>
          <KeywordChips matched={after.matched.map((k) => k.label)} missing={after.missing.filter((k) => !k.optional).map((k) => k.label)}
            optional={after.missing.filter((k) => k.optional).map((k) => k.label)} />
        </div>
      </section>

      <div className="flex flex-wrap items-center gap-2">
        <div role="tablist" aria-label="View" className="flex rounded-lg border bg-surface p-0.5">
          {(["changes", "preview"] as const).map((key) => (
            <button key={key} role="tab" type="button" aria-selected={view === key} onClick={() => setView(key)}
              className={cn("h-8 rounded-md px-3 text-sm font-medium", view === key ? "bg-accent-soft text-accent" : "text-muted hover:text-text")}>
              {key === "changes" ? "Changes" : "Preview"}
            </button>
          ))}
        </div>
        <Button variant="secondary" size="sm" onClick={() => void runAi()} disabled={!aiLabel || busy !== null || mode === "demo" || aiLeft === 0}
          title={!aiLabel ? "Set GROQ_API_KEY and/or GEMINI_API_KEY to turn on AI rewording (free providers)" : undefined}>
          <Sparkles /> {busy === "ai" ? "Rewording…" : aiLabel ? `Reword with ${aiLabel}` : "AI rewording off"}
        </Button>
        {aiLeft !== null && aiLabel ? <span className="text-xs text-muted">{aiLeft} left today</span> : null}
        <Button variant="ghost" size="sm" onClick={() => void downloadResumePdf(result.resume)} title="Download the exact PDF the autopilot uploads">
          <Download /> PDF
        </Button>
        <Button size="sm" className="ml-auto" onClick={save} disabled={busy !== null || (!dirty && Boolean(saved))}>
          <Save /> {busy === "save" ? "Saving…" : "Save version"}
        </Button>
      </div>

      <p className="flex items-start gap-2 text-xs text-muted">
        <ShieldCheck className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
        <span>
          Reordered by what this job asks for{rewritten ? `, ${rewritten} line${rewritten > 1 ? "s" : ""} reworded` : ""}.
          {blocked ? ` ${blocked} suggestion${blocked > 1 ? "s were" : " was"} blocked for adding facts you didn't write.` : " Nothing new was added."}
        </span>
      </p>

      {view === "preview" ? (
        <div className="overflow-x-auto rounded-2xl border shadow-card">
          <ResumeDocument resume={result.resume} className="mx-auto max-w-[210mm] max-sm:px-5 max-sm:py-6" />
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {changesById.get("summary") ? (
            <EntryCard title="Summary">
              <LineRow change={changesById.get("summary")!} suggestion={summary} declined={declined.has("summary")} onDecline={() => toggleDeclined("summary")} />
            </EntryCard>
          ) : null}
          {master.sections.map((section) =>
            section.entries.filter((e) => e.bullets.some((b) => b.text)).map((entry) => {
              const tailored = result.resume.sections.find((s) => s.id === section.id)?.entries.find((e) => e.id === entry.id);
              const order = [...(tailored?.bullets.map((b) => b.id) ?? []), ...entry.bullets.filter((b) => hidden.has(b.id)).map((b) => b.id)];
              return (
                <EntryCard key={entry.id} title={[entry.title, entry.org].filter(Boolean).join(" · ")} kicker={section.title}>
                  {order.map((id, position) => {
                    const change = changesById.get(id);
                    if (!change) return null;
                    // Compare against the original order of the lines still shown.
                    const originalIndex = entry.bullets.filter((b) => b.text && !hidden.has(b.id)).findIndex((b) => b.id === id);
                    return (
                      <LineRow key={id} change={change} suggestion={rewrites[id] ?? null} declined={declined.has(id)} onDecline={() => toggleDeclined(id)}
                        onToggleHidden={() => toggleHidden(id)} movedUp={!change.hidden && position < originalIndex} />
                    );
                  })}
                </EntryCard>
              );
            }),
          )}
        </div>
      )}
      <PrintableResume resume={result.resume} />
    </div>
  );
}

function ScoreRing({ label, score, muted }: { label: string; score: number | null; muted?: boolean }) {
  const tone = muted ? "stroke-muted" : score === null ? "stroke-muted" : score >= 70 ? "stroke-success" : score >= 45 ? "stroke-warning" : "stroke-danger";
  return (
    <div className="flex flex-col items-center gap-1">
      <ProgressRing value={score ?? 0} max={100} size={72} stroke={7} tone={tone} label={`${label} match ${score ?? "unknown"}`}>
        <span className="text-lg font-semibold tabular-nums">{score === null ? "–" : `${score}`}</span>
      </ProgressRing>
      <span className="text-xs text-muted">{label}</span>
    </div>
  );
}

function KeywordChips({ matched, missing, optional }: { matched: string[]; missing: string[]; optional: string[] }) {
  if (!matched.length && !missing.length && !optional.length) {
    return <p className="mt-3 text-sm text-muted">This post doesn't name specific skills, so there's no keyword score.</p>;
  }
  return (
    <div className="mt-3 flex flex-col gap-2">
      <div className="flex flex-wrap gap-1.5" aria-label="Skills you have">
        {matched.map((k) => (
          <Badge key={k} tone="success"><Check className="size-3" aria-hidden /> {k}</Badge>
        ))}
        {missing.map((k) => (
          <Badge key={k} tone="danger">{k}</Badge>
        ))}
        {optional.map((k) => (
          <Badge key={k} title="Nice to have">{k}</Badge>
        ))}
      </div>
      {missing.length ? (
        <p className="text-xs text-muted">
          Red means the post asks for it and your resume doesn't say it. If you really have it, add it to your{" "}
          <Link href="/resume" className="text-accent underline underline-offset-2 hover:decoration-2">master resume</Link>. Orbit won't add it for you.
        </p>
      ) : null}
    </div>
  );
}

function EntryCard({ title, kicker, children }: { title: string; kicker?: string; children: ReactNode }) {
  return (
    <section className="rounded-2xl border bg-surface p-4 shadow-card">
      {kicker ? <p className="text-[11px] font-medium tracking-wide text-muted uppercase">{kicker}</p> : null}
      <h3 className="mb-2 text-sm font-semibold">{title}</h3>
      <ul className="flex flex-col divide-y">{children}</ul>
    </section>
  );
}

function LineRow({ change, suggestion, declined, onDecline, onToggleHidden, movedUp }: {
  change: LineChange;
  /** The proposed wording, kept while the user chose the original. */
  suggestion: string | null;
  declined: boolean;
  onDecline: () => void;
  onToggleHidden?: () => void;
  movedUp?: boolean;
}) {
  const canRestore = declined && Boolean(suggestion) && suggestion !== change.before;
  return (
    <li className={cn("flex flex-col gap-1.5 py-2.5", change.hidden && "opacity-50")}>
      <div className="flex items-start gap-2">
        {onToggleHidden ? (
          <input type="checkbox" checked={!change.hidden} onChange={onToggleHidden} aria-label={change.hidden ? "Include this line" : "Leave this line out"}
            className="mt-1 size-4 shrink-0 accent-[var(--accent)]" />
        ) : null}
        <p className={cn("min-w-0 flex-1 text-sm leading-relaxed", change.hidden && "line-through")}>
          {change.status === "rewritten" ? <DiffText parts={change.diff} /> : change.after}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-1.5 pl-6">
        {change.status === "rewritten" ? <Badge tone="info">Reworded</Badge> : null}
        {change.status === "reverted" ? <Badge tone="danger">Kept original</Badge> : null}
        {canRestore ? <Badge>Using original</Badge> : null}
        {movedUp ? <Badge tone="accent">Moved up</Badge> : null}
        {change.status === "rewritten" ? (
          <button type="button" onClick={onDecline} className="inline-flex items-center gap-1 text-xs text-muted hover:text-text">
            <RotateCcw className="size-3" aria-hidden /> Use original
          </button>
        ) : null}
        {canRestore ? (
          <button type="button" onClick={onDecline} className="inline-flex items-center gap-1 text-xs text-muted hover:text-text">
            <Sparkles className="size-3" aria-hidden /> Use suggestion
          </button>
        ) : null}
      </div>
      {change.issues.length ? (
        <ul className="flex flex-col gap-0.5 pl-6">
          {change.issues.map((issue, i) => (
            <li key={i} className={cn("flex items-start gap-1 text-xs", issue.severity === "error" ? "text-danger" : "text-warning")}>
              <AlertTriangle className="mt-0.5 size-3 shrink-0" aria-hidden />
              {issue.detail}
            </li>
          ))}
        </ul>
      ) : null}
      {change.status === "reverted" && change.proposed ? (
        <p className="pl-6 text-xs text-muted">
          Blocked suggestion: <span className="italic">{change.proposed}</span>
        </p>
      ) : null}
    </li>
  );
}

function DiffText({ parts }: { parts: DiffPart[] }) {
  return (
    <>
      {parts.map((part, i) =>
        part.type === "same" ? (
          <span key={i}>{part.text}</span>
        ) : part.type === "added" ? (
          <ins key={i} className="rounded-sm bg-success-soft text-success no-underline">{part.text}</ins>
        ) : (
          <del key={i} className="rounded-sm bg-danger-soft text-danger/80">{part.text}</del>
        ),
      )}
    </>
  );
}

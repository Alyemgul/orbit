"use client";

import { emptyResume, resumeHealth, resumeSchema, type Resume } from "@orbit/core";
import { Download, Eye, FileUp, PencilLine, Save, Sparkles } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type Ref } from "react";
import { saveMasterResume } from "@/app/(app)/resume/actions";
import { ProgressRing } from "@/components/stats/rings";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { loadDemoResume, saveDemoResume } from "@/lib/demo-resume";
import { timeAgo } from "@/lib/jobs/format";
import type { VersionListItem } from "@/lib/resume.server";
import { downloadResumePdf } from "@/lib/download-pdf";
import { cn } from "@/lib/utils";
import { PrintableResume, ResumeDocument } from "./resume-document";
import { ImportDialog } from "./import-dialog";
import { ResumeEditor } from "./resume-editor";

interface ResumeWorkspaceProps {
  mode: "live" | "demo";
  initial: Resume | null;
  updatedAt: string | null;
  versions: VersionListItem[];
}

export function ResumeWorkspace({ mode, initial, updatedAt, versions }: ResumeWorkspaceProps) {
  const toast = useToast();
  const [resume, setResume] = useState<Resume>(() => initial ?? emptyResume());
  const [savedAt, setSavedAt] = useState(updatedAt);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState<"edit" | "preview">("edit");
  const importRef = useRef<HTMLDialogElement>(null);

  // Preview mode keeps the resume in this browser only.
  useEffect(() => {
    if (mode === "demo") setResume(loadDemoResume());
  }, [mode]);

  const update = useCallback((mutate: (draft: Resume) => void) => {
    setResume((previous) => {
      const next = structuredClone(previous);
      mutate(next);
      return next;
    });
    setDirty(true);
  }, []);

  const save = useCallback(async () => {
    const parsed = resumeSchema.safeParse(resume);
    if (!parsed.success) {
      toast({ message: "Some fields are too long. Shorten them and try again.", tone: "danger" });
      return;
    }
    setSaving(true);
    if (mode === "demo") {
      const ok = saveDemoResume(parsed.data);
      setSaving(false);
      if (ok) {
        setDirty(false);
        setSavedAt(new Date().toISOString());
        toast({ message: "Saved in this browser (preview mode).", tone: "success" });
      } else toast({ message: "This browser blocked local storage.", tone: "danger" });
      return;
    }
    const result = await saveMasterResume(parsed.data);
    setSaving(false);
    if (result.ok) {
      setDirty(false);
      setSavedAt(result.data.updatedAt);
      toast({ message: "Master resume saved.", tone: "success" });
    } else toast({ message: result.error, tone: "danger" });
  }, [mode, resume, toast]);

  // Ctrl/Cmd+S saves; leaving with unsaved edits asks first.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void save();
      }
    };
    const onLeave = (event: BeforeUnloadEvent) => {
      if (dirty) event.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("beforeunload", onLeave);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("beforeunload", onLeave);
    };
  }, [dirty, save]);

  const health = resumeHealth(resume);

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_18rem]">
      <div className="min-w-0">
        <div className="sticky top-0 z-10 -mx-1 mb-4 flex flex-wrap items-center gap-2 bg-bg/90 px-1 py-2 backdrop-blur">
          <div role="tablist" aria-label="View" className="flex rounded-lg border bg-surface p-0.5">
            {(["edit", "preview"] as const).map((key) => (
              <button key={key} role="tab" type="button" aria-selected={tab === key} onClick={() => setTab(key)}
                className={cn("inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-sm font-medium",
                  tab === key ? "bg-accent-soft text-accent" : "text-muted hover:text-text")}>
                {key === "edit" ? <PencilLine className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />}
                {key === "edit" ? "Edit" : "Preview"}
              </button>
            ))}
          </div>
          <Button variant="ghost" size="sm" onClick={() => importRef.current?.showModal()}>
            <FileUp /> Import
          </Button>
          <Button variant="ghost" size="sm" onClick={() => void downloadResumePdf(resume)} title="Download the exact PDF the autopilot uploads">
            <Download /> PDF
          </Button>
          <span className="ml-auto text-xs text-muted" aria-live="polite" suppressHydrationWarning>
            {dirty ? "Unsaved changes" : savedAt ? `Saved ${timeAgo(savedAt)}` : "Not saved yet"}
          </span>
          <Button size="sm" onClick={save} disabled={saving || !dirty}>
            <Save /> {saving ? "Saving…" : "Save"}
          </Button>
        </div>

        {tab === "edit" ? (
          <ResumeEditor resume={resume} update={update} />
        ) : (
          <div className="overflow-x-auto rounded-2xl border shadow-card">
            <ResumeDocument resume={resume} className="mx-auto max-w-[210mm] max-sm:px-5 max-sm:py-6" />
          </div>
        )}
      </div>

      <aside aria-label="Resume health and tailored versions" className="flex flex-col gap-4">
        <section className="rounded-2xl border bg-surface p-4 shadow-card" aria-labelledby="health-title">
          <div className="flex items-center gap-3">
            <ProgressRing value={health.score} max={100} size={56} stroke={6} label={`Resume health ${health.score} of 100`}
              tone={health.score >= 75 ? "stroke-success" : health.score >= 45 ? "stroke-warning" : "stroke-danger"}>
              <span className="text-sm font-semibold tabular-nums">{health.score}</span>
            </ProgressRing>
            <div>
              <h2 id="health-title" className="text-sm font-semibold">Resume health</h2>
              <p className="text-xs text-muted">{health.bullets} bullets · {health.skills} skills</p>
            </div>
          </div>
          <ul className="mt-3 flex flex-col gap-1.5 text-xs">
            {health.checks.map((check) => (
              <li key={check.label} className="flex items-start gap-2">
                <span className={cn("mt-1 size-1.5 shrink-0 rounded-full", check.ok ? "bg-success" : "bg-warning")} aria-hidden />
                <span className={check.ok ? "text-muted" : "text-text"}>{check.label}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className="rounded-2xl border bg-surface p-4 shadow-card" aria-labelledby="versions-title">
          <h2 id="versions-title" className="flex items-center gap-1.5 text-sm font-semibold">
            <Sparkles className="size-4 text-accent" aria-hidden /> Tailored versions
          </h2>
          {versions.length ? (
            <ul className="mt-2 flex flex-col divide-y">
              {versions.map((v) => (
                <li key={v.id}>
                  <Link href={`/resume/tailor/${v.applicationId}`} className="flex items-center gap-2 py-2 hover:text-accent">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm">{v.title}</span>
                      <span className="block truncate text-xs text-muted" suppressHydrationWarning>
                        {v.company} · {timeAgo(v.createdAt)}{v.source === "ai" ? " · AI" : ""}
                      </span>
                    </span>
                    {v.matchScore !== null ? <span className="text-sm font-semibold tabular-nums">{Math.round(v.matchScore)}%</span> : null}
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-1 text-xs text-muted">
              None yet. Open a job in your <Link href="/pipeline" className="text-accent underline underline-offset-2 hover:decoration-2">Pipeline</Link> and choose Tailor CV.
            </p>
          )}
        </section>
      </aside>

      <ImportDialog
        ref={importRef}
        onImport={(next) => {
          setResume(next);
          setDirty(true);
          setTab("edit");
          toast({ message: "Imported. Check each section, then Save.", tone: "success" });
        }}
      />
      <PrintableResume resume={resume} />
    </div>
  );
}


"use client";

import { fromJsonResume, parseResumeText, resumeSchema, type Resume } from "@orbit/core";
import { AlertTriangle, CheckCircle2, FileUp, Loader2 } from "lucide-react";
import { useRef, useState, type DragEvent, type Ref } from "react";
import { Button } from "@/components/ui/button";
import { extractResumeText, RESUME_FILE_ACCEPT, ResumeFileError } from "@/lib/resume-file";
import { cn } from "@/lib/utils";

type Step = { kind: "pick" } | { kind: "reading"; name: string } | { kind: "review"; resume: Resume; source: string };

/** Turns pasted or extracted text (or JSON) into a resume. */
function readResumeInput(input: string): Resume {
  const trimmed = input.trim();
  if (trimmed.startsWith("{")) {
    let data: unknown;
    try {
      data = JSON.parse(trimmed);
    } catch {
      throw new ResumeFileError("That looks like JSON but has a syntax error. Check for a missing comma or bracket.");
    }
    // Orbit's own format first (a backup from this app), then every other resume JSON.
    const own = resumeSchema.safeParse(data);
    const resume = own.success && own.data.sections.length + own.data.skills.length > 0 ? own.data : fromJsonResume(data);
    if (!resume) throw new ResumeFileError("No resume found in that JSON (no name, sections or skills).");
    return resume;
  }
  return parseResumeText(trimmed);
}

export function ImportDialog({ ref, onImport }: { ref: Ref<HTMLDialogElement>; onImport: (resume: Resume) => void }) {
  const [step, setStep] = useState<Step>({ kind: "pick" });
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const reset = () => {
    setStep({ kind: "pick" });
    setError(null);
    setText("");
    if (fileInput.current) fileInput.current.value = "";
  };

  async function readFile(file: File) {
    setError(null);
    setStep({ kind: "reading", name: file.name });
    try {
      const { text: extracted } = await extractResumeText(file);
      setStep({ kind: "review", resume: readResumeInput(extracted), source: file.name });
    } catch (e) {
      setStep({ kind: "pick" });
      setError(e instanceof ResumeFileError ? e.message : "That file couldn't be read. Try a PDF export, or paste the text below.");
    }
  }

  function readPasted() {
    if (!text.trim()) return setError("Paste your resume text or JSON first.");
    try {
      setError(null);
      setStep({ kind: "review", resume: readResumeInput(text), source: "pasted text" });
    } catch (e) {
      setError(e instanceof Error ? e.message : "That couldn't be read.");
    }
  }

  function onDrop(event: DragEvent) {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files[0];
    if (file) void readFile(file);
  }

  return (
    <dialog
      ref={ref}
      aria-labelledby="import-title"
      onClose={reset}
      className="m-auto w-[min(40rem,calc(100vw-2rem))] rounded-2xl border bg-surface p-0 text-text shadow-card backdrop:bg-black/50"
    >
      <div className="flex max-h-[85dvh] flex-col gap-4 overflow-y-auto p-5">
        <div>
          <h2 id="import-title" className="text-base font-semibold">
            Import your resume
          </h2>
          <p className="text-sm text-muted">
            PDF, Word (.docx), text or JSON. The file is read in your browser; nothing is sent anywhere until you press Save.
          </p>
        </div>

        {step.kind === "review" ? (
          <Review
            resume={step.resume}
            source={step.source}
            onBack={reset}
            onUse={() => {
              onImport(step.resume);
              (ref as { current: HTMLDialogElement | null } | null)?.current?.close();
            }}
          />
        ) : (
          <>
            <label
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
              className={cn(
                "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-4 py-8 text-center transition-colors",
                dragging ? "border-accent bg-accent-soft" : "hover:border-accent hover:bg-surface-2",
              )}
            >
              {step.kind === "reading" ? (
                <>
                  <Loader2 className="size-7 animate-spin text-accent" aria-hidden />
                  <span className="text-sm font-medium">Reading {step.name}…</span>
                </>
              ) : (
                <>
                  <FileUp className="size-7 text-accent" aria-hidden />
                  <span className="text-sm font-medium">Drop your CV here, or click to choose a file</span>
                  <span className="text-xs text-muted">PDF · DOCX · TXT · JSON, up to 10 MB</span>
                </>
              )}
              <input
                ref={fileInput}
                type="file"
                accept={RESUME_FILE_ACCEPT}
                className="sr-only"
                disabled={step.kind === "reading"}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void readFile(file);
                }}
              />
            </label>

            {error ? (
              <p role="alert" className="flex gap-2 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
                {error}
              </p>
            ) : null}

            <details className="rounded-xl border">
              <summary className="cursor-pointer px-3 py-2 text-sm font-medium">Or paste text / JSON instead</summary>
              <div className="flex flex-col gap-2 border-t p-3">
                <textarea
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  rows={10}
                  maxLength={60_000}
                  aria-label="Resume text or JSON"
                  className="w-full rounded-lg border bg-bg p-3 font-mono text-xs leading-relaxed"
                  placeholder={"Alex Novak\nalex@example.com | github.com/alex\n\nEducation\n…"}
                />
                <div className="flex justify-end">
                  <Button size="sm" onClick={readPasted}>
                    Read it
                  </Button>
                </div>
              </div>
            </details>

            <div className="flex justify-end">
              <Button variant="ghost" onClick={() => (ref as { current: HTMLDialogElement | null } | null)?.current?.close()}>
                Cancel
              </Button>
            </div>
          </>
        )}
      </div>
    </dialog>
  );
}

function Review({ resume, source, onBack, onUse }: { resume: Resume; source: string; onBack: () => void; onUse: () => void }) {
  const bullets = resume.sections.reduce((n, s) => n + s.entries.reduce((m, e) => m + e.bullets.length, 0), 0);
  const skills = resume.skills.reduce((n, g) => n + g.items.length, 0);
  const warnings = [
    !resume.basics.name && "No name found.",
    !resume.basics.email && "No email found.",
    resume.sections.length === 0 && "No sections (experience, education, projects) were recognised.",
    resume.sections.length > 0 && bullets === 0 && "No bullet points were found.",
    skills === 0 && "No skills list was found.",
  ].filter((w): w is string => Boolean(w));

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-xl border p-4">
        <p className="text-xs text-muted">Found in {source}</p>
        <p className="mt-1 font-semibold">{resume.basics.name || "(no name)"}</p>
        <p className="text-sm text-muted">{[resume.basics.headline, resume.basics.email, resume.basics.location].filter(Boolean).join(" · ") || "No contact details"}</p>
        {resume.summary ? <p className="mt-2 line-clamp-2 text-sm">{resume.summary}</p> : null}
      </div>

      <ul className="divide-y rounded-xl border text-sm">
        {resume.sections.map((section) => (
          <li key={section.id} className="flex items-center justify-between gap-3 px-3 py-2">
            <span className="flex min-w-0 items-center gap-2">
              <CheckCircle2 className="size-4 shrink-0 text-success" aria-hidden />
              <span className="truncate font-medium">{section.title}</span>
            </span>
            <span className="shrink-0 text-muted tabular-nums">
              {section.entries.length} {section.entries.length === 1 ? "entry" : "entries"} ·{" "}
              {section.entries.reduce((n, e) => n + e.bullets.length, 0)} bullets
            </span>
          </li>
        ))}
        <li className="flex items-center justify-between gap-3 px-3 py-2">
          <span className="flex items-center gap-2">
            <CheckCircle2 className={cn("size-4", skills ? "text-success" : "text-muted")} aria-hidden />
            <span className="font-medium">Skills</span>
          </span>
          <span className="text-muted tabular-nums">
            {skills} in {resume.skills.length} group{resume.skills.length === 1 ? "" : "s"}
          </span>
        </li>
      </ul>

      {warnings.length ? (
        <div className="rounded-lg bg-warning-soft px-3 py-2 text-sm text-warning">
          {warnings.map((w) => (
            <p key={w}>{w}</p>
          ))}
          <p className="mt-1">You can fill these in the editor after importing, or try another file format.</p>
        </div>
      ) : null}

      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="ghost" onClick={onBack}>
          Try another file
        </Button>
        <Button onClick={onUse}>Use this resume</Button>
      </div>
      <p className="-mt-2 text-right text-xs text-muted">This replaces what&apos;s in the editor. Nothing is saved until you press Save.</p>
    </div>
  );
}

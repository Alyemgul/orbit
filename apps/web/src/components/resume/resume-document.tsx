"use client";

import type { Resume } from "@orbit/core";
import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

/**
 * The resume as a recruiter sees it: one column, real text, standard
 * headings, so applicant tracking systems parse it cleanly. Colors are
 * fixed (paper), whatever the app theme.
 */
export function ResumeDocument({ resume, className }: { resume: Resume; className?: string }) {
  const { basics } = resume;
  const contact = [basics.email, basics.phone, basics.location, ...basics.links.map((l) => l.url)].filter(Boolean);
  const skills = resume.skills.filter((g) => g.items.length);

  return (
    <article className={cn("resume-paper bg-white px-10 py-9 font-sans text-[10.5pt] leading-snug text-neutral-900", className)}>
      <header className="text-center">
        <h1 className="text-[20pt] leading-tight font-bold tracking-tight">{basics.name || "Your name"}</h1>
        {basics.headline ? <p className="mt-0.5 text-neutral-700">{basics.headline}</p> : null}
        {contact.length ? <p className="mt-1 text-[9.5pt] text-neutral-700">{contact.join("  ·  ")}</p> : null}
      </header>

      {resume.summary ? (
        <Section title="Summary">
          <p>{resume.summary}</p>
        </Section>
      ) : null}

      {resume.sections
        .filter((s) => s.entries.length)
        .map((section) => (
          <Section key={section.id} title={section.title}>
            <div className="flex flex-col gap-2.5">
              {section.entries.map((entry) => (
                <div key={entry.id} className="break-inside-avoid">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                    <p>
                      <span className="font-semibold">{entry.title}</span>
                      {entry.org ? <span>{section.kind === "projects" ? ` · ${entry.org}` : `, ${entry.org}`}</span> : null}
                    </p>
                    <p className="text-[9.5pt] whitespace-nowrap text-neutral-600">
                      {[entry.location, entry.dates].filter(Boolean).join(" · ")}
                    </p>
                  </div>
                  {entry.link ? <p className="text-[9pt] text-neutral-600">{entry.link}</p> : null}
                  {entry.bullets.some((b) => b.text) ? (
                    <ul className="mt-1 list-disc space-y-0.5 pl-5 marker:text-neutral-500">
                      {entry.bullets
                        .filter((b) => b.text)
                        .map((bullet) => (
                          <li key={bullet.id}>{bullet.text}</li>
                        ))}
                    </ul>
                  ) : null}
                </div>
              ))}
            </div>
          </Section>
        ))}

      {skills.length ? (
        <Section title="Skills">
          <dl className="space-y-0.5">
            {skills.map((group) => (
              <div key={group.id} className="flex gap-1.5">
                <dt className="shrink-0 font-semibold">{group.name}:</dt>
                <dd>{group.items.join(", ")}</dd>
              </div>
            ))}
          </dl>
        </Section>
      ) : null}
    </article>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-4 break-inside-avoid-page">
      <h2 className="mb-1.5 border-b border-neutral-300 pb-0.5 text-[10pt] font-bold tracking-wider text-neutral-800 uppercase">
        {title}
      </h2>
      {children}
    </section>
  );
}

/** Renders the resume straight under <body>, visible only when printing (Save as PDF). */
export function PrintableResume({ resume }: { resume: Resume }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;
  return createPortal(
    <div className="orbit-print-root" aria-hidden>
      <ResumeDocument resume={resume} className="px-0 py-0" />
    </div>,
    document.body,
  );
}

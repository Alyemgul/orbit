"use client";

import {
  newResumeId,
  RESUME_SECTION_KINDS,
  SECTION_TITLES,
  type Resume,
  type ResumeEntry,
  type ResumeSection,
  type ResumeSectionKind,
} from "@orbit/core";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Update = (mutate: (draft: Resume) => void) => void;

const fieldClass =
  "h-9 w-full min-w-0 rounded-lg border bg-surface px-2.5 text-sm text-text placeholder:text-muted focus-visible:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/25";
const areaClass = cn(fieldClass, "h-auto min-h-[2.5rem] resize-y py-2 leading-snug [field-sizing:content]");

const ENTRY_LABELS: Record<ResumeSectionKind, { title: string; org: string; titleHint: string; orgHint: string }> = {
  experience: { title: "Role", org: "Company", titleHint: "Software Engineering Intern", orgHint: "Company name" },
  projects: { title: "Project", org: "Built with", titleHint: "Order book simulator", orgHint: "C++, Python" },
  education: { title: "Degree", org: "School", titleHint: "BSc Computer Science", orgHint: "University" },
  custom: { title: "Title", org: "Organisation", titleHint: "Award or activity", orgHint: "Organiser" },
};

function move<T>(list: T[], index: number, by: -1 | 1) {
  const target = index + by;
  if (target < 0 || target >= list.length) return;
  [list[index], list[target]] = [list[target]!, list[index]!];
}

export function ResumeEditor({ resume, update }: { resume: Resume; update: Update }) {
  const [newKind, setNewKind] = useState<ResumeSectionKind>("custom");

  return (
    <div className="flex flex-col gap-4">
      <Panel title="Contact">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Full name">
            <input className={fieldClass} value={resume.basics.name} maxLength={120} autoComplete="name"
              onChange={(e) => update((d) => void (d.basics.name = e.target.value))} />
          </Field>
          <Field label="Headline">
            <input className={fieldClass} value={resume.basics.headline} maxLength={160} placeholder="CSE student, graduating 2027"
              onChange={(e) => update((d) => void (d.basics.headline = e.target.value))} />
          </Field>
          <Field label="Email">
            <input className={fieldClass} type="email" value={resume.basics.email} maxLength={200} autoComplete="email"
              onChange={(e) => update((d) => void (d.basics.email = e.target.value))} />
          </Field>
          <Field label="Phone (optional)">
            <input className={fieldClass} type="tel" value={resume.basics.phone} maxLength={40} autoComplete="tel"
              onChange={(e) => update((d) => void (d.basics.phone = e.target.value))} />
          </Field>
          <Field label="Location">
            <input className={fieldClass} value={resume.basics.location} maxLength={120} placeholder="Budapest, Hungary"
              onChange={(e) => update((d) => void (d.basics.location = e.target.value))} />
          </Field>
        </div>
        <div className="mt-3 flex flex-col gap-2">
          <p className="text-xs font-medium text-muted">Links</p>
          {resume.basics.links.map((link, index) => (
            <div key={index} className="flex gap-2">
              <input className={cn(fieldClass, "w-28 shrink-0")} value={link.label} maxLength={40} placeholder="GitHub" aria-label="Link label"
                onChange={(e) => update((d) => void (d.basics.links[index]!.label = e.target.value))} />
              <input className={fieldClass} value={link.url} maxLength={300} placeholder="github.com/you" aria-label="Link URL"
                onChange={(e) => update((d) => void (d.basics.links[index]!.url = e.target.value))} />
              <IconButton label="Remove link" onClick={() => update((d) => void d.basics.links.splice(index, 1))}>
                <Trash2 />
              </IconButton>
            </div>
          ))}
          {resume.basics.links.length < 6 ? (
            <Button variant="ghost" size="sm" className="self-start"
              onClick={() => update((d) => void d.basics.links.push({ label: "", url: "" }))}>
              <Plus /> Add link
            </Button>
          ) : null}
        </div>
      </Panel>

      <Panel title="Summary" hint="Two lines on who you are and what you want. Optional.">
        <textarea className={areaClass} rows={3} value={resume.summary} maxLength={1500} aria-label="Summary"
          onChange={(e) => update((d) => void (d.summary = e.target.value))} />
      </Panel>

      {resume.sections.map((section, index) => (
        <SectionEditor key={section.id} section={section} index={index} count={resume.sections.length} update={update} />
      ))}

      <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-dashed p-3">
        <label htmlFor="new-section" className="text-sm text-muted">Add a section</label>
        <select id="new-section" className={cn(fieldClass, "w-auto")} value={newKind}
          onChange={(e) => setNewKind(e.target.value as ResumeSectionKind)}>
          {RESUME_SECTION_KINDS.map((kind) => (
            <option key={kind} value={kind}>{kind === "custom" ? "Other (awards, activities…)" : SECTION_TITLES[kind]}</option>
          ))}
        </select>
        <Button variant="secondary" size="sm" disabled={resume.sections.length >= 10}
          onClick={() => update((d) => void d.sections.push({ id: newResumeId("s"), kind: newKind, title: SECTION_TITLES[newKind], entries: [] }))}>
          <Plus /> Add
        </Button>
      </div>

      <SkillsEditor resume={resume} update={update} />
    </div>
  );
}

function SectionEditor({ section, index, count, update }: { section: ResumeSection; index: number; count: number; update: Update }) {
  const at = (d: Resume) => d.sections.find((s) => s.id === section.id)!;
  return (
    <Panel
      title={
        <input className="min-w-0 flex-1 rounded-md bg-transparent px-1 text-base font-semibold hover:bg-surface-2 focus-visible:bg-surface-2"
          value={section.title} maxLength={60} aria-label="Section title"
          onChange={(e) => update((d) => void (at(d).title = e.target.value))} />
      }
      actions={
        <>
          <IconButton label="Move section up" disabled={index === 0} onClick={() => update((d) => move(d.sections, index, -1))}><ArrowUp /></IconButton>
          <IconButton label="Move section down" disabled={index === count - 1} onClick={() => update((d) => move(d.sections, index, 1))}><ArrowDown /></IconButton>
          <IconButton label={`Delete ${section.title}`}
            onClick={() => (section.entries.length === 0 || window.confirm(`Delete “${section.title}” and everything in it?`)) && update((d) => void d.sections.splice(index, 1))}>
            <Trash2 />
          </IconButton>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {section.entries.map((entry, entryIndex) => (
          <EntryEditor key={entry.id} section={section} entry={entry} index={entryIndex} update={update} />
        ))}
        <Button variant="secondary" size="sm" className="self-start" disabled={section.entries.length >= 25}
          onClick={() => update((d) => void at(d).entries.push({ id: newResumeId("e"), title: "", org: "", location: "", dates: "", link: "", bullets: [{ id: newResumeId("b"), text: "" }] }))}>
          <Plus /> Add {ENTRY_LABELS[section.kind].title.toLowerCase()}
        </Button>
      </div>
    </Panel>
  );
}

function EntryEditor({ section, entry, index, update }: { section: ResumeSection; entry: ResumeEntry; index: number; update: Update }) {
  const labels = ENTRY_LABELS[section.kind];
  const at = (d: Resume) => d.sections.find((s) => s.id === section.id)!.entries.find((e) => e.id === entry.id)!;
  const set = (key: "title" | "org" | "location" | "dates" | "link") => (e: { target: { value: string } }) =>
    update((d) => void (at(d)[key] = e.target.value));

  return (
    <div className="rounded-xl border bg-bg/40 p-3">
      <div className="grid gap-2 sm:grid-cols-2">
        <Field label={labels.title}><input className={fieldClass} value={entry.title} maxLength={160} placeholder={labels.titleHint} onChange={set("title")} /></Field>
        <Field label={labels.org}><input className={fieldClass} value={entry.org} maxLength={160} placeholder={labels.orgHint} onChange={set("org")} /></Field>
        <Field label="Dates"><input className={fieldClass} value={entry.dates} maxLength={60} placeholder="Jun 2025 – Sep 2025" onChange={set("dates")} /></Field>
        <Field label={section.kind === "projects" ? "Link" : "Location"}>
          {section.kind === "projects" ? (
            <input className={fieldClass} value={entry.link} maxLength={300} placeholder="github.com/you/project" onChange={set("link")} />
          ) : (
            <input className={fieldClass} value={entry.location} maxLength={120} placeholder="City" onChange={set("location")} />
          )}
        </Field>
      </div>

      <ul className="mt-3 flex flex-col gap-2" aria-label="Bullets">
        {entry.bullets.map((bullet, bulletIndex) => {
          const words = bullet.text.trim().split(/\s+/).filter(Boolean).length;
          return (
            <li key={bullet.id} className="flex items-start gap-1.5 max-sm:flex-wrap">
              <span className="mt-2.5 size-1.5 shrink-0 rounded-full bg-muted" aria-hidden />
              <div className="min-w-0 flex-1 max-sm:basis-[calc(100%-1rem)]">
                <textarea className={areaClass} rows={1} value={bullet.text} maxLength={600}
                  placeholder="Built … that … (a result, ideally with a number)" aria-label={`Bullet ${bulletIndex + 1}`}
                  onChange={(e) => update((d) => void (at(d).bullets.find((b) => b.id === bullet.id)!.text = e.target.value.replace(/\n/g, " ")))} />
                {words > 35 ? <p className="mt-0.5 text-[11px] text-warning">{words} words. Recruiters skim; aim for under 30.</p> : null}
              </div>
              {/* Phones put the controls under the text so the line gets the full width. */}
              <div className="flex shrink-0 items-center max-sm:-mt-1 max-sm:ml-auto">
                <IconButton label="Move bullet up" disabled={bulletIndex === 0} onClick={() => update((d) => move(at(d).bullets, bulletIndex, -1))}><ArrowUp /></IconButton>
                <IconButton label="Move bullet down" disabled={bulletIndex === entry.bullets.length - 1} onClick={() => update((d) => move(at(d).bullets, bulletIndex, 1))}><ArrowDown /></IconButton>
                <IconButton label="Delete bullet" onClick={() => update((d) => void at(d).bullets.splice(bulletIndex, 1))}><Trash2 /></IconButton>
              </div>
            </li>
          );
        })}
      </ul>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Button variant="ghost" size="sm" disabled={entry.bullets.length >= 15}
          onClick={() => update((d) => void at(d).bullets.push({ id: newResumeId("b"), text: "" }))}>
          <Plus /> Bullet
        </Button>
        <span className="ml-auto flex items-center">
          <IconButton label="Move up" disabled={index === 0} onClick={() => update((d) => move(d.sections.find((s) => s.id === section.id)!.entries, index, -1))}><ArrowUp /></IconButton>
          <IconButton label="Move down" disabled={index === section.entries.length - 1} onClick={() => update((d) => move(d.sections.find((s) => s.id === section.id)!.entries, index, 1))}><ArrowDown /></IconButton>
          <IconButton label={`Delete ${entry.title || "entry"}`}
            onClick={() => (!entry.bullets.some((b) => b.text) || window.confirm("Delete this entry and its bullets?")) &&
              update((d) => void d.sections.find((s) => s.id === section.id)!.entries.splice(index, 1))}>
            <Trash2 />
          </IconButton>
        </span>
      </div>
    </div>
  );
}

function SkillsEditor({ resume, update }: { resume: Resume; update: Update }) {
  // Typing "Python, " must not lose the comma, so each group edits a draft string.
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const commit = (id: string, value: string) =>
    update((d) => {
      const group = d.skills.find((g) => g.id === id);
      if (group) group.items = [...new Set(value.split(/[,;\n]/).map((s) => s.trim().slice(0, 60)).filter(Boolean))].slice(0, 50);
    });

  return (
    <Panel title="Skills" hint="Comma-separated. Tailoring puts the ones a job asks for first; it never adds new ones.">
      <div className="flex flex-col gap-2">
        {resume.skills.map((group, index) => (
          <div key={group.id} className="flex flex-col gap-2 sm:flex-row sm:items-start">
            <input className={cn(fieldClass, "sm:w-36 sm:shrink-0")} value={group.name} maxLength={60} aria-label="Skill group name"
              onChange={(e) => update((d) => void (d.skills[index]!.name = e.target.value))} />
            <div className="flex min-w-0 flex-1 gap-1">
              <textarea className={areaClass} rows={1} aria-label={`${group.name || "Skill"} items`}
                value={drafts[group.id] ?? group.items.join(", ")}
                placeholder="Python, Go, PostgreSQL"
                onChange={(e) => {
                  setDrafts((all) => ({ ...all, [group.id]: e.target.value }));
                  commit(group.id, e.target.value);
                }}
                onBlur={() => setDrafts(({ [group.id]: _, ...rest }) => rest)} />
              <IconButton label={`Delete ${group.name || "group"}`} onClick={() => update((d) => void d.skills.splice(index, 1))}><Trash2 /></IconButton>
            </div>
          </div>
        ))}
        {resume.skills.length < 12 ? (
          <Button variant="ghost" size="sm" className="self-start"
            onClick={() => update((d) => void d.skills.push({ id: newResumeId("k"), name: "", items: [] }))}>
            <Plus /> Add group
          </Button>
        ) : null}
      </div>
    </Panel>
  );
}

function Panel({ title, hint, actions, children }: { title: ReactNode; hint?: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-2xl border bg-surface p-4 shadow-card sm:p-5">
      <div className="mb-3 flex items-center gap-2">
        {typeof title === "string" ? <h2 className="flex-1 text-base font-semibold">{title}</h2> : title}
        {actions ? <div className="flex shrink-0 items-center">{actions}</div> : null}
      </div>
      {hint ? <p className="-mt-2 mb-3 text-xs text-muted">{hint}</p> : null}
      {children}
    </section>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex min-w-0 flex-col gap-1">
      <span className="text-xs font-medium text-muted">{label}</span>
      {children}
    </label>
  );
}

function IconButton({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: ReactNode }) {
  return (
    <button type="button" aria-label={label} title={label} disabled={disabled} onClick={onClick}
      className="grid size-8 place-items-center rounded-md text-muted hover:bg-surface-2 hover:text-text disabled:pointer-events-none disabled:opacity-30 [&_svg]:size-4">
      {children}
    </button>
  );
}

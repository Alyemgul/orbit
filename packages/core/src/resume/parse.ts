import {
  newResumeId,
  resumeSchema,
  SECTION_TITLES,
  type Resume,
  type ResumeEntry,
  type ResumeSection,
  type ResumeSectionKind,
} from "./schema";

/**
 * Best-effort import of a resume pasted as plain text (for example copied
 * out of a PDF). It never guesses facts: every line lands somewhere visible
 * so the user can fix the structure in the editor.
 */

const HEADINGS: [RegExp, ResumeSectionKind | "skills" | "summary"][] = [
  [/^(work |professional |relevant )?(experience|employment|work history|internships?)$/i, "experience"],
  [/^(personal |academic |selected |side )?projects?$/i, "projects"],
  [/^(education|academic background|studies)$/i, "education"],
  [/^(technical |core )?(skills|technologies|tech stack|tools)( & tools| and tools)?$/i, "skills"],
  [/^(summary|profile|about( me)?|objective|professional summary)$/i, "summary"],
  [/^(awards|achievements|honou?rs|certifications?|activities|leadership|volunteering|publications|extracurriculars?|languages)( & \w+| and \w+)?$/i, "custom"],
];

const BULLET = /^\s*(?:[-*•▪◦●‣–]|\d+[.)])\s+/;
const DATES = /((?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+)?(?:19|20)\d{2}\s*(?:[-–—]|to)\s*((?:(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+)?(?:19|20)\d{2}|present|current|now)|((?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+)?(?:19|20)\d{2}/i;
const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/;
const PHONE = /\+?\d[\d\s().-]{7,}\d/;
const URL = /(?:https?:\/\/)?(?:www\.)?(?:linkedin\.com|github\.com|gitlab\.com|[\w-]+\.(?:dev|io|me|com))\/?[\w\-./?=#%]*/i;

function headingKind(line: string): ResumeSectionKind | "skills" | "summary" | null {
  const clean = line.replace(/[:|]+$/, "").trim();
  if (clean.length > 40) return null;
  for (const [pattern, kind] of HEADINGS) if (pattern.test(clean)) return kind;
  return null;
}

function splitEntryLine(line: string): Omit<ResumeEntry, "id" | "bullets"> {
  const dates = line.match(DATES)?.[0] ?? "";
  const rest = line.replace(dates, "").replace(/[\s|,–—-]+$/, "").trim();
  const parts = rest.split(/\s+[|·•@–—]\s+|\s+-\s+|,\s+(?=[A-Z])/).map((p) => p.trim()).filter(Boolean);
  return {
    title: parts[0]?.slice(0, 160) ?? "",
    org: parts[1]?.slice(0, 160) ?? "",
    location: parts.slice(2).join(", ").slice(0, 120),
    dates: dates.trim().slice(0, 60),
    link: "",
  };
}

export function parseResumeText(input: string): Resume {
  const lines = input
    .replace(/\r/g, "")
    .split("\n")
    .map((l) => l.replace(/\s+$/, ""))
    .filter((l) => l.trim());

  const resume: Resume = {
    version: 1,
    basics: { name: "", headline: "", email: "", phone: "", location: "", links: [] },
    summary: "",
    sections: [],
    skills: [],
  };

  type Mode = ResumeSectionKind | "skills" | "summary" | "header";
  let mode: Mode = "header";
  let section: ResumeSection | null = null;
  let entry: ResumeEntry | null = null;
  const summary: string[] = [];

  const openSection = (kind: ResumeSectionKind, title: string) => {
    section = { id: newResumeId("s"), kind, title: title.slice(0, 60), entries: [] };
    resume.sections.push(section);
    entry = null;
  };

  for (const raw of lines.slice(0, 400)) {
    const line = raw.trim();
    const kind = headingKind(line);
    if (kind) {
      mode = kind;
      if (kind !== "skills" && kind !== "summary") {
        openSection(kind, kind === "custom" ? line.replace(/[:|]+$/, "") : SECTION_TITLES[kind]);
      }
      continue;
    }

    if (mode === "header") {
      const email = line.match(EMAIL)?.[0];
      const phone = line.match(PHONE)?.[0];
      const url = line.replace(EMAIL, "").match(URL)?.[0];
      if (email && !resume.basics.email) resume.basics.email = email;
      if (phone && !resume.basics.phone) resume.basics.phone = phone.trim();
      if (url && resume.basics.links.length < 6) {
        const label = /linkedin/i.test(url) ? "LinkedIn" : /github/i.test(url) ? "GitHub" : "Website";
        resume.basics.links.push({ label, url });
      }
      if (!email && !phone && !url) {
        if (!resume.basics.name) resume.basics.name = line.slice(0, 120);
        else if (!resume.basics.headline) resume.basics.headline = line.slice(0, 160);
        else summary.push(line);
      }
      continue;
    }

    if (mode === "summary") {
      summary.push(line.replace(BULLET, ""));
      continue;
    }

    if (mode === "skills") {
      const [name, items] = line.includes(":") ? [line.slice(0, line.indexOf(":")), line.slice(line.indexOf(":") + 1)] : ["Skills", line];
      const list = items!
        .replace(BULLET, "")
        .split(/[,;|•·]/)
        .map((s) => s.trim())
        .filter((s) => s && s.length <= 60);
      const groupName = name!.replace(BULLET, "").trim().slice(0, 60) || "Skills";
      const existing = resume.skills.find((g) => g.name === groupName);
      if (existing) existing.items.push(...list);
      else if (resume.skills.length < 12) resume.skills.push({ id: newResumeId("k"), name: groupName, items: list });
      continue;
    }

    // Inside experience, projects, education or a custom section.
    if (!section) openSection(mode, SECTION_TITLES[mode]);
    const current = section as unknown as ResumeSection;
    if (BULLET.test(raw) || (entry && line.length > 90)) {
      if (!entry) {
        entry = { id: newResumeId("e"), title: "", org: "", location: "", dates: "", link: "", bullets: [] };
        current.entries.push(entry);
      }
      const target = entry as ResumeEntry;
      target.bullets.push({ id: newResumeId("b"), text: line.replace(BULLET, "").slice(0, 600) });
    } else if (entry && !(entry as ResumeEntry).bullets.length && !(entry as ResumeEntry).dates && DATES.test(line)) {
      // A second header line, typically "Company — City" or the dates.
      const extra = splitEntryLine(line);
      const target = entry as ResumeEntry;
      target.dates = extra.dates;
      if (!target.org) target.org = extra.title;
      if (!target.location) target.location = [extra.org, extra.location].filter(Boolean).join(", ");
    } else {
      entry = { id: newResumeId("e"), ...splitEntryLine(line), bullets: [] };
      current.entries.push(entry);
    }
  }

  resume.summary = summary.join(" ").slice(0, 1500);
  for (const group of resume.skills) group.items = [...new Set(group.items)].slice(0, 50);
  for (const s of resume.sections) {
    s.entries = s.entries.slice(0, 25);
    for (const e of s.entries) e.bullets = e.bullets.slice(0, 15);
  }
  return resumeSchema.parse(resume);
}

/** Imports the community JSON Resume format (jsonresume.org). */
export function fromJsonResume(value: unknown): Resume | null {
  if (!value || typeof value !== "object") return null;
  const data = value as Record<string, any>;
  if (!data.basics && !data.work && !data.education) return null;
  const text = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
  const list = (v: unknown): any[] => (Array.isArray(v) ? v : []);
  const range = (item: any) => [text(item.startDate, 20), text(item.endDate, 20) || (item.startDate ? "Present" : "")].filter(Boolean).join(" – ");
  const bullets = (items: unknown) =>
    list(items)
      .map((h) => text(h, 600))
      .filter(Boolean)
      .slice(0, 15)
      .map((t) => ({ id: newResumeId("b"), text: t }));

  const basics = data.basics ?? {};
  const resume: Resume = {
    version: 1,
    basics: {
      name: text(basics.name, 120),
      headline: text(basics.label, 160),
      email: text(basics.email, 200),
      phone: text(basics.phone, 40),
      location: [text(basics.location?.city, 60), text(basics.location?.countryCode, 10)].filter(Boolean).join(", "),
      links: [
        ...(basics.url ? [{ label: "Website", url: text(basics.url, 300) }] : []),
        ...list(basics.profiles).map((p) => ({ label: text(p.network, 40) || "Profile", url: text(p.url, 300) })),
      ].slice(0, 6),
    },
    summary: text(basics.summary, 1500),
    sections: [],
    skills: list(data.skills)
      .slice(0, 12)
      .map((s) => ({
        id: newResumeId("k"),
        name: text(s.name, 60) || "Skills",
        items: list(s.keywords).map((k) => text(k, 60)).filter(Boolean).slice(0, 50),
      })),
  };

  const work = list(data.work).slice(0, 25).map((w) => ({
    id: newResumeId("e"),
    title: text(w.position, 160),
    org: text(w.name ?? w.company, 160),
    location: text(w.location, 120),
    dates: range(w).slice(0, 60),
    link: text(w.url, 300),
    bullets: bullets([...(w.summary ? [w.summary] : []), ...list(w.highlights)]),
  }));
  const projects = list(data.projects).slice(0, 25).map((p) => ({
    id: newResumeId("e"),
    title: text(p.name, 160),
    org: list(p.keywords).map((k) => text(k, 30)).join(", ").slice(0, 160),
    location: "",
    dates: range(p).slice(0, 60),
    link: text(p.url, 300),
    bullets: bullets([...(p.description ? [p.description] : []), ...list(p.highlights)]),
  }));
  const education = list(data.education).slice(0, 25).map((e) => ({
    id: newResumeId("e"),
    title: [text(e.studyType, 80), text(e.area, 80)].filter(Boolean).join(", "),
    org: text(e.institution, 160),
    location: "",
    dates: range(e).slice(0, 60),
    link: text(e.url, 300),
    bullets: bullets([...(e.score ? [`GPA: ${text(e.score, 20)}`] : []), ...list(e.courses).slice(0, 1).map((c) => `Courses: ${list(e.courses).join(", ")}`.slice(0, 600)), ...list(e.highlights)]),
  }));

  if (education.length) resume.sections.push({ id: newResumeId("s"), kind: "education", title: "Education", entries: education });
  if (work.length) resume.sections.push({ id: newResumeId("s"), kind: "experience", title: "Experience", entries: work });
  if (projects.length) resume.sections.push({ id: newResumeId("s"), kind: "projects", title: "Projects", entries: projects });
  const parsed = resumeSchema.safeParse(resume);
  return parsed.success ? parsed.data : null;
}

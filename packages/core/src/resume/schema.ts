import { z } from "zod";

/**
 * The structured resume Orbit stores (resumes.content, resume_variants.content).
 * Every bullet and entry carries a stable id so a tailored copy can be traced
 * back, line by line, to the master it came from.
 */

const id = z.string().regex(/^[A-Za-z0-9_-]{1,40}$/);
const line = (max: number) => z.string().trim().max(max).catch("");

export const RESUME_SECTION_KINDS = ["experience", "projects", "education", "custom"] as const;
export type ResumeSectionKind = (typeof RESUME_SECTION_KINDS)[number];

export const resumeBulletSchema = z.object({
  id,
  text: z.string().trim().max(600),
});

export const resumeEntrySchema = z.object({
  id,
  /** Role, project name or degree. */
  title: line(160),
  /** Company, school, or the stack a project used. */
  org: line(160),
  location: line(120),
  /** Free text such as "Jun 2025 – Sep 2025" or "2023 – Present". */
  dates: line(60),
  link: line(300),
  bullets: z.array(resumeBulletSchema).max(15),
});

export const resumeSectionSchema = z.object({
  id,
  kind: z.enum(RESUME_SECTION_KINDS),
  title: line(60),
  entries: z.array(resumeEntrySchema).max(25),
});

export const resumeSkillGroupSchema = z.object({
  id,
  name: line(60),
  items: z.array(z.string().trim().min(1).max(60)).max(50),
});

export const resumeLinkSchema = z.object({
  label: line(40),
  url: line(300),
});

export const resumeSchema = z.object({
  version: z.literal(1).catch(1),
  basics: z.object({
    name: line(120),
    headline: line(160),
    email: line(200),
    phone: line(40),
    location: line(120),
    links: z.array(resumeLinkSchema).max(6).catch([]),
  }),
  summary: z.string().trim().max(1500).catch(""),
  sections: z.array(resumeSectionSchema).max(10),
  skills: z.array(resumeSkillGroupSchema).max(12),
});

export type ResumeBullet = z.infer<typeof resumeBulletSchema>;
export type ResumeEntry = z.infer<typeof resumeEntrySchema>;
export type ResumeSection = z.infer<typeof resumeSectionSchema>;
export type ResumeSkillGroup = z.infer<typeof resumeSkillGroupSchema>;
export type Resume = z.infer<typeof resumeSchema>;

export const SECTION_TITLES: Record<ResumeSectionKind, string> = {
  experience: "Experience",
  projects: "Projects",
  education: "Education",
  custom: "Achievements",
};

/** Short random id for new bullets, entries and sections. */
export function newResumeId(prefix = "x"): string {
  const bytes = new Uint8Array(6);
  globalThis.crypto.getRandomValues(bytes);
  return `${prefix}${Array.from(bytes, (b) => b.toString(36).padStart(2, "0")).join("").slice(0, 10)}`;
}

export function emptyResume(): Resume {
  return {
    version: 1,
    basics: { name: "", headline: "", email: "", phone: "", location: "", links: [] },
    summary: "",
    sections: (["education", "experience", "projects"] as const).map((kind) => ({
      id: newResumeId("s"),
      kind,
      title: SECTION_TITLES[kind],
      entries: [],
    })),
    skills: [
      { id: newResumeId("k"), name: "Languages", items: [] },
      { id: newResumeId("k"), name: "Tools", items: [] },
    ],
  };
}

/** Parses stored content; anything unreadable becomes null rather than throwing. */
export function readResume(value: unknown): Resume | null {
  const parsed = resumeSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/** Every bullet with the entry it belongs to, in document order. */
export function resumeBullets(resume: Resume): { section: ResumeSection; entry: ResumeEntry; bullet: ResumeBullet }[] {
  return resume.sections.flatMap((section) =>
    section.entries.flatMap((entry) => entry.bullets.map((bullet) => ({ section, entry, bullet }))),
  );
}

/** All text a recruiter (or an ATS) would read, for keyword matching. */
export function resumePlainText(resume: Resume): string {
  const parts: string[] = [resume.basics.headline, resume.summary];
  for (const section of resume.sections) {
    for (const entry of section.entries) {
      parts.push(entry.title, entry.org, ...entry.bullets.map((b) => b.text));
    }
  }
  for (const group of resume.skills) parts.push(group.items.join(", "));
  return parts.filter(Boolean).join("\n");
}

/** True when nothing worth tailoring has been written yet. */
export function isResumeEmpty(resume: Resume): boolean {
  return resumeBullets(resume).every(({ bullet }) => !bullet.text) && resume.skills.every((g) => g.items.length === 0);
}

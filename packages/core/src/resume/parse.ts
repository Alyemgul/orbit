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
 * Best-effort import of a resume pasted as plain text or extracted from a
 * PDF. It never guesses facts: every line lands somewhere visible so the user
 * can fix the structure in the editor.
 *
 * PDFs (LaTeX ones especially) often lose their bullet symbols, so structure
 * comes from other signals: blank lines between paragraphs, wrapped lines
 * that run to the full text width, "Project | Tech" and "Role … dates"
 * header lines, and headings such as "AI and Data Projects".
 */

type HeadingKind = ResumeSectionKind | "skills" | "summary";

const HEADINGS: [RegExp, HeadingKind][] = [
  [/^(work |professional |relevant )?(experience|employment|work history|internships?)$/i, "experience"],
  [/^(personal |academic |selected |side )?projects?$/i, "projects"],
  [/^(education|academic background|studies)$/i, "education"],
  [/^(technical |core |key |it )?(skills|technologies|tech stack|tools|competencies|programming languages)(\s*(&|and)\s*[\w ]{2,20})?$/i, "skills"],
  [/^(summary|profile|about( me)?|objective|professional summary)$/i, "summary"],
  [/^(awards|achievements|honou?rs|certifications?|activities|leadership|volunteering|publications|extracurriculars?|languages)( & \w+| and \w+)?$/i, "custom"],
];

/** Headings named by their last word: "AI and Data Projects", "Research", "Teaching Experience". */
const HEADING_TAIL: [RegExp, HeadingKind][] = [
  [/(projects|research|portfolio)$/i, "projects"],
  [/(experience|employment|internships|work history)$/i, "experience"],
  [/(education)$/i, "education"],
  [/(skills|technologies|tech stack|competencies)$/i, "skills"],
  [/(summary|profile)$/i, "summary"],
  [/(certifications|awards|achievements|activities|leadership|volunteering|publications|languages|interests|honou?rs|coursework|courses)$/i, "custom"],
];

const BULLET = /^\s*(?:[-*•▪◦●‣–➢►▸✓✔→»■□∙·]\s*|\d+[.)]\s+)(?=\S)/;
const MONTH = "(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\\.?\\s+";
const DATES = new RegExp(
  `(${MONTH})?(?:19|20)\\d{2}\\s*(?:[-–—]|to)\\s*((?:expected|anticipated|exp\\.)\\s+)?((${MONTH})?(?:19|20)\\d{2}|present|current|now)|((?:expected|anticipated)\\s+)?(${MONTH})?(?:19|20)\\d{2}`,
  "i",
);
const ENDS_WITH_DATE = /((?:19|20)\d{2}|present|current|now)\s*\)?$/i;
const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/;
const PHONE = /\+?\d[\d\s().-]{7,}\d/;
const URL = /(?:https?:\/\/)?(?:www\.)?(?:linkedin\.com|github\.com|gitlab\.com|[\w-]+\.(?:dev|io|me|com))\/?[\w\-./?=#%]*/i;
/** "Budapest, Hungary" or "Remote" at the end of an organisation line. */
const TRAILING_PLACE = /\s+((?:(?:New|San|Santa|Los|Las|Saint|St\.|Hong|Tel|Kuala|Den|Ho|Rio|Abu|Buenos|Mexico|Cape)\s)?\p{Lu}[\p{L}.'-]+,\s*\p{Lu}[\p{L} .'-]{1,30}|Remote|Hybrid)$/u;
const ACTION_START = /^(built|designed|developed|implemented|led|created|launched|shipped|improved|reduced|increased|automated|migrated|optimi[sz]ed|wrote|write|deployed|deploying|analy[sz]ed|organi[sz]ed|ran|run|taught|managed|delivered|researched|trained|refactored|integrated|maintained|owned|won|founded|mentored|contributed|cut|moved|added|support(ed)?|coordinat(e|ed)|evaluated|showed|tested|exposed|combined|paired|detected|rebuilt|restructured|containerized|resolved|verified|helped|worked|responsible)\b/i;

function cleanHeading(line: string): string {
  let clean = line.replace(/[:|]+$/, "").trim();
  // Letter-spaced headings from designed PDFs: "E X P E R I E N C E".
  if (/^(?:\p{L} ){3,}\p{L}$/u.test(clean)) clean = clean.replace(/ /g, "");
  return clean;
}

function headingKind(line: string): HeadingKind | null {
  const clean = cleanHeading(line);
  if (clean.length > 45) return null;
  for (const [pattern, kind] of HEADINGS) if (pattern.test(clean)) return kind;
  // Free-form headings: short, no punctuation or digits, ending in a section word.
  if (/[\d|:,.;•]/.test(clean) || clean.split(/\s+/).length > 5) return null;
  for (const [pattern, kind] of HEADING_TAIL) if (pattern.test(clean)) return kind;
  return null;
}

/** "AI AND DATA PROJECTS" → "AI and Data Projects"-ish; mixed case is kept as written. */
function headingTitle(line: string): string {
  const clean = cleanHeading(line);
  if (clean !== clean.toUpperCase()) return clean.slice(0, 60);
  return clean
    .toLowerCase()
    .replace(/\b\p{L}/gu, (c) => c.toUpperCase())
    .replace(/\b(And|Of|The|For|In)\b/g, (w) => w.toLowerCase())
    .replace(/\bAi\b/g, "AI")
    .slice(0, 60);
}

/** "Title | Tech, Stack · github.com/x" (a project or research header). */
function pipeHeader(line: string): Omit<ResumeEntry, "id" | "bullets"> | null {
  const at = line.indexOf(" | ");
  if (at <= 0 || at > 110 || ACTION_START.test(line)) return null;
  const title = line.slice(0, at).trim();
  const parts = line.slice(at + 3).split(/\s+·\s+/).map((p) => p.trim()).filter(Boolean);
  const link = parts.slice(1).find((p) => URL.test(p))?.match(URL)?.[0] ?? "";
  if (DATES.test(line) && ENDS_WITH_DATE.test(line)) return null; // "Role | Company | dates": handled as a dated header
  return { title: title.slice(0, 160), org: (parts[0] ?? "").slice(0, 160), location: "", dates: "", link: link.slice(0, 300) };
}

/** A short title-like line: an organisation, a project name, a role without dates. */
function headerish(line: string): boolean {
  return (
    line.length <= 95 &&
    line.split(/\s+/).length <= 13 &&
    /^[\p{Lu}\d]/u.test(line) &&
    !/[:;.!?]$/.test(line) &&
    !line.includes(":") &&
    !/\d/.test(line) &&
    !ACTION_START.test(line)
  );
}

function splitPlace(line: string): { name: string; place: string } {
  const match = line.match(TRAILING_PLACE);
  if (!match || match.index === undefined || match.index < 3) return { name: line, place: "" };
  return { name: line.slice(0, match.index).replace(/[,\s]+$/, ""), place: match[1]!.trim() };
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

/**
 * Joins lines a PDF wrapped back into one: within a paragraph, a line that
 * starts mid-sentence or follows a full-width line continues it. Bullets,
 * headings and header lines always start fresh.
 */
function logicalLines(input: string): string[] {
  const raw = input
    .replace(/\r/g, "")
    // Control characters some PDFs leave for unmapped glyphs (e.g. accents).
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]\s?/g, "")
    .split("\n")
    .map((l) => l.replace(/\s+$/, ""));
  const lengths = raw.map((l) => l.trim().length).filter((n) => n > 0).sort((a, b) => a - b);
  const p90 = lengths.length >= 12 ? lengths[Math.floor(lengths.length * 0.9)]! : 0;
  const fullWidth = p90 >= 60 ? p90 * 0.72 : Infinity;

  const out: string[] = [];
  let previousRaw = "";
  for (const rawLine of raw) {
    const line = rawLine.trim();
    if (!line) {
      previousRaw = "";
      continue;
    }
    // A word or link hyphenated across lines ("password-" / "strength-analyzer"), even across a blank line.
    const tail = out[out.length - 1] ?? "";
    if ((/\w-$/.test(tail) && /^[a-z]/.test(line) && !BULLET.test(rawLine)) || (/\w\/$/.test(tail) && /^[\w.-]+$/.test(line))) {
      out[out.length - 1] += line;
      previousRaw = line;
      continue;
    }
    const startsFresh =
      BULLET.test(rawLine) || headingKind(line) !== null || pipeHeader(line) !== null || (DATES.test(line) && ENDS_WITH_DATE.test(line) && line.length < 140);
    const continues = previousRaw !== "" && !startsFresh && (/^[a-z(&,;]/.test(line) || previousRaw.length >= fullWidth);
    if (continues && out.length) out[out.length - 1] = `${out[out.length - 1]} ${line}`.replace(/(\w)- (\w)/g, "$1-$2");
    else out.push(line);
    previousRaw = line;
  }
  return out;
}

export function parseResumeText(input: string): Resume {
  const lines = logicalLines(input);

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
  const addEntry = (fields: Omit<ResumeEntry, "id" | "bullets">) => {
    entry = { id: newResumeId("e"), ...fields, bullets: [] };
    (section as unknown as ResumeSection).entries.push(entry);
  };

  for (const line of lines.slice(0, 500)) {
    const kind = headingKind(line);
    if (kind) {
      mode = kind;
      if (kind !== "skills" && kind !== "summary") openSection(kind, headingTitle(line));
      continue;
    }

    if (mode === "header") {
      const email = line.match(EMAIL)?.[0];
      const phone = line.match(PHONE)?.[0];
      const url = line.replace(EMAIL, "").match(URL)?.[0];
      if (email && !resume.basics.email) resume.basics.email = email;
      if (phone && !resume.basics.phone) resume.basics.phone = phone.trim();
      if (email || phone || url) {
        // A contact line like "a@b.com | Budapest, Hungary | github.com/a | linkedin.com/in/a".
        for (const part of line.split(/\s+[|·•]\s+|\s{3,}/).map((p) => p.trim()).filter(Boolean)) {
          const partUrl = part.replace(EMAIL, "").match(URL)?.[0];
          if (EMAIL.test(part) || (PHONE.test(part) && /^\+?[\d\s().-]+$/.test(part))) continue;
          if (partUrl) {
            if (resume.basics.links.length < 6 && !resume.basics.links.some((l) => l.url === partUrl)) {
              const label = /linkedin/i.test(partUrl) ? "LinkedIn" : /github/i.test(partUrl) ? "GitHub" : "Website";
              resume.basics.links.push({ label, url: partUrl });
            }
          } else if (!resume.basics.location && /\p{L}/u.test(part) && part.length <= 60) {
            resume.basics.location = part;
          }
        }
      } else if (!resume.basics.name) resume.basics.name = line.slice(0, 120);
      else if (!resume.basics.headline) resume.basics.headline = line.slice(0, 160);
      else summary.push(line);
      continue;
    }

    if (mode === "summary") {
      summary.push(line.replace(BULLET, ""));
      continue;
    }

    if (mode === "skills") {
      const body = line.replace(BULLET, "");
      const colon = body.indexOf(":");
      const [name, items] = colon > 0 && colon < 40 ? [body.slice(0, colon), body.slice(colon + 1)] : ["Skills", body];
      const list = items
        .split(/[,;|•·]/)
        .map((s) => s.trim())
        .filter((s) => s && s.length <= 60);
      const groupName = name.trim().slice(0, 60) || "Skills";
      const existing = resume.skills.find((g) => g.name === groupName);
      if (existing) existing.items.push(...list);
      else if (resume.skills.length < 12) resume.skills.push({ id: newResumeId("k"), name: groupName, items: list });
      continue;
    }

    // Inside experience, projects, education or a custom section.
    if (!section) openSection(mode, SECTION_TITLES[mode]);
    const current = entry as ResumeEntry | null;
    const fresh = current !== null && current.bullets.length === 0;

    if (BULLET.test(line)) {
      if (!current) addEntry({ title: "", org: "", location: "", dates: "", link: "" });
      (entry as unknown as ResumeEntry).bullets.push({ id: newResumeId("b"), text: line.replace(BULLET, "").slice(0, 600) });
      continue;
    }
    if (current && current.bullets.length && /^[a-z(&,;]/.test(line)) {
      // Leftover wrap: the sentence continues.
      const last = current.bullets[current.bullets.length - 1]!;
      last.text = `${last.text} ${line}`.slice(0, 600);
      continue;
    }

    const pipe = pipeHeader(line);
    if (pipe) {
      addEntry(pipe);
      continue;
    }

    const dated = DATES.test(line) && ENDS_WITH_DATE.test(line) && line.length < 160;
    if (dated) {
      const parts = splitEntryLine(line);
      if (fresh && current && !current.dates) {
        // Second header line with the dates: "Bachelor of Science … Sep. 2023 – Expected 2027".
        current.dates = parts.dates;
        const second = [parts.title, parts.org].filter(Boolean).join(", ");
        if ((section as unknown as ResumeSection).kind === "education" && /bachelor|master|b\.?sc|m\.?sc|ph\.?d|degree|diploma|engineering|science/i.test(second)) {
          if (!current.org) current.org = current.title;
          current.title = second.slice(0, 160);
        } else if (!current.org) current.org = second.slice(0, 160);
        else if (!current.location) current.location = second.slice(0, 120);
      } else {
        addEntry(parts);
      }
      continue;
    }

    if (headerish(line)) {
      const { name, place } = splitPlace(line);
      if (fresh && current) {
        // "Teaching Assistant, Basics of Programming I  2025 – Present" then
        // "Budapest University of Technology and Economics  Budapest, Hungary".
        if (current.org && current.dates && !current.location) {
          current.title = `${current.title}, ${current.org}`.slice(0, 160);
          current.org = name.slice(0, 160);
        } else if (!current.org) current.org = name.slice(0, 160);
        else current.location = (current.location ? `${current.location}, ${name}` : name).slice(0, 120);
        if (place && !current.location) current.location = place.slice(0, 120);
      } else {
        addEntry({ title: name.slice(0, 160), org: "", location: place.slice(0, 120), dates: "", link: "" });
      }
      continue;
    }

    // Anything else is a sentence: a bullet of the current entry.
    if (!current) addEntry({ title: "", org: "", location: "", dates: "", link: "" });
    (entry as unknown as ResumeEntry).bullets.push({ id: newResumeId("b"), text: line.slice(0, 600) });
  }

  resume.summary = summary.join(" ").slice(0, 1500);
  for (const group of resume.skills) group.items = [...new Set(group.items)].slice(0, 50);
  resume.sections = resume.sections.filter((s) => s.entries.length).slice(0, 10);
  for (const s of resume.sections) {
    s.entries = s.entries.slice(0, 25);
    for (const e of s.entries) e.bullets = e.bullets.slice(0, 15);
  }
  return resumeSchema.parse(resume);
}

/* -------------------------------------------------------------------------- */
/* JSON import                                                                */
/* -------------------------------------------------------------------------- */

type Json = Record<string, unknown>;

const isObject = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);
const asList = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

function stripHtml(value: string): string {
  return value
    .replace(/<\s*(br|\/p|\/li|\/div|\/h\d)\s*\/?>/gi, "\n")
    .replace(/<li[^>]*>/gi, "\n• ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

/** A readable one-line string from a string, number, or {name}/{text}-like object. */
function str(v: unknown, max: number): string {
  if (typeof v === "number") return String(v).slice(0, max);
  if (typeof v === "string") return stripHtml(v).replace(/\s+/g, " ").trim().slice(0, max);
  if (isObject(v)) return str(v.name ?? v.text ?? v.value ?? v.label ?? v.title, max);
  return "";
}

function pick(item: Json, keys: string[], max: number, skip: string): [string, string] {
  for (const key of keys) {
    if (key === skip) continue;
    const value = str(item[key], max);
    if (value) return [value, key];
  }
  return ["", ""];
}

function placeOf(v: unknown): string {
  if (isObject(v)) {
    return [v.city, v.region, v.countryCode ?? v.country].map((p) => str(p, 60)).filter(Boolean).join(", ").slice(0, 120);
  }
  return str(v, 120);
}

function datesOf(item: Json): string {
  if (isObject(item.date)) return datesOf(item.date);
  const direct = str(item.dates ?? item.date ?? item.period ?? item.duration ?? item.year ?? item.releaseDate, 60);
  if (direct) return direct;
  const start = str(item.startDate ?? item.start ?? item.from ?? item.start_date, 25);
  const end = str(item.endDate ?? item.end ?? item.to ?? item.end_date, 25) || (item.current === true ? "Present" : "");
  if (!start && !end) return "";
  return [start, end || "Present"].filter(Boolean).join(" – ").slice(0, 60);
}

const BULLET_KEYS = ["summary", "description", "highlights", "bullets", "achievements", "accomplishments", "responsibilities", "tasks", "details", "points", "content"];

/** Bullets from arrays of strings, or a description split on lines and bullet marks. */
function bulletsOf(item: Json): { id: string; text: string }[] {
  const out: string[] = [];
  const add = (v: unknown): void => {
    if (Array.isArray(v)) {
      v.forEach(add);
      return;
    }
    if (isObject(v)) {
      add(v.text ?? v.description ?? v.name ?? v.title);
      return;
    }
    if (typeof v !== "string") return;
    for (const part of stripHtml(v).split(/\n|\s[•●▪◦‣➢►]\s+/)) {
      const clean = part.replace(BULLET, "").replace(/\s+/g, " ").trim();
      if (clean) out.push(clean);
    }
  };
  for (const key of BULLET_KEYS) add(item[key]);
  const courses = asList(item.courses).map((c) => str(c, 80)).filter(Boolean);
  if (courses.length) out.push(`Courses: ${courses.join(", ")}`);
  const score = str(item.score ?? item.gpa ?? item.grade, 30);
  if (score) out.push(`GPA: ${score}`);
  const keywords = asList(item.keywords ?? item.technologies ?? item.stack ?? item.tools).map((k) => str(k, 40)).filter(Boolean);
  if (keywords.length) out.push(`Tech: ${keywords.join(", ")}`);
  return [...new Set(out)].slice(0, 15).map((text) => ({ id: newResumeId("b"), text: text.slice(0, 600) }));
}

const TITLE_KEYS = ["position", "role", "jobTitle", "title", "degree", "studyType", "award", "certificate", "label", "name", "language"];
const ORG_KEYS = ["company", "employer", "organization", "organisation", "institution", "school", "university", "issuer", "awarder", "publisher", "entity", "client", "name", "fluency", "level"];

function entryOf(raw: unknown, kind: ResumeSectionKind): ResumeEntry | null {
  if (typeof raw === "string") {
    const text = str(raw, 160);
    return text ? { id: newResumeId("e"), title: text, org: "", location: "", dates: "", link: "", bullets: [] } : null;
  }
  if (!isObject(raw)) return null;
  if (raw.visible === false || raw.hidden === true) return null;
  let [title, titleKey] = pick(raw, TITLE_KEYS, 160, "");
  if (kind === "education") {
    const area = str(raw.area ?? raw.field ?? raw.fieldOfStudy ?? raw.major, 80);
    const degree = str(raw.studyType ?? raw.degree, 80);
    if (degree || area) {
      title = [degree, area].filter(Boolean).join(", ").slice(0, 160);
      titleKey = "degree";
    }
  }
  const [org] = pick(raw, ORG_KEYS, 160, titleKey);
  const url = raw.url ?? raw.link ?? raw.website;
  const entry: ResumeEntry = {
    id: newResumeId("e"),
    title,
    org: org === title ? "" : org,
    location: placeOf(raw.location ?? raw.place ?? raw.city),
    dates: datesOf(raw),
    link: str(isObject(url) ? url.href : url, 300),
    bullets: bulletsOf(raw),
  };
  return entry.title || entry.org || entry.bullets.length ? entry : null;
}

function sectionKind(key: string): ResumeSectionKind {
  if (/work|experience|employment|job|internship|career|position/i.test(key)) return "experience";
  if (/project|portfolio/i.test(key)) return "projects";
  if (/education|stud(y|ies)|school|academic|degree/i.test(key)) return "education";
  return "custom";
}

function humanize(key: string): string {
  const spaced = key.replace(/[_-]+/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").trim();
  return (spaced.charAt(0).toUpperCase() + spaced.slice(1)).slice(0, 60);
}

const NOT_SECTIONS = /^(basics|personal(info|details)?|contact|header|profile|meta|metadata|settings|theme|skills?|technicalSkills|skillGroups|links|profiles|socials|summary|about|objective|id|\$schema)$/i;

function skillGroupsOf(data: Json): Resume["skills"] {
  const groups: Resume["skills"] = [];
  const push = (name: string, items: unknown) => {
    const raw = Array.isArray(items) ? items : typeof items === "string" ? items.split(/[,;|•·]/) : [];
    const list = raw.map((k) => str(isObject(k) ? (k.name ?? k.keyword ?? k.skill) : k, 60)).filter(Boolean);
    if (list.length && groups.length < 12) {
      groups.push({ id: newResumeId("k"), name: name.slice(0, 60) || "Skills", items: [...new Set(list)].slice(0, 50) });
    }
  };
  for (const key of ["skills", "technicalSkills", "skillGroups"]) {
    const holder = data[key];
    const value = isObject(holder) && Array.isArray(holder.items) ? holder.items : holder;
    if (Array.isArray(value)) {
      if (value.every((v) => typeof v === "string")) {
        push("Skills", value);
        continue;
      }
      const loose: unknown[] = [];
      for (const group of value) {
        const items = isObject(group) ? (group.keywords ?? group.items ?? group.skills ?? group.list) : undefined;
        if (isObject(group) && items) push(str(group.name ?? group.category ?? group.title, 60), items);
        else loose.push(group);
      }
      if (loose.length) push("Skills", loose);
    } else if (isObject(value)) {
      for (const [name, items] of Object.entries(value)) push(humanize(name), items);
    } else if (typeof value === "string") {
      push("Skills", value);
    }
  }
  return groups;
}

function firstObject(...values: unknown[]): Json | null {
  for (const v of values) if (isObject(v)) return v;
  return null;
}

/**
 * Imports resume JSON from most tools: JSON Resume (jsonresume.org), Reactive
 * Resume, and hand-written JSON with sections like "experience", "projects",
 * "awards" or "certifications". Every list of entries becomes a section, so
 * nothing in the file is silently dropped.
 */
export function fromJsonResume(value: unknown): Resume | null {
  if (!isObject(value)) return null;
  const data = firstObject(value.resume, value.data) ?? value;
  const basics = firstObject(data.basics, data.personal, data.personalInfo, data.personalDetails, data.contact, data.header) ?? data;

  const fullName =
    str(basics.name ?? basics.fullName, 120) || [str(basics.firstName, 60), str(basics.lastName, 60)].filter(Boolean).join(" ");
  const links: Resume["basics"]["links"] = [];
  const addLink = (label: string, url: unknown) => {
    const href = str(isObject(url) ? (url.href ?? url.url) : url, 300);
    if (href && links.length < 6 && !links.some((l) => l.url === href)) links.push({ label: label.slice(0, 40) || "Link", url: href });
  };
  addLink("Website", basics.url ?? basics.website);
  for (const p of [...asList(basics.profiles), ...asList(data.profiles), ...asList(basics.links), ...asList(data.links), ...asList(basics.socials)]) {
    if (isObject(p)) addLink(str(p.network ?? p.label ?? p.name, 40) || "Profile", p.url ?? p.href ?? p.link);
    else addLink("Link", p);
  }
  for (const key of ["linkedin", "github", "portfolio"]) addLink(humanize(key), basics[key] ?? data[key]);

  const sectionsHolder = isObject(data.sections) ? data.sections : null;
  const summarySource = basics.summary ?? data.summary ?? data.profile ?? data.about ?? data.objective ?? sectionsHolder?.summary;
  const resume: Resume = {
    version: 1,
    basics: {
      name: fullName,
      headline: str(basics.label ?? basics.headline ?? basics.title ?? basics.jobTitle, 160),
      email: str(basics.email, 200),
      phone: str(basics.phone ?? basics.phoneNumber, 40),
      location: placeOf(basics.location ?? basics.address ?? basics.city),
      links,
    },
    summary: str(isObject(summarySource) ? (summarySource.content ?? summarySource.text) : summarySource, 1500),
    sections: [],
    skills: skillGroupsOf(sectionsHolder ? { ...data, ...sectionsHolder } : data),
  };

  // Candidate sections: top-level arrays, Reactive Resume's sections.{key}.items, or a sections array.
  const candidates: [string, string, unknown[]][] = [];
  for (const [key, v] of Object.entries(data)) {
    if (!NOT_SECTIONS.test(key) && Array.isArray(v)) candidates.push([key, humanize(key), v]);
  }
  if (sectionsHolder) {
    for (const [key, v] of Object.entries(sectionsHolder)) {
      if (NOT_SECTIONS.test(key) || !isObject(v) || v.visible === false) continue;
      if (Array.isArray(v.items)) candidates.push([key, str(v.name ?? v.title, 60) || humanize(key), v.items]);
    }
  } else if (Array.isArray(data.sections)) {
    candidates.splice(candidates.findIndex(([key]) => key === "sections"), 1);
    for (const v of data.sections) {
      const items = isObject(v) ? (v.items ?? v.entries) : undefined;
      if (isObject(v) && Array.isArray(items)) {
        const title = str(v.title ?? v.name, 60) || "Section";
        candidates.push([`${str(v.kind ?? v.type, 30)} ${title}`, title, items]);
      }
    }
  }

  const order: Record<ResumeSectionKind, number> = { education: 0, experience: 1, projects: 2, custom: 3 };
  const sections: ResumeSection[] = [];
  for (const [key, title, items] of candidates) {
    const kind = sectionKind(key);
    const entries = items.map((item) => entryOf(item, kind)).filter((e): e is ResumeEntry => e !== null).slice(0, 25);
    if (!entries.length) continue;
    sections.push({ id: newResumeId("s"), kind, title: kind === "custom" ? title : SECTION_TITLES[kind], entries });
  }
  resume.sections = sections.sort((a, b) => order[a.kind] - order[b.kind]).slice(0, 10);

  if (!resume.basics.name && !resume.basics.email && !resume.sections.length && !resume.skills.length) return null;
  const parsed = resumeSchema.safeParse(resume);
  return parsed.success ? parsed.data : null;
}

import type { Resume } from "../resume/schema";

/** Form fields every ATS asks for, filled from the resume and profile. */
export type StandardField =
  | "first_name"
  | "last_name"
  | "full_name"
  | "preferred_name"
  | "email"
  | "phone"
  | "location"
  | "linkedin"
  | "github"
  | "website"
  | "resume"
  | "cover_letter"
  | "current_company"
  | "school"
  | "degree"
  | "graduation";

export interface FieldHints {
  label: string;
  name?: string | null;
  id?: string | null;
  autocomplete?: string | null;
  type?: string | null;
}

const RULES: [StandardField, RegExp][] = [
  ["resume", /\b(resume|résumé|cv|curriculum vitae)\b/i],
  ["cover_letter", /\bcover ?letter\b/i],
  ["preferred_name", /\b(preferred|nick) ?(first )?name\b/i],
  ["first_name", /\b(first|given|fore) ?name\b/i],
  ["last_name", /\b(last|family|sur) ?name\b|\bsurname\b/i],
  ["email", /\be-?mail\b/i],
  ["phone", /\b(phone|mobile|telephone|cell)\b/i],
  ["linkedin", /\blinked ?in\b/i],
  ["github", /\bgit ?hub\b/i],
  ["website", /\b(website|portfolio|personal (site|url|page)|other (website|link)|url)\b/i],
  ["current_company", /\b(current|most recent) (company|employer)\b|\borg(anization)?\b$/i],
  ["school", /\b(school|university|college|institution)\b/i],
  ["degree", /\b(degree|discipline|field of study|major)\b/i],
  ["graduation", /\bgraduat(e|ion)\b.*\b(date|year)\b|\b(expected )?graduation\b/i],
  ["location", /\b(location|city|where are you (currently )?(based|located)|current address|address)\b/i],
  ["full_name", /^\s*(full |legal )?name\s*[*✱]?\s*$/i],
];

/** Hints from HTML attributes that are reliable on Greenhouse, Lever and Ashby. */
const NAME_HINTS: [StandardField, RegExp][] = [
  ["first_name", /^(first_name|firstname|_systemfield_first_name)$/i],
  ["last_name", /^(last_name|lastname|_systemfield_last_name)$/i],
  ["full_name", /^(name|_systemfield_name|full_name)$/i],
  ["email", /^(email|_systemfield_email)$/i],
  ["phone", /^(phone|_systemfield_phone)$/i],
  ["location", /^(location|_systemfield_location)$/i],
  ["resume", /^(resume|_systemfield_resume)$/i],
  ["cover_letter", /^(cover_letter|_systemfield_cover_letter)$/i],
  ["linkedin", /^urls\[linkedin\]$/i],
  ["github", /^urls\[github\]$/i],
  ["website", /^urls\[(portfolio|other|website)\]$/i],
  ["current_company", /^org$/i],
];

const AUTOCOMPLETE: Record<string, StandardField> = {
  "given-name": "first_name",
  "family-name": "last_name",
  name: "full_name",
  email: "email",
  tel: "phone",
  organization: "current_company",
  url: "website",
};

export function classifyField(hints: FieldHints): StandardField | null {
  for (const key of [hints.name, hints.id]) {
    if (!key) continue;
    for (const [field, pattern] of NAME_HINTS) if (pattern.test(key)) return field;
  }
  const auto = hints.autocomplete?.trim().toLowerCase();
  if (auto && AUTOCOMPLETE[auto]) return AUTOCOMPLETE[auto]!;
  if (hints.type === "email") return "email";
  if (hints.type === "tel") return "phone";

  const label = hints.label.replace(/\s+/g, " ").trim();
  // Long labels are questions ("Why do you want to work here?"), not fields.
  if (!label || label.length > 80) return null;
  // "Will you require visa sponsorship?" mentions none of the above; "LinkedIn Profile / Website" is a link.
  for (const [field, pattern] of RULES) if (pattern.test(label)) return field;
  return null;
}

export interface ApplicantProfile {
  firstName: string;
  lastName: string;
  fullName: string;
  email: string;
  phone: string;
  location: string;
  linkedin: string;
  github: string;
  website: string;
  currentCompany: string;
  school: string;
  degree: string;
  graduation: string;
}

function linkFor(resume: Resume, pattern: RegExp): string {
  return resume.basics.links.find((l) => pattern.test(`${l.label} ${l.url}`))?.url ?? "";
}

function absolute(url: string): string {
  if (!url) return "";
  return /^https?:\/\//i.test(url) ? url : `https://${url.replace(/^\/+/, "")}`;
}

/** Contact details and basics for forms, from the resume being sent. */
export function applicantProfile(resume: Resume, fallback: { fullName?: string | null; email?: string | null; phone?: string | null; location?: string | null } = {}): ApplicantProfile {
  const fullName = (resume.basics.name || fallback.fullName || "").trim();
  const parts = fullName.split(/\s+/).filter(Boolean);
  const experience = resume.sections.find((s) => s.kind === "experience")?.entries[0];
  const education = resume.sections.find((s) => s.kind === "education")?.entries[0];
  const years = education?.dates.match(/(?:19|20)\d{2}/g) ?? [];
  const website = resume.basics.links.find((l) => !/linkedin|github/i.test(`${l.label} ${l.url}`))?.url ?? "";
  return {
    firstName: parts[0] ?? "",
    lastName: parts.length > 1 ? parts.slice(1).join(" ") : "",
    fullName,
    email: (resume.basics.email || fallback.email || "").trim(),
    phone: (resume.basics.phone || fallback.phone || "").trim(),
    location: (resume.basics.location || fallback.location || "").trim(),
    linkedin: absolute(linkFor(resume, /linkedin/i)),
    github: absolute(linkFor(resume, /github/i)),
    website: absolute(website),
    currentCompany: experience && /present|current|now/i.test(experience.dates) ? experience.org : "",
    school: education?.org ?? "",
    degree: education?.title ?? "",
    graduation: years.at(-1) ?? "",
  };
}

/** The value for a standard field, or "" when the profile doesn't have it. */
export function standardValue(field: StandardField, profile: ApplicantProfile): string {
  switch (field) {
    case "first_name":
    case "preferred_name":
      return profile.firstName;
    case "last_name":
      return profile.lastName;
    case "full_name":
      return profile.fullName;
    case "email":
      return profile.email;
    case "phone":
      return profile.phone;
    case "location":
      return profile.location;
    case "linkedin":
      return profile.linkedin;
    case "github":
      return profile.github;
    case "website":
      return profile.website || profile.github || profile.linkedin;
    case "current_company":
      return profile.currentCompany;
    case "school":
      return profile.school;
    case "degree":
      return profile.degree;
    case "graduation":
      return profile.graduation;
    case "resume":
    case "cover_letter":
      return "";
  }
}

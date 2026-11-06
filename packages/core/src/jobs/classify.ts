import type {
  EmploymentType,
  ExperienceLevel,
  JobCategory,
  VisaSponsorship,
  WorkplaceType,
} from "./job";

/**
 * Rule-based classifiers. Cheap, deterministic and explainable: they run on
 * every ingested job, and the AI only ever looks at jobs that pass them.
 * Sources that state a value explicitly always win over these guesses.
 */

type Rule<T> = readonly [RegExp, T];

function firstMatch<T>(text: string, rules: readonly Rule<T>[], fallback: T): T {
  for (const [pattern, value] of rules) {
    if (pattern.test(text)) return value;
  }
  return fallback;
}

const LEVEL_RULES: readonly Rule<ExperienceLevel>[] = [
  [/\b(intern|internship|co-?op|praktikant(in)?|praktikum|werkstudent(in)?|working student|student|apprentice(ship)?|stagiaire|stage|thesis|abschlussarbeit|masterarbeit|bachelorarbeit)\b/i, "intern"],
  [/\b(staff|principal|distinguished|head of|director|vp|vice president|engineering manager|architect)\b/i, "lead"],
  [/\b(lead|team lead|tech lead)\b/i, "lead"],
  [/\b(senior|sr\.?|expert)\b|\b(iii|iv)\s*$/i, "senior"],
  [/\b(junior|jr\.?|graduate|new grad(uate)?|entry[- ]level|early career|university grad(uate)?|campus|trainee)\b|\b(engineer|developer|analyst)\s+i\b/i, "entry"],
  [/\b(mid[- ]level|intermediate)\b|\b(engineer|developer|analyst)\s+ii\b/i, "mid"],
];

export function inferExperienceLevel(title: string): ExperienceLevel {
  return firstMatch(title, LEVEL_RULES, "unknown");
}

const CATEGORY_RULES: readonly Rule<JobCategory>[] = [
  [/\b(machine learning|ml|ai|artificial intelligence|deep learning|llm|nlp|computer vision|research scientist|applied scientist|mlops)\b/i, "ml_ai"],
  [/\b(data (engineer|scientist|science|analyst|analytics|architect|platform)|analytics engineer|business intelligence|bi (developer|engineer|analyst)|data warehouse)\b/i, "data"],
  [/\b(security|secops|appsec|devsecops|penetration|pentest|cyber|soc analyst)\b/i, "security"],
  [/\b(devops|sre|site reliability|platform engineer(ing)?|infrastructure|cloud (engineer|architect)|kubernetes|systems engineer)\b/i, "devops_sre"],
  [/\b(qa|quality assurance|sdet|test automation|(software )?test(ing)? engineer)\b/i, "qa"],
  [/\b(designer|ux|ui\/ux|product design|interaction design)\b/i, "design"],
  [/\b(product (manager|owner|lead)|technical program manager|tpm)\b/i, "product"],
  [/\b(it support|helpdesk|help desk|service desk|system administrator|sysadmin|it specialist|desktop support)\b/i, "it_support"],
  // Non-engineering roles that happen to say "engineer" or "developer".
  [/\b(sales|account executive|account manager|business development|recruit(er|ing)|marketing|finance|accountant|legal|counsel|customer success|people partner)\b/i, "other"],
  [/\b(software|developer|engineer(ing)?|programmer|frontend|front-end|backend|back-end|full[- ]?stack|mobile|ios|android|web|swe|entwickler(in)?|développeur)\b/i, "software_engineering"],
];

export function inferCategory(title: string): JobCategory {
  return firstMatch(title, CATEGORY_RULES, "other");
}

const EMPLOYMENT_RULES: readonly Rule<EmploymentType>[] = [
  [/\b(intern|internship|praktikum|praktikant(in)?|apprentice(ship)?|stage)\b/i, "internship"],
  [/\b(werkstudent(in)?|working student|part[- ]time|teilzeit)\b/i, "part_time"],
  [/\b(temporary|fixed[- ]term|befristet|seasonal)\b/i, "temporary"],
  [/\b(contract(or)?|freelance(r)?|consultant \(contract\))\b/i, "contract"],
  [/\b(full[- ]time|vollzeit|permanent|unbefristet)\b/i, "full_time"],
];

/** Classify free text such as a title or a source's "commitment" field. */
export function inferEmploymentType(...texts: (string | null | undefined)[]): EmploymentType {
  const text = texts.filter(Boolean).join(" ");
  return firstMatch(text, EMPLOYMENT_RULES, "unknown");
}

export function inferWorkplace(...texts: (string | null | undefined)[]): WorkplaceType {
  const text = texts.filter(Boolean).join(" ");
  if (/\bhybrid\b/i.test(text)) return "hybrid";
  if (/\b(remote|fully remote|work from home|wfh|home[- ]?office|anywhere)\b/i.test(text)) return "remote";
  if (/\b(on[- ]?site|in[- ]office|in person)\b/i.test(text)) return "onsite";
  return "unknown";
}

const NO_SPONSORSHIP = [
  /\b(unable|not able|cannot|can ?not|can't|won't|will not|do(es)? not|don't) (to )?(offer |provide |support )?(visa )?sponsor/i,
  /\bno (visa )?sponsorship\b/i,
  /\bsponsorship (is )?not (available|offered|provided|possible)\b/i,
  /\bwithout (the need for )?(current or future )?(visa )?sponsorship\b/i,
  /\bmust (already )?(have|hold) (the )?(right|authori[sz]ation) to work\b/i,
];

const SPONSORSHIP_OFFERED = [
  /\b(visa|work permit) sponsorship (is )?(available|offered|provided|possible)\b/i,
  /\bwe (can |will |are able to |do )?(offer |provide )?(visa )?sponsor(ship)?\b/i,
  /\b(visa|relocation and visa|immigration) (support|assistance)\b/i,
  /\bsponsor(ing|s)? (your |a |the )?(work )?visa\b/i,
];

/** Negative statements are checked first: "we cannot offer visa sponsorship" must never read as yes. */
export function detectVisaSponsorship(text: string): VisaSponsorship {
  if (NO_SPONSORSHIP.some((pattern) => pattern.test(text))) return "no";
  if (SPONSORSHIP_OFFERED.some((pattern) => pattern.test(text))) return "yes";
  return "unknown";
}

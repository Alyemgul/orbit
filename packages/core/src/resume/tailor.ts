import { relevance, scoreResume, type JobAnalysis, type MatchScore } from "./analyze";
import { wordDiff, type DiffPart } from "./diff";
import { findKeywords } from "./keywords";
import { resumePlainText, type Resume, type ResumeEntry } from "./schema";

/**
 * Tailoring never invents anything. A tailored copy can only:
 *  - reorder bullets, project entries and skills by relevance to the post,
 *  - hide bullets the user chose to drop,
 *  - reword bullets and the summary, and only when the fact check passes.
 * A rewrite that adds a number, a skill or a name not in the master is
 * thrown away and the original line is kept.
 */

export type FactIssueKind = "new_number" | "new_skill" | "new_name" | "much_longer" | "empty";

export interface FactIssue {
  kind: FactIssueKind;
  severity: "error" | "warning";
  detail: string;
}

export interface LineChange {
  /** Bullet id, or "summary". */
  id: string;
  entryId: string | null;
  before: string;
  after: string;
  /** rewritten: new wording kept. reverted: a rewrite failed the fact check. */
  status: "unchanged" | "rewritten" | "reverted";
  proposed: string | null;
  diff: DiffPart[];
  issues: FactIssue[];
  hidden: boolean;
}

export interface TailorInput {
  /** Proposed new wording by bullet id. */
  rewrites?: Readonly<Record<string, string>>;
  summary?: string | null;
  /** Bullet ids to leave out of this copy. */
  hidden?: readonly string[];
  /** Sort bullets, projects and skills by relevance (default true). */
  reorder?: boolean;
}

export interface TailorResult {
  resume: Resume;
  changes: LineChange[];
  before: MatchScore;
  after: MatchScore;
}

const NUMBER = /\d+(?:[.,]\d+)*\s*(?:%|x\b|k\b|m\b|bn\b|\+)?/gi;
/** Acronyms and mixed-case names (AWS, GraphQL, iOS) that should exist somewhere in the master. */
const NAME = /\b(?:[A-Z]{2,}[a-z]*|[a-z]+[A-Z][A-Za-z]*|[A-Z][a-z]+[A-Z][A-Za-z]*)\b/g;
/** Capitalised words mid-sentence (Google, Berlin, Siemens): proper names, not sentence starts. */
const PROPER_NOUN = /(?<!(?:^|[.!?:;•–—-])\s*)\b\p{Lu}\p{Ll}+\b/gu;

function numbers(text: string): Set<string> {
  return new Set((text.match(NUMBER) ?? []).map((n) => n.replace(/[\s,]/g, "").toLowerCase()));
}

export interface FactContext {
  /** The text a rewrite may draw numbers from (the same entry, or the whole master for the summary). */
  sourceText: string;
  masterText: string;
  masterKeywords: ReadonlySet<string>;
}

export function factContext(master: Resume, entry: ResumeEntry | null): FactContext {
  const masterText = resumePlainText(master);
  const sourceText = entry
    ? [entry.title, entry.org, entry.dates, ...entry.bullets.map((b) => b.text)].join("\n")
    : masterText;
  return { sourceText, masterText, masterKeywords: findKeywords(masterText) };
}

export function factCheck(before: string, after: string, context: FactContext): FactIssue[] {
  const issues: FactIssue[] = [];
  if (!after.trim()) {
    return [{ kind: "empty", severity: "error", detail: "The rewrite was empty." }];
  }

  const allowedNumbers = numbers(context.sourceText);
  for (const n of numbers(after)) {
    if (!allowedNumbers.has(n)) issues.push({ kind: "new_number", severity: "error", detail: `Adds the number “${n}”.` });
  }

  for (const skill of findKeywords(after)) {
    if (!context.masterKeywords.has(skill)) {
      issues.push({ kind: "new_skill", severity: "error", detail: `Claims “${skill}”, which isn't in your resume.` });
    }
  }

  const masterLower = context.masterText.toLowerCase();
  // Skills already reported above aren't reported again as names.
  const seen = new Set(issues.filter((i) => i.kind === "new_skill").map((i) => i.detail.match(/“(.+?)”/)?.[1]?.toLowerCase() ?? ""));
  for (const name of [...(after.match(NAME) ?? []), ...(after.match(PROPER_NOUN) ?? [])]) {
    const lower = name.toLowerCase();
    if (seen.has(lower) || masterLower.includes(lower) || before.toLowerCase().includes(lower)) continue;
    seen.add(lower);
    // A company, place or product that isn't anywhere in the resume is a new claim.
    issues.push({ kind: "new_name", severity: "error", detail: `Mentions “${name}”, which isn't in your resume.` });
  }

  if (before && after.length > before.length * 1.6 + 20) {
    issues.push({ kind: "much_longer", severity: "warning", detail: "Much longer than the original." });
  }
  return issues;
}

function stableSortBy<T>(items: readonly T[], score: (item: T) => number): T[] {
  return items
    .map((item, index) => ({ item, index, value: score(item) }))
    .sort((a, b) => b.value - a.value || a.index - b.index)
    .map(({ item }) => item);
}

export function tailorResume(master: Resume, analysis: JobAnalysis, input: TailorInput = {}): TailorResult {
  const rewrites = input.rewrites ?? {};
  const hidden = new Set(input.hidden ?? []);
  const reorder = input.reorder ?? true;
  const changes: LineChange[] = [];
  const masterContext = factContext(master, null);

  function apply(id: string, entry: ResumeEntry | null, before: string, proposedRaw: string | null | undefined, context: FactContext) {
    const proposed = proposedRaw == null ? null : proposedRaw.replace(/\s+/g, " ").trim().slice(0, 600);
    let after = before;
    let status: LineChange["status"] = "unchanged";
    let issues: FactIssue[] = [];
    if (proposed !== null && proposed !== before) {
      issues = factCheck(before, proposed, context);
      if (issues.some((issue) => issue.severity === "error")) {
        status = "reverted";
      } else {
        after = proposed;
        status = "rewritten";
      }
    }
    changes.push({
      id,
      entryId: entry?.id ?? null,
      before,
      after,
      status,
      proposed,
      diff: wordDiff(before, after),
      issues,
      hidden: hidden.has(id),
    });
    return after;
  }

  const summary = master.summary ? apply("summary", null, master.summary, input.summary, masterContext) : master.summary;

  const sections = master.sections.map((section) => {
    const entries = section.entries.map((entry) => {
      const context = factContext(master, entry);
      const bullets = entry.bullets
        .filter((bullet) => bullet.text)
        .map((bullet) => ({ id: bullet.id, text: apply(bullet.id, entry, bullet.text, rewrites[bullet.id], context) }))
        .filter((bullet) => !hidden.has(bullet.id));
      return {
        ...entry,
        bullets: reorder ? stableSortBy(bullets, (b) => relevance(b.text, analysis)) : bullets,
      };
    });
    // Jobs and degrees stay chronological; projects lead with the most relevant.
    const sorted =
      reorder && section.kind === "projects"
        ? stableSortBy(entries, (e) => relevance([e.title, e.org, ...e.bullets.map((b) => b.text)].join(" "), analysis))
        : entries;
    return { ...section, entries: sorted };
  });

  const wanted = new Set(analysis.keywords.map((k) => k.label));
  const skills = master.skills.map((group) => ({
    ...group,
    items: reorder
      ? stableSortBy(group.items, (item) => ([...findKeywords(item)].some((label) => wanted.has(label)) ? 1 : 0))
      : group.items,
  }));

  const resume: Resume = { ...master, summary, sections, skills };
  return { resume, changes, before: scoreResume(master, analysis), after: scoreResume(resume, analysis) };
}

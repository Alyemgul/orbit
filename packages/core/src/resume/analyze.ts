import { countKeywords, findKeywords } from "./keywords";
import { resumePlainText, type Resume } from "./schema";

export interface JobKeyword {
  label: string;
  /** Higher means the post leans on it more (title, repetition, "must have"). */
  weight: number;
  /** Only mentioned under a "nice to have" style heading. */
  optional: boolean;
}

export interface JobAnalysis {
  keywords: JobKeyword[];
}

export interface MatchScore {
  /** 0–100, or null when the post names too few skills to judge. */
  score: number | null;
  matched: JobKeyword[];
  missing: JobKeyword[];
}

const OPTIONAL_HEADING =
  /^\s*(?:[-*•#]\s*)?(?:nice[\s-]to[\s-]haves?|bonus(?: points)?|preferred(?: qualifications)?|pluses|it'?s a plus|good to have|desirable|extra credit)\b.*$/im;
const ANY_HEADING =
  /^\s*(?:[-*•#]\s*)?(?:about|what you|who you|requirements|qualifications|responsibilities|you will|you have|we offer|benefits|the role|your profile|must[\s-]haves?)\b.*$/gim;

/** Splits a post into its core part and any "nice to have" part. */
function splitOptional(description: string): { core: string; optional: string } {
  const start = description.search(OPTIONAL_HEADING);
  if (start < 0) return { core: description, optional: "" };
  // Look for the next heading after the "nice to have" line itself.
  const lineEnd = description.indexOf("\n", start + 1);
  if (lineEnd < 0) return { core: description.slice(0, start), optional: description.slice(start) };
  const rest = description.slice(lineEnd);
  ANY_HEADING.lastIndex = 0;
  const next = ANY_HEADING.exec(rest);
  const end = next ? lineEnd + next.index : description.length;
  return {
    core: description.slice(0, start) + description.slice(end),
    optional: description.slice(start, end),
  };
}

export function analyzeJob(title: string, description: string): JobAnalysis {
  const { core, optional } = splitOptional(description.slice(0, 20_000));
  const inTitle = findKeywords(title);
  const coreCounts = countKeywords(core);
  const optionalCounts = countKeywords(optional);

  const labels = new Set([...inTitle, ...coreCounts.keys(), ...optionalCounts.keys()]);
  const keywords: JobKeyword[] = [];
  for (const label of labels) {
    const coreCount = coreCounts.get(label) ?? 0;
    const isOptional = coreCount === 0 && !inTitle.has(label);
    let weight = isOptional ? 0.5 : 1 + Math.min(coreCount - 1, 3) * 0.25;
    if (inTitle.has(label)) weight += 1.5;
    keywords.push({ label, weight: Math.round(weight * 100) / 100, optional: isOptional });
  }
  keywords.sort((a, b) => b.weight - a.weight || a.label.localeCompare(b.label));
  return { keywords };
}

/** Fewer skills than this and a percentage would mean little. */
const MIN_KEYWORDS = 3;

export function scoreResume(resume: Resume, analysis: JobAnalysis): MatchScore {
  const present = findKeywords(resumePlainText(resume));
  const matched: JobKeyword[] = [];
  const missing: JobKeyword[] = [];
  let total = 0;
  let hit = 0;
  for (const keyword of analysis.keywords) {
    total += keyword.weight;
    if (present.has(keyword.label)) {
      hit += keyword.weight;
      matched.push(keyword);
    } else {
      missing.push(keyword);
    }
  }
  const score = analysis.keywords.length < MIN_KEYWORDS || total === 0 ? null : Math.round((hit / total) * 100);
  return { score, matched, missing };
}

/** Relevance of one piece of text to the post: summed weight of the post's skills it names. */
export function relevance(text: string, analysis: JobAnalysis): number {
  if (!text) return 0;
  const found = findKeywords(text);
  let sum = 0;
  for (const keyword of analysis.keywords) if (found.has(keyword.label)) sum += keyword.weight;
  return sum;
}

import { z } from "zod";

/**
 * Answer memory. A screening question is remembered by its normalized text,
 * so the same question on another company's form is answered the same way.
 */

/** Lower-case, no punctuation, no "required" markers, single spaces. */
export function normalizeQuestion(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[*✱]/g, " ")
    .replace(/\((?:required|optional)\)/g, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500);
}

/** SHA-256 (hex) of the normalized question: the key stored in screening_answers. */
export async function questionHash(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(normalizeQuestion(text));
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Work authorization, visa and equal-opportunity questions. These are only
 * ever answered from the user's own saved answers, never guessed.
 */
const SENSITIVE =
  /\b(authori[sz]ed|authori[sz]ation|right to work|work permit|visa|sponsor|sponsorship|immigration|citizen|citizenship|nationality|residency|residence permit|gender|sex|pronouns?|race|racial|ethnic|ethnicity|hispanic|latin[oax]|veteran|military|disabilit|disabled|sexual orientation|transgender|lgbt|religio|criminal|convict|age|date of birth|birth ?date|salary|compensation|notice period)\b/i;

export function isSensitiveQuestion(text: string): boolean {
  return SENSITIVE.test(text);
}

/** Agreeing to the company's privacy or data-processing notice. */
export function isPrivacyConsent(text: string): boolean {
  return (
    /\b(privacy (notice|policy|statement)|data (processing|protection)|gdpr|personal data|candidate privacy)\b/i.test(text) &&
    /\b(agree|consent|acknowledge|accept|confirm|read|received)\b/i.test(text) &&
    !isMarketingConsent(text)
  );
}

/** Opting in to future emails or talent pools: never ticked automatically. */
export function isMarketingConsent(text: string): boolean {
  return /\b(future (job )?(opportunit|openings|roles|positions)|talent (pool|community)|newsletter|marketing|keep (me|my) (in mind|details)|contact me about)\b/i.test(
    text,
  );
}

export const answerValueSchema = z.union([
  z.string().trim().min(1).max(3000),
  z.array(z.string().trim().min(1).max(300)).min(1).max(20),
]);
export type AnswerValue = z.infer<typeof answerValueSchema>;

export interface SavedAnswer {
  questionText: string;
  answer: AnswerValue;
  sensitive: boolean;
}

/** Finds a saved answer for a question, by normalized text. */
export function findAnswer(question: string, saved: readonly SavedAnswer[]): SavedAnswer | null {
  const key = normalizeQuestion(question);
  if (!key) return null;
  return saved.find((s) => normalizeQuestion(s.questionText) === key) ?? null;
}

function simplify(text: string): string {
  return normalizeQuestion(text);
}

/**
 * The option that best matches a saved answer: exact (ignoring case and
 * punctuation) first, then one containing the other. Null when unsure.
 */
export function matchOption(answer: string, options: readonly string[]): string | null {
  const want = simplify(answer);
  if (!want) return null;
  const exact = options.find((o) => simplify(o) === want);
  if (exact !== undefined) return exact;
  // "Yes" should match "Yes, I am authorized", but never "No, ..." for "No" vs "Not sure".
  const starts = options.filter((o) => {
    const s = simplify(o);
    return s.startsWith(`${want} `) || want.startsWith(`${s} `);
  });
  return starts.length === 1 ? starts[0]! : null;
}

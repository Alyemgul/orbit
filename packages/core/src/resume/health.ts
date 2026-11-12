import { resumeBullets, type Resume } from "./schema";

/** Irregular past forms and present-tense verbs (current roles: "Support…", "Coordinate…"). */
const VERBS = new Set(
  (
    "built rebuilt wrote rewrote oversaw undertook spun ran led won cut taught made shipped sold held drew drove grew kept met set spoke took thought brought began found " +
    "build write run lead teach make ship design develop implement create launch improve reduce increase automate migrate optimize optimise " +
    "deploy analyze analyse organize organise manage deliver research train refactor integrate maintain own found mentor contribute move add " +
    "support coordinate evaluate test secure combine detect expose pair rebuild rewrite restructure resolve verify containerize containerise " +
    "plan present publish review collaborate partner engineer architect prototype model simulate measure monitor document translate host " +
    "facilitate guide tutor assist produce edit configure benchmark scale debug fix ensure drive launch establish streamline"
  ).split(/\s+/),
);

/** Words ending in -ed / -ing that open a bullet without being an action. */
const NOT_ACTIONS = new Set([
  "based", "skilled", "experienced", "interested", "motivated", "detailed", "dedicated", "talented", "advanced", "related",
  "need", "needed", "red", "bed", "seed", "speed", "used", "during", "using", "including", "working", "being", "having", "according",
]);

export function startsWithActionVerb(text: string): boolean {
  const word = text.trim().match(/^\p{L}+/u)?.[0]?.toLowerCase();
  if (!word || NOT_ACTIONS.has(word)) return false;
  if (VERBS.has(word)) return true;
  // Regular past tense (Evaluated, Containerized, Verified) and current work (Deploying, Building).
  return (word.length > 4 && word.endsWith("ed")) || (word.length > 5 && word.endsWith("ing"));
}

export interface HealthCheck {
  ok: boolean;
  label: string;
}

export function resumeHealth(resume: Resume): { score: number; checks: HealthCheck[]; bullets: number; skills: number } {
  const bullets = resumeBullets(resume).map((b) => b.bullet.text).filter(Boolean);
  const withNumber = bullets.filter((t) => /\d/.test(t)).length;
  const withVerb = bullets.filter((t) => startsWithActionVerb(t)).length;
  const long = bullets.filter((t) => t.split(/\s+/).length > 35).length;
  const skills = resume.skills.reduce((n, g) => n + g.items.length, 0);
  const share = (n: number) => (bullets.length ? n / bullets.length : 0);

  const checks: HealthCheck[] = [
    { ok: Boolean(resume.basics.name && resume.basics.email), label: "Name and email filled in" },
    { ok: bullets.length >= 6, label: `At least 6 bullets (${bullets.length})` },
    { ok: share(withNumber) >= 0.5, label: `Half your bullets show a number or result (${withNumber}/${bullets.length})` },
    { ok: share(withVerb) >= 0.7, label: `Bullets start with an action verb (${withVerb}/${bullets.length})` },
    { ok: long === 0, label: long ? `${long} bullet${long > 1 ? "s" : ""} over 35 words` : "Bullets are short enough to skim" },
    { ok: skills >= 6, label: `6+ skills listed (${skills})` },
  ];
  return { score: Math.round((checks.filter((c) => c.ok).length / checks.length) * 100), checks, bullets: bullets.length, skills };
}

/**
 * Application lifecycle.
 *
 * Every application moves through this state machine. The web app, the
 * tailoring function and the browser extension all validate transitions
 * against the same table, so the tracker can never end up in a state that
 * no actor could have produced.
 */

export const APPLICATION_STATUSES = [
  "saved",
  "queued",
  "tailoring",
  "ready",
  "submitting",
  "needs_input",
  "failed",
  "applied",
  "interviewing",
  "offer",
  "rejected",
  "archived",
] as const;

export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

export const STATUS_LABELS: Record<ApplicationStatus, string> = {
  saved: "Saved",
  queued: "Queued",
  tailoring: "Tailoring resume",
  ready: "Ready to send",
  submitting: "Submitting",
  needs_input: "Needs you",
  failed: "Failed",
  applied: "Applied",
  interviewing: "Interviewing",
  offer: "Offer",
  rejected: "Rejected",
  archived: "Archived",
};

/** Statuses a closed application may be restored to from the archive. */
const RESTORABLE: readonly ApplicationStatus[] = [
  "saved",
  "applied",
  "interviewing",
  "offer",
  "rejected",
];

/**
 * States a new application may start in: saved (swipe up), queued (swipe
 * right) or applied (tracking a job applied to outside Orbit).
 */
export const ENTRY_STATUSES = ["saved", "queued", "applied"] as const satisfies readonly ApplicationStatus[];

export const APPLICATION_TRANSITIONS: Readonly<Record<ApplicationStatus, readonly ApplicationStatus[]>> = {
  // "applied" is allowed directly for jobs the user applied to outside Orbit.
  saved: ["queued", "applied", "archived"],
  // "applied" covers applying by hand before the autopilot gets to it.
  // "submitting" lets the autopilot send the master resume when no tailored copy was made.
  queued: ["tailoring", "submitting", "failed", "applied", "archived"],
  tailoring: ["ready", "failed", "archived"],
  // "ready" is where review-before-send mode parks an application.
  ready: ["submitting", "applied", "archived"],
  submitting: ["applied", "needs_input", "failed"],
  // "ready" puts it back in the autopilot's queue once the user has answered.
  needs_input: ["ready", "submitting", "applied", "archived"],
  failed: ["queued", "applied", "archived"],
  applied: ["interviewing", "offer", "rejected", "archived"],
  interviewing: ["offer", "rejected", "archived"],
  offer: ["rejected", "archived"],
  rejected: ["archived"],
  archived: RESTORABLE,
};

export function canTransition(from: ApplicationStatus, to: ApplicationStatus): boolean {
  return APPLICATION_TRANSITIONS[from].includes(to);
}

export function nextStatuses(from: ApplicationStatus): readonly ApplicationStatus[] {
  return APPLICATION_TRANSITIONS[from];
}

export class InvalidTransitionError extends Error {
  constructor(
    readonly from: ApplicationStatus,
    readonly to: ApplicationStatus,
  ) {
    super(`Invalid application transition: ${from} -> ${to}`);
    this.name = "InvalidTransitionError";
  }
}

export function assertTransition(from: ApplicationStatus, to: ApplicationStatus): void {
  if (!canTransition(from, to)) {
    throw new InvalidTransitionError(from, to);
  }
}

export function isApplicationStatus(value: unknown): value is ApplicationStatus {
  return typeof value === "string" && (APPLICATION_STATUSES as readonly string[]).includes(value);
}

/**
 * Board columns. The autopilot's in-flight states are grouped into one
 * "Applying" column so the board stays readable; the card itself shows the
 * precise status. Rejected and archived applications live in the archive view.
 */
export const PIPELINE_COLUMNS = [
  { id: "saved", label: "Saved", statuses: ["saved"] },
  {
    id: "applying",
    label: "Applying",
    statuses: ["queued", "tailoring", "ready", "submitting", "needs_input", "failed"],
  },
  { id: "applied", label: "Applied", statuses: ["applied"] },
  { id: "interviewing", label: "Interviewing", statuses: ["interviewing"] },
  { id: "offer", label: "Offer", statuses: ["offer"] },
] as const satisfies readonly {
  id: string;
  label: string;
  statuses: readonly ApplicationStatus[];
}[];

export type PipelineColumnId = (typeof PIPELINE_COLUMNS)[number]["id"];

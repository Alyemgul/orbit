import { describe, expect, it } from "vitest";
import {
  APPLICATION_STATUSES,
  InvalidTransitionError,
  PIPELINE_COLUMNS,
  assertTransition,
  canTransition,
  isApplicationStatus,
  type ApplicationStatus,
} from "./application-status";

describe("application state machine", () => {
  it("follows the autopilot happy path", () => {
    const path = ["saved", "queued", "tailoring", "ready", "submitting", "applied"] as const;
    for (let i = 0; i < path.length - 1; i++) {
      expect(canTransition(path[i]!, path[i + 1]!)).toBe(true);
    }
  });

  it("lets a stuck submission be finished by the user", () => {
    expect(canTransition("submitting", "needs_input")).toBe(true);
    expect(canTransition("needs_input", "submitting")).toBe(true);
    expect(canTransition("needs_input", "applied")).toBe(true);
  });

  it("allows retrying a failed application", () => {
    expect(canTransition("failed", "queued")).toBe(true);
  });

  it("rejects skipping the pipeline", () => {
    expect(canTransition("queued", "applied")).toBe(false);
    expect(canTransition("offer", "applied")).toBe(false);
    expect(() => assertTransition("rejected", "offer")).toThrow(InvalidTransitionError);
  });

  it("never allows a self-transition", () => {
    for (const status of APPLICATION_STATUSES) {
      expect(canTransition(status, status)).toBe(false);
    }
  });

  it("places every active status in exactly one board column", () => {
    const placed: ApplicationStatus[] = PIPELINE_COLUMNS.flatMap((column) => [...column.statuses]);
    expect(new Set(placed).size).toBe(placed.length);
    const closed = APPLICATION_STATUSES.filter((s) => !placed.includes(s));
    expect(closed.sort()).toEqual(["archived", "rejected"]);
  });

  it("narrows unknown values", () => {
    expect(isApplicationStatus("applied")).toBe(true);
    expect(isApplicationStatus("hired")).toBe(false);
    expect(isApplicationStatus(42)).toBe(false);
  });
});

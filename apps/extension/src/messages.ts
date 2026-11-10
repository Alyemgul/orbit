import type { AutopilotAts } from "@orbit/core";
import type { CapturedAnswer, FillPayload, FillResult } from "./fill/fill";

/** Messages between the background worker and the script it injects into an application tab. */
export type ToContent =
  | { type: "orbit:fill"; ats: AutopilotAts | null; payload: FillPayload }
  | { type: "orbit:submit"; ats: AutopilotAts | null }
  | { type: "orbit:check"; ats: AutopilotAts | null }
  | { type: "orbit:watch"; ats: AutopilotAts | null };

export type FillResponse = FillResult & { captcha: boolean };

export type SubmitResponse =
  | { outcome: "applied" }
  | { outcome: "captcha" }
  | { outcome: "errors"; errors: string[] }
  | { outcome: "pending" }
  | { outcome: "no_button" };

export interface CheckResponse {
  success: boolean;
  captcha: boolean;
  errors: string[];
}

/** From the content script: the user pressed submit; these are the answers they gave. */
export interface CapturedMessage {
  type: "orbit:captured";
  answers: CapturedAnswer[];
}

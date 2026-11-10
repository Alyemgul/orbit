import type { Connection } from "@orbit/core";

/** Calls one of Orbit's token-authenticated database functions. */
export async function rpc<T>(connection: Connection, fn: string, args: Record<string, unknown>): Promise<T> {
  const response = await fetch(`${connection.url}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      apikey: connection.anonKey,
      authorization: `Bearer ${connection.anonKey}`,
    },
    body: JSON.stringify({ p_token: connection.token, ...args }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { message?: string } | null;
    const message = body?.message ?? `HTTP ${response.status}`;
    throw new ApiError(/invalid connection/i.test(message) ? "This connection was revoked. Paste a new code from Orbit." : message, response.status);
  }
  return (await response.json()) as T;
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export interface ExtStatus {
  email: string | null;
  cap: number;
  review: boolean;
  applied_today: number;
  waiting: number;
  needs_you: number;
}

export type NextApplication =
  | { status: "busy" | "wait" | "empty" | "no_resume"; retry_after: number }
  | { status: "cap"; retry_after: number; cap: number }
  | {
      status: "ok";
      application: { id: string; title: string; company: string; apply_url: string; ats_type: string };
      resume: unknown;
      profile: { full_name: string | null; email: string | null; phone: string | null; location: string | null };
      review: boolean;
      accept_privacy: boolean;
    };

export interface StoredAnswer {
  question: string;
  answer: unknown;
  sensitive: boolean;
}

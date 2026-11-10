import { z } from "zod";

/**
 * A connection code links the browser extension (or the Gmail script) to
 * one Orbit account. It carries the project URL, the public anon key and a
 * random token whose SHA-256 is all the database stores. The token can only
 * call the autopilot functions, and can be revoked from Profile.
 */

const PREFIX = "orbit1.";

export const connectionSchema = z.object({
  url: z
    .string()
    .url()
    .refine((u) => /^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(u) || /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(u), {
      message: "Not a Supabase project URL",
    }),
  anonKey: z.string().min(20).max(1000),
  token: z.string().regex(/^[A-Za-z0-9_-]{40,128}$/),
});

export type Connection = z.infer<typeof connectionSchema>;

function toBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(text: string): string {
  const binary = atob(text.replace(/-/g, "+").replace(/_/g, "/"));
  return new TextDecoder().decode(Uint8Array.from(binary, (c) => c.charCodeAt(0)));
}

export function encodeConnection(connection: Connection): string {
  const parsed = connectionSchema.parse(connection);
  return PREFIX + toBase64Url(JSON.stringify({ u: parsed.url, k: parsed.anonKey, t: parsed.token }));
}

export function decodeConnection(code: string): Connection | null {
  const trimmed = code.trim();
  if (!trimmed.startsWith(PREFIX)) return null;
  try {
    const raw = JSON.parse(fromBase64Url(trimmed.slice(PREFIX.length))) as { u?: unknown; k?: unknown; t?: unknown };
    const parsed = connectionSchema.safeParse({ url: raw.u, anonKey: raw.k, token: raw.t });
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** Hosts the autopilot may open and fill. Anything else is refused, whatever the database says. */
export const AUTOPILOT_HOSTS: Record<"greenhouse" | "lever" | "ashby", RegExp> = {
  greenhouse: /^(job-boards|boards)(\.eu)?\.greenhouse\.io$/,
  lever: /^jobs(\.eu)?\.lever\.co$/,
  ashby: /^jobs\.ashbyhq\.com$/,
};

export type AutopilotAts = keyof typeof AUTOPILOT_HOSTS;

export function autopilotAtsFor(url: string): AutopilotAts | null {
  let host: string;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return null;
    host = parsed.hostname.toLowerCase();
  } catch {
    return null;
  }
  for (const [ats, pattern] of Object.entries(AUTOPILOT_HOSTS) as [AutopilotAts, RegExp][]) {
    if (pattern.test(host)) return ats;
  }
  return null;
}

/** The page with the application form (Lever and Ashby keep it on a sub-path). */
export function applicationFormUrl(url: string): string | null {
  const ats = autopilotAtsFor(url);
  if (!ats) return null;
  const parsed = new URL(url);
  parsed.hash = "";
  if (ats === "lever" && !/\/apply\/?$/.test(parsed.pathname)) parsed.pathname = `${parsed.pathname.replace(/\/$/, "")}/apply`;
  if (ats === "ashby" && !/\/application\/?$/.test(parsed.pathname)) parsed.pathname = `${parsed.pathname.replace(/\/$/, "")}/application`;
  return parsed.toString();
}

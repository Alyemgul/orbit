import "server-only";

/** Lower-cased invite list from ALLOWED_EMAILS; empty means open sign-up. */
export function getAllowedEmails(): ReadonlySet<string> {
  const raw = process.env.ALLOWED_EMAILS ?? "";
  return new Set(
    raw
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
  );
}

export function isEmailAllowed(email: string): boolean {
  const allowed = getAllowedEmails();
  return allowed.size === 0 || allowed.has(email.toLowerCase());
}

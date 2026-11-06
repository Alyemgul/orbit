export const DEFAULT_AFTER_LOGIN = "/discover";

/**
 * Accept only same-origin absolute paths, so ?next= can never redirect to
 * another site ("//evil.com", "/\\evil.com", "https://…").
 */
export function safeRedirectPath(value: unknown, fallback: string = DEFAULT_AFTER_LOGIN): string {
  if (typeof value !== "string") return fallback;
  if (!value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return fallback;
  return value;
}

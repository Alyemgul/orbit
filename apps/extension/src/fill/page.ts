import type { AutopilotAts } from "@orbit/core";
import { cssEscape } from "./css";

/** Page-level checks: where the submit button is, CAPTCHAs, errors and success. */

const SUBMIT_SELECTORS: Record<AutopilotAts, string[]> = {
  greenhouse: ["#submit_app", "button[type='submit']", "input[type='submit']"],
  lever: ["#btn-submit", "button[data-qa='btn-submit']", "button[type='submit']"],
  ashby: ["button.ashby-application-form-submit-button", "button[type='submit']"],
};

function visible(element: Element): boolean {
  const html = element as HTMLElement;
  if (html.hidden || html.closest("[hidden], [aria-hidden='true']")) return false;
  const style = element.ownerDocument.defaultView?.getComputedStyle(element);
  return !style || (style.display !== "none" && style.visibility !== "hidden");
}

export function findSubmitButton(doc: Document, ats: AutopilotAts | null): HTMLElement | null {
  const selectors = ats ? SUBMIT_SELECTORS[ats] : ["button[type='submit']", "input[type='submit']"];
  for (const selector of selectors) {
    const candidates = Array.from(doc.querySelectorAll<HTMLElement>(selector)).filter(visible);
    const preferred = candidates.find((c) => /submit|apply|send/i.test(c.textContent ?? (c as HTMLInputElement).value ?? ""));
    if (preferred ?? candidates[0]) return preferred ?? candidates[0]!;
  }
  return (
    Array.from(doc.querySelectorAll<HTMLElement>("button")).find(
      (b) => visible(b) && /^\s*(submit( application)?|apply( now)?|send application)\s*$/i.test(b.textContent ?? ""),
    ) ?? null
  );
}

const CHALLENGE_FRAMES = /hcaptcha\.com|google\.com\/recaptcha|recaptcha\.net|challenges\.cloudflare\.com|arkoselabs|funcaptcha/i;

/**
 * True when a CAPTCHA puzzle is showing. Invisible checks (a small badge)
 * don't count; Orbit never tries to solve a puzzle, it hands it to you.
 */
export function captchaChallengeVisible(doc: Document): boolean {
  return Array.from(doc.querySelectorAll("iframe")).some((frame) => {
    if (!CHALLENGE_FRAMES.test(frame.src || "") || !visible(frame)) return false;
    const box = frame.getBoundingClientRect();
    // The reCAPTCHA badge is 256x60 and the checkbox 304x78; puzzles are larger.
    return box.width >= 280 && box.height >= 200;
  });
}

const SUCCESS_TEXT =
  /(thank(s| you)( so much)? for (applying|your application|your interest)|application (was |has been )?(successfully )?(submitted|received|sent)|we('ve| have) received your application|your application is (in|on its way))/i;

export function submissionSucceeded(doc: Document, url: string): boolean {
  if (/\/(confirmation|thanks|thank-you|thank_you|application\/success)(\/|\?|$)/i.test(new URL(url).pathname)) return true;
  if (doc.querySelector(".ashby-application-form-success-container, [data-qa='msg-submit-success'], #application_confirmation")) return true;
  const text = (doc.body?.innerText || doc.body?.textContent || "").slice(0, 20_000);
  return SUCCESS_TEXT.test(text);
}

/** Labels of fields the site marked as invalid after a submit attempt. */
export function formErrors(doc: Document): string[] {
  const errors = new Set<string>();
  for (const field of Array.from(doc.querySelectorAll<HTMLElement>("[aria-invalid='true']"))) {
    if (!visible(field)) continue;
    const id = field.id;
    const label = (id && doc.querySelector(`label[for="${cssEscape(id)}"]`)?.textContent) || field.getAttribute("aria-label") || field.getAttribute("name") || "A field";
    errors.add(label.replace(/\s+/g, " ").replace(/[*✱]/g, "").trim());
  }
  for (const message of Array.from(doc.querySelectorAll<HTMLElement>(".error-message, .helper-text--error, .ashby-application-form-field-entry [class*='error'], [role='alert']"))) {
    const text = message.textContent?.replace(/\s+/g, " ").trim();
    if (text && visible(message) && text.length < 200) errors.add(text);
  }
  return [...errors].slice(0, 10);
}

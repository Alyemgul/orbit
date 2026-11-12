import { describe, expect, it } from "vitest";
import { GMAIL_CLASSIFY_SOURCE, type EmailKind } from "./gmail-classifier";

// Evaluate the exact source that is pasted into the user's Apps Script.
const classify = new Function(`${GMAIL_CLASSIFY_SOURCE}; return classify;`)() as (subject: string, body: string) => EmailKind | null;

const cases: [string, string, string, EmailKind | null][] = [
  // Confirmations, including the ones that used to be misread.
  ["greenhouse confirmation", "Thank you for applying to Monzo", "Hi Sam, thanks for your interest in Monzo! We've received your application for Graduate Backend Engineer and our team will review it. If your experience is a good match, we'll be in touch about next steps.", "received"],
  ["lever confirmation", "Your application to Spotify", "Thank you for your application for the Associate Engineer role. Our recruiting team will review it, and if there's a fit we will reach out to schedule an interview.", "received"],
  ["ashby confirmation with 'unfortunately'", "Application received - Harvey", "Your application has been received. Due to the high volume of applications, unfortunately we are unable to respond to every applicant individually.", "received"],
  ["workday confirmation", "Application Confirmation", "Dear candidate, your application for Technology Analyst Graduate Programme has been submitted successfully.", "received"],
  ["german confirmation", "Ihre Bewerbung bei Celonis", "Vielen Dank für Ihre Bewerbung! Ihre Bewerbung ist bei uns eingegangen.", "received"],
  ["dutch confirmation", "Bedankt voor je sollicitatie", "Bedankt voor je sollicitatie bij Adyen. Je sollicitatie is ontvangen.", "received"],
  ["french confirmation", "Votre candidature", "Merci pour votre candidature, elle a bien été reçue.", "received"],
  // Interviews: a concrete ask.
  ["interview invite", "Next steps with Stripe", "We'd like to invite you to a 30 minute phone screen with the team. Please select a time using this link.", "interview"],
  ["assessment", "Optiver online assessment", "Please complete the online assessment within 5 days: https://www.hackerrank.com/test/abc", "interview"],
  ["availability", "Interview - Data Engineer", "Could you share your availability for next week for a technical interview?", "interview"],
  ["calendly", "Chat with our team", "Book a slot here: https://calendly.com/recruiter/30min", "interview"],
  // Rejections.
  ["rejection", "Your application to Wise", "Thank you for applying. Unfortunately, we have decided not to move forward with your application at this time.", "rejection"],
  ["regret", "Update on your application", "We regret to inform you that you have not been selected for the next stage.", "rejection"],
  ["other candidates", "Your candidacy", "After careful review we have decided to pursue other candidates whose experience more closely matches the role.", "rejection"],
  ["german rejection", "Ihre Bewerbung", "Leider müssen wir Ihnen mitteilen, dass wir Ihre Bewerbung nicht weiter berücksichtigen können.", "rejection"],
  // Offers.
  ["offer", "Offer from Adyen", "We are delighted to offer you the position of Software Engineer. Your offer letter is attached.", "offer"],
  // Not job replies.
  ["newsletter", "Our product update", "Check out our new features this month.", null],
];

describe("Gmail reply classifier", () => {
  it.each(cases)("%s", (_name, subject, body, expected) => {
    expect(classify(subject, body)).toBe(expected);
  });

  it("is plain JavaScript that Apps Script can run (no TypeScript, no imports)", () => {
    expect(GMAIL_CLASSIFY_SOURCE).not.toMatch(/\bimport\b|:\s*string|=>/);
  });
});

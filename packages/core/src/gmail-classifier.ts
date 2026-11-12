/**
 * Classifies a job email as offer / rejection / interview / received, or null.
 *
 * This is the exact source pasted into the user's Google Apps Script (it runs
 * in their Gmail, so it must be plain ES5-style JavaScript with no imports).
 * Tests evaluate the same string, so what's tested is what runs.
 *
 * Order matters:
 *  1. offer and rejection need clear wording ("regret to inform", "not moving
 *     forward with your application"), never a lone "unfortunately", because
 *     confirmations often say "unfortunately we can't reply to everyone".
 *  2. a real interview invite has a concrete ask: pick a time, a calendar or
 *     assessment link, "invite you to".
 *  3. a confirmation wins over vague wording ("we'll be in touch about next
 *     steps if you're a fit") that would otherwise read as an interview.
 */
export const GMAIL_CLASSIFY_SOURCE = String.raw`function classify(subject, body) {
  var text = (subject + " " + body).toLowerCase().replace(/\s+/g, " ");
  var offer = /(pleased|happy|delighted|excited|thrilled) to (extend|offer you|make you an offer)|offer letter|job offer|offer of employment|formal offer|arbeitsvertrag|vertragsangebot/;
  var rejection = /regret to inform|not (to )?(be )?mov(e|ing) forward with (your|you)|decided (not to|to not) (proceed|move forward|progress)|(will|won't|will not|are not|aren't|not) (be )?(progress|proceed|moving forward)(ing)? with your (application|candidacy)|no longer (being )?consider|(have|has) not been (selected|successful)|were not selected|unsuccessful on this occasion|(pursue|move forward with|proceed with) other candidates|decided to (pursue|go with|move forward with) (other|another|a different) candidate|position has (now )?been filled|role has (now )?been filled|not (a|the right) (fit|match) (for|at) this time|nicht (weiter )?berücksichtigen|leider (eine )?absage|für (eine|einen) andere(n)? (kandidat|bewerber)|helaas.{0,80}(niet|afgewezen)|malheureusement.{0,80}(pas retenu|ne pas donner suite|pas donner suite)/;
  var invite = /(like|love|want) to (invite|schedule|set up|arrange) (you|a|an)|invite you (to|for)|invitation to (an |a )?(interview|call|chat)|(select|choose|pick|book) (a|an|your) (time|slot|date)|share your availability|let us know your availability|when (are|would) you (be )?available|calendly\.com|goodtime\.io|cal\.com\/|hackerrank|codility|codesignal|testgorilla|coding (challenge|test|assessment) (link|invitation|invite)|complete (the|this|our|an) (online )?(assessment|coding|challenge|test)|take[- ]home (assignment|task|challenge)|einladung zum (vorstellungs)?gespräch|uitnodiging voor (een )?(gesprek|sollicitatiegesprek)|invitation à un entretien/;
  var received = /(application|candidacy|submission) (was |has been |is )?(received|submitted|complete)|(we|we've|we have) (successfully )?received your application|thank(s| you) for (applying|your application|submitting your application|your interest in)|application confirmation|we('ve| have) got your application|vielen dank für (ihre|deine) bewerbung|(ihre|deine) bewerbung (ist )?(bei uns )?eingegangen|eingangsbestätigung|bedankt voor (je|uw) sollicitatie|(je|uw) sollicitatie (is )?ontvangen|merci pour votre candidature|votre candidature (a bien été|a été) (reçue|enregistrée)/;
  var interviewWords = /\binterview\b|phone screen|next round|technical round|hiring manager would like/;
  if (offer.test(text)) return "offer";
  if (rejection.test(text)) return "rejection";
  if (invite.test(text)) return "interview";
  if (received.test(text)) return "received";
  if (interviewWords.test(text)) return "interview";
  return null;
}`;

/** Search terms for the Apps Script's Gmail query (subjects and ATS senders). */
export const GMAIL_QUERY =
  'newer_than:3d -in:sent -in:chats (subject:(application OR applying OR applied OR interview OR "next steps" OR offer OR unfortunately OR candidacy OR "your candidature" OR "thank you for applying" OR bewerbung OR sollicitatie OR candidature) ' +
  "OR from:(greenhouse.io OR greenhouse-mail.io OR lever.co OR hire.lever.co OR ashbyhq.com OR myworkday.com OR smartrecruiters.com OR workablemail.com OR teamtailor-mail.com OR personio.de OR recruitee.com OR successfactors.com OR icims.com))";

export type EmailKind = "offer" | "rejection" | "interview" | "received";

/**
 * The Google Apps Script that tracks replies. It runs in the user's own
 * Google account every 30 minutes, reads only recent job-related emails,
 * classifies them on Google's side, and sends Orbit just the sender,
 * subject and the kind of reply. Email bodies never leave Gmail.
 */
export function gmailScript(values: { url: string; anonKey: string; token: string }): string {
  return `// Orbit: Gmail reply tracking. Runs in your own Google account.
// Only the sender, subject and reply type of job emails are sent to Orbit.
// Revoke access any time in Orbit → Profile → Gmail reply tracking.

const ORBIT_URL = ${JSON.stringify(values.url)};
const ORBIT_KEY = ${JSON.stringify(values.anonKey)}; // public key
const ORBIT_TOKEN = ${JSON.stringify(values.token)}; // revocable

const QUERY =
  'newer_than:3d -in:sent -in:chats (subject:(application OR applying OR applied OR interview OR "next steps" OR offer OR unfortunately OR candidacy OR "your candidature") ' +
  'OR from:(greenhouse.io OR greenhouse-mail.io OR lever.co OR hire.lever.co OR ashbyhq.com OR myworkday.com OR smartrecruiters.com OR workablemail.com OR teamtailor-mail.com OR personio.de))';

function classify(subject, body) {
  const text = (subject + " " + body).toLowerCase();
  if (/(pleased|happy|delighted|excited) to (extend|offer)|offer letter|job offer|offer of employment/.test(text)) return "offer";
  if (/unfortunately|not (to )?(be )?mov(e|ing) forward|other candidates|regret to inform|decided not to|no longer (being )?consider|not been selected|position has (now )?been filled|will not be (progressing|proceeding)/.test(text)) return "rejection";
  if (/interview|next step|schedule (a|your) (call|chat|time)|your availability|coding (challenge|test|assessment)|online assessment|hackerrank|codility|take[- ]home|phone screen/.test(text)) return "interview";
  if (/application (was |has been )?(received|submitted)|thank(s| you) for (applying|your application|your interest)|we have received your application/.test(text)) return "received";
  return null;
}

function orbitSync() {
  const props = PropertiesService.getScriptProperties();
  const seen = JSON.parse(props.getProperty("seen") || "[]");
  const events = [];
  const threads = GmailApp.search(QUERY, 0, 40);
  for (const thread of threads) {
    for (const message of thread.getMessages()) {
      const id = message.getId();
      if (seen.indexOf(id) !== -1 || events.length >= 50) continue;
      seen.push(id);
      const kind = classify(message.getSubject(), message.getPlainBody().slice(0, 3000));
      if (kind) events.push({ message_id: id, kind: kind, from: message.getFrom(), subject: message.getSubject() });
    }
  }
  if (events.length) {
    const response = UrlFetchApp.fetch(ORBIT_URL + "/rest/v1/rpc/gmail_ingest", {
      method: "post",
      contentType: "application/json",
      headers: { apikey: ORBIT_KEY, Authorization: "Bearer " + ORBIT_KEY },
      payload: JSON.stringify({ p_token: ORBIT_TOKEN, p_events: events }),
      muteHttpExceptions: true,
    });
    if (response.getResponseCode() >= 300) {
      console.log("Orbit returned " + response.getResponseCode() + ": " + response.getContentText().slice(0, 200));
      return; // Not marked as seen, so they are retried next run.
    }
    console.log("Sent " + events.length + " replies; Orbit matched " + response.getContentText());
  }
  props.setProperty("seen", JSON.stringify(seen.slice(-800)));
}

// Run this once: it checks your inbox now and every 30 minutes after.
function setup() {
  ScriptApp.getProjectTriggers().forEach(function (t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger("orbitSync").timeBased().everyMinutes(30).create();
  orbitSync();
}
`;
}

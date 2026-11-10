import {
  answerValueSchema,
  applicantProfile,
  applicationFormUrl,
  autopilotAtsFor,
  decodeConnection,
  readResume,
  type AutopilotAts,
  type Connection,
  type PendingQuestion,
  type Resume,
  type SavedAnswer,
} from "@orbit/core";
import { renderResumePdf, resumeFileName } from "@orbit/core/pdf";
import { ApiError, rpc, type ExtStatus, type NextApplication, type StoredAnswer } from "./api";
import type { CapturedAnswer, FillPayload } from "./fill/fill";
import type { CapturedMessage, CheckResponse, FillResponse, SubmitResponse, ToContent } from "./messages";

/**
 * The autopilot loop. Every minute while switched on, it asks Orbit for the
 * next application (the server enforces the daily cap and a pause between
 * submissions), opens the form in a background tab, fills it, and submits
 * unless review mode is on. Anything it can't do (an unknown question, a
 * CAPTCHA, a form error) goes to the "Needs you" inbox in Orbit.
 */

type Phase = "loading" | "submitting" | "confirming" | "waiting_user";

interface Run {
  applicationId: string | null;
  title: string;
  company: string;
  tabId: number;
  ats: AutopilotAts;
  review: boolean;
  phase: Phase;
  phaseAt: number;
  captured: CapturedAnswer[];
}

interface LogEntry {
  at: number;
  text: string;
  tone: "info" | "success" | "warning" | "danger";
}

const TICK = "orbit-tick";

const store = {
  async connection(): Promise<Connection | null> {
    const { connection } = await chrome.storage.local.get("connection");
    return (connection as Connection | undefined) ?? null;
  },
  async enabled(): Promise<boolean> {
    const { enabled } = await chrome.storage.local.get("enabled");
    return enabled === true;
  },
  async run(): Promise<Run | null> {
    const { run } = await chrome.storage.local.get("run");
    return (run as Run | undefined) ?? null;
  },
  async setRun(run: Run | null): Promise<void> {
    if (run) await chrome.storage.local.set({ run });
    else await chrome.storage.local.remove(["run", "payload"]);
  },
};

async function log(text: string, tone: LogEntry["tone"] = "info"): Promise<void> {
  const { log: entries = [] } = (await chrome.storage.local.get("log")) as { log?: LogEntry[] };
  await chrome.storage.local.set({ log: [{ at: Date.now(), text, tone }, ...entries].slice(0, 40) });
}

function notify(title: string, message: string): void {
  chrome.notifications.create(`orbit-${Date.now()}`, {
    type: "basic",
    iconUrl: "icon-128.png",
    title,
    message,
    priority: 1,
  });
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

async function savedAnswers(connection: Connection): Promise<SavedAnswer[]> {
  const rows = await rpc<StoredAnswer[]>(connection, "ext_answers", {});
  return rows.flatMap((row) => {
    const answer = answerValueSchema.safeParse(row.answer);
    return answer.success && typeof row.question === "string"
      ? [{ questionText: row.question, answer: answer.data, sensitive: Boolean(row.sensitive) }]
      : [];
  });
}

async function buildPayload(connection: Connection, resume: Resume, fallback: Parameters<typeof applicantProfile>[1], acceptPrivacy: boolean): Promise<FillPayload> {
  const pdf = await renderResumePdf(resume);
  return {
    profile: applicantProfile(resume, fallback),
    answers: await savedAnswers(connection),
    resume: { fileName: resumeFileName(resume), base64: bytesToBase64(pdf) },
    acceptPrivacy,
  };
}

async function send<T>(tabId: number, message: ToContent): Promise<T> {
  await chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] });
  return (await chrome.tabs.sendMessage(tabId, message)) as T;
}

async function report(outcome: "applied" | "needs_input" | "failed", run: Run, detail: { reason?: string; questions?: PendingQuestion[]; answers?: CapturedAnswer[] } = {}) {
  const connection = await store.connection();
  if (!connection) return;
  if (!run.applicationId) {
    // "Fill this page" runs have no application; just remember new answers.
    if (detail.answers?.length) await rpc(connection, "ext_learn", { p_answers: detail.answers }).catch(() => undefined);
    return;
  }
  try {
    await rpc(connection, "ext_report", { p_application_id: run.applicationId, p_outcome: outcome, p_detail: detail });
  } catch (error) {
    await log(`Couldn't update Orbit: ${(error as Error).message}`, "danger");
  }
}

async function finishApplied(run: Run): Promise<void> {
  await report("applied", run, { answers: run.captured });
  await log(run.applicationId ? `Applied: ${run.title} at ${run.company}` : `Saved your answers from ${run.company || "this page"}`, "success");
  await store.setRun(null);
  if (run.applicationId && !run.review) setTimeout(() => void chrome.tabs.remove(run.tabId).catch(() => undefined), 4000);
}

async function handToUser(run: Run, reason: string, questions: PendingQuestion[] = []): Promise<void> {
  await report("needs_input", run, { reason, questions });
  await store.setRun({ ...run, phase: "waiting_user", phaseAt: Date.now() });
  await chrome.tabs.sendMessage(run.tabId, { type: "orbit:watch", ats: run.ats } satisfies ToContent).catch(() => undefined);
  await log(`${run.company}: ${reason}`, "warning");
  notify(`${run.company} needs you`, reason);
}

/** Opens the next application from the queue, if the server hands one out. */
async function startNext(connection: Connection): Promise<void> {
  const next = await rpc<NextApplication>(connection, "ext_next_application", {});
  if (next.status === "cap") {
    const { capLogged } = await chrome.storage.session.get("capLogged");
    if (!capLogged) await log(`Daily limit of ${next.cap} reached. Back tomorrow.`, "info");
    await chrome.storage.session.set({ capLogged: true });
    return;
  }
  await chrome.storage.session.remove("capLogged");
  if (next.status === "no_resume") return void (await log("Save your master resume in Orbit first.", "danger"));
  if (next.status !== "ok") return;

  const { application } = next;
  const run: Run = {
    applicationId: application.id,
    title: application.title,
    company: application.company,
    tabId: -1,
    ats: "greenhouse",
    review: next.review,
    phase: "loading",
    phaseAt: Date.now(),
    captured: [],
  };
  const ats = autopilotAtsFor(application.apply_url);
  const url = applicationFormUrl(application.apply_url);
  const resume = readResume(next.resume);
  if (!ats || !url || !resume) {
    await report("failed", run, { reason: !resume ? "The saved resume couldn't be read." : "Not a supported application page." });
    await log(`Skipped ${application.company}: not a supported application page.`, "warning");
    return;
  }

  const payload = await buildPayload(
    connection,
    resume,
    { fullName: next.profile.full_name, email: next.profile.email, phone: next.profile.phone, location: next.profile.location },
    next.accept_privacy,
  );
  await chrome.storage.local.set({ payload });
  const tab = await chrome.tabs.create({ url, active: false });
  await store.setRun({ ...run, ats, tabId: tab.id! });
  await log(`Opening ${application.title} at ${application.company}…`);
}

async function fillRun(run: Run): Promise<void> {
  const { payload } = (await chrome.storage.local.get("payload")) as { payload?: FillPayload };
  if (!payload) return handToUser(run, "Orbit lost the application data. Try again from the Inbox.");
  const result = await send<FillResponse>(run.tabId, { type: "orbit:fill", ats: run.ats, payload });

  if (result.missing.length) {
    const reason = `${result.missing.length} question${result.missing.length > 1 ? "s" : ""} need${result.missing.length > 1 ? "" : "s"} your answer`;
    if (!run.applicationId) return handToUser(run, reason, result.missing);
    await report("needs_input", run, { reason, questions: result.missing });
    await log(`${run.company}: ${reason}. Answer in Orbit's Inbox and it will retry.`, "warning");
    await store.setRun(null);
    await chrome.tabs.remove(run.tabId).catch(() => undefined);
    return;
  }
  if (run.review || !run.applicationId) {
    return handToUser(run, "Filled in. Review the open tab and press Submit.");
  }

  await store.setRun({ ...run, phase: "submitting", phaseAt: Date.now() });
  let response: SubmitResponse;
  try {
    response = await send<SubmitResponse>(run.tabId, { type: "orbit:submit", ats: run.ats });
  } catch {
    // The page navigated away mid-submit (normal for Lever); the next page load confirms.
    await store.setRun({ ...run, phase: "confirming", phaseAt: Date.now() });
    return;
  }
  const current = (await store.run()) ?? run;
  switch (response.outcome) {
    case "applied":
      return finishApplied(current);
    case "captcha":
      return handToUser(current, "A CAPTCHA appeared. Solve it in the open tab and press Submit.");
    case "errors":
      return handToUser(current, `The form flagged: ${response.errors.join("; ").slice(0, 250)}`);
    case "no_button":
      return handToUser(current, "Couldn't find the Submit button. Submit it yourself in the open tab.");
    case "pending":
      await store.setRun({ ...current, phase: "confirming", phaseAt: Date.now() });
  }
}

async function checkRun(run: Run): Promise<CheckResponse | null> {
  try {
    return await send<CheckResponse>(run.tabId, { type: "orbit:check", ats: run.ats });
  } catch {
    return null;
  }
}

/** Keeps an in-flight run moving: page loads, confirmations, timeouts, closed tabs. */
async function supervise(run: Run, event: "tick" | "loaded"): Promise<void> {
  const tab = await chrome.tabs.get(run.tabId).catch(() => null);
  if (!tab) {
    if (run.phase !== "waiting_user") await report("needs_input", run, { reason: "The tab was closed before the application was submitted." });
    await log(`${run.company}: tab closed.`, "warning");
    return store.setRun(null);
  }
  const age = Date.now() - run.phaseAt;

  if (run.phase === "loading") {
    // A missed load event (the worker restarted) is caught on the next tick.
    if (tab.status === "complete" && (event === "loaded" || age > 15_000)) {
      await store.setRun({ ...run, phase: "submitting", phaseAt: Date.now() });
      // Give single-page forms a moment to render.
      await new Promise((resolve) => setTimeout(resolve, 2500));
      return fillRun(run).catch((error: Error) => handToUser(run, `Couldn't fill the form (${error.message.slice(0, 120)}).`));
    }
    if (age > 3 * 60_000) return handToUser(run, "The application page didn't finish loading.");
    return;
  }

  const state = await checkRun(run);
  if (state?.success) return finishApplied(run);
  if (run.phase === "confirming") {
    if (state?.captcha) return handToUser(run, "A CAPTCHA appeared. Solve it in the open tab and press Submit.");
    if (state?.errors.length) return handToUser(run, `The form flagged: ${state.errors.join("; ").slice(0, 250)}`);
    if (age > 2 * 60_000) return handToUser(run, "Couldn't confirm the submission. Check the open tab.");
  }
  if (run.phase === "submitting" && age > 3 * 60_000) return handToUser(run, "Submitting took too long. Check the open tab.");
  if (run.phase === "waiting_user" && age > 60 * 60_000) {
    await log(`${run.company}: stopped waiting. It stays in your Inbox.`);
    return store.setRun(null);
  }
}

let ticking = false;

async function tick(): Promise<void> {
  if (ticking) return;
  ticking = true;
  try {
    const run = await store.run();
    if (run) return await supervise(run, "tick");
    const [connection, enabled] = await Promise.all([store.connection(), store.enabled()]);
    if (connection && enabled) await startNext(connection);
  } catch (error) {
    const message = error instanceof ApiError || error instanceof Error ? error.message : String(error);
    await log(message.slice(0, 200), "danger");
    if (error instanceof ApiError && /revoked/.test(error.message)) await chrome.storage.local.set({ enabled: false });
  } finally {
    ticking = false;
  }
}

/** "Fill this page": fills the active supported tab with the master resume, without submitting. */
async function fillHere(tabId: number, url: string): Promise<string> {
  const connection = await store.connection();
  if (!connection) return "Connect Orbit first.";
  const ats = autopilotAtsFor(url);
  if (!ats) return "This page isn't a Greenhouse, Lever or Ashby application.";
  if (await store.run()) return "The autopilot is busy with another application.";
  const profile = await rpc<{ resume: unknown; profile: { full_name: string | null; email: string | null; phone: string | null; location: string | null }; accept_privacy: boolean }>(
    connection,
    "ext_profile",
    {},
  );
  const resume = readResume(profile.resume);
  if (!resume) return "Save your master resume in Orbit first.";
  const payload = await buildPayload(
    connection,
    resume,
    { fullName: profile.profile.full_name, email: profile.profile.email, phone: profile.profile.phone, location: profile.profile.location },
    profile.accept_privacy,
  );
  await chrome.storage.local.set({ payload });
  const run: Run = { applicationId: null, title: "", company: new URL(url).hostname, tabId, ats, review: true, phase: "submitting", phaseAt: Date.now(), captured: [] };
  await store.setRun(run);
  const result = await send<FillResponse>(tabId, { type: "orbit:fill", ats, payload });
  await store.setRun({ ...run, phase: "waiting_user", phaseAt: Date.now() });
  await send(tabId, { type: "orbit:watch", ats });
  return result.missing.length
    ? `Filled ${result.filled}. ${result.missing.length} question${result.missing.length > 1 ? "s" : ""} left for you; your answers are remembered when you submit.`
    : `Filled ${result.filled} fields. Review and press Submit.`;
}

type PopupMessage =
  | { type: "popup:state" }
  | { type: "popup:connect"; code: string }
  | { type: "popup:disconnect" }
  | { type: "popup:toggle"; enabled: boolean }
  | { type: "popup:run-now" }
  | { type: "popup:fill-here"; tabId: number; url: string };

async function popupState() {
  const [connection, enabled, run, { log: entries = [] }] = await Promise.all([
    store.connection(),
    store.enabled(),
    store.run(),
    chrome.storage.local.get("log") as Promise<{ log?: LogEntry[] }>,
  ]);
  let status: ExtStatus | null = null;
  let error: string | null = null;
  if (connection) {
    try {
      status = await rpc<ExtStatus>(connection, "ext_status", {});
    } catch (e) {
      error = (e as Error).message;
    }
  }
  return { connected: Boolean(connection), enabled, run, log: entries, status, error };
}

async function handlePopup(message: PopupMessage): Promise<unknown> {
  switch (message.type) {
    case "popup:state":
      return popupState();
    case "popup:connect": {
      const connection = decodeConnection(message.code);
      if (!connection) return { error: "That isn't a valid Orbit connection code." };
      try {
        await rpc<ExtStatus>(connection, "ext_status", {});
      } catch (e) {
        return { error: (e as Error).message };
      }
      await chrome.storage.local.set({ connection });
      await log("Connected to Orbit.", "success");
      return popupState();
    }
    case "popup:disconnect":
      await chrome.storage.local.remove(["connection", "enabled", "run", "payload"]);
      return popupState();
    case "popup:toggle":
      await chrome.storage.local.set({ enabled: message.enabled });
      await log(message.enabled ? "Autopilot on." : "Autopilot paused.");
      if (message.enabled) void tick();
      return popupState();
    case "popup:run-now":
      void tick();
      return popupState();
    case "popup:fill-here":
      return { message: await fillHere(message.tabId, message.url).catch((e: Error) => e.message) };
  }
}

chrome.runtime.onInstalled.addListener(() => void chrome.alarms.create(TICK, { periodInMinutes: 1 }));
chrome.runtime.onStartup.addListener(() => void chrome.alarms.create(TICK, { periodInMinutes: 1 }));
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === TICK) void tick();
});

chrome.tabs.onUpdated.addListener((tabId, info) => {
  if (info.status !== "complete") return;
  void store.run().then((run) => {
    if (run && run.tabId === tabId) void supervise(run, "loaded").catch((e: Error) => log(e.message, "danger"));
  });
});

chrome.notifications.onClicked.addListener(() => {
  void store.run().then((run) => {
    if (!run) return;
    void chrome.tabs.update(run.tabId, { active: true });
    void chrome.tabs.get(run.tabId).then((tab) => chrome.windows.update(tab.windowId, { focused: true }));
  });
});

chrome.runtime.onMessage.addListener((message: PopupMessage | CapturedMessage, sender, sendResponse) => {
  if (message.type === "orbit:captured") {
    // Only answers from the tab Orbit is working in are kept.
    void store.run().then(async (run) => {
      if (run && sender.tab?.id === run.tabId) {
        await store.setRun({ ...run, captured: message.answers, phase: run.phase === "waiting_user" ? "waiting_user" : "confirming", phaseAt: Date.now() });
      }
    });
    return false;
  }
  // Popup messages come only from this extension's own pages.
  if (sender.id !== chrome.runtime.id || sender.tab) return false;
  void handlePopup(message).then(sendResponse);
  return true;
});

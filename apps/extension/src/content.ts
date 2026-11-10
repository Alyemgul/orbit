import type { AutopilotAts } from "@orbit/core";
import { captureAnswers, fillForm } from "./fill/fill";
import { captchaChallengeVisible, findSubmitButton, formErrors, submissionSucceeded } from "./fill/page";
import type { CapturedMessage, CheckResponse, FillResponse, SubmitResponse, ToContent } from "./messages";

/**
 * Injected only into application tabs the autopilot opened (or the tab the
 * user asked it to fill). It fills the form, presses submit when allowed,
 * and reports back. It never solves CAPTCHAs or touches other sites.
 */

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function check(): CheckResponse {
  return {
    success: submissionSucceeded(document, location.href),
    captcha: captchaChallengeVisible(document),
    errors: formErrors(document),
  };
}

let watching = false;

/** Remembers what the user typed when they press submit themselves. */
function watchForSubmit(ats: AutopilotAts | null): void {
  if (watching) return;
  watching = true;
  const capture = () => {
    void captureAnswers(document, ats).then((answers) => {
      const message: CapturedMessage = { type: "orbit:captured", answers };
      void chrome.runtime.sendMessage(message).catch(() => undefined);
    });
  };
  document.addEventListener(
    "click",
    (event) => {
      const button = findSubmitButton(document, ats);
      if (button && event.target instanceof Node && button.contains(event.target)) capture();
    },
    true,
  );
  document.addEventListener("submit", capture, true);
}

async function submit(ats: AutopilotAts | null): Promise<SubmitResponse> {
  const button = findSubmitButton(document, ats);
  if (!button) return { outcome: "no_button" };
  // Answers Orbit filled from memory are already saved; this only catches new ones.
  watchForSubmit(ats);
  button.click();
  for (let i = 0; i < 40; i++) {
    await wait(500);
    const state = check();
    if (state.success) return { outcome: "applied" };
    if (state.captcha) return { outcome: "captcha" };
    if (i >= 6 && state.errors.length) return { outcome: "errors", errors: state.errors };
  }
  return { outcome: "pending" };
}

declare global {
  interface Window {
    __orbitAutopilot?: boolean;
  }
}

if (!window.__orbitAutopilot) {
  window.__orbitAutopilot = true;
  chrome.runtime.onMessage.addListener((message: ToContent, _sender, sendResponse) => {
    switch (message.type) {
      case "orbit:fill":
        void fillForm(document, message.ats, message.payload).then((result) => {
          const response: FillResponse = { ...result, captcha: captchaChallengeVisible(document) };
          sendResponse(response);
        });
        return true;
      case "orbit:submit":
        void submit(message.ats).then(sendResponse);
        return true;
      case "orbit:check":
        sendResponse(check());
        return false;
      case "orbit:watch":
        watchForSubmit(message.ats);
        sendResponse({ ok: true });
        return false;
    }
  });
}

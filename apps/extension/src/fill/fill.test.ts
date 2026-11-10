// @vitest-environment jsdom
import type { ApplicantProfile } from "@orbit/core";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { captureAnswers, fillForm, type FillPayload } from "./fill";
import { captchaChallengeVisible, findSubmitButton, formErrors, submissionSucceeded } from "./page";
import { collectQuestions } from "./questions";

const profile: ApplicantProfile = {
  firstName: "Alex",
  lastName: "Novak",
  fullName: "Alex Novak",
  email: "alex@example.com",
  phone: "+36 30 000 0000",
  location: "Budapest, Hungary",
  linkedin: "https://linkedin.com/in/alex",
  github: "https://github.com/alex",
  website: "",
  currentCompany: "Riverline",
  school: "BME",
  degree: "BSc",
  graduation: "2027",
};

const payload = (overrides: Partial<FillPayload> = {}): FillPayload => ({
  profile,
  answers: [],
  resume: { fileName: "Alex_Novak_Resume.pdf", base64: btoa("%PDF-1.7 test") },
  acceptPrivacy: false,
  ...overrides,
});

// jsdom has no DataTransfer; a minimal one is enough to set input.files.
beforeAll(() => {
  class FakeDataTransfer {
    private list: File[] = [];
    items = { add: (file: File) => this.list.push(file) };
    get files(): FileList {
      const files = this.list;
      return Object.assign([...files], { item: (i: number) => files[i] ?? null }) as unknown as FileList;
    }
  }
  (window as unknown as { DataTransfer: unknown }).DataTransfer = FakeDataTransfer;
  Object.defineProperty(HTMLInputElement.prototype, "files", {
    configurable: true,
    get(this: HTMLInputElement & { _files?: FileList }) {
      return this._files ?? ([] as unknown as FileList);
    },
    set(this: HTMLInputElement & { _files?: FileList }, value: FileList) {
      this._files = value;
    },
  });
});

const GREENHOUSE = `
<form id="application-form">
  <div class="field-wrapper"><label id="first_name-label" for="first_name">First Name<span>*</span></label><input id="first_name" type="text" aria-required="true"></div>
  <div class="field-wrapper"><label for="last_name">Last Name<span>*</span></label><input id="last_name" type="text" aria-required="true"></div>
  <div class="field-wrapper"><label for="email">Email<span>*</span></label><input id="email" type="text" aria-required="true"></div>
  <div class="field-wrapper"><label for="phone">Phone<span>*</span></label><input id="phone" type="tel" aria-required="true"></div>
  <div class="field-wrapper"><label for="resume">Resume/CV<span>*</span></label><input id="resume" type="file" style="display:none"></div>
  <div class="field-wrapper"><label for="cover_letter">Cover Letter</label><input id="cover_letter" type="file" style="display:none"></div>
  <div class="field-wrapper"><label for="question_1">LinkedIn Profile / Website</label><textarea id="question_1"></textarea></div>
  <div class="field-wrapper"><label for="question_2">Where are you currently based?<span>*</span></label><textarea id="question_2" aria-required="true"></textarea></div>
  <div class="field-wrapper"><label for="question_3">Will you now or in the future require immigration support?<span>*</span></label>
    <select id="question_3" aria-required="true"><option value="">Select...</option><option value="1">Yes</option><option value="0">No</option></select></div>
  <div class="field-wrapper"><label for="question_4">Please indicate your notice period in months<span>*</span></label><input id="question_4" type="text" aria-required="true"></div>
  <div class="field-wrapper"><label for="question_5">How did you hear about us?</label><input id="question_5" type="text"></div>
  <button type="submit">Submit application</button>
</form>`;

const LEVER = `
<form>
  <ul>
    <li class="application-question resume"><div class="application-label"><div class="text">Resume/CV<span class="required">✱</span></div></div>
      <div class="application-field"><input id="resume-upload-input" name="resume" type="file"></div></li>
    <li class="application-question"><div class="application-label"><div class="text">Full name<span class="required">✱</span></div></div>
      <div class="application-field"><input type="text" name="name" required></div></li>
    <li class="application-question"><div class="application-label"><div class="text">Email<span class="required">✱</span></div></div>
      <div class="application-field"><input type="email" name="email" required></div></li>
    <li class="application-question"><div class="application-label"><div class="text">Current company<span class="required">✱</span></div></div>
      <div class="application-field"><input type="text" name="org" required></div></li>
    <li class="application-question"><div class="application-label"><div class="text">GitHub URL</div></div>
      <div class="application-field"><input type="text" name="urls[GitHub]"></div></li>
    <li class="application-question custom-question"><div class="application-label multiple-choice"><div class="text">Are you legally authorized to work in the Netherlands?<span class="required">✱</span></div></div>
      <div class="application-field"><ul>
        <li><label><input type="radio" name="cards[abc][field0]" value="Yes" required><span>Yes</span></label></li>
        <li><label><input type="radio" name="cards[abc][field0]" value="No"><span>No</span></label></li>
      </ul></div></li>
    <li class="application-question custom-question"><div class="application-label multiple-select"><div class="text">Which languages do you speak?<span class="required">✱</span></div></div>
      <div class="application-field"><ul>
        <li><label><input type="checkbox" name="cards[def][field0]" value="English"><span>English</span></label></li>
        <li><label><input type="checkbox" name="cards[def][field0]" value="Dutch"><span>Dutch</span></label></li>
        <li><label><input type="checkbox" name="cards[def][field0]" value="Hungarian"><span>Hungarian</span></label></li>
      </ul></div></li>
    <li class="application-question"><label><span>Contact me about future job opportunities.</span><input type="checkbox" name="consent[marketing]" value="1"></label></li>
    <li class="application-question"><label><span>I have read and agree to the Candidate Privacy Notice and the processing of my personal data<span class="required">✱</span></span><input type="checkbox" name="consent[privacy]" value="1" required></label></li>
  </ul>
  <div id="h-captcha" class="h-captcha"></div>
  <button id="btn-submit" type="button">Submit application</button>
</form>`;

const ASHBY = `
<div class="ashby-application-form-container">
  <div class="ashby-application-form-field-entry"><label class="ashby-application-form-question-title" for="_systemfield_name">Name *</label><input id="_systemfield_name" type="text" required></div>
  <div class="ashby-application-form-field-entry"><label class="ashby-application-form-question-title" for="_systemfield_email">Email *</label><input id="_systemfield_email" type="email" required></div>
  <div class="ashby-application-form-field-entry"><label class="ashby-application-form-question-title" for="_systemfield_resume">Resume *</label><input id="_systemfield_resume" type="file" required></div>
  <div class="ashby-application-form-field-entry"><label class="ashby-application-form-question-title">Are you open to working from our Berlin office? *</label>
    <div><button type="button">Yes</button><button type="button">No</button></div></div>
  <div class="ashby-application-form-field-entry"><label class="ashby-application-form-question-title" for="q-why">Why do you want to join us? *</label><textarea id="q-why" required></textarea></div>
  <button class="ashby-application-form-submit-button" type="submit">Submit Application</button>
</div>`;

function mount(html: string): Document {
  document.body.innerHTML = html;
  return document;
}

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("collectQuestions", () => {
  it("reads labels, required flags and options on Lever-style forms", () => {
    mount(LEVER);
    const questions = collectQuestions(document, "lever");
    const auth = questions.find((q) => q.label.startsWith("Are you legally"))!;
    expect(auth).toMatchObject({ kind: "radio", required: true, options: ["Yes", "No"] });
    const languages = questions.find((q) => q.label.startsWith("Which languages"))!;
    expect(languages).toMatchObject({ kind: "checkbox", options: ["English", "Dutch", "Hungarian"] });
    expect(questions.find((q) => q.name === "name")?.label).toBe("Full name");
  });
});

describe("fillForm", () => {
  it("fills Greenhouse contact fields, the resume and linked questions, and lists what's missing", async () => {
    mount(GREENHOUSE);
    const result = await fillForm(document, "greenhouse", payload());
    const value = (id: string) => (document.getElementById(id) as HTMLInputElement).value;
    expect(value("first_name")).toBe("Alex");
    expect(value("last_name")).toBe("Novak");
    expect(value("email")).toBe("alex@example.com");
    expect(value("phone")).toBe("+36 30 000 0000");
    expect(value("question_1")).toBe("https://linkedin.com/in/alex");
    expect(value("question_2")).toBe("Budapest, Hungary");
    expect((document.getElementById("resume") as HTMLInputElement).files?.length).toBe(1);
    expect((document.getElementById("cover_letter") as HTMLInputElement).files?.length ?? 0).toBe(0);
    expect(value("question_5")).toBe("");
    // Visa and notice period are never guessed.
    expect(result.missing.map((m) => m.text)).toEqual([
      "Will you now or in the future require immigration support?",
      "Please indicate your notice period in months",
    ]);
    expect(result.missing[0]).toMatchObject({ type: "select", options: ["Yes", "No"], required: true });
  });

  it("uses saved answers, including for sensitive questions the user answered before", async () => {
    mount(GREENHOUSE);
    const result = await fillForm(
      document,
      "greenhouse",
      payload({
        answers: [
          { questionText: "Will you now or in the future require immigration support?", answer: "yes", sensitive: true },
          { questionText: "Please indicate your notice period in months", answer: "0", sensitive: true },
        ],
      }),
    );
    expect(result.missing).toEqual([]);
    expect((document.getElementById("question_3") as HTMLSelectElement).value).toBe("1");
    expect((document.getElementById("question_4") as HTMLInputElement).value).toBe("0");
  });

  it("handles Lever radios, checkbox groups and consent boxes", async () => {
    mount(LEVER);
    const result = await fillForm(
      document,
      "lever",
      payload({
        acceptPrivacy: true,
        answers: [
          { questionText: "Are you legally authorized to work in the Netherlands?", answer: "Yes", sensitive: true },
          { questionText: "Which languages do you speak?", answer: ["English", "Hungarian"], sensitive: false },
        ],
      }),
    );
    const checked = (selector: string) => Array.from(document.querySelectorAll<HTMLInputElement>(selector)).filter((i) => i.checked).map((i) => i.value);
    expect((document.querySelector("input[name=name]") as HTMLInputElement).value).toBe("Alex Novak");
    expect((document.querySelector("input[name=org]") as HTMLInputElement).value).toBe("Riverline");
    expect((document.querySelector("input[name='urls[GitHub]']") as HTMLInputElement).value).toBe("https://github.com/alex");
    expect(checked("input[name='cards[abc][field0]']")).toEqual(["Yes"]);
    expect(checked("input[name='cards[def][field0]']")).toEqual(["English", "Hungarian"]);
    expect(checked("input[name='consent[privacy]']")).toEqual(["1"]);
    expect(checked("input[name='consent[marketing]']")).toEqual([]);
    expect(result.missing).toEqual([]);
  });

  it("leaves the privacy box to the user unless they allowed it", async () => {
    mount(LEVER);
    const result = await fillForm(document, "lever", payload());
    expect(result.missing.map((m) => m.text)).toContain(
      "I have read and agree to the Candidate Privacy Notice and the processing of my personal data",
    );
  });

  it("answers Ashby yes/no buttons from memory and flags open questions", async () => {
    mount(ASHBY);
    let pressed = "";
    document.querySelectorAll("button").forEach((b) => b.addEventListener("click", () => (pressed = b.textContent ?? "")));
    const result = await fillForm(
      document,
      "ashby",
      payload({ answers: [{ questionText: "Are you open to working from our Berlin office?", answer: "Yes", sensitive: false }] }),
    );
    expect((document.getElementById("_systemfield_name") as HTMLInputElement).value).toBe("Alex Novak");
    expect(pressed).toBe("Yes");
    expect(result.missing).toEqual([{ text: "Why do you want to join us?", type: "textarea", required: true }]);
  });
});

describe("captureAnswers", () => {
  it("remembers what the user typed into questions Orbit didn't fill", async () => {
    mount(GREENHOUSE);
    await fillForm(document, "greenhouse", payload());
    (document.getElementById("question_3") as HTMLSelectElement).value = "0";
    (document.getElementById("question_4") as HTMLInputElement).value = "2";
    (document.getElementById("question_5") as HTMLInputElement).value = "A friend";
    const captured = await captureAnswers(document, "greenhouse");
    expect(captured.map((c) => [c.question, c.answer, c.sensitive])).toEqual([
      ["Will you now or in the future require immigration support?", "No", true],
      ["Please indicate your notice period in months", "2", true],
      ["How did you hear about us?", "A friend", false],
    ]);
    expect(captured[0]!.hash).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("page checks", () => {
  it("finds the submit button for each ATS", () => {
    mount(GREENHOUSE);
    expect(findSubmitButton(document, "greenhouse")?.textContent).toBe("Submit application");
    mount(LEVER);
    expect(findSubmitButton(document, "lever")?.id).toBe("btn-submit");
    mount(ASHBY);
    expect(findSubmitButton(document, "ashby")?.className).toContain("submit-button");
  });

  it("recognizes success pages, errors and visible CAPTCHA puzzles", () => {
    mount("<h1>Thank you for applying!</h1>");
    expect(submissionSucceeded(document, "https://jobs.lever.co/x/y/apply")).toBe(true);
    mount("<p>Apply now</p>");
    expect(submissionSucceeded(document, "https://job-boards.greenhouse.io/x/jobs/1/confirmation")).toBe(true);
    expect(submissionSucceeded(document, "https://job-boards.greenhouse.io/x/jobs/1")).toBe(false);

    mount(`<label for="e">Email</label><input id="e" aria-invalid="true"><div class="error-message">Please enter a valid email</div>`);
    expect(formErrors(document)).toEqual(["Email", "Please enter a valid email"]);

    mount(`<iframe src="https://newassets.hcaptcha.com/captcha/v1/challenge"></iframe>`);
    const frame = document.querySelector("iframe")!;
    frame.getBoundingClientRect = () => ({ width: 400, height: 580 }) as DOMRect;
    expect(captchaChallengeVisible(document)).toBe(true);
    frame.getBoundingClientRect = () => ({ width: 256, height: 60 }) as DOMRect;
    expect(captchaChallengeVisible(document)).toBe(false);
  });
});

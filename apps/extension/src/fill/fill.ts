import {
  classifyField,
  findAnswer,
  isMarketingConsent,
  isPrivacyConsent,
  isSensitiveQuestion,
  matchOption,
  normalizeQuestion,
  questionHash,
  standardValue,
  type ApplicantProfile,
  type AnswerValue,
  type AutopilotAts,
  type PendingQuestion,
  type SavedAnswer,
} from "@orbit/core";
import { collectQuestions, hasValue, toPending, type FormQuestion } from "./questions";

export interface FillPayload {
  profile: ApplicantProfile;
  answers: SavedAnswer[];
  resume: { fileName: string; base64: string } | null;
  /** Tick the company's privacy-notice checkbox (a setting on Profile). */
  acceptPrivacy: boolean;
}

export interface FillResult {
  filled: number;
  /** Required questions Orbit couldn't answer: they go to the Needs you inbox. */
  missing: PendingQuestion[];
  /** Labels of everything Orbit filled, for the activity log. */
  filledLabels: string[];
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Sets a value the way typing would, so React-based forms notice it. */
export function setValue(element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string): void {
  const view = element.ownerDocument.defaultView ?? window;
  const proto =
    element instanceof view.HTMLTextAreaElement
      ? view.HTMLTextAreaElement.prototype
      : element instanceof view.HTMLSelectElement
        ? view.HTMLSelectElement.prototype
        : view.HTMLInputElement.prototype;
  element.focus();
  Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(element, value);
  element.dispatchEvent(new view.Event("input", { bubbles: true }));
  element.dispatchEvent(new view.Event("change", { bubbles: true }));
  element.dispatchEvent(new view.FocusEvent("blur", { bubbles: false }));
  element.dispatchEvent(new view.FocusEvent("focusout", { bubbles: true }));
}

function click(element: HTMLElement): void {
  const view = element.ownerDocument.defaultView ?? window;
  for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup"]) {
    element.dispatchEvent(new view.MouseEvent(type, { bubbles: true, cancelable: true }));
  }
  element.click();
}

function base64ToBytes(base64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(base64);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function attachFile(input: HTMLInputElement, file: { fileName: string; base64: string }): boolean {
  const view = input.ownerDocument.defaultView ?? window;
  try {
    const transfer = new view.DataTransfer();
    transfer.items.add(new view.File([base64ToBytes(file.base64)], file.fileName, { type: "application/pdf" }));
    input.files = transfer.files;
  } catch {
    return false;
  }
  input.dispatchEvent(new view.Event("input", { bubbles: true }));
  input.dispatchEvent(new view.Event("change", { bubbles: true }));
  return (input.files?.length ?? 0) > 0;
}

/** Picks an option in a searchable dropdown (react-select and similar). */
async function chooseFromCombobox(input: HTMLInputElement, text: string, exact: boolean): Promise<boolean> {
  const doc = input.ownerDocument;
  click(input);
  setValue(input, text);
  input.focus();
  for (let attempt = 0; attempt < 10; attempt++) {
    await wait(150);
    const listId = input.getAttribute("aria-controls") || input.getAttribute("aria-owns");
    const scope = (listId && doc.getElementById(listId)) || doc;
    const options = Array.from(scope.querySelectorAll<HTMLElement>("[role='option']"));
    if (!options.length) continue;
    const texts = options.map((o) => o.textContent?.replace(/\s+/g, " ").trim() ?? "");
    const pick = exact ? matchOption(text, texts) : (texts.find((t) => t.toLowerCase().startsWith(text.split(",")[0]!.trim().toLowerCase())) ?? null);
    if (pick === null) return false;
    click(options[texts.indexOf(pick)]!);
    return true;
  }
  return false;
}

function answerText(answer: AnswerValue): string {
  return Array.isArray(answer) ? answer.join(", ") : answer;
}

async function applyAnswer(question: FormQuestion, answer: AnswerValue): Promise<boolean> {
  const element = question.element;
  switch (question.kind) {
    case "text":
    case "textarea":
      setValue(element as HTMLInputElement, answerText(answer));
      return true;
    case "select": {
      const select = element as HTMLSelectElement;
      const options = Array.from(select.options);
      const pick = matchOption(answerText(answer), options.map((o) => o.text));
      const option = options.find((o) => o.text.replace(/\s+/g, " ").trim() === pick?.trim());
      if (!option) return false;
      setValue(select, option.value);
      return true;
    }
    case "combobox":
      return chooseFromCombobox(element as HTMLInputElement, answerText(answer), true);
    case "radio":
    case "buttons": {
      const pick = matchOption(answerText(answer), question.options);
      if (pick === null) return false;
      click(question.members[question.options.indexOf(pick)]!);
      return true;
    }
    case "checkbox": {
      const wanted = Array.isArray(answer) ? answer : [answer];
      if (question.members.length === 1) {
        const yes = /^(yes|true|agree|i agree|checked)$/i.test(answerText(answer).trim());
        if ((question.members[0] as HTMLInputElement).checked !== yes) click(question.members[0]!);
        return true;
      }
      const picks = wanted.map((w) => matchOption(w, question.options));
      if (picks.some((p) => p === null)) return false;
      question.members.forEach((member, index) => {
        const want = picks.includes(question.options[index]!);
        if ((member as HTMLInputElement).checked !== want) click(member);
      });
      return true;
    }
    case "file":
      return false;
  }
}

/**
 * Fills what Orbit knows: contact details and links from the resume, the
 * resume file, and saved answers. Work-authorization and equal-opportunity
 * questions are only ever filled from saved answers. Optional questions with
 * no saved answer are left blank; required ones are returned as missing.
 */
export async function fillForm(root: ParentNode, ats: AutopilotAts | null, payload: FillPayload): Promise<FillResult> {
  const questions = collectQuestions(root, ats);
  const missing: PendingQuestion[] = [];
  const filledLabels: string[] = [];
  let resumeAttached = false;

  for (const question of questions) {
    if (hasValue(question)) continue;
    const label = question.label;
    const field = classifyField({ label, name: question.name, id: question.id, autocomplete: question.autocomplete, type: question.inputType });

    let done = false;
    if (question.kind === "file") {
      if (field === "resume" || (!resumeAttached && field === null && /resume|cv/i.test(`${label} ${question.name} ${question.id}`))) {
        if (payload.resume && !resumeAttached) done = resumeAttached = attachFile(question.element as HTMLInputElement, payload.resume);
      }
    } else if (field && field !== "resume" && field !== "cover_letter" && !isSensitiveQuestion(label)) {
      const value = standardValue(field, payload.profile);
      if (value) {
        if (question.kind === "combobox") done = await chooseFromCombobox(question.element as HTMLInputElement, value, field !== "location");
        else if (question.kind === "text" || question.kind === "textarea") {
          setValue(question.element as HTMLInputElement, value);
          done = true;
        } else done = await applyAnswer(question, value);
        // A location typeahead with no matching suggestion keeps the typed text.
        if (!done && field === "location" && question.kind === "combobox") done = Boolean((question.element as HTMLInputElement).value);
      }
    } else if (question.kind === "checkbox" && question.members.length === 1 && isMarketingConsent(label)) {
      continue;
    } else if (question.kind === "checkbox" && question.members.length === 1 && isPrivacyConsent(label) && payload.acceptPrivacy) {
      if (!(question.members[0] as HTMLInputElement).checked) click(question.members[0]!);
      done = true;
    }

    if (!done) {
      const saved = findAnswer(label, payload.answers);
      if (saved) done = await applyAnswer(question, saved.answer);
    }

    if (done) {
      question.element.setAttribute("data-orbit-filled", "true");
      filledLabels.push(label || question.kind);
    } else if (question.required && !(question.kind === "file" && field === "cover_letter")) {
      missing.push(toPending(question));
    }
  }

  return { filled: filledLabels.length, missing, filledLabels };
}

export interface CapturedAnswer {
  hash: string;
  question: string;
  answer: AnswerValue;
  sensitive: boolean;
}

/**
 * Reads the answers the user typed into questions Orbit didn't fill, so the
 * same question is answered automatically next time.
 */
export async function captureAnswers(root: ParentNode, ats: AutopilotAts | null): Promise<CapturedAnswer[]> {
  const captured: CapturedAnswer[] = [];
  for (const question of collectQuestions(root, ats)) {
    if (!question.label || question.kind === "file" || question.element.getAttribute("data-orbit-filled") === "true") continue;
    if (classifyField({ label: question.label, name: question.name, id: question.id, autocomplete: question.autocomplete, type: question.inputType })) continue;
    if (question.kind === "checkbox" && question.members.length === 1 && (isMarketingConsent(question.label) || isPrivacyConsent(question.label))) continue;
    let answer: AnswerValue | null = null;
    switch (question.kind) {
      case "text":
      case "textarea":
      case "combobox": {
        const value = (question.element as HTMLInputElement).value.trim();
        answer = value ? value.slice(0, 3000) : null;
        break;
      }
      case "select": {
        const select = question.element as HTMLSelectElement;
        answer = select.value ? (select.selectedOptions[0]?.text.trim() ?? null) : null;
        break;
      }
      case "radio":
      case "buttons": {
        const index = question.members.findIndex((m) =>
          question.kind === "radio" ? (m as HTMLInputElement).checked : m.getAttribute("aria-pressed") === "true",
        );
        answer = index >= 0 ? question.options[index]! : null;
        break;
      }
      case "checkbox": {
        const picked = question.options.filter((_, i) => (question.members[i] as HTMLInputElement).checked);
        answer = question.members.length === 1 ? (picked.length ? "Yes" : null) : picked.length ? picked : null;
        break;
      }
    }
    if (answer === null || !normalizeQuestion(question.label)) continue;
    captured.push({
      hash: await questionHash(question.label),
      question: question.label.slice(0, 2000),
      answer,
      sensitive: isSensitiveQuestion(question.label),
    });
  }
  return captured.slice(0, 50);
}

import type { AutopilotAts, PendingQuestion } from "@orbit/core";
import { cssEscape } from "./css";

/**
 * Reads an application form into questions: one per text field, select,
 * file input, radio group, checkbox group or yes/no button pair, each with
 * the label a person would read. Works on Greenhouse, Lever and Ashby
 * markup, with generic fallbacks for anything else.
 */

export type ControlKind = "text" | "textarea" | "select" | "combobox" | "radio" | "checkbox" | "file" | "buttons";

export interface FormQuestion {
  label: string;
  required: boolean;
  kind: ControlKind;
  /** The main control (first radio/checkbox/button for groups). */
  element: HTMLElement;
  /** Every radio, checkbox or button in a group. */
  members: HTMLElement[];
  /** Visible option texts for select, radio, checkbox and buttons. */
  options: string[];
  name: string | null;
  id: string | null;
  autocomplete: string | null;
  inputType: string | null;
}

const clean = (text: string | null | undefined) =>
  (text ?? "").replace(/\s+/g, " ").replace(/\s*[*✱]\s*$/, "").trim();

function isHidden(element: Element): boolean {
  for (let node: Element | null = element; node; node = node.parentElement) {
    if (node instanceof HTMLElement) {
      if (node.hidden || node.style.display === "none" || node.style.visibility === "hidden") return true;
      if (node.getAttribute("aria-hidden") === "true" && node !== element) return true;
    }
  }
  return false;
}

function labelledBy(element: Element): string {
  const ids = element.getAttribute("aria-labelledby");
  if (!ids) return "";
  const doc = element.ownerDocument;
  return clean(
    ids
      .split(/\s+/)
      .map((id) => doc.getElementById(id)?.textContent ?? "")
      .join(" "),
  );
}

/** Text of a label element without the text of controls nested inside it. */
function labelText(label: Element): string {
  const copy = label.cloneNode(true) as Element;
  copy.querySelectorAll("input, select, textarea, option, button").forEach((n) => n.remove());
  return clean(copy.textContent);
}

function containerLabel(element: Element, ats: AutopilotAts | null): string {
  if (ats === "lever" || !ats) {
    const li = element.closest("li.application-question, .application-question");
    const text = li?.querySelector(".application-label .text, .application-label");
    if (text) return labelText(text);
  }
  if (ats === "ashby" || !ats) {
    const entry = element.closest(".ashby-application-form-field-entry, [class*='fieldEntry']");
    const title = entry?.querySelector(".ashby-application-form-question-title, label");
    if (title) return labelText(title);
  }
  const fieldset = element.closest("fieldset");
  const legend = fieldset?.querySelector("legend");
  if (legend) return labelText(legend);
  return "";
}

function directLabel(element: HTMLElement): string {
  const doc = element.ownerDocument;
  const id = element.id;
  if (id) {
    const forLabel = doc.querySelector(`label[for="${cssEscape(id)}"]`);
    if (forLabel) return labelText(forLabel);
    const named = doc.getElementById(`${id}-label`);
    if (named) return labelText(named);
  }
  const byAria = labelledBy(element);
  if (byAria) return byAria;
  const aria = clean(element.getAttribute("aria-label"));
  if (aria) return aria;
  const wrapping = element.closest("label");
  if (wrapping) return labelText(wrapping);
  return "";
}

function optionLabel(input: HTMLElement): string {
  const wrapping = input.closest("label");
  if (wrapping) return labelText(wrapping) || clean((input as HTMLInputElement).value);
  if (input.id) {
    const forLabel = input.ownerDocument.querySelector(`label[for="${cssEscape(input.id)}"]`);
    if (forLabel) return labelText(forLabel);
  }
  return clean(input.getAttribute("aria-label")) || clean((input as HTMLInputElement).value);
}

function isRequired(element: HTMLElement, label: string, rawLabel: string): boolean {
  if ((element as HTMLInputElement).required || element.getAttribute("aria-required") === "true") return true;
  if (/[*✱]/.test(rawLabel)) return true;
  const container = element.closest(".application-question, .ashby-application-form-field-entry, .field-wrapper, fieldset");
  if (container?.querySelector(".required, [class*='required']")) return true;
  return /\(required\)/i.test(label);
}

function rawLabelFor(element: HTMLElement, ats: AutopilotAts | null, group: boolean): string {
  // Groups take the question text from their container; single fields prefer their own label.
  if (group) return containerLabel(element, ats) || directLabel(element);
  return directLabel(element) || containerLabel(element, ats) || clean(element.getAttribute("placeholder"));
}

export function collectQuestions(root: ParentNode, ats: AutopilotAts | null): FormQuestion[] {
  const questions: FormQuestion[] = [];
  const seenGroups = new Set<string>();
  const controls = Array.from(root.querySelectorAll<HTMLElement>("input, textarea, select"));

  for (const element of controls) {
    if (isHidden(element) && !(element instanceof HTMLInputElement && element.type === "file")) continue;
    const input = element as HTMLInputElement;
    const type = element instanceof HTMLInputElement ? input.type.toLowerCase() : null;
    if (type && ["hidden", "submit", "button", "reset", "image", "search"].includes(type)) continue;

    if (type === "radio" || type === "checkbox") {
      const name = input.name || input.id;
      const groupKey = name ? `${type}:${name}` : `${type}:#${questions.length}`;
      if (seenGroups.has(groupKey)) continue;
      seenGroups.add(groupKey);
      const members = name
        ? controls.filter((c) => c instanceof HTMLInputElement && c.type === type && (c.name || c.id) === name && !isHidden(c))
        : [element];
      const single = members.length === 1;
      const raw = single && type === "checkbox" ? containerLabel(element, ats) || optionLabel(element) : rawLabelFor(element, ats, true);
      const label = clean(raw) || optionLabel(element);
      questions.push({
        label,
        required: isRequired(element, label, raw),
        kind: type,
        element,
        members,
        options: members.map(optionLabel),
        name: input.name || null,
        id: element.id || null,
        autocomplete: null,
        inputType: type,
      });
      continue;
    }

    const raw = rawLabelFor(element, ats, false);
    const label = clean(raw);
    const kind: ControlKind =
      element instanceof HTMLSelectElement
        ? "select"
        : element instanceof HTMLTextAreaElement
          ? "textarea"
          : type === "file"
            ? "file"
            : element.getAttribute("role") === "combobox"
              ? "combobox"
              : "text";
    questions.push({
      label,
      required: isRequired(element, label, raw),
      kind,
      element,
      members: [element],
      options:
        element instanceof HTMLSelectElement
          ? Array.from(element.options)
              .filter((o) => o.value !== "" && !/^(select|choose|please select)\b/i.test(o.text.trim()))
              .map((o) => clean(o.text))
          : [],
      name: input.name || null,
      id: element.id || null,
      autocomplete: element.getAttribute("autocomplete"),
      inputType: type,
    });
  }

  // Ashby asks yes/no questions with a pair of buttons and no input.
  for (const entry of Array.from(root.querySelectorAll<HTMLElement>(".ashby-application-form-field-entry"))) {
    if (entry.querySelector("input:not([type=hidden]), textarea, select")) continue;
    const buttons = Array.from(entry.querySelectorAll<HTMLButtonElement>("button")).filter((b) => clean(b.textContent));
    if (!buttons.length) continue;
    const title = entry.querySelector(".ashby-application-form-question-title, label");
    const raw = title ? labelText(title) : "";
    questions.push({
      label: clean(raw),
      required: isRequired(buttons[0]!, clean(raw), raw),
      kind: "buttons",
      element: buttons[0]!,
      members: buttons,
      options: buttons.map((b) => clean(b.textContent)),
      name: null,
      id: null,
      autocomplete: null,
      inputType: null,
    });
  }

  return questions.filter((q) => q.label || q.kind === "file");
}

export function hasValue(question: FormQuestion): boolean {
  switch (question.kind) {
    case "radio":
    case "checkbox":
      return question.members.some((m) => (m as HTMLInputElement).checked);
    case "file":
      return ((question.element as HTMLInputElement).files?.length ?? 0) > 0;
    case "buttons":
      return question.members.some((b) => b.getAttribute("aria-pressed") === "true" || /\b(active|selected)\b/i.test(b.className));
    case "select":
      return (question.element as HTMLSelectElement).value !== "";
    default:
      return Boolean((question.element as HTMLInputElement).value?.trim());
  }
}

export function toPending(question: FormQuestion): PendingQuestion {
  const type: PendingQuestion["type"] =
    question.kind === "combobox" || question.kind === "buttons" ? "select" : question.kind;
  return {
    text: question.label.slice(0, 500),
    type,
    ...(question.options.length ? { options: question.options.slice(0, 50).map((o) => o.slice(0, 200)) } : {}),
    required: question.required,
  };
}

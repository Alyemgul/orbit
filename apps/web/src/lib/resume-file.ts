/**
 * Reads a CV file in the browser and returns its text. Nothing is uploaded:
 * PDF (pdf.js) and Word (mammoth) are parsed locally, and the libraries are
 * only downloaded when someone actually picks such a file.
 */

export const RESUME_FILE_ACCEPT = ".pdf,.docx,.txt,.md,.json,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,application/json";
export const MAX_RESUME_FILE_BYTES = 10 * 1024 * 1024;

import { cleanText, pdfItemsToText, type PdfTextItem } from "@orbit/core";

export class ResumeFileError extends Error {}

type FileKind = "pdf" | "docx" | "text" | "json";

function kindOf(file: File): FileKind | null {
  const name = file.name.toLowerCase();
  if (file.type === "application/pdf" || name.endsWith(".pdf")) return "pdf";
  if (name.endsWith(".docx") || file.type.includes("wordprocessingml")) return "docx";
  if (name.endsWith(".json") || file.type === "application/json") return "json";
  if (name.endsWith(".txt") || name.endsWith(".md") || file.type.startsWith("text/")) return "text";
  return null;
}

export async function extractResumeText(file: File): Promise<{ text: string; kind: FileKind }> {
  const kind = kindOf(file);
  if (!kind) {
    if (file.name.toLowerCase().endsWith(".doc")) {
      throw new ResumeFileError("Old .doc files can't be read. In Word, use Save As → .docx or PDF, then upload that.");
    }
    throw new ResumeFileError("Upload a PDF, Word (.docx), .txt or JSON file.");
  }
  if (file.size > MAX_RESUME_FILE_BYTES) throw new ResumeFileError("That file is over 10 MB. Export a smaller PDF.");

  let text: string;
  if (kind === "pdf") text = await readPdf(file);
  else if (kind === "docx") text = await readDocx(file);
  else text = await file.text();

  text = cleanText(text);
  if (kind === "pdf" && text.replace(/\s/g, "").length < 40) {
    throw new ResumeFileError(
      "This PDF has no selectable text (it's probably a scanned image). Export your CV from Word or Google Docs as PDF, or paste the text instead.",
    );
  }
  if (!text.trim()) throw new ResumeFileError("That file looks empty.");
  return { text, kind };
}

async function readPdf(file: File): Promise<string> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
  let doc;
  try {
    doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false }).promise;
  } catch (error) {
    if (error instanceof Error && error.name === "PasswordException") {
      throw new ResumeFileError("That PDF is password-protected. Save a copy without a password and try again.");
    }
    throw new ResumeFileError("That PDF couldn't be opened. Try exporting it again from Word or Google Docs.");
  }

  const pages: string[] = [];
  for (let number = 1; number <= Math.min(doc.numPages, 10); number++) {
    const page = await doc.getPage(number);
    const content = await page.getTextContent();
    const items: PdfTextItem[] = [];
    for (const item of content.items) if ("str" in item) items.push(item);
    pages.push(pdfItemsToText(items));
  }
  await doc.destroy();
  return pages.join("\n\n");
}

async function readDocx(file: File): Promise<string> {
  const mammoth = await import("mammoth");
  try {
    // HTML keeps list items apart, so bullets survive; then strip the tags.
    const { value } = await mammoth.convertToHtml({ arrayBuffer: await file.arrayBuffer() });
    return htmlToText(value);
  } catch {
    throw new ResumeFileError("That Word file couldn't be read. Save it again as .docx or PDF and retry.");
  }
}

function htmlToText(html: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const out: string[] = [];
  const walk = (node: Element) => {
    for (const child of Array.from(node.children)) {
      const tag = child.tagName.toLowerCase();
      if (tag === "li") out.push(`• ${child.textContent?.trim() ?? ""}`);
      else if (tag === "ul" || tag === "ol" || tag === "table" || tag === "tbody" || tag === "tr") walk(child);
      else if (tag === "td") out.push(child.textContent?.trim() ?? "");
      else out.push(child.textContent?.trim() ?? "");
    }
  };
  walk(doc.body);
  return out.filter(Boolean).join("\n");
}

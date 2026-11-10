import type { Resume } from "@orbit/core";

/**
 * Downloads the resume as the same PDF file the autopilot uploads. The PDF
 * library is loaded only when someone clicks, so pages stay light.
 */
export async function downloadResumePdf(resume: Resume): Promise<void> {
  const { renderResumePdf, resumeFileName } = await import("@orbit/core/pdf");
  const bytes = await renderResumePdf(resume);
  const url = URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: "application/pdf" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = resumeFileName(resume);
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

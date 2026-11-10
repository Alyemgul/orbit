import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage } from "pdf-lib";
import type { Resume } from "./schema";

/**
 * The resume as a real, text-based PDF (A4, one column, standard fonts), so
 * applicant tracking systems can read every word. The autopilot uploads this
 * exact file; the web app offers the same file for download.
 */

const PAGE = { width: 595.28, height: 841.89 };
const MARGIN = { x: 50, top: 48, bottom: 48 };
const INK = rgb(0.09, 0.09, 0.11);
const MUTED = rgb(0.36, 0.36, 0.4);
const RULE = rgb(0.78, 0.78, 0.82);

// Characters the standard PDF fonts can draw (WinAnsi) beyond Latin-1.
const WIN_ANSI_EXTRA = new Set("€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ");

/** Replaces characters the standard fonts can't draw ("ő" becomes "o", emoji are dropped). */
export function pdfSafeText(text: string): string {
  let out = "";
  for (const char of text.replace(/[\r\n\t]+/g, " ")) {
    const code = char.codePointAt(0)!;
    if ((code >= 32 && code <= 126) || (code >= 160 && code <= 255) || WIN_ANSI_EXTRA.has(char)) {
      out += char;
      continue;
    }
    const base = char.normalize("NFKD").replace(/\p{M}/gu, "");
    if (base && [...base].every((c) => c.codePointAt(0)! >= 32 && c.codePointAt(0)! <= 126)) out += base;
    else if (char === "✱" || char === "★") out += "*";
    else if (/\p{Dash}/u.test(char)) out += "-";
  }
  return out;
}

function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const words = pdfSafeText(text).split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) <= width || !line) {
      line = candidate;
    } else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

export async function renderResumePdf(resume: Resume): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(pdfSafeText(`${resume.basics.name || "Resume"} - Resume`));
  doc.setAuthor(pdfSafeText(resume.basics.name));
  doc.setProducer("Orbit");
  doc.setCreator("Orbit");
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const contentWidth = PAGE.width - MARGIN.x * 2;

  let page: PDFPage = doc.addPage([PAGE.width, PAGE.height]);
  let y = PAGE.height - MARGIN.top;

  const ensure = (height: number) => {
    if (y - height < MARGIN.bottom) {
      page = doc.addPage([PAGE.width, PAGE.height]);
      y = PAGE.height - MARGIN.top;
    }
  };
  const draw = (text: string, x: number, size: number, font: PDFFont, color = INK) => {
    page.drawText(pdfSafeText(text), { x, y, size, font, color });
  };
  const centered = (text: string, size: number, font: PDFFont, color = INK) => {
    for (const line of wrap(text, font, size, contentWidth)) {
      ensure(size * 1.3);
      y -= size;
      draw(line, PAGE.width / 2 - font.widthOfTextAtSize(line, size) / 2, size, font, color);
      y -= size * 0.3;
    }
  };
  const paragraph = (text: string, size: number, indent = 0, prefix?: string) => {
    const lines = wrap(text, regular, size, contentWidth - indent);
    lines.forEach((line, index) => {
      ensure(size * 1.32);
      y -= size;
      if (prefix && index === 0) draw(prefix, MARGIN.x + indent - 9, size, regular);
      draw(line, MARGIN.x + indent, size, regular);
      y -= size * 0.32;
    });
  };
  const heading = (title: string) => {
    ensure(34);
    y -= 12;
    y -= 10;
    draw(title.toUpperCase(), MARGIN.x, 10, bold);
    y -= 4;
    page.drawLine({ start: { x: MARGIN.x, y }, end: { x: PAGE.width - MARGIN.x, y }, thickness: 0.6, color: RULE });
    y -= 5;
  };

  const { basics } = resume;
  centered(basics.name || "Your name", 19, bold);
  if (basics.headline) centered(basics.headline, 10.5, regular, MUTED);
  const contact = [basics.email, basics.phone, basics.location, ...basics.links.map((l) => l.url)].filter(Boolean);
  if (contact.length) centered(contact.join("  |  "), 9.5, regular, MUTED);

  if (resume.summary) {
    heading("Summary");
    paragraph(resume.summary, 10);
  }

  for (const section of resume.sections) {
    const entries = section.entries.filter((e) => e.title || e.org || e.bullets.some((b) => b.text));
    if (!entries.length) continue;
    heading(section.title || "Section");
    entries.forEach((entry, index) => {
      if (index > 0) y -= 5;
      const right = pdfSafeText([entry.location, entry.dates].filter(Boolean).join(" | "));
      const rightWidth = right ? regular.widthOfTextAtSize(right, 9.5) : 0;
      const org = entry.org ? (section.kind === "projects" ? ` | ${entry.org}` : `, ${entry.org}`) : "";
      ensure(26);
      y -= 10.5;
      const titleText = pdfSafeText(entry.title);
      const titleWidth = bold.widthOfTextAtSize(titleText, 10.5);
      draw(titleText, MARGIN.x, 10.5, bold);
      // Keep the organisation on the title line when it fits beside the dates.
      const orgRoom = contentWidth - titleWidth - rightWidth - 12;
      const orgText = pdfSafeText(org);
      const orgFits = regular.widthOfTextAtSize(orgText, 10.5) <= orgRoom;
      if (orgText && orgFits) draw(orgText, MARGIN.x + titleWidth, 10.5, regular);
      if (right) draw(right, PAGE.width - MARGIN.x - rightWidth, 9.5, regular, MUTED);
      y -= 3.5;
      if (orgText && !orgFits) paragraph(entry.org, 10);
      if (entry.link) {
        ensure(12);
        y -= 9;
        draw(entry.link, MARGIN.x, 9, regular, MUTED);
        y -= 3;
      }
      for (const bullet of entry.bullets) {
        if (bullet.text) paragraph(bullet.text, 10, 12, "•");
      }
    });
  }

  const skills = resume.skills.filter((g) => g.items.length);
  if (skills.length) {
    heading("Skills");
    for (const group of skills) {
      const label = pdfSafeText(group.name ? `${group.name}: ` : "");
      const labelWidth = label ? bold.widthOfTextAtSize(label, 10) + 2 : 0;
      const lines = wrap(group.items.join(", "), regular, 10, contentWidth - labelWidth);
      lines.forEach((line, index) => {
        ensure(13.2);
        y -= 10;
        if (index === 0 && label) draw(label, MARGIN.x, 10, bold);
        draw(line, MARGIN.x + labelWidth, 10, regular);
        y -= 3.2;
      });
    }
  }

  return doc.save();
}

/** "Alex_Novak_Resume.pdf" */
export function resumeFileName(resume: Resume): string {
  const name = resume.basics.name
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
  return `${name || "Resume"}_Resume.pdf`;
}

/**
 * Turning PDF text items into lines, shared by the browser import and tests.
 * pdf.js gives positioned pieces of text; these rebuild readable lines.
 */

export interface PdfTextItem {
  str: string;
  transform: number[];
  width: number;
  hasEOL?: boolean;
}

/** Normalizes the odd characters PDFs and Word leave behind. */
export function cleanText(text: string): string {
  return (
    text
      .replace(/\r\n?/g, "\n")
      // Private-use bullet glyphs from Word's Symbol and Wingdings fonts.
      .replace(/[]/g, "•")
      .replace(/[   ]/g, " ")
      .replace(/[​-‍﻿]/g, "")
      .replace(/ﬁ/g, "fi")
      .replace(/ﬂ/g, "fl")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .slice(0, 60_000)
  );
}

/** Lines that start this far right of the page's main left edge are marked as indented. */
const INDENT_PT = 4;

/**
 * Rebuilds lines from positioned PDF text: a new line when the baseline moves,
 * a space when there's a visible gap between pieces of the same line. A line
 * that starts indented from the main left edge (a bullet's wrapped text) keeps
 * two leading spaces, so the parser can tell it from the next title.
 */
export function pdfItemsToText(items: PdfTextItem[]): string {
  const lines: { text: string; x: number | null }[] = [];
  let line = "";
  let lineX: number | null = null;
  let lastY: number | null = null;
  let lastEnd: number | null = null;
  const flush = () => {
    lines.push({ text: line, x: lineX });
    line = "";
    lineX = null;
    lastEnd = null;
  };
  for (const item of items) {
    const x = item.transform[4] ?? 0;
    const y = item.transform[5] ?? 0;
    const height = Math.abs(item.transform[3] ?? 10) || 10;
    if (lastY !== null && Math.abs(y - lastY) > height * 0.4) flush();
    if (item.str) {
      const gap = lastEnd === null ? 0 : x - lastEnd;
      if (line && gap > height * 0.15 && !line.endsWith(" ") && !item.str.startsWith(" ")) line += " ";
      if (!line.trim()) lineX = x;
      line += item.str;
      lastEnd = x + item.width;
      lastY = y;
    }
    if (item.hasEOL) {
      flush();
      lastY = null;
    }
  }
  if (line) flush();

  // The main left edge: the leftmost start shared by several lines (centred
  // headers and right-aligned dates start in one-off places).
  const starts = new Map<number, number>();
  for (const l of lines) if (l.x !== null && l.text.trim()) starts.set(Math.round(l.x), (starts.get(Math.round(l.x)) ?? 0) + 1);
  const shared = [...starts.entries()].filter(([, count]) => count >= 3).map(([x]) => x);
  const left = shared.length ? Math.min(...shared) : Math.min(...starts.keys(), 0);

  return lines
    .map((l) => {
      const text = l.text.replace(/\s+/g, " ").trim();
      return text && l.x !== null && l.x - left > INDENT_PT ? `  ${text}` : text;
    })
    .join("\n");
}

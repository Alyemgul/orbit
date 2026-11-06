/**
 * Minimal, dependency-free HTML to plain text conversion for job
 * descriptions. Raw HTML from job boards is never stored or rendered, which
 * removes a whole class of XSS risk; this keeps paragraphs and bullets.
 */

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "–",
  mdash: "—",
  hellip: "…",
  bull: "•",
  middot: "·",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
  euro: "€",
  pound: "£",
  copy: "©",
  reg: "®",
  trade: "™",
  auml: "ä",
  ouml: "ö",
  uuml: "ü",
  Auml: "Ä",
  Ouml: "Ö",
  Uuml: "Ü",
  szlig: "ß",
  eacute: "é",
  egrave: "è",
  agrave: "à",
  ccedil: "ç",
};

function codePointToString(codePoint: number): string {
  if (!Number.isFinite(codePoint) || codePoint <= 0 || codePoint > 0x10ffff) return "";
  try {
    return String.fromCodePoint(codePoint);
  } catch {
    return "";
  }
}

export function decodeHtmlEntities(input: string): string {
  return input.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity: string) => {
    if (entity[0] === "#") {
      const hex = entity[1] === "x" || entity[1] === "X";
      return codePointToString(Number.parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10)) || match;
    }
    return NAMED_ENTITIES[entity] ?? match;
  });
}

const BLOCK_CLOSE = /<\/(p|div|section|article|h[1-6]|ul|ol|table|tr|blockquote|header|footer)\s*>/gi;

export function htmlToText(html: string): string {
  let text = html
    .replace(/<(script|style|noscript|template)[\s\S]*?<\/\1\s*>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<li[^>]*>/gi, "\n• ")
    .replace(/<\/li\s*>/gi, "")
    .replace(/<h[1-6][^>]*>/gi, "\n\n")
    .replace(BLOCK_CLOSE, "\n\n")
    .replace(/<[^>]+>/g, "");

  text = decodeHtmlEntities(text)
    .replace(/ /g, " ")
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n");

  return text.trim();
}

/** Truncate on a word boundary and mark the cut. */
export function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  const slice = text.slice(0, maxLength - 1);
  const lastSpace = slice.lastIndexOf(" ");
  return `${slice.slice(0, lastSpace > 0 ? lastSpace : slice.length)}…`;
}

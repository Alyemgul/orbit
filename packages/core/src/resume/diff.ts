export type DiffPart = { type: "same" | "added" | "removed"; text: string };

/** Words and the whitespace after them, so joining parts rebuilds the text. */
function tokens(text: string): string[] {
  return text.match(/\S+\s*|\s+/g) ?? [];
}

function key(token: string): string {
  return token.trim().toLowerCase();
}

/**
 * Word-level diff (longest common subsequence). Inputs are single bullets,
 * so the quadratic table stays small; very long inputs fall back to a
 * whole-text replacement.
 */
export function wordDiff(before: string, after: string): DiffPart[] {
  if (before === after) return before ? [{ type: "same", text: before }] : [];
  const a = tokens(before);
  const b = tokens(after);
  if (a.length * b.length > 250_000) {
    return [
      ...(before ? [{ type: "removed" as const, text: before }] : []),
      ...(after ? [{ type: "added" as const, text: after }] : []),
    ];
  }

  const rows = a.length + 1;
  const cols = b.length + 1;
  const table = new Uint16Array(rows * cols);
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      table[i * cols + j] =
        key(a[i]!) === key(b[j]!)
          ? table[(i + 1) * cols + j + 1]! + 1
          : Math.max(table[(i + 1) * cols + j]!, table[i * cols + j + 1]!);
    }
  }

  const parts: DiffPart[] = [];
  const push = (type: DiffPart["type"], text: string) => {
    const last = parts[parts.length - 1];
    if (last && last.type === type) last.text += text;
    else parts.push({ type, text });
  };
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (key(a[i]!) === key(b[j]!)) {
      push("same", b[j]!);
      i++;
      j++;
    } else if (table[(i + 1) * cols + j]! >= table[i * cols + j + 1]!) {
      push("removed", a[i++]!);
    } else {
      push("added", b[j++]!);
    }
  }
  while (i < a.length) push("removed", a[i++]!);
  while (j < b.length) push("added", b[j++]!);
  return parts;
}

/** Share of the text that changed, 0–1. */
export function changeRatio(parts: readonly DiffPart[]): number {
  let changed = 0;
  let total = 0;
  for (const part of parts) {
    const length = part.text.trim().length;
    total += length;
    if (part.type !== "same") changed += length;
  }
  return total === 0 ? 0 : changed / total;
}

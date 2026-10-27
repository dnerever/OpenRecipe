/**
 * Which words of a step changed, for showing a reworded step the way a person
 * would mark up a printout: "Combine both flours with ~~700g~~ 730g of the
 * water." A line diff marks the whole sentence, and the reader has to find the
 * one number that moved.
 *
 * Words and the spaces between them are separate tokens, so the pieces join
 * back into exactly the original text on either side.
 */
export type WordPart = { kind: 'same' | 'removed' | 'added'; text: string };

export function wordDiff(before: string, after: string): WordPart[] {
  const a = tokens(before);
  const b = tokens(after);

  // Longest common subsequence, by table. Steps are a sentence or three, so
  // the quadratic table is a few thousand cells at most.
  const lcs: number[][] = Array.from({ length: a.length + 1 }, () =>
    new Array<number>(b.length + 1).fill(0),
  );
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i]![j] =
        a[i] === b[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
    }
  }

  const parts: WordPart[] = [];
  const push = (kind: WordPart['kind'], text: string) => {
    const last = parts.at(-1);
    if (last?.kind === kind) last.text += text;
    else parts.push({ kind, text });
  };

  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      push('same', a[i]!);
      i++;
      j++;
    } else if (lcs[i + 1]![j]! >= lcs[i]![j + 1]!) {
      push('removed', a[i++]!);
    } else {
      push('added', b[j++]!);
    }
  }
  while (i < a.length) push('removed', a[i++]!);
  while (j < b.length) push('added', b[j++]!);

  return parts;
}

/** Words (with the numbers and degrees in them), spaces, and punctuation on its own. */
function tokens(text: string): string[] {
  return text.match(/\s+|[\p{L}\p{N}°'’-]+|[^\s\p{L}\p{N}]/gu) ?? [];
}

/** The text on one side, from the parts — for checking that nothing was lost. */
export function sideOf(parts: WordPart[], side: 'before' | 'after'): string {
  const skip = side === 'before' ? 'added' : 'removed';
  return parts
    .filter((p) => p.kind !== skip)
    .map((p) => p.text)
    .join('');
}

import { diffText } from '@openrecipe/core';

/**
 * Which lines of `doc` differ from `baseline`, as 1-based line numbers.
 *
 * Split out of the editor because it is the one part of the change gutter that
 * can be wrong invisibly: an off-by-one puts the marker on the neighbouring
 * line, which still looks entirely plausible.
 *
 * `edited` are lines present in `doc`. `deletedBefore` are positions in `doc`
 * where lines were removed and nothing replaced them — there is no line left to
 * mark, so the marker goes on the line that closed over the gap. That position
 * can be one past the end when the deletion was at the tail; the caller drops
 * anything beyond the document.
 */
export function changedLineNumbers(
  baseline: string,
  doc: string,
): { edited: Set<number>; deletedBefore: Set<number> } {
  const edited = new Set<number>();
  const deletedBefore = new Set<number>();
  if (!baseline || baseline === doc) return { edited, deletedBefore };

  let line = 1;
  for (const chunk of diffText(baseline, doc)) {
    if (chunk.type === 'context') {
      line += chunk.lines.length;
      continue;
    }
    if (chunk.added.length === 0) deletedBefore.add(line);
    for (let i = 0; i < chunk.added.length; i += 1) edited.add(line + i);
    line += chunk.added.length;
  }
  return { edited, deletedBefore };
}

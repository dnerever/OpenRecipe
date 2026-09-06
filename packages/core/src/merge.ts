import { diff3Merge } from 'node-diff3';

/**
 * Three-way merge over document text.
 *
 * A recipe is one document, so this is a line merge and not a tree merge — the
 * frontmatter is line-oriented YAML and the body is line-oriented Markdown,
 * which is exactly the shape `diff3` is good at. Two people editing different
 * ingredients edit different lines and merge cleanly; two people editing the
 * *same* ingredient are making a decision only a human can make, and that is
 * what a conflict is for.
 *
 * Nothing here touches the database or knows what a proposal is. It takes three
 * strings and returns what the merge of them would be.
 */

export type MergeKind =
  /** The two sides already agree — there is nothing to merge. */
  | 'identical'
  /** The target has not moved since the fork point: take the source wholesale. */
  | 'fast-forward'
  /** The source has not moved: the proposal contains no change. */
  | 'no-op'
  | 'merged'
  | 'conflicted';

export type ConflictHunk = {
  /** 1-based, inclusive, into `content` — the whole marked block. */
  startLine: number;
  endLine: number;
  ours: string[];
  base: string[];
  theirs: string[];
};

export type MergeOutcome = {
  clean: boolean;
  kind: MergeKind;
  /** The merged document. When `clean` is false it carries conflict markers. */
  content: string;
  conflicts: ConflictHunk[];
};

export type MergeLabels = {
  /** Names the target's side of a conflict. */
  ours?: string;
  /** Names the incoming side. */
  theirs?: string;
};

export const CONFLICT_START = '<<<<<<<';
export const CONFLICT_DIVIDER = '=======';
export const CONFLICT_END = '>>>>>>>';

/**
 * `ours` is the target — the recipe receiving the change — and `theirs` is the
 * source. `base` is their merge base, which the caller computes from the
 * version graph; a proposal without one is not mergeable and should never
 * reach here.
 *
 * The three documents are assumed already normalized, which every stored
 * version is: the write path serializes before hashing. Merging unnormalized
 * text would report trailing whitespace as a conflict.
 */
export function mergeDocuments(
  base: string,
  ours: string,
  theirs: string,
  labels: MergeLabels = {},
): MergeOutcome {
  if (ours === theirs) return settled('identical', ours);
  if (ours === base) return settled('fast-forward', theirs);
  if (theirs === base) return settled('no-op', ours);

  const ourLabel = labels.ours ?? 'current';
  const theirLabel = labels.theirs ?? 'proposed';

  const regions = diff3Merge(lines(ours), lines(base), lines(theirs), {
    // Both sides making the same edit is agreement, not a conflict. Two people
    // adding the same tag should not have to meet about it.
    excludeFalseConflicts: true,
  }) as Diff3Region[];

  const merged: string[] = [];
  const conflicts: ConflictHunk[] = [];

  for (const region of regions.flatMap(refine)) {
    if (region.ok) {
      merged.push(...region.ok);
      continue;
    }
    if (!region.conflict) continue;

    const startLine = merged.length + 1;
    merged.push(
      `${CONFLICT_START} ${ourLabel}`,
      ...region.conflict.a,
      CONFLICT_DIVIDER,
      ...region.conflict.b,
      `${CONFLICT_END} ${theirLabel}`,
    );
    conflicts.push({
      startLine,
      endLine: merged.length,
      ours: region.conflict.a,
      base: region.conflict.o,
      theirs: region.conflict.b,
    });
  }

  return {
    clean: conflicts.length === 0,
    kind: conflicts.length === 0 ? 'merged' : 'conflicted',
    content: merged.join('\n'),
    conflicts,
  };
}

/**
 * The guard on committing a resolution. A human resolving a conflict in a text
 * editor can very easily leave a marker behind, and a recipe whose ingredient
 * list contains `=======` is a recipe nobody can cook — so the merge endpoint
 * refuses the content rather than storing it.
 */
export function containsConflictMarkers(content: string): boolean {
  return content
    .split('\n')
    .some(
      (line) =>
        line.startsWith(CONFLICT_START) ||
        line === CONFLICT_DIVIDER ||
        line.startsWith(CONFLICT_END),
    );
}

type Diff3Region = {
  ok?: string[];
  conflict?: { a: string[]; o: string[]; b: string[] };
};

/**
 * `diff3` groups hunks whose base ranges merely *touch*, so two people editing
 * consecutive lines — which, in an ingredient list, is most of the time — land
 * in one unstable region and come back as a conflict. Git merges that without
 * comment, and so should this.
 *
 * When such a region is a straight substitution, every side the same number of
 * lines, each line is an independent three-way merge: a line only one side
 * rewrote takes that side's version, and only the lines both sides rewrote
 * differently are left contested. Regions that insert or delete keep whatever
 * `diff3` made of them, because there the line-for-line correspondence this
 * relies on does not exist.
 */
function refine(region: Diff3Region): Diff3Region[] {
  const conflict = region.conflict;
  if (!conflict) return [region];
  if (conflict.a.length !== conflict.o.length || conflict.b.length !== conflict.o.length) {
    return [region];
  }

  const out: Diff3Region[] = [];
  let resolved: string[] = [];
  let contested: { a: string[]; o: string[]; b: string[] } | null = null;

  const flushResolved = () => {
    if (resolved.length > 0) out.push({ ok: resolved });
    resolved = [];
  };
  const flushContested = () => {
    if (contested) out.push({ conflict: contested });
    contested = null;
  };

  for (let i = 0; i < conflict.o.length; i++) {
    const ours = conflict.a[i] as string;
    const base = conflict.o[i] as string;
    const theirs = conflict.b[i] as string;

    const settledLine =
      ours === theirs ? ours : ours === base ? theirs : theirs === base ? ours : null;

    if (settledLine === null) {
      flushResolved();
      contested ??= { a: [], o: [], b: [] };
      contested.a.push(ours);
      contested.o.push(base);
      contested.b.push(theirs);
      continue;
    }

    flushContested();
    resolved.push(settledLine);
  }

  flushResolved();
  flushContested();
  return out;
}

function settled(kind: MergeKind, content: string): MergeOutcome {
  return { clean: true, kind, content, conflicts: [] };
}

/**
 * A trailing newline splits to a final empty line, which is stable across all
 * three sides and rejoins to the same newline — so documents keep the shape the
 * serializer gave them without this needing to know about it.
 */
function lines(text: string): string[] {
  return text.split('\n');
}
